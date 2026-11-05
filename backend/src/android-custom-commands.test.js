import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import express from 'express';
import { parseAndroidArguments, createAndroidCustomCommands } from './android-custom-commands.js';
import { AdbError, createAndroidAdbService } from './android-adb.js';
import { registerAndroidApi } from './android-api.js';

const input = (overrides = {}) => ({ title: '应用内存', category: '应用调试', description: '读取内存快照', arguments: 'shell dumpsys meminfo com.example.app', ...overrides });
function fixture(t) {
    const directory = mkdtempSync(join(tmpdir(), 'tt-adb-custom-'));
    t.after(() => {
        assert.equal(dirname(resolve(directory)), resolve(tmpdir())); assert.ok(basename(directory).startsWith('tt-adb-custom-'));
        rmSync(directory, { recursive: true, force: true });
    });
    const file = join(directory, 'android-commands.json'), logs = [], store = createAndroidCustomCommands({ file, log: entry => logs.push(entry) });
    return { directory, file, logs, store };
}
async function serviceFixture(t) {
    const f = fixture(t), configFile = join(f.directory, 'android-adb.json'), executable = join(f.directory, process.platform === 'win32' ? 'adb.exe' : 'adb');
    writeFileSync(executable, 'offline fixture', { mode: 0o700 });
    f.calls = []; f.devices = 'PHONE_A device\nOFF offline\nUNAUTH unauthorized\n';
    f.execute = async () => ({ stdout: 'fixture output', stderr: 'fixture warning' });
    const options = { configFile, env: {}, log: entry => f.logs.push(entry), runner: async (_exe, args, opts) => {
        f.calls.push({ args, opts });
        if (args[0] === 'version') return { stdout: 'Android Debug Bridge version 1.0.41', stderr: '' };
        if (args[0] === 'devices') return { stdout: f.devices, stderr: '' };
        return f.execute(args, opts);
    } };
    f.service = createAndroidAdbService(options); f.restart = () => createAndroidAdbService(options);
    await f.service.configure(executable); f.calls = []; f.logs.length = 0;
    t.after(() => f.service.dispose()); return f;
}

test('自定义参数解析单双引号、空参数及反斜杠路径', () => {
    assert.deepEqual(parseAndroidArguments('shell input text "hello world"'), ['shell', 'input', 'text', 'hello world']);
    assert.deepEqual(parseAndroidArguments("shell echo 'hello world' \"\""), ['shell', 'echo', 'hello world', '']);
    assert.deepEqual(parseAndroidArguments('shell echo "it\'s (ok)"'), ['shell', 'echo', "it's (ok)"]);
    assert.deepEqual(parseAndroidArguments('shell echo /sdcard/test C:\\Temp\\test'), ['shell', 'echo', '/sdcard/test', 'C:\\Temp\\test']);
    assert.deepEqual(parseAndroidArguments('shell echo "a\\\"b"'), ['shell', 'echo', 'a"b']);
});

test('拒绝 ADB 前缀、目标覆盖、主机命令、拼接及未闭合引号', () => {
    for (const value of ['', null, 'adb shell getprop', 'adb.exe shell getprop', '-s OTHER shell getprop', '-H remote devices', 'connect 1.2.3.4:1234', 'disconnect', 'kill-server', 'pair 1.2.3.4:1234', 'shell', 'shell -s OTHER', 'shell echo "bad', 'shell echo a;reboot', 'shell echo a && reboot', 'shell echo a | cat', 'shell echo a > file', 'shell echo $(id)', 'shell echo `id`', 'shell echo a\nreboot', 'shell echo \0', 'x'.repeat(2049), 'shell echo ' + 'x '.repeat(64)]) {
        assert.throws(() => parseAndroidArguments(value), { code: 'invalid_input' }, String(value));
    }
});

test('首次为空，创建/编辑/重启读取/删除持久化且不残留临时文件', t => {
    const f = fixture(t); assert.deepEqual(f.store.list(), []);
    const first = f.store.save(input()).command;
    assert.ok(first.id.startsWith('custom-')); assert.equal(first.custom, true); assert.equal(first.requiresConfirmation, true);
    assert.equal(first.arguments, input().arguments); assert.equal(first.args, undefined);
    const restarted = createAndroidCustomCommands({ file: f.file }); assert.equal(restarted.list()[0].revision, first.revision);
    const second = restarted.save(input({ title: '应用内存快照', revision: first.revision }), first.id).command;
    assert.equal(second.id, first.id); assert.notEqual(second.revision, first.revision); assert.equal(f.store.list()[0].title, '应用内存快照');
    f.store.remove(second.id, { revision: second.revision, confirm: true });
    assert.deepEqual(restarted.list(), []); assert.deepEqual(readdirSync(f.directory), ['android-commands.json']);
});

test('名称/分类/参数/额外字段严格校验，保存失败不覆盖已有内容', t => {
    const f = fixture(t); f.store.save(input()); const before = readFileSync(f.file, 'utf8');
    for (const value of [input({ title: '' }), input({ title: 'x'.repeat(61) }), input({ category: 'x'.repeat(31) }), input({ description: 'x'.repeat(401) }), input({ arguments: 'adb shell getprop' }), input({ args: ['shell', 'id'] }), input({ title: 'bad\nname' }), input({ title: 23 }), [], null]) {
        assert.throws(() => f.store.save(value), { code: 'invalid_input' });
    }
    assert.equal(readFileSync(f.file, 'utf8'), before);
    assert.throws(() => f.store.save(input()), { code: 'invalid_input' });
    assert.equal(f.store.save(input({ title: '另一条', category: '' })).command.category, '自定义');
});

test('损坏/未知版本/重复记录/过大配置明确报错且拒绝覆盖', t => {
    const f = fixture(t); const record = f.store.save(input()).command;
    const { custom, requiresConfirmation, preview, ...saved } = record;
    for (const original of ['broken json', JSON.stringify({ version: 2, commands: [] }), JSON.stringify({ version: 1, commands: [{ ...saved, arguments: 'kill-server' }] }), JSON.stringify({ version: 1, commands: [saved, saved] }), ' '.repeat(1024 * 1024 + 1)]) {
        writeFileSync(f.file, original);
        assert.throws(() => f.store.list(), { code: 'config_error' });
        assert.throws(() => f.store.save(input()), { code: 'config_error' });
        assert.equal(readFileSync(f.file, 'utf8'), original);
    }
});

test('命令数量有上限，达到上限仍可编辑和删除', t => {
    const f = fixture(t), records = Array.from({ length: 100 }, (_, index) => ({ id: 'custom-' + randomUUID(), revision: randomUUID(), ...input({ title: '命令' + index }) }));
    writeFileSync(f.file, JSON.stringify({ version: 1, commands: records }));
    assert.throws(() => f.store.save(input()), { code: 'invalid_input' });
    const updated = f.store.save(input({ title: '命令0更新', revision: records[0].revision }), records[0].id).command;
    assert.equal(f.store.list().length, 100); f.store.remove(updated.id, { confirm: true, revision: updated.revision }); assert.equal(f.store.list().length, 99);
});

test('修改和删除校验版本；内置命令不可编辑或删除', t => {
    const f = fixture(t), record = f.store.save(input()).command;
    for (const revision of [undefined, 'stale']) {
        assert.throws(() => f.store.save(input({ revision }), record.id), { code: 'command_changed' });
        assert.throws(() => f.store.remove(record.id, { revision, confirm: true }), { code: 'command_changed' });
    }
    for (const confirm of [undefined, false, 'true', 1]) assert.throws(() => f.store.remove(record.id, { revision: record.revision, confirm }), { code: 'confirmation_required' });
    assert.throws(() => f.store.save(input({ revision: record.revision }), 'device-info'), { code: 'not_found' });
    assert.throws(() => f.store.remove('device-info', { revision: record.revision, confirm: true }), { code: 'not_found' });
    assert.equal(f.store.list().length, 1);
});

test('命令设置不依赖 ADB 配置或在线设备，重启仍能读取', async t => {
    const f = fixture(t), service = createAndroidAdbService({ configFile: join(f.directory, 'android-adb.json'), env: {}, log: () => {} });
    const saved = await service.saveCommand(input());
    assert.equal(service.getConfig().configured, false); assert.equal(service.commands().commands.length, 7);
    const restarted = createAndroidAdbService({ configFile: join(f.directory, 'android-adb.json'), env: {} });
    assert.equal(restarted.commands().commands.at(-1).id, saved.command.id);
    await assert.rejects(restarted.executeCommand({ id: saved.command.id, revision: saved.command.revision, serial: 'PHONE_A', confirm: true }), { code: 'not_configured' });
});

test('自定义执行只能用保存的 ID/版本及布尔确认，所有校验先于设备操作', async t => {
    const f = await serviceFixture(t), { command } = await f.service.saveCommand(input());
    for (const confirm of [undefined, false, 'true', 1]) await assert.rejects(f.service.executeCommand({ id: command.id, revision: command.revision, serial: 'PHONE_A', confirm }), { code: 'confirmation_required' });
    await assert.rejects(f.service.executeCommand({ id: command.id, serial: 'PHONE_A', confirm: true }), { code: 'command_changed' });
    assert.equal(f.calls.length, 0);
    await f.service.executeCommand({ id: command.id, revision: command.revision, serial: 'PHONE_A', confirm: true });
    assert.deepEqual(f.calls.map(call => call.args), [['devices', '-l'], ['-s', 'PHONE_A', 'shell', 'dumpsys', 'meminfo', 'com.example.app']]);
    assert.equal(f.calls.at(-1).opts.timeoutMs, 20000); assert.equal(f.calls.at(-1).opts.maxBytes, 256 * 1024);
});

test('带空格/引号/特殊字符的远端参数按字面量转义，不丢参数边界', async t => {
    const f = await serviceFixture(t), { command } = await f.service.saveCommand(input({ arguments: 'shell echo "it\'s (ok)" "hello world" ""' }));
    await f.service.executeCommand({ id: command.id, revision: command.revision, serial: 'PHONE_A', confirm: true });
    assert.deepEqual(f.calls.at(-1).args, ['-s', 'PHONE_A', 'shell', 'echo', "'it'\\''s (ok)'", "'hello world'", "''"]);
});

test('过期预览、已删除命令、离线/未授权设备均不能执行', async t => {
    const f = await serviceFixture(t), { command } = await f.service.saveCommand(input());
    for (const serial of ['OFF', 'UNAUTH', 'MISSING', '-s', 'PHONE_A;calc']) await assert.rejects(f.service.executeCommand({ id: command.id, revision: command.revision, serial, confirm: true }));
    const changed = (await f.service.saveCommand(input({ arguments: 'shell getprop ro.product.model', revision: command.revision }), command.id)).command;
    const count = f.calls.length;
    await assert.rejects(f.service.executeCommand({ id: command.id, revision: command.revision, serial: 'PHONE_A', confirm: true }), { code: 'command_changed' });
    await f.service.deleteCommand(changed.id, { confirm: true, revision: changed.revision });
    await assert.rejects(f.service.executeCommand({ id: changed.id, revision: changed.revision, serial: 'PHONE_A', confirm: true }), { code: 'not_found' });
    assert.equal(f.calls.length, count); assert.ok(f.calls.every(call => call.args[0] === 'devices'));
});

test('执行失败/取消释放锁，原文和设备输出不进入操作日志', async t => {
    const f = await serviceFixture(t), { command } = await f.service.saveCommand(input({ arguments: 'shell echo PRIVATE_VALUE' }));
    f.execute = async () => { throw new AdbError('adb_failed', 'PRIVATE_OUTPUT', 502); };
    const request = { id: command.id, revision: command.revision, serial: 'PHONE_A', confirm: true };
    await assert.rejects(f.service.executeCommand(request), { code: 'adb_failed' });
    const controller = new AbortController(); let entered;
    const ready = new Promise(resolve => { entered = resolve; });
    f.execute = async (_args, options) => { entered(); return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new AdbError('cancelled', 'cancelled', 499)), { once: true })); };
    const pending = f.service.executeCommand(request, controller.signal); await ready;
    await assert.rejects(f.service.saveCommand(input()), { code: 'busy' }); controller.abort(); await assert.rejects(pending, { code: 'cancelled' });
    f.execute = async () => ({ stdout: 'PRIVATE_OUTPUT', stderr: '' }); assert.equal((await f.service.executeCommand(request)).stdout, 'PRIVATE_OUTPUT');
    assert.ok(!JSON.stringify(f.logs).includes('PRIVATE_')); assert.ok(f.logs.some(item => item.action === 'command' && item.ok === false));
});

test('自定义 reboot 保留确认执行及设备重启结果', async t => {
    const f = await serviceFixture(t), { command } = await f.service.saveCommand(input({ title: '重启', arguments: 'reboot' }));
    const result = await f.service.executeCommand({ id: command.id, revision: command.revision, serial: 'PHONE_A', confirm: true });
    assert.deepEqual(f.calls.at(-1).args, ['-s', 'PHONE_A', 'reboot']); assert.equal(result.deviceRestarted, true);
});

test('自定义 API 保留本机来源、JSON、专用头及字段约束，覆盖增改查删与确认执行', async t => {
    const f = await serviceFixture(t), app = express(); app.use(express.json()); registerAndroidApi(app, { service: f.service });
    const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
    const base = `http://127.0.0.1:${server.address().port}/api/android/commands`;
    const send = (path, method, body, headers = {}) => fetch(base + path, { method, headers: { 'Content-Type': 'application/json', 'X-Toolbox-Adb': '1', ...headers }, body: JSON.stringify(body) });
    for (const headers of [{ Origin: 'https://other.example' }, { 'X-Toolbox-Adb': '' }, { 'Content-Type': 'text/plain' }, { 'Sec-Fetch-Site': 'cross-site' }]) assert.equal((await send('/custom', 'POST', input(), headers)).status, 403, JSON.stringify(headers));
    const badHost = await new Promise((resolve, reject) => {
        const request = httpRequest(base + '/custom', { method: 'POST', headers: { Host: 'evil.example', 'Content-Type': 'application/json', 'X-Toolbox-Adb': '1' } }, response => { response.resume(); response.on('end', () => resolve(response.statusCode)); });
        request.on('error', reject); request.end(JSON.stringify(input()));
    });
    assert.equal(badHost, 403);
    assert.equal((await send('/custom', 'POST', input({ args: ['shell', 'id'] }))).status, 400);
    const created = await send('/custom', 'POST', input()); assert.equal(created.status, 200); const { command } = await created.json();
    assert.equal((await (await fetch(base)).json()).commands.length, 7);
    assert.equal((await send('/execute', 'POST', { id: command.id, serial: 'PHONE_A', revision: command.revision })).status, 400);
    assert.equal((await send('/execute', 'POST', { id: command.id, serial: 'PHONE_A', revision: command.revision, confirm: true, arguments: 'shell id' })).status, 400);
    assert.equal((await send('/execute', 'POST', { id: command.id, serial: 'PHONE_A', revision: command.revision, confirm: true })).status, 200);
    const edited = await send('/custom/' + command.id, 'PUT', input({ title: '新名称', revision: command.revision })); assert.equal(edited.status, 200); const current = (await edited.json()).command;
    assert.equal((await send('/execute', 'POST', { id: command.id, serial: 'PHONE_A', revision: command.revision, confirm: true })).status, 409);
    assert.equal((await send('/custom/device-info', 'PUT', input({ revision: current.revision }))).status, 404);
    assert.equal((await send('/custom/' + command.id, 'DELETE', { revision: current.revision })).status, 400);
    assert.equal((await send('/custom/' + command.id, 'DELETE', { confirm: true, revision: current.revision })).status, 200);
    assert.equal((await (await fetch(base)).json()).commands.length, 6);
});
