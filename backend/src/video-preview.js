import { spawn } from 'node:child_process';

/**
 * 「边下边看」预览通道。
 *
 * 为什么不播正在下载的文件：下载内核是 yt-dlp 分片拉取 + ffmpeg 合并，HLS 站点在下载过程中
 * 磁盘上只有分离的视频/音频分片，没有任何可播放的完整文件。所以预览走独立的一条路：
 * 由 ffmpeg 直接读远端流（HLS 清单或直链），-c copy 实时转封装成 fragmented MP4 从管道吐给浏览器。
 *
 * 关键约定：
 * - 必须 -c copy：转码对 CPU 太重，预览只做容器转换，几秒内出画面。
 * - 必须 empty_moov + frag_keyframe：普通 MP4 要把 moov 写在文件尾部，管道无法 seek，浏览器会一直等。
 * - header/代理是「输入选项」，必须紧挨在对应 -i 之前，否则 ffmpeg 会忽略或报错。
 */

const MAX_INPUTS = 2;
const MAX_HEADERS = 24;
const MAX_HEADER_VALUE = 1024;
const MAX_URL = 4096;

/** 只保留安全的请求头：值里带换行会被 ffmpeg 当成多个头，直接丢弃。 */
export function sanitizeHeaders(source) {
    const headers = {};
    if (!source || typeof source !== 'object') return headers;
    let count = 0;
    for (const [key, value] of Object.entries(source)) {
        if (count >= MAX_HEADERS) break;
        if (typeof key !== 'string' || !key || key.length > 64 || !/^[A-Za-z0-9-]+$/.test(key)) continue;
        if (typeof value !== 'string' || !value || value.length > MAX_HEADER_VALUE || /[\r\n\x00]/.test(value)) continue;
        headers[key] = value; count++;
    }
    return headers;
}

export function headerArgs(headers = {}) {
    const clean = sanitizeHeaders(headers);
    const lines = Object.entries(clean).map(([key, value]) => `${key}: ${value}`);
    // 末尾的 CRLF 是 ffmpeg 的约定，缺了会吞掉最后一个头的值。
    return lines.length ? ['-headers', lines.join('\r\n') + '\r\n'] : [];
}

/** ffmpeg 只认 HTTP 代理；socks5 的常见端口（Clash 混合端口）同样接受 http 形式，转一下更容易成功。 */
export function ffmpegProxyArgs(input, proxy) {
    if (!proxy || typeof proxy !== 'string') return [];
    let url;
    try { url = new URL(proxy.trim()); } catch { return []; }
    if (!['http:', 'https:', 'socks5:', 'socks5h:'].includes(url.protocol) || !url.hostname) return [];
    if (url.protocol.startsWith('socks')) {
        const auth = url.username ? `${url.username}${url.password ? ':' + url.password : ''}@` : '';
        url = new URL(`http://${auth}${url.hostname}${url.port ? ':' + url.port : ''}`);
    }
    let scheme = 'http:';
    try { scheme = new URL(input).protocol; } catch { scheme = 'http:'; }
    return [scheme === 'https:' ? '-https_proxy' : '-http_proxy', url.href.replace(/\/$/, '')];
}

export function validInputs(inputs) {
    if (!Array.isArray(inputs) || !inputs.length || inputs.length > MAX_INPUTS) return [];
    return inputs.filter(value => typeof value === 'string' && value.length <= MAX_URL && /^https?:\/\//i.test(value));
}

/**
 * 构造 ffmpeg 预览参数。
 * @param {{inputs: string[], headers?: object, proxy?: string, startSeconds?: number}} options
 */
export function buildPreviewArgs({ inputs = [], headers = {}, proxy = '', startSeconds = 0 } = {}) {
    const list = validInputs(inputs);
    if (!list.length) throw new Error('预览缺少可用的媒体地址');
    const args = ['-hide_banner', '-loglevel', 'error', '-nostdin'];
    list.forEach((input, index) => {
        args.push(...headerArgs(headers), ...ffmpegProxyArgs(input, proxy));
        // 跳过片头：点播流可以正常 seek，直播流会忽略该参数。
        if (index === 0 && Number.isFinite(startSeconds) && startSeconds > 0) args.push('-ss', String(Math.floor(startSeconds)));
        args.push('-i', input);
    });
    // yt-dlp 选出的高清流常是「视频 + 音频」两条：画面取第一条，音轨缺了就用第二条。
    args.push('-map', '0:v:0?', '-map', '0:a:0?');
    if (list.length > 1) args.push('-map', '1:a:0?');
    args.push('-c', 'copy', '-movflags', 'frag_keyframe+empty_moov+default_base_moof', '-f', 'mp4', 'pipe:1');
    return args;
}

/** 从 yt-dlp 的 -j 输出里挑出可直接播放的地址（视频在前、音频在后）。 */
export function pickStreams(info) {
    if (!info || typeof info !== 'object') return null;
    const candidates = (Array.isArray(info.requested_downloads) && info.requested_downloads.length ? info.requested_downloads : [info])
        .filter(item => item && typeof item.url === 'string' && item.url.length <= MAX_URL && /^https?:\/\//i.test(item.url));
    if (!candidates.length) return null;
    const video = candidates.find(item => item.vcodec && item.vcodec !== 'none');
    const ordered = (video ? [video, ...candidates.filter(item => item !== video)] : candidates).slice(0, MAX_INPUTS);
    const headers = {};
    for (const item of ordered) Object.assign(headers, sanitizeHeaders(item.http_headers));
    // 部分站点只在顶层给 user-agent，合并时补上，避免直链被 403。
    Object.assign(headers, sanitizeHeaders(info.http_headers));
    return { inputs: ordered.map(item => item.url), headers };
}

/** 从 yt-dlp 参数里取格式选择器：预览只需要 -f，其余提取/转换参数不参与。 */
export function formatSelector(args = []) {
    if (!Array.isArray(args)) return 'b';
    for (let index = 0; index < args.length; index++) {
        const item = args[index];
        if (typeof item !== 'string') continue;
        if ((item === '-f' || item === '--format') && typeof args[index + 1] === 'string' && args[index + 1] && !args[index + 1].startsWith('-')) return args[index + 1];
        if (item.startsWith('--format=')) { const value = item.slice('--format='.length); if (value) return value; }
    }
    return 'b';
}

/** 把 Referer / User-Agent 这类 yt-dlp 参数换成等价的请求头，ffmpeg 不认 yt-dlp 的参数。 */
export function headersFromArgs(args = []) {
    const headers = {};
    if (!Array.isArray(args)) return headers;
    for (let index = 0; index < args.length; index++) {
        const item = args[index], value = args[index + 1];
        if (typeof value !== 'string' || !value) continue;
        if (item === '--referer') headers.Referer = value;
        else if (item === '--user-agent') headers['User-Agent'] = value;
        else if (item === '--add-header' && /^[A-Za-z0-9-]+:/.test(value)) {
            const split = value.indexOf(':');
            const key = value.slice(0, split).trim(), rest = value.slice(split + 1).trim();
            if (key && rest) headers[key] = rest;
        }
    }
    return sanitizeHeaders(headers);
}

/** 起一个 ffmpeg 预览进程；stdout 直接给播放器，stop() 供客户端断开时收尾。 */
export function spawnPreview({ command, args, spawnImpl = spawn }) {
    const child = spawnImpl(command, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const stream = child.stdout;
    let stderr = '', stopped = false;
    child.stderr?.setEncoding?.('utf8');
    child.stderr?.on?.('data', chunk => { stderr = (stderr + String(chunk)).slice(-2000); });
    // 组件路径失效时 spawn 会异步抛错，没有监听会拖垮整个进程。
    child.on?.('error', () => {});
    stream?.once?.('error', () => {});
    const stop = () => {
        if (stopped) return;
        stopped = true;
        try { child.kill('SIGKILL'); } catch { /* 进程已退出 */ }
        try { stream?.destroy?.(); } catch { /* 已销毁 */ }
    };
    child.once?.('close', () => { stopped = true; });
    return { stream, stop, errorText: () => stderr };
}
