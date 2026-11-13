import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createProxyFetch, normalizeProxy, parseProxyServer, probeProxy, proxyArgs, readSystemProxy, resetProxyCache, resolveProxy } from './video-proxy.js';

// resolveProxy 有 60 秒缓存，测试之间要清掉，否则顺序会影响结果。
test.afterEach(() => resetProxyCache());

test('规范化代理地址：补协议、补端口、去掉多余路径', () => {
    assert.equal(normalizeProxy('127.0.0.1:7897'), 'http://127.0.0.1:7897');
    assert.equal(normalizeProxy('http://127.0.0.1:7897/'), 'http://127.0.0.1:7897');
    assert.equal(normalizeProxy('socks5://127.0.0.1'), 'socks5://127.0.0.1:1080');
    assert.equal(normalizeProxy('http://user:pass@proxy.example.com:8080'), 'http://user:pass@proxy.example.com:8080');
    assert.equal(normalizeProxy('  '), '');
});

test('拒绝不能当代理用的地址', () => {
    for (const value of ['ftp://127.0.0.1:21', 'http://', 'http://127.0.0.1:7897/path', 'http://127.0.0.1:0', 'http://127.0.0.1:70000', 'http://127.0.0.1:7897?x=1', 'http://a b:1']) {
        assert.equal(normalizeProxy(value), '', `${value} 应被拒绝`);
    }
});

test('Windows 的 ProxyServer 支持 host:port 与按协议两种写法', () => {
    assert.equal(parseProxyServer('127.0.0.1:7897'), 'http://127.0.0.1:7897');
    assert.equal(parseProxyServer('http=10.0.0.2:8080;https=10.0.0.3:8081'), 'http://10.0.0.3:8081');
    assert.equal(parseProxyServer(''), '');
});

test('系统代理关闭时读不到代理', async () => {
    const exec = async (file, args) => ({ stdout: args.includes('ProxyEnable') ? 'ProxyEnable    REG_DWORD    0x0' : 'ProxyServer    REG_SZ    127.0.0.1:7897' });
    assert.equal(await readSystemProxy({ platform: 'win32', exec }), '');
    assert.equal(await readSystemProxy({ platform: 'linux', exec }), '');
});

test('系统代理开启时读出地址', async () => {
    const exec = async (file, args) => ({ stdout: args.includes('ProxyEnable') ? 'ProxyEnable    REG_DWORD    0x1' : 'ProxyServer    REG_SZ    127.0.0.1:7897' });
    assert.equal(await readSystemProxy({ platform: 'win32', exec }), 'http://127.0.0.1:7897');
});

test('reg.exe 被禁用时退回 PowerShell 读系统代理', async () => {
    const exec = async file => {
        if (file === 'reg') throw new Error('blocked');
        return { stdout: '127.0.0.1:7897\r\n' };
    };
    assert.equal(await readSystemProxy({ platform: 'win32', exec }), 'http://127.0.0.1:7897');
    assert.equal(await readSystemProxy({ platform: 'win32', exec: async () => { throw new Error('blocked'); } }), '');
});

// 代理端口探测用假 socket：connect 事件算通，error / timeout 算不通。
const fakeSocket = event => () => {
    const socket = new EventEmitter();
    socket.destroy = () => {};
    socket.setTimeout = () => {};
    setImmediate(() => socket.emit(event, new Error('x')));
    return socket;
};

test('代理优先级：手动设置 > 系统代理 > 环境变量', async () => {
    const exec = async () => ({ stdout: 'ProxyEnable    REG_DWORD    0x1\nProxyServer    REG_SZ    127.0.0.1:7897' });
    const reachable = fakeSocket('connect');
    assert.deepEqual(await resolveProxy({ configured: '127.0.0.1:1080', env: { HTTPS_PROXY: 'http://1.1.1.1:1' }, platform: 'win32', exec, createConnection: reachable }),
        { url: 'http://127.0.0.1:1080', source: 'configured' });
    // 浏览器走的是系统代理，环境变量常被终端工具改写，因此系统代理优先。
    assert.deepEqual(await resolveProxy({ configured: '', env: { HTTPS_PROXY: 'http://1.1.1.1:1' }, platform: 'win32', exec, createConnection: reachable }),
        { url: 'http://127.0.0.1:7897', source: 'system' });
    // 非 Windows 没有系统代理可读，退回环境变量。
    resetProxyCache();
    assert.deepEqual(await resolveProxy({ configured: '', env: { HTTPS_PROXY: 'http://1.1.1.1:1' }, platform: 'linux', exec, createConnection: reachable }),
        { url: 'http://1.1.1.1:1', source: 'env' });
});

test('系统代理没在监听时退回环境变量，仍不可用才判为无代理', async () => {
    const exec = async () => ({ stdout: 'ProxyEnable    REG_DWORD    0x1\nProxyServer    REG_SZ    127.0.0.1:7897' });
    assert.deepEqual(await resolveProxy({ configured: '', env: { HTTPS_PROXY: 'http://1.1.1.1:1' }, platform: 'win32', exec, createConnection: fakeSocket('error') }),
        { url: 'http://1.1.1.1:1', source: 'env' });
    resetProxyCache();
    assert.deepEqual(await resolveProxy({ configured: '', env: {}, platform: 'win32', exec, createConnection: fakeSocket('error') }),
        { url: '', source: 'none' });
});

test('探测代理端口：连通为真，错误为假', async () => {
    assert.equal(await probeProxy('http://127.0.0.1:7897', { createConnection: fakeSocket('connect') }), true);
    assert.equal(await probeProxy('http://127.0.0.1:7897', { createConnection: fakeSocket('error') }), false);
    assert.equal(await probeProxy('http://127.0.0.1:7897', { createConnection: fakeSocket('timeout') }), false);
});

test('没有代理时不改参数、不包一层 fetch', async () => {
    assert.deepEqual(proxyArgs(''), []);
    assert.deepEqual(proxyArgs('127.0.0.1:7897'), ['--proxy', 'http://127.0.0.1:7897']);
    const globalFetch = async () => 'ok';
    assert.equal(await createProxyFetch('', { globalFetch }), globalFetch);
});
