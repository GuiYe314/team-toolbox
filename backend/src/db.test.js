// db.js 的路径解析与默认连接测试。
//
// 本文件的存在源于一个真实 bug：
//   getDefaultDatabase() 调 createDatabase() 时**没有传 path**，
//   而 createDatabase() 的默认参数是硬编码的 'data/team-toolbox.sqlite3'，
//   **不读环境变量**。于是 DB_PATH / DB_PATH_RAW 环境变量完全失效：
//   日志打印的是环境变量指定的路径，实际打开的却是项目默认库。
//
// 表现极具迷惑性：日志说「db path: <临时库>」，但临时库文件根本没被创建，
// 而项目库里表又齐全 —— 「迁移没执行、表却都在」完全对不上账。
//
// 发布包验证时正是靠这个测试钉住了行为。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, rmSync } from 'node:fs';
import { join, resolve as resolvePath, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolvePath(__dirname, '..', '..');

// 通过 file:// URL 动态导入 —— Windows 上直接 import('D:/...') 会报
// ERR_UNSUPPORTED_ESM_URL_SCHEME。
async function loadDbModule(env) {
    const saved = {};
    for (const [k, v] of Object.entries(env || {})) {
        saved[k] = process.env[k];
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
    }
    // 加时间戳，保证每次拿到新模块实例（ESM 模块有缓存）
    const url = pathToFileURL(join(__dirname, 'db.js')).href + `?t=${Date.now()}${Math.random()}`;
    const mod = await import(url);
    return {
        mod,
        restore() {
            for (const [k, v] of Object.entries(saved)) {
                if (v === undefined) delete process.env[k];
                else process.env[k] = v;
            }
        }
    };
}

describe('db.js 路径解析', () => {
    test('DB_PATH 环境变量指定绝对路径时，默认连接必须真的打开该文件', async () => {
        const tmpDb = join(PROJECT_ROOT, 'data', 'test-dbpath-check.sqlite3');
        for (const suffix of ['', '-shm', '-wal']) {
            const f = tmpDb + suffix;
            if (existsSync(f)) rmSync(f, { force: true });
        }

        const { mod, restore } = await loadDbModule({ DB_PATH: tmpDb });
        try {
            assert.equal(mod.DB_PATH, tmpDb, 'DB_PATH 常量应等于环境变量指定值');

            const db = mod.getDefaultDatabase();
            assert.equal(db.name, tmpDb, '默认连接必须打开环境变量指定的库，而不是项目默认库');

            assert.ok(existsSync(tmpDb), '数据库文件应被创建在指定路径');
            mod.closeDefaultDatabase();
        } finally {
            restore();
            for (const suffix of ['', '-shm', '-wal']) {
                const f = tmpDb + suffix;
                if (existsSync(f)) rmSync(f, { force: true });
            }
        }
    });

    test('未设置 DB_PATH 时默认打开项目内 data/ 目录', async () => {
        const { mod, restore } = await loadDbModule({ DB_PATH: undefined });
        try {
            const expected = resolvePath(PROJECT_ROOT, 'data', 'team-toolbox.sqlite3');
            assert.equal(mod.DB_PATH, expected);
            const db = mod.getDefaultDatabase();
            assert.equal(db.name, expected);
            mod.closeDefaultDatabase();
        } finally {
            restore();
        }
    });

    test('相对路径按项目根解析', async () => {
        const { mod, restore } = await loadDbModule({ DB_PATH: 'data/rel-check.sqlite3' });
        try {
            assert.equal(mod.DB_PATH, resolvePath(PROJECT_ROOT, 'data', 'rel-check.sqlite3'));
            mod.closeDefaultDatabase();
        } finally {
            restore();
        }
    });
});
