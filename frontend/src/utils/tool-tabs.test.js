import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeToolTabs, openToolTab, closeToolTab, readToolTabs, saveToolTabs, TOOL_TABS_KEY } from './tool-tabs.js';

test('工具标签只接受当前内置ID，去重且不接受地址或旧工具', () => {
    assert.deepEqual(normalizeToolTabs(['yoinks', 'toolbox', 'yoinks', 'artcraft', 'freellmapi', '/tools/qrcode', {}, 'qrcode']), ['yoinks', 'qrcode']);
    assert.deepEqual(normalizeToolTabs({}), []);
});
test('重复打开保持已有位置，新工具追加，不接收未知路由', () => {
    const initial = ['yoinks', 'qrcode'];
    assert.deepEqual(openToolTab(initial, 'yoinks'), initial); assert.deepEqual(openToolTab(initial, 'ratio-lock'), [...initial, 'ratio-lock']);
    assert.deepEqual(openToolTab(initial, 'unknown'), initial); assert.deepEqual(initial, ['yoinks', 'qrcode']);
});
test('关闭当前标签选择左邻或首个，最后回工具箱；关闭非当前不切页', () => {
    const ids = ['yoinks', 'qrcode', 'ratio-lock'];
    assert.deepEqual(closeToolTab(ids, 'qrcode', 'qrcode'), { ids: ['yoinks', 'ratio-lock'], activeId: 'yoinks' });
    assert.equal(closeToolTab(ids, 'yoinks', 'yoinks').activeId, 'qrcode');
    assert.equal(closeToolTab(ids, 'yoinks', 'ratio-lock').activeId, 'ratio-lock');
    assert.deepEqual(closeToolTab(['yoinks'], 'yoinks', 'yoinks'), { ids: [], activeId: 'toolbox' });
    assert.deepEqual(closeToolTab(ids, 'toolbox', 'toolbox'), { ids, activeId: 'toolbox' });
});
test('标签只存ID，刷新读取去重且损坏/禁用存储时可继续', () => {
    let raw; const storage = { getItem: key => { assert.equal(key, TOOL_TABS_KEY); return raw; }, setItem: (key, value) => { assert.equal(key, TOOL_TABS_KEY); raw = value; } };
    assert.ok(saveToolTabs(['qrcode', 'artcraft', 'qrcode'], storage)); assert.equal(raw, '["qrcode"]');
    assert.deepEqual(readToolTabs(storage), ['qrcode']); raw = 'bad'; assert.deepEqual(readToolTabs(storage), []);
    assert.equal(saveToolTabs(['qrcode'], null), false);
    assert.equal(saveToolTabs(['qrcode'], { setItem() { throw new Error('full'); } }), false);
    assert.deepEqual(readToolTabs({ getItem() { throw new Error('blocked'); } }), []);
});
