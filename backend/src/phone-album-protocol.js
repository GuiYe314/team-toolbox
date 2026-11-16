import { extname } from 'node:path';

export const ALBUM_LIMITS = Object.freeze({ files: 200, fileBytes: 1024 ** 3, totalBytes: 8 * 1024 ** 3, sessions: 8, concurrent: 2, ttlMs: 30 * 60_000, uploadMs: 5 * 60_000, idleMs: 90_000 });
const FORMATS = {
    '.jpg': ['image', 'image/jpeg'], '.jpeg': ['image', 'image/jpeg'], '.png': ['image', 'image/png'],
    '.gif': ['image', 'image/gif'], '.webp': ['image', 'image/webp'], '.bmp': ['image', 'image/bmp'],
    '.avif': ['image', 'image/avif'], '.heic': ['image', 'image/heic'], '.heif': ['image', 'image/heif'],
    '.livp': ['image', 'application/zip'],
    '.mp4': ['video', 'video/mp4'], '.mov': ['video', 'video/quicktime'], '.m4v': ['video', 'video/x-m4v'], '.webm': ['video', 'video/webm']
};
export class AlbumError extends Error {
    constructor(code, message, status = 400) { super(message); this.code = code; this.status = status; }
}
export function validateAlbumFile(input, limits = ALBUM_LIMITS) {
    if (!input || Array.isArray(input) || Object.keys(input).some(key => !['id', 'name', 'size'].includes(key)) || !/^[a-f0-9]{32}$/.test(input.id || '')) throw new AlbumError('invalid_input', '文件上传编号无效');
    if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 200 || /[\x00-\x1f\x7f/\\]/.test(input.name)) throw new AlbumError('invalid_input', '文件名无效，不能包含路径');
    const ext = extname(input.name).toLowerCase(), format = FORMATS[ext];
    if (!format) throw new AlbumError('unsupported_media', '请选择 JPG、PNG、GIF、WebP、BMP、AVIF、HEIC/HEIF、LIVP 或 MP4、MOV、M4V、WebM 照片和视频');
    if (!Number.isSafeInteger(input.size) || input.size <= 0) throw new AlbumError('invalid_input', '文件为空或大小无效');
    if (input.size > limits.fileBytes) throw new AlbumError('file_limit', '单个文件不能超过 1 GiB', 413);
    return { ...input, ext, type: format[0], mime: format[1] };
}
// 只检查媒体头，完整解码留给已有预览管线，原文件不执行或转码。
export function verifyAlbumHeader(head, ext) {
    const text = (offset, length) => head.toString('latin1', offset, offset + length);
    let valid = false;
    if (ext === '.livp') valid = head.subarray(0, 4).equals(Buffer.from([80,75,3,4]));
    else if (ext === '.jpg' || ext === '.jpeg') valid = head[0] === 255 && head[1] === 216 && head[2] === 255;
    else if (ext === '.png') valid = head.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
    else if (ext === '.gif') valid = ['GIF87a', 'GIF89a'].includes(text(0, 6));
    else if (ext === '.webp') valid = text(0, 4) === 'RIFF' && text(8, 4) === 'WEBP';
    else if (ext === '.bmp') valid = text(0, 2) === 'BM';
    else if (ext === '.webm') valid = head.subarray(0, 4).equals(Buffer.from([26,69,223,163]));
    else {
        valid = head.length >= 16 && text(4, 4) === 'ftyp';
        if (['.heic', '.heif', '.avif'].includes(ext)) {
            const expected = ext === '.avif' ? ['avif', 'avis'] : ['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1'];
            const brands = [text(8, 4)];
            const boxSize = head.length >= 4 ? Math.min(head.readUInt32BE(0), head.length) : 0;
            for (let at = 16; at + 4 <= boxSize; at += 4) brands.push(text(at, 4));
            valid = valid && brands.some(brand => expected.includes(brand));
        }
    }
    if (!valid) throw new AlbumError('invalid_media', '文件内容与照片/视频格式不符，请重新选择原文件');
}
