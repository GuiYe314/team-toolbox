import { spawn } from 'node:child_process';
import { readFile, mkdir, writeFile, rename, rm, lstat, realpath, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, basename, isAbsolute, join, resolve, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { StringDecoder } from 'node:string_decoder';

export class IntegrationError extends Error {
    constructor(code, message, status = 400) { super(message); this.code = code; this.status = status; }
}
export const problem = (code, message, status) => new IntegrationError(code, message, status);
export const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const defaults = Object.freeze({ ytDlpPath: '', ffmpegPath: '', freeBaseUrl: 'http://127.0.0.1:3001/v1', artcraftPath: '' });

export function fields(value, allowed) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key))) {
        throw problem('invalid_input', '请求包含无效字段');
    }
    return value;
}

export function localBaseUrl(value) {
    if (typeof value !== 'string' || value.length > 200 || /[\s\\]/.test(value)) throw problem('invalid_url', '请填写本机 FreeLLMAPI 地址，例如 http://127.0.0.1:3001/v1');
    let url;
    try { url = new URL(value); } catch { throw problem('invalid_url', 'FreeLLMAPI 地址格式无效'); }
    if (!['http:', 'https:'].includes(url.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password || url.search || url.hash || !['', '/', '/v1', '/v1/'].includes(url.pathname) || url.port === '0') {
        throw problem('invalid_url', '只支持无账号、查询参数的本机回环地址，路径为 /v1');
    }
    return `${url.origin}/v1`;
}

/** 本机非敏感设置；严格格式，损坏时拒绝覆盖。统一推理 Key 永远不写入这里。 */
export function createIntegrationConfig(file = join(appRoot, 'data', 'open-source-tools.json')) {
    let queue = Promise.resolve();
    async function read() {
        try {
            const raw = JSON.parse(await readFile(file, 'utf8'));
            fields(raw, ['version', ...Object.keys(defaults)]);
            if (raw.version !== 1 || Object.keys(defaults).some(key => typeof raw[key] !== 'string')) throw new Error('bad_config');
            if (Object.values(raw).some(value => typeof value === 'string' && value.length > 2048)) throw new Error('bad_config');
            localBaseUrl(raw.freeBaseUrl);
            return Object.fromEntries(Object.keys(defaults).map(key => [key, raw[key]]));
        } catch (error) {
            if (error.code === 'ENOENT') return { ...defaults };
            throw problem('config_error', '本机开源工具配置损坏或不可读，请检查 data/open-source-tools.json；原文件未被覆盖', 500);
        }
    }
    function update(patch) {
        const task = queue.then(async () => {
            fields(patch, Object.keys(defaults));
            const current = await read();
            const value = { version: 1, ...current, ...patch };
            const temp = `${file}.${randomUUID()}.tmp`;
            try {
                await mkdir(dirname(file), { recursive: true });
                await writeFile(temp, JSON.stringify(value, null, 2), { mode: 0o600, flag: 'wx' });
                await rename(temp, file);
            } catch { throw problem('config_error', '本机设置保存失败，请检查目录权限', 500); }
            finally { await rm(temp, { force: true }).catch(() => {}); }
            return Object.fromEntries(Object.keys(defaults).map(key => [key, value[key]]));
        });
        queue = task.catch(() => {});
        return task;
    }
    return { read, update };
}

const names = {
    ytDlp: ['yt-dlp.exe', 'yt-dlp', 'yt-dlp_linux', 'yt-dlp_linux_aarch64', 'yt-dlp_macos'],
    ffmpeg: ['ffmpeg.exe', 'ffmpeg'],
    artcraft: ['artcraft.exe']
};
export async function executablePath(value, kind, { platform = process.platform } = {}) {
    if (typeof value !== 'string' || value.length > 2048 || !isAbsolute(value) || /[\x00-\x1f"<>|]/.test(value) || value.startsWith('\\\\') || value.startsWith('//') || !names[kind]?.includes(basename(value).toLowerCase())) {
        throw problem('invalid_path', `请选择完整的 ${kind === 'ytDlp' ? 'yt-dlp' : kind === 'ffmpeg' ? 'ffmpeg' : 'ArtCraft.exe'} 本机可执行文件路径`);
    }
    // Windows 除盘符外不允许冒号（拒绝 ADS）。
    if (platform === 'win32' && (!/^[a-z]:[\\/]/i.test(value) || value.slice(2).includes(':'))) throw problem('invalid_path', '仅支持本机磁盘上的完整可执行文件路径');
    try {
        const stat = await lstat(value);
        const actual = await realpath(value);
        if (!stat.isFile() || stat.isSymbolicLink() || !names[kind].includes(basename(actual).toLowerCase())) throw new Error('invalid');
        await access(actual, platform === 'win32' ? constants.R_OK : constants.X_OK);
        return actual;
    } catch { throw problem('missing_executable', '可执行文件不存在、是链接或无法访问，请重新选择'); }
}

export async function detectExecutable(kind, configured, { env = process.env, home = homedir() } = {}) {
    if (configured) return executablePath(configured, kind);
    const filename = kind === 'ytDlp' ? (process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp') : (process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
    const candidates = (env.PATH || '').split(delimiter).filter(Boolean).map(folder => join(folder.replace(/^"|"$/g, ''), filename));
    candidates.push(join(home, '.yoinks', 'bin', filename));
    if (kind === 'ffmpeg' && env.APPDATA) candidates.push(join(env.APPDATA, 'npm', 'node_modules', 'yoinks', 'node_modules', 'ffmpeg-static', filename));
    for (const candidate of candidates.slice(0, 120)) {
        try { return await executablePath(candidate, kind); } catch { /* 跳过 PATH 中缺失项 */ }
    }
    return '';
}

/** 仅执行已验证文件与服务端参数。取消时回收本轮进程树，绝不按名称或端口杀进程。 */
export function runIntegrationProcess(file, args, { signal, timeout = 30000, maxBytes = 4 * 1024 * 1024, onLine, cwd } = {}) {
    return new Promise((resolvePromise, reject) => {
        if (signal?.aborted) { reject(problem('cancelled', '操作已取消', 499)); return; }
        let child, timer, forceTimer, failure, size = 0, stdout = '', stderr = '', buffer = '', settled = false;
        const decoder = new StringDecoder('utf8');
        const finish = (error, result) => {
            if (settled) return;
            settled = true; clearTimeout(timer); clearTimeout(forceTimer); signal?.removeEventListener('abort', abort);
            error ? reject(error) : resolvePromise(result);
        };
        function stop(error) {
            if (failure || settled) return;
            failure = error;
            if (child?.pid && process.platform === 'win32') {
                const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, shell: false, stdio: 'ignore' });
                killer.on('error', () => child.kill()); killer.unref();
            } else if (child?.pid) {
                try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
            }
            forceTimer = setTimeout(() => { child?.kill('SIGKILL'); finish(failure); }, 2000);
            forceTimer.unref?.();
        }
        const abort = () => stop(problem('cancelled', '操作已取消', 499));
        try { child = spawn(file, args, { windowsHide: true, shell: false, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'], cwd }); }
        catch { finish(problem('process_error', '无法启动本机组件，请检查可执行文件', 500)); return; }
        signal?.addEventListener('abort', abort, { once: true });
        timer = setTimeout(() => stop(problem('timeout', '组件操作超时，请检查网络或组件状态后重试', 504)), timeout);
        function consume(chunk, isError) {
            size += chunk.length;
            if (size > maxBytes) { stop(problem('output_limit', '组件输出超过上限，已停止操作', 502)); return; }
            if (failure) return;
            if (isError) stderr += chunk.toString('utf8');
            else {
                const text = decoder.write(chunk); stdout += text; buffer += text;
                const lines = buffer.split(/\r?\n/); buffer = lines.pop();
                try { for (const line of lines) onLine?.(line); }
                catch { stop(problem('invalid_output', '组件返回了无效结果', 502)); }
            }
        }
        child.stdout.on('data', chunk => consume(chunk, false)); child.stderr.on('data', chunk => consume(chunk, true));
        child.on('error', () => finish(failure || problem('process_error', '本机组件启动失败，请检查路径与依赖', 500)));
        child.on('close', code => {
            if (!failure) { const tail = decoder.end(); stdout += tail; buffer += tail; try { if (buffer) onLine?.(buffer); } catch { failure = problem('invalid_output', '组件返回了无效结果', 502); } }
            finish(failure, { code, stdout, stderr });
        });
        if (signal?.aborted) abort();
    });
}
