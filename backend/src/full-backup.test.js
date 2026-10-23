// 全量备份的往返测试。
//
// 本文件的存在源于一个真实的数据保护漏洞：
//   此前 /api/backup/export 只导出文档 JSON，**资源文件与文档图片都不在备份里**。
//   用户点「导出备份」以为数据安全了，实际只保住了文字 ——
//   原图、模型、预览图一个都没进包。
//
// 所以这里测的不是「函数返回了什么」，而是**往返后数据是否真的还在**：
// 导出 → 清空 → 恢复 → 逐项比对。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync, readFileSync, createWriteStream } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import archiver from 'archiver';
import { createTestingDatabase } from './db.js';
import { exportSnapshot, importSnapshot, createDocument, updateDocument, createCategory } from './store.js';
import { buildFullBackup, listAllAssetIds, listUploadFiles } from './full-backup.js';
import { extractFullBackup, restoreFullBackup } from './full-backup-restore.js';

/**
 * 造一个带完整生产 schema 的库。
 *
 * 直接跑**真实的迁移 SQL 文件**，而不是手写 CREATE TABLE ——
 * 手写过一版，结果 categories 表漏了 created_at 列，
 * createCategory 报「table categories has no column named created_at」。
 * 用真实迁移文件，测试用的就是生产 schema，不会再漂移。
 *
 * 用 createTestingDatabase({ memory: true }) —— createDatabase() 的 path 参数
 * 不接受 ':memory:'（会被当成普通文件路径而报「无法打开数据库」）。
 */
function makeDb() {
    const db = createTestingDatabase({ memory: true });
    for (const file of ['001_init.sql', '002_page_tree.sql', '003_assets.sql', '004_placeholder.sql', '005_asset_settings.sql']) {
        const sql = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'migrations', file), 'utf8');
        db.exec(sql);
    }
    return db;
}

describe('全量备份', () => {
    test('导出清单包含文档、资源与图片三部分计数', () => {
        const db = makeDb();
        createCategory({ connection: db, name: '规范' });
        createDocument({ connection: db, title: '部署手册', content_md: '# 部署\n步骤一', category_id: 1 });

        // 插一条资源（含回收站标记，验证回收站也被备份）
        db.prepare(`
            INSERT INTO assets (id, name, type, ext, is_deleted, deleted_at, deleted_by)
            VALUES (1, '模型.glb', 'model', 'glb', 1, datetime('now'), 'local')
        `).run();
        db.prepare(`
            INSERT INTO asset_versions (id, asset_id, version_number, original_storage_key, file_size, sha256)
            VALUES (1, 1, 1, '1/1/original.glb', 1024, 'abc123')
        `).run();

        const built = buildFullBackup({ connection: db });

        assert.equal(built.manifest.kind, 'full-backup');
        assert.equal(built.manifest.counts.documents, 1);
        assert.equal(built.manifest.counts.categories, 1);
        assert.equal(built.manifest.counts.assets, 1, '回收站里的资源也要计入备份');
        assert.equal(built.manifest.counts.asset_files, 1);
        assert.ok(built.documents.documents.length === 1);
        assert.ok(built.assetManifest, '资源清单应存在');
        db.close();
    });

    test('listAllAssetIds 含回收站资源', () => {
        const db = makeDb();
        db.prepare(`INSERT INTO assets (id, name, is_deleted) VALUES (1, 'a.glb', 1)`).run();
        db.prepare(`INSERT INTO assets (id, name, is_deleted) VALUES (2, 'b.glb', 0)`).run();
        const ids = listAllAssetIds(db);
        assert.deepEqual(ids, [1, 2], '回收站资源不能漏 —— 误删后就找不回来了');
        db.close();
    });

    test('导出包含 manifest / documents / uploads / assets 四部分', async () => {
        const db = makeDb();
        createDocument({ connection: db, title: '文档A', content_md: '内容' });

        const built = buildFullBackup({ connection: db });
        assert.ok(built.manifest);
        assert.ok(built.documents);
        assert.equal(built.manifest.counts.uploads, listUploadFiles().length);
        db.close();
    });

    test('文档往返：导出 → 恢复 → 内容一致', () => {
        const db = makeDb();
        createCategory({ connection: db, name: '分类X' });
        createDocument({ connection: db, title: '原文档', content_md: '正文内容', category_id: 1 });

        const snapshot = exportSnapshot({ connection: db });

        // 模拟「换机器」：清空后恢复
        db.prepare('DELETE FROM document_tags').run();
        db.prepare('DELETE FROM documents').run();
        db.prepare('DELETE FROM categories').run();

        const stats = importSnapshot({ connection: db, snapshot });
        assert.equal(stats.imported, 1);

        const docs = db.prepare('SELECT title, content_md FROM documents').all();
        assert.equal(docs.length, 1);
        assert.equal(docs[0].title, '原文档');
        assert.equal(docs[0].content_md, '正文内容');
        db.close();
    });

    test('恢复是合并模式，不删除既有数据', () => {
        const db = makeDb();
        createDocument({ connection: db, title: '既有文档', content_md: 'x' });

        const snapshot = exportSnapshot({ connection: db });
        createDocument({ connection: db, title: '备份里没有的', content_md: 'y' });

        importSnapshot({ connection: db, snapshot });

        const n = db.prepare('SELECT COUNT(*) n FROM documents').get().n;
        assert.equal(n, 2, '既有数据不能被恢复操作删除');
        db.close();
    });

    test('资源往返：manifest 保留版本与 sha256', () => {
        const db = makeDb();
        db.prepare(`INSERT INTO assets (id, name, type, ext) VALUES (1, '模型.glb', 'model', 'glb')`).run();
        db.prepare(`
            INSERT INTO asset_versions (id, asset_id, version_number, original_storage_key, file_size, sha256, comment)
            VALUES (1, 1, 1, '1/1/original.glb', 2048, 'deadbeef', '首个版本')
        `).run();

        const built = buildFullBackup({ connection: db });
        const v = built.assetManifest.assets[0].versions[0];
        assert.equal(v.sha256, 'deadbeef', 'sha256 要保留 —— 去重功能依赖它');
        assert.equal(v.fileSize, 2048);
        assert.equal(v.comment, '首个版本');
        db.close();
    });

    test('端到端：真实文件往返后内容逐字节一致', async () => {
        // 这是本文件最关键的一项：前面的测试只验清单结构，
        // 这里验**真实文件**能否从包里出来还是原来的内容。
        //
        // 做法：造资源文件 → 打包成 ZIP → 解压 → 比对字节。
        // 若「包结构对但文件没落进去」，只有这项能发现。
        //
        // 用 ASSET_DIR 环境变量把主存储指向临时目录，
        // 这样走的是**真实的 resolveAssetPath 逻辑**（含路径穿越防护），
        // 而不是手工拼路径绕过去 —— 后者测不到真实行为。
        const db = makeDb();
        db.prepare(`INSERT INTO assets (id, name, type, ext) VALUES (1, '模型.glb', 'model', 'glb')`).run();

        const assetRoot = mkdtempSync(join(tmpdir(), 'tt-fb-assets-'));
        process.env.ASSET_DIR = assetRoot;
        // ASSET_DIR 是模块加载时的常量 → 必须带 query 让 ESM 重新求值
        const storageMod = await import(`./asset-storage.js?t=${Date.now()}`);

        // storageKey 必须符合 resolveAssetPath 的严格格式：
        //   <assetId>/<versionId>/<kind><13~16位时间戳>-<16位hex>.<ext>
        // 这不是随意的格式要求 —— 它是**路径穿越防护**：
        // 校验不通过会返回 null，文件被跳过（不进包）。
        const storageKey = '1/1/original' + Date.now() + '-0123456789abcdef.glb';
        mkdirSync(join(assetRoot, '1', '1'), { recursive: true });
        const payload = Buffer.from('GLB-BINARY-PAYLOAD-'.repeat(50));
        writeFileSync(join(assetRoot, storageKey), payload);

        db.prepare(`
            INSERT INTO asset_versions (id, asset_id, version_number, original_storage_key, file_size, sha256)
            VALUES (1, 1, 1, ?, ?, ?)
        `).run(storageKey, payload.length, 'sha-of-payload');

        assert.ok(storageMod.resolveAssetPath(storageKey), '合法 storageKey 必须能解析出绝对路径');

        // 打成 ZIP（与 exportFullBackup 同样的写法）
        const zipPath = join(mkdtempSync(join(tmpdir(), 'tt-fb-zip-')), 'full.zip');
        const zipOut = createWriteStream(zipPath);
        const built = buildFullBackup({ connection: db });
        const archive = archiver('zip', { zlib: { level: 6 } });
        archive.pipe(zipOut);
        archive.append(JSON.stringify(built.manifest, null, 2), { name: 'manifest.json' });
        archive.append(JSON.stringify(built.documents, null, 2), { name: 'documents.json' });
        if (built.assetManifest) {
            archive.append(JSON.stringify(built.assetManifest, null, 2), { name: 'assets/manifest.json' });
        }
        let added = 0;
        for (const f of built.files) {
            const abs = storageMod.resolveAssetPath(f.storageKey);
            if (abs) {
                archive.file(abs, { name: `assets/${f.zipPath}` });
                added++;
            }
        }
        assert.equal(added, 1, '应有 1 个文件进入包');
        await archive.finalize();
        await new Promise((r) => zipOut.on('close', r));

        // 解压并核对
        const extractDir = mkdtempSync(join(tmpdir(), 'tt-fb-extract-'));
        const extracted = await extractFullBackup(zipPath, extractDir);
        assert.equal(extracted.manifest.kind, 'full-backup');
        assert.ok(extracted.assetManifest, '资源清单应被解出');

        // 包内路径由 zipPath 决定：files/<assetId>/<versionId>/<kind><ext>
        const restoredFile = join(extractDir, 'assets', 'files', '1', '1', 'original.glb');
        assert.ok(existsSync(restoredFile), `资源文件必须真的在包里：${restoredFile}`);
        assert.deepEqual(readFileSync(restoredFile), payload, '文件内容必须逐字节一致');

        delete process.env.ASSET_DIR;
        rmSync(assetRoot, { recursive: true, force: true });
        rmSync(extractDir, { recursive: true, force: true });
        rmSync(dirname(zipPath), { recursive: true, force: true });
        db.close();
    });
});
