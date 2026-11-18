import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { opendir, lstat, mkdir, mkdtemp, rm, copyFile } from 'node:fs/promises';
import { createWriteStream, constants } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { FileShareError, shareName, sharePath, pinShareRoot, checkedSharePath, openSharedFile, sameFile, shareFailure } from './file-share-paths.js';

export const SHARE_LIMITS = Object.freeze({ shares: 8, entries: 2000, fileBytes: 1024 ** 3, uploads: 2, downloads: 4, receipts: 1000,
    uploadMs: 10 * 60_000, downloadMs: 30 * 60_000, idleMs: 90_000, ticketMs: 60_000, tickets: 128 });
const secret = () => randomBytes(24).toString('hex');
const fields = (input, names) => input && typeof input === 'object' && !Array.isArray(input) && Object.keys(input).every(key => names.includes(key));
const matches = (expected, value) => typeof value === 'string' && /^[a-f0-9]{48}$/.test(value) && timingSafeEqual(Buffer.from(expected), Buffer.from(value));
const stopped = () => new FileShareError('cancelled', '传输已停止，未完成的文件没有保存', 409);

export function createFileShareService({ limits: overrides, now = Date.now, tempRoot = tmpdir(), log = (action, code) => console.warn('[file-share]', action, code) } = {}) {
    const limits = { ...SHARE_LIMITS, ...overrides }, shares = new Map(), tickets = new Map(), tasks = new Map();
    let disposed = false, uploads = 0, downloads = 0;
    function close(s) { s.active = false; for (const [task, state] of tasks) if (state.share === s) state.controller.abort(stopped()); }
    function sweep() {
        for (const [id, s] of shares) if (s.expiresAt <= now()) { close(s); shares.delete(id); }
        for (const [id, t] of tickets) if (t.expiresAt <= now() || !t.share.active) tickets.delete(id);
    }
    const timer = setInterval(sweep, 1000); timer.unref?.();
    function get(id, token) {
        sweep(); const s = shares.get(id);
        if (disposed || !s?.active || !matches(s.token, token)) throw new FileShareError('share_unavailable', '共享链接无效、已停止或已到期，请向电脑端获取新链接', 410);
        return s;
    }
    const snapshot = s => ({ id: s.id, name: s.name, writable: s.writable, expiresAt: s.expiresAt, limits });
    function list() { sweep(); return [...shares.values()].map(s => ({ ...snapshot(s), root: s.root.path, token: s.token })); }
    async function create(input) {
        if (!fields(input, ['root', 'writable', 'hours', 'confirm']) || input.confirm !== true || typeof input.writable !== 'boolean' || ![1, 8, 24].includes(input.hours)) throw new FileShareError('invalid_input', '请确认共享文件夹、读写权限和有效期');
        sweep();
        if (disposed) throw new FileShareError('unavailable', '文件共享服务正在退出', 503);
        if (shares.size >= limits.shares) throw new FileShareError('share_limit', '共享数量已达上限，请先停止其他共享', 429);
        let root; try { root = await pinShareRoot(input.root); } catch (error) { throw shareFailure(error); }
        if (disposed) throw new FileShareError('unavailable', '文件共享服务正在退出', 503);
        if (shares.size >= limits.shares) throw new FileShareError('share_limit', '共享数量已达上限，请先停止其他共享', 429);
        if ([...shares.values()].some(s => sameFile(s.root.identity, root.identity))) throw new FileShareError('already_shared', '此文件夹已开启共享，请使用已有链接或先停止', 409);
        const s = { id: randomBytes(16).toString('hex'), token: secret(), name: basename(root.path), root, writable: input.writable,
            expiresAt: now() + input.hours * 3600_000, active: true, receipts: new Map(), queue: Promise.resolve(), copying: new Set() };
        shares.set(s.id, s); return { ...snapshot(s), root: root.path, token: s.token };
    }
    function check(s, signal) { if (disposed || !s.active || s.expiresAt <= now() || signal?.aborted) throw signal?.reason instanceof FileShareError ? signal.reason : stopped(); }
    function run(s, signal, milliseconds, action, fn) {
        const controller = new AbortController(), abort = () => controller.abort(stopped());
        signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort();
        const timeout = setTimeout(() => controller.abort(new FileShareError('timeout', '文件操作超时，未完成的文件没有保存', 408)), milliseconds);
        const task = (async () => { try { check(s, controller.signal); return await fn(controller.signal, controller); }
            catch (error) { const safe = controller.signal.aborted ? controller.signal.reason || stopped() : shareFailure(error); log(action, safe.code); throw safe; }
            finally { clearTimeout(timeout); signal?.removeEventListener('abort', abort); } })();
        tasks.set(task, { share: s, controller }); task.then(() => tasks.delete(task), () => tasks.delete(task)); return task;
    }
    async function serialized(s, fn) { const next = s.queue.then(fn); s.queue = next.catch(() => {}); return next; }
    async function entries(id, token, path = '', signal) {
        const s = get(id, token); sharePath(path);
        return run(s, signal, 15_000, 'list', async signal => {
            const target = await checkedSharePath(s.root, path), items = [];
            const directory = await opendir(target.path); let truncated = false;
            for await (const entry of directory) {
                check(s, signal);
                if (/^\.toolbox-share-/i.test(entry.name)) continue;
                if (items.length >= limits.entries) { truncated = true; break; }
                const child = path ? `${path}/${entry.name}` : entry.name;
                let type = 'blocked', info;
                try { shareName(entry.name); info = await lstat(join(target.path, entry.name)); if (!info.isSymbolicLink() && (info.isDirectory() || info.isFile() && info.nlink === 1)) type = info.isDirectory() ? 'directory' : 'file'; } catch { /* 变化/不可访问项显示为不可用 */ }
                if (!s.copying.has(child)) items.push({ name: entry.name, path: child, type, size: type === 'file' ? info.size : 0, modifiedAt: info?.mtimeMs || 0 });
            }
            await checkedSharePath(s.root, path); check(s, signal);
            items.sort((a, b) => (a.type === 'directory' ? 0 : 1) - (b.type === 'directory' ? 0 : 1) || a.name.localeCompare(b.name, 'zh-CN', { numeric: true }));
            return { ...snapshot(s), path, items, truncated };
        });
    }
    function writable(s) { if (!s.writable) throw new FileShareError('read_only', '此共享为只读，不能上传或新建文件夹', 403); }
    async function newFolder(id, token, input, signal) {
        const s = get(id, token); writable(s);
        if (!fields(input, ['path', 'name'])) throw new FileShareError('invalid_input', '文件夹信息无效');
        sharePath(input.path); shareName(input.name);
        return run(s, signal, 15_000, 'mkdir', signal => serialized(s, async () => {
            const parent = await checkedSharePath(s.root, input.path); check(s, signal);
            await mkdir(join(parent.path, input.name));
            await checkedSharePath(s.root, input.path); return { name: input.name };
        }));
    }
    async function upload(req, id, token, input, signal) {
        const s = get(id, token); writable(s);
        if (!fields(input, ['path', 'name', 'size', 'requestId']) || !/^[a-f0-9]{32}$/.test(input.requestId) || !Number.isSafeInteger(input.size) || input.size < 0 || input.size > limits.fileBytes) throw new FileShareError('invalid_input', '文件信息无效，单文件不能超过1GiB');
        sharePath(input.path); shareName(input.name);
        const key = JSON.stringify([input.path, input.name, input.size]), old = s.receipts.get(input.requestId);
        if (old && old.key !== key) throw new FileShareError('request_conflict', '此上传编号已用于其他文件，请重新选择', 409);
        if (old?.result) { req.resume(); return old.result; }
        if (old || uploads >= limits.uploads) throw new FileShareError('busy', '正在处理其他上传，请稍后重试', 429);
        if (s.receipts.size >= limits.receipts) throw new FileShareError('receipt_limit', '此共享接收文件已达上限，请停止后重新开启', 429);
        uploads++; s.receipts.set(input.requestId, { key });
        try { return await run(s, signal, limits.uploadMs, 'upload', async (signal, controller) => {
            let temporary, committed, idle;
            const resetIdle = () => { clearTimeout(idle); idle = setTimeout(() => controller.abort(new FileShareError('idle_timeout', '长时间没有收到数据，文件未保存', 408)), limits.idleMs); };
            try {
                await checkedSharePath(s.root, input.path); check(s, signal);
                temporary = await mkdtemp(join(tempRoot, 'tt-file-share-')); const file = join(temporary, 'upload');
                let size = 0; const hash = createHash('sha256'); resetIdle();
                const meter = new Transform({ transform(chunk, _encoding, callback) { size += chunk.length; resetIdle();
                    if (size > input.size || size > limits.fileBytes) return callback(new FileShareError('size_mismatch', '收到的文件大小超过声明大小，文件未保存', 413));
                    hash.update(chunk); callback(null, chunk); } });
                await pipeline(req, meter, createWriteStream(file, { flags: 'wx', mode: 0o600 }), { signal }); clearTimeout(idle);
                if (size !== input.size) throw new FileShareError('size_mismatch', '文件传输不完整，请重试', 400);
                const result = await serialized(s, async () => {
                    const parent = await checkedSharePath(s.root, input.path), extension = extname(input.name), stem = input.name.slice(0, input.name.length - extension.length);
                    for (let i = 0; i < 1000; i++) {
                        check(s, signal); const name = i ? `${stem} (${i})${extension}` : input.name; shareName(name);
                        const relative = input.path ? `${input.path}/${name}` : name, target = join(parent.path, name); s.copying.add(relative);
                        try {
                            await checkedSharePath(s.root, input.path);
                            await copyFile(file, target, constants.COPYFILE_EXCL); committed = target;
                            const after = await checkedSharePath(s.root, input.path);
                            if (!sameFile(parent.info, after.info)) throw new FileShareError('directory_changed', '目标目录已变化，文件未保存', 409);
                            check(s, signal); return { name, path: relative, size, sha256: hash.digest('hex'), renamed: name !== input.name };
                        } catch (error) { if (error.code !== 'EEXIST') throw error; }
                        finally { s.copying.delete(relative); }
                    }
                    throw new FileShareError('name_limit', '同名文件过多，请修改文件名后重试', 409);
                });
                check(s, signal); s.receipts.set(input.requestId, { key, result }); committed = null; return result;
            } finally {
                clearTimeout(idle);
                if (committed) await rm(committed, { force: true }).catch(() => log('cleanup', 'cleanup_failed'));
                if (temporary) await rm(temporary, { recursive: true, force: true }).catch(() => log('cleanup', 'cleanup_failed'));
            }
        }); } finally { uploads--; if (!s.receipts.get(input.requestId)?.result) s.receipts.delete(input.requestId); }
    }
    async function downloadTicket(id, token, input, signal) {
        const s = get(id, token);
        if (!fields(input, ['path']) || !input.path) throw new FileShareError('invalid_input', '请选择文件');
        if (s.copying.has(input.path)) throw new FileShareError('busy', '文件正在保存，请稍后重试', 409);
        if (tickets.size >= limits.tickets) throw new FileShareError('busy', '下载请求过多，请稍后重试', 429);
        return run(s, signal, 15_000, 'ticket', async signal => {
            const { file, info } = await openSharedFile(s.root, input.path); await file.close(); check(s, signal);
            if (tickets.size >= limits.tickets) throw new FileShareError('busy', '下载请求过多，请稍后重试', 429);
            const id = secret(); tickets.set(id, { share: s, path: input.path, expiresAt: now() + limits.ticketMs });
            return { ticket: id, name: basename(input.path), size: info.size };
        });
    }
    async function download(ticket, res, signal) {
        sweep(); const t = tickets.get(ticket); tickets.delete(ticket);
        if (!t || !t.share.active || disposed) throw new FileShareError('ticket_unavailable', '下载链接已失效，请重新点击下载', 410);
        if (downloads >= limits.downloads) throw new FileShareError('busy', '下载任务较多，请稍后重试', 429);
        downloads++;
        try { return await run(t.share, signal, limits.downloadMs, 'download', async (signal, controller) => {
            const { file, info } = await openSharedFile(t.share.root, t.path);
            let idle;
            const resetIdle = () => { clearTimeout(idle); idle = setTimeout(() => controller.abort(new FileShareError('idle_timeout', '下载长时间没有进展，连接已停止', 408)), limits.idleMs); };
            try {
                check(t.share, signal); res.attachment(basename(t.path)); res.type('application/octet-stream'); res.setHeader('Content-Length', String(info.size));
                res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
                resetIdle(); const progress = new Transform({ transform(chunk, _encoding, callback) { resetIdle(); callback(null, chunk); } });
                await pipeline(file.createReadStream({ autoClose: false }), progress, res, { signal });
            } finally { clearTimeout(idle); await file.close(); }
        }); } finally { downloads--; }
    }
    async function stop(id) {
        const s = shares.get(id); if (!s) return { stopped: true };
        close(s); shares.delete(id); sweep();
        await Promise.allSettled([...tasks].filter(([, state]) => state.share === s).map(([task]) => task));
        return { stopped: true };
    }
    async function dispose() {
        disposed = true; clearInterval(timer); for (const s of shares.values()) close(s); tickets.clear();
        await Promise.allSettled([...tasks.keys()]); shares.clear();
    }
    return { create, list, entries, newFolder, upload, downloadTicket, download, stop, dispose, limits };
}
