import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, mkdirSync, readdirSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTestingDatabase } from './db.js';
import { runMigrations } from './migrate.js';
import { createTodo, deleteProject, deleteTodo, exportProjectTodos, getTodo, importProjectTodos, listProjectTodos, saveProject, saveTodo, setTodoArchived, validateProjectTodoBackup } from './project-todos-store.js';
import { registerProjectTodosApi } from './project-todos-api.js';
import { createDocument, exportSnapshot, importSnapshot } from './store.js';
import { buildFullBackup } from './full-backup.js';

async function database(t) {
    const db = createTestingDatabase({ memory: true });
    t.after(() => { if (db.open) db.close(); });
    assert.deepEqual((await runMigrations({ connection: db })).errors, []);
    return db;
}

describe('项目待办层级与自动归档', () => {
    test('项目作为一级分组，待办作为二级条目，完成后进入归档并可恢复', async t => {
        const db = await database(t), project = saveProject(db, { name: 'Unity 工具箱', description: '工具维护' });
        const todo = createTodo(db, project.id, { issue: '下载全部日志', details: '检查设备端文件清单' });
        let state = listProjectTodos(db); assert.equal(state.projects.length, 1); assert.equal(state.projects[0].name, 'Unity 工具箱'); assert.equal(state.projects[0].todos[0].issue, '下载全部日志'); assert.equal(state.projects[0].todos[0].isArchived, false);
        const archived = setTodoArchived(db, todo.id, { version: todo.version, archived: true });
        assert.equal(archived.status, 'archived'); assert.ok(archived.completedAt); assert.ok(archived.archivedAt);
        assert.equal(listProjectTodos(db).projects[0].todos.length, 0); assert.equal(listProjectTodos(db, { view: 'archived' }).projects[0].todos[0].projectName, 'Unity 工具箱');
        const restored = setTodoArchived(db, todo.id, { version: archived.version, archived: false }); assert.equal(restored.status, 'active'); assert.equal(restored.completedAt, null); assert.equal(restored.archivedAt, null);
    });
    test('问题编辑和版本锁、删除限制', async t => {
        const db = await database(t), project = saveProject(db, { name: '安卓调试' }), todo = createTodo(db, project.id, { issue: '批量安装 APK' });
        const changed = saveTodo(db, todo.id, { issue: '批量安装多个 APK', details: '按设备显示结果', version: todo.version }); assert.equal(changed.version, 2);
        assert.throws(() => saveTodo(db, todo.id, { issue: '旧问题', details: '', version: todo.version }), { code: 'conflict' });
        assert.throws(() => deleteProject(db, project.id, project.version), { code: 'conflict' });
        deleteTodo(db, todo.id, changed.version); deleteProject(db, project.id, project.version); assert.equal(listProjectTodos(db).projects.length, 0);
        assert.throws(() => deleteTodo(db, todo.id, changed.version), { code: 'not_found' });
    });
    test('边界、同名项目和坏备份在写入前被拒绝', async t => {
        const db = await database(t), first = saveProject(db, { name: '知识库' });
        assert.throws(() => saveProject(db, { name: '知识库' }), { code: 'conflict' });
        for (const value of [{ name: '' }, { name: 'x'.repeat(81) }, { name: '项目', description: 'x'.repeat(1001) }]) assert.throws(() => saveProject(db, value), { code: 'invalid_input' });
        for (const value of [{ issue: '' }, { issue: 'x'.repeat(201) }, { issue: '问题', details: 'x'.repeat(2001) }]) assert.throws(() => createTodo(db, first.id, value), { code: 'invalid_input' });
        const before = exportProjectTodos(db);
        for (const value of [null, {}, { projects: [null], todos: [] }, { projects: [], todos: [{ id: randomUUID(), projectId: randomUUID(), issue: 'x', details: '', status: 'active', version: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), completedAt: null, archivedAt: null }] }]) assert.throws(() => validateProjectTodoBackup(value), { code: 'invalid_input' });
        assert.deepEqual(exportProjectTodos(db), before);
    });
    test('快照往返保留项目、问题和归档状态，重复导入不覆盖', async t => {
        const db = await database(t), project = saveProject(db, { name: '知识库', description: '整理' }), todo = createTodo(db, project.id, { issue: 'SOP检查清单' }); setTodoArchived(db, todo.id, { version: todo.version, archived: true });
        const snapshot = exportSnapshot({ connection: db }), other = await database(t), result = importSnapshot({ connection: other, snapshot });
        assert.deepEqual(result.project_todos, { projects: 1, todos: 1, skipped: 0 }); assert.deepEqual(exportProjectTodos(other), exportProjectTodos(db));
        const repeated = importSnapshot({ connection: other, snapshot }); assert.deepEqual(repeated.project_todos, { projects: 0, todos: 0, skipped: 2 });
        const old = { ...snapshot }; delete old.project_todos; assert.doesNotThrow(() => importSnapshot({ connection: other, snapshot: old }));
        const full = buildFullBackup({ connection: db });
        assert.equal(full.manifest.counts.project_todos_projects, 1); assert.equal(full.manifest.counts.project_todos, 1);
        assert.deepEqual(full.documents.project_todos, snapshot.project_todos);
    });
    test('项目改名及归档/删除使用独立版本，旧请求不能覆盖新记录', async t => {
        const db = await database(t), project = saveProject(db, { name: '项目 A' }), item = createTodo(db, project.id, { issue: '检查' });
        const renamed = saveProject(db, { name: '项目 B', version: project.version }, project.id);
        assert.equal(getTodo(db, item.id).projectName, '项目 B');
        assert.throws(() => saveProject(db, { name: '旧名称', version: project.version }, project.id), { code: 'conflict' });
        const archived = setTodoArchived(db, item.id, { version: item.version, archived: true });
        assert.throws(() => setTodoArchived(db, item.id, { version: item.version, archived: false }), { code: 'conflict' });
        assert.throws(() => deleteTodo(db, item.id, item.version), { code: 'conflict' });
        assert.throws(() => deleteProject(db, project.id, renamed.version), { code: 'conflict' });
        assert.equal(getTodo(db, item.id).status, 'archived');
        deleteTodo(db, item.id, archived.version);
        assert.throws(() => deleteProject(db, project.id, project.version), { code: 'conflict' });
        deleteProject(db, project.id, renamed.version);
    });
    test('从迁移011升级保留旧文档，项目及归档待办重开后仍在', async t => {
        const root = mkdtempSync(join(tmpdir(), 'tt-project-todo-migration-')), old = join(root, 'migrations'), path = join(root, 'test.sqlite3'), connections = [];
        t.after(() => { for (const db of connections) if (db.open) db.close(); rmSync(root, { recursive: true, force: true }); });
        mkdirSync(old);
        const migrations = fileURLToPath(new URL('./migrations/', import.meta.url));
        for (const name of readdirSync(migrations).filter(name => /^\d+_.*\.sql$/.test(name) && Number(name.split('_')[0]) <= 11)) copyFileSync(join(migrations, name), join(old, name));
        const db = createTestingDatabase({ path }); connections.push(db);
        assert.deepEqual((await runMigrations({ connection: db, migrationsDir: old })).errors, []);
        const note = createDocument({ connection: db, title: '保留原笔记', content_md: '升级前正文' });
        assert.deepEqual((await runMigrations({ connection: db })).versions, [12]);
        assert.deepEqual((await runMigrations({ connection: db })).versions, []);
        const project = saveProject(db, { name: '持久化项目' }), item = createTodo(db, project.id, { issue: '升级检查' });
        setTodoArchived(db, item.id, { version: item.version, archived: true }); db.close();
        const reopened = createTestingDatabase({ path }); connections.push(reopened);
        assert.equal(reopened.prepare('SELECT content_md FROM documents WHERE id=?').get(note.id).content_md, '升级前正文');
        assert.equal(listProjectTodos(reopened, { view: 'archived' }).projects[0].todos[0].issue, '升级检查');
        assert.ok(getTodo(reopened, item.id).archivedAt);
    });
    test('备份合并复用同名项目、ID优先，不覆盖名称/说明或已有待办', async t => {
        const source = await database(t), dest = await database(t);
        const from = saveProject(source, { name: 'Unity', description: '备份说明' }); createTodo(source, from.id, { issue: '备份问题' });
        const local = saveProject(dest, { name: 'ＵＮＩＴＹ', description: '本机说明' });
        assert.deepEqual(importProjectTodos(dest, exportProjectTodos(source)), { projects: 0, todos: 1, skipped: 1 });
        const merged = listProjectTodos(dest).projects[0];
        assert.equal(merged.id, local.id); assert.equal(merged.description, '本机说明'); assert.equal(merged.todos[0].projectId, local.id);
        saveProject(source, { name: '已改名', version: from.version }, from.id);
        const original = exportProjectTodos(source);
        importProjectTodos(dest, original);
        saveProject(dest, { name: 'ID项目改名', version: original.projects[0].version }, from.id);
        const oldName = saveProject(dest, { name: '已改名' });
        const newer = createTodo(source, from.id, { issue: '后续问题' });
        importProjectTodos(dest, exportProjectTodos(source));
        assert.equal(getTodo(dest, newer.id).projectId, from.id);
        assert.equal(getTodo(dest, newer.id).projectName, 'ID项目改名');
        assert.equal(listProjectTodos(dest).projects.find(item => item.id === oldName.id).todoCount, 0);
    });
    test('无效归档时间/重复名称被拒，内容导入不留下部分新文档', async t => {
        const db = await database(t), p = saveProject(db, { name: '原项目' }), todo = createTodo(db, p.id, { issue: '问题' });
        const snapshot = exportSnapshot({ connection: db });
        const variants = [
            value => { value.todos[0].archivedAt = new Date().toISOString(); },
            value => { value.todos[0].status = 'archived'; },
            value => { value.projects[0].createdAt = '2026-02-30T00:00:00.000Z'; },
            value => { value.projects.push({ ...value.projects[0], id: randomUUID() }); },
            value => { value.todos.push({ ...value.todos[0] }); }
        ];
        for (const change of variants) {
            const damaged = structuredClone(snapshot); change(damaged.project_todos);
            damaged.documents = [{ title: '失败不写入', content_md: '', tags: [] }];
            assert.throws(() => importSnapshot({ connection: db, snapshot: damaged }), { code: 'invalid_input' });
            assert.equal(db.prepare('SELECT COUNT(*) AS n FROM documents').get().n, 0);
            assert.equal(getTodo(db, todo.id).status, 'active');
        }
    });
    test('正文接近8MiB的有效备份可以完整往返，合并超额事务回滚', async t => {
        const db = await database(t), project = saveProject(db, { name: '容量检查' }), now = new Date().toISOString();
        const insert = db.prepare('INSERT INTO kb_project_todos(id,project_id,issue,details,created_at,updated_at) VALUES(?,?,?,?,?,?)');
        db.transaction(() => { for (let i = 0; i < 4100; i++) insert.run(randomUUID(), project.id, '问题', 'a'.repeat(2000), now, now); })();
        const backup = exportProjectTodos(db);
        assert.ok(Buffer.byteLength(JSON.stringify(backup)) > 8 * 1024 * 1024, '备份元数据不应计入正文上限');
        const other = await database(t); assert.equal(importProjectTodos(other, backup).todos, 4100);
        assert.deepEqual(exportProjectTodos(other), backup);
        const incoming = { projects: [{ ...backup.projects[0], id: randomUUID(), name: '超额新项目' }], todos: [] };
        for (let i = 0; i < 100; i++) incoming.todos.push({ ...backup.todos[0], id: randomUUID(), projectId: incoming.projects[0].id });
        assert.throws(() => importProjectTodos(other, incoming), { code: 'conflict' });
        assert.deepEqual(exportProjectTodos(other), backup, '超额不能留下部分项目或待办');
    });
});

describe('项目待办接口', () => {
    async function fixture(t) {
        const db = await database(t), logs = [], app = express(); registerProjectTodosApi(app, { getDb: () => db, log: message => logs.push(message) });
        const server = await new Promise(resolve => { const item = app.listen(0, '127.0.0.1', () => resolve(item)); });
        t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
        const base = `http://127.0.0.1:${server.address().port}`;
        const request = (path, method = 'GET', body, headers = {}) => fetch(base + '/api/project-todos' + path, { method, headers: { Origin: base, 'X-Toolbox-Project-Todos': '1', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
        return { db, logs, request, base };
    }
    test('创建项目/待办、完成自动归档、筛选和恢复', async t => {
        const f = await fixture(t), project = await (await f.request('/projects', 'POST', { name: '发布' })).json();
        const todo = await (await f.request(`/projects/${project.id}/todos`, 'POST', { issue: '检查构建', details: '' })).json();
        assert.equal((await f.request('/state')).status, 200);
        const archived = await (await f.request(`/todos/${todo.id}`, 'PATCH', { version: todo.version, archived: true })).json(); assert.equal(archived.status, 'archived');
        assert.equal((await (await f.request('/state')).json()).projects[0].todos.length, 0); assert.equal((await (await f.request('/state?view=archived')).json()).projects[0].todos.length, 1);
        assert.equal((await f.request(`/todos/${todo.id}`, 'PATCH', { version: archived.version, archived: false })).status, 200);
    });
    test('专用头、来源、确认和查询校验', async t => {
        const f = await fixture(t), project = saveProject(f.db, { name: '验证' });
        assert.equal((await f.request('/state', 'GET', undefined, { 'X-Toolbox-Project-Todos': '' })).status, 403);
        assert.equal((await f.request('/state', 'GET', undefined, { Origin: 'https://elsewhere.example' })).status, 403);
        assert.equal((await f.request('/state?bad=1')).status, 400);
        assert.equal((await f.request(`/projects/${project.id}`, 'DELETE', undefined, { })).status, 400);
        assert.equal((await f.request(`/projects/${project.id}?confirm=1&version=${project.version}`, 'DELETE')).status, 200);
        assert.doesNotMatch(f.logs.join('\n'), /验证/);
    });
    test('旧版本更新返回409，非空项目不可删，错误日志不包含正文', async t => {
        const f = await fixture(t), project = saveProject(f.db, { name: '不能记录的项目' }), todo = createTodo(f.db, project.id, { issue: '不能记录的待办' });
        const path = `/todos/${todo.id}`;
        assert.equal((await f.request(path, 'PUT', { issue: '修改', version: todo.version })).status, 200);
        assert.equal((await f.request(path, 'PUT', { issue: '不能记录的草稿', version: todo.version })).status, 409);
        assert.equal((await f.request(`/projects/${project.id}?confirm=1&version=${project.version}`, 'DELETE')).status, 409);
        assert.equal(getTodo(f.db, todo.id).issue, '修改');
        assert.ok(f.logs.length >= 2); assert.doesNotMatch(f.logs.join('\n'), /不能记录/);
    });
    test('精确JSON解析器拒绝损坏、过大请求和未知字段，失败不写入', async t => {
        const f = await fixture(t), headers = { Origin: f.base, 'X-Toolbox-Project-Todos': '1', 'Content-Type': 'application/json' };
        assert.equal((await fetch(f.base + '/api/project-todos/projects', { method: 'POST', headers, body: '{broken' })).status, 400);
        assert.equal((await f.request('/projects', 'POST', { name: 'x', description: 'a'.repeat(129 * 1024) })).status, 413);
        assert.equal((await f.request('/projects', 'POST', { name: 'x', unknown: true })).status, 400);
        assert.equal((await f.request('/state?view=wrong')).status, 400);
        assert.equal(listProjectTodos(f.db).projects.length, 0);
    });
});
