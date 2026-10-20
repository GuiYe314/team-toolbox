// 资源管理：存储层（Asset / AssetVersion / Folder / 标签 / 操作记录）。
//
// 与 store.js 的关系：完全独立，不复用文档表。理由是二者生命周期与语义不同 —
//   文档（documents）：内容即正文，改了就是改了，没有「发布版本」概念；
//   资产（assets）  ：内容不可变，变化产生新版本，且 Latest 与 Published 分离。
// 强行合并会让版本语义污染文档模型。
//
// 三条不可动摇的业务规则（用户明确要求，改动前务必确认）：
//
//   ① 版本独立不可变。asset_versions 每行对应一份物理文件，
//      新上传产生新行，**绝不修改既有版本的 original_storage_key**。
//
//   ② Latest 与 Published 完全独立。
//      latest_version_id    = 团队上传到的最新版本
//      published_version_id = Unity 客户端正式使用的版本
//      两者可相差任意多个版本。上传不影响已发布版本；
//      只有显式调用 publishAssetVersion() 才移动 published 指针。
//
//   ③ 恢复历史版本 = 复制内容生成新版本，latest 指针只前进不后退。
//      恢复 v3 时：复制 v3 文件 → 生成 v8（内容=v3）→ latest=v8。
//      v4~v7 一个都不动。若把 latest 直接改回 v3，
//      Unity 侧就会「版本号变小」，且 v4~v7 成为无头版本，破坏历史完整性。
//
// 本层是同步的（better-sqlite3），与 store.js 一致；
// 文件落盘委托 asset-storage.js，本层只管事务与指针一致性。

import { errorMap } from './errors.js';

const err = (msg, code = 'invalid_input') => errorMap(new Error(msg), '(assets)', code);
const notFound = (msg) => errorMap(new Error(msg), '(assets)', 'not_found');

// ══════════════════════════════════════════════════════════════════
// 常量
// ══════════════════════════════════════════════════════════════════

/** 资源状态。draft→published 靠发布动作推进，deprecated 为终态但可再发布。 */
export const ASSET_STATUS = {
    DRAFT: 'draft',
    PUBLISHED: 'published',
    DEPRECATED: 'deprecated'
};

/** 预览管线状态。 */
export const PREVIEW_STATUS = {
    NONE: 'none',
    PENDING: 'pending',
    PROCESSING: 'processing',
    READY: 'ready',
    FAILED: 'failed'
};

/** 可排序字段白名单 —— 防止 ORDER BY 注入。 */
const SORT_COLUMNS = new Map([
    ['name', 'a.name'],
    ['created_at', 'a.created_at'],
    ['updated_at', 'a.updated_at'],
    ['size', 'latest_size'],
    ['version', 'latest_version_number']
]);

/**
 * 中文排序器：按拼音排序（zh-CN）。
 * numeric=true 让 "v2" 排在 "v10" 前面；sensitivity=base 忽略大小写与音调。
 */
const COLLATOR = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' });

/** 记录一条操作日志。私有函数，统一走它以保证 action 取值收敛。 */
function logOp(db, { assetId = null, versionId = null, action, detail = '', operator = 'local' }) {
    db.prepare(`
        INSERT INTO asset_operation_logs (asset_id, version_id, action, detail, operator)
        VALUES (?, ?, ?, ?, ?)
    `).run(assetId, versionId, action, detail, operator);
}

// ══════════════════════════════════════════════════════════════════
// 文件夹
// ══════════════════════════════════════════════════════════════════

/** 扁平文件夹列表（前端自行组装成树，避免后端递归 JSON）。 */
export function listFolders({ connection: db }) {
    return db.prepare(`
        SELECT id, parent_id, name, created_by, created_at, updated_at,
               (SELECT COUNT(*) FROM assets a
                 WHERE a.folder_id = f.id AND a.is_deleted = 0) AS asset_count
        FROM asset_folders f
        ORDER BY name ASC
    `).all();
}

export function createFolder({ connection: db, name, parentId = null, createdBy = 'local' }) {
    const clean = String(name || '').trim();
    if (!clean) throw err('文件夹名称不能为空');
    if (clean.length > 100) throw err('文件夹名称不能超过 100 个字符');

    if (parentId != null) {
        const p = db.prepare('SELECT id FROM asset_folders WHERE id = ?').get(parentId);
        if (!p) throw err('父文件夹不存在');
    }
    try {
        const info = db.prepare(
            'INSERT INTO asset_folders (parent_id, name, created_by) VALUES (?, ?, ?)'
        ).run(parentId, clean, createdBy);
        return { id: Number(info.lastInsertRowid), parent_id: parentId, name: clean };
    } catch (e) {
        if (String(e.code || '').startsWith('SQLITE_CONSTRAINT')) {
            throw err(`同级目录下已存在「${clean}」`, 'constraint_failed');
        }
        throw e;
    }
}

export function renameFolder({ connection: db, id, name }) {
    const clean = String(name || '').trim();
    if (!clean) throw err('文件夹名称不能为空');
    const row = db.prepare('SELECT id FROM asset_folders WHERE id = ?').get(id);
    if (!row) throw notFound('文件夹不存在');
    try {
        db.prepare('UPDATE asset_folders SET name = ?, updated_at = datetime(\'now\') WHERE id = ?')
            .run(clean, id);
        return { id, name: clean };
    } catch (e) {
        if (String(e.code || '').startsWith('SQLITE_CONSTRAINT')) {
            throw err(`同级目录下已存在「${clean}」`, 'constraint_failed');
        }
        throw e;
    }
}

/**
 * 删除文件夹。
 * 刻意**不删其中的资产** —— 资产移出为 folder_id = NULL（"未分类"），
 * 递归删资源会造成不可预期的数据丢失。
 */
export function deleteFolder({ connection: db, id }) {
    const row = db.prepare('SELECT id FROM asset_folders WHERE id = ?').get(id);
    if (!row) throw notFound('文件夹不存在');
    const orphans = db.prepare('SELECT COUNT(*) n FROM assets WHERE folder_id = ?').get(id).n;
    db.prepare('DELETE FROM asset_folders WHERE id = ?').run(id);
    return { deleted: 1, orphaned_assets: orphans };
}

/** 移动文件夹（防把文件夹移进自己的子树，否则树会成环）。 */
export function moveFolder({ connection: db, id, parentId }) {
    const row = db.prepare('SELECT id, parent_id FROM asset_folders WHERE id = ?').get(id);
    if (!row) throw notFound('文件夹不存在');
    if (parentId == null) {
        db.prepare('UPDATE asset_folders SET parent_id = NULL, updated_at = datetime(\'now\') WHERE id = ?').run(id);
        return { id, parent_id: null };
    }
    // 环检测是**状态冲突**而非输入格式错误，用 conflict(409) 而非 invalid_input(400)，
    // 前端才能区别「参数写错了要改」和「这个操作在当前结构下做不了」。
    if (parentId === id) throw err('不能把文件夹移入自身', 'conflict');

    // 用递归 CTE 查自己的全部后代；parentId 落在其中即为成环
    const isDescendant = db.prepare(`
        WITH RECURSIVE sub(id) AS (
            SELECT id FROM asset_folders WHERE parent_id = ?
            UNION ALL
            SELECT f.id FROM asset_folders f JOIN sub ON f.parent_id = sub.id
        )
        SELECT 1 AS hit FROM sub WHERE id = ? LIMIT 1
    `).get(id, parentId);
    if (isDescendant) throw err('不能把文件夹移入其子文件夹', 'conflict');

    const p = db.prepare('SELECT id FROM asset_folders WHERE id = ?').get(parentId);
    if (!p) throw err('目标文件夹不存在');
    try {
        db.prepare('UPDATE asset_folders SET parent_id = ?, updated_at = datetime(\'now\') WHERE id = ?')
            .run(parentId, id);
        return { id, parent_id: parentId };
    } catch (e) {
        if (String(e.code || '').startsWith('SQLITE_CONSTRAINT')) {
            throw err('目标目录下已存在同名文件夹', 'constraint_failed');
        }
        throw e;
    }
}

// ══════════════════════════════════════════════════════════════════
// 资产读取
// ══════════════════════════════════════════════════════════════════

/** 把数据库行转成前端用的 camelCase 对象。 */
function toAsset(row, tags = []) {
    if (!row) return null;
    return {
        id: row.id,
        name: row.name,
        folderId: row.folder_id,
        type: row.type,
        mimeType: row.mime_type,
        ext: row.ext,
        latestVersionId: row.latest_version_id,
        publishedVersionId: row.published_version_id,
        latestVersionNumber: row.latest_version_number ?? null,
        publishedVersionNumber: row.published_version_number ?? null,
        latestSize: row.latest_size ?? 0,
        /** 最新版本的预览状态：none/pending/processing/ready/failed */
        previewStatus: row.preview_status || 'none',
        /** 是否有可显示的缩略图（列表里直接用，避免加载失败的空图） */
        hasThumbnail: !!row.thumbnail_storage_key,
        status: row.status,
        description: row.description,
        tags,
        createdBy: row.created_by,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        isDeleted: !!row.is_deleted,
        deletedAt: row.deleted_at,
        deletedBy: row.deleted_by,
        versionCount: row.version_count ?? 0,
        /** 是否「已上传但未发布」—— 列表里给一个可扫读的标记 */
        hasUnpublished: row.published_version_id == null || row.published_version_id !== row.latest_version_id
    };
}

/**
 * 资产列表。**服务端筛选 + 分页 + 排序**，不在浏览器加载全量过滤（用户明确要求）。
 *
 * @param {object} config
 * @param {import('better-sqlite3').Database} config.connection
 * @param {object} [config.filter]
 * @param {number|null|'root'} [config.filter.folderId] undefined=不限；null/'root'=未分类；数字=指定文件夹
 * @param {string} [config.filter.search] 匹配 名称 / 描述 / 标签
 * @param {string} [config.filter.type] 资产类型
 * @param {string} [config.filter.status] 资源状态
 * @param {string} [config.filter.scope] all | recent | mine | published | trash
 * @param {number} [config.filter.page=1] 1 起
 * @param {number} [config.filter.pageSize=50]
 * @param {string} [config.filter.sort='updated_at'] 见 SORT_COLUMNS
 * @param {string} [config.filter.order='desc']
 * @returns {{ total:number, page:number, pageSize:number, items:object[] }}
 */
export function listAssets({ connection: db, filter = {} }) {
    const {
        folderId, search, type, status, scope = 'all',
        page = 1, pageSize = 50, sort = 'updated_at', order = 'desc'
    } = filter;

    const conds = [];
    const params = [];

    // 回收站是独立视图：恒带 is_deleted = 1；其余视图恒带 is_deleted = 0
    if (scope === 'trash') {
        conds.push('a.is_deleted = 1');
    } else {
        conds.push('a.is_deleted = 0');
    }

    // 文件夹范围。三态，必须严格区分：
    //   undefined / 未传  → 不限文件夹
    //   null              → 只看「未分类」（folder_id IS NULL）
    //   'root'            → 同上，语义别名
    //   数字              → 只看该文件夹
    // 注意 `= NULL` 在 SQL 中恒为假（必须用 IS NULL），
    // 所以「未分类」必须走 IS NULL 分支，否则会静默返回空列表。
    if (folderId === 'root' || folderId === null) {
        conds.push('a.folder_id IS NULL');
    } else if (folderId !== undefined && folderId !== '') {
        conds.push('a.folder_id = ?');
        params.push(Number(folderId));
    }

    if (type && type !== 'all') {
        conds.push('a.type = ?');
        params.push(type);
    }
    if (status && status !== 'all') {
        conds.push('a.status = ?');
        params.push(status);
    }

    // 已发布视图：必须有 published_version_id
    if (scope === 'published') conds.push('a.published_version_id IS NOT NULL');

    // 搜索：名称 / 描述 / 标签名。标签走 EXISTS 子查询，避免 JOIN 放大行数
    if (search && String(search).trim()) {
        const kw = `%${String(search).trim().toLowerCase()}%`;
        conds.push(`(
            LOWER(a.name) LIKE ?
            OR LOWER(a.description) LIKE ?
            OR EXISTS (
                SELECT 1 FROM asset_tag_links atl
                JOIN asset_tags at ON at.id = atl.tag_id
                WHERE atl.asset_id = a.id AND LOWER(at.name) LIKE ?
            )
        )`);
        params.push(kw, kw, kw);
    }

    const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
    const total = db.prepare(`SELECT COUNT(*) n FROM assets a ${where}`).get(...params).n;

    const sortCol = SORT_COLUMNS.get(sort) || SORT_COLUMNS.get('updated_at');
    const dir = String(order).toLowerCase() === 'asc' ? 'ASC' : 'DESC';
    const safePage = Math.max(1, Number(page) || 1);
    const safeSize = Math.min(200, Math.max(1, Number(pageSize) || 50));
    const offset = (safePage - 1) * safeSize;

    const baseSelect = `
        SELECT a.*,
            lv.version_number AS latest_version_number,
            lv.file_size      AS latest_size,
            lv.preview_status AS preview_status,
            lv.thumbnail_storage_key AS thumbnail_storage_key,
            lv.preview_storage_key    AS preview_storage_key,
            pv.version_number AS published_version_number,
            (SELECT COUNT(*) FROM asset_versions av WHERE av.asset_id = a.id) AS version_count
        FROM assets a
        LEFT JOIN asset_versions lv ON lv.id = a.latest_version_id
        LEFT JOIN asset_versions pv ON pv.id = a.published_version_id
        ${where}`;

    let rows;
    if (sort === 'name') {
        // 按名称排序走**应用层拼音序**：
        // SQLite 只有字节序，中文名按字节排出来是码位序（看着就是乱的），
        // 与用户期望的拼音序不符。Node 的 Intl.Collator 能按拼音排，
        // 但它只能排「一组已知的字符串」，给不了单字排序键。
        //
        // 所以这里取出候选集（受当前筛选条件约束，不是全表）→ 应用层排序
        // → 再切片分页。资源库规模在数百~数千条，一次取出完全可接受。
        // 注意不能「先 LIMIT 再排」——那样会漏掉本该出现在本页的行。
        const all = db.prepare(baseSelect).all(...params);
        all.sort((x, y) => {
            const c = COLLATOR.compare(x.name || '', y.name || '');
            return dir === 'ASC' ? c : -c;
        });
        rows = all.slice(offset, offset + safeSize);
    } else {
        // 其余字段（时间/大小/版本）SQL 直接排，效率更高
        rows = db.prepare(`${baseSelect}
            ORDER BY ${sortCol} ${dir}, a.id DESC
            LIMIT ? OFFSET ?
        `).all(...params, safeSize, offset);
    }

    // 标签一次性批量取，避免 N+1
    const tagMap = tagsForAssets(db, rows.map((r) => r.id));
    const items = rows.map((r) => toAsset(r, tagMap.get(r.id) || []));

    return { total, page: safePage, pageSize: safeSize, items };
}

/** 批量取多个资产的标签，避免逐行查询。 */
function tagsForAssets(db, ids) {
    const map = new Map();
    if (!ids.length) return map;
    const ph = ids.map(() => '?').join(',');
    const rows = db.prepare(`
        SELECT atl.asset_id, at.name
        FROM asset_tag_links atl
        JOIN asset_tags at ON at.id = atl.tag_id
        WHERE atl.asset_id IN (${ph})
        ORDER BY at.name ASC
    `).all(...ids);
    for (const r of rows) {
        if (!map.has(r.asset_id)) map.set(r.asset_id, []);
        map.get(r.asset_id).push(r.name);
    }
    return map;
}

/** 单个资产详情（含最新/已发布版本摘要与磁盘占用）。 */
export function getAsset({ connection: db, id }) {
    const row = db.prepare(`
        SELECT a.*,
            lv.version_number AS latest_version_number, lv.file_size AS latest_size,
            pv.version_number AS published_version_number,
            (SELECT COUNT(*) FROM asset_versions av WHERE av.asset_id = a.id) AS version_count
        FROM assets a
        LEFT JOIN asset_versions lv ON lv.id = a.latest_version_id
        LEFT JOIN asset_versions pv ON pv.id = a.published_version_id
        WHERE a.id = ?
    `).get(id);
    if (!row) throw notFound('资源不存在');
    const tagMap = tagsForAssets(db, [id]);
    return toAsset(row, tagMap.get(id) || []);
}

/** 资源版本历史。 */
export function listVersions({ connection: db, assetId }) {
    const rows = db.prepare(`
        SELECT v.*, a.latest_version_id, a.published_version_id
        FROM asset_versions v
        JOIN assets a ON a.id = v.asset_id
        WHERE v.asset_id = ?
        ORDER BY v.version_number DESC
    `).all(assetId);
    return rows.map((r) => ({
        id: r.id,
        assetId: r.asset_id,
        versionNumber: r.version_number,
        originalStorageKey: r.original_storage_key,
        previewStorageKey: r.preview_storage_key,
        thumbnailStorageKey: r.thumbnail_storage_key,
        fileSize: r.file_size,
        sha256: r.sha256,
        mimeType: r.mime_type,
        metadata: safeParse(r.metadata),
        previewStatus: r.preview_status,
        previewError: r.preview_error,
        comment: r.comment,
        createdBy: r.created_by,
        createdAt: r.created_at,
        isLatest: r.id === r.latest_version_id,
        isPublished: r.id === r.published_version_id
    }));
}

/** metadata 可能是脏数据（历史版本/外部导入），解析失败一律回退为空对象而非抛错。 */
function safeParse(json) {
    try {
        const v = JSON.parse(json || '{}');
        return v && typeof v === 'object' ? v : {};
    } catch {
        return {};
    }
}

// ══════════════════════════════════════════════════════════════════
// 资产写入
// ══════════════════════════════════════════════════════════════════

/**
 * 新建资产（同时写入第 1 个版本）。
 *
 * 整个过程在**单个事务**内完成：资产行 + 版本行 + 指针更新 + 日志。
 * 中途失败必须整体回滚，否则会留下「有资产无版本」的坏数据 ——
 * Unity 侧查询 latest_version_id 时拿到 null 会直接崩。
 *
 * @param {object} config
 * @param {import('better-sqlite3').Database} config.connection
 * @param {object} config.input { name, folderId, type, mimeType, ext, fileSize, sha256, originalStorageKey, comment, description }
 * @param {string[]} [config.tags]
 * @param {string} [config.operator='local']
 * @returns {{ assetId:number, versionId:number, versionNumber:number }}
 */
export function createAsset({ connection: db, input, tags = [], operator = 'local' }) {
    const name = String(input.name || '').trim();
    if (!name) throw err('资源名称不能为空');
    if (name.length > 200) throw err('资源名称不能超过 200 个字符');
    if (!input.originalStorageKey) throw err('缺少原始文件存储键');

    if (input.folderId != null) {
        const f = db.prepare('SELECT id FROM asset_folders WHERE id = ?').get(input.folderId);
        if (!f) throw err('目标文件夹不存在');
    }

    const tx = db.transaction(() => {
        const info = db.prepare(`
            INSERT INTO assets (name, folder_id, type, mime_type, ext, status, description, created_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            name,
            input.folderId ?? null,
            input.type || 'other',
            input.mimeType || 'application/octet-stream',
            input.ext || '',
            ASSET_STATUS.DRAFT,
            String(input.description || ''),
            operator
        );
        const assetId = Number(info.lastInsertRowid);

        const vinfo = db.prepare(`
            INSERT INTO asset_versions
                (asset_id, version_number, original_storage_key, file_size, sha256, mime_type, preview_status, comment, created_by)
            VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            assetId,
            input.originalStorageKey,
            input.fileSize || 0,
            input.sha256 || null,
            input.mimeType || 'application/octet-stream',
            PREVIEW_STATUS.PENDING,
            String(input.comment || ''),
            operator
        );
        const versionId = Number(vinfo.lastInsertRowid);

        // v1 同时是 latest。**不设 published** —— 首次上传不等于已发布，
        // Unity 侧应读到 published = null 直到有人显式发布。
        db.prepare('UPDATE assets SET latest_version_id = ? WHERE id = ?').run(versionId, assetId);

        setTags(db, assetId, tags);
        logOp(db, { assetId, versionId, action: 'upload', detail: `创建资源 ${name} v1`, operator });
        logOp(db, { assetId, action: 'create_version', detail: 'v1', operator });

        return { assetId, versionId, versionNumber: 1 };
    });

    return tx();
}

/**
 * 为已有资源追加一个新版本。
 *
 * 关键约束（用户明确要求）：
 *   - 版本号 = MAX(version_number) + 1，同一事务内读取，避免并发下重号；
 *   - 只移动 latest 指针，**published 指针保持不变** —— 上传不应影响线上；
 *   - 资源状态若为 deprecated，追加版本后回到 draft（有了新版本就不再是废弃状态）。
 *
 * @param {object} config
 * @param {import('better-sqlite3').Database} config.connection
 * @param {number} config.assetId
 * @param {object} config.input { originalStorageKey, fileSize, sha256, mimeType, comment }
 * @param {string} [config.operator='local']
 * @returns {{ versionId:number, versionNumber:number }}
 */
export function addAssetVersion({ connection: db, assetId, input, operator = 'local' }) {
    const asset = db.prepare('SELECT id, name FROM assets WHERE id = ?').get(assetId);
    if (!asset) throw notFound('资源不存在');
    if (!input.originalStorageKey) throw err('缺少原始文件存储键');

    const tx = db.transaction(() => {
        const maxRow = db.prepare(
            'SELECT MAX(version_number) n FROM asset_versions WHERE asset_id = ?'
        ).get(assetId);
        const nextNumber = (maxRow.n || 0) + 1;

        const vinfo = db.prepare(`
            INSERT INTO asset_versions
                (asset_id, version_number, original_storage_key, file_size, sha256, mime_type, preview_status, comment, created_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            assetId,
            nextNumber,
            input.originalStorageKey,
            input.fileSize || 0,
            input.sha256 || null,
            input.mimeType || 'application/octet-stream',
            PREVIEW_STATUS.PENDING,
            String(input.comment || ''),
            operator
        );
        const versionId = Number(vinfo.lastInsertRowid);

        // 只动 latest，published 原地不动 —— 这是发布机制的关键
        db.prepare(`
            UPDATE assets
            SET latest_version_id = ?,
                status = CASE WHEN status = 'deprecated' THEN 'draft' ELSE status END,
                updated_at = datetime('now')
            WHERE id = ?
        `).run(versionId, assetId);

        logOp(db, { assetId, versionId, action: 'upload', detail: `上传新版本 v${nextNumber}`, operator });
        logOp(db, { assetId, action: 'create_version', detail: `v${nextNumber}`, operator });

        return { versionId, versionNumber: nextNumber };
    });

    return tx();
}

/**
 * 发布某个版本为 PublishedVersion。
 *
 * 这是**唯一**能移动 published_version_id 的入口。
 * 上传新版本不会自动发布 —— 必须显式调用，Unity 侧才切过去。
 *
 * @param {object} config
 * @param {number} config.assetId
 * @param {number} config.versionId 要发布的版本；省略则发布当前 latest
 * @returns {{ publishedVersionId:number, versionNumber:number }}
 */
export function publishAssetVersion({ connection: db, assetId, versionId, operator = 'local' }) {
    const asset = db.prepare('SELECT id, latest_version_id FROM assets WHERE id = ?').get(assetId);
    if (!asset) throw notFound('资源不存在');

    const target = versionId ?? asset.latest_version_id;
    if (target == null) throw err('该资源还没有任何版本');

    const v = db.prepare('SELECT id, version_number FROM asset_versions WHERE id = ? AND asset_id = ?')
        .get(target, assetId);
    if (!v) throw notFound('版本不存在');

    const tx = db.transaction(() => {
        db.prepare(`
            UPDATE assets
            SET published_version_id = ?, status = ?, updated_at = datetime('now')
            WHERE id = ?
        `).run(v.id, ASSET_STATUS.PUBLISHED, assetId);
        logOp(db, {
            assetId, versionId: v.id, action: 'publish',
            detail: `发布 v${v.version_number}`, operator
        });
    });
    tx();

    return { publishedVersionId: v.id, versionNumber: v.version_number };
}

/**
 * 取消发布（published 指针置空，资源回到 draft）。
 * latest 指针不动 —— 团队仍在用最新版本，只是没有对外发布。
 */
export function unpublishAsset({ connection: db, assetId, operator = 'local' }) {
    const asset = db.prepare('SELECT id FROM assets WHERE id = ?').get(assetId);
    if (!asset) throw notFound('资源不存在');
    db.prepare(`
        UPDATE assets
        SET published_version_id = NULL, status = ?, updated_at = datetime('now')
        WHERE id = ?
    `).run(ASSET_STATUS.DRAFT, assetId);
    logOp(db, { assetId, action: 'unpublish', detail: '取消发布', operator });
    return { publishedVersionId: null };
}

/**
 * 恢复历史版本 —— **复制内容生成新版本**，不是把 latest 指针回拨。
 *
 * 用户明确要求（举例：Latest = v7，用户恢复 v3）：
 *   不要把 Latest 直接变成 v3，而应复制 v3 内容生成 v8，保证完整历史永远存在。
 *
 * 本函数只负责**建行 + 指指针**，文件复制由调用方通过
 * asset-storage.copyAssetFile() 完成后传入 newStorageKey，
 * 这样文件 IO 与事务解耦 —— 大文件复制不该占着数据库写锁。
 *
 * @param {object} config
 * @param {number} config.assetId
 * @param {number} config.sourceVersionId 要恢复的版本
 * @param {string} config.newStorageKey 复制出来的新文件存储键（由调用方生成）
 * @param {number} config.newFileSize
 * @param {string} [config.newSha256]
 * @param {string} [config.comment] 版本说明
 * @returns {{ versionId:number, versionNumber:number, restoredFrom:number }}
 */
export function restoreAssetVersion({ connection: db, assetId, sourceVersionId, newStorageKey, newFileSize, newSha256, comment, operator = 'local' }) {
    const src = db.prepare('SELECT * FROM asset_versions WHERE id = ? AND asset_id = ?')
        .get(sourceVersionId, assetId);
    if (!src) throw notFound('源版本不存在');
    // newStorageKey 允许 '__staging__' 占位：路由层会先暂存文件、建行拿到
    // versionId 后再回填真实存储键。这样建行只需发生一次，版本号不会跳号。
    if (!newStorageKey) throw err('缺少恢复后的文件存储键');

    const tx = db.transaction(() => {
        const maxRow = db.prepare(
            'SELECT MAX(version_number) n FROM asset_versions WHERE asset_id = ?'
        ).get(assetId);
        const nextNumber = (maxRow.n || 0) + 1;

        const vinfo = db.prepare(`
            INSERT INTO asset_versions
                (asset_id, version_number, original_storage_key, file_size, sha256, mime_type, preview_status, comment, created_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            assetId,
            nextNumber,
            newStorageKey,
            newFileSize ?? src.file_size,
            newSha256 || src.sha256,
            src.mime_type,
            PREVIEW_STATUS.PENDING,
            String(comment || `恢复自 v${src.version_number}`),
            operator
        );
        const versionId = Number(vinfo.lastInsertRowid);

        // latest 指针只前进到新版本号，published 不动
        db.prepare('UPDATE assets SET latest_version_id = ?, updated_at = datetime(\'now\') WHERE id = ?')
            .run(versionId, assetId);

        logOp(db, {
            assetId, versionId, action: 'restore',
            detail: `恢复 v${src.version_number} → 生成 v${nextNumber}`, operator
        });
        logOp(db, { assetId, action: 'create_version', detail: `v${nextNumber}`, operator });

        return { versionId, versionNumber: nextNumber, restoredFrom: src.version_number };
    });

    return tx();
}

/**
 * 删除某个版本。
 *
 * 不允许删 latest 与 published —— 那会让 Unity 侧读到空指针。
 * 这两个版本必须先「发布别的版本」或「追加新版本」才能移除。
 */
export function deleteAssetVersion({ connection: db, assetId, versionId, operator = 'local' }) {
    const v = db.prepare('SELECT * FROM asset_versions WHERE id = ? AND asset_id = ?')
        .get(versionId, assetId);
    if (!v) throw notFound('版本不存在');

    const asset = db.prepare('SELECT latest_version_id, published_version_id FROM assets WHERE id = ?').get(assetId);
    if (!asset) throw notFound('资源不存在');
    // 删不掉是因为「它正被指针引用」，属状态冲突（409），不是参数问题（400）
    if (asset.latest_version_id === versionId) throw err('不能删除当前最新版本', 'conflict');
    if (asset.published_version_id === versionId) throw err('不能删除当前已发布版本，请先发布其他版本', 'conflict');

    db.prepare('DELETE FROM asset_versions WHERE id = ?').run(versionId);
    logOp(db, {
        assetId, action: 'delete_version',
        detail: `删除 v${v.version_number}`, operator
    });
    // 顺带清理日志里的悬空引用（asset_id 保留，只清 version_id）
    db.prepare('UPDATE asset_operation_logs SET version_id = NULL WHERE version_id = ?').run(versionId);
    return { deleted: 1, versionNumber: v.version_number };
}

/** 重命名资源。 */
export function renameAsset({ connection: db, assetId, name, operator = 'local' }) {
    const clean = String(name || '').trim();
    if (!clean) throw err('资源名称不能为空');
    if (clean.length > 200) throw err('资源名称不能超过 200 个字符');
    const a = db.prepare('SELECT id, name FROM assets WHERE id = ?').get(assetId);
    if (!a) throw notFound('资源不存在');

    db.prepare('UPDATE assets SET name = ?, updated_at = datetime(\'now\') WHERE id = ?')
        .run(clean, assetId);
    logOp(db, {
        assetId, action: 'rename',
        detail: `${a.name} → ${clean}`, operator
    });
    return { id: assetId, name: clean };
}

/**
 * 移动资源（可批量）。folderId 传 null 表示移出到"未分类"。
 * 移动到回收站中的文件夹无意义（文件夹不支持删除到回收站），故不校验其状态。
 */
export function moveAssets({ connection: db, assetIds, folderId, operator = 'local' }) {
    const ids = (assetIds || []).filter((n) => Number.isInteger(Number(n)) && Number(n) > 0).map(Number);
    if (ids.length === 0) throw err('未选择任何资源');

    if (folderId != null) {
        const f = db.prepare('SELECT id FROM asset_folders WHERE id = ?').get(folderId);
        if (!f) throw err('目标文件夹不存在');
    }

    const ph = ids.map(() => '?').join(',');
    const tx = db.transaction(() => {
        const info = db.prepare(
            `UPDATE assets SET folder_id = ?, updated_at = datetime('now') WHERE id IN (${ph}) AND is_deleted = 0`
        ).run(folderId, ...ids);
        logOp(db, {
            action: 'move',
            detail: `移动 ${info.changes} 个资源到 ${folderId ?? '未分类'}`,
            operator
        });
        return info.changes;
    });
    const changed = tx();
    return { moved: changed, missing: ids.length - changed };
}

/** 更新资源元信息（描述、状态、类型）。 */
export function updateAsset({ connection: db, assetId, patch = {}, operator = 'local' }) {
    const a = db.prepare('SELECT id FROM assets WHERE id = ?').get(assetId);
    if (!a) throw notFound('资源不存在');

    const sets = [];
    const params = [];
    if (patch.description !== undefined) {
        sets.push('description = ?');
        params.push(String(patch.description));
    }
    if (patch.status !== undefined) {
        if (!Object.values(ASSET_STATUS).includes(patch.status)) throw err('无效的资源状态');
        // 改状态时同步 published 指针的一致性：
        // 置为 published 但从未发布过 → 报错，不制造「状态与指针矛盾」的数据
        if (patch.status === ASSET_STATUS.PUBLISHED) {
            const cur = db.prepare('SELECT published_version_id FROM assets WHERE id = ?').get(assetId);
            if (!cur.published_version_id) {
                throw err('尚未发布任何版本，不能直接标记为已发布');
            }
        }
        sets.push('status = ?');
        params.push(patch.status);
    }
    if (patch.type !== undefined) {
        sets.push('type = ?');
        params.push(String(patch.type));
    }
    if (sets.length === 0) throw err('没有需要更新的字段');

    sets.push('updated_at = datetime(\'now\')');
    params.push(assetId);
    db.prepare(`UPDATE assets SET ${sets.join(', ')} WHERE id = ?`).run(...params);

    if (patch.status !== undefined) {
        logOp(db, { assetId, action: 'update', detail: `状态改为 ${patch.status}`, operator });
    }
    return { id: assetId };
}

// ══════════════════════════════════════════════════════════════════
// 标签
// ══════════════════════════════════════════════════════════════════

/** 全量标签（筛选栏用）。 */
export function listAssetTags({ connection: db }) {
    return db.prepare(`
        SELECT at.id, at.name, COUNT(atl.asset_id) AS usage_count
        FROM asset_tags at
        LEFT JOIN asset_tag_links atl ON atl.tag_id = at.id
        GROUP BY at.id
        ORDER BY usage_count DESC, at.name ASC
    `).all().map((r) => ({ id: r.id, name: r.name, usageCount: r.usage_count }));
}

/** 全量替换某资源的标签集合（标签名不存在则创建）。 */
export function setTags(db, assetId, tags) {
    const names = [...new Set((tags || []).map((t) => String(t).trim()).filter(Boolean))];
    db.prepare('DELETE FROM asset_tag_links WHERE asset_id = ?').run(assetId);
    for (const name of names) {
        let row = db.prepare('SELECT id FROM asset_tags WHERE name = ?').get(name);
        if (!row) {
            const info = db.prepare('INSERT INTO asset_tags (name) VALUES (?)').run(name);
            row = { id: Number(info.lastInsertRowid) };
        }
        db.prepare('INSERT OR IGNORE INTO asset_tag_links (asset_id, tag_id) VALUES (?, ?)')
            .run(assetId, row.id);
    }
}

/** 批量给多个资源追加标签（不清除原有标签）。 */
export function addTagsToAssets({ connection: db, assetIds, tags }) {
    const ids = (assetIds || []).filter((n) => Number.isInteger(Number(n)) && Number(n) > 0).map(Number);
    const names = [...new Set((tags || []).map((t) => String(t).trim()).filter(Boolean))];
    if (ids.length === 0) throw err('未选择任何资源');
    if (names.length === 0) throw err('未提供任何标签');

    const tx = db.transaction(() => {
        let count = 0;
        for (const assetId of ids) {
            const exists = db.prepare('SELECT 1 FROM assets WHERE id = ?').get(assetId);
            if (!exists) continue;
            count++;
            for (const name of names) {
                let row = db.prepare('SELECT id FROM asset_tags WHERE name = ?').get(name);
                if (!row) {
                    const info = db.prepare('INSERT INTO asset_tags (name) VALUES (?)').run(name);
                    row = { id: Number(info.lastInsertRowid) };
                }
                db.prepare('INSERT OR IGNORE INTO asset_tag_links (asset_id, tag_id) VALUES (?, ?)')
                    .run(assetId, row.id);
            }
            db.prepare('UPDATE assets SET updated_at = datetime(\'now\') WHERE id = ?').run(assetId);
        }
        logOp(db, { action: 'add_tags', detail: `${count} 个资源追加标签 ${names.join(', ')}`, operator: 'local' });
        return count;
    });
    const changed = tx();
    return { updated: changed, tags: names };
}

// ══════════════════════════════════════════════════════════════════
// 删除 / 回收站
// ══════════════════════════════════════════════════════════════════

/**
 * 软删除：移入回收站。
 * **不碰存储文件** —— 永久删除才 unlink。用户明确要求。
 *
 * @param {object} config
 * @param {number[]} config.assetIds 支持批量
 * @param {boolean} [config.toTrash=true] false 表示从回收站恢复
 * @returns {{ affected:number, missing:number }}
 */
export function setAssetsDeleted({ connection: db, assetIds, toTrash = true, operator = 'local' }) {
    const ids = (assetIds || []).filter((n) => Number.isInteger(Number(n)) && Number(n) > 0).map(Number);
    if (ids.length === 0) throw err('未选择任何资源');
    const ph = ids.map(() => '?').join(',');

    const tx = db.transaction(() => {
        let affected = 0;
        if (toTrash) {
            affected = db.prepare(`
                UPDATE assets
                SET is_deleted = 1, deleted_at = datetime('now'), deleted_by = ?, updated_at = datetime('now')
                WHERE id IN (${ph}) AND is_deleted = 0
            `).run(operator, ...ids).changes;
            if (affected > 0) {
                logOp(db, { action: 'delete', detail: `移入回收站 ${affected} 个资源`, operator });
            }
        } else {
            affected = db.prepare(`
                UPDATE assets
                SET is_deleted = 0, deleted_at = NULL, deleted_by = NULL, updated_at = datetime('now')
                WHERE id IN (${ph}) AND is_deleted = 1
            `).run(...ids).changes;
            if (affected > 0) {
                logOp(db, { action: 'restore', detail: `从回收站恢复 ${affected} 个资源`, operator });
            }
        }
        return affected;
    });
    const affected = tx();
    return { affected, missing: ids.length - affected };
}

/**
 * 永久删除：真正从数据库移除。
 * **存储文件由调用方负责清理**（asset-storage.deleteVersionDir），
 * 这里只管元数据 —— 让调用方能先查清要删哪些文件、再删，避免半途失败留下孤儿。
 *
 * @returns {{ deleted:number, missing:number, assetIds:number[] }}
 */
export function purgeAssets({ connection: db, assetIds, operator = 'local' }) {
    const ids = (assetIds || []).filter((n) => Number.isInteger(Number(n)) && Number(n) > 0).map(Number);
    if (ids.length === 0) throw err('未选择任何资源');
    const ph = ids.map(() => '?').join(',');

    const tx = db.transaction(() => {
        const found = db.prepare(`SELECT id FROM assets WHERE id IN (${ph}) AND is_deleted = 1`)
            .all(...ids).map((r) => r.id);
        if (found.length > 0) {
            // ON DELETE CASCADE 会带走 asset_versions / asset_tag_links / operation_logs
            db.prepare(`DELETE FROM assets WHERE id IN (${ph}) AND is_deleted = 1`).run(...ids);
            // 日志表 FK 同样是 CASCADE，记录随资源一起消失 —— 这是可接受的：
            // 资源本身都不存在了，保留它的操作日志没有意义。
        }
        return found;
    });
    const found = tx();
    return { deleted: found.length, missing: ids.length - found.length, assetIds: found };
}

/** 清空回收站（返回被清空的资源 id 列表，供调用方清理磁盘）。 */
export function listTrashIds({ connection: db }) {
    return db.prepare('SELECT id FROM assets WHERE is_deleted = 1').all().map((r) => r.id);
}

// ══════════════════════════════════════════════════════════════════
// 操作记录
// ══════════════════════════════════════════════════════════════════

/** 某资源的操作记录（倒序）。 */
export function listOperationLogs({ connection: db, assetId, limit = 50 }) {
    return db.prepare(`
        SELECT id, asset_id, version_id, action, detail, operator, created_at
        FROM asset_operation_logs
        WHERE asset_id = ?
        ORDER BY created_at DESC, id DESC
        LIMIT ?
    `).all(assetId, Math.min(200, Math.max(1, Number(limit) || 50)))
        .map((r) => ({
            id: r.id,
            assetId: r.asset_id,
            versionId: r.version_id,
            action: r.action,
            detail: r.detail,
            operator: r.operator,
            createdAt: r.created_at
        }));
}

/** 最近操作（全库，「最近使用」视图用）。 */
export function listRecentOperations({ connection: db, limit = 20 }) {
    return db.prepare(`
        SELECT l.id, l.asset_id, l.action, l.detail, l.operator, l.created_at, a.name AS asset_name, a.type AS asset_type
        FROM asset_operation_logs l
        LEFT JOIN assets a ON a.id = l.asset_id
        ORDER BY l.created_at DESC, l.id DESC
        LIMIT ?
    `).all(Math.min(100, Math.max(1, Number(limit) || 20)));
}

// ══════════════════════════════════════════════════════════════════
// 统计
// ══════════════════════════════════════════════════════════════════

/** 资产库总览（左侧导航的计数徽标）。 */
export function assetStats({ connection: db }) {
    const base = db.prepare(`
        SELECT
            COUNT(*) AS total,
            COALESCE(SUM(CASE WHEN is_deleted = 0 THEN 1 ELSE 0 END), 0) AS active,
            COALESCE(SUM(CASE WHEN is_deleted = 1 THEN 1 ELSE 0 END), 0) AS trashed,
            COALESCE(SUM(CASE WHEN is_deleted = 0 AND published_version_id IS NOT NULL THEN 1 ELSE 0 END), 0) AS published,
            COALESCE(SUM(CASE WHEN is_deleted = 0 AND (published_version_id IS NULL OR published_version_id <> latest_version_id) THEN 1 ELSE 0 END), 0) AS unpublished
        FROM assets
    `).get();
    const folders = db.prepare('SELECT COUNT(*) n FROM asset_folders').get().n;
    return { ...base, folders };
}

/** 按类型分组计数（筛选栏旁的分布提示）。 */
export function assetTypeBreakdown({ connection: db }) {
    return db.prepare(`
        SELECT type, COUNT(*) n, COALESCE(SUM(latest_size), 0) AS total_size
        FROM (
            SELECT a.type, COALESCE(lv.file_size, 0) AS latest_size
            FROM assets a
            LEFT JOIN asset_versions lv ON lv.id = a.latest_version_id
            WHERE a.is_deleted = 0
        )
        GROUP BY type
        ORDER BY n DESC
    `).all().map((r) => ({ type: r.type, count: r.n, totalSize: r.total_size }));
}