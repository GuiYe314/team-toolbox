// 更新器专用 HTTP：不改全局 dispatcher、环境或系统代理。
import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { Agent, Dispatcher, ProxyAgent } from 'undici';

const runFile = promisify(execFile);
const WINDOWS_PROXY_SCRIPT = [
    "$ErrorActionPreference = 'Stop'",
    "$p = Get-ItemProperty -LiteralPath 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'",
    '@{ enabled = [bool]$p.ProxyEnable; server = [string]$p.ProxyServer; bypass = [string]$p.ProxyOverride } | ConvertTo-Json -Compress'
].join('; ');

function proxyError(message, code = 'update_proxy_invalid') {
    return Object.assign(new Error(message), { code });
}

/** 仅输出到本进程内存；禁止记录原始 stdout（可能含代理凭据）。 */
async function readWindowsProxy(signal) {
    const executable = process.env.SystemRoot
        ? join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
        : 'powershell.exe';
    try {
        const { stdout } = await runFile(executable,
            ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', WINDOWS_PROXY_SCRIPT],
            { windowsHide: true, shell: false, timeout: 4000, maxBuffer: 64 * 1024, signal });
        return JSON.parse(stdout.replace(/^\uFEFF/, ''));
    } catch {
        signal?.throwIfAborted();
        throw proxyError('无法读取 Windows 手动代理设置，请检查系统代理或设置 HTTPS_PROXY。', 'update_proxy_unavailable');
    }
}

function proxyUrl(value) {
    if (!value) return '';
    try {
        const url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(value) ? value : 'http://' + value);
        if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.search || url.hash || url.pathname !== '/') throw new Error();
        return url.href;
    } catch {
        throw proxyError('更新代理地址无效；仅支持 HTTP/HTTPS 手动代理，请检查代理环境变量或 Windows 设置。');
    }
}

function envValue(env, name) {
    return String(env[name.toLowerCase()] ?? env[name] ?? '').trim();
}

/** 环境代理显式覆盖系统代理；NO_PROXY 可与 Windows 绕过列表共用。 */
export function resolveUpdateProxySettings(env = {}, system = {}) {
    const http = envValue(env, 'HTTP_PROXY');
    const https = envValue(env, 'HTTPS_PROXY');
    const all = envValue(env, 'ALL_PROXY');
    const noProxy = envValue(env, 'NO_PROXY');
    if (http || https || all) {
        return { http: proxyUrl(http || all), https: proxyUrl(https || http || all), bypass: noProxy };
    }
    if (!system.enabled || !system.server) return { http: '', https: '', bypass: noProxy };
    const entries = String(system.server).split(';').map(value => value.trim()).filter(Boolean);
    let httpProxy = '', httpsProxy = '';
    if (entries.length === 1 && !/^[a-z]+=/.test(entries[0])) {
        httpProxy = httpsProxy = entries[0];
    } else {
        for (const entry of entries) {
            const match = /^(http|https)=(.+)$/i.exec(entry);
            if (match?.[1].toLowerCase() === 'http') httpProxy = match[2].trim();
            if (match?.[1].toLowerCase() === 'https') httpsProxy = match[2].trim();
        }
        if (!httpProxy && !httpsProxy) throw proxyError('Windows 代理未提供 HTTP/HTTPS 端点；请配置手动 HTTP 代理。');
    }
    return { http: proxyUrl(httpProxy), https: proxyUrl(httpsProxy),
        bypass: [noProxy, String(system.bypass || '')].filter(Boolean).join(';') };
}

/** 支持域名、后缀、通配符、端口和 Windows <local>；回环始终直连。 */
export function bypassUpdateProxy(target, bypass = '') {
    const url = target instanceof URL ? target : new URL(target);
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    const port = url.port || (url.protocol === 'https:' ? '443' : '80');
    if (host === 'localhost' || host.endsWith('.localhost') || host === '::1' || /^127\./.test(host)) return true;
    for (const raw of String(bypass).split(/[;,\s]+/).filter(Boolean)) {
        const entry = raw.toLowerCase();
        if (entry === '*') return true;
        if (entry === '<local>' && !host.includes('.') && !host.includes(':')) return true;
        const match = /^(\[[^\]]+\]|[^:]+)(?::(\d+))?$/.exec(entry);
        if (!match || (match[2] && match[2] !== port)) continue;
        const pattern = match[1].replace(/^\[|\]$/g, '');
        if (pattern.startsWith('.')) {
            if (host === pattern.slice(1) || host.endsWith(pattern)) return true;
        } else if (pattern.includes('*')) {
            const regex = pattern.split('*').map(part => part.replace(/[.*+?^$()|[\]\\]/g, '\\$&')).join('.*');
            if (new RegExp('^' + regex + '$').test(host)) return true;
        } else if (host === pattern || host.endsWith('.' + pattern)) return true;
    }
    return false;
}

class UpdateDispatcher extends Dispatcher {
    constructor(settings) {
        super();
        this.settings = settings;
        this.agents = new Map();
    }
    dispatch(options, handler) {
        // Fetch 的每次重定向也经过这里，按目标协议和绕过列表重新选路。
        const target = new URL(options.origin);
        const proxy = bypassUpdateProxy(target, this.settings.bypass) ? ''
            : this.settings[target.protocol === 'https:' ? 'https' : 'http'];
        if (!this.agents.has(proxy)) this.agents.set(proxy, proxy ? new ProxyAgent(proxy) : new Agent());
        return this.agents.get(proxy).dispatch(options, handler);
    }
    async destroy() {
        await Promise.allSettled([...this.agents.values()].map(agent => agent.destroy()));
    }
}

/** 请求与消费流共用总超时；消费结束或失败后立即释放专用连接。 */
export function createUpdateHttpClient({
    env = process.env, platform = process.platform, getWindowsProxy = readWindowsProxy,
    fetchImpl = (...args) => globalThis.fetch(...args)
} = {}) {
    return async function withResponse(url, { timeoutMs }, consume) {
        const target = new URL(url);
        if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password) {
            throw proxyError('更新下载地址无效；只允许不带凭据的 HTTP/HTTPS 地址。');
        }
        const signal = AbortSignal.timeout(timeoutMs);
        const hasEnvProxy = ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY'].some(key => envValue(env, key));
        const system = !hasEnvProxy && platform === 'win32'
            ? await getWindowsProxy(signal) : {};
        signal.throwIfAborted();
        const dispatcher = new UpdateDispatcher(resolveUpdateProxySettings(env, system));
        let response;
        try {
            response = await fetchImpl(target.href, { dispatcher, signal, redirect: 'follow' });
            return await consume(response, signal);
        } finally {
            if (response?.body && !response.body.locked) await response.body.cancel().catch(() => {});
            await dispatcher.destroy();
        }
    };
}

export const withUpdateResponse = createUpdateHttpClient();

/** 清单也必须有大小上限，不能无界 res.text()。 */
export async function readUpdateText(response, maxBytes) {
    if (Number(response.headers.get('content-length')) > maxBytes) throw proxyError('更新清单超过大小限制。', 'manifest_too_large');
    const chunks = [];
    let size = 0;
    if (response.body) {
        for await (const chunk of response.body) {
            size += chunk.byteLength;
            if (size > maxBytes) throw proxyError('更新清单超过大小限制。', 'manifest_too_large');
            chunks.push(Buffer.from(chunk));
        }
    }
    return Buffer.concat(chunks).toString('utf8');
}

/** 不回传底层异常原文，避免泄露代理认证信息。 */
export function describeUpdateNetworkError(error) {
    if (['update_proxy_invalid', 'update_proxy_unavailable', 'manifest_too_large'].includes(error?.code)) return error.message;
    const candidate = error?.cause?.code || error?.code || '';
    const code = /^[A-Z][A-Z0-9_]{0,63}$/.test(candidate) ? candidate : '';
    const detail = code ? '（' + code + '）' : '';
    if (['TimeoutError', 'AbortError'].includes(error?.name) || /TIMEOUT|ETIMEDOUT/.test(code)) {
        return '请求超时，请检查更新源与手动代理是否可用' + detail;
    }
    if (/CERT|SSL|TLS/.test(code)) return '证书校验失败，请检查网络证书或代理配置' + detail;
    if (/ENOTFOUND|EAI_AGAIN/.test(code)) return '域名解析失败，请检查地址与网络连接' + detail;
    return '网络请求失败，请检查更新源、网络与手动代理' + detail;
}
