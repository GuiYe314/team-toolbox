// 所有文件均在本轮临时目录，不读取用户文件或数据库。
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, symlink, link, rename } from 'node:fs/promises';
import { join, parse } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes, createHash } from 'node:crypto';
import { Readable, PassThrough } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';
import express from 'express';
import { request as httpRequest } from 'node:http';
import { createFileShareService } from './file-share.js';
import { registerFileShareApi } from './file-share-api.js';
import { createToolAccess } from './tool-access.js';
import { shareName, sharePath } from './file-share-paths.js';

let temporary, root, services, servers;
beforeEach(async () => { temporary = await mkdtemp(join(tmpdir(), 'tt-share-test-')); root = join(temporary, '共享'); await mkdir(root); await mkdir(join(temporary, 'staging')); services = []; servers = []; });
afterEach(async () => {
    await Promise.all(services.map(s => s.dispose()));
    for (const server of servers) { server.closeAllConnections(); await new Promise(done => server.close(done)); }
    // 验收路径由mkdtemp产生，且删除前仍在系统临时目录内。
    assert.ok(temporary.startsWith(join(tmpdir(), 'tt-share-test-'))); await rm(temporary, { recursive: true, force: true });
});
const make = options => { const s = createFileShareService({ log() {}, tempRoot: join(temporary, 'staging'), limits: { fileBytes: 1024 * 1024, idleMs: 1000, uploadMs: 3000 }, ...options }); services.push(s); return s; };
const open = (s, extra = {}) => s.create({ root, writable: true, hours: 1, confirm: true, ...extra });
const meta = (name = '文件.txt', size = 3, path = '') => ({ path, name, size, requestId: randomBytes(16).toString('hex') });
const send = (s, share, input = meta(), bytes = Buffer.from('abc'), signal) => s.upload(Readable.from([bytes]), share.id, share.token, input, signal);
const listing = (s, share, path = '') => s.entries(share.id, share.token, path);
// 仅请求本轮127.0.0.1服务；原生HTTP不会误拒绝系统随机分配的浏览器禁用端口，也保留原始测试请求头。
function fetch(url, options = {}) {
    assert.equal(new URL(url).hostname, '127.0.0.1');
    return new Promise((resolve, reject) => {
        const headers = { ...options.headers }; if (options.body !== undefined) headers['Content-Length'] = Buffer.byteLength(options.body);
        const request = httpRequest(url, { method: options.method || 'GET', headers }, response => {
            const chunks = []; response.on('data', chunk => chunks.push(chunk)); response.once('error', reject);
            response.once('end', () => { const bytes = Buffer.concat(chunks); resolve({ status: response.statusCode, headers: new Headers(response.headers), text: async () => bytes.toString(), json: async () => JSON.parse(bytes.toString()) }); });
        });
        request.once('error', reject); request.setTimeout(5000, () => request.destroy(new Error('fixture timeout'))); request.end(options.body);
    });
}

test('共享必须明确确认现有具体目录、布尔权限和固定期限，不接受额外参数', async () => {
    const s = make();
    for (const value of [{ confirm: false }, { confirm: 'true' }, { writable: 'true' }, { hours: 2 }, { root: 'relative' }, { root: parse(root).root }, { root: join(root, 'missing') }, { other: 1 }]) await assert.rejects(open(s, value));
    assert.deepEqual(s.list(), []); const shared = await open(s, { writable: false });
    assert.equal(shared.writable, false); assert.equal(shared.root, root); assert.equal(shared.token.length, 48);
    await assert.rejects(open(s), { code: 'already_shared' });
});

test('拒绝越级、设备名、路径分隔、尾部点空格与内部暂存名', () => {
    for (const name of ['..', '.', 'a/b', 'a\\b', 'x:y', 'a\n', 'CON.txt', 'LPT1', 'NUL', 'a.', 'a ', '.toolbox-share-part']) assert.throws(() => shareName(name));
    for (const path of ['/etc', '../x', 'a/../b', 'a//b', 'a\\b', 'x'.repeat(2049), Array(34).fill('x').join('/')]) assert.throws(() => sharePath(path));
    assert.equal(shareName('中文 文档 (1).zip'), '中文 文档 (1).zip');
});

test('目录有序浏览、中文路径和限制，不返回本机路径或票据', async () => {
    await mkdir(join(root, '子目录')); await writeFile(join(root, '文件10.txt'), 'ten'); await writeFile(join(root, '文件2.txt'), 'two');
    const s = make(), shared = await open(s), result = await listing(s, shared);
    assert.deepEqual(result.items.map(item => item.name), ['子目录', '文件2.txt', '文件10.txt']); assert.equal(result.items[1].size, 3);
    assert.ok(!JSON.stringify(result).includes(root)); assert.ok(!JSON.stringify(result).includes(shared.token));
    assert.deepEqual((await listing(s, shared, '子目录')).items, []);
    const bounded = make({ limits: { entries: 2 } }), other = await open(bounded);
    assert.equal((await listing(bounded, other)).items.length, 2); assert.equal((await listing(bounded, other)).truncated, true);
});

test('链接、目录联接和硬链接无法突破共享根，不能选择链接为根', async () => {
    const outside = join(temporary, 'outside'); await mkdir(outside); await writeFile(join(outside, 'secret.txt'), 'private');
    await symlink(outside, join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
    await link(join(outside, 'secret.txt'), join(root, 'hard.txt'));
    const s = make(), shared = await open(s);
    assert.equal((await listing(s, shared)).items.find(item => item.name === 'linked').type, 'blocked');
    await assert.rejects(listing(s, shared, 'linked'), { code: 'blocked_file' });
    await assert.rejects(s.downloadTicket(shared.id, shared.token, { path: 'hard.txt' }), { code: 'blocked_file' });
    await assert.rejects(s.create({ root: join(root, 'linked'), writable: false, hours: 1, confirm: true }), { code: 'blocked_file' });
    assert.equal(await readFile(join(outside, 'secret.txt'), 'utf8'), 'private');
});

test('只读共享允许浏览，拒绝上传和创建目录；错误票据不能读取', async () => {
    const s = make(), shared = await open(s, { writable: false }); assert.equal((await listing(s, shared)).writable, false);
    await assert.rejects(send(s, shared), { code: 'read_only' }); await assert.rejects(s.newFolder(shared.id, shared.token, { path: '', name: 'x' }), { code: 'read_only' });
    await assert.rejects(s.entries(shared.id, '0'.repeat(48)), { code: 'share_unavailable' });
    assert.deepEqual(await readdir(root), []);
});

test('真实二进制、SHA256、同名自动改名及同请求回执，不覆盖原文件', async () => {
    await writeFile(join(root, '文件.txt'), 'original'); const s = make(), shared = await open(s), file = meta(), result = await send(s, shared, file);
    assert.equal(result.name, '文件 (1).txt'); assert.equal(result.renamed, true); assert.equal(result.sha256, createHash('sha256').update('abc').digest('hex'));
    assert.equal(await readFile(join(root, '文件.txt'), 'utf8'), 'original'); assert.equal(await readFile(join(root, result.name), 'utf8'), 'abc');
    assert.deepEqual(await send(s, shared, file), result); assert.equal((await readdir(root)).length, 2);
    await assert.rejects(send(s, shared, { ...file, name: 'different' }), { code: 'request_conflict' });
    const empty = await send(s, shared, meta('空文件.txt', 0), Buffer.alloc(0)); assert.equal(empty.size, 0);
});

test('子目录上传和新建目录；同名目录报错且无隐式覆盖', async () => {
    const s = make(), shared = await open(s);
    await s.newFolder(shared.id, shared.token, { path: '', name: '子目录' });
    await send(s, shared, meta('文件.txt', 3, '子目录')); assert.equal(await readFile(join(root, '子目录', '文件.txt'), 'utf8'), 'abc');
    await assert.rejects(s.newFolder(shared.id, shared.token, { path: '', name: '子目录' }), { code: 'name_exists' });
    await assert.rejects(send(s, shared, meta('文件.txt', 3, '../outside')), { code: 'invalid_path' });
});

test('损坏和超量上传不会在目标目录产生文件', async () => {
    const s = make(), shared = await open(s);
    await assert.rejects(send(s, shared, meta('a', 4)), { code: 'size_mismatch' });
    await assert.rejects(send(s, shared, meta('a', 2)), { code: 'size_mismatch' });
    await assert.rejects(send(s, shared, meta('a', 2 ** 30 + 1)), { code: 'invalid_input' });
    assert.deepEqual(await readdir(root), []);
});

for (const mode of ['cancel', 'stop', 'dispose', 'timeout', 'idle', 'expiry']) test(`${mode}中止活动上传，清理暂存并保留原件`, async () => {
    let clock = Date.now(); const s = make({ now: () => clock, limits: { uploadMs: mode === 'timeout' ? 80 : 3000, idleMs: mode === 'idle' ? 60 : 1000 } });
    const shared = await open(s), input = new PassThrough(), controller = new AbortController(), file = meta('partial', 100);
    await writeFile(join(root, '原件.txt'), 'keep'); const pending = s.upload(input, shared.id, shared.token, file, controller.signal), rejected = assert.rejects(pending);
    input.write('ab'); await delay(25);
    if (mode === 'cancel') controller.abort(); if (mode === 'stop') await s.stop(shared.id); if (mode === 'dispose') await s.dispose();
    if (mode === 'expiry') { clock = shared.expiresAt + 1; s.list(); }
    await rejected; assert.deepEqual(await readdir(root), ['原件.txt']); assert.deepEqual(await readdir(join(temporary, 'staging')), []); assert.equal(await readFile(join(root, '原件.txt'), 'utf8'), 'keep');
    if (['stop', 'dispose', 'expiry'].includes(mode)) await assert.rejects(listing(s, shared), { code: 'share_unavailable' });
});

test('全局上传并发限制，取消释放并可重试原请求编号', async () => {
    const s = make({ limits: { uploads: 1, idleMs: 1000, uploadMs: 3000 } }), shared = await open(s), stream = new PassThrough(), c = new AbortController(), file = meta();
    const first = s.upload(stream, shared.id, shared.token, file, c.signal), rejected = assert.rejects(first); stream.write('a'); await delay(20);
    await assert.rejects(send(s, shared), { code: 'busy' }); await assert.rejects(send(s, shared, file), { code: 'busy' });
    c.abort(); await rejected; await send(s, shared, file); assert.equal(await readFile(join(root, '文件.txt'), 'utf8'), 'abc');
});

test('正在接收时父目录被替换为联接，拒绝提交到其他目录', async () => {
    await mkdir(join(root, 'child')); await mkdir(join(temporary, 'outside'));
    const s = make(), shared = await open(s), stream = new PassThrough(), pending = s.upload(stream, shared.id, shared.token, meta('new.txt', 3, 'child')), rejected = assert.rejects(pending, { code: 'blocked_file' });
    stream.write('a'); await delay(30); await rename(join(root, 'child'), join(root, 'old-child'));
    await symlink(join(temporary, 'outside'), join(root, 'child'), process.platform === 'win32' ? 'junction' : 'dir'); stream.end('bc'); await rejected;
    assert.deepEqual(await readdir(join(temporary, 'outside')), []);
});

test('共享根被替换后身份校验拒绝继续，停止后可重新开启', async () => {
    const s = make(), shared = await open(s); await rename(root, root + '-old'); await mkdir(root);
    await assert.rejects(listing(s, shared), { code: 'root_changed' }); await s.stop(shared.id); assert.ok((await open(s)).id);
});

test('数量和幂等回执有界，关闭后释放共享名额', async () => {
    const s = make({ limits: { shares: 1, receipts: 1 } }), shared = await open(s); await assert.rejects(open(s), { code: 'share_limit' });
    await send(s, shared); await assert.rejects(send(s, shared), { code: 'receipt_limit' }); await s.stop(shared.id); assert.ok((await open(s)).token);
});

for (const mode of ['stop', 'dispose', 'timeout', 'idle']) test(`下载${mode}中止文件流并释放句柄及并发名额`, async () => {
    await writeFile(join(root, 'large.bin'), Buffer.alloc(1024 * 1024));
    const s = make({ limits: { downloads: 1, downloadMs: mode === 'timeout' ? 100 : 3000, idleMs: mode === 'idle' ? 80 : 1000 } }), shared = await open(s);
    const ticket = await s.downloadTicket(shared.id, shared.token, { path: 'large.bin' }), output = new PassThrough({ highWaterMark: 1 });
    output.attachment = () => output; output.type = () => output; output.setHeader = () => {};
    const pending = s.download(ticket.ticket, output), rejected = assert.rejects(pending);
    await delay(30); const busy = await s.downloadTicket(shared.id, shared.token, { path: 'large.bin' });
    await assert.rejects(s.download(busy.ticket, new PassThrough()), { code: 'busy' });
    if (mode === 'stop') await s.stop(shared.id); if (mode === 'dispose') await s.dispose(); await rejected;
    assert.ok(output.destroyed); await rename(join(root, 'large.bin'), join(root, 'released.bin'));
    assert.equal((await readFile(join(root, 'released.bin'))).length, 1024 * 1024);
});

async function api(options = {}) {
    const app = express(), service = make(options), access = createToolAccess(); registerFileShareApi(app, { service, access });
    const server = await new Promise(done => { const s = app.listen(0, '127.0.0.1', () => done(s)); }); servers.push(server);
    const base = `http://127.0.0.1:${server.address().port}/api/file-share`;
    const call = async (path, { method = 'GET', body, share, headers = {} } = {}) => {
        const response = await fetch(base + path, { method, headers: { 'X-Toolbox-Share': '1', ...(share ? { 'X-Toolbox-Share-Token': share.token } : { 'X-Toolbox-Share-Manage': '1' }), ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
        return { status: response.status, body: await response.json(), headers: response.headers };
    };
    return { base, call, service };
}

test('真实HTTP目录、上传、单次原生流下载及附件头，不把文件整体装入页面内存', async () => {
    const { base, call } = await api(), created = await call('/shares', { method: 'POST', body: { root, writable: true, hours: 1, confirm: true } }), shared = created.body;
    assert.equal(created.status, 200); assert.equal((await call(`/shares/${shared.id}/entries`, { share: shared })).body.path, '');
    const file = meta('中文.zip', 3), response = await fetch(`${base}/shares/${shared.id}/files`, { method: 'POST', headers: { 'X-Toolbox-Share': '1', 'X-Toolbox-Share-Token': shared.token, 'X-Toolbox-Share-File': encodeURIComponent(JSON.stringify(file)), 'Content-Type': 'application/octet-stream' }, body: Buffer.from('abc') });
    assert.equal(response.status, 200); assert.equal((await response.json()).name, '中文.zip');
    const ticket = (await call(`/shares/${shared.id}/downloads`, { method: 'POST', share: shared, body: { path: '中文.zip' } })).body.ticket;
    const downloaded = await fetch(`${base}/downloads/${ticket}`); assert.equal(downloaded.status, 200); assert.equal(await downloaded.text(), 'abc');
    assert.match(downloaded.headers.get('content-disposition'), /^attachment;/); assert.match(downloaded.headers.get('content-type'), /application\/octet-stream/);
    assert.equal(downloaded.headers.get('x-content-type-options'), 'nosniff'); assert.equal(downloaded.headers.get('cache-control'), 'no-store');
    assert.equal((await fetch(`${base}/downloads/${ticket}`)).status, 410);
    assert.equal((await call(`/shares/${shared.id}`, { method: 'DELETE', body: { confirm: false } })).status, 400);
    assert.equal((await call(`/shares/${shared.id}`, { method: 'DELETE', body: { confirm: true } })).status, 200);
    assert.equal((await call(`/shares/${shared.id}/entries`, { share: shared })).status, 410);
});

test('真实HTTP拒绝缺少专用头、跨源、伪造Host、管理头缺失和无效参数', async () => {
    const { base, call } = await api();
    assert.equal((await fetch(base + '/config')).status, 403);
    for (const headers of [{ Origin: 'http://evil.example' }, { 'Sec-Fetch-Site': 'cross-site' }, { Host: 'evil.example' }, { 'X-Toolbox-Share-Manage': '' }]) assert.equal((await call('/config', { headers })).status, 403);
    assert.equal((await call('/config?path=x')).status, 400);
    assert.equal((await call('/shares', { method: 'POST', body: { root, writable: true, hours: 1, confirm: true, arbitrary: true } })).status, 400);
    const bad = await fetch(base + '/shares', { method: 'POST', headers: { 'X-Toolbox-Share': '1', 'X-Toolbox-Share-Manage': '1', 'Content-Type': 'application/json' }, body: '{broken' }); assert.equal(bad.status, 400);
    const large = await call('/shares', { method: 'POST', body: { root: 'x'.repeat(9000) } }); assert.equal(large.status, 413);
});

test('下载票据到期/停止无效，不能复用到另一共享或越级路径', async () => {
    let clock = Date.now(); const { base, call, service } = await api({ now: () => clock, limits: { ticketMs: 20 } }), shared = await open(service);
    await writeFile(join(root, 'file.txt'), 'abc');
    const ticket = await service.downloadTicket(shared.id, shared.token, { path: 'file.txt' }); clock += 30;
    assert.equal((await fetch(`${base}/downloads/${ticket.ticket}`)).status, 410);
    assert.equal((await call(`/shares/${shared.id}/downloads`, { method: 'POST', share: shared, body: { path: '../outside' } })).status, 400);
    const other = await service.downloadTicket(shared.id, shared.token, { path: 'file.txt' }); await service.stop(shared.id);
    assert.equal((await fetch(`${base}/downloads/${other.ticket}`)).status, 410);
});

test('并行申请下载票据不能突破数量上限', async () => {
    await writeFile(join(root, 'file.txt'), 'abc'); const s = make({ limits: { tickets: 1 } }), shared = await open(s);
    const results = await Promise.allSettled([s.downloadTicket(shared.id, shared.token, { path: 'file.txt' }), s.downloadTicket(shared.id, shared.token, { path: 'file.txt' })]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(results.find(result => result.status === 'rejected').reason.code, 'busy');
});
