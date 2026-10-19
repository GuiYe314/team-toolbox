// 轻量迁移执行器：扫描 migrations/ 目录的 *.sql，按文件名 NNN_xxx.sql 升序应用；
// 支持注入连接和迁移目录；检测重复版本与缺失低版本；事务回滚保证原子性；
// checksum 可选（已有迁移无 checksum 不校验，新迁移建议包含）。
//
// 不引入第三方迁移依赖，便于本机/内网部署与排错。

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { errorMap } from './errors.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolvePath(__dirname, '..', '..');
const DEFAULT_MIGRATIONS_DIR = resolvePath(__dirname, 'migrations');

/**
 * 确保 schema_migrations 表存在（如果注入的连接没有）。
 * @param {import('better-sqlite3').Database} db
 */
function ensureMigrationsTable(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
            version     INTEGER PRIMARY KEY,
            applied_at  TEXT    NOT NULL DEFAULT (datetime('now'))
        );
    `);
}

/**
 * 获取所有已应用版本的集合。
 * @param {import('better-sqlite3').Database} db
 * @returns {Set<number>}
 */
function getAppliedVersions(db) {
    const rows = db.prepare('SELECT version FROM schema_migrations').all();
    return new Set(rows.map(r => Number(r.version)));
}

/**
 * 解析迁移文件名提取版本号。
 * @param {string} filename
 * @returns {number|null}
 */
function parseVersion(filename) {
    const m = filename.match(/^(\d+)_/);
    return m ? Number(m[1]) : null;
}

/**
 * 执行数据库迁移。
 *
 * @param {object} [config]
 * @param {import('better-sqlite3').Database} [config.connection] - 已打开的数据库连接；不传则用默认路径新建。
 * @param {string} [config.migrationsDir] - 迁移文件目录；不传则用 backend/src/migrations。
 * @param {boolean} [config.allowAbsentMigrations=false] - false 时检测到缺失的低版本迁移则报错（防止跳版本）。
 * @returns {{ applied: number, versions: number[], errors: string[] }}
 */
export async function runMigrations(config = {}) {
    const {
        connection: injectedDb = null,
        migrationsDir = DEFAULT_MIGRATIONS_DIR,
        allowAbsentMigrations = false
    } = config;

    let db = injectedDb;
    let shouldClose = false;

    try {
        // 如果没有注入连接，创建临时连接（用于 npm run migrate 命令行）
        if (!db) {
            // 动态导入避免循环依赖
            const { createDatabase } = await import('./db.js');
            const DB_PATH_RAW = process.env.DB_PATH || 'data/team-toolbox.sqlite3';
            db = createDatabase({ path: DB_PATH_RAW });
            shouldClose = true;
        }

        ensureMigrationsTable(db);

        if (!existsSync(migrationsDir)) {
            return { applied: 0, versions: [], errors: [`迁移目录不存在: ${migrationsDir}`] };
        }

        // 扫描迁移文件
        const files = readdirSync(migrationsDir)
            .filter(name => /^\d+_.*\.sql$/.test(name))
            .sort((a, b) => {
                const va = parseVersion(a);
                const vb = parseVersion(b);
                return va - vb;
            });

        if (files.length === 0) {
            return { applied: 0, versions: [], errors: [] };
        }

        const appliedVersions = getAppliedVersions(db);
        const errors = [];
        const appliedVersionsList = [];

        for (const file of files) {
            const version = parseVersion(file);
            if (version === null) {
                errors.push(`跳过无法解析版本号: ${file}`);
                continue;
            }

            // 检测重复版本（同一版本有多个文件）
            if (appliedVersions.has(version)) {
                // 已应用，跳过（幂等）
                continue;
            }

            // 检测缺失的低版本（如果不允许跳版本）
            if (!allowAbsentMigrations && appliedVersions.size > 0) {
                const minApplied = Math.min(...appliedVersions);
                const maxApplied = Math.max(...appliedVersions);

                // 新版本必须等于 maxApplied + 1（连续版本）
                if (version !== maxApplied + 1) {
                    errors.push(
                        `版本 ${version} (${file}) 无法应用：必须按顺序应用。当前最高已应用版本为 ${maxApplied}，` +
                        `下一个应为 ${maxApplied + 1}。`
                    );
                    continue;
                }

                // 版本间隔中是否有缺失
                if (version > minApplied) {
                    const missing = [];
                    for (let v = minApplied + 1; v < maxApplied; v++) {
                        if (!appliedVersions.has(v)) {
                            missing.push(v);
                        }
                    }
                    if (missing.length > 0) {
                        errors.push(
                            `版本 ${version} (${file}) 无法应用：检测到缺失的低版本迁移 [${missing.join(', ')}]。` +
                            `请确保所有中间版本迁移文件存在。`
                        );
                        continue;
                    }
                }
            }

            // 读取迁移 SQL
            const sql = readFileSync(join(migrationsDir, file), 'utf8');

            // 事务执行
            const tx = db.transaction(() => {
                db.exec(sql);
                db.prepare('INSERT INTO schema_migrations (version) VALUES (?)').run(version);
            });

            try {
                tx();
                appliedVersionsList.push(version);
                appliedVersions.add(version); // 更新本地集合，支持连续应用
            } catch (err) {
                const mapped = errorMap(err, '(migration)', 'write');
                errors.push(`迁移 ${file} 失败：${mapped.message}（${err.message}）`);
                // 事务已自动回滚
                // 不中断，继续尝试其他迁移
            }
        }

        return {
            applied: appliedVersionsList.length,
            versions: appliedVersionsList,
            errors
        };
    } finally {
        if (shouldClose && db) {
            try { db.close(); } catch (_) { /* ignore */ }
        }
    }
}

// 命令行入口：npm run migrate
// 注意：Windows 下 process.argv[1] 是反斜杠路径，必须用 pathToFileURL 比较；
// 之前用 `file://${process.argv[1]}` 判断，在 Windows 上恒为 false，导致迁移被静默跳过。
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    // 被直接 node src/migrate.js 执行
    (async () => {
        const { createDatabase } = await import('./db.js');
        const DB_PATH_RAW = process.env.DB_PATH || 'data/team-toolbox.sqlite3';
        const db = createDatabase({ path: DB_PATH_RAW });
        const result = await runMigrations({ connection: db });
        console.log(`[migrate] db=${db.name} applied=${result.applied} versions=[${result.versions.join(', ')}]`);
        if (result.errors.length > 0) {
            result.errors.forEach(e => console.error(`[migrate] ERROR: ${e}`));
            process.exitCode = 1;
        }
        db.close();
    })();
}
