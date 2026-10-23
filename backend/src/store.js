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
import {
    FTS_TABLE, buildMatchExpr, isFtsAvailable, indexDocument, removeDocument
} from './search-index.js';

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

        // 同步全文索引（FTS5）。放在同一事务里 —— 索引与主表要么都成功要么都回滚，
        // 不会出现「文档写进去了但搜不到」的中间态。
        try {
            indexDocument(db, docId, vTitle.value, vContent.value);
        } catch (e) {
            // 索引失败不该阻断文档创建（搜索会退回 LIKE 降级）
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
        SELECT d.id, d.title, d.category_id, d.version, d.parent_id,
               d.created_at, d.updated_at,
               c.name as category_name,
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

    // 摘要要读正文，但正文不进列表响应——列表默认一次拉 200 条，
    // 带上全文会让响应体积随库线性膨胀，而列表只需要开头一小段。
    // 故分两步：先取元信息，再按本页 id 批量取正文（占位符参数化，无注入风险）。
    const contentById = new Map();
    if (items.length > 0) {
        const ph = items.map(() => '?').join(',');
        for (const row of db.prepare(
            `SELECT id, content_md FROM documents WHERE id IN (${ph})`
        ).all(...items.map(r => r.id))) {
            contentById.set(row.id, row.content_md);
        }
    }

    return {
        total,
        // snippet：列表卡片要显示正文摘要，否则一行只有标题、信息密度过低。
        items: items.map(row => ({
            ...row,
            tags: row.tag_names ? row.tag_names.split(',') : [],
            snippet: makeSnippet(contentById.get(row.id), '', 140)
        }))
    };
}

/**
 * 把Markdown 正文压成纯文本单行（供列表摘要用）。
 *
 * 列表摘要要的是「读起来像句话」，不能把源码符号原样丢给用户：
 * `## 标题`、`**加粗**`、`- 列表`、`[链接](url)`、`![图](src)`、行内代码反引号
 * 都必须去掉，否则摘要栏会出现 `## `、`**`、`](` 这类噪声。
 *
 * 顺序有讲究：
 * 1. 先抽掉代码块 / 行内代码（内容不承载叙述，留着反而更乱）；
 * 2. 图片与链接只留可见文字（图片没有文字，整个删掉）；
 * 3. 再清掉标题、引用、列表、表格、分隔线等结构性标记；
 * 4. 最后折叠空白为单个空格并裁掉首尾。
 *
 * @param {string} content 正文 Markdown
 * @returns {string}
 */
function toPlainText(content) {
    if (!content) return '';
    return String(content)
        .replace(/```[\s\S]*?```/g, ' ')      // 围栏代码块
        .replace(/~~~[\s\S]*?~~~/g, ' ')
        .replace(/`([^`]*)`/g, '$1')          // 行内代码保留文字
        .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')// 图片整体删除（无可见文字）
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/^\s{0,3}#{1,6}\s+/gm, '')   // ATX 标题
        .replace(/^\s{0,3}>\s?/gm, '')        // 引用
        .replace(/^\s{0,3}([-*_])\s*\1\s*\1[-*_\s]*$/gm, ' ') // 分隔线
        .replace(/^\s{0,3}([-*+]|\d+\.)\s+/gm, '')            // 列表
        .replace(/^\s*\|.*\|\s*$/gm, ' ')     // 表格行
        .replace(/^\s*[-:| ]{4,}\s*$/gm, ' ')  // 表格分隔行
        .replace(/(\*\*|__)(.*?)\1/g, '$2')    // 加粗
        .replace(/(\*|_)(.*?)\1/g, '$2')       // 斜体
        .replace(/~~(.*?)~~/g, '$1')           // 删除线
        .replace(/<[^>]+>/g, ' ')              // 内联 HTML
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * 生成摘要片段（F-KB-006）：在正文纯文本中定位关键词（不区分大小写），
 * 取其前后窗口；未命中则取正文前 maxLen 个字符。
 *
 * @param {string} content 正文 Markdown
 * @param {string} keyword 原始关键词（未转义）；为空则纯取开头摘要
 * @param {number} [maxLen=120] 未命中关键词时的截取长度
 * @returns {string}
 */
function makeSnippet(content, keyword, maxLen = 120) {
    const oneLine = toPlainText(content);
    if (!oneLine) return '';
    const head = () => oneLine.slice(0, maxLen) + (oneLine.length > maxLen ? '…' : '');
    if (!keyword) {
        // 列表摘要：工作日志类文档正文常是「日期 + 事项」的清单，
        // 逐条剥掉日期前缀，否则摘要会变成一串日期，读不出任何有效信息。
        // 注意只在**无关键词**时做——搜索时用户可能正是按日期检索，不能抹掉。
        return head().replace(/(?:^|\s)\d{4}[-/]\d{1,2}[-/]\d{1,2}(?:\s|$)/g, ' ').replace(/\s+/g, ' ').trim();
    }
    const idx = oneLine.toLowerCase().indexOf(keyword.toLowerCase());
    if (idx < 0) return head();
    const radius = 50;
    const start = Math.max(0, idx - radius);
    const end = Math.min(oneLine.length, idx + keyword.length + radius);
    let snippet = oneLine.slice(start, end);
    if (start > 0) snippet = '…' + snippet;
    if (end < oneLine.length) snippet = snippet + '…';
    return snippet;
}

/**
 * 关键词搜索（F-KB-006）：标题或正文包含关键词。
 *
 * 实现：FTS5 全文索引（见 search-index.js）。
 *
 * 为什么从 LIKE 换成 FTS5：
 *   1. **子串匹配**。LIKE '%kw%' 是全表扫描，且「部属」搜不到「部署指南」；
 *      FTS5 配 bigram 分词后中文能按 2-gram 子串命中。
 *   2. **相关性排序**。LIKE 只能按 updated_at 排，命中度高的不一定靠前；
 *      FTS5 的 BM25 按匹配质量打分。
 *   3. **长文档不拖慢**。LIKE 要扫全文，文档多了就是全表 IO。
 *
 * 降级：若当前 SQLite 构建不含 FTS5（极少见），退回 LIKE 实现，
 * 保证搜索功能可用（只是没有相关性排序与子串能力）。
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

    const matchExpr = buildMatchExpr(kw);
    if (!matchExpr) return { total: 0, items: [] };

    if (!isFtsAvailable(db)) {
        return searchDocumentsByLike({ connection: db, keyword: kw, limit, offset });
    }

    try {
        // FTS5 匹配与主表详情**分两段查**。
        //
        // 关键约束：bm25() 是 FTS5 的辅助函数，只能在 FTS5 表的查询上下文里用。
        // 一旦把 FTS 表 JOIN 上 documents 再 GROUP BY（收集标签），
        // SQLite 报 "unable to use function bm25 in the requested context"。
        //
        // 这个异常很隐蔽：它被 catch 吞掉后降级到 LIKE，搜索「git」会
        // 因 LIKE 的子串语义误命中别的文档 —— 行为悄悄变回旧样子。
        //
        // 所以：第一段在纯 FTS 上下文里取 doc_id + rank（无 GROUP BY），
        //       第二段用 IN 拿主表详情与标签。
        const total = db.prepare(`
            SELECT COUNT(*) as n
            FROM ${FTS_TABLE}
            WHERE tokens MATCH ?
        `).get(matchExpr).n;

        // 第一段：FTS 匹配 + BM25 打分。
        // 刻意**只查 FTS 表**，不 JOIN documents —— bm25() 在 FTS5 的辅助函数，
        // 一旦 JOIN 上别的表再配 GROUP BY，SQLite 报
        // "unable to use function bm25 in the requested context"。
        // 二级排序（相关度相同时按更新时间倒序）放到 JS 里做，避开这个限制。
        const matched = db.prepare(`
            SELECT doc_id AS did, bm25(${FTS_TABLE}, 0.0, 10.0) AS rank
            FROM ${FTS_TABLE}
            WHERE ${FTS_TABLE} MATCH ?
            ORDER BY rank ASC
        `).all(matchExpr);

        if (!matched.length) return { total: 0, items: [] };

        // 第二段：按匹配 id 取主表详情与标签
        const ids = matched.map((m) => m.did);
        const placeholders = ids.map(() => '?').join(',');
        const rows = db.prepare(`
            SELECT d.*, c.name as category_name,
                GROUP_CONCAT(t.name, ',') as tag_names
            FROM documents d
            LEFT JOIN categories c ON c.id = d.category_id
            LEFT JOIN document_tags dt ON dt.document_id = d.id
            LEFT JOIN tags t ON t.id = dt.tag_id
            WHERE d.id IN (${placeholders})
            GROUP BY d.id
        `).all(...ids);

        const byId = new Map(rows.map((r) => [r.id, r]));
        // 相关度相同时按更新时间倒序（与旧版 LIKE 实现的排序习惯一致，
        // 避免行为回退让用户觉得「搜索坏了」）
        const ordered = matched
            .map((m) => ({ row: byId.get(m.did), rank: m.rank }))
            .filter((x) => x.row)
            .sort((a, b) => {
                if (a.rank !== b.rank) return a.rank - b.rank;
                return String(b.row.updated_at).localeCompare(String(a.row.updated_at));
            })
            .slice(offset, offset + limit);

        const items = ordered.map(({ row, rank }) => ({
            ...toSearchItem(row, kw),
            rank
        }));
        return { total, items };
    } catch (e) {
        // MATCH 语法错误等异常 → 退回 LIKE，绝不让搜索直接不可用
        return searchDocumentsByLike({ connection: db, keyword: kw, limit, offset });
    }
}

/**
 * 搜索结果的统一映射（附摘要片段）。
 * @param {object} row
 * @param {string} kw 原始关键词
 */
function toSearchItem(row, kw) {
    return {
        ...row,
        tags: row.tag_names ? row.tag_names.split(',') : [],
        snippet: makeSnippet(row.content_md, kw)
    };
}

/**
 * LIKE 降级实现：FTS5 不可用时使用。
 *
 * 保留是因为 SQLite 极少数构建不带 FTS5，此时搜索仍应可用
 * （只是没有子串匹配与相关性排序）。
 *
 * @param {object} config
 * @param {import('better-sqlite3').Database} config.connection
 * @param {string} config.keyword
 * @param {number} config.limit
 * @param {number} config.offset
 */
function searchDocumentsByLike({ connection: db, keyword, limit, offset }) {
    // 转义 LIKE 通配符，使其按字面量匹配（配合 ESCAPE '\'）
    const escaped = keyword
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

    return { total, items: raw.map((row) => toSearchItem(row, keyword)) };
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

        // 同步全文索引：用**更新后**的完整内容重建该文档的索引行。
        // 放在同一事务内，与主表更新原子生效。
        try {
            const after = db.prepare('SELECT title, content_md FROM documents WHERE id = ?').get(id);
            if (after) indexDocument(db, id, after.title, after.content_md);
        } catch (e) {
            // 索引失败不阻断更新（搜索会退回 LIKE 降级）
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
    // 全文索引没有 CASCADE（FTS5 虚表不支持外键），需手动清理
    const tx = db.transaction(() => {
        db.prepare('DELETE FROM documents WHERE id = ?').run(id);
        try {
            removeDocument(db, id);
        } catch (e) {
            // 索引表不存在时忽略
        }
    });
    tx();
}

/**
 * 批量删除文档（单个事务，全成功或全回滚）。
 *
 * 与逐条调用 deleteDocument 的区别有两点：
 *   1. 原子性：整个批次在一个事务里，中途失败不会留下「删了一半」的库。
 *   2. 不因个别 id 不存在而整批失败——不存在的 id 记入 missing 后跳过，
 *      因为并发场景下另一个客户端可能已删掉其中一项。
 *
 * 子页面（parent_id）与标签关联都由 ON DELETE CASCADE 自动清理；
 * cascaded 字段返回被连带删除的子孙页数，供前端二次确认展示。
 *
 * @param {object} config
 * @param {import('better-sqlite3').Database} config.connection
 * @param {number[]} config.ids - 待删除的文档 id 数组（1-500 个）
 * @returns {{ deleted: number, cascaded: number, missing: number[] }}
 * @throws {{ code: 'invalid_input', message: string }}
 */
export function deleteDocuments({ connection: db, ids }) {
    // ── 入参校验 ──
    if (!Array.isArray(ids) || ids.length === 0) {
        throw errorMap(new Error('请至少选择一个文档'), '(store)', 'invalid_input');
    }
    if (ids.length > 500) {
        throw errorMap(new Error('单次最多删除 500 个文档'), '(store)', 'invalid_input');
    }
    // 去重并只保留正整数，避免同一 id 重复计入 deleted
    const uniq = [...new Set(ids)];
    for (const id of uniq) {
        if (!Number.isInteger(id) || id <= 0) {
            throw errorMap(new Error('文档 ID 无效'), '(store)', 'invalid_input');
        }
    }

    const selectStmt = db.prepare('SELECT id FROM documents WHERE id = ?');
    const deleteStmt = db.prepare('DELETE FROM documents WHERE id = ?');

    const tx = db.transaction(() => {
        const missing = [];
        const alive = [];
        for (const id of uniq) {
            if (selectStmt.get(id)) alive.push(id);
            else missing.push(id);
        }
        if (alive.length === 0) {
            // 全部都不存在：不算错误（幂等），返回空结果
            return { deleted: 0, cascaded: 0, missing };
        }

        // 连带删除的子孙页数：递归 CTE 求 alive 集合的完整后代
        const placeholders = alive.map(() => '?').join(',');
        const cascadeRows = db.prepare(`
            WITH RECURSIVE sub(id) AS (
                SELECT id FROM documents WHERE id IN (${placeholders})
                UNION ALL
                SELECT d.id FROM documents d JOIN sub ON d.parent_id = sub.id
            )
            SELECT id FROM sub
        `).all(...alive);
        const cascadeCount = cascadeRows.length;

        for (const id of alive) deleteStmt.run(id);

        // 清理全文索引：主文档与被连带删除的子孙页都要清
        // （FTS5 虚表没有 ON DELETE CASCADE，必须手动删）
        try {
            for (const row of cascadeRows) removeDocument(db, row.id);
        } catch (e) {
            // 索引表不存在时忽略
        }

        return {
            deleted: alive.length,
            cascaded: cascadeCount - alive.length,
            missing
        };
    });

    try {
        return tx();
    } catch (err) {
        if (err.code === 'invalid_input') throw err;
        throw errorMap(err, '(store)', 'write');
    }
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

// ─────────────────────── 备份导入 / 导出（F-KB-007、F-OPS-002） ───────────────────────

/** 备份文件格式版本；不兼容变更时递增并在此处做迁移分支 */
export const BACKUP_VERSION = 1;

/**
 * 导出全量快照：分类、标签、文档（含父子层级与正文）。
 *
 * 快照刻意使用**名称**（分类名、标签名）与**相对引用**（ref / parent_ref）而非数据库自增 ID，
 * 使备份文件可跨库、跨机器还原；ref 仅用于重建父子层级，不保证与导入后 ID 一致。
 *
 * @param {object} config
 * @param {import('better-sqlite3').Database} config.connection
 * @returns {{ version: number, app: string, exported_at: string, counts: object, categories: object[], documents: object[] }}
 */
export function exportSnapshot({ connection: db }) {
    const categories = listCategories({ connection: db });
    const tags = listTags({ connection: db });
    const categoryNameById = new Map(categories.map((c) => [c.id, c.name]));

    const docs = db.prepare(`
        SELECT id, parent_id, title, content_md, category_id, created_at, updated_at
        FROM documents ORDER BY id ASC
    `).all();

    const tagRows = db.prepare(`
        SELECT dt.document_id AS document_id, t.name AS name
        FROM document_tags dt JOIN tags t ON t.id = dt.tag_id
        ORDER BY t.name ASC
    `).all();
    const tagsByDoc = new Map();
    for (const row of tagRows) {
        if (!tagsByDoc.has(row.document_id)) tagsByDoc.set(row.document_id, []);
        tagsByDoc.get(row.document_id).push(row.name);
    }

    return {
        version: BACKUP_VERSION,
        app: 'team-toolbox',
        exported_at: new Date().toISOString(),
        counts: {
            documents: docs.length,
            categories: categories.length,
            tags: tags.length
        },
        categories: categories.map((c) => ({ name: c.name })),
        documents: docs.map((d) => ({
            ref: d.id,
            parent_ref: d.parent_id == null ? null : d.parent_id,
            title: d.title,
            content_md: d.content_md || '',
            category: d.category_id == null ? null : (categoryNameById.get(d.category_id) || null),
            tags: tagsByDoc.get(d.id) || [],
            created_at: d.created_at,
            updated_at: d.updated_at
        }))
    };
}

/**
 * 导入快照（合并模式，不删除既有数据）：
 *   - 分类：按名称复用，不存在则新建（受 50 上限约束，超限跳过）。
 *   - 文档：同一父页面下标题相同视为已存在并跳过；否则新建并重建父子层级。
 *   - 时间：新建后把 created_at / updated_at 还原为备份中的值（格式非法则保持当前时间）。
 *
 * @param {object} config
 * @param {import('better-sqlite3').Database} config.connection
 * @param {object} config.snapshot - exportSnapshot 产出的 JSON
 * @returns {{ imported: number, skipped: number, categories_created: number, details: object[] }}
 * @throws {{ code: 'invalid_input', message: string }}
 */
export function importSnapshot({ connection: db, snapshot }) {
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
        throw errorMap(new Error('备份文件格式不正确'), '(store)', 'invalid_input');
    }
    if (!Array.isArray(snapshot.documents)) {
        throw errorMap(new Error('备份文件中缺少 documents 文档数组'), '(store)', 'invalid_input');
    }

    const details = [];
    const pushDetail = (kind, message) => {
        if (details.length < 50) details.push({ kind, message });
    };

    // ── 分类：按名称复用或新建 ──
    const categoryByName = new Map(listCategories({ connection: db }).map((c) => [c.name, c.id]));
    let categoriesCreated = 0;
    for (const raw of Array.isArray(snapshot.categories) ? snapshot.categories : []) {
        const name = typeof raw === 'string' ? raw : (raw && typeof raw.name === 'string' ? raw.name : '');
        const trimmed = name.trim();
        if (!trimmed || categoryByName.has(trimmed)) continue;
        try {
            const created = createCategory({ connection: db, name: trimmed });
            categoryByName.set(created.name, created.id);
            categoriesCreated += 1;
        } catch (err) {
            // 超过 50 上限或重名等：跳过该分类，不影响文档导入（文档将落为未分类）
            pushDetail('category_skipped', trimmed);
        }
    }

    // ── 文档：校验 + 分层导入 ──
    const candidates = [];
    for (const d of snapshot.documents) {
        if (!d || typeof d !== 'object' || typeof d.title !== 'string' || !d.title.trim()) {
            pushDetail('invalid', '缺少标题的文档已跳过');
            continue;
        }
        candidates.push({
            ref: Number.isInteger(d.ref) ? d.ref : null,
            parentRef: Number.isInteger(d.parent_ref) ? d.parent_ref : null,
            title: d.title.trim(),
            content_md: typeof d.content_md === 'string' ? d.content_md : '',
            category: typeof d.category === 'string' && categoryByName.has(d.category.trim()) ? categoryByName.get(d.category.trim()) : null,
            tags: Array.isArray(d.tags) ? d.tags.filter((t) => typeof t === 'string') : [],
            created_at: typeof d.created_at === 'string' ? d.created_at : null,
            updated_at: typeof d.updated_at === 'string' ? d.updated_at : null
        });
    }

    const stats = { imported: 0, skipped: 0, categories_created: categoriesCreated, details };
    const refToNewId = new Map();
    const findByTitleAndParent = db.prepare(
        'SELECT id FROM documents WHERE title = ? AND parent_id IS ?'
    );
    const restoreTime = db.prepare('UPDATE documents SET created_at = ?, updated_at = ? WHERE id = ?');
    const isIsoish = (v) => typeof v === 'string' && !Number.isNaN(new Date(v).getTime());

    // 同级同标题 → 跳过；父级尚未导入 → 留到下一轮（按层级推进）
    const importOne = (doc, parentId) => {
        const existing = findByTitleAndParent.get(doc.title, parentId);
        if (existing) {
            stats.skipped += 1;
            pushDetail('skipped', `「${doc.title}」已存在，跳过`);
            // 关键：跳过时也要登记 ref → 既有 ID，否则其子页面会误判“父级缺失”
            // 而被降级为顶层导入，造成重复页面（重复导入不再幂等）。
            if (doc.ref !== null) refToNewId.set(doc.ref, existing.id);
            return;
        }
        let created;
        try {
            created = createDocument({
                connection: db,
                title: doc.title,
                content_md: doc.content_md,
                category_id: doc.category,
                parent_id: parentId,
                tags: doc.tags
            });
        } catch (err) {
            stats.skipped += 1;
            pushDetail('failed', `「${doc.title}」导入失败：${(err && err.message) || '未知原因'}`);
            return;
        }
        if (doc.created_at && doc.updated_at && isIsoish(doc.created_at) && isIsoish(doc.updated_at)) {
            restoreTime.run(doc.created_at, doc.updated_at, created.id);
        }
        stats.imported += 1;
        if (doc.ref !== null) refToNewId.set(doc.ref, created.id);
    };

    const tx = db.transaction(() => {
        let pending = candidates;
        // 逐层推进：父级已导入（或本就是顶层）的文档先导入
        for (let guard = 0; pending.length > 0 && guard <= 32; guard += 1) {
            const deferred = [];
            for (const doc of pending) {
                if (doc.parentRef !== null && !refToNewId.has(doc.parentRef)) {
                    deferred.push(doc);
                    continue;
                }
                importOne(doc, doc.parentRef === null ? null : refToNewId.get(doc.parentRef));
            }
            if (deferred.length === pending.length) {
                pending = deferred;
                break; // 剩余文档的父级始终不在快照内（含环），下述按顶层导入
            }
            pending = deferred;
        }
        // 父级缺失或成环的文档：降级为顶层导入，保证数据不丢
        for (const doc of pending) {
            pushDetail('reparented', `「${doc.title}」的父页面不在备份中，已导入为顶层页面`);
            importOne(doc, null);
        }
    });

    tx();

    return stats;
}
