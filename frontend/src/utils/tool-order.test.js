import test from 'node:test';
import assert from 'node:assert/strict';
import {
    TOOL_ORDER_STORAGE_KEY,
    loadToolOrder,
    moveTool,
    orderTools,
    readToolOrder,
    saveToolOrder
} from './tool-order.js';

const tools = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

test('orderTools ignores unknown and duplicate ids while retaining new tools', () => {
    const result = orderTools(tools, ['c', 'missing', 'c', 'a']);
    assert.deepEqual(result.map((tool) => tool.id), ['c', 'a', 'b']);
    assert.deepEqual(tools.map((tool) => tool.id), ['a', 'b', 'c']);
});

test('moveTool places the source before target without mutating input', () => {
    const result = moveTool(tools, 'c', 'a');
    assert.deepEqual(result.map((tool) => tool.id), ['c', 'a', 'b']);
    assert.deepEqual(tools.map((tool) => tool.id), ['a', 'b', 'c']);
    assert.deepEqual(moveTool(tools, 'missing', 'a').map((tool) => tool.id), ['a', 'b', 'c']);
});

test('拖放可以直接移到列表末尾，也能向前或向后移动', () => {
    assert.deepEqual(moveTool(tools, 'a', 'c', 'after').map(tool => tool.id), ['b', 'c', 'a']);
    assert.deepEqual(moveTool(tools, 'c', 'a', 'after').map(tool => tool.id), ['a', 'c', 'b']);
    assert.deepEqual(moveTool(tools, 'a', 'c').map(tool => tool.id), ['b', 'a', 'c']);
    assert.deepEqual(moveTool(tools, 'a', 'a', 'after'), tools);
});

test('tool order storage is validated and round trips through injected storage', () => {
    const values = new Map([[TOOL_ORDER_STORAGE_KEY, JSON.stringify(['c', 'c', 1, 'a'])]]);
    const storage = {
        getItem: (key) => values.get(key) || null,
        setItem: (key, value) => values.set(key, value)
    };
    assert.deepEqual(readToolOrder(storage), ['c', 'a']);
    assert.equal(saveToolOrder(tools, storage), true);
    assert.deepEqual(loadToolOrder(tools, storage).map((tool) => tool.id), ['a', 'b', 'c']);
});

test('corrupt tool order falls back to the default order', () => {
    const storage = { getItem: () => '{broken' };
    assert.deepEqual(readToolOrder(storage), []);
    assert.deepEqual(loadToolOrder(tools, storage).map((tool) => tool.id), ['a', 'b', 'c']);
});

test('浏览器拒绝写入时返回失败，界面可明确提示并重试', () => {
    const storage = { setItem: () => { throw new Error('quota exceeded'); } };
    assert.equal(saveToolOrder(tools, storage), false);
    assert.deepEqual(tools.map(tool => tool.id), ['a', 'b', 'c']);
});
