import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, mkdirSync, copyFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { PassThrough } from 'node:stream';
import express from 'express';
import { createTestingDatabase } from './db.js';
import { runMigrations } from './migrate.js';
import { saveSopTemplate, getSopTemplate, listSopTemplates, deleteSopTemplate, startSopRun, getSopRun, listSopRuns, changeSopRun, deleteSopRun, exportSops, validateSopBackup } from './knowledge-sops-store.js';
import { registerKnowledgeSopsApi } from './knowledge-sops-api.js';
import { createDocument, exportSnapshot, importSnapshot } from './store.js';

const sample = (extra = {}) => ({ name: '发布检查', description: '按顺序核对发布准备', steps: [{ text: '检查版本号' }, { text: '确认测试结果\n保留报告' }], ...extra });
async function database(t, path) { const db = createTestingDatabase(path ? { path } : { memory: true }); t.after(() => { if (db.open) db.close(); }); assert.deepEqual((await runMigrations({ connection: db })).errors, []); return db; }
function start(db, template) { return startSopRun(db, template.id, { version: template.version, requestId: randomUUID() }).item; }
function complete(db, run) { for (const step of run.steps) run = changeSopRun(db, run.id, { version: run.version, stepId: step.id, done: true }); return changeSopRun(db, run.id, { version: run.version, complete: true }); }

describe('SOP模板与独立执行记录', () => {
    test('每次执行独立快照，模板编辑和删除不改变旧名称、说明、步骤及勾选', async t => {
        const db = await database(t), template = saveSopTemplate(db, sample()), first = start(db, template), second = start(db, template);
        const checked = changeSopRun(db, first.id, { version: first.version, stepId: first.steps[0].id, done: true });
        assert.ok(checked.steps[0].done); assert.equal(getSopRun(db, second.id).steps[0].done, false);
        const changed = saveSopTemplate(db, sample({ name: '新发布检查', description: '新的说明', steps: [{ text: '新步骤' }], version: template.version }), template.id);
        assert.equal(changed.version, 2); assert.equal(getSopRun(db, first.id).templateName, '发布检查'); assert.equal(getSopRun(db, first.id).description, '按顺序核对发布准备'); assert.equal(getSopRun(db, first.id).steps.length, 2);
        deleteSopTemplate(db, template.id, changed.version); assert.equal(listSopTemplates(db).length, 0);
        const kept = getSopRun(db, first.id); assert.equal(kept.templateId, null); assert.equal(kept.templateVersion, 1); assert.equal(kept.steps[0].done, true); assert.equal(kept.steps[1].text, '确认测试结果\n保留报告');
    });
    test('必须全部勾选后主动完成，备注保存；完成后只读', async t => {
        const db = await database(t), template = saveSopTemplate(db, sample()); let run = start(db, template);
        assert.throws(() => changeSopRun(db, run.id, { version: run.version, complete: true }), { code: 'invalid_input' });
        run = changeSopRun(db, run.id, { version: run.version, notes: '已核对，存在一个已解决异常' }); assert.match(getSopRun(db, run.id).notes, /已解决/);
        run = complete(db, run); assert.equal(run.status, 'completed'); assert.ok(run.completedAt); assert.ok(run.steps.every(step => step.done));
        assert.throws(() => changeSopRun(db, run.id, { version: run.version, notes: '不应修改' }), { code: 'conflict' });
        assert.equal(getSopRun(db, run.id).notes, '已核对，存在一个已解决异常'); assert.equal(start(db, template).status, 'active');
    });
    test('乐观版本锁阻止模板、勾选和删除的旧请求覆盖新数据', async t => {
        const db = await database(t), template = saveSopTemplate(db, sample());
        const changed = saveSopTemplate(db, { ...template, description: '已更新', version: template.version }, template.id);
        assert.throws(() => saveSopTemplate(db, { ...template, description: '旧页面' }, template.id), { code: 'conflict' });
        assert.throws(() => deleteSopTemplate(db, template.id, template.version), { code: 'conflict' });
        assert.throws(() => start(db, template), { code: 'conflict' });
        const run = start(db, changed), update = changeSopRun(db, run.id, { version: run.version, stepId: run.steps[0].id, done: true });
        assert.throws(() => changeSopRun(db, run.id, { version: run.version, stepId: run.steps[1].id, done: true }), { code: 'conflict' });
        assert.throws(() => deleteSopRun(db, run.id, run.version), { code: 'conflict' }); assert.equal(getSopRun(db, run.id).steps[1].done, false); assert.equal(getSopRun(db, run.id).version, update.version);
    });
    test('相同请求UUID重试返回原执行，UUID误用拒绝；再执行使用新UUID', async t => {
        const db = await database(t), template = saveSopTemplate(db, sample()), other = saveSopTemplate(db, sample({ name: '其他' })), requestId = randomUUID();
        const first = startSopRun(db, template.id, { version: 1, requestId }), again = startSopRun(db, template.id, { version: 1, requestId });
        assert.equal(first.created, true); assert.equal(again.created, false); assert.equal(first.item.id, again.item.id); assert.equal(listSopRuns(db).total, 1);
        assert.throws(() => startSopRun(db, other.id, { version: 1, requestId }), { code: 'conflict' });
        start(db, template); assert.equal(listSopRuns(db).total, 2);
    });
    test('模板名称规范化唯一，步骤边界和坏数据不能写入', async t => {
        const db = await database(t); saveSopTemplate(db, sample({ name: '测试Ａ' }));
        assert.throws(() => saveSopTemplate(db, sample({ name: '测试a' })), { code: 'conflict' });
        for (const value of [sample({ name: '' }), sample({ name: '\u200b' }), sample({ name: 'a'.repeat(81) }), sample({ description: 'a'.repeat(2001) }), sample({ steps: [] }), sample({ steps: Array(51).fill({ text: '步骤' }) }), sample({ steps: [null] }), sample({ steps: [{ text: 'a'.repeat(501) }] }), sample({ steps: [{ text: '  ' }] }), sample({ steps: [{ text: '步骤', command: 'anything' }] })]) assert.throws(() => saveSopTemplate(db, value), { code: 'invalid_input' });
        const id = randomUUID(); assert.throws(() => saveSopTemplate(db, sample({ steps: [{ id, text: '一' }, { id, text: '二' }] })), { code: 'invalid_input' });
        assert.equal(listSopTemplates(db).length, 1); const template = saveSopTemplate(db, sample({ name: '最大步骤', steps: Array.from({ length: 50 }, (_, i) => ({ text: '步骤' + i })) })); assert.equal(template.steps.length, 50);
    });
    test('步骤只能使用本次记录的有效ID和布尔状态，备注长度受限', async t => {
        const db = await database(t), run = start(db, saveSopTemplate(db, sample()));
        for (const value of [{ stepId: randomUUID(), done: true }, { stepId: run.steps[0].id, done: 'true' }, { stepId: '../escape', done: true }, { notes: 'a'.repeat(2001) }, { complete: false }]) assert.throws(() => changeSopRun(db, run.id, { version: run.version, ...value }), { code: 'invalid_input' });
        assert.equal(getSopRun(db, run.id).version, 1); assert.equal(getSopRun(db, run.id).steps[0].done, false);
    });
    test('历史分页及状态筛选，删除仅影响明确记录', async t => {
        const db = await database(t), template = saveSopTemplate(db, sample()); for (let i = 0; i < 53; i++) start(db, template);
        assert.equal(listSopRuns(db).items.length, 50); assert.equal(listSopRuns(db, { offset: 50 }).items.length, 3);
        const run = getSopRun(db, listSopRuns(db).items[0].id); complete(db, run); assert.equal(listSopRuns(db, { status: 'completed' }).total, 1); assert.equal(listSopRuns(db, { status: 'active' }).total, 52);
        const target = listSopRuns(db, { status: 'completed' }).items[0]; deleteSopRun(db, target.id, target.version); assert.equal(listSopRuns(db).total, 52); assert.equal(getSopTemplate(db, template.id).name, template.name);
        assert.throws(() => deleteSopRun(db, target.id, target.version), { code: 'not_found' });
        for (const options of [{ offset: -1 }, { offset: 1001 }, { status: 'hidden' }]) assert.throws(() => listSopRuns(db, options), { code: 'invalid_input' });
    });
    test('200模板/1000执行和总正文8MiB限额，达到上限不覆盖既有数据', async t => {
        const db = await database(t); let first;
        for (let i = 0; i < 200; i++) { const template = saveSopTemplate(db, sample({ name: '限额模板' + i, steps: [{ text: '核对' }] })); first ||= template; }
        assert.throws(() => saveSopTemplate(db, sample({ name: '超额' })), { code: 'conflict' });
        for (let i = 0; i < 1000; i++) start(db, first);
        assert.throws(() => start(db, first), { code: 'conflict' }); assert.equal(listSopRuns(db).total, 1000);
        const old = getSopRun(db, listSopRuns(db).items[0].id); db.prepare('UPDATE kb_sop_runs SET notes=? WHERE id=?').run('x'.repeat(8 * 1024 * 1024), old.id);
        assert.throws(() => saveSopTemplate(db, { ...first, description: '增加占用' }, first.id), { code: 'conflict' }); assert.equal(getSopTemplate(db, first.id).description, first.description);
    });
    test('真实009到当前版本升级保留文档和计算方案，文件库重启后恢复执行进度', async t => {
        const root = mkdtempSync(join(tmpdir(), 'tt-sop-migration-')), path = join(root, 'state.sqlite3'), migrations = join(root, 'migrations'), connections = [];
        t.after(() => { for (const db of connections) if (db.open) db.close(); rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); }); mkdirSync(migrations);
        const actual = fileURLToPath(new URL('./migrations/', import.meta.url)); for (const file of readdirSync(actual).filter(file => /^00\d_.*\.sql$/.test(file))) copyFileSync(join(actual, file), join(migrations, file));
        const db = createTestingDatabase({ path }); connections.push(db); assert.deepEqual((await runMigrations({ connection: db, migrationsDir: migrations })).errors, []); createDocument({ connection: db, title: '迁移保留文档' });
        const upgraded = await runMigrations({ connection: db }); assert.deepEqual(upgraded.versions, [10, 11, 12]); assert.equal(db.prepare('SELECT title FROM documents').get().title, '迁移保留文档'); assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE name='quick_calculations'").get());
        const template = saveSopTemplate(db, sample()), run = start(db, template); changeSopRun(db, run.id, { version: run.version, stepId: run.steps[0].id, done: true }); db.close();
        const reopened = createTestingDatabase({ path }); connections.push(reopened); assert.equal(getSopRun(reopened, run.id).steps[0].done, true); assert.equal(listSopTemplates(reopened).length, 1);
    });
});

async function apiFixture(t, extra = {}) {
    const db = await database(t), logs = [], app = express(); registerKnowledgeSopsApi(app, { getDb: () => db, log: value => logs.push(value), ...extra });
    const server = await new Promise(done => { const s = app.listen(0, '127.0.0.1', () => done(s)); }); t.after(() => { server.closeAllConnections(); return new Promise(done => server.close(done)); });
    const base = `http://127.0.0.1:${server.address().port}`;
    const request = (path = '/templates', method = 'GET', body, headers = {}) => fetch(base + '/api/knowledge-sops' + path, { method, headers: { Origin: base, 'X-Toolbox-SOP': '1', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers }, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
    return { db, logs, request };
}
describe('SOP接口和备份', () => {
    test('HTTP模板/执行/勾选/完成/删除及失败后重试', async t => {
        const f = await apiFixture(t), response = await f.request('/templates', 'POST', sample()); assert.equal(response.status, 201); assert.equal(response.headers.get('cache-control'), 'no-store'); const template = await response.json();
        const started = await f.request(`/templates/${template.id}/runs`, 'POST', { version: 1, requestId: randomUUID() }); assert.equal(started.status, 201); let run = (await started.json()).item;
        assert.equal((await f.request(`/runs/${run.id}`, 'PATCH', { version: run.version, complete: true })).status, 400);
        for (const step of run.steps) { const response = await f.request(`/runs/${run.id}`, 'PATCH', { version: run.version, stepId: step.id, done: true }); assert.equal(response.status, 200); run = await response.json(); }
        const finished = await f.request(`/runs/${run.id}`, 'PATCH', { version: run.version, complete: true }); run = await finished.json(); assert.equal(run.status, 'completed');
        assert.equal((await f.request(`/runs/${run.id}`, 'PATCH', { version: run.version, notes: '无法修改' })).status, 409);
        assert.equal((await f.request(`/templates/${template.id}?version=1`, 'DELETE')).status, 400);
        assert.equal((await f.request(`/templates/${template.id}?version=1&confirm=1`, 'DELETE')).status, 200); assert.equal((await (await f.request(`/runs/${run.id}`)).json()).templateId, null);
        assert.equal((await f.request(`/runs/${run.id}?version=${run.version}&confirm=1`, 'DELETE')).status, 200); assert.equal(listSopRuns(f.db).total, 0);
    });
    test('同源/专用头、JSON限制、坏查询和多操作请求被拒绝', async t => {
        const f = await apiFixture(t);
        for (const headers of [{ 'X-Toolbox-SOP': '' }, { Origin: 'https://foreign.invalid' }, { 'Sec-Fetch-Site': 'cross-site' }]) assert.equal((await f.request('/templates', 'POST', sample(), headers)).status, 403);
        for (const body of ['{broken', [], sample({ extra: true }), sample({ name: '' })]) assert.equal((await f.request('/templates', 'POST', body)).status, 400);
        assert.equal((await f.request('/templates', 'POST', sample({ description: 'x'.repeat(130 * 1024) }))).status, 413);
        for (const path of ['/templates?extra=1', '/runs?offset=NaN', '/runs?status=hidden', '/templates/not-an-id']) assert.equal((await f.request(path)).status, 400);
        const template = saveSopTemplate(f.db, sample()), run = start(f.db, template);
        assert.equal((await f.request(`/runs/${run.id}`, 'PATCH', { version: 1, stepId: run.steps[0].id, done: true, notes: '两个动作' })).status, 400);
        assert.equal((await f.request(`/runs/${run.id}`, 'PATCH', { version: 1, done: true })).status, 400); assert.equal(getSopRun(f.db, run.id).version, 1);
        assert.doesNotMatch(f.logs.join('\n'), /发布检查|两个动作/);
    });
    test('存储故障脱敏，日志不含步骤和路径', async t => {
        const f = await apiFixture(t, { getDb: () => { throw new Error('C:/private/secret.sqlite3'); } }); const response = await f.request(); assert.equal(response.status, 503); assert.doesNotMatch(await response.text(), /private|secret/); assert.doesNotMatch(f.logs.join('\n'), /private|secret/);
    });
    test('JSON快照往返保留历史、备注和状态，重复导入不覆盖，旧备份兼容', async t => {
        const db = await database(t), template = saveSopTemplate(db, sample()); let run = start(db, template); run = changeSopRun(db, run.id, { version: 1, notes: '验收备注' }); run = complete(db, run);
        const snapshot = exportSnapshot({ connection: db }), other = await database(t), result = importSnapshot({ connection: other, snapshot }); assert.deepEqual(result.sops, { templates: 1, runs: 1, skipped: 0 });
        assert.deepEqual(exportSops(other), exportSops(db)); const repeated = importSnapshot({ connection: other, snapshot }); assert.deepEqual(repeated.sops, { templates: 0, runs: 0, skipped: 2 });
        const old = { ...snapshot }; delete old.sops; assert.doesNotThrow(() => importSnapshot({ connection: other, snapshot: old })); assert.equal(getSopRun(other, run.id).notes, '验收备注');
        deleteSopTemplate(db, template.id, 1); const detached = exportSnapshot({ connection: db }), target = await database(t); importSnapshot({ connection: target, snapshot: detached }); assert.equal(getSopRun(target, run.id).templateId, null);
    });
    test('损坏SOP备份在任何文档或分类写入前拒绝，同名模板跳过保留原内容', async t => {
        const db = await database(t), template = saveSopTemplate(db, sample()), run = start(db, template), sops = exportSops(db);
        const invalids = [null, {}, { templates: [null], runs: [] }, { templates: [], runs: [null] }, { templates: [], runs: [{ ...run, steps: {} }] }, { templates: [], runs: [{ ...run, steps: [null] }] }, { templates: [], runs: [{ ...run, status: 'completed', completedAt: new Date().toISOString() }] }, { ...sops, templates: [{ ...template, createdAt: 'broken' }] }];
        for (const value of invalids) assert.throws(() => importSnapshot({ connection: db, snapshot: { documents: [{ title: '不能新增' }], categories: ['不能新增分类'], sops: value } }), { code: 'invalid_input' });
        assert.equal(db.prepare('SELECT COUNT(*) AS n FROM documents').get().n, 0); assert.equal(db.prepare('SELECT COUNT(*) AS n FROM categories').get().n, 0);
        const other = await database(t); saveSopTemplate(other, sample({ description: '现有内容' })); const stats = importSnapshot({ connection: other, snapshot: { documents: [], sops } }).sops;
        assert.equal(stats.templates, 0); assert.equal(stats.runs, 1); assert.equal(listSopTemplates(other)[0].description, '现有内容'); assert.equal(getSopRun(other, run.id).templateId, null); assert.deepEqual(validateSopBackup(undefined), { templates: [], runs: [] });
    });
    test('全量ZIP真实导出、解压和恢复包含SOP记录', async t => {
        const root = mkdtempSync(join(tmpdir(), 'tt-sop-zip-')), previous = process.env.UPLOAD_DIR; process.env.UPLOAD_DIR = join(root, 'uploads');
        t.after(() => { if (previous === undefined) delete process.env.UPLOAD_DIR; else process.env.UPLOAD_DIR = previous; rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); });
        const { exportFullBackup } = await import('./full-backup.js'), { extractFullBackup, restoreFullBackup } = await import('./full-backup-restore.js');
        const source = await database(t), template = saveSopTemplate(source, sample()), run = start(source, template); changeSopRun(source, run.id, { version: 1, stepId: run.steps[0].id, done: true });
        const chunks = [], stream = new PassThrough(); stream.setHeader = () => {}; stream.on('data', chunk => chunks.push(chunk)); const built = await exportFullBackup({ connection: source, res: stream }); assert.equal(built.manifest.counts.sop_templates, 1); assert.equal(built.manifest.counts.sop_runs, 1);
        const zip = join(root, 'backup.zip'), extractTo = join(root, 'extracted'); writeFileSync(zip, Buffer.concat(chunks)); mkdirSync(extractTo); const extracted = await extractFullBackup(zip, extractTo), target = await database(t);
        const result = restoreFullBackup({ connection: target, extracted, extractTo, assetsRoot: join(root, 'assets') }); assert.equal(result.documents.sops.runs, 1); assert.equal(getSopRun(target, run.id).steps[0].done, true);
    });
});
