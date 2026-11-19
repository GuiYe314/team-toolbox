import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdtemp, rm, stat, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, extname, basename } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { MediaToolError } from './media-tool-error.js';
import { videoOptions, videoArguments } from './video-options.js';
export { MediaToolError } from './media-tool-error.js';
export { videoOptions, videoArguments } from './video-options.js';
import Busboy from 'busboy';
import sharp from 'sharp';
import { createIntegrationConfig, detectExecutable } from './integration-common.js';

export const MEDIA_LIMITS = Object.freeze({ image: 32 * 1024 ** 2, video: 1024 ** 3, output: 256 * 1024 ** 2, pixels: 32 * 1024 ** 2, timeout: 10 * 60_000 });
const fail = message => { throw new MediaToolError(message); };
function number(value, min, max, fallback) {
    if (value === undefined || value === '') return fallback;
    if (!Number.isFinite(Number(value)) || Number(value) < min || Number(value) > max) fail(`参数应在 ${min}～${max} 之间`);
    return Number(value);
}
function fields(value, keys) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) fail('处理选项无效');
}
export function imageOptions(value = {}) {
    fields(value, ['format', 'quality', 'width', 'height', 'fit', 'rotate', 'watermark']);
    const format = value.format || 'webp', fit = value.fit || 'inside', rotate = Number(value.rotate || 0);
    if (!['jpeg', 'png', 'webp', 'avif'].includes(format) || !['inside', 'cover', 'contain'].includes(fit) || ![0, 90, 180, 270].includes(rotate)) fail('图片格式、缩放模式或旋转角度无效');
    const watermark = value.watermark || '';
    if (typeof watermark !== 'string' || watermark.length > 80 || /[\u0000-\u001f]/.test(watermark)) fail('水印请输入最多80个可见字符');
    return { format, fit, rotate, quality: Math.round(number(value.quality, 1, 100, 82)), width: Math.round(number(value.width, 1, 8192, 0)), height: Math.round(number(value.height, 1, 8192, 0)), watermark };
}
// 原始文件名仅用于下载显示，实际输入及字幕名固定在本轮私有目录。
export async function receiveToolFile(req, { maxBytes, signal, allowSubtitle = false }) {
    const directory = await mkdtemp(join(tmpdir(), 'tt-media-'));
    const tasks = [];
    let parser;
    try {
        let name = '', received = 0, options = {}, invalid = '', subtitle = '', fieldSeen = false;
        const seen = new Set(), input = join(directory, 'input');
        parser = Busboy({ headers: req.headers, limits: { files: allowSubtitle ? 2 : 1, fields: 1, parts: allowSubtitle ? 4 : 3, fileSize: maxBytes, fieldSize: 16_384 } });
        parser.on('field', (key, value, info) => {
            if (key !== 'options' || fieldSeen || info.valueTruncated) { invalid = '处理选项无效或重复'; return; }
            fieldSeen = true;
            try { options = JSON.parse(value); } catch { invalid = '处理选项不是有效 JSON'; }
        });
        parser.on('file', (key, stream, info) => {
            if (seen.has(key) || !['file', ...(allowSubtitle ? ['subtitle'] : [])].includes(key)) { invalid = '上传文件字段无效或重复'; stream.resume(); return; }
            seen.add(key);
            let target = input, bytes = 0;
            if (key === 'file') name = basename(info.filename || 'file').replace(/[\r\n\u0000]/g, '').slice(0, 180);
            else {
                const ext = extname(info.filename || '').toLowerCase();
                if (!['.srt', '.ass'].includes(ext)) { invalid = '字幕只支持UTF-8的SRT/ASS文件'; stream.resume(); return; }
                subtitle = `subtitle${ext}`; target = join(directory, subtitle);
            }
            const meter = new Transform({ transform(chunk, _encoding, done) {
                bytes += chunk.length;
                if (key === 'file') received += chunk.length;
                if (key === 'subtitle' && bytes > 2 * 1024 ** 2) return done(new MediaToolError('字幕超过2MiB限制', 413));
                done(null, chunk);
            } });
            stream.once('limit', () => { invalid = '文件超过大小限制'; });
            const task = pipeline(stream, meter, createWriteStream(target, { flags: 'wx', mode: 0o600 }), { signal });
            tasks.push(task); task.catch(error => { invalid ||= error instanceof MediaToolError ? error.message : '上传失败'; parser.destroy(error); });
        });
        parser.on('filesLimit', () => { invalid = '上传文件数量过多'; });
        parser.on('fieldsLimit', () => { invalid = '选项数量过多'; });
        parser.on('partsLimit', () => { invalid = '上传内容过多'; });
        await pipeline(req, parser, { signal });
        await Promise.all(tasks);
        if (invalid) fail(invalid);
        if (!seen.has('file') || !received) fail('请选择非空文件');
        if (subtitle) await validateSubtitle(join(directory, subtitle), subtitle);
        if (allowSubtitle) {
            const checked = videoOptions(options);
            if (checked.subtitleMode === 'burn' && !subtitle) fail('模板需要字幕：请选择本次使用的SRT/ASS文件');
            if (checked.subtitleMode !== 'burn' && subtitle) fail('请选择烧录字幕，或移除字幕文件');
        }
        return { directory, input, name, options, size: received, subtitle };
    } catch (error) {
        parser?.destroy();
        await Promise.allSettled(tasks);
        await rm(directory, { recursive: true, force: true }); throw error;
    }
}

export async function validateSubtitle(path, name) {
    const bytes = await readFile(path);
    if (!bytes.length || bytes.length > 2 * 1024 ** 2) fail('字幕为空或超过2MiB限制');
    let text;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { fail('字幕必须是UTF-8编码，请转换编码后重试'); }
    if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text)) fail('字幕含无效控制字符');
    const lines = text.split(/\r?\n/);
    if (lines.length > 30000 || lines.some(line => line.length > 8192)) fail('字幕行数或单行长度超过限制');
    if (name.endsWith('.srt')) {
        if (!/\d{2}:\d{2}:\d{2}[,.]\d{3}\s+-->\s+\d{2}:\d{2}:\d{2}[,.]\d{3}/.test(text)) fail('SRT字幕缺少有效时间轴');
    } else if (!/^\[Script Info\]/im.test(text) || !/^\[Events\]/im.test(text) || !/^Dialogue:/im.test(text) || /^\[(Fonts|Graphics)\]/im.test(text)) fail('ASS字幕格式无效，或含不支持的字体/图形附件');
}

function xml(value) { return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[character])); }
export async function processImage(file, signal) {
    const o = imageOptions(file.options);
    let image = sharp(file.input, { limitInputPixels: MEDIA_LIMITS.pixels, animated: false, failOn: 'error' }).timeout({ seconds: 30 });
    const abort = () => image.destroy(new MediaToolError('处理已停止', 499));
    signal?.addEventListener('abort', abort, { once: true });
    try {
        if (signal?.aborted) throw new MediaToolError('处理已停止', 499);
        const metadata = await image.metadata();
        if (!['jpeg', 'png', 'webp', 'avif', 'heif', 'tiff', 'gif'].includes(metadata.format)) fail('只支持常用位图，不处理 SVG/PDF');
        image = image.autoOrient().rotate(o.rotate);
        if (o.width || o.height) image = image.resize({ width: o.width || undefined, height: o.height || undefined, fit: o.fit, withoutEnlargement: true });
        if (o.watermark) {
            const text = `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.max(60, o.watermark.length * 16 + 24)}" height="40"><rect width="100%" height="100%" fill="black" fill-opacity="0.4"/><text x="12" y="27" font-size="18" fill="white">${xml(o.watermark)}</text></svg>`;
            // 先确定最终尺寸，避免小图与旋转后水印越界。
            const base = await image.toBuffer();
            const dimensions = await sharp(base).metadata();
            const overlay = await sharp(Buffer.from(text)).resize({ width: Math.min(dimensions.width, Math.max(60, o.watermark.length * 16 + 24)), height: Math.min(40, dimensions.height), fit: 'inside' }).png().toBuffer();
            image = sharp(base).composite([{ input: overlay, gravity: 'southeast' }]);
        }
        const output = join(file.directory, `output.${o.format === 'jpeg' ? 'jpg' : o.format}`);
        await image.toFormat(o.format, { quality: o.quality }).toFile(output);
        if (signal?.aborted) throw new MediaToolError('处理已停止', 499);
        return { output, type: `image/${o.format}`, name: `${basename(file.name, extname(file.name))}-处理.${o.format === 'jpeg' ? 'jpg' : o.format}` };
    } catch (error) {
        if (error instanceof MediaToolError) throw error;
        throw new MediaToolError('图片读取或处理失败，请检查格式、尺寸与文件完整性', 422);
    } finally { signal?.removeEventListener('abort', abort); image.destroy(); }
}

export async function processVideo(file, signal, { executable, spawnProcess = spawn } = {}) {
    const o = videoOptions(file.options), ext = o.mode === 'mp3' ? 'mp3' : o.mode === 'gif' ? 'gif' : 'mp4';
    const allowed = ['.mp4', '.mov', '.m4v', '.mkv', '.webm', '.avi', '.mpeg', '.mpg', '.ts', '.m2ts'];
    if (!allowed.includes(extname(file.name).toLowerCase())) fail('请选择本地视频文件');
    if (!executable) {
        const config = await createIntegrationConfig().read();
        executable = await detectExecutable('ffmpeg', config.ffmpegPath);
    }
    if (!executable) throw new MediaToolError('未找到 FFmpeg，请在视频下载的组件设置中配置', 409);
    const output = join(file.directory, `output.${ext}`);
    await new Promise((resolve, reject) => {
        if (signal?.aborted) return reject(new MediaToolError('处理已停止', 499));
        const child = spawnProcess(executable, videoArguments(file.input, output, o, file.subtitle), { cwd: file.directory, windowsHide: true, shell: false, stdio: ['ignore', 'ignore', 'pipe'] });
        let errorBytes = 0, failure;
        const stop = reason => { failure ||= reason; child.kill(); };
        const abort = () => stop(new MediaToolError('处理已停止', 499));
        const timer = setTimeout(() => stop(new MediaToolError('视频处理超时，请缩短视频或降低尺寸', 408)), MEDIA_LIMITS.timeout);
        signal?.addEventListener('abort', abort, { once: true });
        child.stderr.on('data', chunk => { errorBytes += chunk.length; if (errorBytes > 64 * 1024) stop(new MediaToolError('视频错误输出过多，请检查文件', 422)); });
        child.once('error', () => { failure ||= new MediaToolError('FFmpeg 无法启动，请检查组件', 502); });
        child.once('close', code => {
            clearTimeout(timer); signal?.removeEventListener('abort', abort);
            failure ? reject(failure) : code !== 0 ? reject(new MediaToolError('视频处理失败，请检查视频格式或是否包含所需音轨', 422)) : resolve();
        });
        if (signal?.aborted) abort();
    });
    const size = (await stat(output)).size;
    if (!size || size >= MEDIA_LIMITS.output) throw new MediaToolError('输出为空或达到256MiB上限，请缩短时长或降低尺寸', 422);
    return { output, name: `${basename(file.name, extname(file.name))}-处理.${ext}`, type: ext === 'mp3' ? 'audio/mpeg' : ext === 'gif' ? 'image/gif' : 'video/mp4' };
}
