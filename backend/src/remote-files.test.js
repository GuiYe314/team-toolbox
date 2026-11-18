import { test as nodeTest, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Readable, PassThrough, Writable } from 'node:stream';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { request as httpRequest } from 'node:http';
import { createServer as tcpServer } from 'node:net';
import express from 'express';
import { sftpFixture, ftpFixture, fixtureFingerprint } from '../test-support/remote-files-fixture.mjs';
import { connectionInput, remotePath, remoteName, connectRemote, probeSftp } from './remote-files-protocol.js';
import { createRemoteFilesService } from './remote-files.js';
import { registerRemoteFilesApi } from './remote-files-api.js';
const test = (name, fn) => nodeTest(name, { timeout: 20000 }, fn);
let cleanups = [];
afterEach(async () => { for (const cleanup of cleanups.reverse()) await cleanup(); cleanups = []; });
const fixture = async (kind = 'sftp', options) => { const f = await (kind === 'sftp' ? sftpFixture(options) : ftpFixture(options)); cleanups.push(() => f.close()); return f; };
const make = options => { const s = createRemoteFilesService({ log() {}, ...options }); cleanups.push(() => s.dispose()); return s; };
const input = (f, protocol = 'sftp', extra = {}) => ({ host: '127.0.0.1', port: f.port, protocol, username: 'tester', password: 'fixture-secret', fingerprint: fixtureFingerprint, confirm: true, ...extra });
const connect = (s, f, extra) => s.connect(input(f, 'sftp', extra));
const listing = (s, c, path = '/') => s.entries(c.id, c.token, path);
const prepare = (s, c, extra = {}) => s.prepare(c.id, c.token, { direction: 'upload', path: '/', name: '上传.txt', size: 3, overwrite: false, confirm: true, ...extra });
const send = (s, c, j, data = Buffer.from('abc'), signal) => s.upload(Readable.from([data]), c.id, c.token, j.id, signal);
async function until(fn) { for (let i = 0; i < 100; i++) { if (fn()) return; await delay(20); } throw new Error('fixture wait timeout'); }
function responseSink(delayMs = 0) { const chunks = [], headers = {}; const sink = new Writable({ write(chunk, _encoding, callback) { chunks.push(Buffer.from(chunk)); setTimeout(callback, delayMs); } });
    sink.attachment = name => headers.name = name; sink.type = () => {}; sink.setHeader = (name, value) => headers[name] = value; return { sink, chunks, headers }; }
function fetchLocal(url, options = {}) { return new Promise((resolve, reject) => {
    assert.equal(new URL(url).hostname, '127.0.0.1'); const req = httpRequest(url, { method: options.method || 'GET', headers: { ...options.headers, ...(options.body !== undefined ? { 'Content-Length': Buffer.byteLength(options.body) } : {}) } }, res => {
        const chunks = []; res.on('data', b => chunks.push(b)); res.once('error', reject); res.once('end', () => { const bytes = Buffer.concat(chunks); resolve({ status: res.statusCode, headers: res.headers, bytes, json: () => JSON.parse(bytes) }); }); });
    req.once('error', reject); req.setTimeout(7000, () => req.destroy(new Error('fixture HTTP timeout'))); req.end(options.body);
}); }

test('连接参数、确认、主机指纹、路径及名称拒绝注入与非法字段', () => {
    const good = input({ port: 22 }); assert.equal(connectionInput(good).host, '127.0.0.1');
    for (const change of [{ confirm: false }, { port: 0 }, { port: '22' }, { protocol: 'https' }, { host: 'sftp://host/path' }, { host: 'host\nPASS x' }, { host: '0.0.0.0' }, { username: 'x\r\nDELE /a' }, { password: 'x\n' }, { fingerprint: 'unknown' }, { extra: true }]) assert.throws(() => connectionInput({ ...good, ...change }));
    for (const name of ['', '..', 'a/b', 'a\\b', 'a\nDELE /']) assert.throws(() => remoteName(name));
    for (const path of ['relative', '/a\r\n', '/a\\b', '/' + 'a'.repeat(2049)]) assert.throws(() => remotePath(path));
    assert.equal(remotePath('/资料/../文件'), '/文件');
});
test('SFTP实际握手读取指纹，不发送密码或尝试认证', async () => {
    const f = await fixture(); const value = await probeSftp({ host: '127.0.0.1', port: f.port }); assert.equal(value.fingerprint, fixtureFingerprint); assert.equal(f.authAttempts, 0);
});
test('SFTP指纹不符在认证前拒绝，密码错误明确且不泄漏密码', async () => {
    const f = await fixture(), s = make(); await assert.rejects(connect(s, f, { fingerprint: 'SHA256:' + 'A'.repeat(43) }), { code: 'host_key_changed' }); assert.equal(f.authAttempts, 0);
    await assert.rejects(connect(s, f, { password: 'wrong-secret' }), e => e.code === 'authentication_failed' && !e.message.includes('wrong-secret'));
});
test('FTP登录拒绝不泄漏凭据，连接无欢迎响应时超时关闭', async () => {
    const f = await fixture('ftp'), s = make(); await assert.rejects(s.connect(input(f, 'ftp', { password: 'bad-password' })), { code: 'authentication_failed' });
    const sockets = new Set(), silent = tcpServer(socket => { sockets.add(socket); socket.on('error', () => {}); socket.once('close', () => sockets.delete(socket)); socket.resume(); });
    await new Promise(done => silent.listen(0, '127.0.0.1', done)); cleanups.push(() => new Promise(done => { for (const socket of sockets) socket.destroy(); silent.close(done); }));
    const bounded = make({ limits: { commandMs: 40 } }); await assert.rejects(bounded.connect(input({ port: silent.address().port }, 'ftp')), { code: 'timeout' }); await until(() => sockets.size === 0);
});
for (const protocol of ['sftp', 'ftp']) test(`${protocol}真实协议浏览、上传、原生下载字节与写操作`, async () => {
    const f = await fixture(protocol), s = make(), c = await s.connect(input(f, protocol));
    const list = await listing(s, c); assert.equal(list.items[0].type, 'directory'); assert.ok(list.items.some(item => item.name === '原件.txt'));
    const bytes = Buffer.from('actual transfer 中文\0\xff'), job = await prepare(s, c, { size: bytes.length }); const result = await send(s, c, job, bytes);
    assert.equal(result.state, 'success'); assert.deepEqual(f.files.get('/上传.txt').bytes, bytes); assert.ok(![...f.files.keys()].some(p => p.includes('.part')));
    const ticket = await prepare(s, c, { direction: 'download', path: '/上传.txt' }), { sink, chunks, headers } = responseSink(20);
    await s.download(ticket.ticket, sink); assert.equal(sink.writableFinished, true); assert.deepEqual(Buffer.concat(chunks), bytes); assert.equal(headers.name, '上传.txt');
    await assert.rejects(s.download(ticket.ticket, responseSink().sink), { code: 'ticket_unavailable' });
    await s.alter(c.id, c.token, { action: 'mkdir', path: '/', name: '新建', confirm: true }); assert.ok(f.files.get('/新建').directory);
    await s.alter(c.id, c.token, { action: 'rename', path: '/上传.txt', name: '改名.txt', confirm: true }); assert.deepEqual(f.files.get('/改名.txt').bytes, bytes);
    await assert.rejects(s.alter(c.id, c.token, { action: 'delete', path: '/资料', confirm: true })); assert.ok(f.files.has('/资料/child.bin'));
    await s.alter(c.id, c.token, { action: 'delete', path: '/改名.txt', confirm: true }); await s.alter(c.id, c.token, { action: 'delete', path: '/新建', confirm: true }); assert.ok(!f.files.has('/改名.txt'));
    assert.ok(!JSON.stringify(s.status(c.id, c.token)).includes('fixture-secret')); await s.disconnect(c.id, c.token); assert.throws(() => s.status(c.id, c.token));
});
test('显式FTPS真实TLS信任证书与数据通道，默认拒绝自签证书', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tt-ftps-cert-')); cleanups.push(() => rm(dir, { recursive: true, force: true }));
    const openssl = process.platform === 'win32' ? 'C:/Program Files/Git/usr/bin/openssl.exe' : 'openssl';
    const result = spawnSync(openssl, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(dir, 'key.pem'), '-out', join(dir, 'cert.pem'), '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1'], { windowsHide: true, encoding: 'utf8', timeout: 15000 });
    assert.equal(result.status, 0, '临时测试证书生成失败'); const cert = await readFile(join(dir, 'cert.pem')), key = await readFile(join(dir, 'key.pem'));
    const f = await fixture('ftp', { cert, key }), untrusted = make(); await assert.rejects(untrusted.connect(input(f, 'ftps')), { code: 'tls_untrusted' });
    const s = make({ tlsCA: cert }), c = await s.connect(input(f, 'ftps')); assert.ok((await listing(s, c)).items.length);
    const j = await prepare(s, c); await send(s, c, j); assert.equal(f.files.get('/上传.txt').bytes.toString(), 'abc');
    const ticket = await prepare(s, c, { direction: 'download', path: '/上传.txt' }), out = responseSink(); await s.download(ticket.ticket, out.sink); assert.equal(Buffer.concat(out.chunks).toString(), 'abc');
});
test('远端管理与传输需要确认，错误票据和未知会话拒绝', async () => {
    const f = await fixture(), s = make(), c = await connect(s, f);
    await assert.rejects(s.alter(c.id, c.token, { action: 'delete', path: '/原件.txt', confirm: false }));
    await assert.rejects(prepare(s, c, { confirm: false })); await assert.rejects(prepare(s, c, { size: 1024 ** 3 + 1 }));
    await assert.rejects(listing(s, { ...c, token: 'A'.repeat(48) }), { code: 'session_unavailable' });
    await assert.rejects(s.alter(c.id, c.token, { action: 'delete', path: '/', confirm: true })); assert.ok(f.files.has('/原件.txt'));
});
test('默认不覆盖，同名明确覆盖后成功，确认后文件变化不得覆盖', async () => {
    const f = await fixture(), s = make(), c = await connect(s, f); await assert.rejects(prepare(s, c, { name: '原件.txt' }), { code: 'name_exists' });
    const job = await prepare(s, c, { name: '原件.txt', overwrite: true }); f.files.get('/原件.txt').bytes = Buffer.from('changed after confirmation');
    await assert.rejects(send(s, c, job), { code: 'remote_changed' }); assert.equal(f.files.get('/原件.txt').bytes.toString(), 'changed after confirmation'); assert.ok(![...f.files.keys()].some(p => p.includes('.part')));
    const replacement = await prepare(s, c, { name: '原件.txt', overwrite: true }); await send(s, c, replacement); assert.equal(f.files.get('/原件.txt').bytes.toString(), 'abc');
});
test('上传长度不符拒绝提交且清理暂存，清理失败显式标记', async () => {
    const f = await fixture(), s = make(), c = await connect(s, f), j = await prepare(s, c, { size: 5 }); await assert.rejects(send(s, c, j), { code: 'size_mismatch' });
    assert.ok(!f.files.has('/上传.txt')); assert.ok(![...f.files.keys()].some(p => p.includes('.part')));
    const blocked = await fixture('sftp', { denyCleanup: true }), c2 = await connect(s, blocked), j2 = await prepare(s, c2, { size: 5 }); await assert.rejects(send(s, c2, j2));
    const state = s.status(c2.id, c2.token).jobs[0]; assert.equal(state.cleanupNeeded, true); assert.ok(state.temporaryPath.endsWith('.part'));
});
test('不支持覆盖扩展的SFTP不删除原件，失败后清理暂存', async () => {
    const f = await fixture('sftp', { posixRename: false }), s = make(), c = await connect(s, f), j = await prepare(s, c, { name: '原件.txt', overwrite: true });
    await assert.rejects(send(s, c, j), { code: 'overwrite_unsupported' }); assert.equal(f.files.get('/原件.txt').bytes.toString(), 'remote original 中文'); assert.ok(![...f.files.keys()].some(p => p.endsWith('.part')));
});
test('上传超量、下载前远端变化、票据到期均不能成功', async () => {
    let time = Date.now(); const f = await fixture(), s = make({ now: () => time }), c = await connect(s, f), j = await prepare(s, c); await assert.rejects(send(s, c, j, Buffer.from('too long')), { code: 'size_mismatch' });
    const ticket = await prepare(s, c, { direction: 'download', path: '/原件.txt' }); f.files.get('/原件.txt').bytes = Buffer.from('changed'); await assert.rejects(s.download(ticket.ticket, responseSink().sink), { code: 'remote_changed' });
    const old = await prepare(s, c, { direction: 'download', path: '/原件.txt' }); time += 61000; await assert.rejects(s.download(old.ticket, responseSink().sink), { code: 'ticket_unavailable' });
});
test('取消正在上传的SFTP关闭连接并标记未确认清理，不提交目标文件', async () => {
    const f = await fixture(), s = make(), c = await connect(s, f), j = await prepare(s, c, { size: 1000 }), stream = new PassThrough();
    const pending = s.upload(stream, c.id, c.token, j.id); const rejected = assert.rejects(pending, { code: 'cancelled' }); stream.write(Buffer.alloc(10));
    await until(() => [...f.files.keys()].some(p => p.includes('.part'))); const state = await s.cancel(c.id, c.token); await rejected; stream.destroy();
    assert.equal(state.connected, false); assert.equal(state.jobs[0].state, 'cancelled'); assert.equal(state.jobs[0].cleanupNeeded, true); assert.ok(!f.files.has('/上传.txt'));
});
test('无进展超时关闭SFTP且等待任务退出，后续状态不再busy', async () => {
    const f = await fixture('sftp', { writeDelayMs: 400 }), s = make({ limits: { idleMs: 60, transferMs: 2000 } }), c = await connect(s, f), j = await prepare(s, c);
    await assert.rejects(send(s, c, j), { code: 'idle_timeout' }); const state = s.status(c.id, c.token); assert.equal(state.busy, false); assert.equal(state.connected, false);
});
test('同会话独占与跨会话活动传输上限，等待任务在断开后取消', async () => {
    const f = await fixture(), s = make({ limits: { transfers: 1, sessions: 2 } }), c = await connect(s, f), c2 = await connect(s, f); await assert.rejects(connect(s, f), { code: 'session_limit' });
    const j = await prepare(s, c, { size: 100 }), j2 = await prepare(s, c2); const stream = new PassThrough(), pending = s.upload(stream, c.id, c.token, j.id), rejected = assert.rejects(pending); stream.write(Buffer.alloc(1));
    await until(() => s.status(c.id, c.token).busy); await assert.rejects(listing(s, c), { code: 'busy' }); await assert.rejects(send(s, c2, j2), { code: 'busy' });
    await s.cancel(c.id, c.token); await rejected; stream.destroy(); await s.disconnect(c2.id, c2.token); assert.throws(() => s.status(c2.id, c2.token));
});
test('心跳到期和退出回收会话，退出等待正在握手的连接', async () => {
    let time = Date.now(); const f = await fixture(), s = make({ now: () => time, limits: { heartbeatMs: 1 } }), c = await connect(s, f); time += 2;
    await delay(1100); assert.throws(() => s.status(c.id, c.token), { code: 'session_unavailable' });
    let closed = false; const opening = make({ connector: (_input, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => setTimeout(() => { closed = true; reject(new Error()); }, 20))) });
    const pending = opening.connect(input(f)); const rejected = assert.rejects(pending); await opening.dispose(); await rejected; assert.equal(closed, true);
});
test('下载中途取消结束实际SFTP与HTTP流，不能显示成功', async () => {
    const f = await fixture('sftp', { readDelayMs: 30 }); f.files.set('/大文件.bin', { bytes: Buffer.alloc(256 * 1024, 7) });
    const s = make(), c = await connect(s, f), j = await prepare(s, c, { direction: 'download', path: '/大文件.bin' }), out = responseSink(10), ac = new AbortController();
    const pending = s.download(j.ticket, out.sink, ac.signal), rejected = assert.rejects(pending, { code: 'cancelled' }); await until(() => out.chunks.length > 0); ac.abort(); await rejected;
    const state = s.status(c.id, c.token); assert.equal(state.connected, false); assert.equal(state.jobs[0].state, 'cancelled'); assert.ok(Buffer.concat(out.chunks).length < 256 * 1024); assert.equal(out.sink.destroyed, true);
});
test('总传输时限独立于进度，服务退出等待活动传输清理', async () => {
    const f = await fixture('sftp', { readDelayMs: 40 }); f.files.set('/大文件.bin', { bytes: Buffer.alloc(256 * 1024) });
    const s = make({ limits: { transferMs: 70, idleMs: 1000 } }), c = await connect(s, f), j = await prepare(s, c, { direction: 'download', path: '/大文件.bin' });
    await assert.rejects(s.download(j.ticket, responseSink().sink), { code: 'timeout' }); assert.equal(s.status(c.id, c.token).busy, false);
    const c2 = await connect(s, f), j2 = await prepare(s, c2, { size: 100 }), stream = new PassThrough(), pending = s.upload(stream, c2.id, c2.token, j2.id), rejected = assert.rejects(pending);
    stream.write(Buffer.alloc(1)); await until(() => s.status(c2.id, c2.token).busy); await s.dispose(); await rejected; stream.destroy(); assert.throws(() => s.status(c2.id, c2.token));
});
test('目录2000项与任务数量有界，拒绝超过上限', async () => {
    const f = await fixture(); for (let i = 0; i < 2001; i++) f.files.set('/entry' + i, { bytes: Buffer.alloc(0) });
    const s = make({ limits: { jobs: 1 } }), c = await connect(s, f); await assert.rejects(listing(s, c), { code: 'list_limit' });
    for (let i = 0; i < 2001; i++) f.files.delete('/entry' + i);
    await prepare(s, c); await assert.rejects(prepare(s, c, { name: 'next' }), { code: 'job_limit' });
});
test('HTTP API同源与专用头、JSON限额、真实字节、单次原生附件下载', async () => {
    const f = await fixture(), s = make(), app = express(); registerRemoteFilesApi(app, { service: s }); app.use(express.json({ limit: '16mb' }));
    const server = await new Promise(done => { const srv = app.listen(0, '127.0.0.1', () => done(srv)); }); cleanups.push(() => new Promise(done => { server.closeAllConnections(); server.close(done); }));
    const base = `http://127.0.0.1:${server.address().port}/api/remote-files`, h = { 'X-Toolbox-Remote': '1', 'Content-Type': 'application/json' };
    assert.equal((await fetchLocal(base + '/sessions', { method: 'POST', body: JSON.stringify(input(f)) })).status, 403);
    assert.equal((await fetchLocal(base + '/probe', { method: 'POST', headers: { ...h, Origin: 'https://other.test' }, body: '{}' })).status, 403);
    assert.equal((await fetchLocal(base + '/sessions', { method: 'POST', headers: h, body: JSON.stringify({ filler: 'x'.repeat(9000) }) })).status, 413);
    const c = (await fetchLocal(base + '/sessions', { method: 'POST', headers: h, body: JSON.stringify(input(f)) })).json(); assert.ok(c.token); h['X-Toolbox-Remote-Token'] = c.token;
    const url = base + '/sessions/' + c.id; const job = (await fetchLocal(url + '/transfers', { method: 'POST', headers: h, body: JSON.stringify({ direction: 'upload', path: '/', name: 'api.bin', size: 3, overwrite: false, confirm: true }) })).json();
    assert.equal((await fetchLocal(url + '/uploads/' + job.id, { method: 'POST', headers: { ...h, 'Content-Type': 'application/octet-stream' }, body: Buffer.from([0, 200, 255]) })).status, 200);
    const ticket = (await fetchLocal(url + '/transfers', { method: 'POST', headers: h, body: JSON.stringify({ direction: 'download', path: '/api.bin', confirm: true }) })).json();
    const download = await fetchLocal(base + '/downloads/' + ticket.ticket); assert.equal(download.status, 200); assert.match(download.headers['content-disposition'], /^attachment/); assert.equal(download.headers['cache-control'], 'no-store'); assert.deepEqual(download.bytes, Buffer.from([0, 200, 255]));
    assert.equal((await fetchLocal(base + '/downloads/' + ticket.ticket)).status, 410); assert.equal((await fetchLocal(url + '?token=' + c.token, { headers: h })).status, 400);
    const deleted = await fetchLocal(url, { method: 'DELETE', headers: h, body: '{"confirm":true}' }); assert.equal(deleted.status, 200);
});
