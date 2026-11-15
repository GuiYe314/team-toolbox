import { randomBytes, timingSafeEqual } from 'node:crypto';
import { ALBUM_LIMITS, AlbumError, validateAlbumFile } from './phone-album-protocol.js';
import { commitAlbumFile, receiveAlbumFile } from './phone-album-storage.js';
import { syncToMirror, schedulePreview } from './asset-postprocess.js';

const token = () => randomBytes(24).toString('hex');
function matches(expected, value) {
    return typeof value === 'string' && /^[a-f0-9]{48}$/.test(value) && timingSafeEqual(Buffer.from(expected), Buffer.from(value));
}

export function createPhoneAlbumService({ getDb, limits: overrides, now = Date.now, log = code => console.warn('[phone-album]', code), postprocess } = {}) {
    const limits = { ...ALBUM_LIMITS, ...overrides };
    const sessions = new Map(), pending = new Map();
    let active = 0, disposed = false, processing = Promise.resolve();
    const post = postprocess || (async (db, result, ext) => { syncToMirror(db, result.assetId, result.versionId); await schedulePreview(db, result.assetId, result.versionId, ext); });
    function close(session) {
        session.accepting = false;
        for (const entry of session.entries.values()) entry.controller?.abort();
    }
    function sweep() {
        for (const [id, session] of sessions) if (session.expiresAt <= now()) { close(session); sessions.delete(id); }
    }
    const timer = setInterval(sweep, 15_000); timer.unref?.();
    function get(id, secret, scope) {
        sweep();
        const session = sessions.get(id);
        if (!session || !matches(scope === 'manage' ? session.manageToken : session.uploadToken, secret)) throw new AlbumError('session_unavailable', '接收链接已到期、已关闭或无效，请在电脑重新生成二维码', 410);
        return session;
    }
    function snapshot(session) {
        const items = [...session.entries.values()].map(({ id, name, size, received, status, message, result }) => ({ id, name, size, received, status, message, assetId: result?.assetId || null }));
        return { id: session.id, folderName: session.folderName, folderId: session.folderId, expiresAt: session.expiresAt, accepting: session.accepting,
            limits, items, count: items.filter(item => item.status === 'success').length, bytes: session.bytes };
    }
    function create(input) {
        if (disposed) throw new AlbumError('unavailable', '接收服务正在关闭', 503);
        if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => key !== 'folderId') || !(input.folderId === null || Number.isSafeInteger(input.folderId) && input.folderId > 0)) throw new AlbumError('invalid_input', '请选择资源库中的目标文件夹');
        sweep();
        for (const [id, session] of sessions) if (!session.accepting && ![...session.entries.values()].some(entry => entry.controller)) sessions.delete(id);
        if (sessions.size >= limits.sessions) throw new AlbumError('session_limit', '接收页面过多，请先停止其他接收会话', 429);
        const folder = input.folderId === null ? null : getDb().prepare('SELECT name FROM asset_folders WHERE id = ?').get(input.folderId);
        if (input.folderId !== null && !folder) throw new AlbumError('folder_missing', '目标资源文件夹不存在');
        const session = { id: randomBytes(16).toString('hex'), uploadToken: token(), manageToken: token(), folderId: input.folderId, folderName: folder?.name || '未分类',
            expiresAt: now() + limits.ttlMs, accepting: true, bytes: 0, reserved: 0, entries: new Map() };
        sessions.set(session.id, session);
        return { ...snapshot(session), uploadToken: session.uploadToken, manageToken: session.manageToken };
    }
    function status(id, secret, scope = 'upload') { return snapshot(get(id, secret, scope)); }
    async function stop(id, secret) {
        const session = get(id, secret, 'manage'); close(session);
        await Promise.allSettled([...pending].filter(([, sessionId]) => sessionId === id).map(([task]) => task));
        return snapshot(session);
    }
    async function transfer(req, id, secret, input, signal) {
        const session = get(id, secret, 'upload');
        const file = validateAlbumFile(input, limits);
        const old = session.entries.get(file.id);
        if (old && (old.name !== file.name || old.size !== file.size)) throw new AlbumError('conflict', '此上传编号已用于其他文件，请重新选择', 409);
        if (old?.status === 'success') { req.resume(); return old.result; }
        if (!session.accepting) throw new AlbumError('session_closed', '电脑已停止接收，已成功文件仍在资源库', 410);
        if (old?.controller) throw new AlbumError('busy', '此文件仍在保存，请稍后重试核对结果', 409);
        if (active >= limits.concurrent) throw new AlbumError('busy', '接收端正在处理其他文件，请稍后重试', 429);
        if (!old && session.entries.size >= limits.files) throw new AlbumError('file_limit', '此接收会话已达到 200 个文件，请重新生成二维码', 413);
        if (session.bytes + session.reserved + file.size > limits.totalBytes) throw new AlbumError('total_limit', '此接收会话累计不能超过 8 GiB', 413);
        const controller = new AbortController(), abort = () => controller.abort();
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) controller.abort();
        const entry = { id: file.id, name: file.name, size: file.size, received: 0, status: 'receiving', controller, message: '' };
        session.entries.set(file.id, entry); session.reserved += file.size; active++;
        let received;
        try {
            received = await receiveAlbumFile(req, file, controller, limits, bytes => { entry.received = bytes; });
            if (controller.signal.aborted || !session.accepting || session.expiresAt <= now() || disposed) throw new AlbumError('cancelled', '接收已停止或链接已到期，文件未保存', 410);
            const db = getDb();
            if (session.folderId !== null && !db.prepare('SELECT id FROM asset_folders WHERE id = ?').get(session.folderId)) throw new AlbumError('folder_missing', '电脑上的目标文件夹已删除，请重新生成二维码', 409);
            entry.status = 'saving';
            const result = commitAlbumFile(db, file, received, session.folderId);
            entry.status = 'success'; entry.result = result; session.bytes += file.size;
            processing = processing.then(() => post(db, result, file.ext)).catch(() => log('postprocess_failed'));
            return result;
        } catch (error) {
            const safe = error instanceof AlbumError ? error : new AlbumError('upload_failed', '文件未保存，请检查电脑空间与资源库后重试', 500);
            entry.status = 'failed'; entry.message = safe.message;
            log(safe.code); throw safe;
        } finally {
            try { await received?.cleanup(); } catch { log('cleanup_failed'); }
            signal?.removeEventListener('abort', abort); entry.controller = null; session.reserved -= file.size; active--;
        }
    }
    function upload(...args) {
        const task = transfer(...args); pending.set(task, args[1]);
        task.then(() => pending.delete(task), () => pending.delete(task)); return task;
    }
    async function dispose() {
        disposed = true; clearInterval(timer); for (const session of sessions.values()) close(session);
        await Promise.allSettled([...pending.keys()]); await processing; sessions.clear();
    }
    return { create, status, stop, upload, dispose };
}
