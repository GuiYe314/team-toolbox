/**
 * 预览管线测试（Preview Pipeline）
 *
 * 覆盖的关键行为：
 * 1. 图片 → 生成 WebP 预览图 + 缩略图，且**每个版本独立**
 * 2. GLB → 解析出统计信息（网格/顶点/三角面）
 * 3. 文本 → 生成截断的预览文本
 * 4. 失败不影响原件（原始文件与元数据完好）
 * 5. 不支持的类型 → status='none'，不是 failed
 * 6. 派生文件落在自己的版本目录下，绝不与其它版本共享
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TMP_ROOT = mkdtempSync(join(tmpdir(), 'asset-preview-'));
process.env.ASSET_DIR = join(TMP_ROOT, 'assets');

const express = (await import('express')).default;
const Database = (await import('better-sqlite3')).default;
const { runMigrations } = await import('./migrate.js');
const { registerAssetApi } = await import('./asset-api.js');
const { ASSET_DIR, resolveAssetPath } = await import('./asset-storage.js');
const { generatePreview, listProcessors } = await import('./asset-preview.js');
const sharp = (await import('sharp')).default;

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
    globalThis.__closeIdle = () => {
        try { server.closeAllConnections(); } catch { /* 旧版 Node 无此方法 */ }
    };
});

after(async () => {
    if (globalThis.__closeIdle) globalThis.__closeIdle();
    await new Promise((r) => server.close(r));
    try { db.close(); } catch { /* 已关闭 */ }
    rmSync(TMP_ROOT, { recursive: true, force: true });
});

/** 造一张真实 PNG（sharp 严格解码，假 PNG 会报 libpng read error）。 */
async function makePng(w = 320, h = 240) {
    return sharp({
        create: { width: w, height: h, channels: 3, background: { r: 139, g: 115, b: 85 } }
    }).png().toBuffer();
}

/** 造一个最小可解析的 GLB（含 JSON chunk）。 */
function makeGlb(json) {
    const jsonBuf = Buffer.from(JSON.stringify(json), 'utf8');
    const pad = (4 - (jsonBuf.length % 4)) % 4;
    const jsonPadded = Buffer.concat([jsonBuf, Buffer.alloc(pad, 0x20)]);
    const total = 12 + 8 + jsonPadded.length;
    const head = Buffer.alloc(12);
    head.write('glTF', 0, 'ascii');
    head.writeUInt32LE(2, 4);
    head.writeUInt32LE(total, 8);
    const chunkHead = Buffer.alloc(8);
    chunkHead.writeUInt32LE(jsonPadded.length, 0);
    chunkHead.writeUInt32LE(0x4e4f534a, 4); // 'JSON'
    return Buffer.concat([head, chunkHead, jsonPadded]);
}

/** 上传一个文件，返回 { status, body }。 */
async function upload(name, buffer, fields = {}) {
    const fd = new FormData();
    fd.append('file', new File([buffer], name));
    for (const [k, v] of Object.entries(fields)) fd.append(k, String(v));
    const r = await fetch(`${baseUrl}/api/assets/upload`, { method: 'POST', body: fd });
    return { status: r.status, body: await r.json().catch(() => null) };
}

/** 等待某个版本进入终态（ready/failed/none）。 */
async function waitPreview(assetId, versionId, timeoutMs = 15000) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
        const r = await fetch(`${baseUrl}/api/assets/${assetId}`);
        const d = await r.json();
        const v = (d.versions || []).find((x) => x.id === versionId);
        if (v && ['ready', 'failed', 'none'].includes(v.previewStatus)) return v;
        await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error('等待预览超时');
}

describe('预览处理器注册表', () => {
    test('至少注册了图片/模型/文本/音频/视频五类处理器', () => {
        const ids = listProcessors().map((p) => p.id);
        for (const want of ['image', 'model', 'text', 'audio', 'video']) {
            assert.ok(ids.includes(want), `应包含 ${want} 处理器，实际：${ids.join(',')}`);
        }
    });
});

describe('图片预览', () => {
    test('上传 PNG 后自动生成预览图与缩略图', async () => {
        const png = await makePng(640, 480);
        const up = await upload('预览测试.png', png);
        assert.equal(up.status, 201);

        const v = await waitPreview(up.body.id, up.body.versionId);
        assert.equal(v.previewStatus, 'ready', `previewStatus=${v.previewStatus} err=${v.previewError}`);
        assert.ok(v.previewStorageKey, '应有预览图');
        assert.ok(v.thumbnailStorageKey, '应有缩略图');
    });

    test('派生文件是 WebP 格式且尺寸正确', async () => {
        const png = await makePng(640, 480);
        const up = await upload('尺寸测试.png', png);
        const v = await waitPreview(up.body.id, up.body.versionId);

        const thumbPath = resolveAssetPath(v.thumbnailStorageKey);
        assert.ok(thumbPath && existsSync(thumbPath), '缩略图应落盘');
        const thumbMeta = await sharp(thumbPath).metadata();
        assert.equal(thumbMeta.format, 'webp', '缩略图应为 WebP');
        assert.equal(thumbMeta.width, 256, '缩略图宽应为 256');
        assert.equal(thumbMeta.height, 256, '缩略图高应为 256（cover 裁切）');

        const prevMeta = await sharp(resolveAssetPath(v.previewStorageKey)).metadata();
        assert.equal(prevMeta.format, 'webp');
        assert.equal(prevMeta.width, 640, '预览图不应被放大');
    });

    test('元数据记录了原图尺寸', async () => {
        const png = await makePng(800, 600);
        const up = await upload('元数据.png', png);
        const v = await waitPreview(up.body.id, up.body.versionId);
        // 存储层已把 metadata 解析成对象（safeParse），这里直接用
        const meta = v.metadata || {};
        assert.equal(meta.width, 800);
        assert.equal(meta.height, 600);
        assert.equal(meta.processor, 'image');
    });

    test('每个版本的派生文件各自独立（不共享）', async () => {
        const png = await makePng(320, 240);
        const up = await upload('多版本.png', png);
        const id = up.body.id;

        // 追加第二版
        const fd = new FormData();
        fd.append('file', new File([await makePng(500, 500)], '多版本.png'));
        fd.append('assetId', String(id));
        const r2 = await fetch(`${baseUrl}/api/assets/upload`, { method: 'POST', body: fd });
        const v2body = await r2.json();

        const v1 = await waitPreview(id, up.body.versionId);
        const v2 = await waitPreview(id, v2body.versionId);

        assert.ok(v1.thumbnailStorageKey && v2.thumbnailStorageKey);
        assert.notEqual(v1.thumbnailStorageKey, v2.thumbnailStorageKey,
            '两个版本的缩略图必须是不同文件');

        // 且各自落在自己的版本目录里
        assert.match(v1.thumbnailStorageKey, new RegExp(`^${id}/${up.body.versionId}/`));
        assert.match(v2.thumbnailStorageKey, new RegExp(`^${id}/${v2body.versionId}/`));
    });
});

describe('3D 模型预览', () => {
    test('解析 GLB 得到网格/顶点/三角面统计', async () => {
        const gltf = {
            asset: { generator: 'unit-test' },
            meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
            accessors: [{ count: 300 }],
            materials: [{ name: 'm1' }],
            textures: [{ source: 0 }],
            animations: [{ name: 'walk' }],
            nodes: [{ name: 'root' }]
        };
        const up = await upload('统计.glb', makeGlb(gltf));
        assert.equal(up.status, 201);

        const v = await waitPreview(up.body.id, up.body.versionId);
        // GLB 目前不产出图片，但元数据应该有
        const meta = v.metadata || {};
        assert.equal(meta.meshes, 1);
        assert.equal(meta.vertices, 300);
        assert.equal(meta.triangles, 100, '300 顶点 / 3 = 100 三角面');
        assert.equal(meta.materials, 1);
        assert.equal(meta.animations, 1);
        assert.equal(meta.generator, 'unit-test');
    });

    test('损坏的 GLB → failed 而不是崩溃', async () => {
        // 用真 GLB 头（否则魔数校验会先拒，测不到预览管线这条路径），
        // 但 JSON chunk 里放非法内容 → 处理器应报 failed
        const head = Buffer.alloc(12);
        head.write('glTF', 0, 'ascii');
        head.writeUInt32LE(2, 4);
        const badJson = Buffer.from('{ this is not valid json', 'utf8');
        const chunkHead = Buffer.alloc(8);
        chunkHead.writeUInt32LE(badJson.length, 0);
        chunkHead.writeUInt32LE(0x4e4f534a, 4);
        head.writeUInt32LE(12 + 8 + badJson.length, 8);
        const broken = Buffer.concat([head, chunkHead, badJson]);

        const up = await upload('损坏.glb', broken);
        assert.equal(up.status, 201, '上传本身应成功（魔数是合法的 glTF）');

        const v = await waitPreview(up.body.id, up.body.versionId);
        assert.equal(v.previewStatus, 'failed');
        assert.ok(v.previewError, '失败应有原因说明');
    });
});

describe('文本预览', () => {
    test('Markdown 生成截断的纯文本预览', async () => {
        const md = Buffer.from('# 标题\n\n正文内容\n\n```js\nconsole.log(1)\n```\n', 'utf8');
        const up = await upload('文档.md', md);
        const v = await waitPreview(up.body.id, up.body.versionId);
        assert.equal(v.previewStatus, 'ready');
        assert.ok(v.previewStorageKey);
        const abs = resolveAssetPath(v.previewStorageKey);
        const text = readFileSync(abs, 'utf8');
        assert.ok(text.includes('# 标题'), '预览应含原文内容');
    });

    test('JSON 自动格式化，便于人读', async () => {
        const json = Buffer.from('{"a":1,"b":[2,3]}', 'utf8');
        const up = await upload('配置.json', json);
        const v = await waitPreview(up.body.id, up.body.versionId);
        const text = readFileSync(resolveAssetPath(v.previewStorageKey), 'utf8');
        assert.ok(text.includes('\n'), '格式化后应有多行');
        assert.ok(text.includes('"a"'));
    });
});

describe('失败处理', () => {
    test('预览失败不影响原件 —— 原始文件仍可下载', async () => {
        // 视频类型当前无 ffmpeg，必然 failed
        // 用真 MP4 头（ftyp），否则魔数校验会先拒掉，测不到预览失败这条路径
        const mp4Head = Buffer.alloc(24);
        mp4Head.writeUInt32BE(20, 0);
        mp4Head.write('ftypisom', 4, 'ascii');
        mp4Head.writeUInt32BE(512, 16);
        const mp4 = Buffer.concat([mp4Head, Buffer.alloc(500)]);
        const up = await upload('失败案例.mp4', mp4);
        assert.equal(up.status, 201, '上传本身应成功');

        const v = await waitPreview(up.body.id, up.body.versionId);
        assert.equal(v.previewStatus, 'failed');
        assert.ok(v.previewError && v.previewError.length > 0, '失败原因应写进 preview_error');

        // 关键：原件完好
        const dl = await fetch(`${baseUrl}/api/assets/files/${up.body.id}/original/latest`);
        assert.equal(dl.status, 200, '原始文件必须仍可下载');
        const buf = Buffer.from(await dl.arrayBuffer());
        assert.equal(buf.length, mp4.length, '原始文件字节数应不变');
    });

    test('不支持的类型 → none（不是 failed）', async () => {
        const zip = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(200)]);
        const up = await upload('归档.zip', zip);
        const v = await waitPreview(up.body.id, up.body.versionId);
        assert.equal(v.previewStatus, 'none', '压缩包不需要预览，不算失败');
    });

    test('未生成预览时请求预览文件 → 404 且提示明确', async () => {
        // zip 不会产生预览，所以它的 preview_storage_key 恒为空 ——
        // 这正是「未生成 → 404」这条路径的样本。
        const zip = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(200)]);
        const up = await upload('无预览.zip', zip);
        const v = await waitPreview(up.body.id, up.body.versionId);
        assert.equal(v.previewStatus, 'none');

        const r = await fetch(`${baseUrl}/api/assets/files/${up.body.id}/preview/latest`);
        assert.equal(r.status, 404);
        const body = await r.json();
        assert.match(body.message, /预览/);

        const t = await fetch(`${baseUrl}/api/assets/files/${up.body.id}/thumbnail/latest`);
        assert.equal(t.status, 404);
    });
});

describe('重新生成预览', () => {
    test('端点可手动重试，成功后状态转 ready', async () => {
        const png = await makePng(200, 200);
        const up = await upload('重试.png', png);
        await waitPreview(up.body.id, up.body.versionId);

        const r = await fetch(`${baseUrl}/api/assets/${up.body.id}/versions/${up.body.versionId}/preview`, {
            method: 'POST'
        });
        assert.equal(r.status, 200);
        const body = await r.json();
        assert.equal(body.status, 'ready');
        assert.ok(body.previewStorageKey);
    });

    test('对不存在的版本返回 404', async () => {
        const r = await fetch(`${baseUrl}/api/assets/999999/versions/999999/preview`, { method: 'POST' });
        assert.equal(r.status, 404);
    });
});
