import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import express from 'express';
import { createPortViewer, PortViewerError, PORT_MAX_ROWS } from './port-viewer.js';
import { registerPortViewerApi } from './port-viewer-api.js';

const row = (extra = {}) => ({ protocol: 'TCP', localAddress: '127.0.0.1', localPort: 3000, remoteAddress: '0.0.0.0', remotePort: 0, state: 'Listen', pid: 123, processName: 'node', ...extra });
const sample = (rows = [row()], truncated = false) => ({ rows, truncated });
function fixture(options = {}) {
    const calls = [], children = [], logs = [];
    const service = createPortViewer({ platform: 'win32', log: value => logs.push(value), ...options,
        spawnProcess: (...args) => {
            calls.push(args); const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.killed = 0;
            child.kill = () => { child.killed++; queueMicrotask(() => child.emit('close', null)); return true; };
            children.push(child); return child;
        } });
    const respond = (value = sample(), code = 0) => { const child = children.at(-1); child.stdout.write(typeof value === 'string' ? value : JSON.stringify(value)); child.emit('close', code); };
    return { service, calls, children, logs, respond };
}

test('固定隐藏PowerShell采集TCP/UDP和进程名，不读取命令行', async () => {
    const f = fixture(); const reading = f.service.read();
    const [exe, args, options] = f.calls[0];
    assert.match(exe, /WindowsPowerShell.*powershell\.exe$/); assert.equal(options.windowsHide, true); assert.equal(options.shell, false);
    const script = Buffer.from(args.at(-1), 'base64').toString('utf16le');
    assert.match(script, /Get-NetTCPConnection/); assert.match(script, /Get-NetUDPEndpoint/); assert.match(script, /Get-Process/);
    assert.doesNotMatch(script, /CommandLine|ExecutablePath|Stop-Process|Invoke-WebRequest|netstat|taskkill/i);
    f.respond(sample([row(), row({ protocol: 'UDP', localAddress: '::', localPort: 53, remoteAddress: '', state: 'Bound', processName: '', pid: 4 })]));
    const value = await reading; assert.equal(value.rows.length, 2); assert.equal(value.state, 'ready'); assert.equal(value.rows[0].state, 'Listen');
    assert.ok(Object.isFrozen(value.rows)); f.service.dispose();
});

test('支持IPv6范围ID、数字TCP状态，裁掉非公开属性', async () => {
    const f = fixture(), reading = f.service.read();
    f.respond(sample([row({ localAddress: 'fe80::1%12', remoteAddress: '::', state: '2', secretPath: 'not-public' })], true));
    const value = await reading; assert.equal(value.rows[0].state, 'Listen'); assert.equal(value.truncated, true); assert.ok(!('secretPath' in value.rows[0]));
    f.service.dispose();
});

test('多客户端共用在途采集及2秒缓存，缓存到期重读', async () => {
    let time = 100000; const f = fixture({ now: () => time });
    const a = f.service.read(), b = f.service.read(); assert.equal(f.calls.length, 1); f.respond();
    assert.strictEqual(await a, await b); assert.strictEqual(await f.service.read(), await a); assert.equal(f.calls.length, 1);
    time += 2001; const c = f.service.read(); assert.equal(f.calls.length, 2); f.respond(sample([])); assert.equal((await c).rows.length, 0); f.service.dispose();
});

test('一个客户端取消不会中止其他客户端', async () => {
    const f = fixture(), controller = new AbortController(); const a = f.service.read(controller.signal), b = f.service.read();
    controller.abort(); await assert.rejects(a, { code: 'cancelled' }); assert.equal(f.children[0].killed, 0);
    f.respond(); assert.equal((await b).rows.length, 1); f.service.dispose();
});

test('最后客户端取消终止采集，不接纳迟到结果', async () => {
    const f = fixture(), controller = new AbortController(), reading = f.service.read(controller.signal);
    controller.abort(); await assert.rejects(reading, { code: 'cancelled' });
    await new Promise(resolve => setImmediate(resolve)); assert.equal(f.children[0].killed, 1);
    const next = f.service.read(); assert.equal(f.calls.length, 2); f.respond(sample([])); assert.equal((await next).rows.length, 0); f.service.dispose();
});

test('采集超时有明确反馈并回收进程', async () => {
    const f = fixture({ timeoutMs: 15 }), reading = f.service.read(); await assert.rejects(reading, { code: 'timeout' });
    assert.equal(f.children[0].killed, 1); assert.equal(f.logs.length, 1); f.service.dispose();
});

test('超大stdout和stderr有界，不泄露原始内容', async () => {
    for (const stream of ['stdout', 'stderr']) {
        const f = fixture(), reading = f.service.read(); f.children[0][stream].write(Buffer.alloc(stream === 'stdout' ? 2 * 1024 * 1024 + 1 : 8193, 'X'));
        await assert.rejects(reading, error => !error.message.includes('XXXXX')); assert.equal(f.children[0].killed, 1);
        assert.ok(!JSON.stringify(f.logs).includes('XXXXX')); f.service.dispose();
    }
});

test('拒绝恶意或损坏的快照，失败后可重新读取', async () => {
    const values = ['not JSON', sample([row({ localAddress: 'example.com' })]), sample([row({ localPort: 65536 })]),
        sample([row({ processName: 'line\nbreak' })]), sample([row({ pid: -1 })]), sample([row({ state: 'unknown' })]),
        sample([row({ protocol: 'UDP', remoteAddress: '', state: 'Listen' })]), sample(Array.from({ length: PORT_MAX_ROWS + 1 }, () => row()))];
    for (const value of values) { const f = fixture(), reading = f.service.read(); f.respond(value); await assert.rejects(reading, { code: 'read_failed' });
        const retry = f.service.read(); f.respond(); assert.equal((await retry).rows.length, 1); f.service.dispose(); }
});

test('非零退出及启动错误只报告可恢复的通用错误', async () => {
    for (const kind of ['close', 'error']) {
        const f = fixture(), reading = f.service.read();
        if (kind === 'close') f.respond('private raw data', 1); else f.children[0].emit('error', new Error('private raw data'));
        await assert.rejects(reading, error => error.code === 'read_failed' && !error.message.includes('private'));
        assert.ok(!JSON.stringify(f.logs).includes('private')); f.service.dispose();
    }
});

test('平台不支持及预先取消均不启动进程', async () => {
    const f = fixture({ platform: 'linux' }); assert.equal((await f.service.read()).state, 'unsupported'); assert.equal(f.calls.length, 0);
    await assert.rejects(f.service.read(AbortSignal.abort()), { code: 'cancelled' }); f.service.dispose();
});

test('服务关闭中止在途请求，并拒绝后续读取', async () => {
    const f = fixture(), reading = f.service.read(); f.service.dispose(); await assert.rejects(reading, { code: 'cancelled' });
    assert.equal(f.children[0].killed, 1); await assert.rejects(f.service.read(), { code: 'unavailable' });
});

test('端口API同源/专用头/方法/附加参数保护及错误脱敏', async t => {
    let count = 0, failure;
    const app = express(); registerPortViewerApi(app, { service: { read: async () => { count++; if (failure) throw failure; return { state: 'ready', sampledAt: new Date().toISOString(), ...sample() }; } } });
    const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
    const base = `http://127.0.0.1:${server.address().port}`;
    const get = (path = '', options = {}) => fetch(base + '/api/ports/snapshot' + path, { ...options, headers: { Origin: base, 'X-Toolbox-Ports': '1', ...options.headers } });
    const ok = await get(); assert.equal(ok.status, 200); assert.equal(ok.headers.get('cache-control'), 'no-store'); assert.equal((await ok.json()).rows[0].pid, 123);
    for (const options of [{ method: 'POST' }, { headers: { 'X-Toolbox-Ports': '' } }, { headers: { Origin: 'https://example.invalid' } }]) assert.equal((await get('', options)).status, 403);
    assert.equal((await get('?pid=123')).status, 403); assert.equal(count, 1);
    failure = new Error('secret internal path'); const unknown = await get(); assert.equal(unknown.status, 503); assert.ok(!(await unknown.text()).includes('secret'));
    failure = new PortViewerError('timeout', '读取超时', 504); const timeout = await get(); assert.equal(timeout.status, 504); assert.equal((await timeout.json()).message, '读取超时');
});
