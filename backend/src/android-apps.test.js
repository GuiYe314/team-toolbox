import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { createAndroidApps, parseAppProcesses, parseInstalledPackages, validatePackageName } from './android-apps.js';
import { createAndroidAdbService } from './android-adb.js';
import { registerAndroidApi } from './android-api.js';

function fixture() {
    const f = { calls: [], devices: [{ serial: 'PHONE', state: 'device' }], packages: 'package:com.example.app\npackage:android\n', path: 'package:/data/app/example/base.apk\n', ps: 'PID NAME\n1234 com.example.app\n5678 com.example.app:worker\n9876 com.example.app.other\n', fail: false };
    f.run = async (args, options) => {
        f.calls.push({ args, options }); if (f.fail) throw new Error('fixture request failed');
        return { stdout: args.includes('list') ? f.packages : args.includes('path') ? f.path : f.ps, stderr: '' };
    };
    f.service = createAndroidApps({ run: f.run, readDevices: async () => f.devices }); return f;
}

test('应用包名严格校验，允许系统包与常见包名，拒绝 Shell 字符和过长输入', () => {
    for (const value of ['com.example.app', 'android', 'com.example._app']) assert.equal(validatePackageName(value), value);
    for (const value of ['', null, 1, '-x', 'com.app;reboot', 'com.app\n', ' com.app', 'com..app', 'com/app', 'com.app:worker', 'a'.repeat(256)]) assert.throws(() => validatePackageName(value), { code: 'invalid_input' });
});

test('已安装应用解析去重、排序，拒绝路径及无效包名', () => {
    assert.deepEqual(parseInstalledPackages('package:com.z.app\r\npackage:com.a.app\npackage:com.z.app\npackage:/data/app.apk\npackage:com.bad;calc\n'), ['com.a.app', 'com.z.app']);
});

test('运行状态只匹配主进程和包名冒号子进程，排除相似前缀及非法 PID', () => {
    assert.deepEqual(parseAppProcesses('PID NAME\n20 com.test\n10 com.test:worker\n30 com.test.other\n40 com.test2\n0 com.test\n999999999999 com.test\n20 com.test\n', 'com.test'), [{ pid: '10', name: 'com.test:worker' }, { pid: '20', name: 'com.test' }]);
    assert.deepEqual(parseAppProcesses('PID NAME\n10 other.app\n', 'com.test'), []);
    const longName = 'com.example.' + 'long'.repeat(40);
    assert.equal(parseAppProcesses('PID NAME\n88 ' + longName + ':worker\n', longName)[0].name, longName + ':worker');
});

test('应用列表与状态使用固定只读参数、明确设备、超时及输出限制', async () => {
    const f = fixture(), signal = new AbortController().signal;
    const list = await f.service.list('PHONE', signal); assert.deepEqual(list.packages, ['android', 'com.example.app']); assert.equal(list.truncated, false);
    const app = await f.service.status('PHONE', 'com.example.app', signal);
    assert.equal(app.running, true); assert.deepEqual(app.processes.map(p => p.pid), ['1234', '5678']); assert.ok(Date.parse(app.checkedAt));
    assert.deepEqual(f.calls.map(call => call.args), [['-s', 'PHONE', 'shell', 'pm', 'list', 'packages'], ['-s', 'PHONE', 'shell', 'pm', 'path', 'com.example.app'], ['-s', 'PHONE', 'shell', 'ps', '-A', '-w', '-o', 'PID,NAME']]);
    assert.ok(f.calls.every(call => call.options.signal === signal && call.options.timeoutMs <= 10000 && call.options.maxBytes <= 512 * 1024));
});

test('未运行应用返回空进程，空列表可识别，应用过多时限制结果', async () => {
    const f = fixture(); f.ps = 'PID NAME\n1 init\n'; assert.equal((await f.service.status('PHONE', 'com.example.app')).running, false);
    f.packages = ''; assert.deepEqual((await f.service.list('PHONE')).packages, []);
    f.packages = Array.from({ length: 2010 }, (_, index) => 'package:com.app.n' + index).join('\n');
    const list = await f.service.list('PHONE'); assert.equal(list.packages.length, 2000); assert.equal(list.truncated, true);
});

test('离线、未授权、非法设备与预先取消请求不会执行应用命令', async () => {
    const f = fixture(); f.devices = [{ serial: 'PHONE', state: 'unauthorized' }, { serial: 'OFF', state: 'offline' }];
    for (const serial of ['PHONE', 'OFF', 'MISSING']) await assert.rejects(f.service.list(serial), { code: 'device_unavailable' });
    await assert.rejects(f.service.list('PHONE;calc'), { code: 'invalid_input' });
    await assert.rejects(f.service.status('PHONE', 'com.app;calc'), { code: 'invalid_input' });
    await assert.rejects(f.service.processes('-x', 'com.app'), { code: 'invalid_input' });
    await assert.rejects(f.service.list('PHONE', AbortSignal.abort()), { code: 'cancelled' }); assert.equal(f.calls.length, 0);
});

test('应用消失、权限错误、无法识别的进程输出与运行错误反馈原因', async () => {
    const f = fixture(); f.path = ''; await assert.rejects(f.service.status('PHONE', 'com.example.app'), { code: 'app_unavailable' });
    f.packages = 'Error: permission denied'; await assert.rejects(f.service.list('PHONE'), { code: 'adb_failed' });
    f.ps = 'unsupported ps option'; await assert.rejects(f.service.processes('PHONE', 'com.example.app'), { code: 'adb_failed' });
    f.fail = true; await assert.rejects(f.service.list('PHONE'), /fixture request failed/);
});

test('应用 API 保留本机来源和专用请求头限制，拒绝额外参数，失败后可重试', async t => {
    const directory = mkdtempSync(join(tmpdir(), 'tt-apps-api-'));
    t.after(() => { assert.equal(dirname(resolve(directory)), resolve(tmpdir())); assert.ok(basename(directory).startsWith('tt-apps-api-')); rmSync(directory, { recursive: true, force: true }); });
    const path = join(directory, process.platform === 'win32' ? 'adb.exe' : 'adb'); writeFileSync(path, 'fixture', { mode: 0o700 });
    const f = fixture(); const service = createAndroidAdbService({ configFile: join(directory, 'config.json'), env: {}, log: () => {}, runner: async (_path, args, options) => {
        if (args[0] === 'version') return { stdout: 'Android Debug Bridge version 1.0.41', stderr: '' };
        if (args[0] === 'devices') return { stdout: 'PHONE device\n', stderr: '' };
        return f.run(args, options);
    } });
    t.after(() => service.dispose()); await service.configure(path);
    const app = express(); app.use(express.json()); registerAndroidApi(app, { service });
    const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
    const base = `http://127.0.0.1:${server.address().port}/api/android`;
    const send = (path, body, headers = {}) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Toolbox-Adb': '1', ...headers }, body: JSON.stringify(body) });
    assert.equal((await send('/apps', { serial: 'PHONE' }, { Origin: 'https://other.example' })).status, 403);
    assert.equal((await send('/apps', { serial: 'PHONE' }, { 'X-Toolbox-Adb': '' })).status, 403);
    assert.equal((await send('/apps', { serial: 'PHONE', args: ['reboot'] })).status, 400);
    assert.equal((await send('/apps/status', { serial: 'PHONE', packageName: 'com.example.app', command: 'reboot' })).status, 400);
    assert.equal((await send('/apps/status', { serial: 'PHONE', packageName: 'com.bad;reboot' })).status, 400);
    assert.equal(f.calls.length, 0);
    assert.equal((await send('/apps', { serial: 'PHONE' })).status, 200);
    const result = await (await send('/apps/status', { serial: 'PHONE', packageName: 'com.example.app' })).json(); assert.equal(result.running, true);
    f.ps = 'broken'; assert.equal((await send('/apps/status', { serial: 'PHONE', packageName: 'com.example.app' })).status, 502);
    f.ps = 'PID NAME\n'; assert.equal((await (await send('/apps/status', { serial: 'PHONE', packageName: 'com.example.app' })).json()).running, false);
});
