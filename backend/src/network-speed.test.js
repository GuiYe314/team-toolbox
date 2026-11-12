import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { request } from 'node:http';
import express from 'express';
import { createNetworkSpeedMonitor } from './network-speed.js';
import { registerNetworkSpeedApi } from './network-speed-api.js';
import { createToolAccess } from './tool-access.js';

const row = (extra = {}) => ({ id: 'ethernet', name: '以太网', description: 'Test adapter', connected: true, virtual: false, linkSpeedBps: 1e9, received: '10000', sent: '2000', ...extra });
function fixture(t, options = {}) {
    let now = 0;
    const children = [], calls = [], timers = new Set(), logs = [];
    const monitor = createNetworkSpeedMonitor({ platform: 'win32', clock: () => now, wallNow: () => '2026-11-11T08:00:00.000Z', log: value => logs.push(value),
        setTimer: callback => { const timer = { callback, unref() {} }; timers.add(timer); return timer; }, clearTimer: timer => timers.delete(timer),
        spawnProcess: (...args) => { calls.push(args); const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.killed = 0; child.kill = () => { child.killed++; child.emit('close', 0); }; children.push(child); return child; }, ...options });
    t.after(() => monitor.dispose());
    return { monitor, children, calls, logs, timers, advance(ms) { now += ms; }, tick() { for (const timer of [...timers]) timer.callback(); },
        emit(timeMs, adapters = [row()]) { children.at(-1).stdout.write(JSON.stringify({ timeMs, adapters }) + '\n'); } };
}

test('按需启动一个隐藏且禁用 Shell 的共享进程，快照不能篡改状态', t => {
    const h = fixture(t); assert.equal(h.calls.length, 0);
    assert.equal(h.monitor.snapshot().state, 'starting'); h.monitor.snapshot(); assert.equal(h.calls.length, 1);
    assert.equal(h.calls[0][2].shell, false); assert.equal(h.calls[0][2].windowsHide, true);
    const script = Buffer.from(h.calls[0][1].at(-1), 'base64').toString('utf16le');
    assert.match(script, /Get-NetAdapterStatistics/); assert.match(script, /Stopwatch/); assert.doesNotMatch(script, /Set-Net|Invoke-WebRequest|Start-Process/);
    h.emit(1000); const snapshot = h.monitor.snapshot(); snapshot.adapters[0].name = 'changed';
    assert.equal(h.monitor.snapshot().adapters[0].name, '以太网'); assert.equal(snapshot.adapters[0].downloadBps, null);
});
test('按源端实际采样时长计算速度，不把 stdout 到达间隔当固定一秒', t => {
    const h = fixture(t); h.monitor.snapshot(); h.emit(1000); h.emit(3000, [row({ received: '18192', sent: '4048' })]);
    const value = h.monitor.snapshot().adapters[0]; assert.equal(value.downloadBps, 4096); assert.equal(value.uploadBps, 1024); assert.equal(value.intervalMs, 2000);
});
test('同一数据没有流量时返回有效零速，不能与待采样混淆', t => {
    const h = fixture(t); h.monitor.snapshot(); h.emit(1000); h.emit(2000);
    assert.equal(h.monitor.snapshot().adapters[0].downloadBps, 0);
});
test('UTF-8 中文和 JSON 跨块仍正确解析', t => {
    const h = fixture(t); h.monitor.snapshot(); const text = Buffer.from(JSON.stringify({ timeMs: 1, adapters: [row()] }) + '\n');
    const at = text.indexOf(Buffer.from('太')) + 1; h.children[0].stdout.write(text.subarray(0, at)); h.children[0].stdout.write(text.subarray(at));
    assert.equal(h.monitor.snapshot().adapters[0].name, '以太网');
});
test('超过 Number 安全整数的 uint64 累计值仍精确计算小差值', t => {
    const h = fixture(t); h.monitor.snapshot(); h.emit(1000, [row({ received: '18446744073709550000' })]);
    h.emit(2000, [row({ received: '18446744073709551024' })]); assert.equal(h.monitor.snapshot().adapters[0].downloadBps, 1024);
});
for (const [name, middle] of [['计数复位', row({ received: '2' })], ['断开重连', row({ connected: false })], ['长采样空档', null]]) {
    test(name + '重新建立基线并更换计数代次', t => {
        const h = fixture(t); h.monitor.snapshot(); h.emit(1000); h.emit(2000, [row({ received: '12000' })]);
        const before = h.monitor.snapshot().adapters[0];
        if (middle) h.emit(3000, [middle]); else h.emit(20000, [row({ received: '20000' })]);
        const after = h.monitor.snapshot().adapters[0]; assert.equal(after.downloadBps, null); assert.notEqual(after.counterEpoch, before.counterEpoch);
        if (middle?.connected === false) { h.emit(4000); assert.equal(h.monitor.snapshot().adapters[0].downloadBps, null); }
    });
}
test('网卡移除/新加入不继承另一张网卡的速度，虚拟接口保持独立', t => {
    const h = fixture(t); h.monitor.snapshot(); h.emit(1); h.emit(1001, [row({ id: 'vpn', virtual: true, received: '999999' })]);
    const snapshot = h.monitor.snapshot(); assert.equal(snapshot.adapters.length, 1); assert.equal(snapshot.adapters[0].id, 'vpn'); assert.equal(snapshot.adapters[0].downloadBps, null);
    h.emit(2001, []); assert.equal(h.monitor.snapshot().state, 'empty');
});
for (const [name, data] of [
    ['非 JSON', 'bad'], ['非法 uint64', JSON.stringify({ timeMs: 1, adapters: [row({ received: '18446744073709551616' })] })],
    ['不精确的数值类型', JSON.stringify({ timeMs: 1, adapters: [row({ received: 123 })] })],
    ['重复网卡', JSON.stringify({ timeMs: 1, adapters: [row(), row()] })],
    ['网卡超限', JSON.stringify({ timeMs: 1, adapters: Array.from({ length: 65 }, (_, id) => row({ id: String(id) })) })],
    ['控制符', JSON.stringify({ timeMs: 1, adapters: [row({ name: 'bad\nname' })] })],
]) test('拒绝损坏采样：' + name, t => {
    const h = fixture(t); h.monitor.snapshot(); h.children[0].stdout.write(data + '\n');
    assert.equal(h.monitor.snapshot().state, 'error'); assert.equal(h.children[0].killed, 1);
});
for (const suffix of ['', '\n']) test('限制未完成或全空白大行 ' + JSON.stringify(suffix), t => {
    const h = fixture(t); h.monitor.snapshot(); h.children[0].stdout.write(' '.repeat(128 * 1024 + 1) + suffix);
    assert.equal(h.monitor.snapshot().state, 'error'); assert.equal(h.logs[0].code, 'output_limit');
});
test('stderr 超限/退出不暴露原始内容，五秒冷却后可恢复', t => {
    const h = fixture(t); h.monitor.snapshot(); h.children[0].stderr.write('private'.repeat(2000));
    assert.equal(h.monitor.snapshot().state, 'error'); assert.doesNotMatch(JSON.stringify(h.monitor.snapshot()) + JSON.stringify(h.logs), /private/);
    h.advance(4999); h.monitor.snapshot(); assert.equal(h.calls.length, 1);
    h.advance(1); h.monitor.snapshot(); assert.equal(h.calls.length, 2); h.emit(1000); assert.equal(h.monitor.snapshot().state, 'ready');
    h.children[1].emit('close', 1); assert.equal(h.monitor.snapshot().state, 'error');
});
test('异步 spawn 错误被捕获，退出后迟到输出不能恢复为正常', t => {
    const h = fixture(t); h.monitor.snapshot(); h.children[0].emit('error', new Error('private'));
    h.emit(1); assert.equal(h.monitor.snapshot().state, 'error');
});
test('超过五秒的读数不作为实时速度返回，采样超时回收进程', t => {
    const h = fixture(t); h.monitor.snapshot(); h.emit(1); h.emit(1001, [row({ received: '12000' })]);
    h.advance(6000); const stale = h.monitor.snapshot(); assert.equal(stale.state, 'stale'); assert.equal(stale.adapters[0].downloadBps, null);
    h.advance(2000); h.tick(); assert.equal(h.monitor.snapshot().state, 'error'); assert.equal(h.children[0].killed, 1);
});
test('持续有请求但十五秒无首条输出时终止启动', t => {
    const h = fixture(t); h.monitor.snapshot(); h.advance(9000); h.monitor.snapshot(); h.advance(6000); h.tick();
    assert.equal(h.monitor.snapshot().state, 'error'); assert.equal(h.logs[0].code, 'sample_timeout');
});
test('多个页面轮询共享采集，最后请求十秒后释放，恢复重建基线', t => {
    const h = fixture(t); h.monitor.snapshot(); h.emit(1); h.advance(6000); h.monitor.snapshot(); h.tick(); assert.equal(h.children[0].killed, 0);
    h.advance(10000); h.tick(); assert.equal(h.children[0].killed, 1); assert.equal(h.timers.size, 0);
    h.monitor.snapshot(); assert.equal(h.calls.length, 2); h.emit(100000, [row({ received: '99999' })]); assert.equal(h.monitor.snapshot().adapters[0].downloadBps, null);
});
test('dispose 幂等，终止本轮进程和定时器且不再启动', t => {
    const h = fixture(t); h.monitor.snapshot(); h.monitor.dispose(); h.monitor.dispose(); h.monitor.snapshot();
    assert.equal(h.calls.length, 1); assert.equal(h.children[0].killed, 1); assert.equal(h.timers.size, 0); assert.equal(h.monitor.snapshot().state, 'stopped');
});
test('非 Windows 明确不支持且不创建进程', t => {
    const h = fixture(t, { platform: 'linux' }); assert.equal(h.monitor.snapshot().state, 'unsupported'); assert.equal(h.calls.length, 0);
});
test('同步启动失败有明确错误，不泄露异常内容', t => {
    const h = fixture(t, { spawnProcess() { throw new Error('private'); } });
    assert.equal(h.monitor.snapshot().state, 'error'); assert.doesNotMatch(JSON.stringify(h.monitor.snapshot()), /private/);
});

async function apiFixture(t, allowLan = false) {
    const app = express(); let reads = 0;
    const access = createToolAccess({ allowLan, interfaces: () => ({ eth: [{ family: 'IPv4', address: '192.168.100.39', netmask: '255.255.255.0' }] }) });
    registerNetworkSpeedApi(app, { access, monitor: { snapshot: () => { reads++; return { state: 'ready', adapters: [] }; } } });
    const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    t.after(() => new Promise(resolve => server.close(resolve)));
    return { reads: () => reads, call(path = '/api/network-speed/snapshot', headers = {}, method = 'GET') { return new Promise((resolve, reject) => {
        const req = request({ host: '127.0.0.1', port: server.address().port, path, headers: { 'X-Toolbox-Network-Speed': '1', ...headers }, method }, res => {
            let body = ''; res.setEncoding('utf8'); res.on('data', part => { body += part; }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: body ? JSON.parse(body) : null }));
        }); req.on('error', reject); req.end();
    }); } };
}
test('快照接口要求专用头，拒绝附加参数/写方法且不触发采集', async t => {
    const h = await apiFixture(t);
    for (const [path, headers, method] of [['/api/network-speed/snapshot', { 'X-Toolbox-Network-Speed': '' }, 'GET'], ['/api/network-speed/snapshot?command=anything', {}, 'GET'], ['/api/network-speed/snapshot', {}, 'POST']]) assert.equal((await h.call(path, headers, method)).status, 403);
    assert.equal(h.reads(), 0); const result = await h.call(); assert.equal(result.status, 200); assert.equal(result.headers['cache-control'], 'no-store'); assert.equal(result.headers['x-content-type-options'], 'nosniff'); assert.equal(h.reads(), 1);
});
test('同源/Host/转发头保护不可绕过，Lan 模式保留实际服务器 Host', async t => {
    const local = await apiFixture(t);
    for (const headers of [{ origin: 'https://evil.example' }, { host: 'evil.example', 'x-forwarded-host': 'localhost' }, { 'sec-fetch-site': 'cross-site' }, { host: '192.168.100.39' }]) assert.equal((await local.call(undefined, headers)).status, 403);
    assert.equal(local.reads(), 0);
    const lan = await apiFixture(t, true); assert.equal((await lan.call(undefined, { host: '192.168.100.39:5173', origin: 'http://192.168.100.39:5173' })).status, 200);
    assert.equal((await lan.call(undefined, { host: '192.168.100.39:5173', origin: 'http://localhost:5173' })).status, 403);
});
