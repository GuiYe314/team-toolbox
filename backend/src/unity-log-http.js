import http from 'node:http';
import { Transform } from 'node:stream';

export class UnityLogError extends Error {
    constructor(code, message, status = 400) { super(message); this.code = code; this.status = status; }
}

export function ipv4Number(address) {
    if (typeof address !== 'string' || !/^(0|[1-9]\d{0,2})(\.(0|[1-9]\d{0,2})){3}$/.test(address)) return null;
    const parts = address.split('.').map(Number);
    return parts.some(n => n > 255) ? null : parts.reduce((n, part) => n * 256 + part, 0);
}
export const formatIpv4 = n => [24, 16, 8, 0].map(shift => (n >>> shift) & 255).join('.');
export function isPrivateIpv4(address) {
    if (ipv4Number(address) === null) return false;
    const [a, b] = address.split('.').map(Number);
    return a === 10 || a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168 || a === 169 && b === 254;
}
export function validatePort(port) {
    if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new UnityLogError('invalid_port', '日志端口必须在 1024～65535 之间');
    return port;
}
export const validLogName = name => typeof name === 'string' && name.length <= 200 && /^hhh_startup_[0-9a-fA-F_]+\.log$/.test(name);
export function requireLogName(name) {
    if (!validLogName(name)) throw new UnityLogError('invalid_file', '请选择设备列表中的日志文件');
    return name;
}

/** 固定 IPv4 + 固定端点，不解析域名、不跟随重定向；超时覆盖整个响应。 */
export function openLogResponse({ address, port, path, headers = {}, signal, timeout = 8000, maxBytes = 2 * 1024 * 1024, allowLoopback = false }) {
    if (!isPrivateIpv4(address) && !(allowLoopback && address === '127.0.0.1')) throw new UnityLogError('invalid_address', '只允许读取局域网 IPv4 日志设备');
    if (!Number.isInteger(port) || port < 1 || port > 65535 || !/^\/(api\/(discovery|files|file)(\?|$)|download\?|archive$)/.test(path))
        throw new UnityLogError('invalid_target', '日志设备请求无效');
    return new Promise((resolve, reject) => {
        let incoming, output, timer;
        const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', cancel); };
        const fail = error => { output?.destroy(error); incoming?.destroy(); req.destroy(error); reject(error); };
        const cancel = () => fail(new UnityLogError('cancelled', '操作已取消', 499));
        const req = http.get({ hostname: address, port, path, headers, signal, agent: false }, response => {
            incoming = response;
            if (response.statusCode !== 200) {
                const status = response.statusCode;
                response.destroy();
                reject(new UnityLogError(status === 401 ? 'device_auth' : status === 404 ? 'file_missing' : 'device_response',
                    status === 401 ? '设备读取会话已过期，请重新选择设备' : status === 404 ? '日志已被设备清理，请刷新文件列表' : '设备未能返回日志，请保持应用在前台后重试', status === 404 ? 404 : 502));
                return;
            }
            const declared = response.headers['content-length'];
            if (declared !== undefined && (!/^\d+$/.test(declared) || Number(declared) > maxBytes)) {
                response.destroy(); reject(new UnityLogError('response_limit', '设备返回的数据超出读取上限', 502)); return;
            }
            let bytes = 0;
            const limited = new Transform({ transform(chunk, encoding, callback) {
                bytes += chunk.length;
                callback(bytes > maxBytes ? new UnityLogError('response_limit', '设备返回的数据超出读取上限', 502) : null, chunk);
            } });
            output = limited;
            // 首个数据块可能早于 await 的消费端到达；保留流错误供消费端读取，避免未处理事件。
            limited.on('error', () => response.destroy());
            const destroySource = () => response.destroy();
            limited.once('close', () => { cleanup(); destroySource(); });
            response.once('error', error => limited.destroy(error));
            response.pipe(limited);
            resolve({ stream: limited, contentType: String(response.headers['content-type'] || '').split(';')[0], length: declared === undefined ? null : Number(declared) });
        });
        timer = setTimeout(() => fail(new UnityLogError('device_timeout', '设备读取超时，请检查局域网连接并保持应用在前台', 504)), timeout);
        signal?.addEventListener('abort', cancel, { once: true }); if (signal?.aborted) cancel();
        req.once('error', error => { if (!output) cleanup(); reject(error instanceof UnityLogError ? error : new UnityLogError(signal?.aborted ? 'cancelled' : 'device_offline', signal?.aborted ? '操作已取消' : '无法读取设备，请保持应用在前台并重新搜索', signal?.aborted ? 499 : 502)); });
        req.once('close', () => { if (!output) cleanup(); });
    });
}

export async function readLogJson(options) {
    const { stream, contentType } = await openLogResponse(options);
    if (contentType !== 'application/json') { stream.destroy(); throw new UnityLogError('invalid_protocol', '设备日志协议不兼容，请更新手机端日志模块', 502); }
    const chunks = [];
    try {
        for await (const chunk of stream) chunks.push(chunk);
        return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch (error) {
        if (error instanceof UnityLogError) throw error;
        throw new UnityLogError('invalid_response', '设备日志响应不完整，请重新读取', 502);
    }
}
