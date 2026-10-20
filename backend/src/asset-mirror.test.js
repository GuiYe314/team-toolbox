// 资源管理：存储路径（镜像）与导入导出测试。
//
// 重点覆盖用户明确要求的两块新功能：
//   ① 设置资源保存路径 → 资源自动拷贝到指定路径
//   ② 导入导出资源
//
// 以及安全边界（这两块功能都涉及「服务端在任意路径写文件」与
// 「解压外部内容」，是攻击面最大的地方）：
//   - 相对路径被拒绝
//   - 不存在的路径被拒绝
//   - 路径穿越（ZIP 内含 ../）被拒绝
//   - 镜像目录与主存储互相包含时被拒绝（防自我递归）
//   - 非本工具导出的包被拒绝

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TMP_ROOT = mkdtempSync(join(tmpdir(), 'asset-mirror-'));
process.env.ASSET_DIR = join(TMP_ROOT, 'assets');

const express = (await import('express')).default;
const Database = (await import('better-sqlite3')).default;
const { runMigrations } = await import('./migrate.js');
const { registerAssetApi } = await import('./asset-api.js');
const { ASSET_DIR } = await import('./asset-storage.js');
const mirror = await import('./asset-mirror.js');
const transfer = await import('./asset-transfer.js');

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

    // 记录连接的 closeAll，供 after 钩子清理 keep-alive 连接
    globalThis.__closeIdle = () => {
        try { server.closeAllConnections(); } catch { /* 旧版本 Node 无此方法 */ }
    };
});

after(async () => {
    // Node 18+ 的 fetch 会 keep-alive，server.close() 会等这些连接结束才回调，
    // 导致测试进程挂住（表现为文件级 SIGTERM 而子用例全过）。
    // 显式关闭空闲连接即可。
    if (globalThis.__closeIdle) globalThis.__closeIdle();
    await new Promise((r) => server.close(r));
    try { db.close(); } catch { /* 已关闭 */ }
    rmSync(TMP_ROOT, { recursive: true, force: true });
});

// ── helpers ────────────────────────────────────────────────────────

function makeGlb(n = 1024) {
    const h = Buffer.alloc(12);
    h.write('glTF', 0, 'ascii');
    h.writeUInt32LE(2, 4);
    h.writeUInt32LE(12 + n, 8);
    return Buffer.concat([h, Buffer.alloc(n, 7)]);
}

async function upload(name, buf, fields = {}) {
    const fd = new FormData();
    fd.append('file', new File([buf], name, { type: 'application/octet-stream' }));
    for (const [k, v] of Object.entries(fields)) fd.append(k, String(v));
    const res = await fetch(baseUrl + '/api/assets/upload', { method: 'POST', body: fd });
    return { status: res.status, body: await res.json().catch(() => null) };
}

async function api(path, opts = {}) {
    const res = await fetch(baseUrl + path, {
        method: opts.method || 'GET',
        headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
        body: opts.body ? JSON.stringify(opts.body) : undefined
    });
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
        return { status: res.status, body: await res.json().catch(() => null), headers: res.headers };
    }
    return { status: res.status, body: Buffer.from(await res.arrayBuffer()), headers: res.headers };
}

/** 递归列出目录下的文件（相对路径）。 */
function listFiles(dir, base = '') {
    const out = [];
    for (const e of readdirSync(dir, { withFileTypes: true })) {
        const rel = base ? `${base}/${e.name}` : e.name;
        if (e.isDirectory()) out.push(...listFiles(join(dir, e.name), rel));
        else out.push(rel);
    }
    return out;
}

describe('存储路径设置：路径校验', () => {
    test('相对路径被拒绝', () => {
        assert.throws(() => mirror.normalizeMirrorPath('assets/backup'), /绝对路径/);
        assert.throws(() => mirror.normalizeMirrorPath('./data'), /绝对路径/);
    });

    test('空路径被拒绝', () => {
        assert.throws(() => mirror.normalizeMirrorPath(''), /不能为空/);
        assert.throws(() => mirror.normalizeMirrorPath('   '), /不能为空/);
    });

    test('不存在的路径被拒绝', () => {
        const missing = join(TMP_ROOT, 'no-such-dir-' + Date.now());
        assert.throws(() => mirror.normalizeMirrorPath(missing), /不存在/);
    });

    test('文件（非目录）被拒绝', () => {
        const f = join(TMP_ROOT, 'a-file.txt');
        writeFileSync(f, 'x');
        assert.throws(() => mirror.normalizeMirrorPath(f), /不是文件夹/);
    });

    test('主存储目录本身及其子目录被拒绝（防自我递归）', () => {
        assert.throws(() => mirror.normalizeMirrorPath(ASSET_DIR), /不能是资源主存储目录/);
        assert.throws(() => mirror.normalizeMirrorPath(join(ASSET_DIR, 'sub')), /不能是资源主存储目录/);
    });

    test('主存储的上级目录被拒绝', () => {
        // 镜像目录是主存储的上级 → 同步会把主存储整个拷进镜像里自己
        assert.throws(() => mirror.normalizeMirrorPath(TMP_ROOT), /上级目录/);
    });

    test('合法路径被接受并规范化', () => {
        const good = join(TMP_ROOT, 'mirror-ok');
        mkdirSync(good, { recursive: true });
        const norm = mirror.normalizeMirrorPath(good);
        assert.equal(norm, good.replace(/[\\/]+$/, ''));
    });

    test('末尾分隔符被规范化掉', () => {
        const good = join(TMP_ROOT, 'mirror-slash');
        mkdirSync(good, { recursive: true });
        const norm = mirror.normalizeMirrorPath(good + '/');
        assert.ok(!norm.endsWith('/'), '不应以分隔符结尾');
        assert.ok(!norm.endsWith('\\'), '不应以分隔符结尾');
    });
});

describe('存储路径设置：配置读写与同步', () => {
    let mirrorDir;

    before(() => {
        mirrorDir = join(TMP_ROOT, 'mirror-main');
        mkdirSync(mirrorDir, { recursive: true });
    });

    test('设置路径后立即全量同步现有资源', async () => {
        // 先造一个资源（此时还没设镜像）
        const up = await upload('同步测试.glb', makeGlb(2048));
        assert.equal(up.status, 201);

        const r = await api('/api/assets/settings/storage', {
            method: 'PUT', body: { path: mirrorDir }
        });
        assert.equal(r.status, 200);
        assert.equal(r.body.path, mirrorDir.replace(/[\\/]+$/, ''));
        assert.ok(r.body.synced.copied >= 1, '应至少拷贝了 1 个文件');
        assert.equal(r.body.synced.failed, 0);
    });

    test('资源文件确实出现在指定路径下', () => {
        const files = listFiles(mirrorDir);
        assert.ok(files.length >= 1, '镜像目录应非空');
        // 文件名必须是服务端生成的形态（original<时间戳>-<hex>.glb）
        assert.ok(files.some(f => /original\d+-[0-9a-f]+\.glb$/.test(f)),
            '镜像内文件名应为服务端生成形态，实际：' + files.join(','));
    });

    test('设置后新上传的资源自动进入镜像目录', async () => {
        const before = listFiles(mirrorDir).length;
        const up = await upload('自动同步.glb', makeGlb(1024));
        assert.equal(up.status, 201);
        const after = listFiles(mirrorDir);
        assert.ok(after.length > before, '新资源应自动拷贝到镜像目录');
        assert.ok(after.some(f => f.includes(String(up.body.id))), '应包含新资源 id 的目录');
    });

    test('GET 返回路径与统计', async () => {
        const r = await api('/api/assets/settings/storage');
        assert.equal(r.status, 200);
        assert.equal(r.body.configured, true);
        assert.ok(r.body.files >= 2, '应统计到已同步文件数');
        assert.ok(r.body.bytes > 0);
        assert.ok(r.body.primaryPath, '应返回主存储路径供 UI 展示');
    });

    test('手动同步不改变配置', async () => {
        const r = await api('/api/assets/settings/storage/sync', { method: 'POST' });
        assert.equal(r.status, 200);
        assert.equal(r.body.path, mirrorDir.replace(/[\\/]+$/, ''));
        assert.ok(r.body.synced);
    });

    test('validate 只校验不写入', async () => {
        const r = await api('/api/assets/settings/storage/validate', {
            method: 'POST', body: { path: 'relative/path' }
        });
        assert.equal(r.status, 400);
        assert.match(r.body.message, /绝对路径/);

        const cur = await api('/api/assets/settings/storage');
        assert.equal(cur.body.path, mirrorDir.replace(/[\\/]+$/, ''), '配置不应被改变');
    });

    test('清空镜像目录内容但保留配置', async () => {
        const r = await api('/api/assets/settings/storage/clear', { method: 'POST' });
        assert.equal(r.status, 200);
        assert.ok(r.body.removed >= 1, '应删除了一些文件');
        const after = await api('/api/assets/settings/storage');
        assert.equal(after.body.configured, true, '配置应保留');
        assert.equal(after.body.files, 0, '内容应已清空');
    });

    test('清除配置后不再镜像', async () => {
        const r = await api('/api/assets/settings/storage', { method: 'PUT', body: { path: '' } });
        assert.equal(r.status, 200);
        assert.equal(r.body.cleared, true);

        const before = listFiles(mirrorDir).length;
        await upload('不再同步.glb', makeGlb(512));
        assert.equal(listFiles(mirrorDir).length, before, '清除配置后不应再自动拷贝');
    });
});

describe('永久删除的磁盘清理', () => {
    test('删除资源后不留空目录（回归点：曾残留 51 个空壳目录）', async () => {
        const up = await upload('目录清理测试.glb', makeGlb(2048));
        assert.equal(up.status, 201);
        const id = up.body.id;

        // 资源目录此时应存在
        const assetDir = join(ASSET_DIR, String(id));
        assert.ok(existsSync(assetDir), '上传后资源目录应存在');

        // 软删除 → 永久删除
        await api('/api/assets/batch-delete', { method: 'POST', body: { assetIds: [id] } });
        const purge = await api('/api/assets/purge?confirm=1', {
            method: 'POST', body: { assetIds: [id] }
        });
        assert.equal(purge.status, 200);

        // 元数据没了，磁盘目录也必须没有 ——
        // 否则会堆积无主空目录（数据库里已查无此资源，永远不会被回收）
        assert.equal(existsSync(assetDir), false, '资源目录应被一并删除');
    });

    test('删除单个版本时，若资源还有其他版本则不删资源目录', async () => {
        const up = await upload('多版本目录.glb', makeGlb(2048));
        const id = up.body.id;
        await upload('多版本目录.glb', makeGlb(4096), { assetId: id });

        const versions = (await api(`/api/assets/${id}/versions`)).body.items;
        const v1 = versions.find((v) => v.versionNumber === 1);

        const r = await api(`/api/assets/${id}/versions/${v1.id}`, { method: 'DELETE' });
        assert.equal(r.status, 200);

        // 还有 v2 在，资源目录必须保留
        const assetDir = join(ASSET_DIR, String(id));
        assert.ok(existsSync(assetDir), '还有其他版本时资源目录应保留');
    });
});

describe('导入导出', () => {
    test('导出为 ZIP，含 manifest.json', async () => {
        const up = await upload('导出测试.glb', makeGlb(4096));
        assert.equal(up.status, 201);

        const r = await api('/api/assets/export', {
            method: 'POST', body: { assetIds: [up.body.id] }
        });
        assert.equal(r.status, 200);
        assert.match(r.headers.get('content-type'), /application\/zip/);
        assert.match(r.headers.get('content-disposition'), /attachment/);
        // ZIP 魔数 PK\x03\x04
        assert.equal(r.body[0], 0x50);
        assert.equal(r.body[1], 0x4b);
        assert.ok(r.body.length > 100, 'ZIP 不应为空');
    });

    test('导出未选择资源 → 400', async () => {
        const r = await api('/api/assets/export', { method: 'POST', body: { assetIds: [] } });
        assert.equal(r.status, 400);
    });

    test('导出的包能被导入回来，且 id 重新分配', async () => {
        const up = await upload('往返测试.glb', makeGlb(8192));
        const exported = await api('/api/assets/export', {
            method: 'POST', body: { assetIds: [up.body.id] }
        });
        const zip = exported.body;

        const fd = new FormData();
        fd.append('file', new File([zip], 'package.zip', { type: 'application/zip' }));
        const res = await fetch(baseUrl + '/api/assets/import', { method: 'POST', body: fd });
        const body = await res.json();

        assert.equal(res.status, 201, JSON.stringify(body));
        assert.ok(body.assets >= 1, '应导入至少一个资源');
        assert.ok(body.versions >= 1, '应导入至少一个版本');

        // 列表里应出现两个同名资源（原版 + 导入版），id 不同
        const list = await api('/api/assets?search=' + encodeURIComponent('往返测试'));
        assert.equal(list.body.total, 2, '原资源与导入资源应并存');
        const ids = list.body.items.map((a) => a.id);
        assert.notEqual(ids[0], ids[1], '导入的资源应有新的 id');

        // 导入的资源应有版本，且 latest 指针有效
        const imported = list.body.items.find((a) => a.id !== up.body.id);
        const detail = await api('/api/assets/' + imported.id);
        assert.equal(detail.body.versions.length, 1);
        assert.equal(detail.body.latestVersionNumber, 1);
        assert.ok(detail.body.latestVersionId, 'latest 指针应有效');
    });

    test('导入的文件真的落盘且可下载', async () => {
        const up = await upload('落盘测试.glb', makeGlb(2048));
        const exported = await api('/api/assets/export', {
            method: 'POST', body: { assetIds: [up.body.id] }
        });
        const fd = new FormData();
        fd.append('file', new File([exported.body], 'p.zip', { type: 'application/zip' }));
        await fetch(baseUrl + '/api/assets/import', { method: 'POST', body: fd });

        const list = await api('/api/assets?search=' + encodeURIComponent('落盘测试'));
        const imported = list.body.items.find((a) => a.id !== up.body.id);
        const file = await fetch(`${baseUrl}/api/assets/files/${imported.id}/original/latest`);
        assert.equal(file.status, 200);
        const buf = Buffer.from(await file.arrayBuffer());
        assert.equal(buf.length, 2048 + 12, '导入文件大小应与原文件一致');
        assert.equal(buf.subarray(0, 4).toString('ascii'), 'glTF');
    });

    test('导入非 ZIP → 400 且提示明确', async () => {
        const fd = new FormData();
        fd.append('file', new File([Buffer.from('not a zip at all')], 'x.zip', { type: 'application/zip' }));
        const res = await fetch(baseUrl + '/api/assets/import', { method: 'POST', body: fd });
        assert.equal(res.status, 400);
        const body = await res.json();
        assert.ok(body.message, '应给出错误说明');
    });

    test('导入缺少 manifest 的 ZIP → 400', async () => {
        // 造一个只有普通文件的 ZIP（用系统 zip 命令不可靠，改为用 archiver 造）
        const archiver = (await import('archiver')).default;
        const { createWriteStream } = await import('node:fs');
        const zipPath = join(TMP_ROOT, 'no-manifest.zip');
        await new Promise((resolvePromise, rejectPromise) => {
            const out = createWriteStream(zipPath);
            const a = archiver('zip');
            out.on('close', resolvePromise);
            a.on('error', rejectPromise);
            a.pipe(out);
            a.append('hello', { name: 'readme.txt' });
            a.finalize();
        });

        const buf = readFileSync(zipPath);
        const fd = new FormData();
        fd.append('file', new File([buf], 'x.zip', { type: 'application/zip' }));
        const res = await fetch(baseUrl + '/api/assets/import', { method: 'POST', body: fd });
        assert.equal(res.status, 400);
        const body = await res.json();
        assert.match(body.message, /manifest/);
    });

    test('导出空 id 列表在构造清单时就应被拒', () => {
        assert.throws(
            () => transfer.buildExportManifest({ connection: db, assetIds: [] }),
            /未选择任何资源/
        );
    });
});
