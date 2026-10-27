// 资源集合（Packs）：跨目录的资源编组。
//
// 与文件夹的分工（这条区分决定了整个模块的设计）：
//   asset_folders       = 一棵树，一个资源只能待在一个位置，回答「归哪儿管」
//   asset_collections   = 多对多，一个资源可属多个集合，回答「这次要交付哪些」
//
// 因此集合是**视图而非容器**：把资源从集合移除，不影响资源本身、
// 不影响它的文件夹归属、不影响它所在的其他集合。
//
// 软删联动是刻意设计的：资源进回收站后自动从集合里消失（查询时过滤
// is_deleted = 0），恢复后自动回到原集合 —— 不需要在回收站/恢复流程里
// 维护成员关系，也就不会出现「恢复后集合里的成员丢了」这种不一致。

import { errorMap } from './errors.js';
import { toAsset } from './asset-store.js';

const err = (msg, code = 'invalid_input') => errorMap(new Error(msg), '(collections)', code);
const notFound = (msg) => errorMap(new Error(msg), '(collections)', 'not_found');

/** 集合名长度上限。与文件夹保持一致的可读范围。 */
const NAME_MAX = 40;
const DESC_MAX = 500;

function normalizeName(raw) {
    const name = String(raw == null ? '' : raw).trim();
    if (!name) throw err('集合名称不能为空');
    if (name.length > NAME_MAX) throw err(`集合名称不能超过 ${NAME_MAX} 个字符`);
    return name;
}

function normalizeDesc(raw) {
    const d = String(raw == null ? '' : raw).trim();
    if (d.length > DESC_MAX) throw err(`集合描述不能超过 ${DESC_MAX} 个字符`);
    return d;
}

function normalizeIds(assetIds) {
    if (!Array.isArray(assetIds) || assetIds.length === 0) throw err('请至少选择一个资源');
    const ids = [...new Set(assetIds.map(Number))];
    for (const id of ids) {
        if (!Number.isInteger(id) || id <= 0) throw err('资源 ID 无效');
    }
    if (ids.length > 500) throw err('单次最多操作 500 个资源');
    return ids;
}

/**
 * 集合列表（含成员数），按最近更新倒序。
 *
 * 成员数只统计**未删除**的资源 —— 否则回收站里的资源会让集合显示
 * 「3 个资源」但点进去只看到 1 个。
 *
 * @returns {{ id:number, name:string, description:string, assetCount:number, createdAt:string, updatedAt:string }[]}
 */
export function listCollections({ connection: db }) {
    return db.prepare(`
        SELECT c.id, c.name, c.description, c.created_by, c.created_at, c.updated_at,
               (SELECT COUNT(*) FROM asset_collection_items i
                JOIN assets a ON a.id = i.asset_id
                WHERE i.collection_id = c.id AND a.is_deleted = 0) AS asset_count
        FROM asset_collections c
        ORDER BY c.updated_at DESC, c.id DESC
    `).all().map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description,
        createdBy: r.created_by,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        assetCount: r.asset_count
    }));
}

/**
 * 集合详情 + 成员资源。
 *
 * 资源字段用 toAsset 映射，与资源列表完全一致（前端复用同一套渲染）。
 *
 * @returns {{ collection: object|null, assets: object[] }}
 */
export function getCollection({ connection: db, id }) {
    const c = db.prepare('SELECT * FROM asset_collections WHERE id = ?').get(Number(id));
    if (!c) return { collection: null, assets: [] };

    const rows = db.prepare(`
        SELECT a.*,
            lv.version_number AS latest_version_number,
            lv.file_size      AS latest_size,
            lv.preview_status AS preview_status,
            lv.thumbnail_storage_key AS thumbnail_storage_key,
            lv.preview_storage_key    AS preview_storage_key,
            pv.version_number AS published_version_number,
            (SELECT COUNT(*) FROM asset_versions av WHERE av.asset_id = a.id) AS version_count
        FROM asset_collection_items i
        JOIN assets a ON a.id = i.asset_id
        LEFT JOIN asset_versions lv ON lv.id = a.latest_version_id
        LEFT JOIN asset_versions pv ON pv.id = a.published_version_id
        WHERE i.collection_id = ? AND a.is_deleted = 0
        ORDER BY i.added_at DESC, a.id DESC
    `).all(c.id);

    // 标签批量取，避免 N+1
    const tagMap = new Map();
    if (rows.length > 0) {
        const ph = rows.map(() => '?').join(',');
        const tagRows = db.prepare(`
            SELECT atl.asset_id, at.name
            FROM asset_tag_links atl
            JOIN asset_tags at ON at.id = atl.tag_id
            WHERE atl.asset_id IN (${ph})
            ORDER BY at.name ASC
        `).all(...rows.map((r) => r.id));
        for (const t of tagRows) {
            if (!tagMap.has(t.asset_id)) tagMap.set(t.asset_id, []);
            tagMap.get(t.asset_id).push(t.name);
        }
    }

    return {
        collection: {
            id: c.id,
            name: c.name,
            description: c.description,
            createdBy: c.created_by,
            createdAt: c.created_at,
            updatedAt: c.updated_at,
            assetCount: rows.length
        },
        assets: rows.map((r) => toAsset(r, tagMap.get(r.id) || []))
    };
}

/**
 * 新建集合。
 *
 * 名称唯一约束由数据库保证（`ux_asset_collections_name`），
 * 这里额外先查一次是为了给出可读的中文提示 ——
 * 让 UNIQUE 约束的英文报错直接抛给用户是不可接受的。
 */
export function createCollection({ connection: db, name, description = '', operator = 'local' }) {
    const n = normalizeName(name);
    const d = normalizeDesc(description);

    const exists = db.prepare('SELECT id FROM asset_collections WHERE name = ?').get(n);
    if (exists) throw err(`已存在同名集合「${n}」，请换一个名称`, 'conflict');

    const r = db.prepare(`
        INSERT INTO asset_collections (name, description, created_by)
        VALUES (?, ?, ?)
    `).run(n, d, operator);

    return {
        id: Number(r.lastInsertRowid),
        name: n,
        description: d,
        createdBy: operator,
        assetCount: 0
    };
}

/** 重命名 / 改描述。 */
export function updateCollection({ connection: db, id, name, description }) {
    const cur = db.prepare('SELECT * FROM asset_collections WHERE id = ?').get(Number(id));
    if (!cur) throw notFound('集合不存在');

    const n = name === undefined ? cur.name : normalizeName(name);
    const d = description === undefined ? cur.description : normalizeDesc(description);

    if (n !== cur.name) {
        const dup = db.prepare('SELECT id FROM asset_collections WHERE name = ? AND id != ?').get(n, cur.id);
        if (dup) throw err(`已存在同名集合「${n}」，请换一个名称`, 'conflict');
    }

    db.prepare(`
        UPDATE asset_collections SET name = ?, description = ?, updated_at = datetime('now')
        WHERE id = ?
    `).run(n, d, cur.id);

    return { id: cur.id, name: n, description: d };
}

/**
 * 删除集合。
 *
 * **只删集合本身，不删资源** —— 这是最容易搞错的地方：
 * 集合只是个视图，删掉「展会包」不该让包里的模型跟着消失。
 * 成员行由 ON DELETE CASCADE 自动清理，资源本体完全不受影响。
 */
export function deleteCollection({ connection: db, id }) {
    const cur = db.prepare('SELECT id FROM asset_collections WHERE id = ?').get(Number(id));
    if (!cur) throw notFound('集合不存在');
    db.prepare('DELETE FROM asset_collections WHERE id = ?').run(cur.id);
    return { deleted: 1 };
}

/**
 * 批量把资源加入集合。
 *
 * 已存在的成员跳过（幂等）—— 用户重复点「加入」或分批加入同一批资源时，
 * 不该报错也不该产生重复行（主键约束本来就是这么设计的）。
 *
 * 只接受**未删除**的资源：把回收站里的资源加进集合，
 * 会让集合显示「3 个资源」但点进去只看到 2 个。
 *
 * @returns {{ added:number, skipped:number, missing:number[] }}
 */
export function addAssetsToCollection({ connection: db, collectionId, assetIds, operator = 'local' }) {
    const cid = Number(collectionId);
    const cur = db.prepare('SELECT id FROM asset_collections WHERE id = ?').get(cid);
    if (!cur) throw notFound('集合不存在');

    const ids = normalizeIds(assetIds);

    const tx = db.transaction(() => {
        const missing = [];
        let added = 0;
        const insert = db.prepare(`
            INSERT OR IGNORE INTO asset_collection_items (collection_id, asset_id)
            VALUES (?, ?)
        `);
        for (const aid of ids) {
            const alive = db.prepare('SELECT id FROM assets WHERE id = ? AND is_deleted = 0').get(aid);
            if (!alive) { missing.push(aid); continue; }
            const r = insert.run(cid, aid);
            if (r.changes > 0) added += 1;
        }
        if (added > 0) {
            db.prepare("UPDATE asset_collections SET updated_at = datetime('now') WHERE id = ?").run(cid);
        }
        return { added, skipped: ids.length - added - missing.length, missing };
    });

    return tx();
}

/**
 * 批量从集合移除资源（不影响资源本身）。
 *
 * @returns {{ removed:number, missing:number[] }}
 */
export function removeAssetsFromCollection({ connection: db, collectionId, assetIds }) {
    const cid = Number(collectionId);
    const cur = db.prepare('SELECT id FROM asset_collections WHERE id = ?').get(cid);
    if (!cur) throw notFound('集合不存在');

    const ids = normalizeIds(assetIds);
    const ph = ids.map(() => '?').join(',');

    const removed = db.prepare(`
        DELETE FROM asset_collection_items
        WHERE collection_id = ? AND asset_id IN (${ph})
    `).run(cid, ...ids).changes;

    if (removed > 0) {
        db.prepare("UPDATE asset_collections SET updated_at = datetime('now') WHERE id = ?").run(cid);
    }
    return { removed, missing: ids.length - removed };
}

/**
 * 某个资源属于哪些集合（反向查询）。
 *
 * 用途：资源详情页显示「它还在哪些包里」。
 * 与「文档引用资源」是同类问题 —— 删除/移动前要让人知道影响面。
 */
export function listCollectionsOfAsset({ connection: db, assetId }) {
    return db.prepare(`
        SELECT c.id, c.name
        FROM asset_collection_items i
        JOIN asset_collections c ON c.id = i.collection_id
        WHERE i.asset_id = ?
        ORDER BY c.name ASC
    `).all(Number(assetId)).map((r) => ({ id: r.id, name: r.name }));
}
