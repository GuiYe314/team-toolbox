import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { Readable, PassThrough } from 'node:stream';
import express from 'express';
import { createAndroidApkQueue, validateApkQueue, APK_QUEUE_MAX_BYTES } from './android-apk-queue.js';
import { createAndroidAdbService, AdbError } from './android-adb.js';
import { registerAndroidApi } from './android-api.js';
import { apkFixture } from '../test-support/apk-fixture.js';

const packages = [apkFixture({ packageName: 'com.example.first' }), apkFixture({ packageName: 'com.example.second' })];
const metadata = (serials = ['PHONE_A', 'PHONE_B']) => ({ confirm: true, serials, files: packages.map((bytes, i) => ({ fileName: `应用${i + 1}.apk`, size: bytes.length })) });
function payload(value = metadata(), contents = packages) { const header = Buffer.from(JSON.stringify(value)), prefix = Buffer.alloc(8); prefix.write('TTAP'); prefix.writeUInt32BE(header.length, 4); return Buffer.concat([prefix, header, ...contents]); }
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check) { for (let i = 0; i < 300; i++) { if (check()) return; await delay(5); } throw new Error('queue fixture timed out'); }
async function fixture(t, options = {}) {
    const root = await mkdtemp(join(tmpdir(), 'tt-apk-queue-'));
    const f = { root, calls: [], events: [], logs: [], devices: ['PHONE_A', 'PHONE_B', 'PHONE_C'].map(serial => ({ serial, state: 'device' })) };
    f.execute = async () => ({ stdout: 'Success\n', stderr: '' });
    f.queue = createAndroidApkQueue({ temporaryBase: root, ...options, log: entry => f.logs.push(entry), readDevices: async signal => { if (signal.aborted) throw new Error('aborted'); return f.devices; }, run: async (args, settings) => { f.calls.push(args); return f.execute(args, settings); } });
    f.install = (value = metadata(), contents = packages, signal) => { const body = payload(value, contents); return f.queue.install(Readable.from(Array.from({ length: Math.ceil(body.length / 7) }, (_, i) => body.subarray(i * 7, i * 7 + 7))), body.length, signal, event => f.events.push(event)); };
    f.clean = async () => assert.deepEqual(await readdir(root), []);
    t.after(async () => { f.queue.dispose(); await rm(root, { recursive: true, force: true }); });
    return f;
}

test('多包元数据只接受确认的有界文件/设备与精确任务矩阵', () => {
    assert.equal(validateApkQueue(metadata()).jobs.length, 4);
    for (const change of [{ confirm: false }, { confirm: 'true' }, { serials: [] }, { serials: ['PHONE_A', 'PHONE_A'] }, { serials: ['-s'] }, { serials: Array.from({ length: 21 }, (_, i) => 'P' + i) }, { files: [] }, { files: Array(21).fill(metadata().files[0]) }, { files: [{ fileName: '../evil.apk', size: 1 }] }, { files: [{ fileName: 'a.apks', size: 1 }] }, { files: [{ fileName: 'a.apk', size: 0 }] }, { files: [{ fileName: 'a.apk', size: 1024 ** 3 + 1 }] }, { args: [] }, { jobs: [] }, { jobs: [{ serial: 'PHONE_C', fileIndex: 0 }] }, { jobs: [{ serial: 'PHONE_A', fileIndex: -1 }] }, { jobs: [{ serial: 'PHONE_A', fileIndex: 2 }] }]) assert.throws(() => validateApkQueue({ ...metadata(), ...change }), AdbError);
    assert.throws(() => validateApkQueue({ ...metadata(['PHONE_A']), jobs: [{ serial: 'PHONE_A', fileIndex: 0 }, { serial: 'PHONE_A', fileIndex: 0 }] }), AdbError);
    assert.throws(() => validateApkQueue({ ...metadata(), files: Array(5).fill({ fileName: 'a.apk', size: 1024 ** 3 }) }), { code: 'file_limit' });
});

test('单设备按所选文件顺序安装，每包只暂存一次，结果与安全日志完整', async t => {
    const f = await fixture(t);
    f.execute = async (args, options) => { assert.deepEqual(args.slice(0, 4), ['-s', 'PHONE_A', 'install', '-r']); assert.equal(args.length, 5); assert.deepEqual(await readFile(args[4]), packages[Number(basename(args[4]).split('.')[0])]); assert.equal(options.timeoutMs, 300000); assert.equal(options.maxBytes, 65536); return { stdout: 'Success\n' + args[4], stderr: '' }; };
    const result = await f.install(metadata(['PHONE_A']));
    assert.equal(result.total, 2); assert.equal(result.succeeded, 2); assert.deepEqual(f.calls.map(args => basename(args[4])), ['0.apk', '1.apk']);
    assert.equal(f.events.filter(event => event.type === 'device' && event.result.status === 'success').length, 2);
    assert.ok(f.events.every(event => !JSON.stringify(event).includes(f.root))); assert.ok(f.logs.every(entry => !JSON.stringify(entry).includes('应用'))); await f.clean();
});

test('最多两设备并行，同设备不重叠，三台复用相同暂存包', async t => {
    const f = await fixture(t); let active = 0, peak = 0; const current = new Set(), order = {};
    f.execute = async args => { const serial = args[1]; assert.ok(!current.has(serial)); current.add(serial); peak = Math.max(peak, ++active); (order[serial] ||= []).push(basename(args[4])); await delay(20); active--; current.delete(serial); return { stdout: 'Success', stderr: '' }; };
    const result = await f.install(metadata(['PHONE_A', 'PHONE_B', 'PHONE_C']));
    assert.equal(peak, 2); assert.equal(result.succeeded, 6); for (const serial of ['PHONE_A', 'PHONE_B', 'PHONE_C']) assert.deepEqual(order[serial], ['0.apk', '1.apk']);
    for (const index of ['0.apk', '1.apk']) assert.equal(new Set(f.calls.filter(args => basename(args[4]) === index).map(args => args[4])).size, 1); await f.clean();
});

test('失败安装项继续，精确失败矩阵不重复成功组合', async t => {
    const f = await fixture(t); f.execute = async args => ({ stdout: args[1] === 'PHONE_A' && basename(args[4]) === '0.apk' || args[1] === 'PHONE_B' && basename(args[4]) === '1.apk' ? 'Failure [INSTALL_FAILED_TEST]' : 'Success', stderr: '' });
    let result = await f.install(); assert.equal(result.succeeded, 2); assert.equal(result.failed, 2);
    const failed = f.events.filter(event => event.type === 'device' && event.result.status === 'failed').map(event => ({ serial: event.result.serial, fileIndex: event.result.fileIndex }));
    f.calls = []; f.execute = async () => ({ stdout: 'Success', stderr: '' });
    result = await f.install({ ...metadata(), jobs: failed }); assert.equal(result.succeeded, 2);
    assert.deepEqual(f.calls.map(args => [args[1], basename(args[4])]).sort(), [['PHONE_A', '0.apk'], ['PHONE_B', '1.apk']]); await f.clean();
});

test('离线设备逐项失败，其他设备继续；全部离线时拒绝安装', async t => {
    const f = await fixture(t); f.devices = [{ serial: 'PHONE_B', state: 'device' }];
    const result = await f.install(); assert.equal(result.failed, 2); assert.equal(result.succeeded, 2); assert.ok(f.calls.every(args => args[1] === 'PHONE_B'));
    f.devices = []; await assert.rejects(f.install(), { code: 'device_unavailable' }); await f.clean();
});

test('先校验全部APK，后一个坏包不会先安装前一个；超量/截断/尾随字节拒绝', async t => {
    const f = await fixture(t);
    const invalidBytes = Buffer.from('broken'), value = metadata(); value.files[1].size = invalidBytes.length;
    await assert.rejects(f.install(value, [packages[0], invalidBytes]), { code: 'invalid_apk' }); assert.equal(f.calls.length, 0);
    for (const body of [payload().subarray(0, 5), payload().subarray(0, -1), Buffer.concat([payload(), Buffer.from('tail')])]) await assert.rejects(f.queue.install(Readable.from([body]), body.length));
    const hugeHeader = Buffer.alloc(8); hugeHeader.write('TTAP'); hugeHeader.writeUInt32BE(65537, 4); await assert.rejects(f.queue.install(Readable.from([hugeHeader]), 100));
    await assert.rejects(f.queue.install(Readable.from([]), APK_QUEUE_MAX_BYTES + 65545)); assert.equal(f.calls.length, 0); await f.clean();
});

test('单项超时继续下一APK，不误报成功', async t => {
    const f = await fixture(t, { installTimeoutMs: 30 });
    f.execute = (args, { signal }) => basename(args[4]) === '0.apk' ? new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('timeout')), { once: true })) : Promise.resolve({ stdout: 'Success', stderr: '' });
    const result = await f.install(metadata(['PHONE_A'])); assert.equal(result.failed, 1); assert.equal(result.succeeded, 1);
    assert.equal(f.events.find(event => event.result?.status === 'failed').result.code, 'timeout'); await f.clean();
});

test('取消同时中止两线程，等待退出后才清理且不执行后续文件/设备', async t => {
    const f = await fixture(t), controller = new AbortController(); let aborted = 0;
    f.execute = (args, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => { aborted++; setTimeout(() => { assert.ok(existsSync(args[4])); reject(new Error('cancelled')); }, 20); }, { once: true }));
    const operation = f.install(metadata(['PHONE_A', 'PHONE_B', 'PHONE_C']), packages, controller.signal);
    await until(() => f.calls.length === 2); controller.abort(); await assert.rejects(operation, { code: 'cancelled' }); assert.equal(aborted, 2); assert.equal(f.calls.length, 2); await f.clean();
    f.execute = async () => ({ stdout: 'Success', stderr: '' }); assert.equal((await f.install(metadata(['PHONE_A']))).succeeded, 2); await f.clean();
});

test('上传与整队列时限、dispose和独占锁均能回收临时包', async t => {
    const f = await fixture(t, { uploadTimeoutMs: 30, queueTimeoutMs: 40 });
    const input = new PassThrough(); await assert.rejects(f.queue.install(input, payload().length), { code: 'timeout' }); input.destroy(); await f.clean();
    f.execute = (_args, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('abort')), { once: true }));
    await assert.rejects(f.install(), { code: 'timeout' }); await f.clean();
    const running = f.install(); await until(() => f.calls.length >= 4); await assert.rejects(f.install(), { code: 'busy' }); f.queue.dispose(); await assert.rejects(running, { code: 'cancelled' }); await f.clean();
});

test('HTTP二进制精确端点、专用头/确认/同源校验、实时事件与ADB服务锁', async t => {
    const root = await mkdtemp(join(tmpdir(), 'tt-apk-queue-api-')), executable = join(root, process.platform === 'win32' ? 'adb.exe' : 'adb'); await writeFile(executable, 'offline', { mode: 0o700 });
    let installs = 0; const service = createAndroidAdbService({ configFile: join(root, 'settings.json'), env: {}, apkOptions: { temporaryBase: root }, log: () => {}, runner: async (_exe, args) => ({ stdout: args[0] === 'version' ? 'Android Debug Bridge version 1.0.41' : args[0] === 'devices' ? 'PHONE_A device\nPHONE_B device\n' : (++installs, 'Success'), stderr: '' }) });
    await service.configure(executable); const app = express(); app.use(express.json()); registerAndroidApi(app, { service }); const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
    t.after(async () => { service.dispose(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true }); });
    const base = `http://127.0.0.1:${server.address().port}`, bytes = payload(), headers = { 'Content-Type': 'application/octet-stream', 'X-Toolbox-Adb': '1', 'X-Toolbox-Adb-Confirm': '1' };
    for (const [changes, path, status] of [[{ 'X-Toolbox-Adb': '' }, '', 403], [{ Origin: 'https://evil.invalid' }, '', 403], [{ 'X-Toolbox-Adb-Confirm': '' }, '', 400], [{}, '?extra=1', 400]]) { const response = await fetch(base + '/api/android/apk/install-many' + path, { method: 'POST', headers: { ...headers, ...changes }, body: bytes }); assert.equal(response.status, status); await response.text(); }
    const response = await fetch(base + '/api/android/apk/install-many', { method: 'POST', headers, body: bytes }); assert.equal(response.status, 200); assert.match(response.headers.get('content-type'), /ndjson/);
    const events = (await response.text()).trim().split('\n').map(line => JSON.parse(line)); assert.equal(events.filter(event => event.result?.status === 'success').length, 4); assert.equal(events.at(-1).result.succeeded, 4); assert.equal(installs, 4);
    assert.deepEqual((await readdir(root)).filter(name => name.startsWith('team-toolbox-apk-')), []);
});
