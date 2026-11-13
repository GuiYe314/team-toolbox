import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { connect } from 'node:net';

/**
 * 视频下载的网络代理支持。
 *
 * 为什么需要：Node 的 fetch 不读系统代理，yt-dlp 也只认 --proxy。浏览器能打开的站点
 * （例如走 Clash 的例子）在后端就会直接超时，表现为「所有解析方案都失败」。
 *
 * 取值顺序：用户在组件设置里填的代理 → 环境变量 HTTPS_PROXY/HTTP_PROXY → Windows 系统代理。
 * 系统代理只在能连通时采用，代理关掉后不会拖慢解析。
 */

const execFileAsync = promisify(execFile);
const ALLOWED = new Set(['http:', 'https:', 'socks5:', 'socks5h:']);
const DEFAULT_PORT = { 'http:': '80', 'https:': '443', 'socks5:': '1080', 'socks5h:': '1080' };
const CACHE_MS = 60 * 1000;

/** 规范化代理地址；空值表示「不使用代理」，非法值抛错交给调用方提示。 */
export function normalizeProxy(value) {
    const text = String(value ?? '').trim();
    if (!text) return '';
    if (text.length > 200 || /[\s\\\x00-\x1f]/.test(text)) return '';
    const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `http://${text}`;
    let url;
    try { url = new URL(candidate); } catch { return ''; }
    if (!ALLOWED.has(url.protocol) || !url.hostname || url.search || url.hash || !['', '/'].includes(url.pathname)) return '';
    const port = url.port || DEFAULT_PORT[url.protocol] || '';
    if (!/^\d{1,5}$/.test(port) || Number(port) < 1 || Number(port) > 65535) return '';
    return `${url.protocol}//${url.username ? `${encodeURIComponent(url.username)}${url.password ? `:${encodeURIComponent(url.password)}` : ''}@` : ''}${url.hostname}:${port}`;
}

/** Windows 的 ProxyServer 可能是 `127.0.0.1:7897`，也可能是 `http=a;https=b` 这种按协议写法。 */
export function parseProxyServer(raw) {
    const text = String(raw ?? '').trim();
    if (!text) return '';
    if (!text.includes('=')) return normalizeProxy(text);
    const entries = new Map();
    for (const part of text.split(';')) {
        const index = part.indexOf('=');
        if (index <= 0) continue;
        entries.set(part.slice(0, index).trim().toLowerCase(), part.slice(index + 1).trim());
    }
    return normalizeProxy(entries.get('https') || entries.get('http') || '');
}

/** 读取 Windows 系统代理（HKCU）。非 Windows 或读取失败时返回空。 */
export async function readSystemProxy({ platform = process.platform, exec = execFileAsync } = {}) {
    if (platform !== 'win32') return '';
    const key = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';
    try {
        const { stdout: enabled } = await exec('reg', ['query', key, '/v', 'ProxyEnable'], { timeout: 4000, windowsHide: true });
        if (!/ProxyEnable\s+REG_DWORD\s+0x1\b/i.test(String(enabled))) return '';
        const { stdout: server } = await exec('reg', ['query', key, '/v', 'ProxyServer'], { timeout: 4000, windowsHide: true });
        const match = /ProxyServer\s+REG_\w+\s+(.+)/i.exec(String(server));
        return match ? parseProxyServer(match[1].trim()) : '';
    } catch {
        // reg.exe 可能被安全策略禁用（企业环境），退回 PowerShell 读取同一处设置。
    }
    try {
        const script = "$p = Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'; if ($p.ProxyEnable -eq 1) { $p.ProxyServer }";
        const { stdout } = await exec('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], { timeout: 8000, windowsHide: true });
        return parseProxyServer(String(stdout ?? '').trim());
    } catch {
        return '';
    }
}

function splitHostPort(proxyUrl) {
    try {
        const url = new URL(proxyUrl);
        return { host: url.hostname, port: Number(url.port) || Number(DEFAULT_PORT[url.protocol] || 0) };
    } catch {
        return null;
    }
}

/** 代理端口是否在监听；系统代理通常是本地客户端，关掉后要能立刻感知。 */
export function probeProxy(proxyUrl, { timeoutMs = 600, createConnection = connect } = {}) {
    const target = splitHostPort(proxyUrl);
    if (!target?.host || !target.port) return Promise.resolve(false);
    return new Promise(resolve => {
        let socket;
        const done = value => { socket?.destroy(); resolve(value); };
        try {
            socket = createConnection({ host: target.host, port: target.port });
            socket.setTimeout(timeoutMs);
            socket.once('connect', () => done(true));
            socket.once('timeout', () => done(false));
            socket.once('error', () => done(false));
        } catch {
            done(false);
        }
    });
}

let cache = { at: 0, value: null };

/**
 * 决定本次请求使用的代理。
 * 返回 { url, source }，source 为 configured / system / env / none。
 *
 * 顺序上 Windows 系统代理优先于环境变量：浏览器用的是系统代理，用户看到「浏览器能打开」
 * 却「工具箱打不开」时就是这个差异。环境变量在 Windows 上常被终端工具或 IDE 改写，
 * 反而容易指向一个不相关的端口；需要强制指定时用组件设置里的代理，它的优先级最高。
 */
export async function resolveProxy({ configured = '', env = process.env, platform = process.platform, now = Date.now, useCache = true, exec, createConnection } = {}) {
    const explicit = normalizeProxy(configured);
    if (explicit) return { url: explicit, source: 'configured' };
    if (useCache && cache.value && now() - cache.at < CACHE_MS) return cache.value;
    const system = await readSystemProxy({ platform, exec });
    const usable = system && await probeProxy(system, { createConnection }) ? { url: system, source: 'system' } : null;
    if (usable) { cache = { at: now(), value: usable }; return usable; }
    const fromEnv = normalizeProxy(env.HTTPS_PROXY || env.https_proxy || env.HTTP_PROXY || env.http_proxy || '');
    const value = fromEnv ? { url: fromEnv, source: 'env' } : { url: '', source: 'none' };
    cache = { at: now(), value };
    return value;
}

export function resetProxyCache() { cache = { at: 0, value: null }; }

const dispatchers = new Map();

/** 带代理的 fetch；没有代理时直接用全局 fetch，避免多一层封装。 */
export async function createProxyFetch(proxyUrl, { globalFetch = globalThis.fetch } = {}) {
    const url = normalizeProxy(proxyUrl);
    if (!url) return globalFetch;
    if (/^socks/i.test(url)) {
        // undici 的 ProxyAgent 只处理 HTTP(S) 代理；socks 交给 yt-dlp 自己走。
        return globalFetch;
    }
    if (!dispatchers.has(url)) {
        const { ProxyAgent } = await import('undici');
        dispatchers.set(url, new ProxyAgent(url));
    }
    const dispatcher = dispatchers.get(url);
    const { fetch: undiciFetch } = await import('undici');
    return (input, init = {}) => undiciFetch(input, { ...init, dispatcher });
}

/** yt-dlp 的代理参数；没有代理时不加参数，保持原有行为。 */
export function proxyArgs(proxyUrl) {
    const url = normalizeProxy(proxyUrl);
    return url ? ['--proxy', url] : [];
}
