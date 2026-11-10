import assert from 'node:assert/strict';
import test from 'node:test';
import { request } from 'node:http';
import express from 'express';
import { createToolAccess } from './tool-access.js';
import { registerAndroidApi, requireLocalAndroidRequest } from './android-api.js';
import { registerUnityLogApi, requireLocalUnityLogRequest } from './unity-log-api.js';
import { registerIntegrationApi, requireLocalIntegrationRequest } from './integration-api.js';

const interfaces = () => ({ ethernet: [{ family: 'IPv4', internal: false, address: '192.168.100.39', netmask: '255.255.254.0' }] });
const local = createToolAccess({ allowLan: false, interfaces });
const lan = createToolAccess({ allowLan: true, interfaces });
function req(peer = '192.168.101.15', headers = {}, path = '/config', type = 'application/json') {
    const value = { socket: { remoteAddress: peer }, headers: { host: '192.168.100.39:5173', ...headers }, method: 'POST', path, query: {} };
    value.get = name => value.headers[name.toLowerCase()];
    value.is = name => name === type;
    return value;
}

test('Local 模式保留回环，拒绝实际网段与 LAN Host', () => {
    assert.ok(local.allows(req('127.0.0.1', { host: 'localhost:5173' })));
    assert.ok(local.allows(req('::1', { host: '[::1]:3000' })));
    assert.equal(local.allows(req()), false);
    assert.equal(local.allows(req('127.0.0.1')), false);
    assert.deepEqual(local.addresses(), []);
});

test('Lan 使用实际掩码而非 /24，支持映射 IPv4 和回环代理保留的 LAN Host', () => {
    for (const peer of ['192.168.100.2', '192.168.101.250', '::ffff:192.168.101.15', '127.0.0.1']) assert.ok(lan.allows(req(peer)), peer);
    assert.deepEqual(lan.addresses(), ['192.168.100.39']);
});

test('Lan 拒绝公网、非本网段私网、链路本地、IPv6 和伪造转发来源', () => {
    for (const peer of ['8.8.8.8', '192.168.99.1', '192.168.102.1', '10.1.1.2', '169.254.1.2', '0.0.0.0', '::ffff:8.8.8.8', 'fe80::1', undefined]) {
        const value = req(peer, { 'x-forwarded-for': '192.168.100.2', 'x-forwarded-host': '192.168.100.39:5173' });
        if (peer === undefined) value.socket.remoteAddress = undefined;
        assert.equal(lan.allows(value), false, String(peer));
    }
});

test('10/8 与 172.16/12 私网仍须落入实际网卡网段', () => {
    const policy = createToolAccess({ allowLan: true, interfaces: () => ({ eth: [
        { family: 4, address: '10.2.0.10', netmask: '255.255.0.0' },
        { family: 'IPv4', address: '172.20.1.10', netmask: '255.255.255.0' },
    ] }) });
    assert.ok(policy.allows(req('10.2.10.1', { host: '10.2.0.10:3000' })));
    assert.ok(policy.allows(req('172.20.1.15', { host: '172.20.1.10' })));
    assert.equal(policy.allows(req('172.32.1.15', { host: '172.20.1.10' })), false);
    assert.equal(policy.allows(req('10.3.1.1', { host: '10.2.0.10' })), false);
});

test('Host 仅允许服务器真实私网 IP，拒绝 DNS 重绑定、地址别名及 URL 语法', () => {
    for (const host of ['evil.example', '192.168.100.40', 'localhost', '127.0.0.1', '8.8.8.8', '0.0.0.0', '192.168.100.39@evil.example', '192.168.100.39/', '192.168.100.39#x', '3232261159', '0xc0a86427', '192.168.100.39:bad', '']) assert.equal(lan.allows(req('192.168.100.2', { host })), false, host);
    assert.ok(lan.allows(req('192.168.100.2', { host: '192.168.100.39:80' })));
});

test('LAN Origin 必须与网页地址和端口一致，跨站及转发头不绕过', () => {
    assert.ok(lan.allows(req(undefined, { origin: 'http://192.168.100.39:5173', 'sec-fetch-site': 'same-origin' }), { browser: true }));
    for (const origin of ['http://192.168.100.39:3000', 'http://localhost:5173', 'https://evil.example', 'null', 'file:///x', 'http://192.168.100.39:5173/path']) assert.equal(lan.allows(req(undefined, { origin, 'x-forwarded-host': 'localhost' }), { browser: true }), false, origin);
    for (const site of ['cross-site', 'same-site']) assert.equal(lan.allows(req(undefined, { 'sec-fetch-site': site }), { browser: true }), false);
    // 从别处点击链接可以打开页面，页面内工具 API 仍受同源检查。
    assert.ok(lan.allows(req(undefined, { 'sec-fetch-site': 'cross-site' })));
});

test('保留本机开发跨端口 Origin 兼容，LAN 页面不能借本机代理绕过同源', () => {
    assert.ok(local.allows(req('::ffff:127.0.0.1', { host: '127.0.0.1:3000', origin: 'http://localhost:5173' }), { browser: true }));
    assert.equal(lan.allows(req('127.0.0.1', { origin: 'http://localhost:5173' }), { browser: true }), false);
    assert.equal(local.allows(req('127.0.0.1', { host: 'localhost', origin: 'ftp://localhost' }), { browser: true }), false);
});

test('内置、外网、无效或非连续掩码不能扩大可访问范围', () => {
    const policy = createToolAccess({ allowLan: true, interfaces: () => ({ invalid: [
        { family: 'IPv4', address: '192.168.100.39', netmask: '0.0.0.0' },
        { family: 'IPv4', address: '192.168.100.40', netmask: '255.0.255.0' },
        { family: 'IPv4', address: '192.168.100.41', netmask: '255.255.255.0', internal: true },
        { family: 'IPv4', address: '8.8.8.8', netmask: '255.255.255.0' },
    ] }) });
    assert.deepEqual(policy.addresses(), []); assert.equal(policy.allows(req()), false);
});

function guard(guardFn, value, policy = lan) {
    let status = 200, allowed = false;
    guardFn(value, { status(code) { status = code; return this; }, json() {}, setHeader() {} }, () => { allowed = true; }, policy);
    return { status, allowed };
}

for (const [name, guardFn, header] of [['ADB', requireLocalAndroidRequest, 'x-toolbox-adb'], ['Unity', requireLocalUnityLogRequest, 'x-toolbox-unity-log'], ['集成', requireLocalIntegrationRequest, 'x-toolbox-integration']]) {
    test(`${name} LAN 接口保留专用头、JSON 和浏览器来源要求`, () => {
        assert.ok(guard(guardFn, req(undefined, { [header]: '1' })).allowed);
        assert.equal(guard(guardFn, req()).status, 403);
        assert.equal(guard(guardFn, req(undefined, { [header]: '1' }, '/config', 'text/plain')).status, 403);
        assert.equal(guard(guardFn, req(undefined, { [header]: '1', origin: 'https://evil.example' })).status, 403);
        assert.equal(guard(guardFn, req(undefined, { [header]: '1' }), local).status, 403);
    });
}

test('ADB 仅两种 APK 专用端点接受 LAN 二进制，其余不放宽', () => {
    for (const path of ['/apk/install', '/apk/install-batch']) assert.ok(guard(requireLocalAndroidRequest, req(undefined, { 'x-toolbox-adb': '1' }, path, 'application/octet-stream')).allowed);
    assert.equal(guard(requireLocalAndroidRequest, req(undefined, { 'x-toolbox-adb': '1' }, '/connect', 'application/octet-stream')).status, 403);
});

test('私网真实 TCP 请求可调用三工具，保留非法 Host/Origin/专用头拒绝', async t => {
    const access = createToolAccess({ allowLan: true }), address = access.addresses()[0];
    if (!address) return t.skip('没有私网 IPv4 网卡；模拟网段测试仍执行');
    const app = express(); app.use(access.middleware); app.use(express.json());
    registerAndroidApi(app, { access, service: { getConfig: () => ({ test: 'android' }) } });
    registerUnityLogApi(app, { access, service: { discover: () => ({ test: 'unity' }) } });
    registerIntegrationApi(app, { access, service: { freellmapi: { getConfig: () => ({ test: 'free' }) } }, log() {} });
    const server = await new Promise(resolve => { const value = app.listen(0, '0.0.0.0', () => resolve(value)); });
    t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
    const host = `${address}:${server.address().port}`;
    async function call(path, options = {}) {
        return new Promise((resolve, reject) => {
            const post = options.method === 'POST';
            const operation = request(`http://${host}${path}`, { localAddress: address, ...options, headers: { Origin: `http://${host}`, ...(post ? { 'Content-Type': 'application/json', 'Content-Length': '2' } : {}), ...options.headers } }, response => {
                response.resume(); response.on('end', () => resolve(response.statusCode));
            });
            operation.on('error', reject); operation.end(post ? '{}' : undefined);
        });
    }
    assert.equal(await call('/api/android/config'), 200);
    assert.equal(await call('/api/integrations/freellmapi/config'), 200);
    assert.equal(await call('/api/unity-logs/discover', { method: 'POST', headers: { 'X-Toolbox-Unity-Log': '1' } }), 200);
    assert.equal(await call('/api/unity-logs/discover', { method: 'POST' }), 403);
    assert.equal(await call('/api/android/config', { headers: { Host: 'evil.example', 'X-Forwarded-Host': host } }), 403);
    assert.equal(await call('/api/android/config', { headers: { Origin: 'https://evil.example' } }), 403);
});
