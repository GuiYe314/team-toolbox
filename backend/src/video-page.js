import { problem } from './integration-common.js';

/**
 * 通用网页媒体提取。
 *
 * 有些站点没有 yt-dlp 提取器，但页面 HTML 里直接写着视频地址：
 *   <video data-source="https://…/x.mp4" data-type="mp4">
 *   <video data-source="https://…/x.m3u8" data-type="m3u8">
 * 这里不引入 DOM 解析依赖，只用标签 + 属性正则，兼容属性顺序不定、地址被 HTML 转义
 * （&amp;）或 JSON 转义（\/、\u002F）的情况；同一条 HTML 里出现的多个清晰度会全部列出。
 */

const MAX_PAGE_CHARS = 2 * 1024 * 1024;
const MAX_PLAYLIST_CHARS = 512 * 1024;
const MEDIA_FILE = /\.(mp4|m4v|webm|mkv|mov|avi|flv|ts|mp3|m4a|aac|ogg|opus|wav|flac)(?=$|[?#&"'\s\\])/i;
const HLS_FILE = /\.(m3u8|m3u)(?=$|[?#&"'\s\\])/i;
const EMBED_HOSTS = ['youtube.com', 'youtu.be', 'youtube-nocookie.com', 'vimeo.com', 'dailymotion.com', 'streamable.com',
    'ok.ru', 'vk.com', 'bilibili.com', 'tiktok.com', 'instagram.com', 'twitter.com', 'x.com', 'facebook.com', 'reddit.com',
    'rumble.com', 'twitch.tv', 'weibo.com', 'ixigua.com', 'douyin.com'];

export const PAGE_HEADERS = Object.freeze({
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8'
});

export function decodeHtml(value) {
    return String(value ?? '')
        .replace(/&(?:amp|#0*38|#x0*26);/gi, '&')
        .replace(/&(?:quot|#0*34|#x0*22);/gi, '"')
        .replace(/&(?:apos|#0*39|#x0*27);/gi, "'")
        .replace(/&(?:lt|#0*60|#x0*3c);/gi, '<')
        .replace(/&(?:gt|#0*62|#x0*3e);/gi, '>')
        .replace(/&nbsp;/gi, ' ');
}

/** 还原 JSON / JS 字符串里的转义斜杠与分隔符：`https:\/\/a\/b.m3u8` → `https://a/b.m3u8`。 */
export function unescapeMediaUrl(value) {
    return String(value ?? '')
        .replace(/\\u002[fF]/g, '/')
        .replace(/\\u0026/g, '&')
        .replace(/\\u003[dD]/g, '=')
        .replace(/\\u003[fF]/g, '?')
        .replace(/\\\//g, '/');
}

function absoluteUrl(value, base) {
    const text = String(value ?? '').trim().replace(/^["']|["']$/g, '');
    if (!text || /^(?:data|blob|javascript|about):/i.test(text)) return '';
    try { return new URL(text, base).href; } catch { return ''; }
}

/** 从一段标签文本里取出全部属性，值统一做 HTML 反转义。 */
function attributesOf(tag, { commaSeparated = false } = {}) {
    const attributes = {};
    // HLS 清单的属性用逗号分隔，未加引号的值必须停在逗号；HTML 标签里逗号可以是值的一部分。
    const value = commaSeparated ? '([^\\s"\'`=<>,\\]]+)' : '([^\\s"\'`=<>]+)';
    const pattern = new RegExp(`([a-z_:][-a-z0-9_:.]*)\\s*=\\s*(?:"([^"]*)"|'([^']*)'|${value})`, 'gi');
    let match;
    while ((match = pattern.exec(tag))) attributes[match[1].toLowerCase()] = decodeHtml(match[2] ?? match[3] ?? match[4] ?? '');
    return attributes;
}

/** 从「1080p」「1920x1080」「_720」「hd1080」等写法里猜出画面高度，猜不到返回 0。 */
export function heightHint(value) {
    const text = String(value ?? '');
    const dims = /(?:^|\D)(\d{3,4})\s*[x×]\s*(\d{3,4})(?:\D|$)/.exec(text);
    if (dims && Number(dims[2]) >= 100 && Number(dims[2]) <= 4320) return Number(dims[2]);
    const named = /(?:^|\D)(\d{3,4})\s*p(?:\D|$)/i.exec(text);
    if (named && Number(named[1]) >= 100 && Number(named[1]) <= 4320) return Number(named[1]);
    const bare = /(?:^|\D)(2160|1440|1080|720|480|360|240)(?:\D|$)/.exec(text);
    return bare ? Number(bare[1]) : 0;
}

/**
 * 从一个网页 HTML 里提取所有可下载的媒体地址。
 * topicId 用于多视频页面（帖子页下方往往还挂着推荐视频）：优先取 data-id 与帖子号一致的那一个。
 * 返回 [{ url, kind: 'hls' | 'file' | 'embed', label, height }]，按发现顺序去重。
 */
export function extractMedia(html, pageUrl, { topicId = '' } = {}) {
    const text = String(html ?? '').slice(0, MAX_PAGE_CHARS);
    const found = [], seen = new Set();
    const push = (raw, kind, label = '', id = '') => {
        const value = absoluteUrl(unescapeMediaUrl(decodeHtml(raw)), pageUrl);
        if (!value || !/^https?:/i.test(value)) return;
        const embed = kind === 'embed';
        const hls = !embed && (HLS_FILE.test(value) || /^(?:hls|m3u8)$/i.test(kind));
        if (!embed && !hls && !MEDIA_FILE.test(value)) return;
        if (seen.has(value)) return;
        seen.add(value);
        found.push({ url: value, kind: embed ? 'embed' : hls ? 'hls' : 'file', label: String(label || '').slice(0, 80), id: String(id || ''), height: heightHint(label) || heightHint(value) });
    };
    // 1) video / audio / source 标签：覆盖 data-source + data-type、src、data-* 各种变体。
    for (const tag of text.match(/<(?:video|audio|source)\b[^>]*>/gi) || []) {
        const attributes = attributesOf(tag);
        const type = attributes['data-type'] || attributes.type || '';
        const label = attributes.label || attributes.title || attributes.res || attributes['data-res'] || attributes['data-label'] || '';
        const id = attributes['data-id'] || attributes['data-tid'] || attributes['data-post-id'] || '';
        for (const key of ['src', 'data-source', 'data-src', 'data-url', 'data-video', 'data-file', 'data-play', 'data-hls', 'data-m3u8']) {
            if (attributes[key]) push(attributes[key], type || key, label, id);
        }
    }
    // 2) 不限标签：div / a 等元素上也常挂 data-source、data-video 之类的地址属性。
    for (const match of text.matchAll(/\bdata-(?:source|src|video|url|play|file|hls|m3u8)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
        push(match[1] ?? match[2] ?? '', '');
    }
    // 3) 分享卡片里的视频地址。
    for (const tag of text.match(/<meta\b[^>]*>/gi) || []) {
        const attributes = attributesOf(tag);
        const name = String(attributes.property || attributes.name || attributes.itemprop || '').toLowerCase();
        if (!/^(?:og:video(?::url|:secure_url)?|twitter:player:stream|contenturl)$/.test(name) || !attributes.content) continue;
        push(attributes.content, '', '');
    }
    // 4) 内嵌第三方播放器：直接交给 yt-dlp 处理那个播放器地址。
    for (const tag of text.match(/<iframe\b[^>]*>/gi) || []) {
        const attributes = attributesOf(tag);
        const src = absoluteUrl(unescapeMediaUrl(attributes.src), pageUrl);
        if (!src) continue;
        let host = '';
        try { host = new URL(src).hostname.toLowerCase(); } catch { /* 无效地址直接跳过 */ }
        if (EMBED_HOSTS.some(item => host === item || host.endsWith(`.${item}`))) push(src, 'embed', '');
    }
    // 5) 兜底：脚本里拼出来的媒体地址（含 JSON 中被转义的写法）。
    const flat = text.replace(/\\\//g, '/');
    for (const match of flat.matchAll(/https?:\/\/[^\s"'<>()\\]{4,500}?\.(?:m3u8|mp4|webm|mov)(?:\?[^\s"'<>()\\]*)?/gi)) push(match[0], '', '');
    // 帖子号能对上时只保留该帖子的媒体，避免把「推荐视频」当成当前视频。
    const keyed = topicId ? found.filter(item => item.id === String(topicId)) : [];
    return (keyed.length ? keyed : found).slice(0, 24).map(({ id, ...item }) => item);
}

/**
 * 解析 HLS 主清单：取出各清晰度变体（分辨率 / 带宽 / 帧率）与独立音轨分组。
 * 普通媒体清单（只有 #EXTINF）返回空 variants，由调用方按「原始清晰度」处理。
 */
export function parseHlsMaster(text, baseUrl) {
    const body = String(text ?? '').slice(0, MAX_PLAYLIST_CHARS);
    const lines = body.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    const variants = [], audio = new Map();
    for (let index = 0; index < lines.length; index++) {
        const line = lines[index];
        if (/^#EXT-X-MEDIA:/i.test(line)) {
            // 属性名统一转成小写，HLS 规范里写的是大写（RESOLUTION / BANDWIDTH），两种写法都能读。
            const attributes = attributesOf(line.slice(line.indexOf(':') + 1), { commaSeparated: true });
            if (String(attributes.type || '').toUpperCase() === 'AUDIO' && attributes['group-id'] && attributes.uri) {
                const uri = absoluteUrl(unescapeMediaUrl(attributes.uri), baseUrl);
                if (uri) audio.set(attributes['group-id'], uri);
            }
            continue;
        }
        if (!/^#EXT-X-STREAM-INF:/i.test(line)) continue;
        const attributes = attributesOf(line.slice(line.indexOf(':') + 1), { commaSeparated: true });
        let uri = '';
        for (let cursor = index + 1; cursor < lines.length; cursor++) {
            if (lines[cursor].startsWith('#')) continue;
            uri = lines[cursor];
            break;
        }
        const target = absoluteUrl(unescapeMediaUrl(uri), baseUrl);
        if (!target) continue;
        const resolution = /^(\d{2,5})\s*[x×]\s*(\d{2,5})$/i.exec(attributes.resolution || '');
        const bandwidth = Number(attributes.bandwidth || attributes['average-bandwidth'] || 0);
        const frameRate = Number(attributes['frame-rate'] || 0);
        variants.push({
            url: target,
            width: resolution ? Number(resolution[1]) : 0,
            height: resolution ? Number(resolution[2]) : 0,
            bandwidth: Number.isFinite(bandwidth) ? bandwidth : 0,
            fps: Number.isFinite(frameRate) ? frameRate : 0,
            audioGroup: attributes.audio || ''
        });
    }
    return { variants, audio };
}

/**
 * 页面声明的 Referer 策略。
 * 有些站点在页面里写 no-referrer，而它们的 CDN 收到站内 Referer 会直接 403，
 * 所以这里按页面自己的策略决定要不要给下载器加 --referer。
 */
export function referrerMode(html) {
    for (const tag of String(html ?? '').match(/<meta\b[^>]*>/gi) || []) {
        const attributes = attributesOf(tag);
        const name = String(attributes.name || attributes.property || '').toLowerCase();
        if (name !== 'referrer') continue;
        const content = String(attributes.content || '').trim().toLowerCase();
        if (content === 'no-referrer') return 'none';
        if (content === 'same-origin') return 'same-origin';
        if (content === 'origin') return 'origin';
    }
    return 'default';
}

function registrable(host) {
    const parts = String(host ?? '').toLowerCase().split('.').filter(Boolean);
    return parts.slice(-2).join('.');
}

/** 媒体地址与页面是否同站；跨站时是否带 Referer 由页面策略决定。 */
export function refererArgs(mediaUrl, pageUrl, html = '') {
    if (!pageUrl) return [];
    const mode = referrerMode(html);
    if (mode === 'none') return [];
    let sameSite = false;
    try { sameSite = registrable(new URL(mediaUrl).hostname) === registrable(new URL(pageUrl).hostname); } catch { sameSite = false; }
    if (!sameSite && mode !== 'default') return [];
    return ['--referer', pageUrl];
}

/** 主清单的分辨率 → 「1080p · 5.2 Mbps · HLS」这类可供选择的清晰度项。 */
export function hlsChoices(variants, { pageUrl = '', hasFfmpeg = true, html = '' } = {}) {
    const referer = refererArgs(Array.isArray(variants) && variants[0]?.url ? variants[0].url : pageUrl, pageUrl, html);
    const heights = [...new Set((Array.isArray(variants) ? variants : []).map(item => item?.height).filter(height => height >= 100 && height <= 4320))].sort((a, b) => b - a).slice(0, 8);
    if (!heights.length) return [{ id: 'hls-auto', label: '原始清晰度 · HLS', args: [...referer] }];
    return heights.map(height => {
        const bandwidth = Math.max(0, ...(variants.filter(item => item?.height === height).map(item => Number(item.bandwidth) || 0)));
        const rate = bandwidth >= 1000 ? ` · ${(bandwidth / 1e6).toFixed(1)} Mbps` : '';
        return {
            id: `hls-${height}`,
            label: `${height}p${rate} · HLS${hasFfmpeg ? ' · 合并为 MP4' : ''}`,
            args: [...referer, '-f', `bv*[height<=${height}]+ba/b[height<=${height}]`, ...(hasFfmpeg ? ['--merge-output-format', 'mp4'] : [])]
        };
    });
}

/** 页面直接给单个（或几个）媒体文件时的选择项：原始文件 + 可选 MP3。 */
export function fileChoices(files, { pageUrl = '', hasFfmpeg = true, html = '' } = {}) {
    const list = (Array.isArray(files) ? files : []).filter(item => item && item.url).slice(0, 8);
    const ordered = list.length > 1 && list.every(item => item.height) ? [...list].sort((a, b) => b.height - a.height) : list;
    const choices = ordered.map((item, index) => ({
        id: `file-${index + 1}`,
        label: ordered.length === 1 ? '原始清晰度 · 直接下载' : `${item.height ? `${item.height}p · ` : ''}原始文件 ${index + 1}`,
        url: item.url,
        args: [...refererArgs(item.url, pageUrl, html)]
    }));
    if (!choices.length) return [{ id: 'direct-file', label: '原始文件 · 直接下载', args: [...refererArgs('', pageUrl, html)] }];
    if (hasFfmpeg && choices.length === 1) choices.push({ id: 'audio-mp3', label: '仅音频 · MP3', url: choices[0].url, args: [...choices[0].args, '-f', 'ba/b', '-x', '--audio-format', 'mp3', '--audio-quality', '0'] });
    return choices;
}

/** 读取网页或清单文本；限制大小，避免被超大响应拖死。 */
export async function fetchText(url, { fetchImpl = globalThis.fetch, signal, headers = PAGE_HEADERS, maxChars = MAX_PAGE_CHARS } = {}) {
    if (typeof fetchImpl !== 'function') throw problem('resolver_failed', '当前运行环境不支持网页请求', 502);
    const response = await fetchImpl(url, { redirect: 'follow', headers, signal });
    if (!response.ok) throw problem('resolver_failed', `网页返回 HTTP ${response.status}`, 502);
    const declared = Number(response.headers?.get?.('content-length') || 0);
    if (declared > maxChars * 2) throw problem('resolver_failed', '网页内容过大，已停止读取', 502);
    const body = await response.text();
    return body.length > maxChars ? body.slice(0, maxChars) : body;
}

export function pageTitle(html) {
    const match = /<title[^>]*>([\s\S]{1,300}?)<\/title>/i.exec(String(html ?? ''));
    return match ? decodeHtml(match[1]).replace(/\s+/g, ' ').trim().slice(0, 200) : '';
}
