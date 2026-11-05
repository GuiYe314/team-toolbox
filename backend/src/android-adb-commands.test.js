import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import express from 'express';
import { AdbError, createAndroidAdbService } from './android-adb.js';
import { registerAndroidApi } from './android-api.js';

async function fixture(t) {
    const root = mkdtempSync(join(tmpdir(), 'tt-adb-commands-'));
    t.after(() => { assert.equal(dirname(resolve(root)), resolve(tmpdir())); assert.ok(basename(root).startsWith('tt-adb-commands-')); rmSync(root, { recursive: true, force: true }); });
    const executable = join(root, process.platform === 'win32' ? 'adb.exe' : 'adb');
    writeFileSync(executable, 'offline fixture', { mode: 0o700 });
    const f = { calls: [], logs: [], devices: 'PHONE_A device model:Pixel\n192.168.1.20:37123 device\nOFF offline\nUNAUTH unauthorized\n', execute: async () => ({ stdout: 'fixture output', stderr: '' }) };
    f.service = createAndroidAdbService({ configFile: join(root, 'config.json'), env: {}, log: entry => f.logs.push(entry), runner: async (_exe, args, options) => {
        f.calls.push({ args, options });
        if (args[0] === 'version') return { stdout: 'Android Debug Bridge version 1.0.41', stderr: '' };
        if (args[0] === 'devices') return { stdout: f.devices, stderr: '' };
        return f.execute(args, options);
    } });
    t.after(() => f.service.dispose());
    await f.service.configure(executable); f.calls = []; f.logs = [];
    return f;
}

test('常用命令精简为六项，只有两个 HOME 设置要求确认，返回目录不能改写参数', async t => {
    const f = await fixture(t), list = f.service.commands().commands;
    assert.deepEqual(list.map(item => item.id), ['lock-home', 'unlock-home', 'ip-address', 'device-info', 'memory', 'cpu']);
    assert.ok(list.every(item => item.title && item.description && item.category && item.preview.startsWith('adb -s <设备> ')));
    assert.deepEqual(list.filter(item => item.requiresConfirmation).map(item => item.id), ['lock-home', 'unlock-home']);
    const memory = list.find(item => item.id === 'memory'); memory.preview = 'adb shell rm -rf /'; memory.args = ['shell', 'rm'];
    await f.service.executeCommand({ id: 'memory', serial: 'PHONE_A' });
    assert.deepEqual(f.calls.at(-1).args, ['-s', 'PHONE_A', 'shell', 'dumpsys', 'meminfo']);
});

test('IP、内存和 CPU 使用结构化参数，结果保留目标和原始快照', async t => {
    const f = await fixture(t); f.execute = async () => ({ stdout: 'TOTAL: 12%\n<script>literal</script>', stderr: 'fixture warning' });
    for (const [id, args] of [['memory', ['shell', 'dumpsys', 'meminfo']], ['cpu', ['shell', 'dumpsys', 'cpuinfo']], ['ip-address', ['shell', 'ip', '-o', '-4', 'addr', 'show']]]) {
        f.calls = []; const result = await f.service.executeCommand({ id, serial: '192.168.1.20:37123' });
        assert.deepEqual(f.calls.map(call => call.args), [['devices', '-l'], ['-s', '192.168.1.20:37123', ...args]]);
        assert.match(result.stdout, /TOTAL: 12%/); assert.equal(result.stderr, 'fixture warning'); assert.equal(result.serial, '192.168.1.20:37123');
    }
});

test('设备信息只读取固定属性并显示中文名称和空值说明', async t => {
    const f = await fixture(t); f.execute = async args => ({ stdout: args[4] === 'ro.product.model' ? 'Pixel Test\n' : '', stderr: '' });
    const result = await f.service.executeCommand({ id: 'device-info', serial: 'PHONE_A' });
    assert.deepEqual(f.calls.slice(1).map(call => call.args), ['ro.product.manufacturer', 'ro.product.brand', 'ro.product.model', 'ro.build.version.release', 'ro.build.version.sdk', 'ro.product.cpu.abilist'].map(property => ['-s', 'PHONE_A', 'shell', 'getprop', property]));
    assert.match(result.stdout, /型号：Pixel Test/); assert.match(result.stdout, /CPU 架构：设备未提供/);
});

test('移除的内置命令、未知 ID、参数覆盖和无效设备在执行前拒绝', async t => {
    const f = await fixture(t);
    for (const id of ['model', 'battery', 'android-version', 'home', 'reboot', 'back', 'shell', '__proto__', '', null]) await assert.rejects(f.service.executeCommand({ id, serial: 'PHONE_A', confirm: true }), { code: 'invalid_input' });
    for (const serial of ['', '-s', 'PHONE_A;calc', 'PHONE_A\n', null]) await assert.rejects(f.service.executeCommand({ id: 'memory', serial }), { code: 'invalid_input' });
    await assert.rejects(f.service.executeCommand({ id: 'memory', serial: 'PHONE_A', component: 'com.app/.Home', userId: 0 }), { code: 'invalid_input' });
    assert.equal(f.calls.length, 0);
});

test('离线、未授权及不存在设备不能执行，在线状态执行前重新检查', async t => {
    const f = await fixture(t);
    for (const serial of ['OFF', 'UNAUTH', 'UNKNOWN']) await assert.rejects(f.service.executeCommand({ id: 'cpu', serial }), { code: 'device_unavailable' });
    f.devices = 'PHONE_A offline\n'; await assert.rejects(f.service.executeCommand({ id: 'memory', serial: 'PHONE_A' }), { code: 'device_unavailable' });
    assert.ok(f.calls.every(call => call.args[0] === 'devices'));
});

test('两个默认 HOME 设置都要求严格布尔确认，未确认不查询或修改设备', async t => {
    const f = await fixture(t);
    for (const id of ['lock-home', 'unlock-home']) for (const confirm of [undefined, false, 'true', 1]) await assert.rejects(f.service.executeCommand({ id, serial: 'PHONE_A', component: 'com.app/.Home', userId: 0, confirm }), { code: 'confirmation_required' });
    assert.equal(f.calls.length, 0);
});

test('查询失败写动作失败记录并释放锁，重试可恢复', async t => {
    const f = await fixture(t); f.execute = async () => { throw new AdbError('adb_failed', '设备拒绝操作', 502); };
    await assert.rejects(f.service.executeCommand({ id: 'memory', serial: 'PHONE_A' }), { code: 'adb_failed' });
    assert.ok(f.logs.some(entry => entry.action === 'command' && entry.ok === false && entry.code === 'adb_failed'));
    f.execute = async () => ({ stdout: 'ok', stderr: '' }); assert.equal((await f.service.executeCommand({ id: 'cpu', serial: 'PHONE_A' })).stdout, 'ok');
});

test('快照执行传递超时、输出上限与取消，取消后释放独占锁', async t => {
    const f = await fixture(t), controller = new AbortController(); let entered;
    const ready = new Promise(resolve => { entered = resolve; });
    f.execute = async (_args, options) => {
        assert.equal(options.signal, controller.signal); assert.equal(options.timeoutMs, 20000); assert.equal(options.maxBytes, 256 * 1024); entered();
        return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new AdbError('cancelled', '操作已取消', 499)), { once: true }));
    };
    const pending = f.service.executeCommand({ id: 'cpu', serial: 'PHONE_A' }, controller.signal); await ready;
    await assert.rejects(f.service.devices(), { code: 'busy' }); controller.abort(); await assert.rejects(pending, { code: 'cancelled' });
    assert.ok((await f.service.devices()).devices.length);
});

test('常用 API 保留本机/请求头和字段限制，旧内置命令不可执行', async t => {
    const f = await fixture(t), app = express(); app.use(express.json()); registerAndroidApi(app, { service: f.service });
    const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
    const base = `http://127.0.0.1:${server.address().port}/api/android`;
    const send = (body, headers = {}) => fetch(base + '/commands/execute', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Toolbox-Adb': '1', ...headers }, body: JSON.stringify(body) });
    assert.equal((await fetch(base + '/commands', { headers: { Origin: 'https://other.example' } })).status, 403);
    assert.equal((await (await fetch(base + '/commands')).json()).commands.length, 6);
    assert.equal((await send({ id: 'memory', serial: 'PHONE_A' }, { 'X-Toolbox-Adb': '' })).status, 403);
    assert.equal((await send({ id: 'memory', serial: 'PHONE_A', args: ['reboot'] })).status, 400);
    assert.equal((await send({ id: 'reboot', serial: 'PHONE_A', confirm: true })).status, 400);
    assert.equal((await send({ id: 'lock-home', serial: 'PHONE_A' })).status, 400); assert.equal(f.calls.length, 0);
    assert.equal((await send({ id: 'memory', serial: 'PHONE_A' })).status, 200);
});
