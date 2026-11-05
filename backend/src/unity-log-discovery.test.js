import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { buildScanPlan, parseDiscovery, probeLogDevice, scanLogDevices } from './unity-log-discovery.js';
import { ipv4Number, isPrivateIpv4, readLogJson, validatePort } from './unity-log-http.js';

const interfaces = (address = '192.168.10.20', netmask = '255.255.255.0') => ({ WiFi: [{ address, netmask, family: 'IPv4', internal: false }] });
const metadata = (requestId = 'request', port = 17523) => ({ protocol: 'hhh-startup-log', protocolVersion: 1, requestId, httpPort: port, deviceId: 'a'.repeat(32),
    deviceName: '测试 iPad', deviceModel: 'iPad', platform: 'IPhonePlayer', appId: 'com.test.app', appVersion: '1.0', sessionTicket: 'b'.repeat(64), expiresInSeconds: 120 });

test('局域网 IPv4 严格校验，拒绝域名、前导零、公网与映射地址', () => {
    for (const ip of ['192.168.1.1', '10.0.0.2', '172.31.9.2', '169.254.1.1']) assert.equal(isPrivateIpv4(ip), true);
    for (const ip of ['127.0.0.1', '8.8.8.8', '192.168.01.1', '192.168.1.256', 'localhost', '::ffff:192.168.1.1', '10.0.0.1/path']) assert.equal(isPrivateIpv4(ip), false);
    assert.equal(ipv4Number('255.255.255.255'), 4294967295);
    for (const port of [0, 1023, 65536, '17523', NaN]) assert.throws(() => validatePort(port));
});
test('按真实 /23 掩码搜索，覆盖两个 /24 且排除网络及广播', () => {
    const plan = buildScanPlan(interfaces('192.168.100.39', '255.255.254.0'));
    assert.equal(plan.targets.length, 510); assert.equal(plan.networks[0].limited, false);
    assert.ok(plan.targets.some(t => t.address === '192.168.101.250'));
    assert.ok(!plan.targets.some(t => ['192.168.100.0', '192.168.101.255'].includes(t.address)));
});
test('大网段有界且先搜本机所在 /24，不把私网外地址加入搜索', () => {
    const plan = buildScanPlan(interfaces('10.15.20.5', '255.0.0.0'));
    assert.equal(plan.targets.length, 1024); assert.equal(plan.networks[0].limited, true);
    assert.equal(plan.targets[0].address, '10.15.20.0');
    assert.ok(plan.targets.every(t => isPrivateIpv4(t.address)));
    assert.equal(buildScanPlan(interfaces('10.1.1.1', '0.0.0.0')).targets.length, 0);
});
test('跳过 IPv6、回环、公网和非法掩码，重叠网卡去重', () => {
    const local = interfaces(); const plan = buildScanPlan({ ...local, Duplicate: local.WiFi, Invalid: [{ address: '10.0.0.1', netmask: '255.0.255.0', family: 'IPv4' }], Public: [{ address: '8.8.8.8', netmask: '255.255.255.0', family: 'IPv4' }] });
    assert.equal(plan.targets.length, 254); assert.equal(new Set(plan.targets.map(t => t.address)).size, 254);
});
test('指定 IP 必须在本机局域网掩码范围，不能扫描公网和其它网段', () => {
    assert.equal(buildScanPlan(interfaces(), 1024, '192.168.10.250').targets.length, 1);
    for (const ip of ['8.8.8.8', '10.0.0.1', '192.168.10.255']) assert.throws(() => buildScanPlan(interfaces(), 1024, ip));
});
test('验证发现协议、随机值、设备编号、票据与端口，不接受伪装服务', () => {
    assert.equal(parseDiscovery(metadata(), 'request', 17523).deviceName, '测试 iPad');
    for (const patch of [{ protocol: 'other' }, { protocolVersion: 2 }, { requestId: 'wrong' }, { httpPort: 80 }, { deviceId: '../x' }, { sessionTicket: 'short' }, { expiresInSeconds: 10000 }, { deviceName: 'a'.repeat(161) }, { appId: null }])
        assert.throws(() => parseDiscovery({ ...metadata(), ...patch }, 'request', 17523));
});
test('HTTP 探测发送专用头与新的随机值', async () => {
    let seen;
    const device = await probeLogDevice('192.168.1.2', 17523, undefined, 650, async options => {
        seen = options; const id = new URL('http://local' + options.path).searchParams.get('requestId'); return metadata(id);
    });
    assert.match(seen.path, /requestId=[a-f0-9]{32}$/); assert.equal(seen.headers['X-HHH-Log-Discovery'], '1'); assert.equal(device.address, '192.168.1.2');
});
test('搜索限制并发，按固定编号去重并返回实际覆盖', async () => {
    let active = 0, peak = 0;
    const result = await scanLogDevices({ interfaces: interfaces(), maxTargets: 12, concurrency: 3, probe: async address => {
        active++; peak = Math.max(peak, active); await new Promise(resolve => setTimeout(resolve, 2)); active--; return { deviceId: 'same', deviceName: '设备', address };
    } });
    assert.equal(peak, 3); assert.equal(result.devices.length, 1); assert.equal(result.checked, 12); assert.equal(result.networks[0].limited, true);
});
test('搜索支持取消与总时限，取消后不继续探测', async () => {
    const probe = (_address, _port, signal) => new Promise((resolve, reject) => { signal.addEventListener('abort', () => reject(signal.reason), { once: true }); });
    const result = await scanLogDevices({ interfaces: interfaces(), probe, concurrency: 2, deadline: 15 });
    assert.equal(result.timedOut, true); assert.equal(result.checked, 2);
    const controller = new AbortController(); const task = scanLogDevices({ interfaces: interfaces(), probe, concurrency: 2, signal: controller.signal }); controller.abort();
    await assert.rejects(task); await assert.rejects(scanLogDevices({ interfaces: {} }), { code: 'no_network' });
});
async function withServer(t, handler) {
    const server = http.createServer(handler); server.listen(0, '127.0.0.1'); await once(server, 'listening'); t.after(() => { server.closeAllConnections(); server.close(); });
    return { address: '127.0.0.1', port: server.address().port, path: '/api/files', allowLoopback: true };
}
test('HTTP 不跟重定向、不接受超限响应和非 JSON', async t => {
    for (const [status, headers, body] of [[302, { Location: 'http://8.8.8.8/' }, ''], [200, { 'Content-Length': '10000' }, 'x'], [200, { 'Content-Type': 'text/html' }, '<html/>']]) {
        const options = await withServer(t, (_req, res) => { res.writeHead(status, headers); res.end(body); });
        await assert.rejects(readLogJson({ ...options, maxBytes: 100, timeout: 1000 }));
    }
});
test('HTTP 限制分块响应、取消读取与总时限', { timeout: 3000 }, async t => {
    const large = await withServer(t, (_req, res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.write('x'.repeat(200)); res.end(); });
    await assert.rejects(readLogJson({ ...large, maxBytes: 100 }));
    const hanging = await withServer(t, (_req, res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.write('{'); });
    await assert.rejects(readLogJson({ ...hanging, timeout: 30 }));
    const controller = new AbortController(); const task = readLogJson({ ...hanging, signal: controller.signal }); controller.abort(); await assert.rejects(task);
});
