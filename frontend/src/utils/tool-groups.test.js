import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOOLS, toolByRoute } from './tool-catalog.js';
import { defaultToolGroups, normalizeToolGroups, readToolGroups, saveToolGroups, assignToolGroup, deleteToolGroup, toolIsEnabled, groupNameError, TOOL_GROUPS_KEY } from './tool-groups.js';
import { orderTools } from './tool-order.js';

test('共享工具目录去重，移除两项工具且每个工具都有默认分组', () => {
    assert.ok(TOOLS.some(tool => tool.id === 'quick-calculation')); assert.equal(new Set(TOOLS.map(tool => tool.id)).size, TOOLS.length);
    assert.ok(!TOOLS.some(tool => ['freellmapi', 'artcraft'].includes(tool.id)));
    const layout = defaultToolGroups();
    for (const tool of TOOLS) { assert.equal(toolByRoute(tool.routeName), tool); assert.ok(toolIsEnabled(layout, tool.id)); }
    assert.equal(toolByRoute('tool-freellmapi'), undefined);
});
test('非法或未来版本偏好回到默认，空组列表仍有未分组', () => {
    for (const raw of [null, [], {}, { version: 2, groups: [] }, { version: 1, groups: [null] }]) assert.deepEqual(normalizeToolGroups(raw), defaultToolGroups());
    const empty = normalizeToolGroups({ version: 1, groups: [], assignments: {} });
    assert.equal(empty.groups.length, 1); assert.equal(empty.groups[0].id, 'ungrouped');
    assert.ok(Object.values(empty.assignments).every(id => id === 'ungrouped'));
});
test('过滤非法/重复分组与退休工具，保留开关折叠，错误归属回未分组', () => {
    const layout = normalizeToolGroups({ version: 1, groups: [
        { id: 'custom', name: '项目', enabled: false, collapsed: true }, { id: 'custom', name: '重复' },
        { id: '../bad', name: '非法' }, { id: 'another', name: '项目' }, { id: 'reserved', name: '未分组' },
    ], assignments: { yoinks: 'custom', 'phone-album': 'missing', artcraft: 'custom', freellmapi: 'custom' } });
    assert.deepEqual(layout.groups.map(group => group.id), ['custom', 'ungrouped']);
    assert.equal(layout.groups[0].collapsed, true); assert.equal(toolIsEnabled(layout, 'yoinks'), false);
    assert.equal(layout.assignments['phone-album'], 'ungrouped'); assert.equal(Object.keys(layout.assignments).length, TOOLS.length);
});
test('移动与删除分组只更改归属，保留所有工具且不修改旧对象', () => {
    const initial = defaultToolGroups(), moved = assignToolGroup(initial, 'yoinks', 'devices');
    assert.equal(initial.assignments.yoinks, 'media'); assert.equal(moved.assignments.yoinks, 'devices');
    assert.equal(assignToolGroup(initial, 'unknown', 'devices'), initial);
    assert.equal(assignToolGroup(initial, 'yoinks', 'unknown'), initial);
    const deleted = deleteToolGroup(moved, 'devices');
    for (const id of ['yoinks', 'android-wireless', 'unity-logs']) assert.equal(deleted.assignments[id], 'ungrouped');
    assert.equal(Object.keys(deleted.assignments).length, TOOLS.length); assert.equal(deleteToolGroup(initial, 'ungrouped'), initial);
});
test('分组名称校验中文、空白、长度和规范化重名', () => {
    assert.ok(groupNameError('   ', [])); assert.ok(groupNameError('长'.repeat(25), []));
    assert.ok(groupNameError('ａｂｃ', [{ id: 'a', name: 'ABC' }]));
    assert.equal(groupNameError(' 修改名称 ', [], ''), '');
    assert.equal(groupNameError('ABC', [{ id: 'a', name: 'ABC' }], 'a'), '');
});
test('读写分组偏好失败可恢复，存储仅含界面配置', () => {
    let raw; const storage = { getItem: key => { assert.equal(key, TOOL_GROUPS_KEY); return raw; }, setItem: (key, value) => { assert.equal(key, TOOL_GROUPS_KEY); raw = value; } };
    const layout = assignToolGroup(defaultToolGroups(), 'yoinks', 'devices');
    assert.ok(saveToolGroups(layout, storage)); assert.deepEqual(readToolGroups(storage), layout);
    raw = '{broken'; assert.deepEqual(readToolGroups(storage), defaultToolGroups());
    assert.equal(saveToolGroups(layout, null), false);
    assert.equal(saveToolGroups(layout, { setItem() { throw new Error('full'); } }), false);
    assert.deepEqual(readToolGroups({ getItem() { throw new Error('blocked'); } }), defaultToolGroups());
});
test('旧排序中的退休工具过滤，其余顺序与新增工具保留', () => {
    const tools = orderTools(TOOLS, ['artcraft', 'qrcode', 'freellmapi', 'yoinks', 'qrcode']);
    assert.equal(tools[0].id, 'qrcode'); assert.equal(tools[1].id, 'yoinks'); assert.equal(tools.length, TOOLS.length);
});
