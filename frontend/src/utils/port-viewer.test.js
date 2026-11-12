import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterPorts, portEndpoint, validatePortSnapshot } from './port-viewer.js';
const rows = [
    { protocol: 'TCP', localAddress: '127.0.0.1', localPort: 3000, remoteAddress: '0.0.0.0', remotePort: 0, state: 'Listen', pid: 123, processName: 'Node' },
    { protocol: 'TCP', localAddress: '::1', localPort: 13000, remoteAddress: '::1', remotePort: 3000, state: 'Established', pid: 456, processName: 'Browser' },
    { protocol: 'UDP', localAddress: '0.0.0.0', localPort: 53, remoteAddress: '', remotePort: 0, state: 'Bound', pid: 4, processName: '' }
];
test('监听与全部范围区分TCP连接及UDP绑定', () => {
    assert.equal(filterPorts(rows).length, 2); assert.equal(filterPorts(rows, { scope: 'all' }).length, 3);
    assert.equal(filterPorts(rows, { protocol: 'UDP' }).length, 1);
});
test('精确本地端口不匹配远端端口或数字子串', () => {
    assert.equal(filterPorts(rows, { port: '3000', scope: 'all' }).length, 1);
    assert.equal(filterPorts(rows, { port: '65536' }).length, 0); assert.equal(filterPorts(rows, { port: 'abc' }).length, 0);
});
test('关键词支持进程名、PID、IPv6和大小写', () => {
    assert.equal(filterPorts(rows, { query: ' node ' }).length, 1); assert.equal(filterPorts(rows, { query: '123' }).length, 1);
    assert.equal(filterPorts(rows, { query: '::1', scope: 'all' }).length, 1); assert.equal(portEndpoint('::1', 3000), '[::1]:3000');
});
test('拒绝无效时间、越界端口、协议和超大快照', () => {
    const sample = { state: 'ready', rows, sampledAt: new Date().toISOString(), truncated: false }; assert.strictEqual(validatePortSnapshot(sample), sample);
    for (const invalid of [{ ...sample, sampledAt: null }, { ...sample, rows: [{ ...rows[0], pid: -1 }] }, { ...sample, rows: Array(5001).fill(rows[0]) }, { ...sample, rows: [{ ...rows[0], protocol: 'HTTP' }] }]) assert.throws(() => validatePortSnapshot(invalid));
});
