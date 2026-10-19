// SQLite 连接工厂：每次调用返回新连接，支持注入配置用于测试隔离。
// 启用 WAL、外键约束、有限 busy timeout；错误映射不泄露绝对路径。
//
// 使用方式：
//   import { createDatabase, createTestingDatabase } from './db.js';
//   const db = createDatabase({ path: 'data/team-toolbox.sqlite3' });
//   const testDb = createTestingDatabase({ memory: true });
//
// 业务层通过此模块获取连接，不再直接 import Database。

import Database from 'better-sqlite3';
import { dirname, resolve as resolvePath, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { errorMap } from './errors.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolvePath(__dirname, '..', '..');

// DB_PATH 支持相对路径（相对于项目根目录）或绝对路径。
const DB_PATH_RAW = process.env.DB_PATH || 'data/team-toolbox.sqlite3';
const DB_PATH = resolvePath(PROJECT_ROOT, DB_PATH_RAW);

/**
 * 创建 SQLite 连接（每次调用返回新连接）。
 *
 * @param {object} [config]
 * @param {string} [config.path] - 数据库路径，相对于项目根目录或绝对路径。
 * @param {string} [config.timeout=5000] - busy timeout 毫秒数，默认 5000ms。
 * @param {boolean} [config.wal=true] - 是否启用 WAL 模式。
 * @param {boolean} [config.foreignKeys=true] - 是否启用外键约束。
 * @returns {Database.Database}
 */
export function createDatabase(config = {}) {
    const {
        path = 'data/team-toolbox.sqlite3',
        timeout = 5000,
        wal = true,
        foreignKeys = true
    } = config;

    const absPath = resolvePath(PROJECT_ROOT, path);
    const dbDir = dirname(absPath);

    // 确保父目录存在
    if (!existsSync(dbDir)) {
        try {
            mkdirSync(dbDir, { recursive: true });
        } catch (err) {
            throw errorMap(err, absPath, 'cannot_open');
        }
    }

    let db;
    try {
        db = new Database(absPath);
    } catch (err) {
        throw errorMap(err, absPath, 'cannot_open');
    }

    // 启用 WAL
    if (wal) {
        db.pragma('journal_mode = WAL');
    }

    // 启用外键
    if (foreignKeys) {
        db.pragma('foreign_keys = ON');
    }

    // 设置 busy timeout（毫秒）
    db.pragma(`busy_timeout = ${Number(timeout)}`);

    return db;
}

/**
 * 创建测试用内存数据库（:memory: 或临时文件）。
 * 适用于 node:test 隔离测试。
 *
 * @param {object} [config]
 * @param {boolean} [config.memory=false] - true 则用 :memory:，false 则用临时文件。
 * @param {string} [config.timeout=5000] - busy timeout 毫秒数。
 * @returns {Database.Database}
 */
export function createTestingDatabase(config = {}) {
    const { memory = false, timeout = 5000, path: explicitPath = null } = config;

    let db;
    let dbPath;
    if (memory) {
        try {
            db = new Database(':memory:');
            dbPath = ':memory:';
        } catch (err) {
            throw errorMap(err, ':memory:', 'cannot_open');
        }
    } else {
        // 临时文件，进程结束后自动清理
        // 允许传入 path 以便测试复用同一文件
        const tmpPath = explicitPath || join(tmpdir(), `team-toolbox-test-${randomUUID()}.sqlite3`);
        try {
            db = new Database(tmpPath);
            dbPath = tmpPath;
        } catch (err) {
            throw errorMap(err, tmpPath, 'cannot_open');
        }
    }

    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.pragma(`busy_timeout = ${Number(timeout)}`);

    return db;
}

// 保留向后兼容：默认单例连接（供 index.js 的 /api/health 使用）
// 新代码应使用 createDatabase() 显式获取连接。
let _defaultDb = null;
export function getDefaultDatabase() {
    if (!_defaultDb) {
        _defaultDb = createDatabase();
    }
    return _defaultDb;
}

// 关闭默认连接（供 server shutdown 使用）
export function closeDefaultDatabase() {
    if (_defaultDb) {
        try {
            _defaultDb.close();
        } catch (_) { /* ignore */ }
        _defaultDb = null;
    }
}

export { PROJECT_ROOT, DB_PATH };
