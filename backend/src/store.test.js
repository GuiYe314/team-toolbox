// TASK-002 测试：SQLite 连接工厂、迁移、存储层
// 使用 node:test，测试数据库全部用临时目录或 :memory:。

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─────────────────────────────────────────────────
// 测试夹具
// ─────────────────────────────────────────────────

/** 在临时目录创建 migrations 子目录。 */
function mkMigrationsDir(parent) {
    const m = join(parent, 'migrations');
    mkdirSync(m, { recursive: true });
    return m;
}

/** 写入迁移文件。 */
function writeMigration(dir, version, sql) {
    writeFileSync(join(dir, `${version}_test.sql`), sql, 'utf8');
}

/** 创建测试数据库连接（临时文件）。 */
async function createTestDb(tmpDir) {
    const { createTestingDatabase } = await import('./db.js');
    return createTestingDatabase({ memory: false });
}

// ─────────────────────────────────────────────────
// 001_init.sql 模板（用于创建测试迁移）
// ─────────────────────────────────────────────────

const INIT_SQL = `
CREATE TABLE IF NOT EXISTS categories (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL UNIQUE,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tags (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL UNIQUE,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS documents (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    title        TEXT    NOT NULL,
    content_md   TEXT    NOT NULL DEFAULT '',
    category_id  INTEGER,
    parent_id    INTEGER,
    version      INTEGER NOT NULL DEFAULT 1,
    created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at   TEXT    NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL,
    FOREIGN KEY (parent_id)   REFERENCES documents(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_documents_updated_at ON documents(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_documents_category_id ON documents(category_id);
CREATE INDEX IF NOT EXISTS idx_documents_parent_id ON documents(parent_id);

CREATE TABLE IF NOT EXISTS document_tags (
    document_id  INTEGER NOT NULL,
    tag_id       INTEGER NOT NULL,
    PRIMARY KEY (document_id, tag_id),
    FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
    FOREIGN KEY (tag_id)      REFERENCES tags(id)      ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_document_tags_tag_id ON document_tags(tag_id);

CREATE TABLE IF NOT EXISTS schema_migrations (
    version     INTEGER PRIMARY KEY,
    applied_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
`;

// ─────────────────────────────────────────────────
// 测试：SQLite 连接工厂
// ─────────────────────────────────────────────────

describe('SQLite 连接工厂', () => {

    it('createTestingDatabase 使用临时文件，写入后重开可读', async () => {
        const { createTestingDatabase } = await import('./db.js');
        const { join: pjoin } = await import('node:path');
        const { tmpdir: ptmp } = await import('node:os');
        const { randomUUID: prand } = await import('node:crypto');
        // 复用同一临时路径以验证持久化
        const tmpPath = pjoin(ptmp(), `tt-reopen-${prand()}.sqlite3`);
        const db = createTestingDatabase({ memory: false, timeout: 3000, path: tmpPath });
        assert.ok(db, '应返回数据库连接');
        assert.strictEqual(db.open, true, '数据库应处于打开状态');

        db.prepare('CREATE TABLE t (id INTEGER PRIMARY KEY)').run();
        db.prepare('INSERT INTO t VALUES (1)').run();
        db.close();

        const db2 = createTestingDatabase({ memory: false, timeout: 3000, path: tmpPath });
        const row = db2.prepare('SELECT * FROM t').get();
        assert.strictEqual(row.id, 1, '重新打开后数据应可读');
        db2.close();
    });

    it('createTestingDatabase 使用 :memory:', async () => {
        const { createTestingDatabase } = await import('./db.js');
        const db = createTestingDatabase({ memory: true });
        assert.ok(db, '应返回内存数据库连接');
        db.prepare('CREATE TABLE t (id INTEGER PRIMARY KEY)').run();
        db.prepare('INSERT INTO t VALUES (42)').run();
        const row = db.prepare('SELECT * FROM t').get();
        assert.strictEqual(row.id, 42, ':memory: 数据应可读');
        db.close();
    });

    it('WAL 和外键默认启用', async () => {
        const { createTestingDatabase } = await import('./db.js');
        const { join: pjoin } = await import('node:path');
        const { tmpdir: ptmp } = await import('node:os');
        const { randomUUID: prand } = await import('node:crypto');
        // WAL 不能用于 :memory:，需要文件
        const tmpPath = pjoin(ptmp(), `tt-wal-${prand()}.sqlite3`);
        const db = createTestingDatabase({ memory: false, path: tmpPath });
        const wal = db.pragma('journal_mode', { simple: true });
        const fk = db.pragma('foreign_keys', { simple: true });
        assert.strictEqual(wal, 'wal', 'WAL 模式应默认启用');
        assert.strictEqual(fk, 1, '外键约束应默认启用');
        db.close();
    });

    it('busy timeout 可配置', async () => {
        const { createTestingDatabase } = await import('./db.js');
        const db = createTestingDatabase({ memory: true, timeout: 3000 });
        const bt = db.pragma('busy_timeout', { simple: true });
        assert.strictEqual(bt, 3000, 'busy_timeout 应为配置值');
        db.close();
    });

    it('getDefaultDatabase 返回单例', async () => {
        const { getDefaultDatabase, closeDefaultDatabase } = await import('./db.js');
        const db1 = getDefaultDatabase();
        const db2 = getDefaultDatabase();
        assert.strictEqual(db1, db2, '应返回同一单例');
        closeDefaultDatabase();
    });
});

// ─────────────────────────────────────────────────
// 测试：迁移系统
// ─────────────────────────────────────────────────

describe('迁移系统', () => {

    it('迁移幂等：同一迁移文件多次应用只执行一次', async () => {
        const { runMigrations } = await import('./migrate.js');
        const { createTestingDatabase } = await import('./db.js');

        const tmpDir = join(tmpdir(), `tt-mig-${randomUUID()}`);
        mkdirSync(tmpDir, { recursive: true });
        const mDir = mkMigrationsDir(tmpDir);
        writeMigration(mDir, 1, INIT_SQL);

        const db = createTestingDatabase({ memory: false });

        const r1 = await runMigrations({ connection: db, migrationsDir: mDir });
        assert.strictEqual(r1.applied, 1, '首次应应用 1 个迁移');
        assert.deepStrictEqual(r1.versions, [1]);

        const r2 = await runMigrations({ connection: db, migrationsDir: mDir });
        assert.strictEqual(r2.applied, 0, '第二次应幂等返回 0');
        assert.deepStrictEqual(r2.versions, []);

        db.close();
        rmSync(tmpDir, { recursive: true, force: true });
    });

    it('事务回滚：迁移文件出错时已应用迁移不残留', async () => {
        const { runMigrations } = await import('./migrate.js');
        const { createTestingDatabase } = await import('./db.js');

        const tmpDir = join(tmpdir(), `tt-mig-rollback-${randomUUID()}`);
        mkdirSync(tmpDir, { recursive: true });
        const mDir = mkMigrationsDir(tmpDir);
        writeMigration(mDir, 1, INIT_SQL);

        const db = createTestingDatabase({ memory: false });
        await runMigrations({ connection: db, migrationsDir: mDir });

        // 第二个迁移文件有错误
        writeMigration(mDir, 2, 'INVALID SQL SYNTAX HERE;');

        const r = await runMigrations({ connection: db, migrationsDir: mDir });
        assert.ok(r.errors.length > 0, '应记录错误');
        assert.strictEqual(r.applied, 0, '错误的迁移不应被计入已应用');

        // 版本 1 的数据仍在（事务回滚）
        const docs = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='categories'").get();
        assert.ok(docs, '已有表仍存在（事务回滚生效）');

        db.close();
        rmSync(tmpDir, { recursive: true, force: true });
    });

    it('缺失低版本迁移报错（不跳过版本）', async () => {
        const { runMigrations } = await import('./migrate.js');
        const { createTestingDatabase } = await import('./db.js');

        const tmpDir = join(tmpdir(), `tt-mig-skip-${randomUUID()}`);
        mkdirSync(tmpDir, { recursive: true });
        const mDir = mkMigrationsDir(tmpDir);
        writeMigration(mDir, 1, INIT_SQL);
        writeMigration(mDir, 2, 'CREATE TABLE t2 (id INTEGER PRIMARY KEY);');
        writeMigration(mDir, 4, 'CREATE TABLE t4 (id INTEGER PRIMARY KEY);'); // 跳过 3

        const db = createTestingDatabase({ memory: false });

        const r = await runMigrations({ connection: db, migrationsDir: mDir });
        assert.ok(r.errors.some(e => e.includes('缺失') || e.includes('下一个应为')), '应报告缺失版本错误');
        assert.strictEqual(r.applied, 2, '应只应用 1 和 2');

        db.close();
        rmSync(tmpDir, { recursive: true, force: true });
    });

    it('重复版本迁移被检测并跳过', async () => {
        const { runMigrations } = await import('./migrate.js');
        const { createTestingDatabase } = await import('./db.js');

        const tmpDir = join(tmpdir(), `tt-mig-dup-${randomUUID()}`);
        mkdirSync(tmpDir, { recursive: true });
        const mDir = mkMigrationsDir(tmpDir);
        writeMigration(mDir, 1, INIT_SQL);
        // 写入同名文件会覆盖，用另一个版本号模拟重复
        const db = createTestingDatabase({ memory: false });

        // 同一版本两个文件
        writeFileSync(join(mDir, '1_first.sql'), INIT_SQL, 'utf8');
        writeFileSync(join(mDir, '1_second.sql'), 'CREATE TABLE IF NOT EXISTS dup (id INTEGER PRIMARY KEY);', 'utf8');

        const r = await runMigrations({ connection: db, migrationsDir: mDir });
        assert.strictEqual(r.applied, 1, '同一版本只应应用一次（第一个文件）');

        db.close();
        rmSync(tmpDir, { recursive: true, force: true });
    });

    it('迁移版本按整数升序排列', async () => {
        const { runMigrations } = await import('./migrate.js');
        const { createTestingDatabase } = await import('./db.js');

        const tmpDir = join(tmpdir(), `tt-mig-sort-${randomUUID()}`);
        mkdirSync(tmpDir, { recursive: true });
        const mDir = mkMigrationsDir(tmpDir);
        writeMigration(mDir, 3, 'CREATE TABLE t3 (id INTEGER PRIMARY KEY);');
        writeMigration(mDir, 1, INIT_SQL);
        writeMigration(mDir, 2, 'CREATE TABLE t2 (id INTEGER PRIMARY KEY);');

        const db = createTestingDatabase({ memory: false });
        await runMigrations({ connection: db, migrationsDir: mDir });

        const rows = db.prepare('SELECT version FROM schema_migrations ORDER BY version').all();
        assert.deepStrictEqual(rows.map(r => r.version), [1, 2, 3], '版本应按升序');

        db.close();
        rmSync(tmpDir, { recursive: true, force: true });
    });

    it('重复版本在 schema_migrations 中被跳过（不报错）', async () => {
        const { runMigrations } = await import('./migrate.js');
        const { createTestingDatabase } = await import('./db.js');

        const tmpDir = join(tmpdir(), `tt-mig-dup2-${randomUUID()}`);
        mkdirSync(tmpDir, { recursive: true });
        const mDir = mkMigrationsDir(tmpDir);
        writeMigration(mDir, 1, INIT_SQL);

        const db = createTestingDatabase({ memory: false });
        const r1 = await runMigrations({ connection: db, migrationsDir: mDir });
        assert.strictEqual(r1.applied, 1);

        // 再次运行同一组文件
        const r2 = await runMigrations({ connection: db, migrationsDir: mDir });
        assert.strictEqual(r2.applied, 0, '重复运行应幂等返回 0');
        assert.strictEqual(r2.errors.length, 0, '幂等运行不应有错误');

        db.close();
        rmSync(tmpDir, { recursive: true, force: true });
    });
});

// ─────────────────────────────────────────────────
// 测试：存储层 CRUD
// ─────────────────────────────────────────────────

describe('文档存储层', () => {

    /** @type {import('better-sqlite3').Database} */
    let db;
    /** @type {typeof import('./store.js')} */
    let store;
    let tmpDir;

    before(async () => {
        const { createTestingDatabase } = await import('./db.js');
        const { runMigrations } = await import('./migrate.js');
        const storeModule = await import('./store.js');
        store = storeModule;

        tmpDir = join(tmpdir(), `tt-store-${randomUUID()}`);
        mkdirSync(tmpDir, { recursive: true });
        const mDir = mkMigrationsDir(tmpDir);
        writeMigration(mDir, 1, INIT_SQL);

        db = createTestingDatabase({ memory: false });
        await runMigrations({ connection: db, migrationsDir: mDir });
    });

    after(() => {
        if (db) { try { db.close(); } catch (_) {} }
        if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
    });

    // ── 新建文档 ──

    it('createDocument 基本功能', () => {
        const result = store.createDocument({
            connection: db,
            title: '测试文档',
            content_md: '# Hello',
            tags: ['tag1', 'tag2']
        });
        assert.ok(result.id > 0, '应返回有效 id');
        assert.strictEqual(result.version, 1, '初始版本为 1');
        assert.ok(result.created_at, '应返回 created_at');
        assert.ok(result.updated_at, '应返回 updated_at');
    });

    it('createDocument 后重新打开可读', async () => {
        // 用一个独立 db 验证持久化，避免污染全局 db
        const { createTestingDatabase } = await import('./db.js');
        const { runMigrations } = await import('./migrate.js');
        const { join: pjoin } = await import('node:path');
        const { tmpdir: ptmp } = await import('node:os');
        const { randomUUID: prand } = await import('node:crypto');

        const localTmpDir = pjoin(ptmp(), `tt-persist-${prand()}`);
        mkdirSync(localTmpDir, { recursive: true });
        const mDir = mkMigrationsDir(localTmpDir);
        writeMigration(mDir, 1, INIT_SQL);

        const localPath = pjoin(localTmpDir, 'persist.sqlite3');
        const localDb = createTestingDatabase({ memory: false, path: localPath });
        await runMigrations({ connection: localDb, migrationsDir: mDir });

        const result = store.createDocument({
            connection: localDb,
            title: '持久化测试',
            content_md: '内容'
        });

        localDb.close();

        const reopened = createTestingDatabase({ memory: false, path: localPath });
        const doc = store.getDocument({ connection: reopened, id: result.id });
        assert.strictEqual(doc.title, '持久化测试', '重启后数据应一致');
        assert.strictEqual(doc.content_md, '内容');
        reopened.close();
        rmSync(localTmpDir, { recursive: true, force: true });
    });

    it('createDocument 标题校验：空标题被拒', () => {
        assert.throws(() => {
            store.createDocument({ connection: db, title: '   ' });
        }, /标题不能为空/);
    });

    it('createDocument 标题校验：超过 100 字符被拒', () => {
        assert.throws(() => {
            store.createDocument({ connection: db, title: 'a'.repeat(101) });
        }, /标题不能超过 100/);
    });

    it('createDocument 正文超过 1MB 被拒', () => {
        const big = 'a'.repeat(1048577);
        assert.throws(() => {
            store.createDocument({ connection: db, title: 'Test', content_md: big });
        }, /正文不能超过 1MB/);
    });

    it('createDocument 标签超过 10 个被拒', () => {
        assert.throws(() => {
            store.createDocument({ connection: db, title: 'Test', tags: Array(11).fill('tag') });
        }, /标签不能超过 10/);
    });

    it('createDocument 标签去重', () => {
        const result = store.createDocument({
            connection: db,
            title: '标签去重测试',
            tags: ['Tag1', 'tag1', 'Tag2', 'tag2']
        });
        const doc = store.getDocument({ connection: db, id: result.id });
        const uniqueNames = new Set(doc.tags);
        assert.strictEqual(uniqueNames.size, doc.tags.length, '标签列表不应有重复');
    });

    // ── 外键约束 ──

    it('createDocument 不存在的 category_id 被拒', () => {
        assert.throws(() => {
            store.createDocument({ connection: db, title: 'Test', category_id: 99999 });
        }, /分类不存在/);
    });

    it('删除分类后文档 category_id 置 NULL', () => {
        const cat = store.createCategory({ connection: db, name: '删除测试分类' });
        const doc = store.createDocument({ connection: db, title: 'Test', category_id: cat.id });
        store.deleteCategory({ connection: db, id: cat.id });
        const updated = store.getDocument({ connection: db, id: doc.id });
        assert.strictEqual(updated.category_id, null, '删除分类后文档应变为未分类');
    });

    it('删除文档后标签关联自动清理', () => {
        const doc = store.createDocument({ connection: db, title: 'CASCADE Test', tags: ['cascadetag'] });
        const docId = doc.id;
        store.deleteDocument({ connection: db, id: docId });
        const tags = store.getDocumentTags({ connection: db, document_id: docId });
        assert.strictEqual(tags.length, 0, '删除文档后标签关联应自动清理');
    });

    // ── 乐观锁冲突 ──

    it('旧版本更新返回冲突快照', () => {
        const doc = store.createDocument({ connection: db, title: 'Conflict Test' });
        const id = doc.id;
        const oldVersion = doc.version;

        store.updateDocument({ connection: db, id, version: oldVersion, title: 'Updated' });

        try {
            store.updateDocument({ connection: db, id, version: oldVersion, title: 'Should Fail' });
            assert.fail('应抛出冲突错误');
        } catch (err) {
            assert.strictEqual(err.code, 'conflict', '错误码应为 conflict');
            assert.ok(err.current, '应返回当前快照');
            assert.strictEqual(err.current.title, 'Updated', '快照应为最新内容');
            assert.strictEqual(err.current.version, oldVersion + 1, '快照版本应为新版本');
        }
    });

    it('版本冲突后数据不变', () => {
        const doc = store.createDocument({ connection: db, title: 'Immutable Test' });
        const id = doc.id;
        const v1 = doc.version;

        store.updateDocument({ connection: db, id, version: v1, title: 'Version 2' });
        const afterUpdate = store.getDocument({ connection: db, id });
        assert.strictEqual(afterUpdate.title, 'Version 2', '更新后内容应为 Version 2');

        try {
            store.updateDocument({ connection: db, id, version: v1, title: 'Should Not Apply' });
        } catch (_) { /* 预期失败 */ }

        const afterConflict = store.getDocument({ connection: db, id });
        assert.strictEqual(afterConflict.title, 'Version 2', '冲突后数据应保持不变');
        assert.strictEqual(afterConflict.version, v1 + 1, '版本号不应回退');
    });

    // ── 列表查询 ──

    it('listDocuments 分页', () => {
        for (let i = 0; i < 5; i++) {
            store.createDocument({ connection: db, title: `Page Doc ${i}` });
        }

        const page1 = store.listDocuments({ connection: db, filter: { limit: 3, offset: 0 } });
        assert.ok(page1.items.length <= 3, '应返回最多 3 条');
        assert.ok(page1.total >= 5, '总条数应 >= 5');

        const page2 = store.listDocuments({ connection: db, filter: { limit: 3, offset: 3 } });
        assert.ok(page2.items.length <= 3, '第二页应返回最多 3 条');
    });

    it('listDocuments 默认按 updated_at 倒序（F-KB-008）', () => {
        const old = store.createDocument({ connection: db, title: '旧文档' });
        const mid = store.createDocument({ connection: db, title: '中文档' });
        const fresh = store.createDocument({ connection: db, title: '新文档' });

        // 显式设置不同更新时间，确保排序可控（不依赖创建时差）
        db.prepare("UPDATE documents SET updated_at = '2020-01-01 00:00:00' WHERE id = ?").run(old.id);
        db.prepare("UPDATE documents SET updated_at = '2021-06-01 00:00:00' WHERE id = ?").run(mid.id);
        db.prepare("UPDATE documents SET updated_at = '2022-12-31 23:59:59' WHERE id = ?").run(fresh.id);

        const res = store.listDocuments({ connection: db, filter: {} });
        const ids = res.items.map((i) => i.id);
        const iOld = ids.indexOf(old.id);
        const iMid = ids.indexOf(mid.id);
        const iFresh = ids.indexOf(fresh.id);
        // 倒序：三篇间 fresh 最前、old 最后（不要求全局首，避免与其他用例数据干扰）
        assert.ok(iFresh < iMid, 'fresh 应排在 mid 之前');
        assert.ok(iMid < iOld, 'mid 应排在 old 之前');
    });

    it('listDocuments 空库返回空（F-KB-008 空状态）', () => {
        // 当前 db 已含其他测试数据，这里验证空标题/空内容行为由上游校验
        // 直接验证：用不存在的分类筛选得到空结果
        const empty = store.listDocuments({ connection: db, filter: { category_id: 999999 } });
        assert.equal(empty.total, 0);
        assert.equal(empty.items.length, 0);
    });

    it('listDocuments 按分类筛选', () => {
        const cat = store.createCategory({ connection: db, name: '列表筛选分类' });
        store.createDocument({ connection: db, title: 'Filtered Doc', category_id: cat.id });

        const filtered = store.listDocuments({ connection: db, filter: { category_id: cat.id } });
        assert.ok(filtered.items.every(d => d.category_id === cat.id), '应只返回指定分类的文档');
    });

    // ── 页面树（迁移 002） ──

    it('createDocument 支持 parent_id，getDocument 返回祖先路径与子页面数量', () => {
        const root = store.createDocument({ connection: db, title: '树根' });
        const mid = store.createDocument({ connection: db, title: '中间页', parent_id: root.id });
        const leaf = store.createDocument({ connection: db, title: '叶子页', parent_id: mid.id });

        const rootDoc = store.getDocument({ connection: db, id: root.id });
        assert.strictEqual(rootDoc.parent_id, null, '顶层页面 parent_id 应为 null');
        assert.strictEqual(rootDoc.child_count, 1);
        assert.strictEqual(rootDoc.descendant_count, 2, '应统计全部后代');

        const leafDoc = store.getDocument({ connection: db, id: leaf.id });
        assert.deepStrictEqual(leafDoc.path.map(p => p.id), [root.id, mid.id], '路径应为 根→父');
        assert.strictEqual(leafDoc.parent_id, mid.id);
    });

    it('parent_id 指向不存在的页面 → invalid_input', () => {
        try {
            store.createDocument({ connection: db, title: '孤儿页', parent_id: 999999 });
            assert.fail('应抛出错误');
        } catch (err) {
            assert.strictEqual(err.code, 'invalid_input');
        }
    });

    it('listChildren / listDocumentTree / root 过滤', () => {
        const root = store.createDocument({ connection: db, title: '目录页' });
        store.createDocument({ connection: db, title: '子页 A', parent_id: root.id });
        store.createDocument({ connection: db, title: '子页 B', parent_id: root.id });

        const children = store.listChildren({ connection: db, id: root.id });
        assert.strictEqual(children.length, 2);
        assert.ok(children.every(c => c.parent_id === root.id));

        const tree = store.listDocumentTree({ connection: db });
        assert.ok(tree.some(n => n.id === root.id && n.parent_id === null));
        assert.strictEqual(tree.find(n => n.id === root.id).content_md, undefined, '树数据不应带正文');

        const roots = store.listDocuments({ connection: db, filter: { root: true, limit: 100 } });
        assert.ok(roots.items.every(d => d.parent_id === null), 'root 过滤只应返回顶层页面');

        const byParent = store.listDocuments({ connection: db, filter: { parent_id: root.id } });
        assert.strictEqual(byParent.total, 2);
    });

    it('updateDocument 可移动页面，且拒绝移动到自身或后代之下', () => {
        const a = store.createDocument({ connection: db, title: '移动 A' });
        const b = store.createDocument({ connection: db, title: '移动 B', parent_id: a.id });
        const c = store.createDocument({ connection: db, title: '移动 C', parent_id: b.id });

        // 正常移动：C 移到 A 下
        const moved = store.updateDocument({ connection: db, id: c.id, version: 1, parent_id: a.id });
        assert.strictEqual(moved.version, 2);
        assert.strictEqual(store.getDocument({ connection: db, id: c.id }).parent_id, a.id);

        // 成环：A 移到自己的后代 B 下
        try {
            store.updateDocument({ connection: db, id: a.id, version: 1, parent_id: b.id });
            assert.fail('应拒绝成环');
        } catch (err) {
            assert.strictEqual(err.code, 'invalid_input');
        }

        // 成环：A 移到自身
        try {
            store.updateDocument({ connection: db, id: a.id, version: 1, parent_id: a.id });
            assert.fail('应拒绝自引用');
        } catch (err) {
            assert.strictEqual(err.code, 'invalid_input');
        }
    });

    it('删除父页面级联删除子页面', () => {
        const parent = store.createDocument({ connection: db, title: '待删父页' });
        const child = store.createDocument({ connection: db, title: '待删子页', parent_id: parent.id });
        const grandchild = store.createDocument({ connection: db, title: '待删孙页', parent_id: child.id });

        store.deleteDocument({ connection: db, id: parent.id });
        assert.strictEqual(store.getDocument({ connection: db, id: child.id }), null, '子页面应被级联删除');
        assert.strictEqual(store.getDocument({ connection: db, id: grandchild.id }), null, '孙页面应被级联删除');
    });

    // ── 非法输入 ──

    it('不存在的文档 getDocument 返回 null', () => {
        const result = store.getDocument({ connection: db, id: 999999 });
        assert.strictEqual(result, null, '不存在的文档应返回 null');
    });

    it('不存在的文档 updateDocument 抛出 not_found', () => {
        assert.throws(() => {
            store.updateDocument({ connection: db, id: 999999, version: 1, title: 'Test' });
        }, /文档不存在/);
    });

    it('不存在的文档 deleteDocument 抛出 not_found', () => {
        assert.throws(() => {
            store.deleteDocument({ connection: db, id: 999999 });
        }, /文档不存在/);
    });

    // ── 分类 CRUD ──

    it('createCategory 基本功能', () => {
        const cat = store.createCategory({ connection: db, name: '新分类' });
        assert.ok(cat.id > 0);
        assert.strictEqual(cat.name, '新分类');
    });

    it('createCategory 重名被拒', () => {
        store.createCategory({ connection: db, name: '唯一分类' });
        assert.throws(() => {
            store.createCategory({ connection: db, name: '唯一分类' });
        }, /已存在/);
    });

    it('listCategories 返回所有分类', () => {
        const cats = store.listCategories({ connection: db });
        assert.ok(Array.isArray(cats));
        assert.ok(cats.length > 0);
    });

    // ── 分类重命名 / 上限（F-KB-004） ──

    it('updateCategory 重命名成功', () => {
        const c = store.createCategory({ connection: db, name: '重命名前' });
        const u = store.updateCategory({ connection: db, id: c.id, name: '重命名后' });
        assert.strictEqual(u.name, '重命名后');
        assert.strictEqual(
            store.listCategories({ connection: db }).find((x) => x.id === c.id).name,
            '重命名后'
        );
    });

    it('updateCategory 重名被拒（constraint_failed）', () => {
        store.createCategory({ connection: db, name: '已占名' });
        const c = store.createCategory({ connection: db, name: '待改名' });
        assert.throws(() => {
            store.updateCategory({ connection: db, id: c.id, name: '已占名' });
        }, /已存在/);
    });

    it('updateCategory 不存在 → not_found', () => {
        assert.throws(() => {
            store.updateCategory({ connection: db, id: 999999, name: 'x' });
        }, /分类不存在/);
    });

    it('updateCategory 空名 → invalid_input', () => {
        const c = store.createCategory({ connection: db, name: '空名校验' });
        assert.throws(() => {
            store.updateCategory({ connection: db, id: c.id, name: '   ' });
        }, /不能为空/);
    });

    it('createCategory 超过 50 个被拒（invalid_input）', () => {
        let guard = 0;
        while (store.listCategories({ connection: db }).length < 50 && guard++ < 200) {
            store.createCategory({ connection: db, name: '批量分类-' + guard });
        }
        assert.throws(() => {
            store.createCategory({ connection: db, name: '超额分类' });
        }, /上限/);
    });

    // ── 标签规范化与 AND 过滤（F-KB-005） ──

    it('createDocument 标签英文小写合并且去重', () => {
        const r = store.createDocument({
            connection: db, title: '标签归一', tags: ['FrontEnd', 'frontend', ' 规范 ', '规范']
        });
        const doc = store.getDocument({ connection: db, id: r.id });
        assert.deepStrictEqual(doc.tags.sort(), ['frontend', '规范']);
    });

    it('listDocuments 按标签 AND 过滤', () => {
        const ab = store.createDocument({ connection: db, title: 'AND-AB', tags: ['alpha', 'beta'] });
        const a = store.createDocument({ connection: db, title: 'AND-A', tags: ['alpha'] });
        const bc = store.createDocument({ connection: db, title: 'AND-BC', tags: ['beta', 'gamma'] });
        const both = store.listDocuments({ connection: db, filter: { tags: ['alpha', 'beta'] } });
        assert.deepStrictEqual(both.items.map((i) => i.id).sort(), [ab.id]);
        const onlyA = store.listDocuments({ connection: db, filter: { tags: ['alpha'] } });
        assert.ok(onlyA.items.find((i) => i.id === a.id));
        assert.ok(!onlyA.items.find((i) => i.id === bc.id));
    });

    // ── 搜索（F-KB-006） ──

    it('searchDocuments：按标题关键词命中', () => {
        const d = store.createDocument({ connection: db, title: 'Vue 组件规范', content_md: '正文无关内容' });
        const r = store.searchDocuments({ connection: db, keyword: '组件规范' });
        assert.ok(r.items.find((i) => i.id === d.id));
    });

    it('searchDocuments：按正文关键词命中', () => {
        const d = store.createDocument({ connection: db, title: '标题无关键词', content_md: '这里讨论 Shader Graph 的用法与节点' });
        const r = store.searchDocuments({ connection: db, keyword: 'Shader' });
        assert.ok(r.items.find((i) => i.id === d.id));
    });

    it('searchDocuments：未命中返回空', () => {
        const r = store.searchDocuments({ connection: db, keyword: 'zzz_无此词_zzz' });
        assert.strictEqual(r.total, 0);
        assert.deepStrictEqual(r.items, []);
    });

    it('searchDocuments：空关键词返回空（不发起全表匹配）', () => {
        const r = store.searchDocuments({ connection: db, keyword: '   ' });
        assert.strictEqual(r.total, 0);
        assert.deepStrictEqual(r.items, []);
    });

    it('searchDocuments：大小写不敏感', () => {
        const d = store.createDocument({ connection: db, title: 'React 入门', content_md: 'x' });
        const r = store.searchDocuments({ connection: db, keyword: 'react' });
        assert.ok(r.items.find((i) => i.id === d.id));
    });

    it('searchDocuments：LIKE 通配符按字面量匹配（% _ \\ 不触发通配）', () => {
        const d = store.createDocument({ connection: db, title: '进度 100% 完成', content_md: 'x' });
        // 关键词含 %：若被当作通配符会匹配所有文档；正确行为应只匹配字面 100%
        const r = store.searchDocuments({ connection: db, keyword: '100%' });
        assert.strictEqual(r.total, 1);
        assert.strictEqual(r.items[0].id, d.id);
    });

    it('searchDocuments：返回摘要片段 snippet', () => {
        const d = store.createDocument({
            connection: db, title: '片段测试', content_md: '这是一段需要被摘要提取的正文内容用于验证 snippet 生成'
        });
        const r = store.searchDocuments({ connection: db, keyword: '摘要' });
        const hit = r.items.find((i) => i.id === d.id);
        assert.ok(hit && typeof hit.snippet === 'string' && hit.snippet.length > 0);
    });

    it('searchDocuments：结果按 updated_at 倒序', () => {
        const a = store.createDocument({ connection: db, title: '排序A 公共词', content_md: 'x' });
        const b = store.createDocument({ connection: db, title: '排序B 公共词', content_md: 'x' });
        // 显式设置不同更新时间，保证排序可判定
        db.prepare("UPDATE documents SET updated_at = '2020-01-01T00:00:00Z' WHERE id = ?").run(a.id);
        db.prepare("UPDATE documents SET updated_at = '2026-01-01T00:00:00Z' WHERE id = ?").run(b.id);
        const r = store.searchDocuments({ connection: db, keyword: '公共词' });
        const ids = r.items.map((i) => i.id);
        assert.ok(ids.includes(a.id) && ids.includes(b.id));
        assert.strictEqual(r.items[0].id, b.id, '更新的应排在前面');
    });
});

// ─────────────────────────────────────────────────
// 测试：busy lock
// ─────────────────────────────────────────────────

describe('忙锁处理', () => {

    it('短 timeout 独立连接忙锁报错', async () => {
        const { createTestingDatabase } = await import('./db.js');
        const { runMigrations } = await import('./migrate.js');
        const { join: pjoin } = await import('node:path');
        const { tmpdir: ptmp } = await import('node:os');
        const { randomUUID: prand } = await import('node:crypto');

        // 两个连接必须共享同一文件才能触发 busy
        const tmpDir = pjoin(ptmp(), `tt-lock-${prand()}`);
        mkdirSync(tmpDir, { recursive: true });
        const mDir = mkMigrationsDir(tmpDir);
        writeMigration(mDir, 1, INIT_SQL);

        const sharedPath = pjoin(tmpDir, 'shared.sqlite3');
        const db1 = createTestingDatabase({ memory: false, timeout: 100, path: sharedPath });
        await runMigrations({ connection: db1, migrationsDir: mDir });
        const db2 = createTestingDatabase({ memory: false, timeout: 100, path: sharedPath });

        // db1 开启写事务不提交，保留排他锁
        db1.exec('BEGIN IMMEDIATE');

        try {
            // db2 尝试写入应遇到忙锁
            db2.prepare('INSERT INTO categories (name) VALUES (?)').run('shouldfail');
            assert.fail('应抛出忙锁错误');
        } catch (err) {
            assert.strictEqual(err.code, 'SQLITE_BUSY', '应报告 SQLITE_BUSY');
        } finally {
            try { db1.exec('ROLLBACK'); } catch (_) {}
            db1.close();
            db2.close();
            rmSync(tmpDir, { recursive: true, force: true });
        }
    });
});

// ─────────────────────────────────────────────────
// 测试：路径错误
// ─────────────────────────────────────────────────

describe('路径错误处理', () => {

    it('无法打开的路径返回 cannot_open', async () => {
        const { createDatabase } = await import('./db.js');
        // 用一个肯定创建失败的路径：Windows 上不存在的盘符
        const badPath = 'Z:/definitely-not-exists-readonly-zzzz/db.sqlite3';
        try {
            createDatabase({ path: badPath });
            assert.fail('应抛出错误');
        } catch (err) {
            assert.strictEqual(err.code, 'cannot_open', '错误码应为 cannot_open');
        }
    });

    it('错误信息不泄露绝对路径', async () => {
        const { createDatabase } = await import('./db.js');
        const badPath = 'Z:/definitely-not-exists-readonly-zzzz/data.sqlite3';
        try {
            createDatabase({ path: badPath });
            assert.fail('应抛出错误');
        } catch (err) {
            assert.ok(!err.message.includes(badPath), '错误信息不应包含绝对路径');
        }
    });
});
