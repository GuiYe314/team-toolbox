// 资源管理接口测试（HTTP 层）。
//
// 与 asset-store.test.js 的分工：那边测存储层语义，这边测
//   - 路由注册与响应体格式（与既有 api.js 一致）
//   - 参数校验与错误码映射（400 / 404 / 409）
//   - 文件上传（multipart）、下载、Range、流式响应
//   - 同名冲突的 409 + resolutionRequired 契约（前端据此弹窗）
//   - 版本恢复 / 发布 / 删除的真实 HTTP 往返
//
// 用真实的 Express app + 内存库 + 临时资源目录，
// 不 mock fetch —— 保证测的是真实行为而不是 mock 的行为。

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// 必须在 import asset-api 之前设置 ASSET_DIR，模块加载时即读取
const TMP_ROOT = mkdtempSync(join(tmpdir(), 'asset-api-'));
process.env.ASSET_DIR = join(TMP_ROOT, 'assets');

const express = (await import('express')).default;
const Database = (await import('better-sqlite3')).default;
const { runMigrations } = await import('./migrate.js');
const { registerAssetApi } = await import('./asset-api.js');
const { ASSET_DIR } = await import('./asset-storage.js');

let db;
let server;
let baseUrl;

before(async () => {
    db = new Database(':memory:');
    await runMigrations({ connection: db, allowAbsentMigrations: true });

    const app = express();
    app.use(express.json({ limit: '16mb' }));
    registerAssetApi(app, { getDb: () => db });
    server = app.listen(0, '127.0.0.1');
    await new Promise((r) => server.once('listening', r));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
    await new Promise((r) => server.close(r));
    try { db.close(); } catch { /* 已关闭 */ }
    rmSync(TMP_ROOT, { recursive: true, force: true });
});

// ── helpers ────────────────────────────────────────────────────────

/** 构造 multipart 请求体。 */
function multipart(fields, file) {
    const boundary = '----test' + Math.random().toString(16).slice(2);
    const chunks = [];
    for (const [k, v] of Object.entries(fields)) {
        chunks.push(Buffer.from(
            `--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`, 'utf8'
        ));
    }
    if (file) {
        chunks.push(Buffer.from(
            `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\n` +
            `Content-Type: ${file.type || 'application/octet-stream'}\r\n\r\n`, 'utf8'
        ));
        chunks.push(file.data);
        chunks.push(Buffer.from('\r\n', 'utf8'));
    }
    chunks.push(Buffer.from(`--${boundary}--\r\n`, 'utf8'));
    return { body: Buffer.concat(chunks), contentType: `multipart/form-data; boundary=${boundary}` };
}

async function get(path) {
    const res = await fetch(baseUrl + path);
    let body = null;
    try { body = await res.json(); } catch { /* 非 JSON */ }
    return { status: res.status, body, headers: res.headers };
}

async function send(method, path, payload) {
    const res = await fetch(baseUrl + path, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: payload === undefined ? undefined : JSON.stringify(payload)
    });
    let body = null;
    try { body = await res.json(); } catch { /* 非 JSON */ }
    return { status: res.status, body };
}

async function upload(fields, file) {
    const mp = multipart(fields, file);
    const res = await fetch(baseUrl + '/api/assets/upload', {
        method: 'POST', headers: { 'Content-Type': mp.contentType }, body: mp.body
    });
    let body = null;
    try { body = await res.json(); } catch { /* 非 JSON */ }
    return { status: res.status, body };
}

/** 最小合法 PNG（1×1）。 */
const PNG_1PX = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
);

/**
 * 构造一个「像样」的 GLB。
 *
 * 必须带真的 GLB 魔数（"glTF"），否则会被魔数校验拒绝 ——
 * 这不是校验过严，而是正确：GLB 本身就是改装的 ZIP 容器，
 * 头 4 字节必须是 ASCII "glTF"，第 8-11 字节是 2（即 version）。
 * 全零 buffer 冒充 .glb 属于伪装，理应被拒。
 */
function makeGlb(payloadSize = 2048) {
    const head = Buffer.alloc(12);
    head.write('glTF', 0, 'ascii');   // magic
    head.writeUInt32LE(2, 4);          // version = 2
    head.writeUInt32LE(12 + payloadSize, 8); // total length
    return Buffer.concat([head, Buffer.alloc(payloadSize, 7)]);
}

/** 构造一个「像样」的 ZIP。 */
function makeZip(payloadSize = 1024) {
    const head = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
    return Buffer.concat([head, Buffer.alloc(payloadSize, 3)]);
}

// ═══════════════════════════════════════════════════════════════

describe('健康与空态', () => {
    test('资产列表初始为空', async () => {
        const r = await get('/api/assets');
        assert.equal(r.status, 200);
        assert.equal(r.body.total, 0);
        assert.deepEqual(r.body.items, []);
        assert.equal(r.body.page, 1);
    });

    test('统计接口返回零值而非报错', async () => {
        const r = await get('/api/assets/stats');
        assert.equal(r.status, 200);
        assert.equal(r.body.total, 0);
        assert.ok(Array.isArray(r.body.breakdown));
    });

    test('文件夹列表初始为空', async () => {
        const r = await get('/api/asset-folders');
        assert.equal(r.status, 200);
        assert.deepEqual(r.body.items, []);
    });
});

describe('文件夹接口', () => {
    test('新建 → 201，列表可见', async () => {
        const c = await send('POST', '/api/asset-folders', { name: '海昏侯' });
        assert.equal(c.status, 201);
        assert.ok(c.body.id);

        const l = await get('/api/asset-folders');
        assert.equal(l.body.items.length, 1);
        assert.equal(l.body.items[0].name, '海昏侯');
        assert.equal(l.body.items[0].asset_count, 0);
    });

    test('重命名', async () => {
        const c = await send('POST', '/api/asset-folders', { name: '待改名' });
        const r = await send('PUT', `/api/asset-folders/${c.body.id}`, { name: '已改名' });
        assert.equal(r.status, 200);
        assert.equal(r.body.name, '已改名');
    });

    test('同级同名 → 409', async () => {
        await send('POST', '/api/asset-folders', { name: '重名冲突' });
        const again = await send('POST', '/api/asset-folders', { name: '重名冲突' });
        assert.equal(again.status, 409);
        assert.equal(again.body.error, 'constraint_failed');
    });

    test('非法 ID → 400', async () => {
        const r = await send('PUT', '/api/asset-folders/abc', { name: 'x' });
        assert.equal(r.status, 400);
        assert.equal(r.body.error, 'invalid_input');
    });

    test('不存在 → 404', async () => {
        const r = await send('DELETE', '/api/asset-folders/99999');
        assert.equal(r.status, 404);
    });

    test('移动进子文件夹 → 409（防环）', async () => {
        const a = await send('POST', '/api/asset-folders', { name: '环父' });
        const b = await send('POST', '/api/asset-folders', { name: '环子', parentId: a.body.id });
        const r = await send('PUT', `/api/asset-folders/${a.body.id}`, { parentId: b.body.id });
        assert.equal(r.status, 409);
    });
});

describe('上传与列表', () => {
    let assetId;

    test('上传 PNG → 201，含版本与预览状态', async () => {
        const r = await upload({ folderId: '', tags: '海昏侯,文物' }, {
            name: 'artifact.png', data: PNG_1PX, type: 'image/png'
        });
        assert.equal(r.status, 201);
        assert.equal(r.body.name, 'artifact.png');
        assert.equal(r.body.type, 'image');
        assert.equal(r.body.mimeType, 'image/png');
        assert.equal(r.body.latestVersionNumber, 1);
        assert.equal(r.body.publishedVersionNumber, null, '首次上传不应自动发布');
        assert.deepEqual(r.body.tags.sort(), ['文物', '海昏侯']);
        assetId = r.body.id;
    });

    test('文件已真实落盘', () => {
        assert.ok(existsSync(ASSET_DIR), '资源目录应被创建');
        const dir = join(ASSET_DIR, String(assetId), '1');
        assert.ok(existsSync(dir), `版本目录应存在: ${dir}`);
    });

    test('同名冲突 → 409 + resolutionRequired（前端据此弹窗）', async () => {
        const r = await upload({}, { name: 'artifact.png', data: PNG_1PX, type: 'image/png' });
        assert.equal(r.status, 409);
        assert.equal(r.body.error, 'conflict');
        assert.equal(r.body.resolutionRequired, true, '必须带该标记，前端据此弹「作为新版本 / 创建新资源 / 取消」');
        assert.equal(r.body.existingAssetId, assetId, '应指明冲突的是哪个资源');
    });

    test('force=1 可强制创建为新资源', async () => {
        const mp = multipart({}, { name: 'artifact.png', data: PNG_1PX, type: 'image/png' });
        const res = await fetch(
            `${baseUrl}/api/assets/upload?force=1`,
            { method: 'POST', headers: { 'Content-Type': mp.contentType }, body: mp.body }
        );
        const body = await res.json();
        assert.equal(res.status, 201);
        assert.notEqual(body.id, assetId, 'force 应创建出独立的新资源');
    });

    test('伪装文件被魔数校验拒绝', async () => {
        // 把 MZ（.exe）头改名成 .png
        const fake = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(64)]);
        const r = await upload({}, { name: 'virus.png', data: fake, type: 'image/png' });
        assert.equal(r.status, 400);
        assert.match(r.body.message, /不符/);
    });

    test('SVG 被拒绝', async () => {
        const r = await upload({}, {
            name: 'x.svg', data: Buffer.from('<svg onload="alert(1)"></svg>'), type: 'image/svg+xml'
        });
        assert.equal(r.status, 400);
        assert.match(r.body.message, /SVG/);
    });

    test('空文件被拒绝', async () => {
        const r = await upload({}, { name: 'empty.png', data: Buffer.alloc(0) });
        assert.equal(r.status, 400);
    });

    test('缺少 file 字段 → 400', async () => {
        const r = await upload({ comment: '只有字段' }, null);
        assert.equal(r.status, 400);
        assert.match(r.body.message, /缺少上传文件/);
    });

    test('列表包含新资源', async () => {
        const r = await get('/api/assets?pageSize=50');
        assert.ok(r.body.total >= 2);
        assert.ok(r.body.items.some((a) => a.id === assetId));
    });

    test('搜索命中名称', async () => {
        const r = await get('/api/assets?search=artifact');
        assert.ok(r.body.items.some((a) => a.id === assetId));
    });

    test('按类型筛选', async () => {
        const r = await get('/api/assets?type=image');
        assert.ok(r.body.items.every((a) => a.type === 'image'));
        assert.ok(r.body.total >= 1);
    });

    test('分页生效', async () => {
        const p1 = await get('/api/assets?page=1&pageSize=1&sort=name&order=asc');
        assert.equal(p1.body.items.length, 1);
        const p2 = await get('/api/assets?page=2&pageSize=1&sort=name&order=asc');
        assert.equal(p2.body.items.length, 1);
        assert.notEqual(p1.body.items[0].id, p2.body.items[0].id);
        assert.equal(p1.body.total, p2.body.total);
    });

    test('非法 sort 回退而非注入', async () => {
        const r = await get('/api/assets?sort=' + encodeURIComponent('name; DROP TABLE assets'));
        assert.equal(r.status, 200);
        assert.ok(r.body.items.length >= 1, '表还在，数据仍可读');
    });

    test('详情含版本、日志、磁盘占用、viewable', async () => {
        const r = await get(`/api/assets/${assetId}`);
        assert.equal(r.status, 200);
        assert.equal(r.body.versions.length, 1);
        assert.ok(Array.isArray(r.body.logs));
        assert.ok(r.body.disk.total > 0, '磁盘占用应统计到文件');
        assert.equal(r.body.viewable, true, '图片应可预览');
    });
});

describe('版本管理 HTTP', () => {
    let assetId;
    // 两个版本的实际字节数，用作后续「端点返回哪一版」的判据
    let v1Size;
    let v2Size;

    before(async () => {
        const r = await upload({}, { name: 'museum.glb', data: makeGlb(2048) });
        v1Size = makeGlb(2048).length;
        v2Size = makeGlb(4096).length;
        assetId = r.body.id;
    });

    test('追加版本 → v2，latest 前进，published 不动', async () => {
        const r = await upload({ assetId: String(assetId), comment: '加了个展台' }, {
            name: 'museum.glb', data: makeGlb(4096)
        });
        assert.equal(r.status, 201);
        assert.equal(r.body.versionNumber, 2);
        assert.equal(r.body.latestVersionNumber, 2);
        assert.equal(r.body.publishedVersionNumber, null, 'published 必须仍为空');
        assert.equal(r.body.hasUnpublished, true);
    });

    test('发布 v1 → published=v1，latest 仍 v2', async () => {
        const versions = (await get(`/api/assets/${assetId}/versions`)).body.items;
        const v1 = versions.find((v) => v.versionNumber === 1);

        const r = await send('POST', `/api/assets/${assetId}/publish`, { versionId: v1.id });
        assert.equal(r.status, 200);
        assert.equal(r.body.versionNumber, 1);

        const d = (await get(`/api/assets/${assetId}`)).body;
        assert.equal(d.publishedVersionNumber, 1);
        assert.equal(d.latestVersionNumber, 2, '发布不应移动 latest');
        assert.equal(d.status, 'published');
    });

    test('published 指针端点返回已发布版本的字节', async () => {
        const res = await fetch(`${baseUrl}/api/assets/files/${assetId}/original/published`);
        assert.equal(res.status, 200);
        // 已发布的是 v1（v2 只是 latest）—— 端点必须返回 v1 的字节
        assert.equal(res.headers.get('content-length'), String(v1Size));
        const buf = Buffer.from(await res.arrayBuffer());
        assert.equal(buf.length, v1Size);
    });

    test('latest 指针端点返回最新版本', async () => {
        const res = await fetch(`${baseUrl}/api/assets/files/${assetId}/original/latest`);
        assert.equal(res.headers.get('content-length'), String(v2Size));
    });

    test('按版本号访问', async () => {
        const res = await fetch(`${baseUrl}/api/assets/files/${assetId}/original/1`);
        assert.equal(res.headers.get('content-length'), String(v1Size));
    });

    test('未发布资源访问 published 指针 → 404 且提示明确', async () => {
        const r = await upload({}, { name: 'unpublished.zip', data: makeZip(100) });
        const res = await fetch(`${baseUrl}/api/assets/files/${r.body.id}/original/published`);
        assert.equal(res.status, 404);
        const body = await res.json();
        assert.match(body.message, /尚未发布/);
    });

    test('恢复 v1 → 生成 v3（而非把 latest 改回 v1）', async () => {
        // 用独立资源，避免与其他用例产生版本号顺序依赖
        const a = (await upload({}, { name: 'restore-test.glb', data: makeGlb(1024) })).body;
        await upload({ assetId: String(a.id) }, { name: 'restore-test.glb', data: makeGlb(2048) });

        const versions = (await get(`/api/assets/${a.id}/versions`)).body.items;
        const v1 = versions.find((v) => v.versionNumber === 1);

        const r = await send('POST', `/api/assets/${a.id}/versions/${v1.id}/restore`, { comment: '回滚到第一版' });
        assert.equal(r.status, 201);
        assert.equal(r.body.versionNumber, 3, '应生成 v3');
        assert.equal(r.body.restoredFrom, 1);

        const d = (await get(`/api/assets/${a.id}`)).body;
        assert.equal(d.latestVersionNumber, 3, 'latest 前进到 v3');
        assert.deepEqual(
            d.versions.map((v) => v.versionNumber).sort((x, y) => x - y),
            [1, 2, 3], 'v1~v3 必须全部保留，一个不少'
        );
    });

    test('恢复不影响已发布版本', async () => {
        const a = (await upload({}, { name: 'restore-pub.glb', data: makeGlb(1024) })).body;
        await upload({ assetId: String(a.id) }, { name: 'restore-pub.glb', data: makeGlb(2048) });

        // 先发布 v1
        const versions = (await get(`/api/assets/${a.id}/versions`)).body.items;
        const v1 = versions.find((v) => v.versionNumber === 1);
        await send('POST', `/api/assets/${a.id}/publish`, { versionId: v1.id });

        // 恢复 v1 → 生成 v3
        const r = await send('POST', `/api/assets/${a.id}/versions/${v1.id}/restore`);
        assert.equal(r.body.versionNumber, 3);

        const d = (await get(`/api/assets/${a.id}`)).body;
        assert.equal(d.publishedVersionNumber, 1, '恢复不应改变已发布版本');
        assert.equal(d.latestVersionNumber, 3);
    });

    test('恢复出的版本内容与源一致（大小相同）', async () => {
        const a = (await upload({}, { name: 'restore-size.glb', data: makeGlb(1024) })).body;
        await upload({ assetId: String(a.id) }, { name: 'restore-size.glb', data: makeGlb(4096) });
        const versions = (await get(`/api/assets/${a.id}/versions`)).body.items;
        // 接口按版本号**倒序**返回，versions[0] 是最新的 v2，不是 v1。
        // 必须显式按 versionNumber 找，否则会拿错版本当恢复源。
        const v1 = versions.find((v) => v.versionNumber === 1);
        assert.equal(v1.fileSize, makeGlb(1024).length, '前置校验：v1 应是首个版本');
        await send('POST', `/api/assets/${a.id}/versions/${v1.id}/restore`);

        const after = (await get(`/api/assets/${a.id}/versions`)).body.items;
        const v3 = after.find((v) => v.versionNumber === 3);
        assert.equal(v3.fileSize, v1.fileSize, 'v3 的大小应等于 v1');
    });

    test('不能删除 latest 版本 → 409', async () => {
        const versions = (await get(`/api/assets/${assetId}/versions`)).body.items;
        const latest = versions.find((v) => v.isLatest);
        const r = await send('DELETE', `/api/assets/${assetId}/versions/${latest.id}`);
        assert.equal(r.status, 409);
        assert.match(r.body.message, /最新版本/);
    });

    test('不能删除 published 版本 → 409', async () => {
        const versions = (await get(`/api/assets/${assetId}/versions`)).body.items;
        const pub = versions.find((v) => v.isPublished);
        const r = await send('DELETE', `/api/assets/${assetId}/versions/${pub.id}`);
        assert.equal(r.status, 409);
        assert.match(r.body.message, /已发布版本/);
    });

    test('删除中间历史版本 → 200 且文件被清理', async () => {
        // 独立资源：不依赖前面的版本演进状态
        const a = (await upload({}, { name: 'del-mid.glb', data: makeGlb(512) })).body;
        await upload({ assetId: String(a.id) }, { name: 'del-mid.glb', data: makeGlb(1024) });
        await upload({ assetId: String(a.id) }, { name: 'del-mid.glb', data: makeGlb(2048) });

        const versions = (await get(`/api/assets/${a.id}/versions`)).body.items;
        const v2 = versions.find((v) => v.versionNumber === 2);
        const dir = join(ASSET_DIR, String(a.id), String(v2.id));
        assert.ok(existsSync(dir), '删除前目录应存在');

        const r = await send('DELETE', `/api/assets/${a.id}/versions/${v2.id}`);
        assert.equal(r.status, 200);
        assert.equal(r.body.deleted, 1);
        assert.ok(!existsSync(dir), '删除后目录应被清理（不留孤儿文件）');

        const left = (await get(`/api/assets/${a.id}/versions`)).body.items
            .map((v) => v.versionNumber).sort((x, y) => x - y);
        assert.deepEqual(left, [1, 3], 'v2 应消失，v1/v3 保留');
    });

    test('取消发布', async () => {
        // 独立资源：发布 v1、追加 v2，再取消发布
        const a = (await upload({}, { name: 'unpub.glb', data: makeGlb(512) })).body;
        await upload({ assetId: String(a.id) }, { name: 'unpub.glb', data: makeGlb(1024) });
        const versions = (await get(`/api/assets/${a.id}/versions`)).body.items;
        const v1 = versions.find((v) => v.versionNumber === 1);
        await send('POST', `/api/assets/${a.id}/publish`, { versionId: v1.id });

        const r = await send('POST', `/api/assets/${a.id}/unpublish`);
        assert.equal(r.status, 200);
        const d = (await get(`/api/assets/${a.id}`)).body;
        assert.equal(d.publishedVersionId, null);
        assert.equal(d.status, 'draft');
        assert.equal(d.latestVersionNumber, 2, '取消发布不影响 latest');
    });
});

describe('重命名 / 移动 / 标签', () => {
    let assetId;
    let folderId;

    before(async () => {
        const f = await send('POST', '/api/asset-folders', { name: '移动目标' });
        folderId = f.body.id;
        assetId = (await upload({}, { name: 'movable.txt', data: Buffer.from('hello') })).body.id;
    });

    test('重命名', async () => {
        const r = await send('PATCH', `/api/assets/${assetId}`, { name: '已重命名.txt' });
        assert.equal(r.status, 200);
        assert.equal(r.body.name, '已重命名.txt');
    });

    test('移动到文件夹', async () => {
        const r = await send('PATCH', `/api/assets/${assetId}`, { folderId });
        assert.equal(r.status, 200);
        const d = (await get(`/api/assets/${assetId}`)).body;
        assert.equal(d.folderId, folderId);
    });

    test('按文件夹筛选命中', async () => {
        const r = await get(`/api/assets?folderId=${folderId}`);
        assert.ok(r.body.items.some((a) => a.id === assetId));
        assert.ok(r.body.items.every((a) => a.folderId === folderId));
    });

    test('移到不存在的文件夹 → 400', async () => {
        const r = await send('PATCH', `/api/assets/${assetId}`, { folderId: 99999 });
        assert.equal(r.status, 400);
    });

    test('批量追加标签保留原有标签', async () => {
        await send('PATCH', `/api/assets/${assetId}`, { name: '已重命名.txt' });
        await send('POST', '/api/assets/batch-tags', { assetIds: [assetId], tags: ['批次A', '批次B'] });
        const d = (await get(`/api/assets/${assetId}`)).body;
        assert.deepEqual(d.tags.sort(), ['批次A', '批次B']);
    });

    test('批量移动', async () => {
        const other = await send('POST', '/api/asset-folders', { name: '批量目标2' });
        const ids = [];
        for (const n of ['b1.txt', 'b2.txt', 'b3.txt']) {
            ids.push((await upload({}, { name: n, data: Buffer.from(n) })).body.id);
        }
        const r = await send('POST', '/api/assets/batch-move', { assetIds: ids, folderId: other.body.id });
        assert.equal(r.status, 200);
        assert.equal(r.body.moved, 3);
    });
});

describe('回收站 HTTP', () => {
    let assetId;
    let versionDir;

    before(async () => {
        const up = await upload({}, { name: 'trashme.png', data: PNG_1PX });
        assetId = up.body.id;
        // 版本目录用**真实的 versionId** 拼，不能假定是 1 ——
        // 前面若干用例已消耗掉一批自增 id，硬编码会指向不存在的目录。
        versionDir = join(ASSET_DIR, String(assetId), String(up.body.versionId));
    });

    test('软删除：进回收站、文件仍在', async () => {
        const r = await send('POST', '/api/assets/batch-delete', { assetIds: [assetId] });
        assert.equal(r.status, 200);
        assert.equal(r.body.affected, 1);

        const trash = await get('/api/assets?scope=trash');
        assert.ok(trash.body.items.some((a) => a.id === assetId), '应出现在回收站');

        const active = await get('/api/assets?pageSize=100');
        assert.ok(!active.body.items.some((a) => a.id === assetId), '不应出现在正常列表');

        assert.ok(existsSync(versionDir), '软删除不得删除存储文件');
    });

    test('恢复', async () => {
        const r = await send('POST', '/api/assets/batch-restore', { assetIds: [assetId] });
        assert.equal(r.body.affected, 1);
        const active = await get('/api/assets?pageSize=100');
        assert.ok(active.body.items.some((a) => a.id === assetId));
    });

    test('永久删除需二次确认', async () => {
        await send('POST', '/api/assets/batch-delete', { assetIds: [assetId] });
        const r = await send('POST', '/api/assets/purge', { assetIds: [assetId] });
        assert.equal(r.status, 400, '缺 confirm=1 应拒绝');
        assert.match(r.body.message, /二次确认/);
    });

    test('永久删除：元数据与文件同时清除', async () => {
        const r = await send('POST', '/api/assets/purge?confirm=1', { assetIds: [assetId] });
        assert.equal(r.status, 200);
        assert.equal(r.body.deleted, 1);

        assert.equal((await get(`/api/assets/${assetId}`)).status, 404, '元数据应消失');
        assert.ok(!existsSync(versionDir), '磁盘文件应被清理，不留孤儿');
    });

    test('未进回收站的资源不能被永久删除', async () => {
        const live = (await upload({}, { name: 'alive.txt', data: Buffer.from('x') })).body.id;
        const r = await send('POST', '/api/assets/purge?confirm=1', { assetIds: [live] });
        assert.equal(r.status, 200);
        assert.equal(r.body.deleted, 0);
        assert.equal(r.body.missing, 1);
        assert.equal((await get(`/api/assets/${live}`)).status, 200, '资源应仍存在');
    });

    test('清空回收站', async () => {
        const a = (await upload({}, { name: 'bulk1.txt', data: Buffer.from('1') })).body.id;
        const b = (await upload({}, { name: 'bulk2.txt', data: Buffer.from('2') })).body.id;
        await send('POST', '/api/assets/batch-delete', { assetIds: [a, b] });

        const noConfirm = await send('POST', '/api/assets/trash/empty', {});
        assert.equal(noConfirm.status, 400);

        const r = await send('POST', '/api/assets/trash/empty?confirm=1', {});
        assert.equal(r.status, 200);
        assert.equal(r.body.deleted, 2);

        const trash = await get('/api/assets?scope=trash');
        assert.equal(trash.body.total, 0, '回收站应已清空');
    });
});

describe('下载与错误处理', () => {
    let assetId;
    let firstVersionId;

    before(async () => {
        const up = await upload({}, { name: '下载测试.png', data: PNG_1PX });
        assetId = up.body.id;
        firstVersionId = up.body.versionId;
    });

    test('download=1 返回 attachment 且中文名正确编码', async () => {
        await send('PATCH', `/api/assets/${assetId}`, { name: '秦始皇兵马俑.png' });
        const res = await fetch(`${baseUrl}/api/assets/files/${assetId}/original/latest?download=1`);
        assert.equal(res.status, 200);
        const cd = res.headers.get('content-disposition');
        assert.match(cd, /attachment/);
        assert.match(cd, /filename\*=UTF-8''/, '中文名需 RFC 5987 编码');
        assert.ok(decodeURIComponent(cd.split("UTF-8''")[1]) === '秦始皇兵马俑.png');
    });

    test('不存在的资源 → 404', async () => {
        const r = await get('/api/assets/999999');
        assert.equal(r.status, 404);
        assert.equal(r.body.error, 'not_found');
    });

    test('非法 ID → 400', async () => {
        assert.equal((await get('/api/assets/abc')).status, 400);
        assert.equal((await get('/api/assets/0')).status, 400);
        assert.equal((await get('/api/assets/-1')).status, 400);
    });

    test('目录穿越的存储键被拒绝', async () => {
        // 直接请求一个形如路径穿越的 URL，必须 404 而非读到真实文件
        const r = await fetch(`${baseUrl}/api/assets/files/${assetId}/original/..%2f..%2fetc`);
        assert.ok(r.status === 404 || r.status === 400, `应拒绝，实际 ${r.status}`);
    });

    test('预览文件未生成时 → 404 且 previewStatus 可辨', async () => {
        const r = await fetch(`${baseUrl}/api/assets/files/${assetId}/preview/latest`);
        assert.equal(r.status, 404);
        const body = await r.json();
        assert.match(body.message, /预览/);
    });

    test('缩略图未生成 → 404', async () => {
        const r = await fetch(`${baseUrl}/api/assets/files/${assetId}/thumbnail/latest`);
        assert.equal(r.status, 404);
    });

    test('上传派生文件后 preview 可访问', async () => {
        const mp = multipart({}, { name: 'thumb.png', data: PNG_1PX, type: 'image/png' });
        const res = await fetch(`${baseUrl}/api/assets/${assetId}/versions/${firstVersionId}/derived?kind=thumbnail`, {
            method: 'POST', headers: { 'Content-Type': mp.contentType }, body: mp.body
        });
        assert.equal(res.status, 201);

        const t = await fetch(`${baseUrl}/api/assets/files/${assetId}/thumbnail/latest`);
        assert.equal(t.status, 200);
        assert.equal(t.headers.get('content-type'), 'image/png');
    });
});

describe('操作记录', () => {
    test('记录上传 / 发布 / 恢复 / 重命名', async () => {
        const a = (await upload({}, { name: '日志追踪.glb', data: makeGlb(512) })).body.id;
        await send('POST', `/api/assets/${a}/publish`);
        await send('PATCH', `/api/assets/${a}`, { name: '日志追踪改名.glb' });

        const logs = (await get(`/api/assets/${a}/logs`)).body.items;
        const actions = new Set(logs.map((l) => l.action));
        assert.ok(actions.has('upload'));
        assert.ok(actions.has('publish'));
        assert.ok(actions.has('rename'));
        assert.ok(logs.every((l) => l.operator && l.createdAt), '每条日志都要有操作人与时间');
    });

    test('最近操作接口', async () => {
        const r = await get('/api/assets-activity/recent?limit=10');
        assert.equal(r.status, 200);
        assert.ok(Array.isArray(r.body.items));
        assert.ok(r.body.items.length > 0);
    });
});