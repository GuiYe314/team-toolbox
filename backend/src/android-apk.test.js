import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { PassThrough, Readable } from 'node:stream';
import { request as httpRequest } from 'node:http';
import archiver from 'archiver';
import express from 'express';
import { AdbError, createAndroidAdbService } from './android-adb.js';
import { APK_MAX_BYTES, APK_MAX_DEVICES, inspectApk, validateApkRequest, validateApkBatchRequest } from './android-apk.js';
import { registerAndroidApi } from './android-api.js';

async function apk(entries = [['AndroidManifest.xml', 'binary manifest fixture'], ['classes.dex', 'dex fixture']]) {
    const zip = archiver('zip', { zlib: { level: 0 } }), chunks = [];
    const ended = new Promise((resolve, reject) => { zip.on('data', data => chunks.push(data)); zip.on('end', resolve); zip.on('error', reject); });
    for (const [name, data] of entries) zip.append(data, { name });
    await zip.finalize(); await ended;
    return Buffer.concat(chunks);
}
const validApk = await apk();
const metadata = size => ({ serial: '192.168.1.20:37123', fileName: '应用 (debug).APK', size: size ?? validApk.length, confirm: true });
const tick = () => new Promise(resolve => setTimeout(resolve, 10));
async function until(predicate) { for (let i = 0; i < 200; i++) { if (predicate()) return; await tick(); } throw new Error('Fixture condition timed out'); }

async function fixture(t, options = {}) {
    const root = mkdtempSync(join(tmpdir(), 'tt-apk-'));
    const executable = join(root, process.platform === 'win32' ? 'adb.exe' : 'adb');
    writeFileSync(executable, 'offline fixture', { mode: 0o700 });
    const f = { root, calls: [], logs: [], devices: '192.168.1.20:37123 device model:Pixel\nOFF offline\nUNAUTH unauthorized\n', execute: async () => ({ stdout: 'Performing Streamed Install\nSuccess\n', stderr: '' }) };
    f.service = createAndroidAdbService({ configFile: join(root, 'config.json'), env: {}, apkOptions: { temporaryBase: root, ...options }, log: entry => f.logs.push(entry), runner: async (_exe, args, runOptions) => {
        f.calls.push({ args, options: runOptions });
        if (args[0] === 'version') return { stdout: 'Android Debug Bridge version 1.0.41', stderr: '' };
        if (args[0] === 'devices') return { stdout: f.devices, stderr: '' };
        assert.equal(args[2], 'install');
        return f.execute(args, runOptions);
    } });
    t.after(() => {
        f.service.dispose();
        assert.equal(dirname(resolve(root)), resolve(tmpdir())); assert.ok(basename(root).startsWith('tt-apk-'));
        rmSync(root, { recursive: true, force: true });
    });
    f.clean = () => assert.deepEqual(readdirSync(root).filter(name => name.startsWith('team-toolbox-apk-')), []);
    await f.service.configure(executable); f.calls = []; f.logs = [];
    return f;
}

test('APK 请求只接受明确设备、布尔确认、APK 文件名和有界非空大小', () => {
    validateApkRequest(metadata());
    for (const change of [{ serial: '-s' }, { serial: 'phone;reboot' }, { serial: '' }, { confirm: 'true' }, { confirm: false }, { fileName: '../secret.apk' }, { fileName: 'C:\\app.apk' }, { fileName: 'app.aab' }, { fileName: 'app.apks' }, { fileName: 'x\n.apk' }, { size: 0 }, { size: -1 }, { size: 1.2 }, { size: '1' }, { size: APK_MAX_BYTES + 1 }, { args: ['-d'] }]) {
        assert.throws(() => validateApkRequest({ ...metadata(), ...change }), AdbError);
    }
});

test('完整 APK 流式保存后两次复核设备，仅执行明确序列号 install -r，结束删除临时包', async t => {
    const f = await fixture(t); let savedPath;
    f.execute = async (args, options) => {
        assert.deepEqual(args.slice(0, 4), ['-s', metadata().serial, 'install', '-r']); assert.equal(args.length, 5);
        savedPath = args[4]; assert.equal(basename(savedPath), 'package.apk');
        assert.equal(dirname(dirname(savedPath)), f.root); assert.deepEqual(readFileSync(savedPath), validApk);
        assert.equal(options.timeoutMs, 300000); assert.equal(options.maxBytes, 64 * 1024); assert.ok(options.signal);
        return { stdout: 'Performing Streamed Install\nSuccess\n', stderr: savedPath + ' warning' };
    };
    const result = await f.service.installApk(metadata(), Readable.from([validApk.subarray(0, 16), validApk.subarray(16)]));
    assert.equal(result.message, 'APK 安装成功'); assert.equal(result.serial, metadata().serial); assert.equal(result.size, validApk.length);
    assert.equal(result.fileName, metadata().fileName); assert.ok(!result.stderr.includes(f.root));
    assert.deepEqual(f.calls.slice(0, 2).map(call => call.args), [['devices', '-l'], ['devices', '-l']]);
    assert.deepEqual(f.logs, [{ action: 'apk_install', ok: true }]); f.clean();
});

test('离线、未授权或不存在目标拒绝接收安装，上传结束设备离线也不能安装', async t => {
    const f = await fixture(t);
    for (const serial of ['OFF', 'UNAUTH', 'MISSING']) await assert.rejects(f.service.installApk({ ...metadata(), serial }, Readable.from([validApk])), { code: 'device_unavailable' });
    const input = new PassThrough(), pending = f.service.installApk(metadata(), input);
    await until(() => readdirSync(f.root).some(name => name.startsWith('team-toolbox-apk-')));
    f.devices = '192.168.1.20:37123 offline\n'; input.end(validApk);
    await assert.rejects(pending, { code: 'device_unavailable' }); assert.ok(f.calls.every(call => call.args[0] === 'devices')); f.clean();
});

test('伪装 APK、缺失/空清单、AAB 结构与截断 ZIP 均拒绝，失败后可重试', async t => {
    const f = await fixture(t);
    const invalid = [Buffer.from('not an APK'), await apk([['base/manifest/AndroidManifest.xml', 'aab']]), await apk([['classes.dex', 'dex']]), await apk([['AndroidManifest.xml', '']]), validApk.subarray(0, validApk.length - 12)];
    for (const data of invalid) {
        await assert.rejects(f.service.installApk(metadata(data.length), Readable.from([data])), { code: 'invalid_apk' }); f.clean();
    }
    assert.ok(f.calls.every(call => call.args[0] === 'devices'));
    assert.equal((await f.service.installApk(metadata(), Readable.from([validApk]))).message, 'APK 安装成功'); f.clean();
});

test('声明超限、实际超限及传送截断有明确错误，临时文件清理且不执行安装', async t => {
    const f = await fixture(t, { maximumBytes: validApk.length });
    await assert.rejects(f.service.installApk(metadata(validApk.length + 1), Readable.from([validApk])), { code: 'file_limit' });
    await assert.rejects(f.service.installApk(metadata(validApk.length - 1), Readable.from([validApk])), { code: 'file_limit' });
    await assert.rejects(f.service.installApk(metadata(), Readable.from([validApk.subarray(0, -1)])), { code: 'upload_failed' });
    assert.ok(f.calls.every(call => call.args[0] === 'devices')); f.clean();
});

test('只有独立 Success 行确认成功，失败输出、空输出及进程错误不能冒报成功', async t => {
    const f = await fixture(t);
    for (const stdout of ['', 'Successfully uploaded', 'Failure [INSTALL_FAILED_UPDATE_INCOMPATIBLE]', 'Success\nFailure [INSTALL_FAILED_VERSION_DOWNGRADE]']) {
        f.execute = async () => ({ stdout, stderr: '' });
        await assert.rejects(f.service.installApk(metadata(), Readable.from([validApk])), { code: 'install_failed' }); f.clean();
    }
    f.execute = async args => { throw new AdbError('adb_failed', 'INSTALL_FAILED_INVALID_APK ' + args[4], 502); };
    await assert.rejects(f.service.installApk(metadata(), Readable.from([validApk])), error => error.code === 'adb_failed' && !error.message.includes(f.root));
    assert.ok(f.logs.every(entry => !JSON.stringify(entry).includes('debug'))); f.clean();
});

test('传送期间取消会停止写入、删除临时文件并释放普通 ADB 独占锁', async t => {
    const f = await fixture(t), input = new PassThrough(), controller = new AbortController();
    const pending = f.service.installApk(metadata(), input, controller.signal);
    await until(() => readdirSync(f.root).some(name => name.startsWith('team-toolbox-apk-')));
    await assert.rejects(f.service.devices(), { code: 'busy' });
    await assert.rejects(f.service.installApk(metadata(), Readable.from([validApk])), { code: 'busy' });
    input.write(validApk.subarray(0, 8)); controller.abort();
    await assert.rejects(pending, { code: 'cancelled' }); input.end(); f.clean();
    assert.ok((await f.service.devices()).devices.length);
});

test('安装期间取消和服务 dispose 传递到 ADB，清理临时包并可重试', async t => {
    const f = await fixture(t);
    for (const dispose of [false, true]) {
        let started; const ready = new Promise(resolve => { started = resolve; });
        f.execute = (_args, options) => new Promise((_resolve, reject) => {
            options.signal.addEventListener('abort', () => reject(new AdbError('cancelled', 'cancelled', 499)), { once: true }); started();
        });
        const controller = new AbortController(), pending = f.service.installApk(metadata(), Readable.from([validApk]), controller.signal); await ready;
        if (dispose) f.service.dispose(); else controller.abort();
        await assert.rejects(pending, { code: 'cancelled' }); f.clean();
        assert.ok((await f.service.devices()).devices.length);
    }
});

test('上传与安装各自受超时约束，超时清理并返回 timeout', async t => {
    const uploading = await fixture(t, { uploadTimeoutMs: 100 }); const input = new PassThrough();
    await assert.rejects(uploading.service.installApk(metadata(), input), { code: 'timeout', status: 504 }); input.end(); uploading.clean();
    const installing = await fixture(t, { installTimeoutMs: 100 });
    installing.execute = (_args, options) => new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new AdbError('cancelled', 'cancelled', 499)), { once: true }));
    await assert.rejects(installing.service.installApk(metadata(), Readable.from([validApk])), { code: 'timeout', status: 504 }); installing.clean();
});

test('已取消的请求不读写文件，APK 检查也能直接取消', async t => {
    const f = await fixture(t), controller = new AbortController(); controller.abort();
    await assert.rejects(f.service.installApk(metadata(), Readable.from([validApk]), controller.signal), { code: 'cancelled' });
    await assert.rejects(inspectApk('not-read.apk', controller.signal), { code: 'cancelled' });
    assert.equal(f.calls.length, 0); f.clean();
});

async function apiFixture(t) {
    const f = await fixture(t), app = express(); app.use(express.json()); registerAndroidApi(app, { service: f.service });
    f.server = await new Promise(resolve => { const server = app.listen(0, '127.0.0.1', () => resolve(server)); });
    t.after(() => new Promise(resolve => { f.server.closeAllConnections(); f.server.close(resolve); }));
    f.base = `http://127.0.0.1:${f.server.address().port}/api/android`;
    f.headers = { 'Content-Type': 'application/octet-stream', 'X-Toolbox-Adb': '1', 'X-Toolbox-Adb-Serial': metadata().serial, 'X-Toolbox-Adb-Confirm': '1', 'X-Toolbox-Apk-Name': encodeURIComponent(metadata().fileName), 'X-Toolbox-Apk-Size': String(validApk.length) };
    f.send = (headers = {}, path = '/apk/install') => fetch(f.base + path, { method: 'POST', headers: { ...f.headers, ...headers }, body: validApk });
    return f;
}

test('APK HTTP 端点仅对本机、专用类型/请求头及明确确认放行，不放宽其他接口', async t => {
    const f = await apiFixture(t);
    for (const headers of [{ Origin: 'https://evil.example' }, { 'Sec-Fetch-Site': 'cross-site' }, { 'X-Toolbox-Adb': '' }, { 'Content-Type': 'multipart/form-data' }]) assert.equal((await f.send(headers)).status, 403, JSON.stringify(headers));
    // Node fetch 会重建 Host；用原始 HTTP 请求验证该边界。
    assert.equal(await new Promise((resolve, reject) => {
        const request = httpRequest(f.base + '/apk/install', { method: 'POST', headers: { ...f.headers, Host: 'evil.example' } }, response => { response.resume(); response.on('end', () => resolve(response.statusCode)); });
        request.on('error', reject); request.end(validApk);
    }), 403);
    for (const headers of [{ 'X-Toolbox-Adb-Confirm': '' }, { 'X-Toolbox-Adb-Confirm': 'true' }, { 'X-Toolbox-Adb-Serial': '-s' }, { 'X-Toolbox-Apk-Name': '%' }, { 'X-Toolbox-Apk-Name': encodeURIComponent('../bad.apk') }, { 'X-Toolbox-Apk-Size': String(validApk.length + 1) }]) assert.equal((await f.send(headers)).status, 400);
    assert.equal((await f.send({}, '/apk/install?path=C:/secret.apk')).status, 400);
    assert.equal((await f.send({}, '/commands/execute')).status, 403);
    assert.equal(f.calls.length, 0);
    const result = await f.send(); assert.equal(result.status, 200); assert.equal((await result.json()).message, 'APK 安装成功');
    assert.equal(result.headers.get('cache-control'), 'no-store'); f.clean();
});

test('HTTP 上传连接中断后终止接收并清理，不产生安装或占用遗留', async t => {
    const f = await apiFixture(t);
    const request = httpRequest(f.base + '/apk/install', { method: 'POST', headers: { ...f.headers, 'Content-Length': String(validApk.length) } });
    request.on('error', () => {}); request.write(validApk.subarray(0, 8));
    await until(() => readdirSync(f.root).some(name => name.startsWith('team-toolbox-apk-'))); request.destroy();
    await until(() => !readdirSync(f.root).some(name => name.startsWith('team-toolbox-apk-')));
    assert.ok(f.calls.every(call => call.args[0] === 'devices')); assert.ok((await f.service.devices()).devices.length); f.clean();
});

const batchMetadata = () => ({ serials: [metadata().serial, 'PHONE2', 'PHONE3'], fileName: metadata().fileName, size: validApk.length, confirm: true });
function addPhones(f) { f.devices += 'PHONE2 device model:Phone_Two\nPHONE3 device model:Phone_Three\n'; }

test('批量安装只接受 1～20 台不重复的明确设备与完整安装确认', () => {
    validateApkBatchRequest(batchMetadata());
    validateApkBatchRequest({ ...batchMetadata(), serials: Array.from({ length: APK_MAX_DEVICES }, (_, i) => `PHONE${i}`) });
    for (const change of [{ serials: [] }, { serials: 'PHONE2' }, { serials: ['PHONE2', 'PHONE2'] }, { serials: ['-s'] }, { serials: ['phone;reboot'] },
        { serials: ['PHONE2', null] }, { serials: Array.from({ length: APK_MAX_DEVICES + 1 }, (_, i) => `PHONE${i}`) }, { confirm: false }, { confirm: 'true' },
        { fileName: '../app.apk' }, { size: APK_MAX_BYTES + 1 }, { serial: 'EXTRA' }, { args: ['-r'] }]) {
        assert.throws(() => validateApkBatchRequest({ ...batchMetadata(), ...change }), AdbError);
    }
});

test('同一 APK 一次上传复用同一临时包，按确认快照逐台执行并返回实时结果', async t => {
    const f = await fixture(t); addPhones(f);
    const request = batchMetadata(), events = [], paths = []; let active = 0, maximum = 0;
    f.execute = async args => {
        active++; maximum = Math.max(maximum, active); paths.push(args[4]);
        assert.deepEqual(args.slice(2, 4), ['install', '-r']); assert.equal(args.length, 5); assert.deepEqual(readFileSync(args[4]), validApk);
        request.serials.push('UNCONFIRMED'); // 调用方改动不能扩大已确认队列。
        await tick(); active--;
        return { stdout: 'Success\n', stderr: args[4] };
    };
    const result = await f.service.installApkBatch(request, Readable.from([validApk]), undefined, event => events.push(event));
    assert.equal(maximum, 1); assert.equal(new Set(paths).size, 1);
    assert.deepEqual(result.results.map(item => item.serial), batchMetadata().serials);
    assert.deepEqual(result.results.map(item => item.status), ['success', 'success', 'success']);
    assert.equal(result.succeeded, 3); assert.equal(result.failed, 0); assert.equal(result.total, 3); assert.equal(result.size, validApk.length);
    assert.deepEqual(events.map(event => event.type === 'ready' ? 'ready' : event.result.status), ['ready', 'installing', 'success', 'installing', 'success', 'installing', 'success']);
    assert.ok(!JSON.stringify(result).includes(f.root)); assert.ok(!JSON.stringify(f.logs).includes(metadata().fileName)); f.clean();
});

test('单台安装失败及中途离线分别记录，继续其余设备且不冒报全部成功', async t => {
    const f = await fixture(t); addPhones(f);
    f.execute = async args => {
        if (args[1] === metadata().serial) {
            f.devices = f.devices.replace('PHONE3 device', 'PHONE3 offline');
            throw new AdbError('adb_failed', 'INSTALL_FAILED_UPDATE_INCOMPATIBLE ' + args[4], 502);
        }
        return { stdout: 'Success\n', stderr: '' };
    };
    const result = await f.service.installApkBatch(batchMetadata(), Readable.from([validApk]));
    assert.equal(result.succeeded, 1); assert.equal(result.failed, 2);
    assert.deepEqual(result.results.map(item => item.status), ['failed', 'success', 'failed']);
    assert.equal(result.results[2].code, 'device_unavailable'); assert.ok(!JSON.stringify(result).includes(f.root));
    assert.deepEqual(f.calls.filter(call => call.args[2] === 'install').map(call => call.args[1]), [metadata().serial, 'PHONE2']);
    assert.equal(f.logs.filter(entry => entry.action === 'apk_install_device' && !entry.ok).length, 2); f.clean();
});

test('单台输出无 Success 或包含 Failure 时为失败，下一台仍会执行', async t => {
    const f = await fixture(t); addPhones(f);
    f.execute = async args => ({ stdout: args[1] === metadata().serial ? 'Successfully uploaded' : args[1] === 'PHONE2' ? 'Success\nFailure [INSTALL_FAILED_INVALID_APK]' : 'Success\n', stderr: '' });
    const result = await f.service.installApkBatch(batchMetadata(), Readable.from([validApk]));
    assert.deepEqual(result.results.map(item => item.status), ['failed', 'failed', 'success']); f.clean();
});

test('每台独立安装超时，终止此台后继续下一台并清理临时包', async t => {
    const f = await fixture(t, { installTimeoutMs: 150 }); addPhones(f);
    f.execute = (args, options) => args[1] === metadata().serial
        ? new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new AdbError('cancelled', 'aborted', 499)), { once: true }))
        : Promise.resolve({ stdout: 'Success\n', stderr: '' });
    const result = await f.service.installApkBatch(batchMetadata(), Readable.from([validApk]));
    assert.equal(result.results[0].code, 'timeout'); assert.deepEqual(result.results.map(item => item.status), ['failed', 'success', 'success']); f.clean();
});

test('批量上传取消、超时及无在线目标均不安装且释放锁', async t => {
    const f = await fixture(t, { uploadTimeoutMs: 150 }); addPhones(f);
    await assert.rejects(f.service.installApkBatch({ ...batchMetadata(), serials: ['OFF', 'UNAUTH'] }, Readable.from([validApk])), { code: 'device_unavailable' });
    let input = new PassThrough();
    await assert.rejects(f.service.installApkBatch(batchMetadata(), input), { code: 'timeout' }); input.end(); f.clean();
    input = new PassThrough(); const controller = new AbortController(), pending = f.service.installApkBatch(batchMetadata(), input, controller.signal);
    await until(() => readdirSync(f.root).some(name => name.startsWith('team-toolbox-apk-')));
    await assert.rejects(f.service.devices(), { code: 'busy' });
    await assert.rejects(f.service.installApk(metadata(), Readable.from([validApk])), { code: 'busy' });
    controller.abort(); await assert.rejects(pending, { code: 'cancelled' }); input.end(); f.clean();
    assert.ok(f.calls.every(call => call.args[0] === 'devices')); assert.ok((await f.service.devices()).devices.length);
});

test('批量取消或服务关闭时停止当前设备和后续队列，已成功结果保留', async t => {
    for (const dispose of [false, true]) {
        const f = await fixture(t); addPhones(f); const events = []; let entered;
        const started = new Promise(resolve => { entered = resolve; });
        f.execute = (args, options) => args[1] === metadata().serial ? Promise.resolve({ stdout: 'Success\n', stderr: '' })
            : new Promise((_resolve, reject) => { options.signal.addEventListener('abort', () => reject(new AdbError('cancelled', 'cancelled', 499)), { once: true }); entered(); });
        const controller = new AbortController(), pending = f.service.installApkBatch(batchMetadata(), Readable.from([validApk]), controller.signal, event => events.push(event));
        await started;
        if (dispose) f.service.dispose(); else controller.abort();
        await assert.rejects(pending, { code: 'cancelled' });
        assert.ok(events.some(event => event.result?.serial === metadata().serial && event.result.status === 'success'));
        assert.ok(!events.some(event => event.result?.serial === 'PHONE3'));
        assert.deepEqual(f.calls.filter(call => call.args[2] === 'install').map(call => call.args[1]), [metadata().serial, 'PHONE2']); f.clean();
    }
});

test('批量伪装或截断 APK 在任何设备安装前拒绝，重试和单台安装仍可使用', async t => {
    const f = await fixture(t); addPhones(f);
    for (const bytes of [Buffer.from('not apk'), validApk.subarray(0, -12)]) {
        await assert.rejects(f.service.installApkBatch({ ...batchMetadata(), size: bytes.length }, Readable.from([bytes])), { code: 'invalid_apk' }); f.clean();
    }
    assert.ok(f.calls.every(call => call.args[0] === 'devices'));
    assert.equal((await f.service.installApkBatch({ ...batchMetadata(), serials: ['PHONE2'] }, Readable.from([validApk]))).succeeded, 1);
    assert.equal((await f.service.installApk(metadata(), Readable.from([validApk]))).message, 'APK 安装成功'); f.clean();
});

test('批量 HTTP 端点保留本机/专用头/确认及参数边界，返回逐台 NDJSON 与汇总', async t => {
    const f = await apiFixture(t); addPhones(f);
    const headers = { 'X-Toolbox-Adb-Serial': '', 'X-Toolbox-Adb-Serials': JSON.stringify(batchMetadata().serials) };
    const send = (patch = {}, path = '/apk/install-batch') => f.send({ ...headers, ...patch }, path);
    for (const patch of [{ Origin: 'https://evil.example' }, { 'Sec-Fetch-Site': 'cross-site' }, { 'X-Toolbox-Adb': '' }, { 'Content-Type': 'multipart/form-data' }]) assert.equal((await send(patch)).status, 403);
    for (const patch of [{ 'X-Toolbox-Adb-Serials': '{' }, { 'X-Toolbox-Adb-Serials': '[]' }, { 'X-Toolbox-Adb-Serials': '["PHONE2","PHONE2"]' },
        { 'X-Toolbox-Adb-Serial': 'PHONE2' }, { 'X-Toolbox-Adb-Confirm': 'true' }, { 'X-Toolbox-Apk-Name': '%' }]) assert.equal((await send(patch)).status, 400);
    assert.equal((await send({}, '/apk/install-batch?serial=PHONE2')).status, 400); assert.equal(f.calls.length, 0);
    f.execute = async args => ({ stdout: args[1] === 'PHONE2' ? 'Failure [INSTALL_FAILED_INVALID_APK]' : 'Success\n', stderr: '' });
    const response = await send(); assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.match(response.headers.get('content-type'), /application\/x-ndjson/);
    const events = (await response.text()).trim().split('\n').map(line => JSON.parse(line));
    assert.equal(events[0].type, 'ready'); assert.equal(events.at(-1).type, 'complete');
    assert.equal(events.at(-1).result.succeeded, 2); assert.equal(events.at(-1).result.failed, 1); f.clean();
});

test('HTTP 批量结果连接中断会取消当前安装并跳过后续设备', { timeout: 5000 }, async t => {
    const f = await apiFixture(t); addPhones(f); let aborted = false;
    f.execute = (args, options) => args[1] === metadata().serial ? Promise.resolve({ stdout: 'Success\n', stderr: '' })
        : new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => { aborted = true; reject(new AdbError('cancelled', 'cancelled', 499)); }, { once: true }));
    const response = await f.send({ 'X-Toolbox-Adb-Serial': '', 'X-Toolbox-Adb-Serials': JSON.stringify(batchMetadata().serials) }, '/apk/install-batch');
    const reader = response.body.getReader(); let text = '';
    while (!text.includes('PHONE2')) { const chunk = await reader.read(); assert.equal(chunk.done, false); text += Buffer.from(chunk.value).toString('utf8'); }
    await reader.cancel(); await until(() => aborted); await until(() => !readdirSync(f.root).some(name => name.startsWith('team-toolbox-apk-')));
    assert.ok(!f.calls.some(call => call.args[2] === 'install' && call.args[1] === 'PHONE3'));
    assert.ok((await f.service.devices()).devices.length); f.clean();
});
