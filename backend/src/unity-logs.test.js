import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createUnityLogService, parseLogFiles } from './unity-logs.js';
import { UnityLogError } from './unity-log-http.js';
import { parseUnityLogs, filterUnityLogs } from '../../frontend/src/utils/unity-log-view.js';

const id = 'a'.repeat(32), ticket = 'b'.repeat(64), name = 'hhh_startup_20261105_120000_000_0123456789abcdef_00001.log';
const device = { deviceId: id, ticket, deviceName: '测试手机', deviceModel: 'iPad', platform: 'IPhonePlayer', appId: 'com.test', appVersion: '1', address: '192.168.1.5', port: 17523 };
const files = [{ name, bytes: 24, modifiedUtc: '2026-11-05T12:00:00Z' }];
function fixture(t, overrides = {}) {
    const calls = [];
    const service = createUnityLogService({ scan: async () => ({ devices: [{ ...device }], networks: [], checked: 1, planned: 1 }), probe: async () => ({ ...device }),
        readJson: async options => { calls.push(options); return options.path === '/api/files' ? { files } : { text: '中文日志\n堆栈', truncated: false }; }, ...overrides });
    t.after(() => service.dispose()); return { service, calls };
}
async function connect(service) { await service.discover(); return service.connect(id); }
test('发现与会话响应不含票据，设备按稳定编号选择', async t => {
    const { service, calls } = fixture(t); const result = await service.discover();
    assert.ok(!JSON.stringify(result).includes(ticket)); assert.equal(result.devices[0].deviceId, id);
    const session = await service.connect(id); assert.ok(!JSON.stringify(session).includes(ticket));
    assert.equal(calls[0].headers['X-HHH-Log-Session'], ticket); assert.equal(session.files[0].name, name);
    assert.equal((await service.preview(session.id, name)).text, '中文日志\n堆栈');
});
test('重新搜索更新同一设备 IP，已建立会话保留原目标', async t => {
    let address = device.address;
    const { service, calls } = fixture(t, { scan: async () => ({ devices: [{ ...device, address }] }), probe: async ip => ({ ...device, address: ip }) });
    const first = await connect(service); address = '192.168.1.99'; await service.discover(); const second = await service.connect(id);
    await service.files(first.id); await service.files(second.id);
    assert.equal(calls.at(-2).address, device.address); assert.equal(calls.at(-1).address, address);
});
test('过期发现和会话被拒绝，关闭、服务退出可重复执行', async t => {
    let now = 0; const { service } = fixture(t, { now: () => now }); const session = await connect(service);
    now = 120001; await assert.rejects(service.files(session.id), { code: 'session_expired' });
    now = 300001; await assert.rejects(service.connect(id), { code: 'device_missing' });
    service.close(session.id); service.close(session.id); service.dispose(); service.dispose(); await assert.rejects(service.discover(), { code: 'stopped' });
});
test('文件名、文件列表与预览响应有边界，不能访问任意文件', async t => {
    for (const body of [{ files: [{}] }, { files: [{ ...files[0], name: '../a.log' }] }, { files: [...files, ...files] }, { files: [{ ...files[0], bytes: -1 }] }, { files: [{ ...files[0], modifiedUtc: 'invalid' }] }]) assert.throws(() => parseLogFiles(body));
    const { service } = fixture(t, { readJson: async options => options.path === '/api/files' ? { files } : { text: 'x'.repeat(262145), truncated: false } });
    const session = await connect(service);
    await assert.rejects(service.preview(session.id, '../a.log'), { code: 'invalid_file' });
    await assert.rejects(service.preview(session.id, name), { code: 'invalid_response' });
});
test('票据过期仅为同一设备重新发现后重试一次', async t => {
    let failed = false, probes = 0;
    const { service, calls } = fixture(t, { probe: async () => { probes++; return { ...device, ticket: 'c'.repeat(64) }; }, readJson: async options => {
        calls.push(options); if (options.path !== '/api/files' && !failed) { failed = true; throw new UnityLogError('device_auth', 'expired'); }
        return options.path === '/api/files' ? { files } : { text: 'ok', truncated: false };
    } });
    const session = await connect(service); await service.preview(session.id, name); assert.equal(probes, 2);
});
test('IP 被其它设备占用时拒绝读取', async t => {
    const { service } = fixture(t, { probe: async () => ({ ...device, deviceId: 'c'.repeat(32) }) }); await service.discover();
    await assert.rejects(service.connect(id), { code: 'device_changed' });
});
test('文件轮换返回明确未找到，不把错误当空日志', async t => {
    const { service } = fixture(t, { readJson: async options => {
        if (options.path === '/api/files') return { files }; throw new UnityLogError('file_missing', '已清理', 404);
    } });
    const session = await connect(service); await assert.rejects(service.preview(session.id, name), { code: 'file_missing' });
});
test('会话容量与下载互斥，流结束后允许再次下载', async t => {
    const { service } = fixture(t, { openResponse: async () => ({ stream: Readable.from(['log data']), contentType: 'text/plain', length: 8 }) });
    const session = await connect(service);
    for (let i = 0; i < 7; i++) await service.connect(id);
    await assert.rejects(service.connect(id), { code: 'session_limit' });
    const first = await service.download(session.id, name, false); await assert.rejects(service.download(session.id, name, false), { code: 'download_busy' });
    let result = ''; for await (const chunk of first.stream) result += chunk; assert.equal(result, 'log data');
    const next = await service.download(session.id, name, false); next.stream.destroy();
});
test('关闭会话与服务退出会取消在途读取', async t => {
    let signal;
    const { service } = fixture(t, { readJson: async options => {
        if (options.path === '/api/files') return { files };
        signal = options.signal; return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
    } });
    const session = await connect(service); const task = service.preview(session.id, name); service.close(session.id);
    await assert.rejects(task); assert.equal(signal.aborted, true);
});
test('日志筛选整条正文与堆栈，HTML 保持原文且各错误等级一致', () => {
    const entries = parseUnityLogs('\uFEFF2026-11-05T12:00:00.1234567Z [Log] [thread:1] 普通\n2026-11-05T12:00:01Z [Error] [thread:2] <script>x</script>\nClass.中文方法()\n2026-11-05T12:00:02Z [Warning] 警告\n2026-11-05T12:00:03Z [Exception] 异常\n2026-11-05T12:00:04Z [Assert] 断言');
    assert.equal(entries.length, 5); assert.equal(filterUnityLogs(entries, 'error', '').length, 3);
    assert.equal(filterUnityLogs(entries, 'warning', '').length, 4); assert.equal(filterUnityLogs(entries, 'all', '中文方法').length, 1);
    assert.equal(entries[1].message, '<script>x</script>'); assert.equal(entries[0].thread, '1');
});
