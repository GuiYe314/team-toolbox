import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, stat, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import express from 'express';
import { createAndroidPersistent, parsePersistentListing, validatePersistentPath, persistentShellCommand, PERSISTENT_SCRIPTS, streamPersistentFile, PERSISTENT_MAX_BYTES } from './android-persistent.js';
import { registerAndroidApi } from './android-api.js';
import { AdbError } from './android-adb-protocol.js';
const sha = value => createHash('sha256').update(value).digest('hex');
const input = { serial: 'PHONE', packageName: 'com.example.unity', path: '', userId: 10 };
const fileInput = { ...input, path: '存档/a.json' };

async function fixture(t, extra = {}) {
    const directory = await mkdtemp(join(tmpdir(), 'tt-persistent-test-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const f = { directory, calls: [], bytes: Buffer.from('{"level":1}'), user: '10', online: true, installed: true, listing: ['DDP1', 'directory', '0:1:2', '存档', 'file', '2:1:3', 'a.txt', 'END', ''].join('\0') };
    f.run = async (args, options) => {
        f.calls.push({ args, options });
        if (options.signal?.aborted) throw new AdbError('cancelled', 'fixture cancelled', 499);
        if (args.includes('get-current-user')) return { stdout: f.user };
        if (args.includes('path') && args.includes('pm')) return { stdout: f.installed ? 'package:/data/app/base.apk' : '' };
        if (args[2] === 'push') { f.uploaded = await readFile(args[3]); if (f.failPush) throw new AdbError('adb_failed', 'private output'); return { stdout: '1 file pushed' }; }
        const command = args.at(-1);
        for (const [name, script] of Object.entries(PERSISTENT_SCRIPTS)) if (command.includes(script.replaceAll("'", "'\\''"))) {
            f.scripts ||= []; f.scripts.push(name);
            if (f.hold === name) await new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(new AdbError('cancelled', 'fixture cancelled', 499)), { once: true }));
            if (f.failure === name) throw new AdbError('adb_failed', f.marker || 'DDP_ACCESS');
            if (name === 'list') return { stdout: f.listing };
            if (name === 'inspect') return { stdout: `DDP2\0${f.bytes.length}:1:9\0${sha(f.bytes)}\0` };
            if (name === 'prepare') return { stdout: 'DDP_READY' };
            if (name === 'commit') return { stdout: 'DDP_OK' };
            if (name === 'cleanup') return { stdout: 'DDP_CLEAN' };
        }
        throw new Error('unexpected fixture command');
    };
    f.service = createAndroidPersistent({ run: f.run, readDevices: async () => f.online ? [{ serial: 'PHONE', state: 'device' }] : [], executable: () => 'fixture-adb', temporaryBase: directory,
        binaryReader: async (_exe, args, file, options) => { f.binary = { args, options }; await writeFile(file, f.bytes); return { size: f.bytes.length, sha256: sha(f.bytes) }; }, ...extra });
    t.after(() => f.service.dispose()); return f;
}

test('相对路径允许中文、空格及字面量标点，拒绝越级、绝对路径、控制字符和保留名', () => {
    for (const name of ['', '目录/存档.json', "a 'quote' $().txt", 'a;literal.txt', '.hidden']) assert.equal(validatePersistentPath(name), name);
    for (const name of ['/sdcard/a', '../a', 'a/../b', './a', 'a//b', 'a/', 'a\\b', 'x\n', '.toolbox-transfer-id', 'a/'.repeat(17) + 'b', '中'.repeat(86)]) assert.throws(() => validatePersistentPath(name));
});

test('NUL列表协议支持隐藏/中文/目录优先，特殊文件不可操作，异常和超量拒绝', () => {
    const value = ['DDP1', 'file', '4:100:2', '.hidden', 'directory', '0:100:3', '目录', 'blocked', '0:0:0', 'link', 'TRUNCATED', 'END', ''].join('\0');
    const parsed = parsePersistentListing(value); assert.equal(parsed.entries[0].name, '目录'); assert.equal(parsed.truncated, true); assert.equal(parsed.entries.find(x => x.name === 'link').kind, 'blocked');
    assert.equal(parsePersistentListing(['DDP1', 'file', '0:0:1', 'bad\nname', 'END', ''].join('\0')).skipped, 1);
    for (const value of ['', 'permission denied', 'DDP1\0', ['DDP1', 'wrong', '0:0:1', 'a', 'END', ''].join('\0')]) assert.throws(() => parsePersistentListing(value));
});

test('定位当前用户标准目录与已安装应用，所有ADB调用明确设备且有超时输出限制', async t => {
    const f = await fixture(t); const result = await f.service.list(input);
    assert.equal(result.root, '/storage/emulated/10/Android/data/com.example.unity/files'); assert.equal(result.userId, 10);
    assert.deepEqual(f.calls[0].args, ['-s', 'PHONE', 'shell', 'am', 'get-current-user']);
    assert.deepEqual(f.calls[1].args, ['-s', 'PHONE', 'shell', 'pm', 'path', '--user', '10', 'com.example.unity']);
    assert.ok(f.calls.every(x => x.args[0] === '-s' && x.args[1] === 'PHONE' && x.options.timeoutMs <= 30000 && x.options.maxBytes <= 1048576));
});

test('设备离线、未安装、用户变化、无效目标和取消不会读取或写入文件', async t => {
    const f = await fixture(t); f.online = false;
    await assert.rejects(f.service.list(input), { code: 'device_unavailable' }); assert.equal(f.calls.length, 0);
    f.online = true; f.installed = false; await assert.rejects(f.service.list(input), { code: 'app_unavailable' });
    f.installed = true; f.user = '0'; await assert.rejects(f.service.list(input), { code: 'user_changed' });
    assert.throws(() => f.service.list({ ...input, command: 'reboot' }));
    assert.throws(() => f.service.inspect({ ...fileInput, serial: 'x;reboot' }));
    assert.throws(() => f.service.inspect({ ...fileInput, userId: undefined }));
    await assert.rejects(f.service.list(input, AbortSignal.abort()), { code: 'cancelled' });
});

test('权限与符号链接错误明确反馈，不泄漏远端原始错误正文且失败后可恢复', async t => {
    const f = await fixture(t); f.failure = 'list'; f.marker = 'private contents DDP_LINK';
    await assert.rejects(f.service.list(input), error => error.code === 'unsafe_path' && !error.message.includes('private contents'));
    f.marker = 'DDP_ACCESS'; await assert.rejects(f.service.list(input), { code: 'persistent_access' });
    f.failure = ''; assert.equal((await f.service.list(input)).entries.length, 2);
});

test('UTF-8预览与二进制下载通过exec-out保存，读取后清理且不丢失二进制字节', async t => {
    const f = await fixture(t); f.bytes = Buffer.from('中文\n<script>literal</script>');
    assert.equal((await f.service.read({ ...fileInput, preview: true })).text, f.bytes.toString());
    assert.equal(f.binary.args[2], 'exec-out'); assert.deepEqual(await readdir(f.directory), []);
    f.bytes = Buffer.from([0, 1, 255, 13, 10]);
    await assert.rejects(f.service.read({ ...fileInput, preview: true }), { code: 'binary_file' });
    const bytes = await f.service.read(fileInput, undefined, meta => readFile(meta.file)); assert.deepEqual(bytes, f.bytes);
    assert.deepEqual(await readdir(f.directory), []);
});

test('读取校验不符、文本上限与下载上限不冒充成功', async t => {
    const f = await fixture(t, { binaryReader: async (_exe, _args, file) => { await writeFile(file, 'different'); return { size: 9, sha256: sha('different') }; } });
    await assert.rejects(f.service.read({ ...fileInput, preview: true }), { code: 'file_conflict' });
    f.bytes = Buffer.alloc(262145); await assert.rejects(f.service.read({ ...fileInput, preview: true }), { code: 'file_limit' });
    const run = f.run; f.run = null;
    // 大文件属性通过协议测试，不分配超大缓冲。
    const service = createAndroidPersistent({ run: async (args, opts) => args.at(-1).includes('DDP2') ? { stdout: `DDP2\0${PERSISTENT_MAX_BYTES + 1}:1:1\0${sha('x')}\0` } : run(args, opts), readDevices: async () => [{ serial: 'PHONE', state: 'device' }] });
    await assert.rejects(service.read(fileInput), { code: 'file_limit' }); service.dispose();
});

test('添加先上传私有临时文件，明确设备push，核验后提交且不直接覆盖目标', async t => {
    const f = await fixture(t); const bytes = Buffer.from('new bytes');
    const result = await f.service.upload({ ...fileInput, mode: 'add', size: bytes.length, confirm: true }, Readable.from(bytes));
    assert.equal(result.sha256, sha(bytes)); assert.deepEqual(f.uploaded, bytes);
    assert.deepEqual(f.scripts, ['prepare', 'commit']);
    const push = f.calls.find(x => x.args[2] === 'push'); assert.match(push.args[4], /\/存档\/\.toolbox-transfer-[a-f0-9-]+$/); assert.equal(push.options.timeoutMs, 120000);
    assert.deepEqual(await readdir(f.directory), []);
});

test('空文件可添加；确认必须为布尔值，文件大小、方式、版本及额外字段严格校验', async t => {
    const f = await fixture(t); const request = { ...fileInput, mode: 'add', size: 0, confirm: true };
    assert.equal((await f.service.upload(request, Readable.from([]))).size, 0);
    for (const changes of [{ confirm: 'true' }, { confirm: false }, { size: -1 }, { size: PERSISTENT_MAX_BYTES + 1 }, { mode: 'delete' }, { expectedHash: sha('x') }, { args: [] }]) assert.throws(() => f.service.upload({ ...request, ...changes }, Readable.from([])));
    assert.throws(() => f.service.upload({ ...request, mode: 'replace' }, Readable.from([])));
});

test('替换检查读取时SHA256，不符则拒绝上传；提交冲突保留错误并清理临时文件', async t => {
    const f = await fixture(t); const request = { ...fileInput, mode: 'replace', size: 3, confirm: true, expectedHash: sha('changed') };
    await assert.rejects(f.service.upload(request, Readable.from('new')), { code: 'file_conflict' }); assert.equal(f.uploaded, undefined);
    request.expectedHash = sha(f.bytes); f.failure = 'commit'; f.marker = 'DDP_CONFLICT';
    await assert.rejects(f.service.upload(request, Readable.from('new')), { code: 'file_conflict' }); assert.ok(f.scripts.includes('cleanup')); assert.deepEqual(await readdir(f.directory), []);
    f.failure = ''; assert.equal((await f.service.upload(request, Readable.from('new'))).message, '文件替换成功');
});

test('上传超量/不足、push失败和传送核验失败都有清理并可再次执行', async t => {
    const f = await fixture(t); const request = { ...fileInput, mode: 'add', size: 3, confirm: true };
    await assert.rejects(f.service.upload(request, Readable.from('no')), { code: 'upload_failed' });
    await assert.rejects(f.service.upload(request, Readable.from('longer')), { code: 'file_limit' });
    f.failPush = true; await assert.rejects(f.service.upload(request, Readable.from('new')), { code: 'persistent_access' }); assert.equal(f.scripts.at(-1), 'cleanup');
    f.failPush = false; f.failure = 'commit'; f.marker = 'DDP_VERIFY'; await assert.rejects(f.service.upload(request, Readable.from('new')), { code: 'verify_failed' });
    assert.deepEqual(await readdir(f.directory), []);
});

test('在途互斥、取消/设备停止/服务退出/总超时终止等待并清理，锁可以复用', async t => {
    const f = await fixture(t, { timeoutMs: 150 }); f.hold = 'commit';
    const controller = new AbortController(), request = { ...fileInput, mode: 'add', size: 3, confirm: true };
    const operation = f.service.upload(request, Readable.from('new'), controller.signal);
    while (!f.scripts?.includes('commit')) await new Promise(resolve => setTimeout(resolve, 1));
    await assert.rejects(f.service.list(input), { code: 'busy' }); controller.abort(); await assert.rejects(operation, { code: 'cancelled' });
    assert.ok(f.scripts.includes('cleanup')); assert.deepEqual(await readdir(f.directory), []);
    f.hold = 'list'; const stopped = f.service.list(input); setTimeout(() => f.service.stopDevice('PHONE'), 10); await assert.rejects(stopped, { code: 'cancelled' });
    const disposed = f.service.list(input); setTimeout(() => f.service.dispose(), 10); await assert.rejects(disposed, { code: 'cancelled' });
    await assert.rejects(f.service.list(input), { code: 'timeout' }); f.hold = ''; assert.ok((await f.service.list(input)).entries.length);
});

test('真实二进制Node子进程有界读取、超限/取消/超时回收，不经过文本解码', async t => {
    const directory = await mkdtemp(join(tmpdir(), 'tt-persistent-stream-')); t.after(() => rm(directory, { recursive: true, force: true }));
    const file = name => join(directory, name);
    const value = await streamPersistentFile(process.execPath, ['-e', 'process.stdout.write(Buffer.from([0,255,13,10]))'], file('ok'));
    assert.equal(value.sha256, sha(Buffer.from([0,255,13,10]))); assert.equal((await stat(file('ok'))).size, 4);
    await assert.rejects(streamPersistentFile(process.execPath, ['-e', 'process.stdout.write(Buffer.alloc(100))'], file('limit'), { maximum: 10 }), { code: 'file_limit' });
    const controller = new AbortController(); const wait = streamPersistentFile(process.execPath, ['-e', 'setInterval(()=>{},1000)'], file('cancel'), { signal: controller.signal }); setTimeout(() => controller.abort(), 30); await assert.rejects(wait, { code: 'cancelled' });
    await assert.rejects(streamPersistentFile(process.execPath, ['-e', 'setInterval(()=>{},1000)'], file('timeout'), { timeoutMs: 30 }), { code: 'timeout' });
});

test('文件API保持Origin/Host/专用头保护、仅upload允许二进制与下载清理', async t => {
    const directory = await mkdtemp(join(tmpdir(), 'tt-persistent-api-')); t.after(() => rm(directory, { recursive: true, force: true }));
    const file = join(directory, 'content'); await writeFile(file, 'download'); let uploads = 0;
    const service = { listPersistent: async body => { if (body.bad) throw new AdbError('invalid_input', 'bad'); return { entries: [] }; }, inspectPersistent: async () => ({}),
        readPersistent: async (_body, _signal, consume) => consume({ file, fileName: '存档.json', sha256: sha('download') }),
        uploadPersistent: async (_body, req) => { for await (const chunk of req) assert.ok(chunk); uploads++; return { message: 'ok' }; } };
    const app = express(); app.use(express.json()); registerAndroidApi(app, { service });
    const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); }); t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
    const base = `http://127.0.0.1:${server.address().port}/api/android/persistent`;
    const send = (path, body = '{}', headers = {}) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Toolbox-Adb': '1', ...headers }, body });
    assert.equal((await send('/list', '{}', { Origin: 'https://evil.invalid' })).status, 403);
    assert.equal((await send('/list', '{}', { 'X-Toolbox-Adb': '' })).status, 403);
    assert.equal((await send('/list', 'bytes', { 'Content-Type': 'application/octet-stream' })).status, 403);
    assert.equal((await send('/list?path=elsewhere')).status, 400);
    assert.equal((await send('/upload', 'bytes', { 'Content-Type': 'application/octet-stream' })).status, 400);
    assert.equal((await send('/upload', 'bytes', { 'Content-Type': 'application/octet-stream', 'X-Toolbox-Persistent': encodeURIComponent(JSON.stringify({ size: 99 })) })).status, 400);
    assert.equal((await send('/upload', 'bytes', { 'Content-Type': 'application/octet-stream', 'X-Toolbox-Persistent': encodeURIComponent(JSON.stringify({ size: 5 })) })).status, 200); assert.equal(uploads, 1);
    const download = await send('/read'); assert.equal(download.headers.get('cache-control'), 'no-store'); assert.equal(download.headers.get('x-content-type-options'), 'nosniff'); assert.match(download.headers.get('content-disposition'), /attachment/); assert.equal(await download.text(), 'download');
});

test('固定shell脚本在真实POSIX环境完成目录、读取、添加/替换、冲突和符号链接保护', async t => {
    const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : '/bin/bash';
    if (!existsSync(bash)) { t.skip('需要POSIX shell验证Android固定脚本'); return; }
    const directory = await mkdtemp(join(tmpdir(), 'tt-persistent-shell-')); t.after(() => rm(directory, { recursive: true, force: true }));
    const bin = join(directory, 'bin'), root = join(directory, 'storage/emulated/10/Android/data/com.example.unity/files');
    await mkdir(bin); await mkdir(root, { recursive: true });
    await writeFile(join(bin, 'am'), '#!/bin/sh\nprintf 10', { mode: 0o700 });
    const posix = value => value.replaceAll('\\', '/');
    const exec = promisify(execFile);
    const run = async (script, path, args = []) => (await exec(bash, ['-c', persistentShellCommand('am() { printf 10; }\n' + script, [posix(root), path, '10', ...args])], { encoding: 'utf8', windowsHide: true })).stdout;
    const name = "存档 'quote' ; $(echo unsafe).json"; await writeFile(join(root, name), 'old'); await mkdir(join(root, '子目录'));
    assert.ok(parsePersistentListing(await run(PERSISTENT_SCRIPTS.list, '')).entries.some(x => x.name === name));
    assert.equal(await run(PERSISTENT_SCRIPTS.read, name), 'old');
    assert.match(await run(PERSISTENT_SCRIPTS.inspect, name), new RegExp(sha('old')));
    const temp = '.toolbox-transfer-test'; await run(PERSISTENT_SCRIPTS.prepare, '', [temp]); await writeFile(join(root, temp), 'new');
    await assert.rejects(run(PERSISTENT_SCRIPTS.commit, name, [temp, 'replace', sha('changed'), sha('new'), '3']), /DDP_CONFLICT/); assert.equal(await readFile(join(root, name), 'utf8'), 'old');
    assert.equal(await run(PERSISTENT_SCRIPTS.commit, name, [temp, 'replace', sha('old'), sha('new'), '3']), 'DDP_OK'); assert.equal(await readFile(join(root, name), 'utf8'), 'new');
    await run(PERSISTENT_SCRIPTS.prepare, '', [temp]); await writeFile(join(root, temp), 'add'); assert.equal(await run(PERSISTENT_SCRIPTS.commit, 'new.txt', [temp, 'add', '', sha('add'), '3']), 'DDP_OK');
    await run(PERSISTENT_SCRIPTS.prepare, '', [temp]); await writeFile(join(root, temp), 'bad'); await assert.rejects(run(PERSISTENT_SCRIPTS.commit, 'new.txt', [temp, 'add', '', sha('bad'), '3']), /DDP_CONFLICT/);
    await run(PERSISTENT_SCRIPTS.cleanup, '', [temp]); assert.equal(existsSync(join(root, temp)), false);
    const outside = join(directory, 'outside'); await mkdir(outside);
    await symlink(outside, join(root, 'link'), process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(run(PERSISTENT_SCRIPTS.list, 'link'), /DDP_LINK/);
    assert.equal(existsSync(join(root, 'unsafe')), false);
});
