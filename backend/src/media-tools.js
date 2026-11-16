import { spawn } from 'node:child_process';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, extname, basename } from 'node:path';
import { pipeline } from 'node:stream/promises';
import Busboy from 'busboy';
import sharp from 'sharp';
import { createIntegrationConfig, detectExecutable } from './integration-common.js';

export class MediaToolError extends Error {
    constructor(message, status = 400) { super(message); this.status = status; }
}
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
export function videoOptions(value = {}) {
    fields(value, ['mode', 'start', 'duration', 'width', 'crf']);
    const mode = value.mode || 'compress';
    if (!['compress', 'trim', 'mp4', 'mp3', 'gif'].includes(mode)) fail('视频处理方式无效');
    return { mode, start: number(value.start, 0, 86400, 0), duration: number(value.duration, 0.1, 7200, undefined), width: Math.round(number(value.width, 160, 3840, mode === 'gif' ? 480 : 1280)), crf: Math.round(number(value.crf, 18, 38, 26)) };
}
export function videoArguments(input, output, options) {
    const o = videoOptions(options);
    const args = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-protocol_whitelist', 'file,pipe', '-max_alloc', '268435456'];
    if (o.start) args.push('-ss', String(o.start));
    args.push('-format_whitelist', 'mov,matroska,webm,avi,mpegts,mpeg,mpegvideo', '-i', input);
    if (o.duration) args.push('-t', String(o.duration));
    if (o.mode === 'mp3') args.push('-map', '0:a:0', '-vn', '-c:a', 'libmp3lame', '-b:a', '192k');
    else if (o.mode === 'gif') args.push('-t', String(Math.min(o.duration || 10, 30)), '-an', '-vf', `fps=10,scale=${o.width}:-1:flags=lanczos`, '-loop', '0');
    else args.push('-map', '0:v:0', '-map', '0:a:0?', '-vf', `scale=w='min(${o.width},iw)':h=-2`, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', String(o.crf), '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart');
    args.push('-threads', '2', '-fs', String(MEDIA_LIMITS.output), output);
    return args;
}

// 单文件流式接收。原始文件名只用于下载显示，实际路径永远随机。
export async function receiveToolFile(req, { maxBytes, signal }) {
    const directory = await mkdtemp(join(tmpdir(), 'tt-media-'));
    try {
        let name = '', received = 0, options = {}, fileCount = 0, invalid = '', fileTask;
        const input = join(directory, 'input');
        const parser = Busboy({ headers: req.headers, limits: { files: 1, fields: 1, parts: 3, fileSize: maxBytes, fieldSize: 16_384 } });
        parser.on('field', (key, value, info) => {
            if (key !== 'options' || info.valueTruncated) { invalid = '处理选项无效或过长'; return; }
            try { options = JSON.parse(value); } catch { invalid = '处理选项不是有效 JSON'; }
        });
        parser.on('file', (key, stream, info) => {
            fileCount++;
            if (key !== 'file') invalid = '请选择文件';
            name = basename(info.filename || 'file').replace(/[\r\n\u0000]/g, '').slice(0, 180);
            stream.on('data', chunk => { received += chunk.length; });
            stream.once('limit', () => { invalid = '文件超过大小限制'; });
            fileTask = pipeline(stream, createWriteStream(input, { flags: 'wx', mode: 0o600 }), { signal });
            fileTask.catch(() => {});
        });
        parser.on('filesLimit', () => { invalid = '每次请求仅接受一个文件'; });
        parser.on('fieldsLimit', () => { invalid = '选项数量过多'; });
        parser.on('partsLimit', () => { invalid = '上传内容过多'; });
        await pipeline(req, parser, { signal });
        await fileTask;
        if (invalid) fail(invalid);
        if (fileCount !== 1 || !received) fail('请选择非空文件');
        return { directory, input, name, options, size: received };
    } catch (error) { await rm(directory, { recursive: true, force: true }); throw error; }
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
        const child = spawnProcess(executable, videoArguments(file.input, output, o), { windowsHide: true, shell: false, stdio: ['ignore', 'ignore', 'pipe'] });
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
