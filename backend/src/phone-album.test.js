// 真流、内存数据库和临时资源目录；不读写真实团队数据或手机。
import { test, beforeEach, afterEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, Readable } from 'node:stream';
import { createHash, randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { request } from 'node:http';

const root = mkdtempSync(join(tmpdir(), 'tt-phone-album-test-'));
process.env.ASSET_DIR = join(root, 'assets');
const { default: Database } = await import('better-sqlite3');
const { default: express } = await import('express');
const { runMigrations } = await import('./migrate.js');
const { createPhoneAlbumService } = await import('./phone-album.js');
const { registerPhoneAlbumApi } = await import('./phone-album-api.js');
const { registerAssetApi } = await import('./asset-api.js');
const { createToolAccess } = await import('./tool-access.js');
const { validateAlbumFile, verifyAlbumHeader } = await import('./phone-album-protocol.js');
const { createFolder } = await import('./asset-store.js');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const metadata = (name = '相片.png', size = png.length) => ({ id: randomBytes(16).toString('hex'), name, size });
const limits = { fileBytes: 1024 * 1024, totalBytes: 2 * 1024 * 1024, uploadMs: 2000, idleMs: 500 };
let db, services, servers;
beforeEach(async () => { db = new Database(':memory:'); db.pragma('foreign_keys = ON'); await runMigrations({ connection: db }); services = []; servers = []; });
afterEach(async () => {
    await Promise.all(services.map(service => service.dispose()));
    for (const server of servers) { server.closeAllConnections(); await new Promise(done => server.close(done)); }
    db.close(); rmSync(process.env.ASSET_DIR, { recursive: true, force: true });
});
after(() => rmSync(root, { recursive: true, force: true }));
function service(options = {}) { const value = createPhoneAlbumService({ getDb: () => db, limits, postprocess() {}, log() {}, ...options }); services.push(value); return value; }
const session = svc => svc.create({ folderId: null });
const count = () => db.prepare('SELECT COUNT(*) AS count FROM assets').get().count;
const temporaryFiles = () => { try { return readdirSync(process.env.ASSET_DIR).filter(name => name.startsWith('.phone-upload-')); } catch { return []; } };
async function until(fn) { for (let n = 0; n < 200; n++) { if (fn()) return; await delay(5); } assert.fail('临时传输未进入预期状态'); }
const send = (svc, s, file = metadata(), bytes = png, signal) => svc.upload(Readable.from([bytes]), s.id, s.uploadToken, file, signal);

test('只接收有界媒体，拒绝文件路径、额外字段、空文件和伪装内容', () => {
    for (const bad of [{ ...metadata(), name: '../a.png' }, { ...metadata(), name: 'a\\b.png' }, { ...metadata(), name: 'a\n.png' }, { ...metadata(), assetId: 1 }, metadata('a.html'), metadata('a.png', 0), metadata('a.png', limits.fileBytes + 1), { ...metadata(), id: 'bad' }]) assert.throws(() => validateAlbumFile(bad, limits));
    assert.equal(validateAlbumFile(metadata('相册.HEIC')).mime, 'image/heic');
    assert.doesNotThrow(() => verifyAlbumHeader(png, '.png'));
    for (const ext of ['.png', '.jpg', '.gif', '.webp', '.bmp', '.avif', '.heic', '.mp4', '.webm']) assert.throws(() => verifyAlbumHeader(Buffer.from('<html>not media</html>'), ext));
    const heic = Buffer.alloc(24); heic.writeUInt32BE(24); heic.write('ftypheic', 4);
    assert.doesNotThrow(() => verifyAlbumHeader(heic, '.heic')); assert.throws(() => verifyAlbumHeader(heic, '.avif'));
});

test('流式入库原件、散列、文件夹、草稿及同名独立资源', async () => {
    const svc = service(), folder = createFolder({ connection: db, name: '手机相册' });
    const s = svc.create({ folderId: folder.id }), first = await send(svc, s), second = await send(svc, s);
    assert.notEqual(first.assetId, second.assetId); assert.equal(count(), 2);
    const asset = db.prepare('SELECT * FROM assets WHERE id=?').get(first.assetId);
    const version = db.prepare('SELECT * FROM asset_versions WHERE id=?').get(first.versionId);
    assert.equal(asset.folder_id, folder.id); assert.equal(asset.status, 'draft'); assert.equal(asset.published_version_id, null);
    assert.equal(version.sha256, createHash('sha256').update(png).digest('hex'));
    assert.match(version.original_storage_key, /^\d+\/\d+\/original\d+-[a-f0-9]{16}\.png$/);
    assert.deepEqual(readFileSync(join(process.env.ASSET_DIR, version.original_storage_key)), png);
    assert.equal(svc.status(s.id, s.uploadToken).bytes, png.length * 2); assert.deepEqual(temporaryFiles(), []);
});

test('同一文件编号回执幂等；编号冲突不能覆盖，上传票据不能管理', async () => {
    const svc = service(), s = session(svc), file = metadata(), saved = await send(svc, s, file);
    assert.deepEqual(await send(svc, s, file), saved); assert.equal(count(), 1);
    await assert.rejects(send(svc, s, { ...file, name: '另一张.png' }), { code: 'conflict' });
    assert.throws(() => svc.status(s.id, s.manageToken), { code: 'session_unavailable' });
    await assert.rejects(svc.stop(s.id, s.uploadToken), { code: 'session_unavailable' });
    const snapshot = svc.status(s.id, s.manageToken, 'manage');
    assert.ok(!JSON.stringify(snapshot).includes(s.uploadToken)); assert.ok(!JSON.stringify(snapshot).includes(s.manageToken));
    await svc.stop(s.id, s.manageToken); assert.equal(count(), 1);
    await assert.rejects(send(svc, s), { code: 'session_closed' });
});

test('文件数量、总字节、会话数量均有上限，关闭后可重新创建', async () => {
    const svc = service({ limits: { ...limits, files: 1, sessions: 1 } }), s = session(svc);
    assert.throws(() => session(svc), { code: 'session_limit' });
    await send(svc, s); await assert.rejects(send(svc, s), { code: 'file_limit' });
    await svc.stop(s.id, s.manageToken); assert.ok(session(svc).id);
    const total = service({ limits: { ...limits, totalBytes: png.length } }), t = session(total);
    await send(total, t); await assert.rejects(send(total, t), { code: 'total_limit' });
    assert.throws(() => svc.create({ folderId: null, path: 'C:/untrusted' }), { code: 'invalid_input' });
});

test('活动文件全局限流、重复请求忙碌、取消后释放保留字节且可重试', async () => {
    const svc = service({ limits: { ...limits, concurrent: 1, totalBytes: png.length } }), s = session(svc), file = metadata(), input = new PassThrough(), controller = new AbortController();
    const pending = svc.upload(input, s.id, s.uploadToken, file, controller.signal);
    const rejected = assert.rejects(pending, { code: 'cancelled' });
    input.write(png.subarray(0, 8)); await until(() => svc.status(s.id, s.uploadToken).items[0]?.received === 8);
    await assert.rejects(send(svc, s, file), { code: 'busy' });
    const another = session(svc); await assert.rejects(send(svc, another), { code: 'busy' });
    controller.abort(); await rejected;
    assert.equal(count(), 0); assert.deepEqual(temporaryFiles(), []);
    await send(svc, s, file); assert.equal(count(), 1);
});

test('内容不完整、超出声明大小、伪装内容均不产生资源或暂存残留', async () => {
    const svc = service(), s = session(svc);
    for (const [file, bytes, code] of [[metadata('a.png', png.length + 1), png, 'size_mismatch'], [metadata('a.png', 8), png, 'file_limit'], [metadata('a.png', 16), Buffer.alloc(16), 'invalid_media']]) await assert.rejects(send(svc, s, file, bytes), { code });
    assert.equal(count(), 0); assert.deepEqual(temporaryFiles(), []);
});

test('目标文件夹在传输中删除：拒绝提交，不回退到其他目录', async () => {
    const svc = service(), folder = createFolder({ connection: db, name: '临时目标' }), s = svc.create({ folderId: folder.id });
    const input = new PassThrough(), pending = svc.upload(input, s.id, s.uploadToken, metadata());
    const rejected = assert.rejects(pending, { code: 'folder_missing' });
    input.write(png.subarray(0, 8)); await until(() => svc.status(s.id, s.uploadToken).items[0]?.received === 8);
    db.prepare('DELETE FROM asset_folders WHERE id=?').run(folder.id); input.end(png.subarray(8));
    await rejected; assert.equal(count(), 0); assert.deepEqual(temporaryFiles(), []);
});

for (const mode of ['disconnect', 'stop', 'dispose', 'idle', 'timeout', 'expiry']) test(`${mode}中止在途文件并清理，无幽灵资源`, async () => {
    let clock = Date.now();
    const svc = service({ now: () => clock, limits: { ...limits, ttlMs: 100, idleMs: mode === 'idle' ? 35 : 500, uploadMs: mode === 'timeout' ? 40 : 2000 } });
    const s = session(svc), input = new PassThrough();
    const pending = svc.upload(input, s.id, s.uploadToken, metadata());
    const rejected = assert.rejects(pending, error => ['cancelled', 'upload_timeout'].includes(error.code));
    input.write(png.subarray(0, 8)); await until(() => svc.status(s.id, s.uploadToken).items[0]?.received === 8);
    if (mode === 'disconnect') input.emit('aborted');
    if (mode === 'stop') await svc.stop(s.id, s.manageToken);
    if (mode === 'dispose') await svc.dispose();
    if (mode === 'expiry') { clock += 101; assert.throws(() => svc.status(s.id, s.uploadToken), { code: 'session_unavailable' }); }
    await rejected; assert.equal(count(), 0); assert.deepEqual(temporaryFiles(), []);
    input.destroy();
});

test('事务失败回滚文件和记录；关闭等待后处理，错误日志不含名称或票据', async () => {
    const logs = [], svc = service({ log: code => logs.push(code) }), s = session(svc);
    db.exec("CREATE TRIGGER fail_album BEFORE UPDATE OF original_storage_key ON asset_versions BEGIN SELECT RAISE(ABORT, 'synthetic'); END");
    await assert.rejects(send(svc, s), { code: 'upload_failed' });
    assert.equal(count(), 0); assert.equal(db.prepare('SELECT COUNT(*) AS n FROM asset_versions').get().n, 0);
    assert.ok(!JSON.stringify(logs).includes(s.uploadToken)); assert.deepEqual(temporaryFiles(), []);
    db.exec('DROP TRIGGER fail_album');
    let finished = false; const processing = service({ postprocess: async () => { await delay(25); finished = true; } });
    await send(processing, session(processing)); await processing.dispose(); assert.equal(finished, true);
});

async function api(allowLan = true) {
    const app = express(), svc = service();
    const access = createToolAccess({ allowLan, interfaces: () => ({ test: [{ address: '192.168.20.9', netmask: '255.255.255.0', family: 'IPv4', internal: false }] }) });
    app.use(access.middleware); registerPhoneAlbumApi(app, { getDb: () => db, access, service: svc });
    app.use(express.json()); registerAssetApi(app, { getDb: () => db });
    const server = await new Promise(done => { const listener = app.listen(0, '127.0.0.1', () => done(listener)); }); servers.push(server);
    const base = `http://127.0.0.1:${server.address().port}`;
    const call = async (path, options = {}) => { const res = await fetch(base + '/api/phone-album' + path, { ...options, headers: { 'X-Toolbox-Album': '1', ...options.headers } }); return { status: res.status, body: await res.json(), headers: res.headers }; };
    const created = async () => { const result = await call('/sessions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"folderId":null}' }); assert.equal(result.status, 201); return result.body; };
    const fileHeaders = (s, file) => ({ 'X-Toolbox-Album': '1', 'X-Toolbox-Album-Token': s.uploadToken, 'X-Toolbox-Album-File': encodeURIComponent(JSON.stringify(file)), 'Content-Type': 'application/octet-stream' });
    return { base, call, created, fileHeaders, svc };
}

test('HTTP：Lan真实地址、同源/专用头、票据分权、JSON错误和原件下载', async () => {
    const { base, call, created, fileHeaders } = await api(), config = await call('/config');
    assert.equal(config.body.allowLan, true); assert.deepEqual(config.body.origins, [`http://192.168.20.9:${new URL(base).port}`]); assert.equal(config.headers.get('cache-control'), 'no-store');
    for (const headers of [{ 'X-Toolbox-Album': '' }, { Origin: 'https://evil.example' }, { 'Sec-Fetch-Site': 'cross-site' }]) assert.equal((await call('/config', { headers })).status, 403, JSON.stringify(headers));
    // fetch 会忽略 Host 覆盖；用原生 HTTP 发送真实的恶意 Host。
    const wrongHost = await new Promise((done, reject) => { const operation = request(base + '/api/phone-album/config', { headers: { Host: 'evil.example', 'X-Toolbox-Album': '1' } }, response => { response.resume(); response.on('end', () => done(response.statusCode)); }); operation.on('error', reject); operation.end(); });
    assert.equal(wrongHost, 403);
    assert.equal((await call('/config?token=secret')).status, 403);
    for (const body of ['{broken', JSON.stringify({ folderId: null, extra: 'a'.repeat(3000) })]) assert.ok([400, 413].includes((await call('/sessions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })).status));
    const s = await created(), file = metadata();
    assert.equal((await call(`/sessions/${s.id}`)).status, 410);
    assert.equal((await call(`/sessions/${s.id}`, { method: 'DELETE', headers: { 'X-Toolbox-Album-Token': s.uploadToken } })).status, 410);
    const result = await call(`/sessions/${s.id}/files`, { method: 'POST', headers: fileHeaders(s, file), body: png });
    assert.equal(result.status, 201); assert.equal(count(), 1);
    const original = await fetch(base + `/api/assets/files/${result.body.assetId}/original/latest?download=1`);
    assert.equal(original.status, 200); assert.deepEqual(Buffer.from(await original.arrayBuffer()), png);
    assert.equal((await call(`/sessions/${s.id}/files`, { method: 'POST', headers: fileHeaders(s, file), body: png })).body.assetId, result.body.assetId); assert.equal(count(), 1);
    assert.equal((await call(`/sessions/${s.id}`, { method: 'DELETE', headers: { 'X-Toolbox-Album-Manage': s.manageToken } })).status, 200);
});

test('Local模式明确拒绝创建手机会话', async () => {
    const { call } = await api(false);
    assert.equal((await call('/config')).body.allowLan, false);
    assert.equal((await call('/sessions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"folderId":null}' })).status, 409);
});

test('真实HTTP断连中止磁盘流，释放后可重试而不是挂起', async () => {
    const { base, created, fileHeaders, svc } = await api(), s = await created(), file = metadata();
    const req = request(base + `/api/phone-album/sessions/${s.id}/files`, { method: 'POST', headers: fileHeaders(s, file) }); req.on('error', () => {}); req.write(png.subarray(0, 8));
    await until(() => svc.status(s.id, s.uploadToken).items[0]?.received === 8); req.destroy();
    await until(() => svc.status(s.id, s.uploadToken).items[0]?.status === 'failed' && temporaryFiles().length === 0);
    assert.equal(count(), 0); await send(svc, s, file); assert.equal(count(), 1);
});
