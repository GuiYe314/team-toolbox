import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import { createAndroidLogcat, parseLogcatLine } from './android-logcat.js';
import { createAndroidAdbService } from './android-adb.js';
import { registerAndroidApi } from './android-api.js';

const line = (message = '中文测试', level = 'I') => `11-05 12:34:56.789  1234  5678 ${level} Unity : ${message}`;
function fixture(t, options = {}) {
    const f = { children: [], logs: [], calls: [], devices: [{ serial: 'PHONE_A', state: 'device' }, { serial: 'PHONE_B', state: 'device' }, { serial: 'OFF', state: 'offline' }] };
    f.spawn = (path, args, config) => {
        f.calls.push({ path, args, config });
        const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.killed = false;
        child.kill = () => { child.killed = true; child.emit('close', null); return true; };
        f.children.push(child); queueMicrotask(() => child.emit('spawn')); return child;
    };
    f.service = createAndroidLogcat({ executable: () => 'fixture/adb.exe', readDevices: async () => f.devices, spawnProcess: (...args) => f.spawn(...args), log: entry => f.logs.push(entry), ...options });
    t.after(() => f.service.dispose()); return f;
}

test('Logcat threadtime 提取级别、进程、标签和正文，未知行保留原文', () => {
    const entry = parseLogcatLine(line());
    assert.equal(entry.time, '11-05 12:34:56.789'); assert.equal(entry.pid, '1234'); assert.equal(entry.tid, '5678'); assert.equal(entry.level, 'I'); assert.equal(entry.tag, 'Unity'); assert.equal(entry.message, '中文测试');
    assert.equal(parseLogcatLine('--------- beginning of main').raw, '--------- beginning of main');
});

test('日志只以固定参数读取明确设备，禁用 Shell 并隐藏窗口', async (t) => {
    const f = fixture(t); const session = await f.service.start('PHONE_A');
    assert.equal(session.state, 'running');
    assert.deepEqual(f.calls[0].args, ['-s', 'PHONE_A', 'logcat', '-v', 'threadtime', '-T', '100']);
    assert.equal(f.calls[0].config.shell, false); assert.equal(f.calls[0].config.windowsHide, true);
    assert.ok(!f.calls[0].args.includes('-c'));
});

test('无效、掉线、未授权日志目标与预先取消请求不会启动进程', async (t) => {
    const f = fixture(t); f.devices.push({ serial: 'UNAUTH', state: 'unauthorized' });
    for (const serial of ['-s', 'PHONE_A\n', 'PHONE_A;calc', '', null]) await assert.rejects(f.service.start(serial), { code: 'invalid_input' });
    for (const serial of ['OFF', 'UNAUTH', 'UNKNOWN']) await assert.rejects(f.service.start(serial), { code: 'device_unavailable' });
    await assert.rejects(f.service.start('PHONE_A', AbortSignal.abort()), { code: 'cancelled' }); assert.equal(f.children.length, 0);
});

test('分段 UTF-8 和 CRLF 可正确增量读取，游标不重复返回日志', async (t) => {
    const f = fixture(t); const session = await f.service.start('PHONE_A');
    const data = Buffer.from(line() + '\r\n' + line('second', 'E') + '\n'); const cut = data.indexOf(Buffer.from('中')) + 1;
    f.children[0].stdout.write(data.subarray(0, cut)); f.children[0].stdout.write(data.subarray(cut));
    const first = f.service.poll(session.id); assert.equal(first.entries.length, 2); assert.equal(first.entries[0].message, '中文测试');
    assert.equal(first.entries[1].level, 'E'); assert.equal(f.service.poll(session.id, first.cursor).entries.length, 0);
    await assert.rejects(async () => f.service.poll(session.id, -1), { code: 'invalid_input' });
});

test('内存缓存遵守数量和字节上限，旧记录轮换并提供丢弃计数', async (t) => {
    const f = fixture(t, { maxEntries: 3, maxBytes: 1000 }); const session = await f.service.start('PHONE_A');
    for (let i = 0; i < 20; i++) f.children[0].stdout.write(line(String(i)) + '\n');
    const result = f.service.poll(session.id); assert.ok(result.entries.length <= 3); assert.ok(result.dropped >= 17);
    assert.equal(result.entries.at(-1).message, '19'); assert.equal(result.total, 20);
    assert.ok(Buffer.byteLength(JSON.stringify(result.entries)) < 1000);
});

test('超长未换行输出会停止进程，设备原文不会写入服务器操作日志', async (t) => {
    const f = fixture(t); const session = await f.service.start('PHONE_A');
    f.children[0].stdout.write('private-device-content'.repeat(4000));
    assert.equal(f.service.poll(session.id).state, 'failed'); assert.equal(f.children[0].killed, true);
    assert.ok(!JSON.stringify(f.logs).includes('private-device-content'));
});

test('停止、替换会话、对应设备断开与销毁均终止子进程', async (t) => {
    const f = fixture(t); const first = await f.service.start('PHONE_A'); f.children[0].stdout.write(line('last partial'));
    f.service.stop(first.id); assert.equal(f.children[0].killed, true); assert.equal(f.service.poll(first.id).entries[0].message, 'last partial');
    await f.service.start('PHONE_A'); const third = await f.service.start('PHONE_B'); assert.equal(f.children[1].killed, true);
    f.service.stopDevice('PHONE_A'); assert.equal(f.children[2].killed, false); f.service.stopDevice('PHONE_B'); assert.equal(f.children[2].killed, true);
    f.service.dispose(); assert.throws(() => f.service.poll(third.id), { code: 'invalid_session' });
});

test('心跳延续会话，无轮询十五秒后过期并终止子进程', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const f = fixture(t); const session = await f.service.start('PHONE_A');
    t.mock.timers.tick(14000); f.service.poll(session.id); t.mock.timers.tick(14000); assert.equal(f.children[0].killed, false);
    t.mock.timers.tick(1001); assert.equal(f.service.poll(session.id).state, 'expired'); assert.equal(f.children[0].killed, true);
});

test('进程启动错误和异常退出反馈可见原因并允许重新开始', async (t) => {
    const f = fixture(t); const spawnOk = f.spawn;
    f.spawn = (...args) => { const child = spawnOk(...args); queueMicrotask(() => child.emit('error', new Error('fixture failure'))); return child; };
    await assert.rejects(f.service.start('PHONE_A'), { code: 'adb_failed' });
    f.spawn = spawnOk; const session = await f.service.start('PHONE_A');
    f.children.at(-1).stderr.write('device offline'); f.children.at(-1).emit('close', 1);
    assert.equal(f.service.poll(session.id).state, 'failed'); assert.match(f.service.poll(session.id).message, /device offline/);
});

test('真实 Node 子进程支持持续输出与停止，不依赖真实 ADB', async (t) => {
    let child; const service = createAndroidLogcat({ executable: () => process.execPath, readDevices: async () => [{ serial: 'FIXTURE', state: 'device' }],
        spawnProcess: (_path, _args, options) => child = spawn(process.execPath, ['-e', `process.stdout.write(${JSON.stringify(line('node stream') + '\n')});setInterval(()=>{},1000);`], options) });
    t.after(() => service.dispose()); const session = await service.start('FIXTURE');
    const closed = new Promise(resolve => child.once('close', resolve));
    for (let i = 0; i < 100 && !service.poll(session.id).entries.length; i++) await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(service.poll(session.id).entries[0].message, 'node stream'); service.stop(session.id); await closed;
    assert.equal(service.poll(session.id).state, 'stopped');
});

test('服务配置变更停止日志流，采集期间可执行普通命令且保持明确设备', async (t) => {
    const f = fixture(t); const root = mkdtempSync(join(tmpdir(), 'tt-logcat-service-')); t.after(() => rmSync(root, { recursive: true, force: true }));
    const path = join(root, process.platform === 'win32' ? 'adb.exe' : 'adb'); writeFileSync(path, 'fixture', { mode: 0o700 });
    const service = createAndroidAdbService({ configFile: join(root, 'config.json'), env: {}, logcatSpawn: f.spawn, log: () => {}, runner: async (_exe, args) => ({ stdout: args[0] === 'version' ? 'Android Debug Bridge version 1.0.41' : args[0] === 'devices' ? 'PHONE_A device\n' : 'ok', stderr: '' }) });
    t.after(() => service.dispose()); await service.configure(path); const session = await service.startLogcat('PHONE_A');
    assert.equal((await service.executeCommand({ id: 'memory', serial: 'PHONE_A' })).stdout, 'ok');
    await service.configure(''); assert.equal(f.children.at(-1).killed, true); await assert.rejects(service.pollLogcat(session.id, 0), { code: 'invalid_session' });
});

test('Logcat API 保留本机/请求头限制并拒绝额外参数和非法游标', async (t) => {
    const f = fixture(t); const app = express(); app.use(express.json());
    registerAndroidApi(app, { service: { startLogcat: (...args) => f.service.start(...args), pollLogcat: (...args) => f.service.poll(...args), stopLogcat: id => f.service.stop(id) } });
    const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); })); const base = `http://127.0.0.1:${server.address().port}/api/android`;
    const send = (path, body, headers = {}) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Toolbox-Adb': '1', ...headers }, body: JSON.stringify(body) });
    assert.equal((await send('/logcat', { serial: 'PHONE_A' }, { Origin: 'https://other.example' })).status, 403);
    assert.equal((await send('/logcat', { serial: 'PHONE_A' }, { 'X-Toolbox-Adb': '' })).status, 403);
    assert.equal((await send('/logcat', { serial: 'PHONE_A', args: ['-c'] })).status, 400);
    const session = await (await send('/logcat', { serial: 'PHONE_A' })).json();
    assert.equal((await send(`/logcat/${session.id}/poll`, { after: '0' })).status, 400);
    assert.equal((await send(`/logcat/${session.id}/stop`, {})).status, 200); assert.equal(f.children[0].killed, true);
});

test('应用日志只缓存匹配的主进程与子进程，其他应用原文不返回浏览器', async t => {
    const application = { packageName: 'com.example.app', running: true, processes: [{ pid: '1234', name: 'com.example.app' }, { pid: '5678', name: 'com.example.app:worker' }], checkedAt: new Date().toISOString() };
    const f = fixture(t, { readApplication: async () => application });
    const session = await f.service.start('PHONE_A', undefined, application.packageName);
    f.children[0].stdout.write(line('main') + '\n' + line('worker').replace('1234', '5678') + '\n' + line('private other app').replace('1234', '9999') + '\n--------- beginning of main\n');
    const result = f.service.poll(session.id);
    assert.deepEqual(result.entries.map(item => item.message), ['main', 'worker']); assert.equal(result.total, 2);
    assert.equal(result.application.packageName, application.packageName); assert.ok(!JSON.stringify(result).includes('private other app'));
    await assert.rejects(f.service.start('PHONE_A', undefined, 'com.app;reboot'), { code: 'invalid_input' }); assert.equal(f.children.length, 1);
});

test('未运行应用可等待启动，主进程重启与退出后按新 PID 集合过滤', async t => {
    let clock = 0, calls = 0;
    const application = { packageName: 'com.example.app', running: false, processes: [], checkedAt: new Date().toISOString() };
    let next = application;
    const f = fixture(t, { now: () => clock, readApplication: async () => application, readProcesses: async () => { calls++; return next; } });
    const session = await f.service.start('PHONE_A', undefined, application.packageName);
    f.children[0].stdout.write(line('before app starts') + '\n'); assert.equal(f.service.poll(session.id).entries.length, 0);
    clock = 1000; await f.service.refreshApplication(session.id); assert.equal(calls, 0);
    next = { ...application, running: true, processes: [{ pid: '8888', name: application.packageName }] }; clock = 2001; await f.service.refreshApplication(session.id);
    f.children[0].stdout.write(line('new PID').replace('1234', '8888') + '\n' + line('old PID') + '\n');
    assert.deepEqual(f.service.poll(session.id).entries.map(item => item.message), ['new PID']); assert.equal(f.service.poll(session.id).application.running, true);
    next = application; clock = 4002; await f.service.refreshApplication(session.id);
    f.children[0].stdout.write(line('after exit').replace('1234', '8888') + '\n');
    assert.equal(f.service.poll(session.id).application.running, false); assert.equal(f.service.poll(session.id).total, 1); assert.equal(f.children[0].killed, false);
});

test('重复心跳合并应用状态查询，停止会取消查询并阻止旧结果覆盖', async t => {
    let clock = 0, calls = 0, signal;
    const application = { packageName: 'com.example.app', running: true, processes: [{ pid: '1234', name: 'com.example.app' }], checkedAt: new Date().toISOString() };
    const f = fixture(t, { now: () => clock, readApplication: async () => application, readProcesses: async (_serial, _package, controllerSignal) => {
        calls++; signal = controllerSignal;
        return new Promise((_resolve, reject) => controllerSignal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true }));
    } });
    const session = await f.service.start('PHONE_A', undefined, application.packageName); clock = 2001;
    const first = f.service.refreshApplication(session.id), second = f.service.refreshApplication(session.id);
    assert.equal(calls, 1); f.service.stop(session.id); await Promise.all([first, second]);
    assert.equal(signal.aborted, true); assert.equal(f.service.poll(session.id).state, 'stopped'); assert.equal(f.children[0].killed, true);
});

test('运行状态查询失败会停止应用日志并显示原因，设备模式无需查询进程', async t => {
    let clock = 0, calls = 0;
    const application = { packageName: 'com.example.app', running: false, processes: [], checkedAt: new Date().toISOString() };
    const f = fixture(t, { now: () => clock, readApplication: async () => application, readProcesses: async () => { calls++; throw new Error('fixture device offline'); } });
    const all = await f.service.start('PHONE_A'); clock = 9000; await f.service.refreshApplication(all.id); assert.equal(calls, 0);
    const app = await f.service.start('PHONE_A', undefined, application.packageName); clock = 12000; await f.service.refreshApplication(app.id);
    const result = f.service.poll(app.id); assert.equal(result.state, 'failed'); assert.match(result.message, /fixture device offline/); assert.equal(f.children.at(-1).killed, true);
});
