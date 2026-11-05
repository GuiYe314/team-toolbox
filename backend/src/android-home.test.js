import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import express from 'express';
import { createAndroidHome, parseHomeActivities, validateHomeComponent } from './android-home.js';
import { AdbError, createAndroidAdbService } from './android-adb.js';
import { registerAndroidApi } from './android-api.js';

function fixture(options = {}) {
    const f = { calls: [], user: '10', homes: 'com.example.kiosk/.Home\ncom.android.launcher/.Launcher\n', current: 'com.android.launcher/.Launcher', devices: [{ serial: 'PHONE', state: 'device' }], applied: true, setOutput: 'Success\n' };
    f.run = async (args, opts) => {
        f.calls.push({ args, opts }); let stdout;
        if (args[3] === 'am') stdout = f.user;
        else if (args[5] === 'query-activities') stdout = f.homes;
        else if (args[5] === 'resolve-activity') stdout = f.current;
        else if (args[5] === 'set-home-activity') { stdout = f.setOutput; if (f.applied) f.current = args.at(-1); }
        else throw new Error('Unexpected fixture command');
        return { stdout, stderr: '' };
    };
    f.home = createAndroidHome({ run: (args, opts) => f.run(args, opts), readDevices: async () => f.devices, ...options });
    return f;
}
const request = (overrides = {}) => ({ serial: 'PHONE', component: 'com.example.kiosk/.Home', userId: 10, confirm: true, ...overrides });
const writes = f => f.calls.filter(call => call.args[5] === 'set-home-activity');

test('HOME 组件解析规范化短名称、去重且排除错误文本和注入', () => {
    assert.equal(validateHomeComponent('com.app/.Home'), 'com.app/com.app.Home');
    const parsed = parseHomeActivities('2 activities found:\ncom.app/.Home\ncom.app/com.app.Home\ncom.other/com.other.Launcher\nbad;reboot/.Main\nError: denied\n');
    assert.deepEqual(parsed.map(item => item.component), ['com.app/com.app.Home', 'com.other/com.other.Launcher']);
    for (const value of ['', null, 'com.app', 'com.app/.Main;reboot', '-s/.Home', 'com.app/.Main\n', 'com.app//Home', 'com..app/.Home']) assert.throws(() => validateHomeComponent(value), { code: 'invalid_input' });
});

test('候选读取指定在线设备、当前用户和 HOME Intent，不猜测普通应用', async () => {
    const f = fixture(), result = await f.home.list('PHONE');
    assert.equal(result.userId, 10); assert.equal(result.serial, 'PHONE'); assert.equal(result.homes.length, 2);
    assert.equal(result.currentHome, 'com.android.launcher/com.android.launcher.Launcher');
    assert.deepEqual(f.calls.map(call => call.args), [
        ['-s', 'PHONE', 'shell', 'am', 'get-current-user'],
        ['-s', 'PHONE', 'shell', 'cmd', 'package', 'query-activities', '--brief', '--components', '--user', '10', '-a', 'android.intent.action.MAIN', '-c', 'android.intent.category.HOME'],
        ['-s', 'PHONE', 'shell', 'cmd', 'package', 'resolve-activity', '--brief', '--components', '--user', '10', '-a', 'android.intent.action.MAIN', '-c', 'android.intent.category.HOME']
    ]);
    assert.ok(f.calls.every(call => call.opts.signal && call.opts.timeoutMs <= 10000 && call.opts.maxBytes <= 256 * 1024));
});

test('无候选与未设默认值正常返回，不把错误输出当空列表', async () => {
    const f = fixture(); f.homes = 'No activities found'; f.current = 'No activity found';
    assert.deepEqual((await f.home.list('PHONE')).homes, []);
    for (const text of ['Error: unknown command', 'permission denied']) { f.homes = text; await assert.rejects(f.home.list('PHONE'), { code: 'adb_failed' }); }
    f.homes = 'com.app/.Home'; f.current = 'Error: denied'; await assert.rejects(f.home.list('PHONE'), { code: 'adb_failed' });
});

test('校验设备、Android 用户、组件和布尔确认，失败时不发送修改', async () => {
    const f = fixture();
    for (const confirm of [undefined, false, 'true', 1]) await assert.rejects(f.home.set(request({ confirm })), { code: 'confirmation_required' });
    for (const userId of [-1, null, '10', 1.5, 2147483648]) await assert.rejects(f.home.set(request({ userId })), { code: 'invalid_input' });
    for (const serial of ['', '-s', 'PHONE;calc']) await assert.rejects(f.home.set(request({ serial })), { code: 'invalid_input' });
    f.devices = [{ serial: 'PHONE', state: 'unauthorized' }]; await assert.rejects(f.home.set(request()), { code: 'device_unavailable' });
    f.devices = [{ serial: 'PHONE', state: 'offline' }]; await assert.rejects(f.home.list('PHONE'), { code: 'device_unavailable' }); assert.equal(writes(f).length, 0);
});

test('当前用户变化、非 HOME 应用及候选移除时拒绝修改', async () => {
    const f = fixture(); f.user = '11'; await assert.rejects(f.home.set(request()), { code: 'home_changed' });
    f.user = '10'; await assert.rejects(f.home.set(request({ component: 'com.normal/.MainActivity' })), { code: 'home_unavailable' });
    f.homes = 'com.android.launcher/.Launcher'; await assert.rejects(f.home.set(request()), { code: 'home_unavailable' }); assert.equal(writes(f).length, 0);
});

test('设置前重新查询候选，设置后核对默认 HOME 包，可恢复原桌面', async () => {
    const f = fixture(); const result = await f.home.set(request());
    assert.deepEqual(writes(f)[0].args, ['-s', 'PHONE', 'shell', 'cmd', 'package', 'set-home-activity', '--user', '10', 'com.example.kiosk/com.example.kiosk.Home']);
    assert.equal(result.currentHome, 'com.example.kiosk/com.example.kiosk.Home');
    assert.ok(f.calls.findIndex(call => call.args[5] === 'query-activities') < f.calls.findIndex(call => call.args[5] === 'set-home-activity'));
    assert.equal((await f.home.set(request({ component: 'com.android.launcher/.Launcher' }))).currentHome, 'com.android.launcher/com.android.launcher.Launcher');
});

test('系统可按同包其他 HOME 入口决定角色，包不同则不能显示成功', async () => {
    const f = fixture(), original = f.run;
    f.run = async (args, options) => { const result = await original(args, options); if (args[5] === 'set-home-activity') f.current = 'com.example.kiosk/.AlternateHome'; return result; };
    assert.equal((await f.home.set(request())).currentHome, 'com.example.kiosk/com.example.kiosk.AlternateHome');
    const other = fixture(); other.applied = false; await assert.rejects(other.home.set(request()), { code: 'home_not_applied' });
});

test('错误/未确认输出拒绝成功，复查失败明确可能已修改，允许重新查询', async () => {
    const f = fixture();
    for (const text of ['Error: Failed to set default home.', '', 'Success\njava.lang.Exception']) { f.setOutput = text; await assert.rejects(f.home.set(request()), { code: 'adb_failed' }); }
    f.setOutput = 'Success'; const original = f.run;
    f.run = async (args, options) => { if (args[5] === 'resolve-activity') throw new AdbError('timeout', 'timeout', 504); return original(args, options); };
    await assert.rejects(f.home.set(request()), error => error.code === 'timeout' && error.message.includes('已发送桌面设置'));
    f.run = original; assert.ok((await f.home.list('PHONE')).currentHome.includes('com.example.kiosk'));
});

test('用户输出无效及过量候选不触发修改', async () => {
    const f = fixture();
    for (const value of ['', 'current user: 10', '10;id', '2147483648']) { f.user = value; await assert.rejects(f.home.set(request()), { code: 'adb_failed' }); }
    f.user = '10'; f.homes = Array.from({ length: 2001 }, (_, i) => 'com.app' + i + '/.Home').join('\n'); await assert.rejects(f.home.list('PHONE'), { code: 'adb_failed' }); assert.equal(writes(f).length, 0);
});

test('取消和总时限传递至进程读取并可恢复，无后台任务', async () => {
    const f = fixture(), original = f.run, controller = new AbortController();
    let markStarted;
    const started = new Promise(resolve => { markStarted = resolve; });
    const waitForAbort = async (_args, options) => new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(new AdbError('cancelled', 'cancelled', 499)), { once: true });
        markStarted();
    });
    f.run = waitForAbort;
    const pending = assert.rejects(f.home.list('PHONE', controller.signal), { code: 'cancelled' });
    // 等待读取真正开始再取消；并行构建时不能假设 setImmediate 会在 30ms 内执行。
    await started; controller.abort(); await pending;
    const expiring = fixture({ timeoutMs: 30 }); expiring.run = waitForAbort;
    // AbortSignal.timeout 不保持事件循环；用短期真实计时器维持测试运行。
    const keeper = setTimeout(() => {}, 5000); try { await assert.rejects(expiring.home.list('PHONE'), { code: 'timeout' }); } finally { clearTimeout(keeper); }
    f.run = original; assert.equal((await f.home.list('PHONE')).homes.length, 2);
});

test('HOME HTTP API 只接受本机设备和结构化字段，增删默认 HOME 无自由参数', async t => {
    const directory = mkdtempSync(join(tmpdir(), 'tt-home-api-'));
    t.after(() => { assert.equal(dirname(resolve(directory)), resolve(tmpdir())); assert.ok(basename(directory).startsWith('tt-home-api-')); rmSync(directory, { recursive: true, force: true }); });
    const executable = join(directory, process.platform === 'win32' ? 'adb.exe' : 'adb'); writeFileSync(executable, 'fixture', { mode: 0o700 });
    const f = fixture(), logs = [], service = createAndroidAdbService({ configFile: join(directory, 'adb.json'), env: {}, log: entry => logs.push(entry), runner: async (_exe, args, options) => {
        if (args[0] === 'version') return { stdout: 'Android Debug Bridge version 1.0.41', stderr: '' };
        if (args[0] === 'devices') return { stdout: 'PHONE device\n', stderr: '' }; return f.run(args, options);
    } });
    await service.configure(executable); t.after(() => service.dispose());
    const app = express(); app.use(express.json()); registerAndroidApi(app, { service });
    const server = await new Promise(resolve => { const value = app.listen(0, '127.0.0.1', () => resolve(value)); });
    t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
    const base = `http://127.0.0.1:${server.address().port}/api/android/commands`;
    const send = (path, body, headers = {}) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Toolbox-Adb': '1', ...headers }, body: JSON.stringify(body) });
    assert.equal((await send('/home-apps', { serial: 'PHONE' }, { Origin: 'https://evil.example' })).status, 403);
    assert.equal((await send('/home-apps', { serial: 'PHONE' }, { 'X-Toolbox-Adb': '' })).status, 403);
    assert.equal((await send('/home-apps', { serial: 'PHONE', userId: 0 })).status, 400);
    assert.equal((await (await send('/home-apps', { serial: 'PHONE' })).json()).homes.length, 2);
    assert.equal((await send('/execute', { id: 'lock-home', ...request({ confirm: false }) })).status, 400);
    assert.equal((await send('/execute', { id: 'lock-home', ...request(), args: ['reboot'] })).status, 400);
    assert.equal((await send('/execute', { id: 'lock-home', ...request({ component: 'com.bad/.Other' }) })).status, 409);
    const result = await send('/execute', { id: 'lock-home', ...request() }); assert.equal(result.status, 200); assert.match((await result.json()).message, /默认程序已设置/);
    const restore = await send('/execute', { id: 'unlock-home', ...request({ component: 'com.android.launcher/.Launcher' }) }); assert.equal(restore.status, 200); assert.match((await restore.json()).message, /默认桌面已恢复/);
    assert.ok(logs.some(entry => entry.action === 'command' && entry.ok === false)); assert.ok(!JSON.stringify(logs).includes('com.example.kiosk'));
});
