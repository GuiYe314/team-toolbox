// 资源引用相关的后端测试。
//
// 覆盖两件事：
//   1. `auto` 版本指针 —— 文档引用用它，语义是「有发布版用发布版，没有用最新版」
//   2. 引用 URL 在服务端渲染后仍保留（不被 sanitize-html 剥掉 src）
//
// 为什么需要 auto 指针：
//   演示库与多数团队的早期资源都没发布过（published_version_id 为 NULL）。
//   若文档引用写死 published，这些资源在文档里会全部裂图。
//   auto 让引用总能显示，且资源一旦发布就自动跟进到正式版 ——
//   这正是版本管理该有的语义。

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TMP_ROOT = mkdtempSync(join(tmpdir(), 'asset-ref-'));
process.env.ASSET_DIR = join(TMP_ROOT, 'assets');

const express = (await import('express')).default;
const Database = (await import('better-sqlite3')).default;
const { runMigrations } = await import('./migrate.js');
const { registerAssetApi } = await import('./asset-api.js');
const { ASSET_DIR } = await import('./asset-storage.js');
const { renderMarkdown } = await import('./markdown.js');

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

// 必须关掉 server —— 否则 node --test 进程不退出（表现为测试超时 SIGTERM）。
after(async () => {
    await new Promise((r) => server.close(r));
    try { rmSync(TMP_ROOT, { recursive: true, force: true }); } catch { /* 忽略 */ }
});

/** 在主存储里放一个文件，返回 storageKey。 */
function putFile(assetId, versionId, kind, ext, content) {
    const stamp = Date.now();
    const hex = '0123456789abcdef';
    const key = `${assetId}/${versionId}/${kind}${stamp}-${hex}.${ext}`;
    const dir = join(ASSET_DIR, String(assetId), String(versionId));
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(ASSET_DIR, key), content);
    return key;
}

/** 建一个资源及其两个版本（v1、v2），可指定是否发布。 */
function makeAsset({ name = '测试资源', publish = null } = {}) {
    db.prepare(`INSERT INTO assets (id, name, type, ext) VALUES (?, ?, 'other', 'bin')`).run(100, name);
    const k1 = putFile(100, 200, 'original', 'bin', 'VERSION-ONE');
    const k2 = putFile(100, 201, 'original', 'bin', 'VERSION-TWO');
    db.prepare(`
        INSERT INTO asset_versions (id, asset_id, version_number, original_storage_key, file_size)
        VALUES (200, 100, 1, ?, 11), (201, 100, 2, ?, 11)
    `).run(k1, k2);
    db.prepare('UPDATE assets SET latest_version_id = 201 WHERE id = 100').run();
    if (publish !== null) {
        db.prepare('UPDATE assets SET published_version_id = ? WHERE id = 100').run(publish);
    }
    return 100;
}

async function fetchRaw(path) {
    const res = await fetch(baseUrl + path);
    const buf = Buffer.from(await res.arrayBuffer());
    return { status: res.status, buf, type: res.headers.get('content-type') };
}

describe('auto 版本指针', () => {
    test('未发布资源：auto 退回 latest', async () => {
        makeAsset({ name: '未发布资源' });
        const { status, buf } = await fetchRaw('/api/assets/files/100/original/auto');
        assert.equal(status, 200);
        assert.equal(buf.toString(), 'VERSION-TWO', '应取 latest 版本的内容');
    });

    test('已发布资源：auto 取 published', async () => {
        // 清掉上一个用例的资源，重建一个已发布的
        db.prepare('DELETE FROM assets').run();
        db.prepare('DELETE FROM asset_versions').run();
        makeAsset({ name: '已发布资源', publish: 200 });
        const { status, buf } = await fetchRaw('/api/assets/files/100/original/auto');
        assert.equal(status, 200);
        assert.equal(buf.toString(), 'VERSION-ONE', '有发布版时应取发布版，而不是 latest');
    });

    test('published 指针在未发布时仍返回 404（语义不被 auto 污染）', async () => {
        db.prepare('DELETE FROM assets').run();
        db.prepare('DELETE FROM asset_versions').run();
        makeAsset({ name: '未发布资源2' });
        const { status } = await fetchRaw('/api/assets/files/100/original/published');
        assert.equal(status, 404, 'published 仍应明确报「未发布」，auto 是另一个语义');
    });

    test('latest 指针不受发布状态影响', async () => {
        db.prepare('DELETE FROM assets').run();
        db.prepare('DELETE FROM asset_versions').run();
        makeAsset({ name: '未发布资源3' });
        const { status, buf } = await fetchRaw('/api/assets/files/100/original/latest');
        assert.equal(status, 200);
        assert.equal(buf.toString(), 'VERSION-TWO');
    });

    test('资源不存在时返回 404', async () => {
        const { status } = await fetchRaw('/api/assets/files/999999/original/auto');
        assert.equal(status, 404);
    });
});

describe('引用 URL 的服务端渲染', () => {
    test('相对路径的 src 被保留（不被 sanitize-html 剥掉）', () => {
        // sanitize-html 的 allowedSchemes 只管带 scheme 的 URL，
        // 相对路径不受影响 —— 这是引用能工作的前提。
        const html = renderMarkdown('![渐变测试图](/api/assets/files/88/preview/auto)');
        assert.ok(html.includes('src="/api/assets/files/88/preview/auto"'), html);
        assert.ok(html.includes('alt="渐变测试图"'), html);
    });

    test('上传附件的相对路径同样被保留', () => {
        const html = renderMarkdown('![附件](/api/uploads/abc.png)');
        assert.ok(html.includes('src="/api/uploads/abc.png"'), html);
    });

    test('引用不引入新的 HTML 标签（仍走同一套白名单）', () => {
        const html = renderMarkdown('![x](/api/assets/files/1/preview/auto)');
        // 应当只有 p 与 img，不出现自定义标签
        assert.ok(!/<asset-ref|<reference/i.test(html), html);
    });

    test('外部链接仍被加 rel=noopener（引用功能不削弱安全性）', () => {
        const html = renderMarkdown('[外链](https://example.com)');
        assert.ok(html.includes('rel="noopener noreferrer"'), html);
    });
});
