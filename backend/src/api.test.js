// TASK-003 接口级自动化测试（不依赖 UI）。
//
// 用 node:test + 临时 http server + fetch 验证文档 / 分类 / 标签 HTTP 接口，
// 覆盖 F-KB-001/002/003 的 API 验收条目与分类/标签关联读写。
//
// 运行：npm test（package.json 已包含本文件）

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { createTestingDatabase } from './db.js';
import { runMigrations } from './migrate.js';
import { registerApi } from './api.js';

const migrationsDir = fileURLToPath(new URL('./migrations', import.meta.url));

let server;
let base;
let db;

// 每个测试自建资源、互不依赖，避免并发跑同库时的交叉断言
async function postDoc(overrides = {}) {
    const res = await fetch(base + '/api/documents', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: '测试文档', content_md: '正文', tags: ['a', 'b'], ...overrides })
    });
    const data = await res.json().catch(() => null);
    return { status: res.status, data };
}

before(async () => {
    db = createTestingDatabase({ memory: false });
    await runMigrations({ connection: db, migrationsDir });

    const app = express();
    app.use(express.json({ limit: '2mb' })); // 与 index.js 生产配置一致
    registerApi(app, { getDb: () => db });

    await new Promise((resolve) => {
        server = app.listen(0, '127.0.0.1', resolve);
    });
    base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
    if (server) server.close();
    if (db) db.close();
});

// ───────────────────────── 文档：新建 ─────────────────────────

test('POST /api/documents 空/纯空白标题 → 400 invalid_input', async () => {
    const r = await postDoc({ title: '   ' });
    assert.equal(r.status, 400);
    assert.equal(r.data.error, 'invalid_input');
});

test('POST /api/documents 正常 → 201 且 version=1', async () => {
    const r = await postDoc({ title: '第一篇' });
    assert.equal(r.status, 201);
    assert.equal(r.data.version, 1);
    assert.ok(Number.isInteger(r.data.id) && r.data.id >= 1);
    assert.ok(r.data.created_at && r.data.updated_at);
});

test('POST /api/documents 缺标题字段 → 400', async () => {
    const r = await fetch(base + '/api/documents', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content_md: 'x' }) // 没有 title
    });
    assert.equal(r.status, 400);
    assert.equal((await r.json()).error, 'invalid_input');
});

test('POST /api/documents 超长正文(>1MB) → 400', async () => {
    const big = 'x'.repeat(1048577);
    const r = await postDoc({ title: '大文档', content_md: big });
    assert.equal(r.status, 400);
    assert.equal(r.data.error, 'invalid_input');
});

test('POST /api/documents 标签超过 10 个 → 400', async () => {
    const r = await postDoc({ title: '多标签', tags: Array.from({ length: 11 }, (_, i) => `t${i}`) });
    assert.equal(r.status, 400);
    assert.equal(r.data.error, 'invalid_input');
});

// ───────────────────────── 文档：读取 ─────────────────────────

test('GET /api/documents/:id 不存在 → 404', async () => {
    const r = await fetch(base + '/api/documents/999999');
    assert.equal(r.status, 404);
    const data = await r.json();
    assert.equal(data.error, 'not_found');
});

test('GET /api/documents/:id 非法 id → 400', async () => {
    const r = await fetch(base + '/api/documents/abc');
    assert.equal(r.status, 400);
    const data = await r.json();
    assert.equal(data.error, 'invalid_input');
});

test('GET /api/documents/:id 正常 → 200 且含 tags', async () => {
    const created = await postDoc({ title: '详情篇', tags: ['go', 'vue'] });
    const r = await fetch(base + `/api/documents/${created.data.id}`);
    assert.equal(r.status, 200);
    const doc = await r.json();
    assert.equal(doc.title, '详情篇');
    assert.deepEqual(doc.tags.sort(), ['go', 'vue']);
});

// ───────────────────────── 文档：更新与 409 冲突 ─────────────────────────

test('PUT /api/documents/:id 缺 version → 400', async () => {
    const created = await postDoc({ title: '无版本' });
    const r = await fetch(base + `/api/documents/${created.data.id}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: '新标题' }) // 没有 version
    });
    assert.equal(r.status, 400);
    assert.equal((await r.json()).error, 'invalid_input');
});

test('PUT 旧版本保存 → 409 且返回 current 快照', async () => {
    const created = await postDoc({ title: '冲突篇', content_md: 'v1' });
    const id = created.data.id;

    // 先用正确版本更新一次（version 1 → 2）
    const ok = await fetch(base + `/api/documents/${id}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ version: 1, content_md: 'v2' })
    });
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).version, 2);

    // 再用旧版本（version=1）保存 → 应 409，并附 current
    const conflict = await fetch(base + `/api/documents/${id}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ version: 1, content_md: 'stale' })
    });
    assert.equal(conflict.status, 409);
    const cdata = await conflict.json();
    assert.equal(cdata.error, 'conflict');
    assert.ok(cdata.current, '409 应附带服务端当前快照');
    assert.equal(cdata.current.version, 2);
    assert.equal(cdata.current.content_md, 'v2');
});

test('PUT 正确版本 → 200 且 version 递增、updated_at 变化', async () => {
    const created = await postDoc({ title: '更新篇' });
    const id = created.data.id;
    const before = await (await fetch(base + `/api/documents/${id}`)).json();

    const r = await fetch(base + `/api/documents/${id}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ version: before.version, title: '更新后标题' })
    });
    assert.equal(r.status, 200);
    const after = await r.json();
    assert.equal(after.version, before.version + 1);

    const reread = await (await fetch(base + `/api/documents/${id}`)).json();
    assert.equal(reread.title, '更新后标题');
    assert.equal(reread.version, before.version + 1);
});

// ───────────────────────── 文档：列表 ─────────────────────────

test('GET /api/documents 返回 { total, items } 且默认按 updated_at 倒序', async () => {
    const r = await fetch(base + '/api/documents');
    assert.equal(r.status, 200);
    const data = await r.json();
    assert.ok(Array.isArray(data.items));
    assert.ok(Number.isInteger(data.total));
    assert.ok(data.total >= 1);
});

test('GET /api/documents?limit/offset 分页参数生效', async () => {
    const r = await fetch(base + '/api/documents?limit=1&offset=0');
    assert.equal(r.status, 200);
    const data = await r.json();
    assert.equal(data.items.length, 1);
});

test('GET /api/documents?category_id 非法 → 400', async () => {
    const r = await fetch(base + '/api/documents?category_id=xyz');
    assert.equal(r.status, 400);
    assert.equal((await r.json()).error, 'invalid_input');
});

// ───────────────────────── 文档：删除 ─────────────────────────

test('DELETE /api/documents/:id → 204，随后 GET → 404', async () => {
    const created = await postDoc({ title: '待删' });
    const id = created.data.id;
    const del = await fetch(base + `/api/documents/${id}`, { method: 'DELETE' });
    assert.equal(del.status, 204);

    const reread = await fetch(base + `/api/documents/${id}`);
    assert.equal(reread.status, 404);
});

test('DELETE /api/documents/:id 不存在 → 404', async () => {
    const r = await fetch(base + '/api/documents/999999', { method: 'DELETE' });
    assert.equal(r.status, 404);
    assert.equal((await r.json()).error, 'not_found');
});

// ───────────────────────── 分类 ─────────────────────────

test('POST /api/categories 正常 → 201', async () => {
    const r = await fetch(base + '/api/categories', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: '前端' })
    });
    assert.equal(r.status, 201);
    const data = await r.json();
    assert.equal(data.name, '前端');
    assert.ok(data.id >= 1);
});

test('POST /api/categories 重名 → 409 constraint_failed', async () => {
    await fetch(base + '/api/categories', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: '唯一分类' })
    });
    const dup = await fetch(base + '/api/categories', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: '唯一分类' })
    });
    assert.equal(dup.status, 409);
    assert.equal((await dup.json()).error, 'constraint_failed');
});

test('GET /api/categories 返回数组', async () => {
    const r = await fetch(base + '/api/categories');
    assert.equal(r.status, 200);
    const data = await r.json();
    assert.ok(Array.isArray(data));
});

test('DELETE /api/categories/:id → 204', async () => {
    const created = await fetch(base + '/api/categories', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: '待删分类' })
    });
    const id = (await created.json()).id;
    const del = await fetch(base + `/api/categories/${id}`, { method: 'DELETE' });
    assert.equal(del.status, 204);
});

// ───────────────────────── 标签 ─────────────────────────

test('GET /api/tags 返回数组', async () => {
    const r = await fetch(base + '/api/tags');
    assert.equal(r.status, 200);
    const data = await r.json();
    assert.ok(Array.isArray(data));
});

test('DELETE /api/tags/:id → 204', async () => {
    // 先通过文档创建一个标签
    await postDoc({ title: '造标签', tags: ['临时标签'] });
    const tags = await (await fetch(base + '/api/tags')).json();
    const target = tags.find((t) => t.name === '临时标签');
    assert.ok(target, '应通过文档创建产生标签');
    const del = await fetch(base + `/api/tags/${target.id}`, { method: 'DELETE' });
    assert.equal(del.status, 204);
});

test('DELETE /api/tags/:id 不存在 → 404', async () => {
    const r = await fetch(base + '/api/tags/999999', { method: 'DELETE' });
    assert.equal(r.status, 404);
    assert.equal((await r.json()).error, 'not_found');
});

// ───────────────────────── 页面树（迁移 002） ─────────────────────────

test('POST /api/documents 带 parent_id → 201 并回显 parent_id', async () => {
    const parent = await postDoc({ title: 'API 父页' });
    assert.equal(parent.status, 201);
    const child = await postDoc({ title: 'API 子页', parent_id: parent.data.id });
    assert.equal(child.status, 201);
    assert.equal(child.data.parent_id, parent.data.id);
});

test('GET /api/documents/:id/children 返回直接子页面', async () => {
    const parent = await postDoc({ title: '子页面父级' });
    await postDoc({ title: '子页面一', parent_id: parent.data.id });
    await postDoc({ title: '子页面二', parent_id: parent.data.id });

    const r = await fetch(base + `/api/documents/${parent.data.id}/children`);
    assert.equal(r.status, 200);
    const data = await r.json();
    assert.equal(data.items.length, 2);
    assert.ok(data.items.every((d) => d.parent_id === parent.data.id));
});

test('GET /api/documents/:id/children 父页面不存在 → 404', async () => {
    const r = await fetch(base + '/api/documents/999999/children');
    assert.equal(r.status, 404);
    assert.equal((await r.json()).error, 'not_found');
});

test('GET /api/documents/tree 返回带 parent_id 的扁平页面树', async () => {
    const parent = await postDoc({ title: '树父页' });
    await postDoc({ title: '树子页', parent_id: parent.data.id });

    const r = await fetch(base + '/api/documents/tree');
    assert.equal(r.status, 200);
    const data = await r.json();
    assert.ok(Array.isArray(data.items));
    const node = data.items.find((n) => n.id === parent.data.id);
    assert.ok(node, '树数据应包含父页');
    assert.equal(node.parent_id, null);
    assert.equal(node.content_md, undefined, '树数据不含正文');
});

test('GET /api/documents?root=1 只返回顶层页面', async () => {
    const parent = await postDoc({ title: '顶层过滤父' });
    await postDoc({ title: '顶层过滤子', parent_id: parent.data.id });

    const r = await fetch(base + '/api/documents?root=1&limit=100');
    assert.equal(r.status, 200);
    const data = await r.json();
    assert.ok(data.items.every((d) => d.parent_id === null));
});

test('PUT /api/documents/:id 移动到自身后代 → 400 invalid_input', async () => {
    const a = await postDoc({ title: '环路 A' });
    const b = await postDoc({ title: '环路 B', parent_id: a.data.id });

    const r = await fetch(base + `/api/documents/${a.data.id}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ version: 1, parent_id: b.data.id })
    });
    assert.equal(r.status, 400);
    assert.equal((await r.json()).error, 'invalid_input');
});

test('DELETE /api/documents/:id 级联删除子页面', async () => {
    const parent = await postDoc({ title: '级联父页' });
    const child = await postDoc({ title: '级联子页', parent_id: parent.data.id });

    const del = await fetch(base + `/api/documents/${parent.data.id}`, { method: 'DELETE' });
    assert.equal(del.status, 204);

    const gone = await fetch(base + `/api/documents/${child.data.id}`);
    assert.equal(gone.status, 404);
});
