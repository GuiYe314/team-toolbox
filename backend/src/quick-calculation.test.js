// 快速计算：真实十进制结果、SQLite迁移/持久化、HTTP边界与备份往返。
// 所有数据库、上传目录和ZIP均使用内存或系统临时目录。
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, copyFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PassThrough } from 'node:stream';
import { request as httpRequest } from 'node:http';
import express from 'express';
import { createTestingDatabase } from './db.js';
import { runMigrations } from './migrate.js';
import { normalizeCalculation, calculateRange } from './quick-calculation-math.js';
import { saveCalculation, listCalculations, deleteCalculation, validateCalculationBackup } from './quick-calculation-store.js';
import { registerQuickCalculationApi } from './quick-calculation-api.js';
import { createDocument, exportSnapshot, importSnapshot } from './store.js';

const sample = (extra = {}) => ({ base: '27.75', rate: '0.02', rateMode: 'ratio', count: 10, precision: 6, ...extra });
function directory(t) {
    const root = mkdtempSync(join(tmpdir(), 'tt-quick-calculation-')), connections = [];
    t.after(() => { for (const db of connections) if (db.open) db.close(); rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); });
    return { root, connections };
}
async function database(t, path) {
    const db = createTestingDatabase(path ? { path } : { memory: true });
    t.after(() => { if (db.open) db.close(); });
    const migration = await runMigrations({ connection: db }); assert.deepEqual(migration.errors, []);
    return db;
}
function invalid(value) { assert.throws(() => calculateRange(value), { code: 'invalid_input' }); }

describe('快速计算的精确数值', () => {
    test('截图27.75上下2%，两组10个含端点，逐项一致', () => {
        const value = calculateRange(sample());
        assert.equal(value.lower, '27.195000'); assert.equal(value.base, '27.750000'); assert.equal(value.upper, '28.305000'); assert.equal(value.percentage, '2');
        assert.deepEqual(value.rows.map(row => row.down), ['27.195000', '27.256667', '27.318333', '27.380000', '27.441667', '27.503333', '27.565000', '27.626667', '27.688333', '27.750000']);
        assert.deepEqual(value.rows.map(row => row.up), ['27.750000', '27.811667', '27.873333', '27.935000', '27.996667', '28.058333', '28.120000', '28.181667', '28.243333', '28.305000']);
        assert.deepEqual(value.rows.map(row => row.index), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]); assert.equal(value.roundedDuplicates, false);
        assert.doesNotThrow(() => JSON.stringify(value));
    });
    test('倍率0.02与百分比2结果等价；原始2.58示例无浮点尾数', () => {
        assert.deepEqual(calculateRange(sample({ rateMode: 'percent', rate: '2' })).rows, calculateRange(sample()).rows);
        const value = calculateRange(sample({ base: '2.58', count: 3 }));
        assert.deepEqual(value.rows.map(row => [row.down, row.up]), [['2.528400', '2.580000'], ['2.554200', '2.605800'], ['2.580000', '2.631600']]);
    });
    test('负基准按绝对值浮动，跨零区间仍递增', () => {
        const negative = calculateRange(sample({ base: '-2.58', count: 2 }));
        assert.equal(negative.lower, '-2.631600'); assert.equal(negative.upper, '-2.528400');
        const cross = calculateRange(sample({ base: '1', rate: '2', count: 3, precision: 2 }));
        assert.deepEqual(cross.rows.map(row => row.down), ['-1.00', '0.00', '1.00']); assert.deepEqual(cross.rows.map(row => row.up), ['1.00', '2.00', '3.00']);
    });
    test('四舍五入含正负半值，零不带负号', () => {
        for (const [base, precision, expected] of [['1.005', 2, '1.01'], ['-1.005', 2, '-1.01'], ['-2.5', 0, '-3'], ['0.0005', 3, '0.001'], ['-0.0004', 3, '0.000'], ['-0', 6, '0.000000']]) {
            assert.equal(calculateRange(sample({ base, rate: '0', precision })).base, expected);
        }
    });
    test('零基准/零浮动/精度不足提示重复值；精度提高后分开', () => {
        assert.ok(calculateRange(sample({ base: '0' })).roundedDuplicates); assert.ok(calculateRange(sample({ rate: '0' })).roundedDuplicates);
        assert.ok(calculateRange(sample({ precision: 0 })).roundedDuplicates); assert.equal(calculateRange(sample({ precision: 12 })).roundedDuplicates, false);
    });
    test('数量2与500、精度12和大整数保持精确端点', () => {
        const value = calculateRange(sample({ base: '9999999999999999', rate: '10', count: 500, precision: 12 }));
        assert.equal(value.rows.length, 500); assert.equal(value.lower, '-89999999999999991.000000000000'); assert.equal(value.upper, '109999999999999989.000000000000');
        assert.equal(value.rows[0].down, value.lower); assert.equal(value.rows.at(-1).down, value.base); assert.equal(value.rows[0].up, value.base); assert.equal(value.rows.at(-1).up, value.upper);
        const asInteger = text => BigInt(text.replace('.', ''));
        assert.ok(value.rows.every((row, i, rows) => !i || asInteger(row.down) >= asInteger(rows[i - 1].down) && asInteger(row.up) >= asInteger(rows[i - 1].up)));
        assert.equal(calculateRange(sample({ rateMode: 'percent', rate: '1000', count: 2 })).percentage, '1000');
    });
    test('规范化空白、前导零、正号与小数，最小百分比不丢失', () => {
        assert.deepEqual(normalizeCalculation(sample({ base: ' +0027.7500 ', rate: '.0200' })), sample());
        assert.equal(normalizeCalculation(sample({ base: '-0.00', rate: '-0' })).base, '0');
        assert.equal(calculateRange(sample({ rate: '0.000000000001', rateMode: 'percent' })).percentage, '0.000000000001');
    });
    test('拒绝无效数字格式、类型和范围', () => {
        for (const base of ['', ' ', '1e3', 'NaN', 'Infinity', '1,000', '0x10', '1/2', '1.1234567890123', '12345678901234567', '--1', '1\n2', '1'.repeat(49), 27.75, null, {}]) invalid(sample({ base }));
        for (const rate of ['-0.01', '10.000000000001', '1001', 0.02]) invalid(sample({ rate }));
        for (const count of [0, 1, 501, 2.5, '10', null, NaN, Infinity]) invalid(sample({ count }));
        for (const precision of [-1, 13, 1.5, '6', null]) invalid(sample({ precision }));
        for (const rateMode of ['', 'multiply', null]) invalid(sample({ rateMode }));
        for (const value of [null, [], 'value', {}]) invalid(value);
    });
});

describe('计算方案持久化与迁移', () => {
    test('真实008升级009保留文档，重新打开数据库仍可计算和删除', async t => {
        const fixture = directory(t), { root } = fixture, path = join(root, 'state.sqlite3'), oldMigrations = join(root, 'old-migrations'); mkdirSync(oldMigrations);
        const migrations = fileURLToPath(new URL('./migrations/', import.meta.url));
        for (const file of readdirSync(migrations).filter(file => /^00[1-8]_.*\.sql$/.test(file))) copyFileSync(join(migrations, file), join(oldMigrations, file));
        const db = createTestingDatabase({ path }); fixture.connections.push(db);
        assert.deepEqual((await runMigrations({ connection: db, migrationsDir: oldMigrations })).versions, [1, 2, 3, 4, 5, 6, 7, 8]);
        createDocument({ connection: db, title: '保留的测试文档', content_md: '迁移前正文' });
        const upgraded = await runMigrations({ connection: db }); assert.deepEqual(upgraded.errors, []); assert.ok(upgraded.versions.includes(9));
        assert.equal(db.prepare('SELECT content_md FROM documents').get().content_md, '迁移前正文');
        const saved = saveCalculation(db, { name: '截图示例', ...sample() }).item; db.close();
        const reopened = await database(t, path); fixture.connections.push(reopened); assert.equal(listCalculations(reopened)[0].id, saved.id); assert.equal(calculateRange(listCalculations(reopened)[0]).upper, '28.305000');
        deleteCalculation(reopened, saved.id); assert.deepEqual(listCalculations(reopened), []);
    });
    test('重复保存幂等、同名不同参数拒绝，名称规范化与列表顺序', async t => {
        const db = await database(t), first = saveCalculation(db, { name: ' 测试Ａ ', ...sample({ base: '27.7500' }) });
        assert.ok(first.created); assert.match(first.item.createdAt, /^\d{4}-\d{2}-\d{2}T/);
        const again = saveCalculation(db, { name: '测试a', ...sample() }); assert.equal(again.created, false); assert.equal(again.item.id, first.item.id);
        assert.throws(() => saveCalculation(db, { name: '测试a', ...sample({ count: 2 }) }), { code: 'conflict' });
        const other = saveCalculation(db, { name: '另一个', ...sample({ count: 2 }) }); assert.deepEqual(listCalculations(db).map(item => item.id), [other.item.id, first.item.id]);
        for (const name of ['', ' ', 'a'.repeat(61), '有\n换行', '\u200b', 123]) assert.throws(() => saveCalculation(db, { name, ...sample() }), { code: 'invalid_input' });
        assert.equal(listCalculations(db).length, 2);
    });
    test('最多500方案，重复保存不占位；删除后可新建，错误删除不影响其他记录', async t => {
        const db = await database(t);
        for (let i = 0; i < 500; i++) saveCalculation(db, { name: `方案${i}`, ...sample() });
        assert.equal(listCalculations(db).length, 500); assert.equal(saveCalculation(db, { name: '方案0', ...sample() }).created, false);
        assert.throws(() => saveCalculation(db, { name: '超额', ...sample() }), { code: 'conflict' });
        for (const id of [0, -1, 1.2, '1', Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => deleteCalculation(db, id), { code: 'invalid_input' });
        assert.throws(() => deleteCalculation(db, 99999), { code: 'not_found' });
        const id = listCalculations(db)[0].id; deleteCalculation(db, id); assert.ok(saveCalculation(db, { name: '腾出位置', ...sample() }).created); assert.equal(listCalculations(db).length, 500);
    });
});

async function apiFixture(t, extra = {}) {
    const db = await database(t), logs = [], app = express();
    registerQuickCalculationApi(app, { getDb: () => db, log: message => logs.push(message), ...extra });
    const server = await new Promise(done => { const listener = app.listen(0, '127.0.0.1', () => done(listener)); });
    t.after(() => { server.closeAllConnections(); return new Promise(done => server.close(done)); });
    const base = `http://127.0.0.1:${server.address().port}`;
    // 原始HTTP允许真实发送Host，避免fetch将测试头改写后出现假阳性。
    const request = (path = '', method = 'GET', body, headers = {}) => new Promise((done, reject) => {
        const req = httpRequest(base + '/api/quick-calculations' + path, { method, headers: { Origin: base, 'X-Toolbox-Calculation': '1', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers } }, res => {
            const chunks = []; res.on('data', chunk => chunks.push(chunk)); res.on('end', () => done(new Response(Buffer.concat(chunks), { status: res.statusCode, headers: res.headers })));
        });
        req.on('error', reject); req.end(body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body));
    });
    return { db, logs, request };
}
describe('快速计算HTTP接口', () => {
    test('真实接口计算/保存/重读/确认删除，响应不缓存', async t => {
        const f = await apiFixture(t), preview = await f.request('/preview', 'POST', sample());
        assert.equal(preview.status, 200); assert.equal(preview.headers.get('cache-control'), 'no-store'); assert.equal(preview.headers.get('x-content-type-options'), 'nosniff'); assert.equal((await preview.json()).lower, '27.195000');
        const created = await f.request('', 'POST', { name: 'HTTP示例', ...sample() }); assert.equal(created.status, 201); const saved = (await created.json()).item;
        assert.equal((await f.request('', 'POST', { name: 'HTTP示例', ...sample() })).status, 200);
        assert.equal((await f.request('', 'POST', { name: 'HTTP示例', ...sample({ count: 2 }) })).status, 409);
        assert.equal((await (await f.request()).json()).items[0].id, saved.id);
        for (const suffix of ['', '?confirm=0', '?confirm=1&extra=1', '?confirm=1&confirm=1']) assert.equal((await f.request('/' + saved.id + suffix, 'DELETE')).status, 400);
        assert.equal(listCalculations(f.db).length, 1);
        assert.equal((await f.request('/' + saved.id + '?confirm=1', 'DELETE')).status, 200); assert.equal(listCalculations(f.db).length, 0);
        assert.equal((await f.request('/' + saved.id + '?confirm=1', 'DELETE')).status, 404);
        for (const id of ['0', '-1', '1.1', '1e2', '1000000000000000']) assert.equal((await f.request('/' + id + '?confirm=1', 'DELETE')).status, 400);
    });
    test('专用头、Origin、Host和Fetch来源保护；伪造转发头不能绕过', async t => {
        const f = await apiFixture(t);
        for (const headers of [{ 'X-Toolbox-Calculation': '' }, { Origin: 'https://foreign.invalid' }, { Host: 'foreign.invalid', 'X-Forwarded-Host': 'localhost', 'X-Forwarded-For': '127.0.0.1' }, { 'Sec-Fetch-Site': 'cross-site' }]) {
            assert.equal((await f.request('', 'POST', { name: '不应保存', ...sample() }, headers)).status, 403);
        }
        assert.equal(listCalculations(f.db).length, 0);
    });
    test('限定JSON大小、字段、数量、单位和方法，失败可重试', async t => {
        const f = await apiFixture(t);
        for (const body of [[], '{broken', 'null', sample({ base: '1e3' }), sample({ path: 'C:/private' }), sample({ count: 501 }), sample({ rateMode: 'other' })]) assert.equal((await f.request('/preview', 'POST', body)).status, 400);
        assert.equal((await f.request('/preview?extra=1', 'POST', sample())).status, 400); assert.equal((await f.request('?extra=1')).status, 400);
        assert.equal((await f.request('', 'POST', { name: '不可写', ...sample(), result: {} })).status, 400);
        assert.equal((await f.request('/preview', 'POST', { ...sample(), base: '9'.repeat(9000) })).status, 413);
        assert.equal((await f.request('/preview', 'POST', JSON.stringify(sample()), { 'Content-Type': 'text/plain' })).status, 400);
        assert.equal((await f.request('', 'PUT', { name: '不可改', ...sample() })).status, 404);
        assert.equal(listCalculations(f.db).length, 0); assert.equal((await f.request('/preview', 'POST', sample())).status, 200);
        assert.ok(f.logs.length); assert.doesNotMatch(f.logs.join('\n'), /private|不可写|999999/);
    });
    test('数据库故障不泄露路径和输入，预览仍可用', async t => {
        const f = await apiFixture(t, { getDb: () => { throw new Error('C:/secret/private.sqlite3 原始错误'); } });
        const response = await f.request('', 'POST', { name: '私密输入', ...sample() }); assert.equal(response.status, 503); assert.doesNotMatch(await response.text(), /secret|private|私密输入/);
        assert.doesNotMatch(f.logs.join('\n'), /secret|private|私密输入/); assert.equal((await f.request('/preview', 'POST', sample())).status, 200);
    });
});

describe('计算方案与备份', () => {
    test('JSON往返、旧格式兼容，同名方案跳过且不覆盖', async t => {
        const source = await database(t); createDocument({ connection: source, title: '随方案备份的文档' });
        saveCalculation(source, { name: '示例', ...sample() }); const snapshot = exportSnapshot({ connection: source });
        assert.equal(snapshot.counts.quick_calculations, 1); assert.equal(snapshot.quick_calculations[0].id, undefined); assert.equal(snapshot.quick_calculations[0].rows, undefined);
        const target = await database(t), stats = importSnapshot({ connection: target, snapshot: JSON.parse(JSON.stringify(snapshot)) });
        assert.deepEqual(stats.quick_calculations, { imported: 1, skipped: 0 }); assert.equal(calculateRange(listCalculations(target)[0]).upper, '28.305000');
        const again = importSnapshot({ connection: target, snapshot: { ...snapshot, quick_calculations: [{ name: '示例', ...sample({ base: '100' }) }] } });
        assert.deepEqual(again.quick_calculations, { imported: 0, skipped: 1 }); assert.equal(listCalculations(target)[0].base, '27.75');
        const old = { ...snapshot }; delete old.quick_calculations; delete old.counts.quick_calculations;
        assert.doesNotThrow(() => importSnapshot({ connection: target, snapshot: old })); assert.equal(listCalculations(target).length, 1);
    });
    test('备份新增字段损坏在任何文档/分类写入前拒绝', async t => {
        const db = await database(t);
        for (const quick_calculations of [null, {}, [null], [{ name: '坏方案', ...sample({ count: 501 }) }], Array(501).fill({ name: '超额', ...sample() })]) {
            assert.throws(() => importSnapshot({ connection: db, snapshot: { documents: [{ title: '不能写入' }], categories: ['不能写入分类'], quick_calculations } }), { code: 'invalid_input' });
        }
        assert.equal(db.prepare('SELECT COUNT(*) AS n FROM documents').get().n, 0); assert.equal(db.prepare('SELECT COUNT(*) AS n FROM categories').get().n, 0); assert.deepEqual(validateCalculationBackup(undefined), []);
    });
    test('实际全量ZIP导出、解压、恢复携带计算方案和文档', async t => {
        const { root } = directory(t), previousUploads = process.env.UPLOAD_DIR; process.env.UPLOAD_DIR = join(root, 'uploads');
        t.after(() => { if (previousUploads === undefined) delete process.env.UPLOAD_DIR; else process.env.UPLOAD_DIR = previousUploads; });
        const { exportFullBackup } = await import('./full-backup.js'); const { extractFullBackup, restoreFullBackup } = await import('./full-backup-restore.js');
        const db = await database(t); createDocument({ connection: db, title: 'ZIP测试文档' }); saveCalculation(db, { name: 'ZIP方案', ...sample() });
        const chunks = [], stream = new PassThrough(); stream.setHeader = () => {}; stream.on('data', chunk => chunks.push(chunk));
        const built = await exportFullBackup({ connection: db, res: stream }); assert.equal(built.manifest.counts.quick_calculations, 1);
        const zip = join(root, 'backup.zip'); writeFileSync(zip, Buffer.concat(chunks)); const extractTo = join(root, 'extracted'); mkdirSync(extractTo);
        const extracted = await extractFullBackup(zip, extractTo), target = await database(t);
        const restored = restoreFullBackup({ connection: target, extractTo, extracted, assetsRoot: join(root, 'assets') });
        assert.equal(restored.documents.imported, 1); assert.deepEqual(restored.documents.quick_calculations, { imported: 1, skipped: 0 }); assert.equal(listCalculations(target)[0].name, 'ZIP方案');
        assert.equal(calculateRange(listCalculations(target)[0]).rows[1].down, '27.256667');
    });
});
