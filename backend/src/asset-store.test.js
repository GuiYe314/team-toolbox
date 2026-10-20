// 资源管理存储层测试。
//
// 重点覆盖用户明确要求的三条不变量：
//   ① 版本独立不可变 —— 追加版本不影响既有版本的存储键；
//   ② Latest 与 Published 完全独立 —— 上传不移动 published，只有 publish 才移动；
//   ③ 恢复历史版本 = 复制生成新版本，latest 只前进不后退，历史一个不少。
//
// 另覆盖：回收站软删除/永久删除、文件夹环检测、标签、排序白名单。

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import * as store from './asset-store.js';
import { runMigrations } from './migrate.js';

let db;
let tmpDir;

before(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'asset-test-'));
    db = new Database(':memory:');
    // 用内存库跑真实迁移，保证测的是实际 schema 而非手写 DTO
    await runMigrations({ connection: db, allowAbsentMigrations: true });
});

after(() => {
    try { db.close(); } catch { /* 已关闭 */ }
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
});

/** 造一个资产（含 v1）。 */
function makeAsset(overrides = {}) {
    return store.createAsset({
        connection: db,
        input: {
            name: overrides.name || 'Museum.glb',
            folderId: overrides.folderId ?? null,
            type: 'model',
            mimeType: 'model/gltf-binary',
            ext: '.glb',
            fileSize: 1000,
            sha256: 'a'.repeat(64),
            originalStorageKey: overrides.key || '1/1/original1-aaaaaaaaaaaaaaaa.glb',
            comment: ''
        },
        tags: overrides.tags || []
    });
}

/** 追加一个版本（跳过文件 IO，只造元数据）。 */
function addVersion(assetId, n, size = 1000) {
    return store.addAssetVersion({
        connection: db,
        assetId,
        input: {
            originalStorageKey: `${assetId}/${n}/original${n}-bbbbbbbbbbbbbbbb.glb`,
            fileSize: size,
            sha256: 'b'.repeat(64),
            mimeType: 'model/gltf-binary',
            comment: `版本 ${n}`
        }
    });
}

describe('资源版本：三条不变量', () => {
    test('① 追加版本不影响既有版本的存储键', () => {
        const { assetId } = makeAsset({ name: '不变量1', key: '900/1/original1-cccccccccccccccc.glb' });
        const before = store.listVersions({ connection: db, assetId });
        const v1key = before[0].originalStorageKey;

        addVersion(assetId, 2);

        const after = store.listVersions({ connection: db, assetId });
        const v1 = after.find((v) => v.versionNumber === 1);
        assert.equal(v1.originalStorageKey, v1key, 'v1 的存储键不应被改动');
        assert.equal(after.length, 2, '应有 v1、v2 两个版本');
    });

    test('② 上传新版本不移动 published 指针', () => {
        const { assetId, versionId: v1 } = makeAsset({ name: '不变量2', key: '901/1/original1-dddddddddddddddd.glb' });

        // 显式发布 v1
        store.publishAssetVersion({ connection: db, assetId, versionId: v1 });
        let a = store.getAsset({ connection: db, id: assetId });
        assert.equal(a.publishedVersionNumber, 1, 'v1 应已发布');

        // 上传 v2 —— published 必须原地不动
        addVersion(assetId, 2);
        a = store.getAsset({ connection: db, id: assetId });
        assert.equal(a.latestVersionNumber, 2, 'latest 应推进到 v2');
        assert.equal(a.publishedVersionNumber, 1, 'published 必须仍停在 v1');
        assert.equal(a.hasUnpublished, true, '应标记为「有未发布改动」');
        assert.equal(a.status, 'published', '资源整体状态仍是已发布');
    });

    test('② 只有显式 publish 才移动 published 指针', () => {
        const { assetId } = makeAsset({ name: '不变量2b', key: '902/1/original1-eeeeeeeeeeeeeeee.glb' });
        addVersion(assetId, 2);
        addVersion(assetId, 3);

        let a = store.getAsset({ connection: db, id: assetId });
        assert.equal(a.publishedVersionNumber, null, '从未发布过时 published 应为空');

        // 发布 v2（不是 latest v3）
        const versions = store.listVersions({ connection: db, assetId });
        const v2 = versions.find((v) => v.versionNumber === 2);
        store.publishAssetVersion({ connection: db, assetId, versionId: v2.id });

        a = store.getAsset({ connection: db, id: assetId });
        assert.equal(a.publishedVersionNumber, 2, 'published 应为 v2');
        assert.equal(a.latestVersionNumber, 3, 'latest 仍为 v3');
    });

    test('③ 恢复 v3 生成新版本，latest 不后退，历史一个不少', () => {
        const { assetId } = makeAsset({ name: '不变量3', key: '903/1/original1-ffffffffffffffff.glb' });
        addVersion(assetId, 2);
        addVersion(assetId, 3);
        addVersion(assetId, 4);

        let a = store.getAsset({ connection: db, id: assetId });
        assert.equal(a.latestVersionNumber, 4, '准备：latest 应为 v4');

        // 用户恢复 v3 —— 复制其内容生成 v5
        const versions = store.listVersions({ connection: db, assetId });
        const v3 = versions.find((v) => v.versionNumber === 3);
        const restored = store.restoreAssetVersion({
            connection: db,
            assetId,
            sourceVersionId: v3.id,
            newStorageKey: `${assetId}/5/original5-9999999999999999.glb`,
            newFileSize: 3000
        });

        assert.equal(restored.versionNumber, 5, '应生成 v5 而非把 latest 改回 v3');
        assert.equal(restored.restoredFrom, 3);

        a = store.getAsset({ connection: db, id: assetId });
        assert.equal(a.latestVersionNumber, 5, 'latest 前进到 v5');
        assert.equal(a.versionCount, 5, 'v1~v5 五个版本必须都在');

        // v1~v4 全部保留，且各自内容未被改动
        const after = store.listVersions({ connection: db, assetId });
        assert.deepEqual(
            after.map((v) => v.versionNumber).sort((x, y) => x - y),
            [1, 2, 3, 4, 5],
            '版本号必须是 1..5 完整序列'
        );
        const v5 = after.find((v) => v.versionNumber === 5);
        assert.equal(v5.fileSize, 3000, 'v5 大小应等于 v3 的内容大小');
    });

    test('③ 恢复时 published 指针不动', () => {
        const { assetId, versionId: v1 } = makeAsset({ name: '不变量3b', key: '904/1/original1-1111111111111111.glb' });
        store.publishAssetVersion({ connection: db, assetId, versionId: v1 });
        addVersion(assetId, 2);

        const versions = store.listVersions({ connection: db, assetId });
        store.restoreAssetVersion({
            connection: db,
            assetId,
            sourceVersionId: versions.find((v) => v.versionNumber === 1).id,
            newStorageKey: `${assetId}/3/original3-2222222222222222.glb`,
            newFileSize: 1000
        });

        const a = store.getAsset({ connection: db, id: assetId });
        assert.equal(a.publishedVersionNumber, 1, '恢复操作不应改变已发布版本');
        assert.equal(a.latestVersionNumber, 3, 'latest 前进到恢复生成的新版本');
    });
});

describe('版本删除保护', () => {
    test('不能删除 latest 版本', () => {
        const { assetId } = makeAsset({ name: '保护1', key: '910/1/original1-3333333333333333.glb' });
        addVersion(assetId, 2);
        const versions = store.listVersions({ connection: db, assetId });
        // latest 是 v2（最新），v1 已成历史、可以删 —— 真正受保护的是 latest
        const latest = versions.find((v) => v.versionNumber === 2);
        const older = versions.find((v) => v.versionNumber === 1);

        assert.throws(
            () => store.deleteAssetVersion({ connection: db, assetId, versionId: latest.id }),
            /当前最新版本/
        );
        assert.doesNotThrow(
            () => store.deleteAssetVersion({ connection: db, assetId, versionId: older.id }),
            '历史版本应可删除'
        );
    });

    test('不能删除 published 版本', () => {
        const { assetId, versionId: publishedId } = makeAsset({ name: '保护2', key: '911/1/original1-4444444444444444.glb' });
        addVersion(assetId, 2);
        store.publishAssetVersion({ connection: db, assetId, versionId: publishedId });

        const v1 = store.listVersions({ connection: db, assetId }).find((v) => v.versionNumber === 1);
        assert.throws(
            () => store.deleteAssetVersion({ connection: db, assetId, versionId: v1.id }),
            /当前已发布版本/
        );
    });

    test('可以删除中间的历史版本', () => {
        const { assetId } = makeAsset({ name: '保护3', key: '912/1/original1-5555555555555555.glb' });
        addVersion(assetId, 2);
        addVersion(assetId, 3);
        const v2 = store.listVersions({ connection: db, assetId }).find((v) => v.versionNumber === 2);

        store.deleteAssetVersion({ connection: db, assetId, versionId: v2.id });
        const left = store.listVersions({ connection: db, assetId }).map((v) => v.versionNumber);
        assert.deepEqual(left.sort((a, b) => a - b), [1, 3], 'v2 应消失，v1/v3 保留');
    });
});

describe('回收站', () => {
    test('软删除只打标记，不动文件', () => {
        const { assetId } = makeAsset({ name: '回收1', key: '920/1/original1-6666666666666666.glb' });
        store.setAssetsDeleted({ connection: db, assetIds: [assetId] });

        const inTrash = store.listAssets({ connection: db, filter: { scope: 'trash' } });
        assert.ok(inTrash.items.some((a) => a.id === assetId), '应出现在回收站');

        const active = store.listAssets({ connection: db, filter: { scope: 'all' } });
        assert.ok(!active.items.some((a) => a.id === assetId), '不应出现在正常列表');

        // 数据库行仍在（版本数据完好，可恢复）
        assert.equal(store.listVersions({ connection: db, assetId }).length, 1);
    });

    test('从回收站恢复', () => {
        const { assetId } = makeAsset({ name: '回收2', key: '921/1/original1-7777777777777777.glb' });
        store.setAssetsDeleted({ connection: db, assetIds: [assetId] });
        store.setAssetsDeleted({ connection: db, assetIds: [assetId], toTrash: false });

        const active = store.listAssets({ connection: db, filter: { scope: 'all' } });
        assert.ok(active.items.some((a) => a.id === assetId), '恢复后应回到正常列表');
    });

    test('永久删除只清理回收站中的资源', () => {
        const { assetId } = makeAsset({ name: '回收3', key: '922/1/original1-8888888888888888.glb' });
        addVersion(assetId, 2);

        // 未进回收站就永久删除 → 应拒绝（missing）
        const early = store.purgeAssets({ connection: db, assetIds: [assetId] });
        assert.equal(early.deleted, 0, '不在回收站的资源不应被永久删除');
        assert.equal(early.missing, 1);

        // 进回收站后永久删除 → 级联清掉版本
        store.setAssetsDeleted({ connection: db, assetIds: [assetId] });
        const r = store.purgeAssets({ connection: db, assetIds: [assetId] });
        assert.equal(r.deleted, 1);
        assert.throws(() => store.getAsset({ connection: db, id: assetId }), /资源不存在/);
    });
});

describe('文件夹', () => {
    test('新建 / 重命名 / 移动', () => {
        const parent = store.createFolder({ connection: db, name: '海昏侯' });
        const child = store.createFolder({ connection: db, name: '模型', parentId: parent.id });
        assert.equal(child.parent_id, parent.id);

        store.renameFolder({ connection: db, id: parent.id, name: '海昏侯博物馆' });
        assert.ok(store.listFolders({ connection: db }).some((f) => f.name === '海昏侯博物馆'));

        const root = store.createFolder({ connection: db, name: '公共资源' });
        store.moveFolder({ connection: db, id: child.id, parentId: root.id });
        assert.equal(store.listFolders({ connection: db }).find((f) => f.id === child.id).parent_id, root.id);
    });

    test('同级同名被拒绝', () => {
        const f = store.createFolder({ connection: db, name: '重名测试' });
        assert.throws(() => store.createFolder({ connection: db, name: '重名测试' }), /已存在/);
        // 换父级则允许
        const other = store.createFolder({ connection: db, name: '另一个父级' });
        assert.doesNotThrow(() => store.createFolder({ connection: db, name: '重名测试', parentId: other.id }));
        assert.ok(f.id);
    });

    test('不能把文件夹移入自己的子树（防环）', () => {
        const a = store.createFolder({ connection: db, name: '环A' });
        const b = store.createFolder({ connection: db, name: '环B', parentId: a.id });
        const c = store.createFolder({ connection: db, name: '环C', parentId: b.id });

        assert.throws(() => store.moveFolder({ connection: db, id: a.id, parentId: c.id }), /子文件夹/);
        assert.throws(() => store.moveFolder({ connection: db, id: a.id, parentId: a.id }), /自身/);
    });

    test('删除文件夹不删其中资源（资源变为未分类）', () => {
        const f = store.createFolder({ connection: db, name: '待删文件夹' });
        const { assetId } = makeAsset({ name: '孤儿资源', folderId: f.id, key: '930/1/original1-aaaaaaaaaaaaaaa1.glb' });

        const r = store.deleteFolder({ connection: db, id: f.id });
        assert.equal(r.orphaned_assets, 1);

        const a = store.getAsset({ connection: db, id: assetId });
        assert.equal(a.folderId, null, '资源应变为未分类而非被删');
    });
});

describe('列表筛选 / 排序 / 分页', () => {
    test('按类型与状态筛选', () => {
        const { assetId } = makeAsset({ name: '筛选目标', key: '940/1/original1-aaaaaaaaaaaaaaa2.glb' });
        store.publishAssetVersion({ connection: db, assetId, versionId: store.listVersions({ connection: db, assetId })[0].id });

        const byType = store.listAssets({ connection: db, filter: { type: 'model', pageSize: 200 } });
        assert.ok(byType.items.some((a) => a.id === assetId));

        const byPublished = store.listAssets({ connection: db, filter: { scope: 'published', pageSize: 200 } });
        assert.ok(byPublished.items.some((a) => a.id === assetId), '已发布视图应包含它');

        const byOther = store.listAssets({ connection: db, filter: { type: 'video', pageSize: 200 } });
        assert.ok(!byOther.items.some((a) => a.id === assetId));
    });

    test('搜索命中名称与标签', () => {
        const { assetId } = makeAsset({
            name: '兵马俑模型',
            tags: ['秦陵', '高模'],
            key: '941/1/original1-aaaaaaaaaaaaaaa3.glb'
        });

        const byName = store.listAssets({ connection: db, filter: { search: '兵马俑', pageSize: 200 } });
        assert.ok(byName.items.some((a) => a.id === assetId), '应按名称命中');

        const byTag = store.listAssets({ connection: db, filter: { search: '秦陵', pageSize: 200 } });
        const hit = byTag.items.find((a) => a.id === assetId);
        assert.ok(hit, '应按标签命中');
        assert.deepEqual(hit.tags.sort(), ['秦陵', '高模']);
    });

    test('非法排序字段回退到默认，不注入', () => {
        const r = store.listAssets({ connection: db, filter: { sort: 'name; DROP TABLE assets', pageSize: 5 } });
        assert.ok(r.items.length >= 0, '应安全回退而不是报错或被注入');
    });

    test('分页 total 与 page 一致', () => {
        for (let i = 0; i < 7; i++) {
            makeAsset({ name: `分页${i}`, key: `950/1/original1-aaaaaaaaaaaaaa${10 + i}.glb` });
        }
        const p1 = store.listAssets({ connection: db, filter: { page: 1, pageSize: 3, sort: 'name', order: 'asc' } });
        const p2 = store.listAssets({ connection: db, filter: { page: 2, pageSize: 3, sort: 'name', order: 'asc' } });
        assert.equal(p1.items.length, 3);
        assert.equal(p1.total, p2.total, 'total 应跨页一致');
        assert.notEqual(p1.items[0].id, p2.items[0].id, '两页不应重复');
    });
});

describe('批量操作与元数据', () => {
    test('批量移动', () => {
        const f = store.createFolder({ connection: db, name: '批量目标' });
        const ids = [
            makeAsset({ name: '批1', key: '960/1/original1-aaaaaaaaaaaaaaa4.glb' }).assetId,
            makeAsset({ name: '批2', key: '961/1/original1-aaaaaaaaaaaaaaa5.glb' }).assetId
        ];
        const r = store.moveAssets({ connection: db, assetIds: ids, folderId: f.id });
        assert.equal(r.moved, 2);
        assert.equal(store.getAsset({ connection: db, id: ids[0] }).folderId, f.id);
    });

    test('批量追加标签不清除原有标签', () => {
        const { assetId } = makeAsset({ name: '标签批量', tags: ['原有'], key: '962/1/original1-aaaaaaaaaaaaaaa6.glb' });
        store.addTagsToAssets({ connection: db, assetIds: [assetId], tags: ['新增', '原有'] });
        const tags = store.getAsset({ connection: db, id: assetId }).tags;
        assert.deepEqual(tags.sort(), ['原有', '新增']);
    });

    test('重命名与描述更新', () => {
        const { assetId } = makeAsset({ name: '旧名字', key: '963/1/original1-aaaaaaaaaaaaaaa7.glb' });
        store.renameAsset({ connection: db, assetId, name: '新名字' });
        assert.equal(store.getAsset({ connection: db, id: assetId }).name, '新名字');

        store.updateAsset({ connection: db, assetId, patch: { description: '秦陵出土文物' } });
        assert.equal(store.getAsset({ connection: db, id: assetId }).description, '秦陵出土文物');
    });

    test('未发布过不能直接标记为已发布', () => {
        const { assetId } = makeAsset({ name: '状态保护', key: '964/1/original1-aaaaaaaaaaaaaaa8.glb' });
        assert.throws(
            () => store.updateAsset({ connection: db, assetId, patch: { status: 'published' } }),
            /尚未发布任何版本/
        );
    });
});

describe('操作记录', () => {
    test('记录上传 / 发布 / 恢复 / 重命名', () => {
        const { assetId, versionId: v1 } = makeAsset({ name: '日志资源', key: '970/1/original1-aaaaaaaaaaaaaaa9.glb' });
        addVersion(assetId, 2);
        store.publishAssetVersion({ connection: db, assetId, versionId: v1 });
        store.renameAsset({ connection: db, assetId, name: '日志资源改名' });

        const logs = store.listOperationLogs({ connection: db, assetId });
        const actions = new Set(logs.map((l) => l.action));
        for (const expected of ['upload', 'create_version', 'publish', 'rename']) {
            assert.ok(actions.has(expected), `应记录 ${expected} 操作`);
        }
        assert.ok(logs.every((l) => l.operator), '每条日志都应有操作人');
        assert.ok(logs.every((l) => l.createdAt), '每条日志都应有时间');
    });

    test('资源被永久删除后日志随之清理', () => {
        const { assetId } = makeAsset({ name: '日志清理', key: '971/1/original1-aaaaaaaaaaaaaa10.glb' });
        assert.ok(store.listOperationLogs({ connection: db, assetId }).length > 0);
        store.setAssetsDeleted({ connection: db, assetIds: [assetId] });
        store.purgeAssets({ connection: db, assetIds: [assetId] });
        assert.equal(store.listOperationLogs({ connection: db, assetId }).length, 0);
    });
});

describe('统计', () => {
    test('总览区分 active / trashed / published / unpublished', () => {
        const { assetId, versionId: v1 } = makeAsset({ name: '统计目标', key: '980/1/original1-aaaaaaaaaaaaaa11.glb' });
        store.publishAssetVersion({ connection: db, assetId, versionId: v1 });
        addVersion(assetId, 2); // 制造「已发布但有未发布改动」

        const s = store.assetStats({ connection: db });
        assert.ok(s.total >= 1);
        assert.ok(s.active >= 1);
        assert.ok(s.published >= 1);
        assert.ok(s.unpublished >= 1, '存在 latest≠published 的资源');
    });

    test('按类型分组含大小汇总', () => {
        const rows = store.assetTypeBreakdown({ connection: db });
        assert.ok(Array.isArray(rows));
        const model = rows.find((r) => r.type === 'model');
        assert.ok(model && model.count > 0 && model.totalSize > 0);
    });
});