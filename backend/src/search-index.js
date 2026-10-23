// 全文检索的分词与 FTS5 索引维护。
//
// ── 为什么需要自己分词 ──
//
// SQLite 内置三种分词器，对中文都不够用：
//
//   unicode61  把连续的 CJK 字符当成**一个 token**。
//              「部署指南」是一个 token，搜「部署」命中不了 —— 而这恰恰是
//              用户最常见的搜法。
//
//   trigram    支持子串匹配，但**最短 3 个字符**。
//              搜「部署」（2 字）无结果，中文双字词太常见了。
//
//   ascii      只处理 ASCII，对中文完全无效。
//
// 结论：中文子串搜索无法靠内置分词器实现，必须自己切。
//
// ── 分词策略：中文 bigram + 英文整词 ──
//
//   「部署指南」  → 部署 署指 指南
//   「digital transform」 → digital transform
//
// CJK 连续段切 2-gram（单字则保留单字），ASCII 字母数字按词保留并转小写。
// 这样：
//   - 中文能子串匹配：搜「部署」「指南」「转换」都能命中
//   - 英文能整词匹配：搜「git」命中「Git 工作流」，搜「digital」
//     **不会**命中「digital transform」的 transform（词边界完整）
//
// 若用纯 bigram 切英文，「git」会被切成「gi it」，搜「git」反而不命中 ——
// 中英混排必须分开处理。
//
// ── 为什么索引在应用层维护，而不是用触发器 ──
//
// FTS5 的自定义 tokenizer 需要 C 扩展（better-sqlite3 不支持
// 「no such tokenizer」），所以无法让 SQLite 自己在触发器里切词。
// 只能由应用层在写文档时同步索引表。
//
// 代价：索引可能与主表不同步（比如直接改库）。缓解：
//   1. 所有文档写路径都经过 store.js 的 create/update/delete，集中在一处
//   2. 提供 reindexAll() 供全量重建
//   3. 启动时若检测到索引行数与文档数不符，自动重建（见 ensureIndex）

import { errorMap } from './errors.js';

/** FTS5 虚表名。 */
export const FTS_TABLE = 'documents_fts';

/** 索引表与其主表的行 id 对应列。 */
const ID_COL = 'doc_id';

/** 判断是否 CJK 字符（含扩展 A 与兼容区）。 */
function isCjk(ch) {
    const c = ch.codePointAt(0);
    return (c >= 0x4e00 && c <= 0x9fff)        // 基本汉字
        || (c >= 0x3400 && c <= 0x4dbf)        // 扩展 A
        || (c >= 0xf900 && c <= 0xfaff)        // 兼容汉字
        || (c >= 0x3040 && c <= 0x30ff)        // 日文假名
        || (c >= 0xac00 && c <= 0xd7af);       // 韩文
}

/**
 * 把文本切成检索 token。
 *
 * @param {string} text
 * @returns {string[]} token 数组（已转小写）
 */
export function tokenize(text) {
    const s = String(text || '');
    if (!s) return [];

    const tokens = [];
    let word = '';        // 当前 ASCII 词
    let cjk = [];         // 当前 CJK 连续段

    const flushWord = () => {
        if (word) { tokens.push(word.toLowerCase()); word = ''; }
    };
    const flushCjk = () => {
        if (!cjk.length) return;
        if (cjk.length === 1) {
            // 单字 CJK（如「猫」）只能整体保留，没有 bigram
            tokens.push(cjk[0]);
        } else {
            for (let i = 0; i < cjk.length - 1; i++) {
                tokens.push(cjk[i] + cjk[i + 1]);
            }
        }
        cjk = [];
    };

    for (const ch of s) {
        if (isCjk(ch)) {
            flushWord();
            cjk.push(ch);
        } else if (/[a-zA-Z0-9_]/.test(ch)) {
            flushCjk();
            word += ch;
        } else {
            // 标点与空白是天然的词边界
            flushCjk();
            flushWord();
        }
    }
    flushCjk();
    flushWord();

    return tokens;
}

/**
 * 把文本转成可直接写入 FTS 表的字符串（空格分隔的 token）。
 *
 * @param {string} text
 * @returns {string}
 */
export function indexText(text) {
    return tokenize(text).join(' ');
}

/**
 * 建 FTS 表（若不存在）。
 *
 * 用 content='' 的「独立内容表」模式：FTS 表自己存 token，
 * 不依赖主表的内容列 —— 因为存进去的是**分词后的 token**，
 * 不是原文。主表删改时由应用层同步 FTS 行。
 *
 * @param {import('better-sqlite3').Database} db
 */
export function ensureIndex(db) {
    db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS ${FTS_TABLE} USING fts5(
            ${ID_COL} UNINDEXED,
            tokens,
            tokenize = 'unicode61'
        );
    `);
}

/**
 * 写入或更新某文档的索引。
 *
 * @param {import('better-sqlite3').Database} db
 * @param {number} id
 * @param {string} title
 * @param {string} contentMd
 */
export function indexDocument(db, id, title, contentMd) {
    ensureIndex(db);
    // 标题权重更高：把标题的 token 重复 3 次，BM25 打分时权重更大
    const t = indexText(title);
    const c = indexText(contentMd);
    const combined = [t, t, t, c].filter(Boolean).join(' ');
    db.prepare(`INSERT INTO ${FTS_TABLE} (${ID_COL}, tokens) VALUES (?, ?)`)
        .run(id, combined);
    db.prepare(`DELETE FROM ${FTS_TABLE} WHERE ${ID_COL} = ? AND rowid != (
        SELECT rowid FROM ${FTS_TABLE} WHERE ${ID_COL} = ? ORDER BY rowid DESC LIMIT 1
    )`).run(id, id);
}

/**
 * 删除某文档的索引。
 *
 * @param {import('better-sqlite3').Database} db
 * @param {number} id
 */
export function removeDocument(db, id) {
    try {
        db.prepare(`DELETE FROM ${FTS_TABLE} WHERE ${ID_COL} = ?`).run(id);
    } catch (e) {
        // 索引表还不存在（首次迁移前）→ 无需删除
    }
}

/**
 * 全量重建索引。
 *
 * @param {import('better-sqlite3').Database} db
 * @returns {number} 索引的文档数
 */
export function reindexAll(db) {
    ensureIndex(db);
    db.exec(`DELETE FROM ${FTS_TABLE}`);
    const rows = db.prepare('SELECT id, title, content_md FROM documents').all();
    const ins = db.prepare(`INSERT INTO ${FTS_TABLE} (${ID_COL}, tokens) VALUES (?, ?)`);
    for (const r of rows) {
        const t = indexText(r.title);
        const c = indexText(r.content_md);
        ins.run(r.id, [t, t, t, c].filter(Boolean).join(' '));
    }
    return rows.length;
}

/**
 * 检查索引是否与主表同步；不同步则重建。
 *
 * 在服务启动时调用（见 index.js）。防止直接改库或异常中断导致的索引漂移。
 *
 * @param {import('better-sqlite3').Database} db
 * @returns {{ ok: boolean, indexed: number, documents: number, rebuilt: boolean }}
 */
export function ensureIndexSynced(db) {
    ensureIndex(db);
    const documents = db.prepare('SELECT COUNT(*) n FROM documents').get().n;
    const indexed = db.prepare(`SELECT COUNT(DISTINCT ${ID_COL}) n FROM ${FTS_TABLE}`).get().n;
    if (documents === indexed) {
        return { ok: true, indexed, documents, rebuilt: false };
    }
    const n = reindexAll(db);
    return { ok: true, indexed: n, documents, rebuilt: true };
}

/**
 * 把用户输入的关键词转成 FTS5 的 MATCH 表达式。
 *
 * 注意：FTS5 的 MATCH 语法里 + - * " ( ) : ^ 等是**运算符**，
 * 直接把用户输入塞进去会抛语法错误或产生意外结果。
 * 这里逐个 token 加引号并转义内部引号，等价于「按短语匹配」。
 *
 * @param {string} keyword
 * @returns {string|null} MATCH 表达式；无有效 token 时返回 null
 */
export function buildMatchExpr(keyword) {
    const tokens = tokenize(keyword);
    if (!tokens.length) return null;
    // 双引号包裹可让 FTS5 当作短语；内部双引号用 "" 转义
    return tokens.map((t) => `"${t.replace(/"/g, '""')}"`).join(' AND ');
}

/**
 * 判断 FTS5 是否可用（部分 SQLite 构建不含 FTS5）。
 *
 * @param {import('better-sqlite3').Database} db
 * @returns {boolean}
 */
export function isFtsAvailable(db) {
    try {
        ensureIndex(db);
        return true;
    } catch (e) {
        return false;
    }
}
