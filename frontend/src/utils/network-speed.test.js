import test from 'node:test';
import assert from 'node:assert/strict';
import { networkBytes, networkBits, networkChart, networkTrafficDelta } from './network-speed.js';
test('速度换算覆盖零、小数、KB/MB 与字节/比特差异', () => {
    assert.equal(networkBytes(0, true).text, '0 B/s'); assert.equal(networkBytes(0.5, true).unit, 'B/s');
    assert.equal(networkBytes(1024, true).text, '1.00 KB/s'); assert.equal(networkBytes(1048576).text, '1.00 MB');
    assert.equal(networkBits(1000000000), '1.00 Gbps'); assert.equal(networkBits(1048576 * 8), '8.39 Mbps');
});
test('未采样、负值和非有限值不冒充零速', () => {
    for (const value of [null, undefined, -1, NaN, Infinity]) { assert.equal(networkBytes(value, true).text, '—'); assert.equal(networkBits(value), '—'); }
});
test('网页漏掉中间采样仍按累计计数精确汇总流量与观察时间', () => {
    const before = { id: 'ethernet', counterEpoch: 1, counterTimeMs: 1000, receivedBytes: '18446744073709550000', sentBytes: '100' };
    const after = { ...before, counterTimeMs: 4000, receivedBytes: '18446744073709551024', sentBytes: '868' };
    assert.deepEqual(networkTrafficDelta(before, after), { download: 1024, upload: 768, duration: 3000 });
});
test('换卡、复位、回拨、坏计数不跨观察基线累计', () => {
    const before = { id: 'a', counterEpoch: 1, counterTimeMs: 1000, receivedBytes: '100', sentBytes: '100' };
    for (const extra of [{ id: 'b' }, { counterEpoch: 2 }, { counterTimeMs: 999 }, { receivedBytes: '2' }, { receivedBytes: 'bad' }]) assert.equal(networkTrafficDelta(before, { ...before, counterTimeMs: 2000, ...extra }), null);
    assert.equal(networkTrafficDelta(null, before), null);
});
test('趋势按实际时间定位，仅保留六十秒，断流分段', () => {
    const chart = networkChart([{ time: 1, down: 1, up: 1 }, { time: 30000, down: 1024, up: 2048, gap: true }, { time: 40000, down: 2000, up: 1000 }, { time: 60000, down: 0, up: 0, gap: true }, { time: 70000, down: 2000, up: 500 }], 70000);
    assert.equal(chart.count, 4); assert.equal(chart.down.length, 2); assert.match(chart.down[0], /^320\.00,/); assert.ok(chart.ceiling > 2048); assert.equal(chart.up.length, 2);
});
