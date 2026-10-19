// 文档存储层：为 TASK-003 提供 create/get/list/update/delete 函数，
// 以及分类/标签关联的最小支持。
//
// 校验规则（依据 FUNCTIONAL_SPEC）：
//   title: 1-100 字符（去首尾空白）
//   content_md: UTF8 编码，最大 1MB
//   tags: 每文档最多 10 个
//   parent_id: 正整数或 NULL（NULL = 顶层页面），且不能形成环
//
// 乐观锁：UPDATE WHERE id AND version，一致则写入并 version+1，否则返回冲突快照。
// 事务：文档与标签关联同事务，失败全部回滚。
//
// 错误码：invalid_input / not_found / conflict（版本冲突）/ constraint_failed
//
// 页面树（迁移 002 引入）：documents.parent_id 自引用，ON DELETE CASCADE。
//   getDocument 额外返回 path（祖先，根→父）、child_count、descendant_count，
//   供阅读页面包屑、子页面列表与删除确认使用。

import { errorMap } from './errors.js';

// ─────────────────────────────────────────────────
// 校验函数（内部使用）
// ─────────────────────────────────────────────────

/**
 * 校验文档标题。
 * @param {string} title
 * @returns {{ valid: boolean, message?: string }}
 */
function validateTitle(title) {
    if (typeof title !== 'string') {
        return { valid: false, message: '标题必须为字符串' };
    }
    const trimmed = title.trim();
    if (trimmed.length === 0) {
        return { valid: false, message: '标题不能为空' };
    }
    if (trimmed.length > 100) {
        return { valid: false, message: '标题不能超过 100 字符' };
    }
    return { valid: true, value: trimmed };
}

/**
 * 校验文档正文大小。
 * @param {string} content
 * @returns {{ valid: boolean, message?: string }}
 */
function validateContent(content) {
    if (typeof content !== 'string') {
        return { valid: false, message: '正文必须为字符串' };
    }
    // UTF8 字节数检查（1MB = 1048576 字节）
    const byteLen = Buffer.byteLength(content, 'utf8');
    if (byteLen > 1048576) {
        return { valid: false, message: '正文不能超过 1MB（UTF8 编码）' };
    }
    return { valid: true, value: content };
}

/**
 * 校验标签数组。
 * @param {any[]} tags
 * @returns {{ valid: boolean, message?: string, value?: string[] }}
 */
function validateTags(tags) {
    if (!Array.isArray(tags)) {
        return { valid: false, message: '标签必须为数组' };
    }
    if (tags.length > 10) {
        return { valid: false, message: '单文档标签不能超过 10 个' };
    }
    const validated = [];
    for (const tag of tags) {
        if (typeof tag !== 'string') {
            return { valid: false, message: '标签名必须为字符串' };
        }
        // F-KB-005：英文统一小写合并（中文不受影响），去空白后跳过空标签
        const normalized = tag.trim().toLowerCase();
        if (normalized.length === 0) continue; // 忽略空标签
        if (normalized.length > 30) {
            return { valid: false, message: `标签名 "${normalized}" 超过 30 字符限制` };
        }
        validated.push(normalized);
    }
    return { valid: true, value: [...new Set(validated)] }; // 去重
}

/**
 * 校验分类 ID。
 * @param {any} categoryId
 * @returns {{ valid: boolean, message?: string, value?: number|null }}
 */
function validateCategoryId(categoryId) {
    if (categoryId === undefined || categoryId === null) {
        return { valid: true, value: null };
    }
    const n = Number(categoryId);
    if (!Number.isInteger(n) || n < 1) {
        return { valid: false, message: '分类 ID 无效' };
    }
    return { valid: true, value: n };
}

/**
 * 校验父页面 ID（NULL 表示顶层页面）。
 * @param {any} parentId
 * @returns {{ valid: boolean, message?: string, value?: number|null }}
 */
function validateParentId(parentId) {
    if (parentId === undefined || parentId === null || parentId === '') {
        return { valid: true, value: null };
    }
    const n = Number(parentId);
    if (!Number.isInteger(n) || n < 1) {
        return { valid: false, message: '父页面 ID 无效' };
    }
    return { valid: true, value: n };
}

/**
 * 判断 candidateId 是否为 rootId 的后代（含自身）。
 * 用于移动页面时防环：新父页面不能是自己或自己的后代。
 *
 * @param {import('better-sqlite3').Database} db
 * @param {number} rootId
 * @param {number} candidateId
 * @returns {boolean}
 */
function isSelfOrDescendant(db, rootId, candidateId) {
    const hit = db.prepare(`
        WITH RECURSIVE sub(id) AS (
            SELECT id FROM documents WHERE id = ?
            UNION ALL
            SELECT d.id FROM documents d JOIN sub ON d.parent_id = sub.id
        )
        SELECT 1 AS hit FROM sub WHERE id = ? LIMIT 1
    `).get(rootId, candidateId);
    return Boolean(hit);
}

// ─────────────────────────────────────────────────
// 标签内部操作（事务中使用）
// ─────────────────────────────────────────────────

/**
 * 确保标签存在（按名称），返回 tag_id。
 * @param {import('better-sqlite3').Database} db
 * @param {string} tagName - 规范化后的标签名
 * @returns {number} tag_id
 */
function ensureTag(db, tagName) {
    // 先查
    const existing = db.prepare('SELECT id FROM tags WHERE name = ?').get(tagName);
    if (existing) return existing.id;
    // 再插（可能竞态，忽略主键冲突）
    try {
        return db.prepare('INSERT INTO tags (name) VALUES (?)').run(tagName).lastInsertRowid;
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT') {
            return db.prepare('SELECT id FROM tags WHERE name = ?').get(tagName).id;
        }
        throw err;
    }
}

/**
 * 替换文档的标签关联（在事务内调用）。
 * @param {import('better-sqlite3').Database} db
 * @param {number} documentId
 * @param {string[]} tagNames - 规范化后的标签名数组
 */
function replaceDocumentTags(db, documentId, tagNames) {
    // 删除旧关联
    db.prepare('DELETE FROM document_tags WHERE document_id = ?').run(documentId);
    // 插入新关联
    for (const name of tagNames) {
        const tagId = ensureTag(db, name);
        db.prepare('INSERT OR IGNORE INTO document_tags (document_id, tag_id) VALUES (?, ?)').run(documentId, tagId);
    }
}

// ─────────────────────────────────────────────────
// 文档 CRUD（存储层接口，供 TASK-003 调用）
// ─────────────────────────────────────────────────

/**
 * 新建文档。
 *
 * @param {object} config
 * @param {import('better-sqlite3').Database} config.connection - 数据库连接（必须）
 * @param {string} config.title - 标题（1-100 字符）
 * @param {string} [config.content_md=''] - Markdown 正文
 * @param {number|null} [config.category_id] - 分类 ID
 * @param {number|null} [config.parent_id] - 父页面 ID（NULL = 顶层页面）
 * @param {string[]} [config.tags=[]] - 标签名数组（≤10）
 * @returns {{ id: number, version: number, parent_id: number|null, created_at: string, updated_at: string }}
 * @throws {{ code: 'invalid_input', message: string }}
 */
export function createDocument({ connection: db, title, content_md = '', category_id, parent_id, tags = [] }) {
    const vTitle = validateTitle(title);
    if (!vTitle.valid) throw errorMap(new Error(vTitle.message), '(store)', 'invalid_input');

    const vContent = validateContent(content_md);
    if (!vContent.valid) throw errorMap(new Error(vContent.message), '(store)', 'invalid_input');

    const vCategory = validateCategoryId(category_id);
    if (!vCategory.valid) throw errorMap(new Error(vCategory.message), '(store)', 'invalid_input');

    const vParent = validateParentId(parent_id);
    if (!vParent.valid) throw errorMap(new Error(vParent.message), '(store)', 'invalid_input');

    const vTags = validateTags(tags);
    if (!vTags.valid) throw errorMap(new Error(vTags.message), '(store)', 'invalid_input');

    // 验证分类存在（如果提供了）
    if (vCategory.value !== null) {
        const cat = db.prepare('SELECT id FROM categories WHERE id = ?').get(vCategory.value);
        if (!cat) throw errorMap(new Error('指定的分类不存在'), '(store)', 'invalid_input');
    }

    // 验证父页面存在（如果提供了）
    if (vParent.value !== null) {
        const parent = db.prepare('SELECT id FROM documents WHERE id = ?').get(vParent.value);
        if (!parent) throw errorMap(new Error('指定的父页面不存在'), '(store)', 'invalid_input');
    }

    const now = new Date().toISOString();
    let docId;

    const tx = db.transaction(() => {
        const result = db.prepare(`
            INSERT INTO documents (title, content_md, category_id, parent_id, version, created_at, updated_at)
            VALUES (?, ?, ?, ?, 1, ?, ?)
        `).run(vTitle.value, vContent.value, vCategory.value, vParent.value, now, now);
        docId = result.lastInsertRowid;

        if (vTags.value.length > 0) {
            replaceDocumentTags(db, docId, vTags.value);
        }
    });

    try {
        tx();
    } catch (err) {
        const mapped = errorMap(err, '(store)', 'write');
        throw mapped;
    }

    return {
        id: docId,
        version: 1,
        parent_id: vParent.value,
        created_at: now,
        updated_at: now
    };
}

/**
 * 获取单个文档（含标签、祖先路径、子页面数量）。
 *
 * @param {object} config
 * @param {import('better-sqlite3').Database} config.connection
 * @param {number} config.id
 * @returns {{ id, title, content_md, category_id, parent_id, version, created_at, updated_at,
 *             tags: string[], path: {id:number,title:string}[], child_count: number, descendant_count: number }|null}
 */
export function getDocument({ connection: db, id }) {
    const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(id);
    if (!doc) return null;

    const tagRows = db.prepare(`
        SELECT t.name FROM tags t
        JOIN document_tags dt ON dt.tag_id = t.id
        WHERE dt.document_id = ?
    `).all(id);

    // 祖先路径（根 → 父），用于面包屑
    const path = db.prepare(`
        WITH RECURSIVE up(id, title, parent_id, depth) AS (
            SELECT id, title, parent_id, 0 FROM documents WHERE id = ?
            UNION ALL
            SELECT d.id, d.title, d.parent_id, up.depth + 1
            FROM documents d JOIN up ON d.id = up.parent_id
        )
        SELECT id, title FROM up WHERE depth > 0 ORDER BY depth DESC
    `).all(id);

    const childCount = db.prepare('SELECT COUNT(*) AS n FROM documents WHERE parent_id = ?').get(id).n;
    const descendantCount = db.prepare(`
        WITH RECURSIVE sub(id) AS (
            SELECT id FROM documents WHERE parent_id = ?
            UNION ALL
            SELECT d.id FROM documents d JOIN sub ON d.parent_id = sub.id
        )
        SELECT COUNT(*) AS n FROM sub
    `).get(id).n;

    return {
        ...doc,
        tags: tagRows.map(r => r.name),
        path,
        child_count: childCount,
        descendant_count: descendantCount
    };
}

/**
 * 列出文档（分页，默认按 updated_at 倒序）。
 *
 * @param {object} config
 * @param {import('better-sqlite3').Database} config.connection
 * @param {{ limit?: number, offset?: number, category_id?: number|null,
 *           parent_id?: number|null, root?: boolean, tags?: string[] }} [config.filter]
 *   - parent_id：只看该页面的直接子页面
 *   - root：只看顶层页面（parent_id IS NULL）
 *   - tags：按标签 AND 过滤（数组，文档须同时包含全部所选标签）
 * @returns {{ items: object[], total: number }}
 */
export function listDocuments({ connection: db, filter = {} }) {
    const { limit = 20, offset = 0, category_id, parent_id, root, tags } = filter;

    const conds = [];
    const params = [];
    if (category_id !== undefined && category_id !== null) {
        conds.push('d.category_id = ?');
        params.push(category_id);
    }
    if (root === true) {
        conds.push('d.parent_id IS NULL');
    } else if (parent_id !== undefined && parent_id !== null) {
        conds.push('d.parent_id = ?');
        params.push(parent_id);
    }
    // F-KB-005：标签 AND 过滤（文档须同时包含所选全部标签）
    const tagNames = Array.isArray(tags)
        ? [...new Set(tags.map((t) => String(t).trim().toLowerCase()).filter(Boolean))]
        : [];
    if (tagNames.length > 0) {
        const ph = tagNames.map(() => '?').join(',');
        conds.push(
            `d.id IN (SELECT dt.document_id FROM document_tags dt ` +
            `JOIN tags t ON t.id = dt.tag_id WHERE t.name IN (${ph}) ` +
            `GROUP BY dt.document_id HAVING COUNT(DISTINCT dt.tag_id) = ${tagNames.length})`
        );
        params.push(...tagNames);
    }
    const where = conds.length > 0 ? 'WHERE ' + conds.join(' AND ') : '';

    const total = db.prepare(`SELECT COUNT(*) as n FROM documents d ${where}`).get(...params).n;

    const items = db.prepare(`
        SELECT d.*, c.name as category_name,
            GROUP_CONCAT(t.name, ',') as tag_names
        FROM documents d
        LEFT JOIN categories c ON c.id = d.category_id
        LEFT JOIN document_tags dt ON dt.document_id = d.id
        LEFT JOIN tags t ON t.id = dt.tag_id
        ${where}
        GROUP BY d.id
        ORDER BY d.updated_at DESC
        LIMIT ? OFFSET ?
    `).all(...params, limit, offset);

    return {
        total,
        items: items.map(row => ({
            ...row,
            tags: row.tag_names ? row.tag_names.split(',') : []
        }))
    };
}

/**
 * 生成搜索摘要片段（F-KB-006）：在正文（折叠为单行）中定位关键词（不区分大小写），
 * 取其前后窗口；未命中则取正文前 N 个字符。去除换行、折叠空白，避免渲染原始 Markdown 换行。
 *
 * @param {string} content 正文 Markdown
 * @param {string} keyword 原始关键词（未转义）
 * @returns {string}
 */
function makeSnippet(content, keyword) {
    if (!content) return '';
    const oneLine = String(content).replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim();
    if (!keyword) return oneLine.slice(0, 120);
    const idx = oneLine.toLowerCase().indexOf(keyword.toLowerCase());
    if (idx < 0) return oneLine.slice(0, 120);
    const radius = 50;
    const start = Math.max(0, idx - radius);
    const end = Math.min(oneLine.length, idx + keyword.length + radius);
    let snippet = oneLine.slice(start, end);
    if (start > 0) snippet = '…' + snippet;
    if (end < oneLine.length) snippet = snippet + '…';
    return snippet;
}

/**
 * 关键词搜索（F-KB-006）：标题或正文包含关键词（不区分大小写，参数化 LIKE）。
 * 关键词中的 LIKE 通配符（%、_、\）会被转义为字面量，防止意外通配与注入。
 * 结果按 updated_at 倒序、分页返回，附带摘要片段 snippet。
 *
 * @param {object} config
 * @param {import('better-sqlite3').Database} config.connection
 * @param {string} config.keyword 原始关键词（会做首尾去空白）
 * @param {number} [config.limit=20]
 * @param {number} [config.offset=0]
 * @returns {{ total:number, items:object[] }}
 */
export function searchDocuments({ connection: db, keyword, limit = 20, offset = 0 }) {
    const kw = (keyword || '').trim();
    if (!kw) return { total: 0, items: [] };
    // 转义 LIKE 通配符，使其按字面量匹配（配合 ESCAPE '\'）
    const escaped = kw
        .replace(/\\/g, '\\\\')
        .replace(/%/g, '\\%')
        .replace(/_/g, '\\_');
    const params = [`%${escaped}%`, `%${escaped}%`];
    const where = `WHERE (d.title LIKE ? ESCAPE '\\' OR d.content_md LIKE ? ESCAPE '\\')`;

    const total = db.prepare(`SELECT COUNT(*) as n FROM documents d ${where}`).get(...params).n;

    const raw = db.prepare(`
        SELECT d.*, c.name as category_name,
            GROUP_CONCAT(t.name, ',') as tag_names
        FROM documents d
        LEFT JOIN categories c ON c.id = d.category_id
        LEFT JOIN document_tags dt ON dt.document_id = d.id
        LEFT JOIN tags t ON t.id = dt.tag_id
        ${where}
        GROUP BY d.id
        ORDER BY d.updated_at DESC
        LIMIT ? OFFSET ?
    `).all(...params, limit, offset);

    const items = raw.map((row) => ({
        ...row,
        tags: row.tag_names ? row.tag_names.split(',') : [],
        snippet: makeSnippet(row.content_md, kw)
    }));
    return { total, items };
}

/**
 * 页面树数据：只取渲染侧边栏所需字段，按创建顺序稳定排序。
 * 由前端组装成嵌套结构（后端不递归 JSON，避免深层页面反复遍历）。
 *
 * @param {object} config
 * @param {import('better-sqlite3').Database} config.connection
 * @returns {{ id:number, title:string, parent_id:number|null, updated_at:string, created_at:string }[]}
 */
export function listDocumentTree({ connection: db }) {
    return db.prepare(`
        SELECT id, title, parent_id, updated_at, created_at
        FROM documents
        ORDER BY created_at ASC, id ASC
    `).all();
}

/**
 * 列出某页面的直接子页面。
 *
 * @param {object} config
 * @param {import('better-sqlite3').Database} config.connection
 * @param {number} config.id
 * @returns {{ id:number, title:string, parent_id:number|null, updated_at:string }[]}
 */
export function listChildren({ connection: db, id }) {
    return db.prepare(`
        SELECT id, title, parent_id, updated_at
        FROM documents
        WHERE parent_id = ?
        ORDER BY created_at ASC, id ASC
    `).all(id);
}

/**
 * 更新文档（乐观锁）。
 *
 * @param {object} config
 * @param {import('better-sqlite3').Database} config.connection
 * @param {number} config.id
 * @param {number} config.version - 更新时的版本（乐观锁）
 * @param {string} [config.title]
 * @param {string} [config.content_md]
 * @param {number|null} [config.category_id]
 * @param {number|null} [config.parent_id] - 移动页面（NULL = 移到顶层）
 * @param {string[]} [config.tags]
 * @returns {{ version: number, updated_at: string }} - 新版本信息
 * @throws {{ code: 'not_found', message: string }} - 文档不存在
 * @throws {{ code: 'conflict', current: object }} - 版本冲突，返回当前服务端快照
 */
export function updateDocument({ connection: db, id, version, title, content_md, category_id, parent_id, tags }) {
    // 先查当前文档
    const current = db.prepare('SELECT * FROM documents WHERE id = ?').get(id);
    if (!current) {
        const err = new Error('文档不存在');
        err.code = 'not_found';
        throw errorMap(err, '(store)', 'not_found');
    }

    // 乐观锁检查
    if (current.version !== version) {
        const err = new Error('版本冲突');
        err.code = 'conflict';
        const mapped = errorMap(err, '(store)', 'write');
        mapped.current = getDocument({ connection: db, id }); // 返回完整快照
        throw mapped;
    }

    const now = new Date().toISOString();

    // 逐字段构建更新（只更新提供的字段）
    const updates = [];
    const params = [];

    if (title !== undefined) {
        const v = validateTitle(title);
        if (!v.valid) throw errorMap(new Error(v.message), '(store)', 'invalid_input');
        updates.push('title = ?');
        params.push(v.value);
    }
    if (content_md !== undefined) {
        const v = validateContent(content_md);
        if (!v.valid) throw errorMap(new Error(v.message), '(store)', 'invalid_input');
        updates.push('content_md = ?');
        params.push(v.value);
    }
    if (category_id !== undefined) {
        const v = validateCategoryId(category_id);
        if (!v.valid) throw errorMap(new Error(v.message), '(store)', 'invalid_input');
        // 验证分类存在
        if (v.value !== null) {
            const cat = db.prepare('SELECT id FROM categories WHERE id = ?').get(v.value);
            if (!cat) throw errorMap(new Error('指定的分类不存在'), '(store)', 'invalid_input');
        }
        updates.push('category_id = ?');
        params.push(v.value);
    }
    if (parent_id !== undefined) {
        const v = validateParentId(parent_id);
        if (!v.valid) throw errorMap(new Error(v.message), '(store)', 'invalid_input');
        if (v.value !== null) {
            const parent = db.prepare('SELECT id FROM documents WHERE id = ?').get(v.value);
            if (!parent) throw errorMap(new Error('指定的父页面不存在'), '(store)', 'invalid_input');
            // 防环：不能把页面移动到自身或自己的后代之下
            if (isSelfOrDescendant(db, id, v.value)) {
                throw errorMap(new Error('不能将页面移动到它自己或其子页面之下'), '(store)', 'invalid_input');
            }
        }
        updates.push('parent_id = ?');
        params.push(v.value);
    }

    updates.push('version = version + 1');
    updates.push('updated_at = ?');
    params.push(now);
    params.push(id);
    params.push(version); // WHERE version = ?（乐观锁条件）

    const tx = db.transaction(() => {
        const result = db.prepare(`
            UPDATE documents SET ${updates.join(', ')}
            WHERE id = ? AND version = ?
        `).run(...params);

        if (result.changes === 0) {
            // 再次检查：可能是并发更新导致的
            const check = db.prepare('SELECT version FROM documents WHERE id = ?').get(id);
            if (!check || check.version !== version) {
                const err = new Error('版本冲突');
                err.code = 'conflict';
                const mapped = errorMap(err, '(store)', 'write');
                mapped.current = getDocument({ connection: db, id });
                throw mapped;
            }
        }

        // 更新标签（如果提供了）
        if (tags !== undefined) {
            const vTags = validateTags(tags);
            if (!vTags.valid) throw errorMap(new Error(vTags.message), '(store)', 'invalid_input');
            replaceDocumentTags(db, id, vTags.value);
        }
    });

    try {
        tx();
    } catch (err) {
        if (err.code === 'conflict' || err.code === 'invalid_input') throw err;
        throw errorMap(err, '(store)', 'write');
    }

    const updated = db.prepare('SELECT version, updated_at FROM documents WHERE id = ?').get(id);
    return { version: updated.version, updated_at: updated.updated_at };
}

/**
 * 删除文档（含标签关联，CASCADE）。
 *
 * @param {object} config
 * @param {import('better-sqlite3').Database} config.connection
 * @param {number} config.id
 * @throws {{ code: 'not_found', message: string }}
 */
export function deleteDocument({ connection: db, id }) {
    const doc = db.prepare('SELECT id FROM documents WHERE id = ?').get(id);
    if (!doc) {
        const err = new Error('文档不存在');
        err.code = 'not_found';
        throw errorMap(err, '(store)', 'not_found');
    }

    // document_tags 有 ON DELETE CASCADE，删除文档自动清理关联
    db.prepare('DELETE FROM documents WHERE id = ?').run(id);
}

// ─────────────────────────────────────────────────
// 分类和标签的存储层支持（供 TASK-003 最小使用）
// ─────────────────────────────────────────────────

/**
 * 创建分类。
 * @param {object} config
 * @param {import('better-sqlite3').Database} config.connection
 * @param {string} config.name - 1-30 字符，唯一
 * @returns {{ id: number, name: string, created_at: string }}
 */
export function createCategory({ connection: db, name }) {
    if (typeof name !== 'string' || name.trim().length === 0) {
        throw errorMap(new Error('分类名称不能为空'), '(store)', 'invalid_input');
    }
    const trimmed = name.trim();
    if (trimmed.length > 30) {
        throw errorMap(new Error('分类名称不能超过 30 字符'), '(store)', 'invalid_input');
    }
    // F-KB-004：分类上限 50
    const count = db.prepare('SELECT COUNT(*) AS n FROM categories').get().n;
    if (count >= 50) {
        throw errorMap(new Error('分类数量已达上限（最多 50 个）'), '(store)', 'invalid_input');
    }
    const now = new Date().toISOString();
    try {
        const result = db.prepare('INSERT INTO categories (name, created_at) VALUES (?, ?)').run(trimmed, now);
        return { id: result.lastInsertRowid, name: trimmed, created_at: now };
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT' || (typeof err.code === 'string' && err.code.startsWith('SQLITE_CONSTRAINT_'))) {
            throw errorMap(new Error('分类名称已存在'), '(store)', 'constraint_failed');
        }
        throw errorMap(err, '(store)', 'write');
    }
}

/**
 * 获取分类列表。
 * @param {object} config
 * @param {import('better-sqlite3').Database} config.connection
 * @returns {object[]}
 */
export function listCategories({ connection: db }) {
    return db.prepare('SELECT * FROM categories ORDER BY name').all();
}

/**
 * 删除分类（文档的 category_id 置 NULL，由外键 ON DELETE SET NULL 处理）。
 * @param {object} config
 * @param {import('better-sqlite3').Database} config.connection
 * @param {number} config.id
 */
export function deleteCategory({ connection: db, id }) {
    const cat = db.prepare('SELECT id FROM categories WHERE id = ?').get(id);
    if (!cat) {
        const err = new Error('分类不存在');
        err.code = 'not_found';
        throw errorMap(err, '(store)', 'not_found');
    }
    db.prepare('DELETE FROM categories WHERE id = ?').run(id);
}

/**
 * 重命名分类（不影响文档归属，外键 ON DELETE SET NULL 与此无关）。
 * @param {object} config
 * @param {import('better-sqlite3').Database} config.connection
 * @param {number} config.id
 * @param {string} config.name - 1-30 字符，同级唯一（单级分类即全局唯一）
 * @returns {{ id: number, name: string }}
 */
export function updateCategory({ connection: db, id, name }) {
    if (typeof name !== 'string' || name.trim().length === 0) {
        throw errorMap(new Error('分类名称不能为空'), '(store)', 'invalid_input');
    }
    const trimmed = name.trim();
    if (trimmed.length > 30) {
        throw errorMap(new Error('分类名称不能超过 30 字符'), '(store)', 'invalid_input');
    }
    const cat = db.prepare('SELECT id FROM categories WHERE id = ?').get(id);
    if (!cat) {
        const err = new Error('分类不存在');
        err.code = 'not_found';
        throw errorMap(err, '(store)', 'not_found');
    }
    try {
        db.prepare('UPDATE categories SET name = ? WHERE id = ?').run(trimmed, id);
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT' || (typeof err.code === 'string' && err.code.startsWith('SQLITE_CONSTRAINT_'))) {
            throw errorMap(new Error('分类名称已存在'), '(store)', 'constraint_failed');
        }
        throw errorMap(err, '(store)', 'write');
    }
    return { id, name: trimmed };
}

/**
 * 获取标签列表。
 * @param {object} config
 * @param {import('better-sqlite3').Database} config.connection
 * @returns {object[]}
 */
export function listTags({ connection: db }) {
    return db.prepare('SELECT * FROM tags ORDER BY name').all();
}

/**
 * 删除标签（解除全部关联，由 CASCADE 处理 document_tags）。
 * @param {object} config
 * @param {import('better-sqlite3').Database} config.connection
 * @param {number} config.id
 */
export function deleteTag({ connection: db, id }) {
    const tag = db.prepare('SELECT id FROM tags WHERE id = ?').get(id);
    if (!tag) {
        const err = new Error('标签不存在');
        err.code = 'not_found';
        throw errorMap(err, '(store)', 'not_found');
    }
    db.prepare('DELETE FROM tags WHERE id = ?').run(id);
}

/**
 * 获取文档的标签列表。
 * @param {object} config
 * @param {import('better-sqlite3').Database} config.connection
 * @param {number} config.document_id
 * @returns {string[]}
 */
export function getDocumentTags({ connection: db, document_id }) {
    const rows = db.prepare(`
        SELECT t.name FROM tags t
        JOIN document_tags dt ON dt.tag_id = t.id
        WHERE dt.document_id = ?
    `).all(document_id);
    return rows.map(r => r.name);
}
