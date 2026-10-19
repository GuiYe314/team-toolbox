// SQLite 错误映射：将内部错误码映射为业务错误，不泄露绝对路径。
// 错误码：cannot_open / busy_lock / constraint_failed / not_found / invalid_input / unknown

/**
 * @typedef {object} AppError
 * @property {string} code - 业务错误码
 * @property {string} message - 对外可见的错误信息
 * @property {string} [detail] - 内部调试信息（仅在非生产环境可用）
 */

/**
 * 将 SQLite/Node.js 错误映射为业务错误。
 * 绝对路径不泄露到普通 API 响应中。
 *
 * @param {Error} err - 原始错误
 * @param {string} dbPath - 数据库路径（用于错误诊断，不对外暴露）
 * @param {string} [context] - 上下文：'cannot_open' | 'busy_lock' | 'read' | 'write'
 * @returns {AppError}
 */
export function errorMap(err, dbPath, context = 'unknown') {
    const msg = String(err && err.message || err);
    const code = String(err && err.code || 'SQLITE_ERROR');

    // cannot_open：路径不存在、权限问题、目录不存在
    if (context === 'cannot_open' || code === 'SQLITE_CANTOPEN' || code === 'SQLITE_READONLY') {
        const e = new Error('无法打开数据库，请检查配置');
        e.code = 'cannot_open';
        if (process.env.NODE_ENV !== 'production') e.detail = `[${context}] ${msg}`;
        return e;
    }

    // busy_lock：数据库忙（另一连接持有写锁）
    if (code === 'SQLITE_BUSY' || code === 'SQLITE_LOCKED') {
        const e = new Error('数据库忙，请稍后重试');
        e.code = 'busy_lock';
        if (process.env.NODE_ENV !== 'production') e.detail = `[${context}] ${msg}`;
        return e;
    }

    // 约束失败：外键/唯一/CHECK 失败（better-sqlite3 使用 SQLITE_CONSTRAINT_* 细分码）
    if (context === 'constraint_failed' ||
        code === 'SQLITE_CONSTRAINT' || code.startsWith('SQLITE_CONSTRAINT_')) {
        const e = new Error(msg);
        e.code = 'constraint_failed';
        if (process.env.NODE_ENV !== 'production') e.detail = `[${context}] ${msg}`;
        return e;
    }

    // 业务层主动抛出的 conflict（版本冲突）：保留原始消息
    if (code === 'conflict' || context === 'conflict') {
        const e = new Error(msg);
        e.code = 'conflict';
        if (process.env.NODE_ENV !== 'production') e.detail = `[${context}] ${msg}`;
        return e;
    }

    // 找不到记录：context 或 code 触发；保留业务层传入的具体消息
    if (code === 'SQLITE_NOTFOUND' || context === 'not_found') {
        const e = new Error(msg);
        e.code = 'not_found';
        if (process.env.NODE_ENV !== 'production') e.detail = `[${context}] ${msg}`;
        return e;
    }

    // 输入验证失败（由业务层抛出）：保留原始消息
    if (context === 'invalid_input') {
        const e = new Error(msg);
        e.code = 'invalid_input';
        if (process.env.NODE_ENV !== 'production') e.detail = `[${context}] ${msg}`;
        return e;
    }

    // 未知错误
    const e = new Error('操作失败，请稍后重试');
    e.code = 'unknown';
    if (process.env.NODE_ENV !== 'production') e.detail = `[${context}] ${msg}`;
    return e;
}

/**
 * 抛出映射后的错误（用于在 async/await 路径使用）。
 * @param {Error} err
 * @param {string} dbPath
 * @param {string} [context]
 * @throws {AppError}
 */
export function throwError(err, dbPath, context) {
    const mapped = errorMap(err, dbPath, context);
    const e = new Error(mapped.message);
    e.code = mapped.code;
    e.detail = mapped.detail;
    throw e;
}
