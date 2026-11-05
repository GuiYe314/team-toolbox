import { randomUUID } from 'node:crypto';
import { probeLogDevice, scanLogDevices } from './unity-log-discovery.js';
import { openLogResponse, readLogJson, requireLogName, UnityLogError, validLogName } from './unity-log-http.js';

const publicDevice = device => ({ deviceId: device.deviceId, deviceName: device.deviceName, deviceModel: device.deviceModel,
    platform: device.platform, appId: device.appId, appVersion: device.appVersion, address: device.address, port: device.port });
const requireId = id => {
    if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/.test(id)) throw new UnityLogError('invalid_session', '读取会话无效，请重新选择设备');
    return id;
};
export function parseLogFiles(body) {
    if (!Array.isArray(body?.files) || body.files.length > 50) throw new UnityLogError('invalid_response', '设备日志文件列表无效', 502);
    const seen = new Set();
    return body.files.map(file => {
        if (!validLogName(file?.name) || seen.has(file.name) || !Number.isSafeInteger(file.bytes) || file.bytes < 0
            || file.bytes > 32 * 1024 * 1024 || typeof file.modifiedUtc !== 'string' || !Number.isFinite(Date.parse(file.modifiedUtc)))
            throw new UnityLogError('invalid_response', '设备日志文件信息无效', 502);
        seen.add(file.name);
        return { name: file.name, bytes: file.bytes, modifiedUtc: file.modifiedUtc };
    }).sort((a, b) => Date.parse(b.modifiedUtc) - Date.parse(a.modifiedUtc) || b.name.localeCompare(a.name));
}

export function createUnityLogService({ scan = scanLogDevices, probe = probeLogDevice, readJson = readLogJson, openResponse = openLogResponse, now = Date.now } = {}) {
    const devices = new Map(), sessions = new Map(), operations = new Set();
    let scanning = false, disposed = false, downloading = false;
    const cleanup = () => {
        for (const [id, session] of sessions) if (session.expires <= now()) closeSession(id);
        for (const [id, device] of devices) if (device.expires <= now()) devices.delete(id);
    };
    const timer = setInterval(cleanup, 15000); timer.unref();
    function closeSession(id) {
        const session = sessions.get(id);
        if (session) { session.controller.abort(); session.ticket = ''; sessions.delete(id); }
        return { closed: true };
    }
    function begin(signal, session) {
        if (disposed) throw new UnityLogError('stopped', '日志服务已关闭', 503);
        signal?.throwIfAborted();
        if (operations.size >= 16 || session && session.active >= 2) throw new UnityLogError('busy', '日志读取忙，请稍后重试', 409);
        const controller = new AbortController(); operations.add(controller);
        if (session) session.active++;
        return { signal: AbortSignal.any([controller.signal, ...(signal ? [signal] : []), ...(session ? [session.controller.signal] : [])]),
            release() { operations.delete(controller); if (session) session.active--; } };
    }
    function getSession(id) {
        requireId(id); cleanup();
        const session = sessions.get(id);
        if (!session) throw new UnityLogError('session_expired', '读取会话已结束，请重新选择设备', 410);
        session.expires = now() + 120000;
        return session;
    }
    async function renew(session, signal) {
        const updated = await probe(session.address, session.port, signal, 2500);
        if (updated.deviceId !== session.deviceId || updated.appId !== session.appId)
            throw new UnityLogError('device_changed', '此 IP 已属于其它设备，请重新搜索并选择', 409);
        signal.throwIfAborted(); session.ticket = updated.ticket;
    }
    async function authenticated(session, path, signal, binary = false, maxBytes = 2 * 1024 * 1024) {
        for (let attempt = 0; ; attempt++) {
            try {
                return await (binary ? openResponse : readJson)({ address: session.address, port: session.port, path,
                    headers: { 'X-HHH-Log-Session': session.ticket }, signal, timeout: binary ? 45000 : 8000, maxBytes });
            } catch (error) {
                if (attempt || error.code !== 'device_auth') throw error;
                await renew(session, signal);
            }
        }
    }
    return {
        async discover({ port = 17523, address = '' } = {}, signal) {
            if (scanning) throw new UnityLogError('search_busy', '正在搜索局域网，请等待或取消当前搜索', 409);
            const operation = begin(signal); scanning = true;
            try {
                const result = await scan({ port, address, signal: operation.signal });
                operation.signal.throwIfAborted();
                devices.clear();
                for (const device of result.devices) devices.set(device.deviceId, { ...device, expires: now() + 300000 });
                return { ...result, devices: result.devices.map(publicDevice) };
            } finally { scanning = false; operation.release(); }
        },
        async connect(deviceId, signal) {
            cleanup();
            if (typeof deviceId !== 'string' || !/^[0-9a-f]{32}$/.test(deviceId) || !devices.has(deviceId))
                throw new UnityLogError('device_missing', '设备搜索结果已过期，请重新搜索', 404);
            if (sessions.size >= 8) throw new UnityLogError('session_limit', '读取会话过多，请先关闭其它日志页面', 409);
            const operation = begin(signal), device = devices.get(deviceId);
            try {
                const updated = await probe(device.address, device.port, operation.signal, 2500);
                if (updated.deviceId !== deviceId || updated.appId !== device.appId) throw new UnityLogError('device_changed', '设备地址已变化，请重新搜索', 409);
                const session = { ...device, ticket: updated.ticket, controller: new AbortController(), active: 0, expires: now() + 120000 };
                const files = parseLogFiles(await authenticated(session, '/api/files', operation.signal));
                operation.signal.throwIfAborted();
                // 检查等待中的并发创建，避免超过八个会话。
                if (sessions.size >= 8) throw new UnityLogError('session_limit', '读取会话过多，请关闭其它页面', 409);
                const id = randomUUID(); sessions.set(id, session);
                return { id, device: publicDevice(device), files };
            } finally { operation.release(); }
        },
        async files(id, signal) {
            const session = getSession(id), operation = begin(signal, session);
            try { return { files: parseLogFiles(await authenticated(session, '/api/files', operation.signal)) }; }
            finally { operation.release(); }
        },
        async preview(id, name, signal) {
            requireLogName(name);
            const session = getSession(id), operation = begin(signal, session);
            try {
                const body = await authenticated(session, `/api/file?name=${encodeURIComponent(name)}`, operation.signal);
                if (typeof body?.text !== 'string' || typeof body.truncated !== 'boolean' || Buffer.byteLength(body.text, 'utf8') > 256 * 1024)
                    throw new UnityLogError('invalid_response', '设备日志预览无效或过大', 502);
                return { text: body.text, truncated: body.truncated };
            } finally { operation.release(); }
        },
        async download(id, name, archive, signal) {
            if (!archive) requireLogName(name);
            if (downloading) throw new UnityLogError('download_busy', '正在下载日志，请等待当前下载完成', 409);
            const session = getSession(id), operation = begin(signal, session); downloading = true;
            let released = false;
            const release = () => { if (!released) { released = true; downloading = false; operation.release(); } };
            try {
                const response = await authenticated(session, archive ? '/archive' : `/download?name=${encodeURIComponent(name)}`, operation.signal, true, (archive ? 120 : 32) * 1024 * 1024);
                if (response.contentType !== (archive ? 'application/zip' : 'text/plain')) {
                    response.stream.destroy(); throw new UnityLogError('invalid_response', '设备未返回有效的日志下载文件', 502);
                }
                response.stream.once('close', release);
                return { ...response, name: archive ? `StartupLogs_${deviceShort(session)}_${new Date(now()).toISOString().replace(/[:.]/g, '-')}.zip` : name };
            } catch (error) { release(); throw error; }
        },
        close(id) { requireId(id); return closeSession(id); },
        dispose() { disposed = true; clearInterval(timer); for (const id of sessions.keys()) closeSession(id); for (const operation of operations) operation.abort(); devices.clear(); }
    };
}
const deviceShort = device => device.deviceId.slice(0, 8);
