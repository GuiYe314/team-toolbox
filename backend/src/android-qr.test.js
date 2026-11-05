import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createAndroidQrPairing } from './android-qr.js';
import { AdbError } from './android-adb-protocol.js';
import { registerAndroidApi } from './android-api.js';

function fixture(t) {
    let time = Date.now();
    const state = { scanned: false, paired: false, connected: false, otherOnly: false, ambiguous: false, autoConnect: false, guid: true, discoveryFails: false, pairFails: false, connectFails: false, refreshFails: false };
    const calls = []; const logs = [];
    let credentials;
    const qr = createAndroidQrPairing({ now: () => time, log: (entry) => logs.push(entry), run: async (args, options) => {
        calls.push({ args, options });
        let stdout = '';
        if (args[0] === 'version') stdout = 'Android Debug Bridge version 1.0.41';
        if (args[0] === 'mdns') {
            if (state.discoveryFails) throw new AdbError('adb_failed', '无线搜索失败', 502);
            stdout = 'other-phone _adb-tls-pairing._tcp 192.168.1.50:40000\nother-phone _adb-tls-connect._tcp 192.168.1.50:45000\n';
            if (state.scanned && !state.otherOnly) stdout += `${credentials.name} _adb-tls-pairing._tcp 192.168.1.20:41001\n`;
            if (state.paired) stdout += 'adb-target _adb-tls-connect._tcp 192.168.1.20:37123\n';
            if (state.ambiguous) stdout += 'adb-second _adb-tls-connect._tcp 192.168.1.20:37124\n';
        }
        if (args[0] === 'pair') {
            assert.deepEqual(args, ['pair', '192.168.1.20:41001']);
            assert.equal(options.input, credentials.password + '\n');
            assert.ok(!args.includes(credentials.password)); assert.deepEqual(options.secrets, [credentials.password]);
            if (state.pairFails) throw new Error(`pair failed ${credentials.password}`);
            state.paired = true;
            if (state.autoConnect) state.connected = true;
            stdout = 'Successfully paired to 192.168.1.20:41001' + (state.guid ? ' [guid=adb-target]' : '');
        }
        if (args[0] === 'devices') {
            if (state.refreshFails && state.connected) throw new AdbError('adb_failed', '设备读取失败', 502);
            stdout = 'USB123 device\n192.168.1.50:45000 device\n' + (state.connected ? 'adb-target._adb-tls-connect._tcp device model:Pixel_9\n' : '');
        }
        if (args[0] === 'connect') {
            if (state.connectFails) return { stdout: 'failed to connect', stderr: '' };
            state.connected = true; stdout = 'connected to ' + args[1];
        }
        return { stdout, stderr: '' };
    } });
    t.after(() => qr.invalidate());
    return { qr, state, calls, logs, expire() { time += 120001; }, async start() {
        const result = await qr.start();
        const match = /^WIFI:T:ADB;S:([A-Za-z0-9-]+);P:([a-f0-9]{32});;$/.exec(result.payload);
        assert.ok(match, 'Android 原生扫码协议');
        credentials = { name: match[1], password: match[2] };
        return result;
    }, get credentials() { return credentials; } };
}

test('二维码使用随机 Android 协议凭据，仅创建响应含 payload；不会配对其他服务', async (t) => {
    const f = fixture(t); const session = await f.start();
    assert.equal(session.state, 'waiting'); assert.equal(session.expiresAt > Date.now(), true);
    f.state.scanned = true; f.state.otherOnly = true;
    const result = await f.qr.poll(session.id);
    assert.equal(result.state, 'waiting'); assert.ok(!('payload' in result));
    assert.equal(f.calls.filter((call) => call.args[0] === 'pair').length, 0);
    assert.ok(!JSON.stringify(result).includes(f.credentials.password));
});

test('扫描后以 stdin 配对，自动连接同一手机并刷新；不操作另一台设备', async (t) => {
    const f = fixture(t); const session = await f.start(); f.state.scanned = true;
    assert.equal((await f.qr.poll(session.id)).state, 'connecting');
    const result = await f.qr.poll(session.id);
    assert.equal(result.state, 'connected'); assert.equal(result.devices.length, 3);
    assert.deepEqual(f.calls.find((call) => call.args[0] === 'connect').args, ['connect', '192.168.1.20:37123']);
    assert.ok(!JSON.stringify(result).includes(f.credentials.password)); assert.ok(!JSON.stringify(f.logs).includes(f.credentials.password));
    const count = f.calls.length; await f.qr.poll(session.id); assert.equal(f.calls.length, count);
});

test('ADB 已自动连接目标手机时不重复发送 connect', async (t) => {
    const f = fixture(t); const session = await f.start(); f.state.scanned = true; f.state.autoConnect = true;
    await f.qr.poll(session.id);
    assert.equal((await f.qr.poll(session.id)).state, 'connected');
    assert.equal(f.calls.some((call) => call.args[0] === 'connect'), false);
});

test('同一 IP 多个连接服务且缺少 GUID 时等待选择，不误连', async (t) => {
    const f = fixture(t); const session = await f.start(); f.state.scanned = true; f.state.ambiguous = true; f.state.guid = false;
    await f.qr.poll(session.id);
    assert.equal((await f.qr.poll(session.id)).state, 'connecting');
    assert.equal(f.calls.some((call) => call.args[0] === 'connect'), false);
});

test('配对失败回显口令被隐藏，结束后不再执行 ADB', async (t) => {
    const f = fixture(t); const session = await f.start(); f.state.scanned = true; f.state.pairFails = true;
    const result = await f.qr.poll(session.id);
    assert.equal(result.state, 'failed'); assert.ok(!JSON.stringify(result).includes(f.credentials.password));
    assert.match(result.message, /已隐藏/); assert.ok(!JSON.stringify(f.logs).includes(f.credentials.password));
    const count = f.calls.length; await f.qr.poll(session.id); assert.equal(f.calls.length, count);
});

test('二维码取消、过期、重建均撤销旧会话', async (t) => {
    const f = fixture(t); let session = await f.start();
    assert.equal(f.qr.cancel(session.id).state, 'cancelled');
    let count = f.calls.length; assert.equal((await f.qr.poll(session.id)).state, 'cancelled'); assert.equal(f.calls.length, count);
    const old = session; session = await f.start(); assert.notEqual(session.payload, old.payload);
    await assert.rejects(f.qr.poll(old.id), { code: 'invalid_session' });
    f.expire(); count = f.calls.length;
    assert.equal((await f.qr.poll(session.id)).state, 'expired'); assert.equal(f.calls.length, count);
    f.qr.invalidate(); await assert.rejects(f.qr.poll(session.id), { code: 'invalid_session' });
});

test('配对后过期或连接失败不会误报配对失败', async (t) => {
    const f = fixture(t); let session = await f.start(); f.state.scanned = true;
    await f.qr.poll(session.id); f.expire();
    assert.match((await f.qr.poll(session.id)).message, /配对成功.*连接超时/);
    session = await f.start(); f.state.connectFails = true; f.state.connected = false;
    await f.qr.poll(session.id);
    const result = await f.qr.poll(session.id); assert.equal(result.state, 'failed'); assert.match(result.message, /手机已配对/);
});

test('搜索失败明确终止扫码；连接成功但刷新失败明确说明', async (t) => {
    const f = fixture(t); let session = await f.start(); f.state.discoveryFails = true;
    assert.equal((await f.qr.poll(session.id)).state, 'failed');
    f.state.discoveryFails = false; f.state.scanned = true; session = await f.start();
    await f.qr.poll(session.id); f.state.refreshFails = true;
    const result = await f.qr.poll(session.id);
    assert.equal(result.state, 'connected'); assert.equal(result.devices, null); assert.match(result.warning, /刷新失败/);
});

test('扫码会话取消可终止正在等待的 ADB，取消后不连接', async (t) => {
    let entered;
    const started = new Promise((resolvePromise) => { entered = resolvePromise; });
    const qr = createAndroidQrPairing({ run: async (args, options) => {
        if (args[0] === 'version') return { stdout: 'Android Debug Bridge version 1.0.41' };
        entered();
        return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new AdbError('cancelled', '取消')), { once: true }));
    } });
    t.after(() => qr.invalidate());
    const session = await qr.start(); const poll = qr.poll(session.id);
    await started; qr.cancel(session.id);
    assert.equal((await poll).state, 'cancelled');
});

test('扫码及搜索接口继承本机/专用请求头边界；创建和轮询不返回多余口令', async (t) => {
    const f = fixture(t); const app = express(); app.use(express.json());
    registerAndroidApi(app, { service: { startQr: () => f.start(), pollQr: (id, signal) => f.qr.poll(id, signal), cancelQr: (id) => f.qr.cancel(id), searchFolder: async (folder) => ({ directory: folder, candidates: [] }) } });
    const server = await new Promise((resolvePromise) => { const s = app.listen(0, '127.0.0.1', () => resolvePromise(s)); });
    t.after(() => server.close());
    const base = `http://127.0.0.1:${server.address().port}/api/android`;
    const post = (path, data = {}, origin) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Toolbox-Adb': '1', ...(origin ? { Origin: origin } : {}) }, body: JSON.stringify(data) });
    assert.equal((await post('/qr', {}, 'https://example.com')).status, 403);
    assert.equal((await fetch(base + '/qr', { method: 'POST' })).status, 403);
    const created = await (await post('/qr')).json(); assert.ok(created.payload);
    const polled = await (await post(`/qr/${created.id}/poll`)).json(); assert.equal(polled.state, 'waiting'); assert.equal(polled.payload, undefined);
    assert.equal((await (await post(`/qr/${created.id}/cancel`)).json()).state, 'cancelled');
    assert.equal((await post('/search-folder', { folder: 'C:/Android' }, 'https://example.com')).status, 403);
    assert.deepEqual((await (await post('/search-folder', { folder: 'C:/Android' })).json()).candidates, []);
});
