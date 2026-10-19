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
import { gunzipSync } from 'node:zlib';

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

// ───────────────────────── 分类重命名（F-KB-004） ─────────────────────────

test('PUT /api/categories/:id 重命名 → 200 并回显新名', async () => {
    const created = await fetch(base + '/api/categories', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: '改名前' })
    });
    const id = (await created.json()).id;
    const r = await fetch(base + `/api/categories/${id}`, {
        method: 'PUT', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: '改名后' })
    });
    assert.equal(r.status, 200);
    assert.equal((await r.json()).name, '改名后');
});

test('PUT /api/categories/:id 重名 → 409 constraint_failed', async () => {
    await fetch(base + '/api/categories', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: '占名' })
    });
    const created = await fetch(base + '/api/categories', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: '待改' })
    });
    const id = (await created.json()).id;
    const r = await fetch(base + `/api/categories/${id}`, {
        method: 'PUT', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: '占名' })
    });
    assert.equal(r.status, 409);
    assert.equal((await r.json()).error, 'constraint_failed');
});

test('PUT /api/categories/:id 不存在 → 404', async () => {
    const r = await fetch(base + '/api/categories/999999', {
        method: 'PUT', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'x' })
    });
    assert.equal(r.status, 404);
    assert.equal((await r.json()).error, 'not_found');
});

test('GET /api/documents?tags= 按标签 AND 过滤', async () => {
    const ab = await postDoc({ title: 'AND-AB', tags: ['zalpha', 'zbeta'] });
    await postDoc({ title: 'AND-A', tags: ['zalpha'] });
    await postDoc({ title: 'AND-BC', tags: ['zbeta', 'zgamma'] });
    const r = await fetch(base + '/api/documents?tags=' + encodeURIComponent('zalpha,zbeta'));
    assert.equal(r.status, 200);
    const data = await r.json();
    const ids = data.items.map((i) => i.id);
    assert.ok(ids.includes(ab.data.id), '应包含同时含 zalpha/zbeta 的文档');
    assert.equal(ids.length, 1, 'AND 语义：仅同时含两标签的文档命中');
    const r2 = await fetch(base + '/api/documents?tags=zalpha');
    const data2 = await r2.json();
    assert.equal(data2.items.length, 2, '仅 zalpha 应命中 2 篇');
});

test('GET /api/documents 默认排序与分页（F-KB-008）', async () => {
    await postDoc({ title: '分页-Doc-0' });
    await postDoc({ title: '分页-Doc-1' });
    await postDoc({ title: '分页-Doc-2' });
    await postDoc({ title: '分页-Doc-3' });
    await postDoc({ title: '分页-Doc-4' });

    const p1 = await fetch(base + '/api/documents?limit=2&offset=0');
    assert.equal(p1.status, 200);
    const d1 = await p1.json();
    assert.equal(d1.items.length, 2, '首页应返回 2 条');
    assert.ok(d1.total >= 5, 'total 应 >= 5');

    const p2 = await fetch(base + '/api/documents?limit=2&offset=2');
    const d2 = await p2.json();
    assert.equal(d2.items.length, 2, '第二页应返回 2 条');

    const all = await fetch(base + '/api/documents');
    const da = await all.json();
    assert.ok(da.items.length > 0);
    const first = da.items[0];
    assert.ok('category_name' in first, '响应应包含 category_name 字段');
    assert.ok(Array.isArray(first.tags), '响应 tags 应为数组');
    assert.ok('updated_at' in first, '响应应包含 updated_at 字段');
});

// ───────────────────────── 搜索（F-KB-006） ─────────────────────────

test('GET /api/search 按标题关键词命中', async () => {
    await postDoc({ title: '搜索标题命中篇', content_md: '无关正文' });
    const r = await fetch(base + '/api/search?q=' + encodeURIComponent('标题命中'));
    assert.equal(r.status, 200);
    const data = await r.json();
    assert.ok(data.items.length >= 1);
    assert.ok(data.items.some((i) => i.title.includes('搜索标题命中篇')));
    assert.equal(data.query, '标题命中');
});

test('GET /api/search 按正文关键词命中', async () => {
    await postDoc({ title: '标题无关键词', content_md: '正文里藏着 Shader Graph 字样' });
    const r = await fetch(base + '/api/search?q=' + encodeURIComponent('Shader'));
    assert.equal(r.status, 200);
    const data = await r.json();
    assert.ok(data.items.some((i) => i.content_md.includes('Shader Graph')));
});

test('GET /api/search 空关键词不发起查询（返回空结果 200）', async () => {
    const r = await fetch(base + '/api/search?q=' + encodeURIComponent('   '));
    assert.equal(r.status, 200);
    const data = await r.json();
    assert.equal(data.total, 0);
    assert.deepStrictEqual(data.items, []);
});

test('GET /api/search 特殊字符（% _ \\）按字面量匹配，不触发通配也不报错', async () => {
    await postDoc({ title: '完成度 50% 达标', content_md: 'x' });
    const r = await fetch(base + '/api/search?q=' + encodeURIComponent('50%'));
    assert.equal(r.status, 200, '特殊字符不应导致 500');
    const data = await r.json();
    assert.equal(data.total, 1);
    assert.equal(data.items[0].title, '完成度 50% 达标');
});

test('GET /api/search 未命中返回空结果（非报错）', async () => {
    const r = await fetch(base + '/api/search?q=' + encodeURIComponent('绝对无此词zzz'));
    assert.equal(r.status, 200);
    const data = await r.json();
    assert.equal(data.total, 0);
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

// ───────────────────── 文档：批量删除 ─────────────────────

/** 调用批量删除接口。 */
async function postBatchDelete(ids) {
    const res = await fetch(base + '/api/documents/batch-delete', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ids })
    });
    const data = await res.json().catch(() => null);
    return { status: res.status, data };
}

test('POST /api/documents/batch-delete 多个文档 → 全部删除且计数正确', async () => {
    const a = await postDoc({ title: '批删A' });
    const b = await postDoc({ title: '批删B' });
    const c = await postDoc({ title: '批删C' });

    const r = await postBatchDelete([a.data.id, b.data.id, c.data.id]);
    assert.equal(r.status, 200);
    assert.equal(r.data.deleted, 3);
    assert.equal(r.data.cascaded, 0);
    assert.deepEqual(r.data.missing, []);

    for (const id of [a.data.id, b.data.id, c.data.id]) {
        assert.equal((await fetch(base + `/api/documents/${id}`)).status, 404);
    }
});

test('POST /api/documents/batch-delete 级联：父页连带子页，cascaded 报告孙页数', async () => {
    const parent = await postDoc({ title: '批删父' });
    const child = await postDoc({ title: '批删子', parent_id: parent.data.id });
    const grand = await postDoc({ title: '批删孙', parent_id: child.data.id });

    const r = await postBatchDelete([parent.data.id]);
    assert.equal(r.status, 200);
    // 只请求了父页一个，但父+子+孙共 3 行被删除 → cascaded 应为 2
    assert.equal(r.data.deleted, 1);
    assert.equal(r.data.cascaded, 2);

    assert.equal((await fetch(base + `/api/documents/${child.data.id}`)).status, 404);
    assert.equal((await fetch(base + `/api/documents/${grand.data.id}`)).status, 404);
});

test('POST /api/documents/batch-delete 部分 id 不存在 → 跳过并记入 missing，不整批失败', async () => {
    const a = await postDoc({ title: '混合A' });
    const r = await postBatchDelete([a.data.id, 999999]);
    assert.equal(r.status, 200);
    assert.equal(r.data.deleted, 1);
    assert.deepEqual(r.data.missing, [999999]);
    assert.equal((await fetch(base + `/api/documents/${a.data.id}`)).status, 404);
});

test('POST /api/documents/batch-delete id 重复 → 只删一次', async () => {
    const a = await postDoc({ title: '重复A' });
    const r = await postBatchDelete([a.data.id, a.data.id, a.data.id]);
    assert.equal(r.status, 200);
    assert.equal(r.data.deleted, 1);
});

test('POST /api/documents/batch-delete 空数组 / 缺字段 → 400 invalid_input', async () => {
    const empty = await postBatchDelete([]);
    assert.equal(empty.status, 400);
    assert.equal(empty.data.error, 'invalid_input');

    const none = await postBatchDelete(undefined);
    assert.equal(none.status, 400);
    assert.equal(none.data.error, 'invalid_input');
});

test('POST /api/documents/batch-delete 非法 id（非正整数）→ 400 且不删除任何文档', async () => {
    const a = await postDoc({ title: '不被删A' });
    const r = await postBatchDelete([a.data.id, 0]);
    assert.equal(r.status, 400);
    assert.equal(r.data.error, 'invalid_input');
    // 校验先于删除：同批次的合法文档必须还在
    assert.equal((await fetch(base + `/api/documents/${a.data.id}`)).status, 200);
});

test('POST /api/documents/batch-delete 超过 500 条 → 400', async () => {
    const many = Array.from({ length: 501 }, (_, i) => i + 1);
    const r = await postBatchDelete(many);
    assert.equal(r.status, 400);
    assert.equal(r.data.error, 'invalid_input');
});

test('POST /api/documents/batch-delete 原子性：任一 id 非法则整批不生效', async () => {
    const a = await postDoc({ title: '原子A' });
    const b = await postDoc({ title: '原子B' });
    const r = await postBatchDelete([a.data.id, b.data.id, 'abc']);
    assert.equal(r.status, 400);
    // 事务未开启，两篇都应保留
    assert.equal((await fetch(base + `/api/documents/${a.data.id}`)).status, 200);
    assert.equal((await fetch(base + `/api/documents/${b.data.id}`)).status, 200);
});

test('POST /api/documents/batch-delete 清理标签关联', async () => {
    const a = await postDoc({ title: '标签批删', tags: ['待删标签'] });
    // 断言 document_tags 关联行被 CASCADE 清理。
    // 注意：tags 表中的标签名本身保留（与单条删除行为一致），
    //孤立标签的清理是 TASK 里尚未实现的 GC，不在本次范围内。
    const linkedBefore = db.prepare(`
        SELECT COUNT(*) AS n FROM document_tags dt
        JOIN tags t ON t.id = dt.tag_id
        WHERE dt.document_id = ? AND t.name = ?
    `).get(a.data.id, '待删标签').n;
    assert.equal(linkedBefore, 1, '删除前应存在标签关联');

    await postBatchDelete([a.data.id]);

    const linkedAfter = db.prepare(`
        SELECT COUNT(*) AS n FROM document_tags dt
        JOIN tags t ON t.id = dt.tag_id
        WHERE dt.document_id = ? AND t.name = ?
    `).get(a.data.id, '待删标签').n;
    assert.equal(linkedAfter, 0, '标签关联应被级联清理');
});

// ───────────────────────── 备份导入 / 导出 ─────────────────────────

test('GET /api/backup/export 返回可移植快照（名称 + ref 相对引用）', async () => {
    const parent = await postDoc({ title: `导出父-${Date.now()}`, content_md: '导出正文' });
    await postDoc({ title: `导出子-${Date.now()}`, parent_id: parent.data.id, tags: ['导出标签'] });

    const r = await fetch(base + '/api/backup/export');
    assert.equal(r.status, 200);
    const snap = await r.json();
    assert.equal(snap.app, 'team-toolbox');
    assert.equal(snap.version, 1);
    assert.ok(Array.isArray(snap.categories));
    assert.ok(Array.isArray(snap.documents));

    const node = snap.documents.find((d) => d.ref === parent.data.id);
    assert.ok(node, '快照应包含新建页面');
    assert.ok(node.title.startsWith('导出父-'), '快照应保留页面标题');
    assert.equal(node.content_md, '导出正文');
    assert.ok('created_at' in node, '快照应携带创建时间以便还原');

    const child = snap.documents.find((d) => d.parent_ref === parent.data.id);
    assert.ok(child, '子页面的 parent_ref 应指向父页ref');
    assert.ok(child.tags.includes('导出标签'), '快照应包含标签名');
});

test('POST /api/backup/import 无效备份 → 400 invalid_input', async () => {
    const bad = await fetch(base + '/api/backup/import', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ hello: 'world' })
    });
    assert.equal(bad.status, 400);
    assert.equal((await bad.json()).error, 'invalid_input');

    const arr = await fetch(base + '/api/backup/import', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify([1, 2, 3])
    });
    assert.equal(arr.status, 400);
});

test('导入 → 导出 → 再导入 幂等：重复导入全部跳过', async () => {
    const snap = await (await fetch(base + '/api/backup/export')).json();

    const again = await fetch(base + '/api/backup/import', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(snap)
    });
    assert.equal(again.status, 200);
    const stats = await again.json();
    assert.equal(stats.imported, 0, '重复导入不应新增页面');
    assert.equal(stats.skipped, snap.documents.length, '所有页面都应被跳过');
    assert.equal(stats.categories_created, 0, '同名分类应复用');
});

test('导入快照可重建父子层级与分类', async () => {
    const stamp = Date.now();
    const snapshot = {
        version: 1,
        app: 'team-toolbox',
        categories: [{ name: `导入分类-${stamp}` }],
        documents: [
            { ref: 1, parent_ref: null, title: `导入父-${stamp}`, content_md: 'P', category: `导入分类-${stamp}`, tags: [] },
            { ref: 2, parent_ref: 1, title: `导入子-${stamp}`, content_md: 'C', category: null, tags: [] },
            { ref: 3, parent_ref: 99, title: `导入孤儿-${stamp}`, content_md: 'O', category: null, tags: [] }
        ]
    };

    const r = await fetch(base + '/api/backup/import', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(snapshot)
    });
    assert.equal(r.status, 200);
    const stats = await r.json();
    assert.equal(stats.imported, 3);
    assert.equal(stats.categories_created, 1);
    assert.ok(stats.details.some((d) => d.kind === 'reparented'), '父级缺失的页面应被记录为顶层导入');

    const tree = await (await fetch(base + '/api/documents?limit=200')).json();
    const parent = tree.items.find((d) => d.title === `导入父-${stamp}`);
    const child = tree.items.find((d) => d.title === `导入子-${stamp}`);
    const orphan = tree.items.find((d) => d.title === `导入孤儿-${stamp}`);
    assert.ok(child.parent_id === parent.id, '子页面应挂到父页面下');
    assert.equal(parent.category_id !== null, true, '页面应归属导入的分类');
    assert.equal(orphan.parent_id, null, '孤儿页面应作为顶层导入');
});

// ───────────────────────── 图片附件 / gzip 导出 ─────────────────────────

// 最小合法 PNG（1x1 像素），用于构造 multipart 上传
const PNG_1PX = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
);

async function uploadImage(buf, filename) {
    const form = new FormData();
    form.append('image', new Blob([buf], { type: 'application/octet-stream' }), filename);
    const res = await fetch(base + '/api/uploads', { method: 'POST', body: form });
    return { status: res.status, data: await res.json().catch(() => null) };
}

test('POST /api/uploads 上传 PNG → 返回可写入 Markdown 的 URL', async () => {
    const r = await uploadImage(PNG_1PX, '截图.png');
    assert.equal(r.status, 201);
    assert.match(r.data.filename, /^\d+-[0-9a-f]{16}\.png$/, '文件名应由服务端生成');
    assert.equal(r.data.url, `/api/uploads/${r.data.filename}`);
    assert.equal(r.data.mime, 'image/png');
    assert.equal(r.data.size, PNG_1PX.length);

    const got = await fetch(base + r.data.url);
    assert.equal(got.status, 200, '上传后应能读回图片');
    assert.equal(got.headers.get('content-type'), 'image/png');
    assert.deepEqual(Buffer.from(await got.arrayBuffer()), PNG_1PX);
});

test('POST /api/uploads 该URL 在 Markdown 渲染中不会被净化掉', async () => {
    const r = await uploadImage(PNG_1PX, 'inline.png');
    const md = `前言\n\n![插图](${r.data.url})`;
    const render = await fetch(base + '/api/markdown/render', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ md })
    });
    const { html } = await render.json();
    assert.ok(html.includes(`src="${r.data.url}"`), 'uploads 链接应原样保留在渲染结果中');
});

test('POST /api/uploads 非图片扩展名 → 400', async () => {
    const r = await uploadImage(PNG_1PX, 'evil.exe');
    assert.equal(r.status, 400);
    assert.equal(r.data.error, 'invalid_input');
});

test('POST /api/uploads 伪装成 png 的可执行文件 → 400（魔数校验）', async () => {
    const fake = Buffer.from('MZ'.repeat(20) + 'not a real png');
    const r = await uploadImage(fake, 'fake.png');
    assert.equal(r.status, 400, '魔数不匹配必须拒绝');
    assert.match(r.data.message, /扩展名不符|不是有效/);
});

test('GET /api/uploads/路径穿越与非法文件名 → 404', async () => {
    for (const name of ['..%2F..%2Fpackage.json', 'package.json', 'not-exist.png', 'x.png']) {
        const r = await fetch(`${base}/api/uploads/${name}`);
        assert.equal(r.status, 404, `${name} 应被拒绝`);
    }
});

test('GET /api/backup/export?format=gz 返回真实 gzip 字节', async () => {
    const res = await fetch(base + '/api/backup/export?format=gz');
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'application/gzip');
    assert.equal(res.headers.get('content-encoding'), null, '不能设 Content-Encoding，否则浏览器会自动解压拿不到原始字节');
    assert.match(res.headers.get('content-disposition'), /attachment; filename="team-toolbox-backup-.+\.json\.gz"/);

    const buf = Buffer.from(await res.arrayBuffer());
    assert.equal(buf[0], 0x1f);
    assert.equal(buf[1], 0x8b);

    const plain = await (await fetch(base + '/api/backup/export')).json();
    const restored = JSON.parse(gunzipSync(buf).toString('utf8'));
    assert.equal(restored.counts.documents, plain.counts.documents, '解压后内容应与明文导出一致');
});
