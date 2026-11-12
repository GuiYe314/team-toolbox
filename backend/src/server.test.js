import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDeviceDebuggerApp, readListenOptions } from './server.js';

async function fixture(t, withDist = true) {
    const root = await mkdtemp(join(tmpdir(), 'device-debugger-server-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    if (withDist) { await mkdir(join(root, 'assets')); await writeFile(join(root, 'index.html'), '<main>Device Debugger</main>'); await writeFile(join(root, 'assets/app-abcdefgh.js'), 'export{}'); }
    const calls = { android: 0, unity: 0, logs: [] };
    const { app, dispose } = createDeviceDebuggerApp({ frontendDist: root,
        androidService: { getConfig: () => ({ configured: false }), dispose: () => calls.android++ },
        unityService: { discover: () => ({ devices: [] }), dispose: () => calls.unity++ }, log: message => calls.logs.push(message) });
    t.after(dispose);
    const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
    const base = `http://127.0.0.1:${server.address().port}`;
    return { root, base, calls, dispose, get: path => fetch(base + path), post: (path, body, headers = {}) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body }) };
}

test('Local/Lan默认端口与HOST严格校验', () => {
    assert.deepEqual(readListenOptions({}), { host: '127.0.0.1', port: 3100 });
    assert.deepEqual(readListenOptions({}, true), { host: '0.0.0.0', port: 3100 });
    for (const PORT of ['0', '65536', '-1', '3100x', '1e3']) assert.throws(() => readListenOptions({ PORT }));
    assert.throws(() => readListenOptions({ HOST: '0.0.0.0' }));
    assert.throws(() => readListenOptions({ HOST: '8.8.8.8' }, true));
});

test('健康检查提供独立产品身份和仅两模块，不创建DB或数据目录', async t => {
    const f = await fixture(t, false), response = await f.get('/api/health'), body = await response.json();
    assert.equal(body.status, 'ok'); assert.equal(body.service, 'device-debugger-backend'); assert.equal(body.product, 'device-debugger'); assert.equal(body.version, '0.1.0');
    assert.deepEqual(body.features, ['android', 'unity-logs']); assert.equal(body.db, undefined);
    assert.equal(response.headers.get('cache-control'), 'no-store'); assert.equal(response.headers.get('x-powered-by'), null);
    assert.deepEqual(await readdir(f.root), []);
});

test('独立页面深链可刷新、哈希资产长期缓存，未知API/页面不落入SPA', async t => {
    const f = await fixture(t);
    for (const path of ['/', '/tools', '/tools/android-wireless', '/tools/unity-logs', '/settings']) { const res = await f.get(path); assert.equal(res.status, 200); assert.match(await res.text(), /Device Debugger/); assert.equal(res.headers.get('cache-control'), 'no-cache'); }
    const asset = await f.get('/assets/app-abcdefgh.js'); assert.equal(asset.status, 200); assert.match(asset.headers.get('cache-control'), /immutable/);
    for (const path of ['/api/documents', '/api/assets', '/api/update/check', '/api/integrations/config', '/api/network-speed/snapshot']) { const res = await f.get(path); assert.equal(res.status, 404); assert.equal((await res.json()).error, 'not_found'); }
    for (const path of ['/assets/missing.js', '/tools/earth-sunlight', '/not-a-page', '/.env']) assert.equal((await f.get(path)).status, 404);
});

test('没有构建产物时页面404，设备API仍可用', async t => {
    const f = await fixture(t, false); assert.equal((await f.get('/tools')).status, 404);
    assert.deepEqual(await (await f.get('/api/android/config')).json(), { configured: false });
});

test('保留同源与专用头保护，不放宽Lan请求', async t => {
    const f = await fixture(t);
    assert.equal((await f.post('/api/unity-logs/discover', '{}')).status, 403);
    assert.equal((await f.post('/api/unity-logs/discover', '{}', { 'X-Toolbox-Unity-Log': '1', Origin: 'https://evil.invalid' })).status, 403);
    assert.equal((await f.post('/api/android/persistent/list', '{}', { Origin: 'https://evil.invalid', 'X-Toolbox-Adb': '1' })).status, 403);
    assert.equal((await f.post('/api/unity-logs/discover', '{}', { 'X-Toolbox-Unity-Log': '1' })).status, 200);
});

test('无效或过量JSON明确反馈，不泄漏请求正文', async t => {
    const f = await fixture(t);
    for (const [body, status] of [['{"private":"secret",', 400], [JSON.stringify({ private: 'x'.repeat(70000) }), 413]]) {
        const response = await f.post('/api/unity-logs/discover', body, { 'X-Toolbox-Unity-Log': '1' }); assert.equal(response.status, status); assert.equal((await response.json()).message.includes('private'), false);
    }
});

test('dispose幂等清理两个模块', async t => {
    const f = await fixture(t); f.dispose(); f.dispose(); assert.equal(f.calls.android, 1); assert.equal(f.calls.unity, 1);
});
