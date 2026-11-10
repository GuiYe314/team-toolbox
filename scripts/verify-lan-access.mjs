// 临时后端 + 真实 Vite 配置；不加载数据库、不执行 ADB、不搜索设备。
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createServer } from '../frontend/node_modules/vite/dist/node/index.js';
import { createToolAccess } from '../backend/src/tool-access.js';
import { registerAndroidApi } from '../backend/src/android-api.js';
import { registerUnityLogApi } from '../backend/src/unity-log-api.js';
import { registerIntegrationApi } from '../backend/src/integration-api.js';
import { toolAccessPlugin } from '../frontend/tool-access-plugin.js';

const require = createRequire(new URL('../backend/package.json', import.meta.url)), express = require('express');
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const access = createToolAccess({ allowLan: true }), address = access.addresses()[0];
assert.ok(address, '局域网验收需要实际私网 IPv4 网卡');
let passed = 0, front, localFront;
const app = express(); app.use(access.middleware); app.use(express.json());
const calls = [];
registerAndroidApi(app, { access, service: { getConfig: () => ({ fixture: 'adb' }), discover: () => { calls.push('adb'); return { items: [] }; } } });
registerUnityLogApi(app, { access, service: { discover: () => { calls.push('unity'); return { items: [] }; } } });
registerIntegrationApi(app, { access, log() {}, service: { freellmapi: { getConfig: () => ({ fixture: 'free' }) } } });
const back = await new Promise(resolve => { const value = app.listen(0, '0.0.0.0', () => resolve(value)); });
const saved = Object.fromEntries(['PORT', 'VITE_DEV_HOST', 'TOOLBOX_ALLOW_LAN'].map(name => [name, process.env[name]]));
const get = (url, options = {}) => new Promise((resolve, reject) => {
    const operation = request(url, { localAddress: address, ...options }, response => {
        let text = ''; response.setEncoding('utf8'); response.on('data', part => { text += part; });
        response.on('end', () => resolve({ status: response.statusCode, text }));
    });
    operation.setTimeout(5000, () => operation.destroy(new Error('LAN request timed out')));
    operation.on('error', reject); operation.end(options.method === 'POST' ? '{}' : undefined);
});
async function check(name, fn) { await fn(); console.log('PASS ' + name); passed++; }
try {
    process.env.PORT = String(back.address().port); process.env.VITE_DEV_HOST = '0.0.0.0'; process.env.TOOLBOX_ALLOW_LAN = '1';
    front = await createServer({ root: join(root, 'frontend'), configFile: join(root, 'frontend/vite.config.js'), server: { host: '0.0.0.0', port: 0 }, logLevel: 'error' });
    await front.listen();
    const base = `http://${address}:${front.httpServer.address().port}`;
    await check('真实 LAN TCP 可打开 Vite 页面与前端模块', async () => {
        assert.match((await get(base + '/')).text, /id="app"/);
        assert.equal((await get(base + '/src/main.js')).status, 200);
    });
    await check('真实配置使用自定义后端端口并保留 LAN Host', async () => {
        for (const [path, fixture] of [['/api/android/config', 'adb'], ['/api/integrations/freellmapi/config', 'free']]) {
            const result = await get(base + path); assert.equal(result.status, 200, result.text); assert.equal(JSON.parse(result.text).fixture, fixture);
        }
    });
    await check('ADB 与 Unity 同源 POST 经真实开发代理可用', async () => {
        for (const [path, header] of [['/api/android/discover', 'X-Toolbox-Adb'], ['/api/unity-logs/discover', 'X-Toolbox-Unity-Log']]) {
            const result = await get(base + path, { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json', [header]: '1' } });
            assert.equal(result.status, 200, result.text);
        }
        assert.deepEqual(calls, ['adb', 'unity']);
    });
    await check('开发代理拒绝跨站、陌生 Host 和伪造转发头', async () => {
        for (const headers of [{ Origin: 'https://evil.example' }, { Host: 'evil.example', 'X-Forwarded-Host': new URL(base).host }, { 'Sec-Fetch-Site': 'cross-site' }]) assert.equal((await get(base + '/api/android/config', { headers })).status, 403);
    });
    await check('跨站 WebSocket 在 Vite 升级前被拒绝，HTTP 服务仍可用', async () => {
        const status = await new Promise((resolve, reject) => {
            const operation = request(base, { localAddress: address, headers: { Origin: 'https://evil.example', Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Key': 'dG9vbGJveC10ZXN0LWtleQ==', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Protocol': 'vite-hmr' } }, response => { response.resume(); resolve(response.statusCode); });
            operation.once('upgrade', (_response, socket) => { socket.destroy(); reject(new Error('跨站升级被意外接受')); });
            operation.on('error', reject); operation.setTimeout(5000, () => operation.destroy(new Error('Upgrade timed out'))); operation.end();
        });
        assert.equal(status, 403); assert.equal((await get(base + '/')).status, 200);
    });
    await check('Vite 在代理之前拒绝非本网段真实来源', async () => {
        // 注入网卡仅用于模拟另一网段，TCP 仍使用真实 LAN 地址，转发头不能洗来源。
        localFront = await createServer({ root: join(root, 'frontend'), configFile: false, plugins: [toolAccessPlugin({ allowLan: true, interfaces: () => ({ other: [{ family: 'IPv4', address: '10.254.1.10', netmask: '255.255.255.0' }] }) })], server: { host: '0.0.0.0', port: 0, proxy: { '/api': { target: `http://127.0.0.1:${back.address().port}`, changeOrigin: false } } }, logLevel: 'error' });
        await localFront.listen();
        const baseOther = `http://${address}:${localFront.httpServer.address().port}`;
        const result = await get(baseOther + '/api/android/config', { headers: { Host: '10.254.1.10', 'X-Forwarded-For': '10.254.1.11' } });
        assert.equal(result.status, 403); await localFront.close(); localFront = null;
    });
    await check('Local 模式即使误绑定所有网卡也拒绝 LAN', async () => {
        localFront = await createServer({ root: join(root, 'frontend'), configFile: false, plugins: [toolAccessPlugin({ allowLan: false })], server: { host: '0.0.0.0', port: 0 }, logLevel: 'error' });
        await localFront.listen();
        assert.equal((await get(`http://${address}:${localFront.httpServer.address().port}/`)).status, 403);
    });
    console.log(`${passed}/${passed} LAN proxy checks passed`);
} finally {
    await localFront?.close(); await front?.close();
    await new Promise(resolve => { back.close(resolve); back.closeAllConnections(); });
    for (const [name, value] of Object.entries(saved)) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
}
