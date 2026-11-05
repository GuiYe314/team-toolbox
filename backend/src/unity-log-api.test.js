import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { once } from 'node:events';
import { Readable } from 'node:stream';
import { registerUnityLogApi, requireLocalUnityLogRequest } from './unity-log-api.js';
import { UnityLogError } from './unity-log-http.js';

test('日志 API 拒绝远端、代理头伪装、非法 Host/来源和缺少专用头', () => {
    const base = { headers: { host: 'localhost:3000', 'x-toolbox-unity-log': '1' }, socket: { remoteAddress: '127.0.0.1' }, is: () => true };
    function check(patch) {
        const req = { ...base, ...patch, get: name => ({ ...base.headers, ...patch.headers })[name] }; let accepted = false, status;
        requireLocalUnityLogRequest(req, { status(n) { status = n; return this; }, json() {}, setHeader() {} }, () => { accepted = true; });
        return { accepted, status };
    }
    assert.equal(check({}).accepted, true);
    for (const patch of [{ socket: { remoteAddress: '192.168.1.2' } }, { headers: { host: 'attacker.test', 'x-toolbox-unity-log': '1' } },
        { headers: { origin: 'https://attacker.test', 'x-toolbox-unity-log': '1' } }, { headers: { 'sec-fetch-site': 'cross-site', 'x-toolbox-unity-log': '1' } },
        { headers: { 'x-toolbox-unity-log': undefined } }, { is: () => false }]) assert.equal(check(patch).status, 403);
});
async function setup(t, service) {
    const app = express(); app.use(express.json()); registerUnityLogApi(app, { service });
    const server = app.listen(0, '127.0.0.1'); await once(server, 'listening'); t.after(() => { server.closeAllConnections(); server.close(); });
    return (path, body = {}, extra = {}) => fetch(`http://127.0.0.1:${server.address().port}/api/unity-logs${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Toolbox-Unity-Log': '1' }, body: JSON.stringify(body), ...extra });
}
test('API 只接受明确字段，返回发现、历史预览与会话关闭结果', async t => {
    const calls = [];
    const request = await setup(t, { discover: async args => { calls.push(args); return { devices: [] }; }, connect: async id => ({ id }), files: async () => ({ files: [] }),
        preview: async () => ({ text: '中文堆栈', truncated: false }), close: () => ({ closed: true }) });
    assert.equal((await request('/discover')).status, 200);
    assert.equal((await request('/discover', { url: 'http://8.8.8.8' })).status, 400);
    assert.equal((await request('/sessions', { deviceId: 'x', ticket: 'secret' })).status, 400);
    assert.equal((await (await request('/sessions/id/preview', { name: 'x' })).json()).text, '中文堆栈');
    assert.equal((await request('/sessions/id/files')).status, 200); assert.equal((await request('/sessions/id/close')).status, 200);
    assert.deepEqual(calls, [{ port: 17523, address: '' }]);
});
test('下载流响应不缓存，错误明确反馈且不泄露内部异常', async t => {
    const request = await setup(t, { download: async (_id, _name, archive) => ({ stream: Readable.from(['中文日志']), name: archive ? 'logs.zip' : 'logs.log', contentType: archive ? 'application/zip' : 'text/plain', length: null }),
        files: async () => { throw new UnityLogError('file_missing', '已清理', 404); } });
    const response = await request('/sessions/id/download', { archive: false, name: 'x' });
    assert.equal(response.headers.get('cache-control'), 'no-store'); assert.equal(await response.text(), '中文日志');
    assert.equal(response.headers.get('content-disposition'), 'attachment; filename="logs.log"');
    const missing = await request('/sessions/id/files'); assert.equal(missing.status, 404); assert.equal((await missing.json()).message, '已清理');
    assert.equal((await request('/sessions/id/download', { archive: 'yes' })).status, 400);
});

test('浏览器取消连接后回收尚未返回的读取会话', { timeout: 5000 }, async t => {
    const controller = new AbortController();
    let enter, finish;
    const entered = new Promise(resolve => { enter = resolve; });
    const closed = new Promise(resolve => { finish = resolve; });
    const request = await setup(t, {
        connect: async (_id, signal) => {
            enter();
            await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }));
            return { id: 'created-session' };
        },
        close: id => finish(id)
    });
    const pending = request('/sessions', { deviceId: 'test-device' }, { signal: controller.signal });
    await entered;
    controller.abort();
    await assert.rejects(pending, { name: 'AbortError' });
    assert.equal(await closed, 'created-session');
});
