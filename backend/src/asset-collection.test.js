// 资源集合（Packs）的存储层测试（008）。
//
// 覆盖的重点不是「能不能加进去」，而是**集合与资源的关系边界**：
//   - 删集合绝不能删资源（集合是视图不是容器）
//   - 软删的资源不出现在集合里，恢复后自动回来
//   - 永久删除资源后成员行不悬空
//   - 重复加入幂等、同名集合撞车

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTestingDatabase } from './db.js';
import * as store from './asset-store.js';
import * as col from './asset-collection-store.js';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

function makeDb() {
    const db = createTestingDatabase({ memory: true });
    for (const f of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()) {
        db.exec(readFileSync(join(MIGRATIONS_DIR, f), 'utf8'));
    }
    return db;
}

/** 造一个资源（只要元数据，不碰磁盘）。 */
function makeAsset(db, name = '测试资源.glb', extra = {}) {
    return store.createAsset ? store.createAsset({ connection: db, name, ...extra }) : null;
}

describe('资源集合', () => {
    let db;

    beforeEach(() => {
        db = makeDb();
    });

    /** 直接插资源行 —— 集合逻辑只关心 assets.id 与 is_deleted，不需要真实文件。 */
    function seedAsset(name, isDeleted = 0) {
        const r = db.prepare(`
            INSERT INTO assets (name, type, ext, is_deleted)
            VALUES (?, 'model', 'glb', ?)
        `).run(name, isDeleted);
        return Number(r.lastInsertRowid);
    }

    test('创建集合，列表可见且成员数为 0', () => {
        const c = col.createCollection({ connection: db, name: '展会包', description: '这次展会要用的' });
        assert.ok(c.id > 0);
        const list = col.listCollections({ connection: db });
        assert.equal(list.length, 1);
        assert.equal(list[0].name, '展会包');
        assert.equal(list[0].assetCount, 0);
    });

    test('同名集合被拒绝（不是并存两个「展会包」）', () => {
        col.createCollection({ connection: db, name: '展会包' });
        assert.throws(
            () => col.createCollection({ connection: db, name: '展会包' }),
            (e) => e.code === 'conflict'
        );
        assert.equal(col.listCollections({ connection: db }).length, 1, '不该产生第二个同名集合');
    });

    test('集合名为空 / 过长被拒绝', () => {
        assert.throws(() => col.createCollection({ connection: db, name: '  ' }));
        assert.throws(() => col.createCollection({ connection: db, name: 'x'.repeat(41) }));
    });

    test('加入资源，成员数正确；重复加入幂等', () => {
        const c = col.createCollection({ connection: db, name: '包A' });
        const a1 = seedAsset('模型1.glb');
        const a2 = seedAsset('模型2.glb');

        const r1 = col.addAssetsToCollection({ connection: db, collectionId: c.id, assetIds: [a1, a2] });
        assert.equal(r1.added, 2);

        // 重复加入同一批：不报错、不重复计数
        const r2 = col.addAssetsToCollection({ connection: db, collectionId: c.id, assetIds: [a1, a2] });
        assert.equal(r2.added, 0);
        assert.equal(r2.skipped, 2);

        const got = col.getCollection({ connection: db, id: c.id });
        assert.equal(got.assets.length, 2);
    });

    test('一个资源可同时属于多个集合（这是与文件夹的本质区别）', () => {
        const c1 = col.createCollection({ connection: db, name: '展会包' });
        const c2 = col.createCollection({ connection: db, name: '评审包' });
        const a = seedAsset('共用的模型.glb');

        col.addAssetsToCollection({ connection: db, collectionId: c1.id, assetIds: [a] });
        col.addAssetsToCollection({ connection: db, collectionId: c2.id, assetIds: [a] });

        const owned = col.listCollectionsOfAsset({ connection: db, assetId: a });
        assert.equal(owned.length, 2, '同一资源应能同时出现在两个集合里');
        assert.deepEqual(owned.map((x) => x.name).sort(), ['展会包', '评审包'].sort());
    });

    test('关键：删除集合不删资源', () => {
        const c = col.createCollection({ connection: db, name: '临时包' });
        const a = seedAsset('不该被删的模型.glb');
        col.addAssetsToCollection({ connection: db, collectionId: c.id, assetIds: [a] });

        col.deleteCollection({ connection: db, id: c.id });

        // 资源还在，且它的文件夹归属、版本等一概不受影响
        const alive = db.prepare('SELECT id FROM assets WHERE id = ?').get(a);
        assert.ok(alive, '删集合绝不能删资源 —— 集合只是视图，不是容器');
        // 成员行随集合 CASCADE 清理，不留悬空
        const items = db.prepare('SELECT COUNT(*) AS n FROM asset_collection_items').get().n;
        assert.equal(items, 0);
    });

    test('从集合移除资源，资源本身仍在', () => {
        const c = col.createCollection({ connection: db, name: '包B' });
        const a = seedAsset('模型.glb');
        col.addAssetsToCollection({ connection: db, collectionId: c.id, assetIds: [a] });

        const r = col.removeAssetsFromCollection({ connection: db, collectionId: c.id, assetIds: [a] });
        assert.equal(r.removed, 1);
        assert.ok(db.prepare('SELECT id FROM assets WHERE id = ?').get(a), '资源本身必须还在');
        assert.equal(col.getCollection({ connection: db, id: c.id }).assets.length, 0);
    });

    test('软删的资源不出现在集合里，恢复后自动回来', () => {
        const c = col.createCollection({ connection: db, name: '包C' });
        const a = seedAsset('会进回收站的模型.glb');
        col.addAssetsToCollection({ connection: db, collectionId: c.id, assetIds: [a] });

        // 软删
        store.setAssetsDeleted({ connection: db, assetIds: [a], toTrash: true });
        assert.equal(col.getCollection({ connection: db, id: c.id }).assets.length, 0,
            '回收站里的资源不该出现在集合里');
        // 集合列表的成员数也要跟着降，否则显示「1 个资源」点进去是空的
        assert.equal(col.listCollections({ connection: db })[0].assetCount, 0);

        // 恢复
        store.setAssetsDeleted({ connection: db, assetIds: [a], toTrash: false });
        assert.equal(col.getCollection({ connection: db, id: c.id }).assets.length, 1,
            '恢复后应自动回到原集合（不需要额外维护成员关系）');
    });

    test('不能把回收站里的资源加进集合', () => {
        const c = col.createCollection({ connection: db, name: '包D' });
        const a = seedAsset('已在回收站.glb', 1);
        const r = col.addAssetsToCollection({ connection: db, collectionId: c.id, assetIds: [a] });
        assert.equal(r.added, 0);
        assert.deepEqual(r.missing, [a], '回收站里的资源应记入 missing');
    });

    test('永久删除资源后成员行被 CASCADE 清理，不留悬空', () => {
        const c = col.createCollection({ connection: db, name: '包E' });
        const a = seedAsset('将被永久删除.glb');
        col.addAssetsToCollection({ connection: db, collectionId: c.id, assetIds: [a] });

        store.setAssetsDeleted({ connection: db, assetIds: [a], toTrash: true });
        store.purgeAssets({ connection: db, assetIds: [a] });

        const items = db.prepare('SELECT COUNT(*) AS n FROM asset_collection_items WHERE asset_id = ?').get(a).n;
        assert.equal(items, 0, '资源永久删除后，成员行不能悬空');
        assert.ok(col.getCollection({ connection: db, id: c.id }).collection, '集合本身应仍在');
    });

    test('重命名集合：可以改，但不能撞已有名字', () => {
        const c1 = col.createCollection({ connection: db, name: '甲' });
        col.createCollection({ connection: db, name: '乙' });

        const renamed = col.updateCollection({ connection: db, id: c1.id, name: '丙' });
        assert.equal(renamed.name, '丙');

        assert.throws(
            () => col.updateCollection({ connection: db, id: c1.id, name: '乙' }),
            (e) => e.code === 'conflict'
        );
    });

    test('不存在的集合返回 null / not_found', () => {
        assert.equal(col.getCollection({ connection: db, id: 9999 }).collection, null);
        assert.throws(() => col.deleteCollection({ connection: db, id: 9999 }), (e) => e.code === 'not_found');
        assert.throws(
            () => col.addAssetsToCollection({ connection: db, collectionId: 9999, assetIds: [1] }),
            (e) => e.code === 'not_found'
        );
    });

    test('集合里的资源结构与资源列表一致（前端可复用同一套渲染）', () => {
        const c = col.createCollection({ connection: db, name: '结构一致性' });
        const a = seedAsset('模型.glb');
        col.addAssetsToCollection({ connection: db, collectionId: c.id, assetIds: [a] });

        const asset = col.getCollection({ connection: db, id: c.id }).assets[0];
        // 这些字段是列表渲染依赖的，缺一个前端就得写分支
        for (const key of ['id', 'name', 'type', 'ext', 'latestVersionNumber', 'publishedVersionNumber',
            'previewStatus', 'hasThumbnail', 'status', 'versionCount', 'tags']) {
            assert.ok(key in asset, `集合里的资源应含字段 ${key}`);
        }
    });
});
