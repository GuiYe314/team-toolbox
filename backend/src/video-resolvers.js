import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { appRoot, IntegrationError, problem } from './integration-common.js';

/**
 * 统一视频链接解析层。
 *
 * 每个「解析方案」(resolver) 只需要实现：
 *   { id, name, description, priority, match(url), async resolve(url, ctx) }
 * resolve 必须返回：
 *   { title, uploader, duration, mediaUrl, choices: [{ id, label, args, url? }], ffmpegReady }
 * 任何一步抛错都视为「这个方案解析不了」，自动交给下一个方案。
 *
 * 扩展方式见 docs/video-resolvers.md：
 *   1) 不改代码：data/video-resolvers.json 里配置自定义 HTTP 解析服务；
 *   2) 改代码：写一个 resolver 对象，调用 registerResolver() 注册。
 */

const MEDIA_FILE = /\.(mp4|m4v|webm|mkv|mov|avi|flv|ts|mp3|m4a|aac|ogg|opus|wav|flac)$/i;
const HLS_STREAM = /\.(m3u8|m3u)$/i;
const MiB = 1024 * 1024;
const CUSTOM_CONFIG = join(appRoot, 'data', 'video-resolvers.json');

const extraResolvers = [];

function safeName(value, fallback = '') {
    return typeof value === 'string' && value.trim() ? value.trim().slice(0, 300) : fallback;
}

function hostOf(url) {
    try { return new URL(url).hostname.toLowerCase(); } catch { return ''; }
}

function fileNameOf(url) {
    let name = '';
    try { name = decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).pop() || ''); } catch { /* 保留空值 */ }
    return safeName(name, hostOf(url) || '视频');
}

function failureMessage(error) {
    if (error instanceof IntegrationError) return error.message.slice(0, 160);
    if (error?.name === 'AbortError') return '方案超时或被取消';
    return '方案未返回可解析结果';
}

function normalizeInfo(info, url, ctx) {
    if (!info || typeof info !== 'object' || !Array.isArray(info.choices) || !info.choices.length) throw problem('resolver_failed', '解析方案没有返回可用格式', 502);
    // 解析服务返回的地址同样必须过 URL 白名单，避免把内网地址带进下载阶段。
    const mediaUrl = ctx.validateUrl(info.mediaUrl || url);
    const choices = info.choices.slice(0, 16).map((choice, index) => {
        if (!choice || typeof choice.id !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(choice.id)) throw problem('resolver_failed', '解析方案返回的格式编号无效', 502);
        return {
            id: choice.id,
            label: safeName(choice.label, `格式 ${index + 1}`).slice(0, 100),
            // 自定义 HTTP 方案自己构造 choices 时固定不带 args，因此外部服务无法下发 yt-dlp 参数。
            args: Array.isArray(choice.args) ? choice.args.filter(arg => typeof arg === 'string' && arg.length <= 200).slice(0, 16) : [],
            ...(choice.url ? { url: ctx.validateUrl(choice.url) } : {})
        };
    });
    return { title: safeName(info.title, fileNameOf(url)), uploader: safeName(info.uploader, '').slice(0, 160), duration: Number.isFinite(info.duration) ? Math.max(0, info.duration) : null, mediaUrl, choices, ffmpegReady: !!ctx.tools.ffmpegPath };
}

async function ytdlpProbe(url, ctx, { extraArgs = [], timeoutMs = 45000 } = {}) {
    const output = await ctx.runner(ctx.tools.ytDlpPath, [...ctx.commonArgs, ...ctx.runtimeArgs(ctx.tools), ...extraArgs, '--dump-single-json', '--skip-download', '--', url], { signal: ctx.signal, timeout: timeoutMs, maxBytes: 4 * MiB });
    if (output.code !== 0) throw problem('probe_failed', 'yt-dlp 无法读取该链接（链接、网络、站点限制或组件版本）', 502);
    let info;
    try { info = JSON.parse(output.stdout); } catch { throw problem('invalid_output', 'yt-dlp 返回的视频信息无效', 502); }
    if (!info || info._type === 'playlist' || typeof info.title !== 'string') throw problem('invalid_output', '仅支持单个视频链接，不支持播放列表', 502);
    return {
        title: info.title.slice(0, 300),
        uploader: typeof info.uploader === 'string' ? info.uploader.slice(0, 160) : '',
        duration: Number.isFinite(info.duration) ? Math.max(0, info.duration) : null,
        mediaUrl: url,
        choices: ctx.videoChoices(info, !!ctx.tools.ffmpegPath),
        ffmpegReady: !!ctx.tools.ffmpegPath
    };
}

/** 内置方案。priority 越小越先尝试。 */
export const builtinResolvers = [
    {
        id: 'direct-media',
        name: '直链媒体',
        description: '链接本身就是 mp4 / webm / mp3 等文件，校验后直接下载，不经过网页解析',
        priority: 10,
        match: url => MEDIA_FILE.test(new URL(url).pathname),
        async resolve(url, ctx) {
            const http = ctx.fetchImpl || globalThis.fetch;
            if (typeof http === 'function') {
                try {
                    const response = await http(url, { method: 'HEAD', redirect: 'follow', signal: ctx.childSignal(8000) });
                    // 405/501 表示服务端不支持 HEAD，不代表文件不存在；403 常见于防盗链，交给下载阶段处理。
                    if (!response.ok && ![403, 405, 501].includes(response.status)) throw problem('resolver_failed', `直链返回 HTTP ${response.status}`, 502);
                } catch (error) {
                    if (error instanceof IntegrationError) throw error;
                    if (ctx.signal?.aborted) throw problem('cancelled', '操作已取消', 499);
                    // 网络不通时仍保留该方案，真正的可用性由下载阶段验证。
                }
            }
            return { title: fileNameOf(url), uploader: '', duration: null, mediaUrl: url,
                choices: [{ id: 'direct-file', label: '原始文件 · 直接下载', args: [] }], ffmpegReady: !!ctx.tools.ffmpegPath };
        }
    },
    {
        id: 'ytdlp',
        name: 'yt-dlp 通用解析',
        description: '内置下载引擎，支持绝大多数视频站点网页链接，可列出清晰度与 MP3',
        priority: 50,
        match: () => true,
        async resolve(url, ctx) { return ytdlpProbe(url, ctx); }
    },
    {
        id: 'ytdlp-generic',
        name: 'yt-dlp 通用页面',
        description: '常规提取器失败时，强制按通用页面解析内嵌媒体地址',
        priority: 90,
        match: () => true,
        async resolve(url, ctx) { return ytdlpProbe(url, ctx, { extraArgs: ['--force-generic-extractor'], timeoutMs: 20000 }); }
    }
];

function customResolversFrom(raw) {
    if (!raw || raw.version !== 1 || !Array.isArray(raw.resolvers)) return [];
    const seen = new Set(builtinResolvers.map(item => item.id));
    const list = [];
    for (const entry of raw.resolvers.slice(0, 32)) {
        if (!entry || entry.enabled === false || typeof entry.id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,39}$/.test(entry.id) || seen.has(entry.id)) continue;
        let endpoint;
        try { endpoint = new URL(entry.endpoint); } catch { continue; }
        if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.href.length > 500) continue;
        const headers = {};
        const given = entry.headers && typeof entry.headers === 'object' && !Array.isArray(entry.headers) ? entry.headers : {};
        for (const [key, value] of Object.entries(given).slice(0, 12)) {
            if (/^[a-z0-9-]{1,40}$/i.test(key) && typeof value === 'string' && value.length <= 500 && !/[\r\n]/.test(value)) headers[key] = value;
        }
        const domains = Array.isArray(entry.domains) ? entry.domains.filter(item => typeof item === 'string' && item.length <= 120).map(item => item.toLowerCase()) : [];
        const priority = Number.isInteger(entry.priority) ? Math.min(99, Math.max(1, entry.priority)) : 20;
        const timeoutMs = Number.isInteger(entry.timeoutMs) ? Math.min(30000, Math.max(3000, entry.timeoutMs)) : 12000;
        const name = safeName(entry.name, entry.id).slice(0, 60);
        seen.add(entry.id);
        list.push({
            id: entry.id, name, description: `自定义解析服务 · ${endpoint.host}`, priority, builtin: false,
            match: url => !domains.length || domains.some(domain => hostOf(url) === domain || hostOf(url).endsWith(`.${domain}`)),
            async resolve(url, ctx) {
                const http = ctx.fetchImpl || globalThis.fetch;
                if (typeof http !== 'function') throw problem('resolver_failed', '当前运行环境不支持 HTTP 解析服务', 502);
                const response = await http(endpoint.href, {
                    method: 'POST', redirect: 'error',
                    headers: { 'content-type': 'application/json', ...headers },
                    body: JSON.stringify({ url }), signal: ctx.childSignal(timeoutMs)
                });
                if (!response.ok) throw problem('resolver_failed', `解析服务返回 HTTP ${response.status}`, 502);
                const text = await response.text();
                if (text.length > 256 * 1024) throw problem('resolver_failed', '解析服务返回内容过大', 502);
                let data;
                try { data = JSON.parse(text); } catch { throw problem('resolver_failed', '解析服务返回的不是有效 JSON', 502); }
                if (!data || typeof data !== 'object' || Array.isArray(data)) throw problem('resolver_failed', '解析服务返回内容无效', 502);
                const formats = Array.isArray(data.formats) ? data.formats.slice(0, 12) : [];
                const choices = formats.filter(item => item && typeof item.url === 'string' && (typeof item.id === 'string' || typeof item.label === 'string'))
                    .map((item, index) => ({ id: `custom-${index + 1}`, label: safeName(item.label || item.id, `格式 ${index + 1}`), args: [], url: item.url }));
                if (!choices.length) choices.push({ id: 'custom-file', label: '解析结果 · 直接下载', args: [], url: data.url || url });
                return { title: safeName(data.title, fileNameOf(url)), uploader: safeName(data.uploader, ''), duration: data.duration, mediaUrl: data.url || url, choices, ffmpegReady: !!ctx.tools.ffmpegPath };
            }
        });
    }
    return list;
}

/** 读取可选的自定义方案配置；文件不存在或写坏时静默降级为「没有自定义方案」。 */
export async function loadCustomResolvers() {
    try { return customResolversFrom(JSON.parse(await readFile(CUSTOM_CONFIG, 'utf8'))); }
    catch { return []; }
}

/** 代码级扩展点：注册额外解析方案。 */
export function registerResolver(resolver) {
    if (!resolver || typeof resolver.id !== 'string' || typeof resolver.resolve !== 'function' || typeof resolver.match !== 'function') throw new TypeError('resolver 需要 id / match / resolve');
    const index = extraResolvers.findIndex(item => item.id === resolver.id);
    if (index >= 0) extraResolvers[index] = resolver; else extraResolvers.push(resolver);
    return () => { const i = extraResolvers.findIndex(item => item.id === resolver.id); if (i >= 0) extraResolvers.splice(i, 1); };
}

export async function listResolvers() {
    const all = [...builtinResolvers, ...await loadCustomResolvers(), ...extraResolvers];
    return all.map(({ id, name, description, priority, builtin }, index) => ({ id, name, description, priority: Number.isInteger(priority) ? priority : 50 + index, builtin: builtin !== false }))
        .sort((a, b) => a.priority - b.priority);
}

/**
 * 按优先级依次尝试解析方案；某个方案失败就自动换下一个。
 * 返回 { info, resolver, attempts }；全部失败抛带 attempts 的 IntegrationError。
 */
export async function resolveVideo(url, ctx) {
    const all = [...builtinResolvers, ...await loadCustomResolvers(), ...extraResolvers];
    const ordered = all.map((resolver, index) => ({ ...resolver, priority: Number.isInteger(resolver.priority) ? resolver.priority : 50 + index }))
        .sort((a, b) => a.priority - b.priority);
    const forced = typeof ctx.forcedResolverId === 'string' && ctx.forcedResolverId ? ctx.forcedResolverId : '';
    const selected = forced ? ordered.filter(item => item.id === forced) : ordered;
    if (!selected.length) throw problem('unknown_resolver', '指定的解析方案不存在', 400);
    const attempts = [];
    for (const resolver of selected) {
        let matched = true;
        try { matched = resolver.match(url) !== false; } catch { matched = false; }
        if (!matched && !forced) { attempts.push({ id: resolver.id, name: resolver.name, status: 'skipped', message: '链接类型不匹配', ms: 0 }); continue; }
        const started = ctx.now();
        try {
            if (ctx.signal?.aborted) throw problem('cancelled', '操作已取消', 499);
            const info = normalizeInfo(await resolver.resolve(url, ctx), url, ctx);
            attempts.push({ id: resolver.id, name: resolver.name, status: 'ok', message: '解析成功', ms: Math.max(0, ctx.now() - started) });
            return { info, resolver: { id: resolver.id, name: resolver.name, description: resolver.description || '' }, attempts };
        } catch (error) {
            attempts.push({ id: resolver.id, name: resolver.name, status: 'failed', message: failureMessage(error), ms: Math.max(0, ctx.now() - started) });
        }
    }
    const failure = problem('all_resolvers_failed', forced ? `解析方案「${forced}」未能解析该链接` : `已尝试 ${attempts.filter(item => item.status === 'failed').length} 个解析方案，均无法解析该链接`, 502);
    failure.attempts = attempts;
    throw failure;
}
