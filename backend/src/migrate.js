// 轻量迁移执行器：扫描 migrations/ 目录的 *.sql，按文件名 NNN_xxx.sql 升序应用；
// 每次应用记录到 schema_migrations 表；同一版本不重复应用。
// 不引入第三方迁移依赖，便于本机/内网部署与排错。

import Database from 'better-sqlite3';
import { readFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolvePath(__dirname, 'migrations');

// 默认 DB_PATH 与运行目录相关；可通过环境变量覆盖
const DB_PATH = process.env.DB_PATH || resolvePath(__dirname, '..', '..', 'data', 'team-toolbox.sqlite3');

// 确保 data 目录存在
const dbDir = dirname(DB_PATH);
if (!existsSync(dbDir)) {
    mkdirSync(dbDir, { recursive: true });
}

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// 确保 schema_migrations 表存在
db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
        version     INTEGER PRIMARY KEY,
        applied_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    );
`);

const files = readdirSync(MIGRATIONS_DIR)
    .filter((name) => /^\d+_.*\.sql$/.test(name))
    .sort();

const getAppliedVersion = db.prepare('SELECT MAX(version) AS v FROM schema_migrations');
const insertVersion = db.prepare('INSERT INTO schema_migrations (version) VALUES (?)');

let applied = 0;
for (const file of files) {
    const versionMatch = file.match(/^(\d+)_/);
    if (!versionMatch) continue;
    const version = Number(versionMatch[1]);

    const { v: currentMax } = getAppliedVersion.get() ?? { v: 0 };
    if (version <= currentMax) continue;

    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    const tx = db.transaction(() => {
        db.exec(sql);
        insertVersion.run(version);
    });
    tx();
    applied += 1;
    console.log(`[migrate] applied ${file}`);
}

console.log(`[migrate] done. db=${DB_PATH} applied_in_this_run=${applied}`);
db.close();