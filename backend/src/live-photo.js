// 实况原件只读；有界解析和随机暂存，不从媒体内容接收本机路径或进程参数。
import { open, mkdtemp, rm, stat } from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, extname } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { spawn } from 'node:child_process';
import yauzl from 'yauzl';
import { detectExecutable } from './integration-common.js';

export const LIVE_LIMITS = Object.freeze({ header: 1024 * 1024, part: 256 * 1024 ** 2, expanded: 512 * 1024 ** 2, output: 64 * 1024 ** 2, duration: 30, timeout: 60_000 });
const still = new Set(['.jpg', '.jpeg', '.heic', '.heif']), moving = new Set(['.mov', '.mp4', '.m4v']);
const shutdown = new AbortController(), children = new Set();
export function disposeLivePhotos() { shutdown.abort(); for (const child of children) child.kill(); }
process.once('exit', disposeLivePhotos);
const crcTable = Array.from({ length: 256 }, (_, n) => { for (let i = 0; i < 8; i++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1; return n >>> 0; });
function crcUpdate(crc, chunk) { for (const byte of chunk) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8); return crc >>> 0; }
async function readAt(handle, size, position) { const b = Buffer.alloc(size); const { bytesRead } = await handle.read(b, 0, size, position); return b.subarray(0, bytesRead); }

export function jpegXmp(head) {
    if (head[0] !== 255 || head[1] !== 216) return '';
    const parts = [];
    for (let at = 2, count = 0; at + 4 <= head.length && count++ < 2048;) {
        if (head[at] !== 255) break;
        const marker = head[at + 1];
        if (marker === 0xda || marker === 0xd9) break;
        if (marker === 0xff) { at++; continue; }
        const length = head.readUInt16BE(at + 2);
        if (length < 2 || at + length + 2 > head.length) break;
        const data = head.subarray(at + 4, at + length + 2);
        if (marker === 0xe1 && data.subarray(0, 29).toString('ascii') === 'http://ns.adobe.com/xap/1.0/\0') parts.push(data.subarray(29).toString('utf8'));
        at += length + 2;
    }
    return parts.join('\n');
}

export function motionRange(xmp, size) {
    if (!Number.isSafeInteger(size) || size <= 0 || xmp.length > LIVE_LIMITS.header) return null;
    const candidates = [];
    const legacy = /(?:\w+:)?MicroVideoOffset\s*=\s*["'](\d{1,12})["']/.exec(xmp) || /<(?:\w+:)?MicroVideoOffset\b[^>]*>\s*(\d{1,12})\s*</.exec(xmp);
    if (legacy) candidates.push(Number(legacy[1]));
    // Android Motion Photo Container：只接受明确标为MotionPhoto的视频项，拒绝歧义目录。
    const items = [...xmp.matchAll(/<(?:\w+:)?Item\b[^>]*>/g)].map(match => match[0]);
    const videos = items.filter(item => /(?:\w+:)?Semantic\s*=\s*["']MotionPhoto["']/.test(item) && /(?:\w+:)?Mime\s*=\s*["']video\/mp4["']/.test(item));
    if (videos.length === 1) {
        const length = /(?:\w+:)?Length\s*=\s*["'](\d{1,12})["']/.exec(videos[0]);
        if (length && items.at(-1) === videos[0]) candidates.push(Number(length[1]));
    }
    const unique = [...new Set(candidates)];
    if (unique.length !== 1 || unique[0] < 24 || unique[0] > LIVE_LIMITS.part || unique[0] >= size) return null;
    return { start: size - unique[0], length: unique[0] };
}

export async function validVideo(path, start = 0, length) {
    const handle = await open(path, 'r');
    try {
        length ??= (await handle.stat()).size - start;
        let at = 0, ftyp = false, moov = false, mdat = false;
        for (let count = 0; at < length && count < 4096; count++) {
            const head = await readAt(handle, Math.min(32, length - at), start + at);
            if (head.length < 8) return false;
            let size = head.readUInt32BE(0); const kind = head.toString('ascii', 4, 8);
            if (size === 1) { if (head.length < 16) return false; const big = head.readBigUInt64BE(8); if (big > BigInt(Number.MAX_SAFE_INTEGER)) return false; size = Number(big); }
            if (size === 0) size = length - at;
            if (size < (head.readUInt32BE(0) === 1 ? 16 : 8) || at + size > length) return false;
            if (at === 0) { if (kind !== 'ftyp' || size < 16) return false; ftyp = true; }
            if (kind === 'moov') moov = true;
            if (kind === 'mdat') mdat = true;
            at += size;
        }
        return at === length && ftyp && moov && mdat;
    } finally { await handle.close(); }
}

async function unpackLivp(path, directory) {
    const zip = await new Promise((done, reject) => yauzl.open(path, { lazyEntries: true, autoClose: false, validateEntrySizes: true }, (error, value) => error ? reject(error) : done(value)));
    try {
        const entries = await new Promise((done, reject) => {
            const found = []; let expanded = 0, count = 0;
            zip.on('error', reject); zip.on('end', () => done(found));
            zip.on('entry', entry => {
                try {
                    const name = entry.fileName, mode = (entry.externalFileAttributes >>> 16) & 0xf000;
                    if (++count > 8 || /[\\\x00-\x1f]/.test(name) || name.startsWith('/') || name.split('/').some(p => p === '..' || p.includes(':')) || mode === 0xa000 || (entry.generalPurposeBitFlag & 1)) throw new Error('LIVP包含不安全或过多条目');
                    if (!name.endsWith('/')) {
                        const ext = extname(name).toLowerCase();
                        if (!still.has(ext) && !moving.has(ext)) throw new Error('LIVP只接受一张原照片和一段MOV/MP4');
                        expanded += entry.uncompressedSize;
                        if (!entry.uncompressedSize || entry.uncompressedSize > LIVE_LIMITS.part || expanded > LIVE_LIMITS.expanded) throw new Error('LIVP解压内容超出限制');
                        found.push(entry);
                    }
                    zip.readEntry();
                } catch (error) { reject(error); }
            });
            zip.readEntry();
        });
        const photos = entries.filter(e => still.has(extname(e.fileName).toLowerCase())), videos = entries.filter(e => moving.has(extname(e.fileName).toLowerCase()));
        if (photos.length !== 1 || videos.length !== 1) throw new Error('LIVP需要且只能包含一张照片和一段视频');
        const outputs = [];
        for (const [index, entry] of [photos[0], videos[0]].entries()) {
            const output = join(directory, `part-${index}${extname(entry.fileName).toLowerCase()}`);
            const stream = await new Promise((done, reject) => zip.openReadStream(entry, (error, value) => error ? reject(error) : done(value)));
            let crc = 0xffffffff, bytes = 0;
            const meter = new Transform({ transform(chunk, _encoding, callback) { bytes += chunk.length; if (bytes > entry.uncompressedSize) return callback(new Error('LIVP大小无效')); crc = crcUpdate(crc, chunk); callback(null, chunk); } });
            await pipeline(stream, meter, createWriteStream(output, { flags: 'wx', mode: 0o600 }), { signal: AbortSignal.any([shutdown.signal, AbortSignal.timeout(LIVE_LIMITS.timeout)]) });
            if (bytes !== entry.uncompressedSize || ((crc ^ 0xffffffff) >>> 0) !== entry.crc32) throw new Error('LIVP原片CRC校验失败');
            outputs.push(output);
        }
        const h = await open(outputs[0], 'r');
        try {
            const head = await readAt(h, 32, 0), ext = extname(outputs[0]);
            if (ext === '.jpg' || ext === '.jpeg') { if (head[0] !== 255 || head[1] !== 216 || head[2] !== 255) throw new Error('LIVP照片内容无效'); }
            else if (head.toString('ascii', 4, 8) !== 'ftyp' || !/heic|heix|hevc|hevx|mif1|msf1/.test(head.toString('ascii', 8))) throw new Error('LIVP HEIC照片内容无效');
        } finally { await h.close(); }
        if (!await validVideo(outputs[1])) throw new Error('LIVP动态视频结构无效');
        return { photo: outputs[0], video: outputs[1], source: 'livp' };
    } finally { zip.close(); }
}

export function liveVideoArgs(input, output) {
    return ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-protocol_whitelist', 'file,pipe', '-format_whitelist', 'mov,mp4,m4a,3gp,3g2,mj2', '-threads', '2', '-i', input, '-map', '0:v:0', '-map', '0:a:0?', '-t', String(LIVE_LIMITS.duration), '-vf', "scale=w='min(1280,iw)':h='min(1280,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2", '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p', '-threads', '2', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', '-fs', String(LIVE_LIMITS.output), output];
}

async function fixedProcess(executable, args) {
    shutdown.signal.throwIfAborted();
    await new Promise((done, reject) => {
        const child = spawn(executable, args, { shell: false, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
        children.add(child);
        let bytes = 0, error;
        const timer = setTimeout(() => { error = new Error('实况视频处理超时'); child.kill(); }, LIVE_LIMITS.timeout);
        child.stderr.on('data', chunk => { bytes += chunk.length; if (bytes > 8192) { error = new Error('实况视频处理输出超限'); child.kill(); } });
        child.on('error', () => { error = new Error('无法启动实况视频处理组件'); });
        child.once('close', code => { children.delete(child); clearTimeout(timer); code === 0 && !error ? done() : reject(error || new Error('动态视频无法解码，原件仍可下载')); });
    });
}

// 图片预览可能由多个上传同时触发；限制本能力的解压和转码为单个任务。
let processing = Promise.resolve(), waiting = 0;
export async function prepareLivePhoto(path, ext) {
    if (!['.jpg', '.jpeg', '.livp'].includes(ext)) return null;
    if (waiting >= 16) throw new Error('实况处理队列繁忙，原件已保留');
    waiting++;
    const previous = processing; let release; processing = new Promise(done => { release = done; });
    await previous;
    let directory;
    try {
        shutdown.signal.throwIfAborted();
        const size = (await stat(path)).size;
        let range;
        if (ext !== '.livp') {
            const handle = await open(path, 'r');
            try { range = motionRange(jpegXmp(await readAt(handle, Math.min(size, LIVE_LIMITS.header), 0)), size); }
            finally { await handle.close(); }
            if (!range) return null;
            const handle2 = await open(path, 'r');
            try { const ending = await readAt(handle2, 2, range.start - 2); if (range.start < 4 || !ending.equals(Buffer.from([255, 217]))) return null; }
            finally { await handle2.close(); }
            if (!await validVideo(path, range.start, range.length)) throw new Error('照片内嵌的动态视频结构无效');
        }
        directory = await mkdtemp(join(tmpdir(), 'tt-live-photo-'));
        let parts;
        if (ext === '.livp') parts = await unpackLivp(path, directory);
        else {
            const video = join(directory, 'embedded.mp4');
            await pipeline(createReadStream(path, { start: range.start, end: range.start + range.length - 1 }), createWriteStream(video, { flags: 'wx', mode: 0o600 }), { signal: AbortSignal.any([shutdown.signal, AbortSignal.timeout(LIVE_LIMITS.timeout)]) });
            parts = { photo: path, video, source: 'motion-jpeg' };
        }
        const metadata = { detected: true, source: parts.source, status: 'failed', maxPreviewSeconds: LIVE_LIMITS.duration };
        let motionPath, posterPath;
        try {
            const ffmpeg = await detectExecutable('ffmpeg', '');
            if (!ffmpeg) throw new Error('缺少FFmpeg，无法生成实况播放预览；原件仍可下载');
            motionPath = join(directory, 'motion.mp4');
            await fixedProcess(ffmpeg, liveVideoArgs(parts.video, motionPath));
            const bytes = (await stat(motionPath)).size;
            if (!bytes || bytes > LIVE_LIMITS.output || !await validVideo(motionPath)) throw new Error('实况派生视频无效或超出大小限制');
            metadata.status = 'ready';
            if (['.heic', '.heif'].includes(extname(parts.photo))) {
                const poster = join(directory, 'poster.jpg');
                await fixedProcess(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-protocol_whitelist', 'file,pipe', '-i', motionPath, '-map', '0:v:0', '-frames:v', '1', '-threads', '2', '-fs', '8388608', poster]);
                posterPath = poster;
                metadata.posterFromVideo = true;
            }
        } catch (error) { metadata.status = 'failed'; metadata.error = error.message; motionPath = undefined; }
        return { photo: posterPath || parts.photo, motionPath, metadata, cleanup: () => rm(directory, { recursive: true, force: true }) };
    } catch (error) { if (directory) await rm(directory, { recursive: true, force: true }); throw error; }
    finally { waiting--; release(); }
}

// 只允许本版本目录内的固定派生键；导入的metadata不能引用另一资源或原件。
export function motionStorageKey(metadata, assetId, versionId) {
    try {
        const value = typeof metadata === 'string' ? JSON.parse(metadata) : metadata;
        const key = value?.livePhoto?.motionStorageKey;
        return value?.livePhoto?.status === 'ready' && typeof key === 'string' && new RegExp(`^${Number(assetId)}/${Number(versionId)}/motion\\d{10,16}-[a-f0-9]{16}\\.mp4$`).test(key) ? key : null;
    } catch { return null; }
}
