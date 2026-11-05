import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { get as httpGet } from 'node:http';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import express from 'express';
import { AdbError, createAndroidAdbService, parseDevices, parseMdns, runAdbProcess, validateEndpoint } from './android-adb.js';
import { registerAndroidApi, requireLocalAndroidRequest } from './android-api.js';

const DEVICE_OUTPUT = 'List of devices attached\nUSB123 device product:pixel model:Pixel_8 device:shiba transport_id:1\n192.168.1.20:37123 device model:Pixel_9\nemulator-5554 offline\nUSB456 unauthorized\nadb-phone-x._adb-tls-connect._tcp device\n';
const MDNS_OUTPUT = 'List of discovered mdns services\nadb-phone _adb-tls-pairing._tcp 192.168.1.20:41001\nadb-phone _adb-tls-connect._tcp. 192.168.1.20:37123\nadb-phone _adb-tls-pairing._tcp 192.168.1.20:41001\ninvalid _adb-tls-pairing._tcp 999.1.2.3:123\nv6 _adb-tls-pairing._tcp [::1]:123\n';
const temporaryRoots = [];
after(() => {
    for (const root of temporaryRoots) {
        if (dirname(resolve(root)) !== resolve(tmpdir()) || !basename(root).startsWith('tt-adb-test-')) throw new Error('Unsafe test cleanup path');
        rmSync(root, { recursive: true, force: true });
    }
});

function fixture(overrides = {}) {
    const root = mkdtempSync(join(tmpdir(), 'tt-adb-test-'));
    temporaryRoots.push(root);
    const path = join(root, process.platform === 'win32' ? 'adb.exe' : 'adb');
    writeFileSync(path, 'test executable; never run', { mode: 0o700 });
    const configFile = join(root, 'config.json');
    const calls = [];
    const logs = [];
    let time = 1000;
    const service = createAndroidAdbService({ configFile, env: {}, now: () => time,
        log: (entry) => logs.push(entry), runner: async (executable, args, options) => {
            calls.push({ executable, args, options });
            if (overrides.runner) return overrides.runner(executable, args, options);
            return { stdout: args[0] === 'version' ? 'Android Debug Bridge version 1.0.41\n' :
                args[0] === 'devices' ? DEVICE_OUTPUT : args[0] === 'mdns' ? MDNS_OUTPUT :
                    args[0] === 'pair' ? 'Successfully paired to 192.168.1.20:41001' :
                        args[0] === 'connect' ? 'connected to 192.168.1.20:37123' : 'disconnected 192.168.1.20:37123', stderr: '' };
        } });
    return { service, path, configFile, calls, logs, expire: () => { time += 120001; } };
}

for (const endpoint of ['192.168.1.20:37123', '10.0.0.1:65535', '172.16.0.2:1']) {
    test(`IPv4 地址通过：${endpoint}`, () => assert.equal(validateEndpoint(endpoint), endpoint));
}
for (const endpoint of ['', null, {}, 'localhost:5555', '127.0.0.1:5555', '0.0.0.0:5555', '224.0.0.1:5555', '999.1.1.1:5555', '192.168.01.2:5555', '192.168.1.2:0', '192.168.1.2:65536', '[::1]:5555', '192.168.1.2:5555 & calc', '-s USB123']) {
    test(`拒绝非法地址：${JSON.stringify(endpoint)}`, () => assert.throws(() => validateEndpoint(endpoint), AdbError));
}

test('设备解析区分 USB、无线、mDNS、模拟器及未授权状态', () => {
    const devices = parseDevices(DEVICE_OUTPUT);
    assert.equal(devices.length, 5);
    assert.equal(devices.find((d) => d.serial === 'USB123').model, 'Pixel 8');
    assert.equal(devices.find((d) => d.serial === 'USB456').state, 'unauthorized');
    assert.equal(devices.find((d) => d.serial.startsWith('emulator')).connection, 'emulator');
    assert.equal(devices.filter((d) => d.connection === 'wireless').length, 2);
});

test('mDNS 区分连接与配对，去重并过滤无效地址', () => {
    const found = parseMdns(MDNS_OUTPUT);
    assert.equal(found.length, 2);
    assert.deepEqual(found.map((d) => d.kind), ['connect', 'pairing']);
    assert.notEqual(found[0].id, found[1].id);
});

test('ADB 路径验证版本并原子保存，重建服务仍可读取', async () => {
    const f = fixture();
    assert.equal(f.service.getConfig().configured, false);
    const result = await f.service.configure(f.path);
    assert.match(result.version, /Android Debug Bridge/);
    assert.deepEqual(f.calls[0].args, ['version']);
    assert.equal(JSON.parse(readFileSync(f.configFile, 'utf8')).path, f.path);
    const reloaded = createAndroidAdbService({ configFile: f.configFile, env: {} });
    assert.equal(reloaded.getConfig().path, f.path);
    await f.service.configure('');
    assert.equal(reloaded.getConfig().configured, false);
});

test('无效路径、非 ADB 文件与伪造版本不改变原配置', async () => {
    const f = fixture();
    await f.service.configure(f.path);
    const saved = readFileSync(f.configFile, 'utf8');
    for (const path of ['adb.exe', join(tmpdir(), 'cmd.exe'), f.path + '.missing', 123]) {
        await assert.rejects(f.service.configure(path), /路径|Platform|ADB/);
    }
    assert.equal(readFileSync(f.configFile, 'utf8'), saved);
    const fake = fixture({ runner: async () => ({ stdout: 'not adb', stderr: '' }) });
    await assert.rejects(fake.service.configure(fake.path), /版本/);
});

test('损坏配置明确报错，环境变量优先并禁止界面覆盖', async () => {
    const f = fixture();
    writeFileSync(f.configFile, '{invalid');
    assert.throws(() => f.service.getConfig(), /配置无法读取/);
    const service = createAndroidAdbService({ configFile: f.configFile, env: { ADB_PATH: f.path }, log: () => {} });
    assert.equal(service.getConfig().origin, 'env');
    await assert.rejects(service.configure(''), /环境变量/);
});

test('未配置时不运行任何设备命令', async () => {
    const f = fixture();
    await assert.rejects(f.service.devices(), /先配置/);
    assert.equal(f.calls.length, 0);
});

test('配对码只经 stdin，发现记录及配置和日志均不包含配对码', async () => {
    const f = fixture();
    await f.service.configure(f.path);
    const found = await f.service.discover();
    const target = found.services.find((d) => d.kind === 'pairing');
    const result = await f.service.pair(target.id, '012345');
    const call = f.calls.find((c) => c.args[0] === 'pair');
    assert.deepEqual(call.args, ['pair', '192.168.1.20:41001']);
    assert.equal(call.options.input, '012345\n');
    assert.equal(call.options.timeoutMs, 30000);
    assert.ok(!JSON.stringify(result).includes('012345'));
    assert.ok(!readFileSync(f.configFile, 'utf8').includes('012345'));
    assert.ok(!JSON.stringify(f.logs).includes('012345'));
    await assert.rejects(f.service.pair(target.id, '012345'), /重新搜索/);
});

test('拒绝未知、连接类型、过期服务与非六位配对码', async () => {
    const f = fixture(); await f.service.configure(f.path);
    const found = await f.service.discover();
    await assert.rejects(f.service.pair('arbitrary:5555', '123456'), /重新搜索/);
    await assert.rejects(f.service.pair(found.services[0].id, '123456'), /重新搜索/);
    const id = found.services[1].id;
    for (const code of ['12345', '12x456', '1234567', 123456]) await assert.rejects(f.service.pair(id, code), /六位数字/);
    f.expire(); await assert.rejects(f.service.pair(id, '123456'), /重新搜索/);
    assert.ok(!f.calls.some((c) => c.args[0] === 'pair'));
});

test('配对错误中回显的配对码被隐藏', async () => {
    const f = fixture({ runner: async (_exe, args) => {
        if (args[0] === 'version') return { stdout: 'Android Debug Bridge version 1.0.41' };
        if (args[0] === 'mdns') return { stdout: MDNS_OUTPUT };
        throw new Error('wrong code 654321');
    } });
    await f.service.configure(f.path);
    const found = await f.service.discover();
    await assert.rejects(f.service.pair(found.services[1].id, '654321'), (error) => !error.message.includes('654321'));
    assert.ok(!JSON.stringify(f.logs).includes('654321'));
});

test('连接使用结构化参数并刷新设备，断开始终带单台目标', async () => {
    const f = fixture(); await f.service.configure(f.path);
    const connected = await f.service.connect('192.168.1.20:37123');
    assert.equal(connected.devices.length, 5);
    assert.deepEqual(f.calls.find((c) => c.args[0] === 'connect').args, ['connect', '192.168.1.20:37123']);
    await f.service.disconnect('192.168.1.20:37123');
    assert.deepEqual(f.calls.find((c) => c.args[0] === 'disconnect').args, ['disconnect', '192.168.1.20:37123']);
    for (const serial of ['', 'USB123', 'emulator-5554', '192.168.1.22:5555', '-a']) await assert.rejects(f.service.disconnect(serial), AdbError);
    assert.equal(f.calls.filter((c) => c.args[0] === 'disconnect').length, 1);
});

test('exit 0 的连接失败仍报错，失败后可继续操作', async () => {
    const f = fixture({ runner: async (_exe, args) => ({ stdout: args[0] === 'version' ? 'Android Debug Bridge version 1.0.41' : 'failed to connect', stderr: '' }) });
    await f.service.configure(f.path);
    await assert.rejects(f.service.connect('192.168.1.20:5555'), /连接失败/);
    assert.deepEqual((await f.service.devices()).devices, []);
});

test('连接成功但刷新失败时明确报告部分成功', async () => {
    const f = fixture({ runner: async (_exe, args) => {
        if (args[0] === 'devices') throw new AdbError('adb_failed', 'refresh failure', 502);
        return { stdout: args[0] === 'version' ? 'Android Debug Bridge version 1.0.41' : 'connected to 192.168.1.20:5555' };
    } });
    await f.service.configure(f.path);
    const result = await f.service.connect('192.168.1.20:5555');
    assert.equal(result.devices, null); assert.match(result.warning, /操作成功.*刷新失败/);
});

test('并发操作拒绝，完成后解除占用', async () => {
    let release;
    const f = fixture({ runner: async (_exe, args) => {
        if (args[0] === 'version') return { stdout: 'Android Debug Bridge version 1.0.41' };
        return new Promise((resolvePromise) => { release = () => resolvePromise({ stdout: DEVICE_OUTPUT }); });
    } });
    await f.service.configure(f.path);
    const first = f.service.devices();
    await assert.rejects(f.service.discover(), /正在执行/);
    release(); await first;
    await f.service.configure('');
});

test('真实子进程 stdin、敏感输出脱敏及 Unicode 分块完整读取', async () => {
    const script = "process.stdin.on('data', d => {process.stdout.write(d); const b=Buffer.from('配对'); process.stdout.write(b.subarray(0,1)); setTimeout(()=>process.stdout.write(b.subarray(1)),5)})";
    const result = await runAdbProcess(process.execPath, ['-e', script], { input: '012345\n', secrets: ['012345'] });
    assert.match(result.stdout, /已隐藏/); assert.match(result.stdout, /配对/); assert.ok(!result.stdout.includes('012345'));
});

test('真实子进程超时、取消、输出上限和启动错误', async () => {
    await assert.rejects(runAdbProcess(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { timeoutMs: 150 }), { code: 'timeout' });
    const controller = new AbortController();
    const pending = runAdbProcess(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { signal: controller.signal });
    controller.abort(); await assert.rejects(pending, { code: 'cancelled' });
    await assert.rejects(runAdbProcess(process.execPath, ['-e', "process.stdout.write('x'.repeat(4096))"], { maxBytes: 100 }), { code: 'output_limit' });
    await assert.rejects(runAdbProcess(join(tmpdir(), 'missing-tt-adb-binary'), []), { code: 'adb_failed' });
    await assert.rejects(runAdbProcess(process.execPath, ['-e', "process.stderr.write('code 999999');process.exitCode=1"], { secrets: ['999999'] }), (error) => !error.message.includes('999999'));
});

test('大量设备输出不会在解析前被截断', async () => {
    const result = await runAdbProcess(process.execPath, ['-e', "for(let i=0;i<80;i++) console.log('USB'+i+' device model:Pixel_8 product:long_product_name')"]);
    assert.equal(parseDevices(result.stdout).length, 80);
});

test('HTTP API 校验请求边界、确认和错误；不会接收任意命令', async (t) => {
    const f = fixture(); const app = express(); app.use(express.json()); registerAndroidApi(app, { service: f.service });
    const server = await new Promise((resolvePromise) => { const s = app.listen(0, '127.0.0.1', () => resolvePromise(s)); });
    t.after(() => server.close());
    const base = `http://127.0.0.1:${server.address().port}/api/android`;
    const send = (path, body, headers = {}) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Toolbox-Adb': '1', ...headers }, body: JSON.stringify(body) });
    assert.equal((await fetch(base + '/config')).status, 200);
    assert.equal((await send('/discover', {}, { Origin: 'https://evil.example' })).status, 403);
    assert.equal((await send('/discover', {}, { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
    assert.equal((await send('/discover', {}, { 'X-Toolbox-Adb': '' })).status, 403);
    const wrongHostStatus = await new Promise((resolvePromise, reject) => {
        httpGet(base + '/config', { headers: { Host: 'evil.example' } }, (response) => {
            response.resume(); resolvePromise(response.statusCode);
        }).on('error', reject);
    });
    assert.equal(wrongHostStatus, 403);
    const configured = await fetch(base + '/config', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Toolbox-Adb': '1' }, body: JSON.stringify({ path: f.path }) });
    assert.equal(configured.status, 200);
    assert.equal((await send('/connect', { endpoint: ';calc' })).status, 400);
    assert.equal((await send('/disconnect', { serial: '192.168.1.20:37123' })).status, 400);
    assert.equal((await send('/disconnect', { serial: 'USB123', confirm: true })).status, 400);
    assert.equal((await send('/connect', { endpoint: '192.168.1.20:37123' })).status, 200);
    assert.equal((await send('/shell', { command: 'anything' })).status, 404);
});

test('真实远端地址、伪造转发头与空 Origin 被拒', () => {
    const response = { code: 0, status(code) { this.code = code; return this; }, json(body) { this.body = body; } };
    const remote = { method: 'GET', socket: { remoteAddress: '192.168.1.5' }, headers: { host: 'localhost:3000' }, get: (name) => name === 'x-forwarded-for' ? '127.0.0.1' : undefined };
    requireLocalAndroidRequest(remote, response, () => assert.fail('remote request accepted'));
    assert.equal(response.code, 403);
    remote.socket.remoteAddress = '127.0.0.1'; remote.get = (name) => name === 'origin' ? 'null' : undefined;
    requireLocalAndroidRequest(remote, response, () => assert.fail('null origin accepted'));
    assert.equal(response.code, 403);
});
