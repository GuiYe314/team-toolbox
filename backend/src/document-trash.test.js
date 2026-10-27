// 文档回收站（007）的存储层测试。
//
// 覆盖的不是「软删能不能打标记」，而是**会真正丢数据的边界**：
//   - 恢复后标签、正文、可搜索性是否完整
//   - 父级已不可用时恢复会不会产生「看不见的孤儿」
//   - 永久删除会不会把已恢复正常的子文档一起 CASCADE 带走
//   - 备份往返会不会悄悄清空回收站
//
// 用内存库 + 真实迁移文件（与生产 schema 一致）。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTestingDatabase } from './db.js';
import * as store from './store.js';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

function makeDb() {
    const db = createTestingDatabase({ memory: true });
    // 自动扫描迁移目录，不硬编码列表（每次新增迁移都会漏）
    for (const f of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()) {
        db.exec(readFileSync(join(MIGRATIONS_DIR, f), 'utf8'));
    }
    return db;
}

function seed(db) {
    const parent = store.createDocument({
        connection: db, title: '父文档', content_md: '父正文 海昏侯', tags: ['规范']
    });
    const child = store.createDocument({
        connection: db, title: '子文档', content_md: '子正文', parent_id: parent.id, tags: ['规范', '部署']
    });
    const other = store.createDocument({
        connection: db, title: '无关文档', content_md: '别的内容'
    });
    return { parent, child, other };
}

describe('文档回收站', () => {
    test('软删后：正常列表/详情/搜索不可见，回收站可见', () => {
        const db = makeDb();
        const { parent, child } = seed(db);

        store.deleteDocument({ connection: db, id: parent.id });

        // 正常列表不含已删
        const list = store.listDocuments({ connection: db, filter: { limit: 50 } });
        assert.ok(!list.items.some((d) => d.id === parent.id), '正常列表不应含已删父文档');
        assert.ok(!list.items.some((d) => d.id === child.id), '子文档应随父一起进回收站');

        // 详情 404
        assert.equal(store.getDocument({ connection: db, id: parent.id }), null);

        // 搜索不到（FTS 索引已移除）
        const found = store.searchDocuments({ connection: db, keyword: '海昏' });
        assert.equal(found.total, 0, '已删文档不应被搜索命中');

        // 回收站能看到
        const trash = store.listTrashDocuments({ connection: db });
        assert.equal(trash.total, 2);
        assert.ok(trash.items.some((d) => d.id === parent.id));
        db.close();
    });

    test('软删整棵子树，级联语义与旧版一致', () => {
        const db = makeDb();
        const { parent, child } = seed(db);
        const r = store.deleteDocuments({ connection: db, ids: [parent.id] });
        assert.equal(r.deleted, 1);
        assert.equal(r.cascaded, 1, '子文档应计入 cascaded');
        const trash = store.listTrashDocuments({ connection: db });
        assert.equal(trash.total, 2);
        db.close();
    });

    test('恢复：正文、标签、可搜索性完整带回', () => {
        const db = makeDb();
        const { parent, child } = seed(db);
        store.deleteDocument({ connection: db, id: parent.id });

        const r = store.restoreDocuments({ connection: db, ids: [parent.id] });
        assert.equal(r.restored, 2, '父子两篇都应恢复');

        const doc = store.getDocument({ connection: db, id: child.id });
        assert.ok(doc, '子文档应可访问');
        assert.equal(doc.content_md, '子正文');
        // 两边都排序再比 —— 标签顺序由 GROUP BY 决定，不该成为断言的一部分
        assert.deepEqual([...doc.tags].sort(), ['规范', '部署'].sort(), '标签必须随恢复带回');

        const found = store.searchDocuments({ connection: db, keyword: '海昏' });
        assert.equal(found.total, 1, '恢复后应重新可搜索');
        db.close();
    });

    test('回收站里的文档 parent 悬空时，恢复会兜底提升为顶层', () => {
        // 注：正常的 purge 不会留下这种状态（永久删除父文档会连带清掉子树）。
        // 但**悬空 parent 仍可能出现**：手工改库、异常中断、
        // 或从别的库导入时父级缺失。恢复逻辑必须兜住，否则这篇文档
        // 会挂在一个不存在的父节点下，在树状导航里彻底看不见。
        const db = makeDb();
        const { child } = seed(db);

        store.deleteDocument({ connection: db, id: child.id });
        // 人为制造悬空：指向一个不存在的父 id。
        // 必须先关外键 —— 平时外键是开的，这种状态正常情况下产生不了
        // （这本身是好事：说明数据完整性有保障）。这里模拟的是
        // 「外键曾被临时关闭 / 从旧库导入」这类异常路径。
        db.pragma('foreign_keys = OFF');
        db.prepare('UPDATE documents SET parent_id = 999999 WHERE id = ?').run(child.id);
        db.pragma('foreign_keys = ON');

        const r = store.restoreDocuments({ connection: db, ids: [child.id] });
        assert.equal(r.restored, 1);
        assert.equal(r.reparented, 1, '父级不存在时必须重新挂载');

        const doc = store.getDocument({ connection: db, id: child.id });
        assert.equal(doc.parent_id, null, '应提升为顶层');
        db.close();
    });

    test('恢复时父级仍在回收站 → 同样提升为顶层', () => {
        const db = makeDb();
        const { parent, child } = seed(db);
        store.deleteDocument({ connection: db, id: parent.id });

        // 只恢复子文档，父文档留在回收站
        const r = store.restoreDocuments({ connection: db, ids: [child.id] });
        assert.equal(r.reparented, 1);
        assert.equal(store.getDocument({ connection: db, id: child.id }).parent_id, null);
        db.close();
    });

    test('关键：永久删除不能带走「已恢复正常」的子文档', () => {
        // 这是 ON DELETE CASCADE 的陷阱：
        // 父在回收站、子已恢复正常时，直接 DELETE 父会把子一起 CASCADE 删掉。
        const db = makeDb();
        const { parent, child } = seed(db);

        store.deleteDocument({ connection: db, id: parent.id });   // 父子都进回收站
        store.restoreDocuments({ connection: db, ids: [child.id] }); // 只恢复子（父仍在回收站）

        // 永久删除父文档
        store.purgeDocuments({ connection: db, ids: [parent.id] });

        const survivor = store.getDocument({ connection: db, id: child.id });
        assert.ok(survivor, '已恢复正常的子文档绝不能被父文档的永久删除带走');
        assert.equal(survivor.content_md, '子正文');
        db.close();
    });

    test('purge 只允许已删文档，正常文档不受影响', () => {
        const db = makeDb();
        const { other } = seed(db);
        const r = store.purgeDocuments({ connection: db, ids: [other.id] });
        assert.equal(r.deleted, 0, '正常文档不应被永久删除');
        assert.deepEqual(r.missing, [other.id]);
        assert.ok(store.getDocument({ connection: db, id: other.id }), '正常文档必须仍在');
        db.close();
    });

    test('已删文档不可编辑', () => {
        const db = makeDb();
        const { other } = seed(db);
        store.deleteDocument({ connection: db, id: other.id });
        assert.throws(
            () => store.updateDocument({ connection: db, id: other.id, version: 1, title: '改名' }),
            (err) => err.code === 'not_found',
            '回收站里的文档不应允许编辑'
        );
        db.close();
    });

    test('清空回收站：只清已删，正常文档保留', () => {
        const db = makeDb();
        const { parent, other } = seed(db);
        store.deleteDocument({ connection: db, id: parent.id });

        const ids = store.listTrashDocumentIds({ connection: db });
        assert.equal(ids.length, 2);
        const r = store.purgeDocuments({ connection: db, ids });
        assert.equal(r.deleted, 2);

        assert.equal(store.listTrashDocuments({ connection: db }).total, 0);
        assert.ok(store.getDocument({ connection: db, id: other.id }), '无关文档必须保留');
        db.close();
    });

    test('备份往返保留删除状态，不会悄悄清空回收站', () => {
        const db = makeDb();
        const { parent, other } = seed(db);
        store.deleteDocument({ connection: db, id: parent.id });

        const snap = store.exportSnapshot({ connection: db });
        const snapDoc = snap.documents.find((d) => d.title === '父文档');
        assert.equal(snapDoc.is_deleted, 1, '快照必须带删除标记');

        // 恢复到一个全新库
        const db2 = makeDb();
        store.importSnapshot({ connection: db2, snapshot: snap });

        const trash = store.listTrashDocuments({ connection: db2 });
        assert.ok(trash.items.some((d) => d.title === '父文档'),
            '导入后该文档应仍在回收站，而不是被恢复正常');
        assert.ok(!store.searchDocuments({ connection: db2, keyword: '海昏' }).total,
            '回收站里的文档不应被搜索命中');

        // 正常文档应正常导入
        const normal = store.listDocuments({ connection: db2, filter: { limit: 50 } });
        assert.ok(normal.items.some((d) => d.title === '无关文档'));
        db.close();
        db2.close();
    });

    test('旧版备份（无 is_deleted 字段）按未删除处理', () => {
        const db = makeDb();
        seed(db);
        const snap = store.exportSnapshot({ connection: db });
        // 模拟旧版备份：删掉新字段
        for (const d of snap.documents) { delete d.is_deleted; delete d.deleted_at; }

        const db2 = makeDb();
        store.importSnapshot({ connection: db2, snapshot: snap });
        assert.equal(store.listTrashDocuments({ connection: db2 }).total, 0,
            '旧版备份不应凭空产生回收站内容');
        db.close();
        db2.close();
    });

    test('批量删除返回结构保持不变（前端无需改）', () => {
        const db = makeDb();
        const { parent, other } = seed(db);
        const r = store.deleteDocuments({ connection: db, ids: [parent.id, 999999] });
        assert.deepEqual(Object.keys(r).sort(), ['cascaded', 'deleted', 'missing']);
        assert.deepEqual(r.missing, [999999], '不存在的 id 记入 missing');
        assert.equal(r.deleted, 1);
        db.close();
    });
});
