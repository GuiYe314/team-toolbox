import { randomBytes, timingSafeEqual } from 'node:crypto';
import { posix } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { RemoteFilesError, invalid, remoteName, remotePath, remoteFailure, connectRemote, connectionInput, probeSftp } from './remote-files-protocol.js';

export const REMOTE_LIMITS = Object.freeze({ sessions: 4, transfers: 2, jobs: 100, fileBytes: 1024 ** 3, commandMs: 15_000, transferMs: 15 * 60_000, idleMs: 90_000, heartbeatMs: 90_000, ticketMs: 60_000 });
const token = () => randomBytes(24).toString('hex');
const cancelled = () => new RemoteFilesError('cancelled', '操作已停止，连接已关闭；请核对远端文件后重新连接', 409);
const object = (input, names) => input && typeof input === 'object' && !Array.isArray(input) && Object.keys(input).every(key => names.includes(key));
export function createRemoteFilesService({ limits: overrides, now = Date.now, connector = connectRemote, prober = probeSftp, tlsCA,
    log = (action, code) => console.warn('[remote-files]', action, code) } = {}) {
    const limits = { ...REMOTE_LIMITS, ...overrides }, sessions = new Map(), tickets = new Map(), starting = new Set();
    let active = 0, disposed = false;
    function lookup(id, secret) {
        const s = sessions.get(id);
        if (!s || typeof secret !== 'string' || !/^[a-f0-9]{48}$/.test(secret) || !timingSafeEqual(Buffer.from(s.token), Buffer.from(secret)) || disposed) throw new RemoteFilesError('session_unavailable', '连接会话已失效，请重新连接服务器', 410);
        s.touched = now(); return s;
    }
    function connected(s) { if (!s.connected || !s.adapter || s.adapter.closed) { s.connected = false; throw new RemoteFilesError('disconnected', '服务器连接已断开，请重新连接', 409); } }
    const jobView = ({ id, direction, path, name, size, state, bytes, received, message, cleanupNeeded, temp }) => ({ id, direction, path, name, size, state, bytes, received, message, cleanupNeeded, ...(cleanupNeeded ? { temporaryPath: temp } : {}) });
    function snapshot(s) { if (s.adapter?.closed) s.connected = false; return { id: s.id, protocol: s.protocol, host: s.host, port: s.port, username: s.username, home: s.home, connected: s.connected,
        busy: !!s.controller, jobs: [...s.jobs.values()].map(jobView), limits }; }
    function close(s) { s.connected = false; s.controller?.abort(cancelled()); s.adapter?.close(); for (const job of s.jobs.values()) if (job.state === 'waiting') { job.state = 'cancelled'; job.message = '连接已关闭，任务未开始'; } }
    function sweep() {
        for (const [id, s] of sessions) if (now() - s.touched > limits.heartbeatMs) { close(s); if (!s.controller) sessions.delete(id); }
        for (const [id, t] of tickets) if (t.expiresAt <= now() || !t.session.connected) tickets.delete(id);
    }
    const timer = setInterval(sweep, 1000); timer.unref?.();
    async function opening(signal, fn) {
        sweep(); if (disposed || sessions.size + starting.size >= limits.sessions) throw new RemoteFilesError('session_limit', '连接过多，请先断开其他FTP会话', 429);
        const c = new AbortController(), abort = () => c.abort(cancelled()), timeout = setTimeout(() => c.abort(new RemoteFilesError('timeout', '连接服务器超时', 408)), limits.commandMs);
        let completed; const entry = { controller: c, done: new Promise(resolve => { completed = resolve; }) };
        starting.add(entry); signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort();
        try { return await fn(c.signal); } catch (e) { throw c.signal.aborted ? c.signal.reason : remoteFailure(e); }
        finally { starting.delete(entry); completed(); clearTimeout(timeout); signal?.removeEventListener('abort', abort); }
    }
    async function connect(input, signal) {
        const config = connectionInput(input);
        return opening(signal, async signal => {
            const adapter = await connector(config, { signal, timeoutMs: limits.commandMs, tlsCA });
            if (signal.aborted || disposed) { adapter.close(); throw cancelled(); }
            const s = { id: randomBytes(16).toString('hex'), token: token(), protocol: config.protocol, host: config.host, port: config.port, username: config.username,
                home: remotePath(adapter.home), connected: true, adapter, touched: now(), jobs: new Map(), controller: null, pending: null };
            sessions.set(s.id, s); return { ...snapshot(s), token: s.token };
        });
    }
    const probe = (input, signal) => opening(signal, signal => prober(input, signal, limits.commandMs));
    async function operation(s, signal, transfer, fn) {
        connected(s); if (s.controller) throw new RemoteFilesError('busy', '此连接正在执行任务，请稍后重试', 409);
        if (transfer && active >= limits.transfers) throw new RemoteFilesError('busy', '活动传输已达上限，请稍后重试', 429);
        const adapter = s.adapter, c = new AbortController(), abort = () => c.abort(cancelled()); s.controller = c; if (transfer) active++;
        const closed = () => { s.connected = false; adapter.close(); }; c.signal.addEventListener('abort', closed, { once: true });
        signal?.addEventListener('abort', abort, { once: true });
        const timeout = setTimeout(() => c.abort(new RemoteFilesError('timeout', '远端操作超时，连接已关闭，请重新连接后核对文件', 408)), transfer ? limits.transferMs : limits.commandMs);
        if (signal?.aborted) abort();
        const pending = Promise.resolve().then(async () => { try { if (c.signal.aborted) throw c.signal.reason; return await fn(adapter, c.signal); }
            catch (error) { if (adapter.closed) s.connected = false; const safe = c.signal.aborted ? c.signal.reason : remoteFailure(error); log('operation', safe.code); throw safe; }
            finally { clearTimeout(timeout); signal?.removeEventListener('abort', abort); c.signal.removeEventListener('abort', closed); s.controller = null; s.pending = null; s.touched = now(); if (transfer) active--; } });
        s.pending = pending; return pending;
    }
    function normalized(items, path) { return items.map(item => ({ ...item, path: posix.join(path, remoteName(item.name)) })).sort((a, b) => (a.type === 'directory' ? 0 : 1) - (b.type === 'directory' ? 0 : 1) || a.name.localeCompare(b.name, 'zh-CN', { numeric: true })); }
    async function entries(id, secret, path, signal) {
        const s = lookup(id, secret); path = remotePath(path);
        return operation(s, signal, false, async adapter => ({ path, items: normalized(await adapter.list(path), path) }));
    }
    async function alter(id, secret, input, signal) {
        const s = lookup(id, secret);
        if (!object(input, ['action', 'path', 'name', 'confirm']) || input.confirm !== true || !['mkdir', 'rename', 'delete'].includes(input.action)) throw invalid('请确认远端文件操作');
        const path = remotePath(input.path); if (input.action !== 'mkdir' && path === '/') throw invalid('不能修改服务器根目录');
        const name = input.action === 'delete' ? '' : remoteName(input.name);
        return operation(s, signal, false, async adapter => {
            if (input.action === 'mkdir') { if ((await adapter.list(path)).some(item => item.name === name)) throw new RemoteFilesError('name_exists', '远端同名项目已存在', 409); await adapter.mkdir(posix.join(path, name)); }
            else {
                const parent = posix.dirname(path), items = await adapter.list(parent), item = items.find(item => item.name === posix.basename(path));
                if (!item || item.type === 'blocked') throw invalid('所选远端项目不存在或不支持此操作');
                if (input.action === 'rename') { if (items.some(item => item.name === name)) throw new RemoteFilesError('name_exists', '远端同名项目已存在，重命名不覆盖文件', 409); await adapter.rename(path, posix.join(parent, name)); }
                else if (item.type === 'directory') await adapter.rmdir(path); else await adapter.remove(path);
            }
            return { success: true };
        });
    }
    async function prepare(id, secret, input, signal) {
        const s = lookup(id, secret);
        if (!object(input, ['direction', 'path', 'name', 'size', 'overwrite', 'confirm']) || input.confirm !== true || !['upload', 'download'].includes(input.direction)) throw invalid('请确认传输方向和目标');
        const path = remotePath(input.path), upload = input.direction === 'upload', name = upload ? remoteName(input.name) : posix.basename(path);
        if (upload && (!Number.isSafeInteger(input.size) || input.size < 0 || input.size > limits.fileBytes || typeof input.overwrite !== 'boolean')) throw invalid('上传单文件不能超过1GiB');
        return operation(s, signal, false, async adapter => {
            const items = await adapter.list(upload ? path : posix.dirname(path)), existing = items.find(item => item.name === name);
            if (existing?.type && existing.type !== 'file' || !upload && !existing) throw invalid('请选择普通文件，不支持目录或链接传输');
            if (upload && existing && !input.overwrite) throw new RemoteFilesError('name_exists', '远端已存在同名文件，默认不覆盖；确认覆盖后可重新上传', 409);
            const size = upload ? input.size : Number(existing.size); if (!Number.isSafeInteger(size) || size < 0 || size > limits.fileBytes) throw invalid('单文件传输上限为1GiB');
            for (const [jobId, job] of s.jobs) if (s.jobs.size >= limits.jobs && ['success', 'failed', 'cancelled'].includes(job.state)) s.jobs.delete(jobId);
            if (s.jobs.size >= limits.jobs) throw new RemoteFilesError('job_limit', '待处理任务过多，请先完成或取消任务', 429);
            const job = { id: randomBytes(16).toString('hex'), direction: input.direction, path: upload ? posix.join(path, name) : path, name, size, overwrite: upload && input.overwrite,
                original: existing, state: 'waiting', bytes: 0, received: 0, message: '', temp: posix.join(upload ? path : posix.dirname(path), '.team-toolbox-upload-' + token() + '.part'), cleanupNeeded: false };
            s.jobs.set(job.id, job);
            if (upload) return jobView(job);
            const ticket = token(); tickets.set(ticket, { session: s, job, expiresAt: now() + limits.ticketMs }); return { ...jobView(job), ticket };
        });
    }
    function transfer(s, job, signal, fn) {
        if (job.state !== 'waiting') throw new RemoteFilesError('job_unavailable', '此传输已开始或结束，请刷新结果', 409);
        return operation(s, signal, true, async (adapter, signal) => {
            job.state = 'transferring'; let idle;
            const progress = bytes => { job.bytes = Math.min(job.size, bytes); clearTimeout(idle); idle = setTimeout(() => s.controller?.abort(new RemoteFilesError('idle_timeout', '传输90秒无进展，已关闭连接', 408)), limits.idleMs); };
            progress(0);
            try { await fn(adapter, signal, progress); if (signal.aborted) throw signal.reason;
                job.state = 'success'; job.bytes = job.size; job.message = job.direction === 'upload' ? '远端已确认保存' : '服务器已发送完成，请核对浏览器下载'; return jobView(job);
            } catch (error) { job.state = signal.aborted ? 'cancelled' : 'failed'; const safe = signal.aborted ? signal.reason : remoteFailure(error); job.message = safe.message; throw safe; }
            finally { clearTimeout(idle); }
        });
    }
    async function upload(req, id, secret, jobId, signal) {
        const s = lookup(id, secret), job = s.jobs.get(jobId);
        if (!job || job.direction !== 'upload') throw invalid('上传任务无效');
        return transfer(s, job, signal, async (adapter, signal, progress) => {
            let received = 0, staged = false;
            const meter = new Transform({ transform(chunk, _encoding, callback) { received += chunk.length; job.received = received;
                callback(received > job.size ? new RemoteFilesError('size_mismatch', '上传大小超过声明，文件未提交', 413) : null, chunk); } });
            const inputError = error => meter.destroy(error), abort = () => meter.destroy(signal.reason);
            // 监听错误直到传输退出；pipe本身不会传播来源的错误。
            meter.on('error', () => {}); req.once('error', inputError); signal.addEventListener('abort', abort, { once: true }); req.pipe(meter);
            try {
                staged = true; await adapter.upload(meter, job.temp, progress);
                if (signal.aborted) throw signal.reason;
                if (received !== job.size) throw new RemoteFilesError('size_mismatch', '上传内容不完整，文件未提交');
                const exists = (await adapter.list(posix.dirname(job.path))).find(item => item.name === job.name);
                if (exists && (!job.overwrite || exists.type !== 'file' || !job.original || exists.size !== job.original.size || exists.modifiedAt !== job.original.modifiedAt)) throw new RemoteFilesError('remote_changed', '远端同名文件已变化，未覆盖；请刷新后重新确认', 409);
                await adapter.commit(job.temp, job.path, !!exists && job.overwrite); staged = false;
            } finally {
                req.unpipe(meter); req.removeListener('error', inputError); signal.removeEventListener('abort', abort); meter.destroy();
                if (staged) { try { if (adapter.closed) throw cancelled(); await adapter.remove(job.temp); } catch { job.cleanupNeeded = true; } }
            }
        });
    }
    async function download(ticket, res, signal) {
        sweep(); const t = tickets.get(ticket); tickets.delete(ticket);
        if (!t || !t.session.connected || t.expiresAt <= now()) throw new RemoteFilesError('ticket_unavailable', '下载链接已到期或连接已关闭，请重新下载', 410);
        const { session: s, job } = t;
        return transfer(s, job, signal, async (adapter, signal, progress) => {
            const current = (await adapter.list(posix.dirname(job.path))).find(item => item.name === job.name);
            if (!current || current.type !== 'file' || current.size !== job.size || current.modifiedAt !== job.original.modifiedAt) throw new RemoteFilesError('remote_changed', '远端文件已变化，请刷新后重新下载', 409);
            res.attachment(job.name); res.type('application/octet-stream'); res.setHeader('Content-Length', String(job.size)); res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
            let bytes = 0; const meter = new Transform({ transform(chunk, _encoding, callback) { bytes += chunk.length; progress(bytes); callback(bytes > job.size ? new RemoteFilesError('remote_changed', '远端文件大小发生变化', 409) : null, chunk); },
                flush(callback) { callback(bytes === job.size ? null : new RemoteFilesError('remote_changed', '远端文件传输不完整', 409)); } });
            const outgoing = pipeline(meter, res, { signal }); outgoing.catch(() => {});
            try { await adapter.download(job.path, meter, progress); await outgoing; }
            catch (error) { meter.destroy(error); res.destroy(); await outgoing.catch(() => {}); throw error; }
        });
    }
    function status(id, secret) { return snapshot(lookup(id, secret)); }
    async function cancel(id, secret) { const s = lookup(id, secret); close(s); if (s.pending) await s.pending.catch(() => {}); return snapshot(s); }
    async function disconnect(id, secret) { const s = lookup(id, secret); await cancel(id, secret); sessions.delete(s.id); for (const [ticket, t] of tickets) if (t.session === s) tickets.delete(ticket); return { disconnected: true }; }
    async function dispose() { disposed = true; clearInterval(timer); const openings = [...starting]; for (const entry of openings) entry.controller.abort(cancelled()); for (const s of sessions.values()) close(s);
        await Promise.allSettled([...openings.map(entry => entry.done), ...[...sessions.values()].map(s => s.pending).filter(Boolean)]); sessions.clear(); tickets.clear(); }
    return { probe, connect, status, entries, alter, prepare, upload, download, cancel, disconnect, dispose, limits };
}
