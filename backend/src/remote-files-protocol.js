import { Client as FtpClient } from 'basic-ftp';
import ssh2 from 'ssh2';
import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { domainToASCII } from 'node:url';
import { posix } from 'node:path';
import { pipeline } from 'node:stream/promises';

export class RemoteFilesError extends Error {
    constructor(code, message, status = 400) { super(message); this.code = code; this.status = status; }
}
export const invalid = message => new RemoteFilesError('invalid_input', message || '连接或文件参数无效');
export function remoteName(value) {
    if (typeof value !== 'string' || !value || value.length > 180 || /[\/\\\x00-\x1f\x7f]/.test(value) || ['.', '..'].includes(value)) throw invalid('文件名不能包含目录分隔符或控制字符');
    return value;
}
export function remotePath(value) {
    if (typeof value !== 'string' || !value.startsWith('/') || value.length > 2048 || /[\\\x00-\x1f\x7f]/.test(value)) throw invalid('请选择远端的绝对目录');
    const path = posix.normalize(value); if (path.split('/').length > 64) throw invalid('远端目录层级过深'); return path;
}
export function connectionInput(value, probe = false) {
    const names = probe ? ['host', 'port'] : ['host', 'port', 'protocol', 'username', 'password', 'fingerprint', 'confirm'];
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !names.includes(key))) throw invalid();
    if (typeof value.host !== 'string' || !value.host || value.host.length > 253 || /[\s/\\@?#%\x00-\x1f]/.test(value.host)) throw invalid('请输入主机名或IP，不要带协议前缀或路径');
    const host = isIP(value.host) ? value.host : domainToASCII(value.host);
    if (!host || !isIP(host) && !/^(?=.{1,253}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(host) || ['0.0.0.0', '255.255.255.255', '::'].includes(host)) throw invalid('主机地址无效');
    if (!Number.isInteger(value.port) || value.port < 1 || value.port > 65535) throw invalid('端口必须为1～65535');
    if (probe) return { host, port: value.port };
    if (!['ftp', 'ftps', 'sftp'].includes(value.protocol) || value.confirm !== true) throw invalid('请确认连接协议和目标服务器');
    if (typeof value.username !== 'string' || !value.username || value.username.length > 128 || /[\x00-\x1f\x7f]/.test(value.username)
        || typeof value.password !== 'string' || value.password.length > 512 || /[\x00-\x1f\x7f]/.test(value.password)) throw invalid('用户名或密码格式无效');
    if (value.protocol === 'sftp' && !/^SHA256:[A-Za-z0-9+/]{43}$/.test(value.fingerprint || '')) throw new RemoteFilesError('host_key_required', '请先获取并核对SFTP服务器指纹');
    return { ...value, host };
}
export function remoteFailure(error) {
    if (error instanceof RemoteFilesError) return error;
    if (['DEPTH_ZERO_SELF_SIGNED_CERT', 'CERT_HAS_EXPIRED', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'SELF_SIGNED_CERT_IN_CHAIN', 'ERR_TLS_CERT_ALTNAME_INVALID'].includes(error?.code)) return new RemoteFilesError('tls_untrusted', 'FTPS证书未受信任、已到期或主机名不匹配，请检查服务器证书', 502);
    if (error?.code === 530 || error?.level === 'client-authentication') return new RemoteFilesError('authentication_failed', '服务器拒绝登录，请检查用户名、密码和登录权限', 403);
    if ([2, 550].includes(error?.code)) return new RemoteFilesError('remote_access', '远端文件不存在或没有访问权限，请刷新目录核对', 403);
    if ([3, 553].includes(error?.code)) return new RemoteFilesError('permission_denied', '服务器拒绝此文件操作，请检查目录权限和名称', 403);
    return new RemoteFilesError('remote_failed', '远端连接或文件操作失败，请检查服务器状态、协议和权限后重新连接', 502);
}
const fingerprint = key => 'SHA256:' + createHash('sha256').update(key).digest('base64').replace(/=+$/, '');
const call = (target, method, ...args) => new Promise((resolve, reject) => target[method](...args, (error, result) => error ? reject(error) : resolve(result)));

export function probeSftp(input, signal, timeoutMs = 15_000) {
    const config = connectionInput(input, true), client = new ssh2.Client();
    return new Promise((resolve, reject) => {
        let seen = '', settled = false;
        const finish = (error, value) => { if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort); client.destroy(); error ? reject(error) : resolve(value); };
        const abort = () => finish(new RemoteFilesError('cancelled', '指纹读取已取消', 409));
        const timer = setTimeout(() => finish(new RemoteFilesError('timeout', '读取SFTP指纹超时', 408)), timeoutMs);
        signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) return abort();
        client.on('error', error => finish(seen ? null : remoteFailure(error), { fingerprint: seen }));
        client.on('close', () => finish(seen ? null : new RemoteFilesError('probe_failed', '未读取到服务器指纹', 502), { fingerprint: seen }));
        client.connect({ ...config, username: 'toolbox-fingerprint-probe', readyTimeout: timeoutMs,
            hostVerifier(key) { seen = fingerprint(key); queueMicrotask(() => finish(null, { fingerprint: seen })); return false; } });
    });
}

export async function connectRemote(input, { signal, timeoutMs = 15_000, tlsCA } = {}) {
    const config = connectionInput(input);
    if (config.protocol !== 'sftp') {
        const client = new FtpClient(timeoutMs, { allowSeparateTransferHost: false, maxListingBytes: 2 * 1024 ** 2 }); client.ftp.verbose = false;
        const close = () => client.close(); signal?.addEventListener('abort', close, { once: true });
        let controlBytes = 0;
        try {
            if (signal?.aborted) throw new RemoteFilesError('cancelled', '连接已取消', 409);
            // 先独立连接，限制控制通道输出；TLS仍使用原始主机名校验。
            await client.connect(config.host, config.port);
            const bound = socket => socket.on('data', bytes => { controlBytes += bytes.length; if (controlBytes > 1024 ** 2) client.close(); });
            bound(client.ftp.socket);
            if (config.protocol === 'ftps') { await client.useTLS({ host: config.host, ...(!isIP(config.host) ? { servername: config.host } : {}), rejectUnauthorized: true, ...(tlsCA ? { ca: tlsCA } : {}) }); bound(client.ftp.socket); }
            await client.sendIgnoringError('OPTS UTF8 ON');
            await client.login(config.username, config.password); await client.useDefaultSettings();
            const home = remotePath(await client.pwd());
            return {
                home, get closed() { return client.closed; }, close,
                async list(path) { controlBytes = 0; const items = await client.list(remotePath(path)); if (items.length > 2000) throw new RemoteFilesError('list_limit', '远端目录超过2000项，请缩小目录范围', 413);
                    return items.map(item => ({ name: item.name, type: item.isSymbolicLink ? 'blocked' : item.isDirectory ? 'directory' : item.isFile ? 'file' : 'blocked', size: item.size, modifiedAt: item.modifiedAt?.getTime() || 0 })).filter(item => { try { remoteName(item.name); return true; } catch { return false; } }); },
                mkdir: path => client.send('MKD ' + remotePath(path)), rmdir: path => client.send('RMD ' + remotePath(path)),
                rename: (from, to) => client.rename(remotePath(from), remotePath(to)), commit: (from, to) => client.rename(remotePath(from), remotePath(to)), remove: path => client.remove(remotePath(path)),
                async upload(stream, path, progress) { controlBytes = 0; client.ftp.timeout = 90_000; client.trackProgress(info => progress(info.bytes)); try { await client.uploadFrom(stream, remotePath(path)); } finally { client.trackProgress(); client.ftp.timeout = timeoutMs; } },
                async download(path, output, progress) { controlBytes = 0; client.ftp.timeout = 90_000; client.trackProgress(info => progress(info.bytes)); try { await client.downloadTo(output, remotePath(path)); } finally { client.trackProgress(); client.ftp.timeout = timeoutMs; } },
            };
        } catch (error) { client.close(); throw remoteFailure(error); }
        finally { signal?.removeEventListener('abort', close); }
    }
    const client = new ssh2.Client(), stopped = new AbortController(); let sftp, closed = false, mismatch = false;
    const ended = () => { closed = true; stopped.abort(new RemoteFilesError('disconnected', 'SFTP连接已关闭', 502)); };
    client.on('close', ended); client.on('error', ended);
    const close = () => { ended(); client.destroy(); };
    // ssh2部分流在SSH通道关闭时仍可能等待远端CLOSE回执；关闭必须结束上层等待。
    const bounded = promise => new Promise((resolve, reject) => {
        const abort = () => reject(stopped.signal.reason); stopped.signal.addEventListener('abort', abort, { once: true });
        promise.then(resolve, reject).finally(() => stopped.signal.removeEventListener('abort', abort)); if (stopped.signal.aborted) abort();
    });
    const invoke = (target, method, ...args) => bounded(call(target, method, ...args));
    const abort = () => close(); signal?.addEventListener('abort', abort, { once: true });
    try {
        if (signal?.aborted) throw new RemoteFilesError('cancelled', '连接已取消', 409);
        await new Promise((resolve, reject) => {
            const failed = error => reject(mismatch ? new RemoteFilesError('host_key_changed', '服务器指纹与确认值不一致，已拒绝连接，请重新核对', 409) : remoteFailure(error));
            client.once('ready', resolve); client.once('error', failed); client.once('close', () => reject(new RemoteFilesError('disconnected', 'SFTP连接已关闭', 502)));
            client.connect({ host: config.host, port: config.port, username: config.username, password: config.password, readyTimeout: timeoutMs,
                hostVerifier(key) { mismatch = fingerprint(key) !== config.fingerprint; return !mismatch; }, keepaliveInterval: 15_000, keepaliveCountMax: 2 });
        });
        sftp = await invoke(client, 'sftp'); const home = remotePath(await invoke(sftp, 'realpath', '.'));
        return {
            home, get closed() { return closed; }, close,
            async list(path) {
                const handle = await invoke(sftp, 'opendir', remotePath(path)), items = []; let bytes = 0;
                try { for (;;) {
                    const chunk = await invoke(sftp, 'readdir', handle).catch(error => { if (error.code === 1) return []; throw error; }); if (!chunk || !chunk.length) break;
                    for (const item of chunk) { if (['.', '..'].includes(item.filename)) continue; bytes += Buffer.byteLength(item.filename || '');
                        if (items.length >= 2000 || bytes > 2 * 1024 ** 2) throw new RemoteFilesError('list_limit', '远端目录超过读取上限，请缩小目录范围', 413);
                        try { remoteName(item.filename); } catch { continue; }
                        items.push({ name: item.filename, type: item.attrs.isSymbolicLink() ? 'blocked' : item.attrs.isDirectory() ? 'directory' : item.attrs.isFile() ? 'file' : 'blocked', size: item.attrs.size, modifiedAt: item.attrs.mtime * 1000 });
                    }
                } } finally { await invoke(sftp, 'close', handle).catch(() => {}); } return items;
            },
            mkdir: path => invoke(sftp, 'mkdir', remotePath(path)), rmdir: path => invoke(sftp, 'rmdir', remotePath(path)),
            rename: (from, to) => invoke(sftp, 'rename', remotePath(from), remotePath(to)), remove: path => invoke(sftp, 'unlink', remotePath(path)),
            async commit(from, to, replace) {
                from = remotePath(from); to = remotePath(to);
                if (!replace) return invoke(sftp, 'rename', from, to);
                try { return await invoke(sftp, 'ext_openssh_rename', from, to); }
                catch (error) {
                    if (error.message !== 'Server does not support this extended request' && error.code !== 8) throw error;
                    // 部分服务器标准RENAME允许替换；不先删除原件，失败时保持原件。
                    try { return await invoke(sftp, 'rename', from, to); }
                    catch (failure) { if ([4, 11].includes(failure.code)) throw new RemoteFilesError('overwrite_unsupported', '服务器不支持安全覆盖，原件已保留，请换名后上传', 409); throw failure; }
                }
            },
            async upload(stream, path, progress) { let bytes = 0; const output = sftp.createWriteStream(remotePath(path), { flags: 'wx', mode: 0o600 }); stream.on('data', chunk => { bytes += chunk.length; progress(bytes); });
                try { await bounded(pipeline(stream, output, { signal: stopped.signal })); } finally { output.destroy(); } },
            async download(path, output, progress) { let bytes = 0; const input = sftp.createReadStream(remotePath(path)); input.on('data', chunk => { bytes += chunk.length; progress(bytes); });
                try { await bounded(pipeline(input, output, { signal: stopped.signal })); } finally { input.destroy(); } },
        };
    } catch (error) { close(); throw remoteFailure(error); }
    finally { signal?.removeEventListener('abort', abort); }
}
