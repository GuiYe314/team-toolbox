import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { connect } from 'node:net';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join, dirname, basename, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { getGlobalDispatcher } from 'undici';
import {
    resolveUpdateProxySettings, bypassUpdateProxy, createUpdateHttpClient,
    readUpdateText, describeUpdateNetworkError
} from './update-http.js';

const temporary = mkdtempSync(join(tmpdir(), 'tt-update-http-'));
process.env.TT_UPDATE_DIR = join(temporary, 'updates');
const updater = await import('./updater.js');
const originalFetch = globalThis.fetch;
const globalDispatcher = getGlobalDispatcher();
const packageBytes = Buffer.from('isolated update package over a scoped proxy\n'.repeat(2000));
const digest = createHash('sha256').update(packageBytes).digest('hex');
const sockets = new Set();
const tunnels = [];
let origin, proxy, originPort, proxyUrl;

function track(server) {
    server.on('connection', socket => {
        sockets.add(socket);
        socket.on('close', () => sockets.delete(socket));
    });
    return new Promise(resolvePromise => server.listen(0, '127.0.0.1', resolvePromise));
}
before(async () => {
    origin = createServer((req, res) => {
        if (req.url.endsWith('/manifest.json')) {
            const broken = req.url.startsWith('/broken/');
            const bad = req.url.startsWith('/bad/');
            const version = broken ? '9.7.3' : bad ? '9.7.2' : '9.7.1';
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ schema: 1, latest: version, releases: [{
                version, file: broken ? '../broken.zip' : '../redirect.zip',
                sha256: bad ? '0'.repeat(64) : digest, size: packageBytes.length
            }] }));
        } else if (req.url === '/redirect.zip') {
            res.writeHead(302, { Location: 'http://127.0.0.1:' + originPort + '/archive.zip' });
            res.end();
        } else if (req.url === '/archive.zip') {
            res.writeHead(200);
            res.write(packageBytes.subarray(0, 1000));
            setImmediate(() => res.end(packageBytes.subarray(1000)));
        } else if (req.url === '/broken.zip') {
            res.writeHead(200, { 'Content-Length': packageBytes.length });
            res.write(packageBytes.subarray(0, 10));
            setImmediate(() => res.destroy());
        } else if (req.url === '/stall') {
            res.writeHead(200); res.write('x');
        } else if (req.url === '/large') {
            res.write('12345'); res.end('67890');
        } else if (req.url === '/declared-large') {
            res.writeHead(200, { 'Content-Length': 1000 }); res.end('x');
        } else if (req.url === '/ok') res.end('ok');
        else { res.writeHead(404); res.end('not found'); }
    });
    await track(origin); originPort = origin.address().port;
    proxy = createServer((_req, res) => { res.writeHead(502); res.end(); });
    proxy.on('connect', (req, client, head) => {
        tunnels.push(req.url);
        const target = new URL('http://' + req.url);
        if (target.hostname !== 'updates.test' || Number(target.port) !== originPort) {
            client.end('HTTP/1.1 403 Forbidden\r\n\r\n'); return;
        }
        const upstream = connect(originPort, '127.0.0.1', () => {
            client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
            if (head.length) upstream.write(head);
            upstream.pipe(client); client.pipe(upstream);
        });
        sockets.add(upstream);
        upstream.on('close', () => sockets.delete(upstream));
        upstream.on('error', () => client.destroy());
        client.on('error', () => upstream.destroy());
        client.on('close', () => upstream.destroy());
    });
    await track(proxy); proxyUrl = 'http://127.0.0.1:' + proxy.address().port;
});
after(async () => {
    for (const socket of sockets) socket.destroy();
    for (const server of [origin, proxy]) {
        server.closeAllConnections();
        await new Promise(resolvePromise => server.close(resolvePromise));
    }
    assert.equal(globalThis.fetch, originalFetch);
    assert.equal(getGlobalDispatcher(), globalDispatcher);
    assert.equal(dirname(resolve(temporary)), resolve(tmpdir()));
    assert.ok(basename(temporary).startsWith('tt-update-http-'));
    rmSync(temporary, { recursive: true, force: true });
});

function client(env = {}) { return createUpdateHttpClient({ env, platform: 'linux' }); }
async function textVia(request, path, { timeoutMs = 2000, limit = 1024 * 1024, host = 'updates.test' } = {}) {
    return request('http://' + host + ':' + originPort + path, { timeoutMs }, res => readUpdateText(res, limit));
}
async function withUpdaterSource(path, action) {
    const names = ['UPDATE_SOURCE', 'HTTP_PROXY', 'http_proxy', 'HTTPS_PROXY', 'https_proxy', 'ALL_PROXY', 'all_proxy', 'NO_PROXY', 'no_proxy'];
    const saved = Object.fromEntries(names.map(name => [name, process.env[name]]));
    for (const name of names) delete process.env[name];
    process.env.UPDATE_SOURCE = 'http://updates.test:' + originPort + path;
    process.env.HTTP_PROXY = proxyUrl;
    try { return await action(); }
    finally {
        for (const name of names) {
            if (saved[name] === undefined) delete process.env[name]; else process.env[name] = saved[name];
        }
    }
}

describe('更新代理选择与隔离', () => {
    test('环境变量优先，并支持小写和 ALL_PROXY', () => {
        assert.deepEqual(resolveUpdateProxySettings({ http_proxy: '127.0.0.1:8080', HTTPS_PROXY: 'http://127.0.0.1:8081', NO_PROXY: '.internal' },
            { enabled: true, server: '127.0.0.1:1' }),
        { http: 'http://127.0.0.1:8080/', https: 'http://127.0.0.1:8081/', bypass: '.internal' });
        assert.equal(resolveUpdateProxySettings({ ALL_PROXY: 'https://proxy.test:443' }).https, 'https://proxy.test/');
    });
    test('Windows 单代理适用于 HTTP 与 HTTPS', () => {
        assert.deepEqual(resolveUpdateProxySettings({}, { enabled: true, server: '127.0.0.1:7897', bypass: '<local>;*.internal' }),
            { http: 'http://127.0.0.1:7897/', https: 'http://127.0.0.1:7897/', bypass: '<local>;*.internal' });
    });
    test('Windows 分协议端点和环境绕过列表', () => {
        assert.deepEqual(resolveUpdateProxySettings({ NO_PROXY: 'local.test' },
            { enabled: true, server: 'http=proxy.test:80;https=proxy.test:81;socks=ignored:90', bypass: '*.lan' }),
        { http: 'http://proxy.test/', https: 'http://proxy.test:81/', bypass: 'local.test;*.lan' });
    });
    test('禁用 Windows 代理时直连', () => {
        assert.deepEqual(resolveUpdateProxySettings({}, { enabled: false, server: 'invalid' }), { http: '', https: '', bypass: '' });
    });
    test('不支持的代理与恶意地址拒绝且不泄漏凭据', () => {
        for (const value of ['socks5://private-user:secret@proxy.test:1080', 'http://proxy.test/path', 'http://proxy.test/?secret=1']) {
            assert.throws(() => resolveUpdateProxySettings({ HTTPS_PROXY: value }),
                error => error.code === 'update_proxy_invalid' && !/secret|private-user/.test(error.message));
        }
        assert.throws(() => resolveUpdateProxySettings({}, { enabled: true, server: 'socks=proxy.test:1080' }),
            error => error.code === 'update_proxy_invalid');
    });
    test('NO_PROXY 与 Windows 绕过限定主机、域名和端口', () => {
        for (const url of ['http://localhost', 'https://127.2.3.4', 'http://[::1]', 'https://a.internal:80',
            'http://10.2.3.4', 'http://printer', 'https://example.test:8443']) {
            assert.equal(bypassUpdateProxy(url, '.internal;10.*;<local>;example.test:8443'), true, url);
        }
        assert.equal(bypassUpdateProxy('https://example.test:443', 'example.test:8443'), false);
        assert.equal(bypassUpdateProxy('https://evilinternal', '.internal'), false);
        assert.equal(bypassUpdateProxy('https://internal.evil', '.internal'), false);
        assert.equal(bypassUpdateProxy('https://any.test', '*'), true);
    });
    test('环境代理存在时不读取 Windows，不改变全局 fetch/dispatcher', async () => {
        let calls = 0;
        const request = createUpdateHttpClient({ env: { HTTPS_PROXY: proxyUrl }, platform: 'win32',
            getWindowsProxy() { throw new Error('must not read'); },
            async fetchImpl(_url, options) {
                calls++; assert.equal(options.dispatcher.settings.https, proxyUrl + '/');
                assert.ok(options.signal instanceof AbortSignal); return new Response('ok');
            } });
        assert.equal(await request('https://updates.test/ok', { timeoutMs: 1000 }, res => res.text()), 'ok');
        assert.equal(calls, 1); assert.equal(globalThis.fetch, originalFetch); assert.equal(getGlobalDispatcher(), globalDispatcher);
    });
    test('未设环境代理时只读 Windows 设置', async () => {
        let calls = 0;
        const request = createUpdateHttpClient({ env: {}, platform: 'win32',
            async getWindowsProxy(signal) { calls++; assert.ok(signal instanceof AbortSignal); return { enabled: true, server: proxyUrl }; },
            async fetchImpl(_url, options) { assert.equal(options.dispatcher.settings.http, proxyUrl + '/'); return new Response('ok'); } });
        assert.equal(await request('https://updates.test/ok', { timeoutMs: 1000 }, res => res.text()), 'ok');
        assert.equal(calls, 1);
    });
    test('网络错误只返回安全说明，不包含异常原文', () => {
        const result = describeUpdateNetworkError({ message: 'http://private-user:secret@proxy.test', cause: { code: 'ECONNREFUSED' } });
        assert.match(result, /ECONNREFUSED/); assert.doesNotMatch(result, /private-user|secret/);
        assert.match(describeUpdateNetworkError({ name: 'TimeoutError' }), /超时/);
        assert.match(describeUpdateNetworkError({ cause: { code: 'CERT_HAS_EXPIRED' } }), /证书/);
    });
});

describe('更新专用代理与有界 HTTP', () => {
    test('真实 CONNECT 代理读取响应', async () => {
        const count = tunnels.length;
        assert.equal(await textVia(client({ HTTP_PROXY: proxyUrl }), '/ok'), 'ok');
        assert.equal(tunnels.length, count + 1);
    });
    test('重定向到回环后直连，不继续代理', async () => {
        const count = tunnels.length;
        assert.equal(await textVia(client({ HTTP_PROXY: proxyUrl }), '/redirect.zip'), packageBytes.toString());
        assert.equal(tunnels.length, count + 1);
    });
    test('初始回环请求始终直连', async () => {
        const count = tunnels.length;
        assert.equal(await textVia(client({ HTTP_PROXY: proxyUrl }), '/ok', { host: '127.0.0.1' }), 'ok');
        assert.equal(tunnels.length, count);
    });
    test('完整响应体也受超时限制', async () => {
        await assert.rejects(textVia(client({ HTTP_PROXY: proxyUrl }), '/stall', { timeoutMs: 150 }),
            error => ['TimeoutError', 'AbortError'].includes(error.name));
    });
    test('声明过大的清单在读取前拒绝', async () => {
        await assert.rejects(textVia(client({ HTTP_PROXY: proxyUrl }), '/declared-large', { limit: 8 }),
            error => error.code === 'manifest_too_large');
    });
    test('未声明长度的超大清单中途停止', async () => {
        await assert.rejects(textVia(client({ HTTP_PROXY: proxyUrl }), '/large', { limit: 8 }),
            error => error.code === 'manifest_too_large');
    });
    test('代理失败不悄悄切换为直连', async () => {
        await assert.rejects(textVia(client({ HTTP_PROXY: 'http://127.0.0.1:1' }), '/ok', { timeoutMs: 500 }));
    });
    test('更新器的清单和 ZIP 都经过代理并完成 SHA256 校验', async () => {
        await withUpdaterSource('/good', async () => {
            const count = tunnels.length;
            const checked = await updater.checkForUpdate();
            assert.equal(checked.latest, '9.7.1'); assert.equal(checked.hasUpdate, true);
            const downloaded = await updater.downloadUpdate('9.7.1');
            assert.equal(downloaded.sha256, digest); assert.equal(downloaded.size, packageBytes.length);
            assert.deepEqual(readFileSync(downloaded.path), packageBytes);
            assert.equal(tunnels.length, count + 3); // check + 下载重读清单 + ZIP 重定向
        });
    });
    test('代理下载哈希错误丢弃临时文件', async () => {
        await withUpdaterSource('/bad', async () => {
            await assert.rejects(updater.downloadUpdate('9.7.2'), error => error.code === 'checksum_mismatch');
            assert.equal(existsSync(join(temporary, 'updates', '9.7.2', 'package.zip.part')), false);
            assert.equal(existsSync(join(temporary, 'updates', '9.7.2', 'package.zip')), false);
        });
    });
    test('代理下载流断开清理临时文件', async () => {
        await withUpdaterSource('/broken', async () => {
            await assert.rejects(updater.downloadUpdate('9.7.3'), error => error.code === 'download_failed');
            assert.equal(existsSync(join(temporary, 'updates', '9.7.3', 'package.zip.part')), false);
        });
    });
    test('读取失败时保留清晰的 HTTP 错误', async () => {
        await withUpdaterSource('/not-found.json', async () => {
            const result = await updater.checkForUpdate();
            assert.equal(result.error, 'source_unreachable'); assert.match(result.message, /HTTP 404/);
        });
    });
});
