// SQLite 连接单例：根据环境变量或默认路径打开数据库，
// 启用 WAL 与外键约束。业务层（TASK-002 起）通过此模块获取连接。

import Database from 'better-sqlite3';
import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, mkdirSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

const DEFAULT_DB_PATH = resolvePath(__dirname, '..', '..', 'data', 'team-toolbox.sqlite3');
const DB_PATH = process.env.DB_PATH || DEFAULT_DB_PATH;

// 确保父目录存在
const dbDir = dirname(DB_PATH);
if (!existsSync(dbDir)) {
    mkdirSync(dbDir, { recursive: true });
}

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export { db, DB_PATH };