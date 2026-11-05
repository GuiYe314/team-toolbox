import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { crc32, deflateSync } from 'node:zlib';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import express from 'express';
import { inspectScreenPng, runScreenProcess, createAndroidScreen } from './android-screen.js';
import { createAndroidAdbService, AdbError } from './android-adb.js';
import { registerAndroidApi } from './android-api.js';

function chunk(type, content) {
    const buffer = Buffer.alloc(content.length + 12); buffer.writeUInt32BE(content.length); buffer.write(type, 4); content.copy(buffer, 8);
    buffer.writeUInt32BE(crc32(buffer.subarray(4, -4)), buffer.length - 4); return buffer;
}
function png() {
    const header = Buffer.alloc(13); header.writeUInt32BE(2); header.writeUInt32BE(3, 4); header[8] = 8; header[9] = 6;
    const pixels = Buffer.alloc(27, 255); for (let row = 0; row < 3; row++) pixels[row * 9] = 0;
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
}
function fixture(t, options = {}) {
    const f = { data: png(), children: [], calls: [], logs: [], auto: true, devices: [{ serial: 'PHONE_A', state: 'device' }, { serial: 'PHONE_B', state: 'device' }, { serial: 'OFF', state: 'offline' }] };
    f.spawn = (path, args, config) => {
        const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.killed = false;
        child.kill = () => { child.killed = true; child.emit('close', null); return true; };
        f.calls.push({ path, args, config }); f.children.push(child);
        queueMicrotask(() => { if (f.auto) { child.stdout.write(f.data); child.emit('close', 0); } }); return child;
    };
    f.service = createAndroidScreen({ executable: () => 'fixture/adb.exe', readDevices: async () => f.devices, spawnProcess: f.spawn, log: value => f.logs.push(value), ...options });
    t.after(() => f.service.dispose()); return f;
}
async function waitChild(f, count = 1) { for (let attempt = 0; attempt < 10 && f.children.length < count; attempt++) await Promise.resolve(); assert.equal(f.children.length, count); }

test('屏幕 PNG 校验完整字节与 CRC，返回真实宽高', () => {
    assert.deepEqual(inspectScreenPng(png()), { width: 2, height: 3 });
});

test('拒绝文本、错误签名、缺失数据/结束块、截断、CRC 损坏及超大 PNG', () => {
    const original = png(), badCrc = Buffer.from(original); badCrc[30] ^= 255;
    const withoutData = Buffer.concat([original.subarray(0, 33), chunk('IEND', Buffer.alloc(0))]);
    for (const data of [Buffer.from('not png'), Buffer.concat([Buffer.from('invalid!'), original.subarray(8)]), original.subarray(0, -1), original.subarray(0, -12), badCrc, withoutData, Buffer.alloc(16 * 1024 * 1024 + 1)]) assert.throws(() => inspectScreenPng(data), { code: 'invalid_image' });
});

test('屏幕尺寸和像素数均有限制，零尺寸和超大解码面被拒绝', () => {
    for (const [width, height] of [[0, 3], [16385, 1], [8192, 8192]]) {
        const data = png(); data.writeUInt32BE(width, 16); data.writeUInt32BE(height, 20); data.writeUInt32BE(crc32(data.subarray(12, 29)), 29);
        assert.throws(() => inspectScreenPng(data), { code: 'image_limit' });
    }
});

test('截图固定明确设备与只读参数，禁用 Shell/隐藏窗口且原始字节不进入日志', async t => {
    const f = fixture(t), result = await f.service.capture('PHONE_A');
    assert.deepEqual(f.calls[0].args, ['-s', 'PHONE_A', 'exec-out', 'screencap', '-p']);
    assert.equal(f.calls[0].config.shell, false); assert.equal(f.calls[0].config.windowsHide, true); assert.deepEqual(f.calls[0].config.stdio, ['ignore', 'pipe', 'pipe']);
    assert.ok(result.data.equals(f.data)); assert.equal(result.width, 2); assert.equal(result.height, 3); assert.ok(Date.parse(result.capturedAt)); assert.equal(f.logs.length, 0);
});

test('非法、离线、未授权和预先取消的截图目标不会启动截图进程', async t => {
    const f = fixture(t); f.devices.push({ serial: 'UNAUTH', state: 'unauthorized' });
    for (const serial of ['', null, '-s', 'PHONE_A;calc', 'PHONE_A\n']) await assert.rejects(f.service.capture(serial), { code: 'invalid_input' });
    for (const serial of ['OFF', 'UNAUTH', 'UNKNOWN']) await assert.rejects(f.service.capture(serial), { code: 'device_unavailable' });
    await assert.rejects(f.service.capture('PHONE_A', AbortSignal.abort()), { code: 'cancelled' }); assert.equal(f.children.length, 0);
});

test('真实 Node 进程二进制输出保持无损，不使用真实 ADB', async () => {
    const data = png();
    const result = await runScreenProcess(process.execPath, ['-e', `process.stdout.write(Buffer.from('${data.toString('base64')}','base64'))`]);
    assert.ok(result.equals(data)); assert.deepEqual(inspectScreenPng(result), { width: 2, height: 3 });
});

test('二进制与错误输出超限时立即终止进程', async t => {
    const f = fixture(t); f.auto = false;
    const first = runScreenProcess('fixture/adb.exe', [], { spawnProcess: f.spawn, maxBytes: 64 });
    const firstRejected = assert.rejects(first, { code: 'output_limit' }); f.children[0].stdout.write(Buffer.alloc(65)); await firstRejected; assert.equal(f.children[0].killed, true);
    const second = runScreenProcess('fixture/adb.exe', [], { spawnProcess: f.spawn });
    const secondRejected = assert.rejects(second, { code: 'output_limit' }); f.children[1].stderr.write(Buffer.alloc(4097)); await secondRejected; assert.equal(f.children[1].killed, true);
});

test('进程启动和执行失败、无效图片反馈可见原因并允许重试', async t => {
    const f = fixture(t); f.auto = false;
    const first = f.service.capture('PHONE_A'), rejected = assert.rejects(first, { code: 'adb_failed' }); await waitChild(f);
    f.children[0].emit('error', new Error('fixture failure')); await rejected;
    const second = f.service.capture('PHONE_A'), secondRejected = assert.rejects(second, /device offline/); await waitChild(f, 2);
    f.children[1].stderr.write('device offline'); f.children[1].emit('close', 1); await secondRejected;
    f.auto = true; f.data = Buffer.from('invalid image'); await assert.rejects(f.service.capture('PHONE_A'), { code: 'invalid_image' });
    f.data = png(); assert.ok((await f.service.capture('PHONE_A')).data.equals(f.data));
    assert.ok(f.logs.every(value => Object.keys(value).every(key => ['action', 'ok', 'code'].includes(key))));
});

test('截图进程超时会终止并释放占用', async t => {
    const f = fixture(t, { timeoutMs: 30 }); f.auto = false;
    await assert.rejects(f.service.capture('PHONE_A'), { code: 'timeout' }); assert.equal(f.children[0].killed, true);
    f.auto = true; assert.equal((await f.service.capture('PHONE_A')).width, 2);
});

test('总时限也覆盖设备检测，检测超时不会启动截图', async t => {
    const f = fixture(t, { timeoutMs: 30, readDevices: signal => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new AdbError('cancelled', 'cancelled', 499)), { once: true })) });
    await assert.rejects(f.service.capture('PHONE_A'), { code: 'timeout' }); assert.equal(f.children.length, 0);
});

test('请求取消、对应设备变化及销毁终止读取，另一设备不受影响', async t => {
    const f = fixture(t); f.auto = false;
    const controller = new AbortController(), first = f.service.capture('PHONE_A', controller.signal), firstRejected = assert.rejects(first, { code: 'cancelled' });
    await waitChild(f); controller.abort(); await firstRejected; assert.equal(f.children[0].killed, true);
    const second = f.service.capture('PHONE_A'), secondRejected = assert.rejects(second, { code: 'cancelled' }); await waitChild(f, 2);
    f.service.stopDevice('PHONE_B'); assert.equal(f.children[1].killed, false); f.service.stopDevice('PHONE_A'); await secondRejected;
    const third = f.service.capture('PHONE_B'), thirdRejected = assert.rejects(third, { code: 'cancelled' }); await waitChild(f, 3); f.service.dispose(); await thirdRejected;
});

test('并发截图被拒绝，结束后可重新读取且没有后台循环', async t => {
    const f = fixture(t); f.auto = false;
    const first = f.service.capture('PHONE_A'); await waitChild(f);
    await assert.rejects(f.service.capture('PHONE_B'), { code: 'busy' });
    f.children[0].stdout.write(f.data); f.children[0].emit('close', 0); await first;
    f.auto = true; await f.service.capture('PHONE_B'); assert.equal(f.children.length, 2);
});

test('屏幕 API 严格本机来源/请求头/参数，PNG 不缓存，失败为 JSON', async t => {
    const f = fixture(t), app = express(); app.use(express.json()); registerAndroidApi(app, { service: { captureScreen: (...args) => f.service.capture(...args) } });
    const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); })); const base = `http://127.0.0.1:${server.address().port}/api/android/screen`;
    const send = (body, headers = {}) => fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Toolbox-Adb': '1', ...headers }, body: JSON.stringify(body) });
    assert.equal((await send({ serial: 'PHONE_A' }, { Origin: 'https://other.example' })).status, 403);
    assert.equal((await send({ serial: 'PHONE_A' }, { 'X-Toolbox-Adb': '' })).status, 403);
    assert.equal((await send({ serial: 'PHONE_A', command: 'reboot' })).status, 400); assert.equal(f.children.length, 0);
    const response = await send({ serial: 'PHONE_A' }); assert.equal(response.status, 200); assert.match(response.headers.get('content-type'), /^image\/png/); assert.equal(response.headers.get('cache-control'), 'no-store'); assert.equal(response.headers.get('x-content-type-options'), 'nosniff'); assert.ok(Date.parse(response.headers.get('x-screen-captured-at')));
    assert.ok(Buffer.from(await response.arrayBuffer()).equals(f.data));
    f.data = Buffer.from('not png'); const failure = await send({ serial: 'PHONE_A' }); assert.equal(failure.status, 502); assert.equal((await failure.json()).error, 'invalid_image');
});

test('配置变化、目标断开/重启会取消截图，普通命令可同时执行', async t => {
    const directory = mkdtempSync(join(tmpdir(), 'tt-screen-service-'));
    t.after(() => { assert.equal(dirname(resolve(directory)), resolve(tmpdir())); assert.ok(basename(directory).startsWith('tt-screen-service-')); rmSync(directory, { recursive: true, force: true }); });
    const path = join(directory, process.platform === 'win32' ? 'adb.exe' : 'adb'); writeFileSync(path, 'fixture', { mode: 0o700 });
    const f = fixture(t); f.auto = false;
    const service = createAndroidAdbService({ configFile: join(directory, 'config.json'), env: {}, screenSpawn: f.spawn, log: () => {}, runner: async (_path, args) => ({ stdout: args[0] === 'version' ? 'Android Debug Bridge version 1.0.41' : args[0] === 'devices' ? '192.168.1.20:37123 device\n' : args[0] === 'disconnect' ? 'disconnected 192.168.1.20:37123' : 'ok', stderr: '' }) });
    t.after(() => service.dispose()); await service.configure(path);
    const first = service.captureScreen('192.168.1.20:37123'), firstRejected = assert.rejects(first, { code: 'cancelled' }); await waitChild(f);
    assert.equal((await service.executeCommand({ id: 'memory', serial: '192.168.1.20:37123' })).stdout, 'ok'); assert.equal(f.children[0].killed, false);
    await service.configure(''); await firstRejected;
    await service.configure(path); const second = service.captureScreen('192.168.1.20:37123'), secondRejected = assert.rejects(second, { code: 'cancelled' }); await waitChild(f, 2);
    await service.disconnect('192.168.1.20:37123'); await secondRejected;
    const third = service.captureScreen('192.168.1.20:37123'), thirdRejected = assert.rejects(third, { code: 'cancelled' }); await waitChild(f, 3);
    const reboot = (await service.saveCommand({ title: '测试重启', arguments: 'reboot' })).command;
    await service.executeCommand({ id: reboot.id, revision: reboot.revision, serial: '192.168.1.20:37123', confirm: true }); await thirdRejected;
});
