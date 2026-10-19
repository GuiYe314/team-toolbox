// TASK-012 图片附件：落盘存储与类型校验。
//
// 设计取舍（2026-10-19 与用户确认）：
//   图片以**独立文件**存放在 data/uploads/，Markdown 正文里存 ![alt](/api/uploads/xxx.png) 链接。
//   好处：Markdown 保持可读可编辑、正文体积不暴涨、备份文件小。
//   代价：备份 JSON 只含图片链接，换机器恢复时需另行拷贝 data/uploads 目录（已在导出提示与文档中说明）。
//   （另一方案 base64 内嵌会让 Markdown 不可读且体积暴涨，已放弃。）
//
// 安全要点：
//   1. 文件名完全由服务端生成（时间戳 + 随机串），**绝不采用用户提供的文件名**，杜绝路径穿越。
//   2. 同时校验扩展名白名单与**文件魔数**（magic number），防止把可执行文件伪装成 .png。
//   3. SVG 存在脚本注入风险（可内嵌 <script>），因此仅当显式允许时才接受（默认拒绝）。
//   4. 不限制图片大小（用户明确要求），但设置单请求总体积上限防止把服务器内存打满。

import { randomBytes } from 'node:crypto';
import { mkdirSync, existsSync, writeFileSync, statSync, unlinkSync } from 'node:fs';
import { resolve as resolvePath, join, extname, dirname, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { errorMap } from './errors.js';
import Busboy from 'busboy';

// 与 db.js 保持一致：以项目根为基准，避免因启动工作目录不同导致
// 图片目录落到 backend/data 而数据库在项目根 data 的错配。
const PROJECT_ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** 图片根目录：默认 <项目根>/data/uploads，可用 UPLOAD_DIR 覆盖。 */
export const UPLOAD_DIR = process.env.UPLOAD_DIR
    ? resolvePath(PROJECT_ROOT, process.env.UPLOAD_DIR)
    : resolvePath(PROJECT_ROOT, 'data', 'uploads');

/** 上传路径在 Markdown 中的公开前缀。 */
export const UPLOAD_URL_PREFIX = '/api/uploads/';

/**
 * 允许的图片类型：扩展名 → 规范 MIME。
 * SVG 默认不在此列：SVG 可内嵌脚本，即便经 <img> 加载一般不执行，仍属不必要的风险面。
 */
const IMAGE_TYPES = new Map([
    ['.png', 'image/png'],
    ['.jpg', 'image/jpeg'],
    ['.jpeg', 'image/jpeg'],
    ['.gif', 'image/gif'],
    ['.webp', 'image/webp'],
    ['.bmp', 'image/bmp'],
    ['.avif', 'image/avif']
]);

/**
 * 魔数校验：按扩展名对应的真实文件头判断，防止伪装。
 * 返回 true 表示通过；无法识别则拒绝（宁可严格，也不放行）。
 * @param {Buffer} buf 文件内容
 * @param {string} ext 小写扩展名（含点）
 */
function matchesMagic(buf, ext) {
    if (buf.length < 12) return false;
    switch (ext) {
        case '.png':
            // 89 50 4E 47 0D 0A 1A 0A
            return buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
        case '.jpg':
        case '.jpeg':
            // FF D8 FF
            return buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
        case '.gif':
            // GIF87a / GIF89a
            const g = buf.subarray(0, 6).toString('ascii');
            return g === 'GIF87a' || g === 'GIF89a';
        case '.webp':
            // "RIFF" ....  "WEBP"
            return buf.subarray(0, 4).toString('ascii') === 'RIFF'
                && buf.subarray(8, 12).toString('ascii') === 'WEBP';
        case '.bmp':
            return buf[0] === 0x42 && buf[1] === 0x4d; // "BM"
        case '.avif':
            // ISO-BMFF：第4-8 字节为 "ftyp"，brand 容器里应含 avif/avis/mif1
            if (buf.subarray(4, 8).toString('ascii') !== 'ftyp') return false;
            const brand = buf.subarray(8, 12).toString('ascii');
            return ['avif', 'avis', 'mif1', 'heic', 'heif'].includes(brand.trim());
        default:
            return false;
    }
}

/**
 * 校验并保存一张图片。
 *
 * @param {object} config
 * @param {Buffer} config.buffer 文件内容
 * @param {string} config.originalName 客户端文件名（仅用于取扩展名，不用于生成存储名）
 * @returns {{ filename: string, url: string, size: number, mime: string }}
 * @throws {{ code: 'invalid_input'|'constraint_failed', message: string }}
 */
export function saveImage({ buffer, originalName }) {
    const rawExt = extname(String(originalName || '')).toLowerCase();
    const mime = IMAGE_TYPES.get(rawExt);
    if (!mime) {
        throw errorMap(
            new Error(`不支持的图片格式「${rawExt || '未知'}」，仅支持：${[...IMAGE_TYPES.keys()].join(' ')}`),
            '(uploads)',
            'invalid_input'
        );
    }
    if (!buffer || buffer.length === 0) {
        throw errorMap(new Error('图片内容为空'), '(uploads)', 'invalid_input');
    }
    if (!matchesMagic(buffer, rawExt)) {
        throw errorMap(
            new Error('图片内容与扩展名不符，可能不是有效的图片文件'),
            '(uploads)',
            'invalid_input'
        );
    }

    if (!existsSync(UPLOAD_DIR)) mkdirSync(UPLOAD_DIR, { recursive: true });

    // 文件名完全由服务端生成，杜绝路径穿越与同名覆盖
    const filename = `${Date.now()}-${randomBytes(8).toString('hex')}${rawExt}`;
    writeFileSync(join(UPLOAD_DIR, filename), buffer);

    return {
        filename,
        url: UPLOAD_URL_PREFIX + filename,
        size: buffer.length,
        mime
    };
}

/**
 * 解析公开 URL 中的文件名，拒绝任何非安全文件名（防目录穿越）。
 * @param {string} name URL 片段
 * @returns {string|null} 合法则返回绝对路径，否则 null
 */
export function resolveUploadPath(name) {
    const decoded = String(name || '');
    // 只允许「时间戳-十六进制.扩展名」这一种形态，其余一律拒绝
    if (!/^\d{10,16}-[0-9a-f]{16}\.(png|jpe?g|gif|webp|bmp|avif)$/.test(decoded)) return null;
    const abs = resolvePath(join(UPLOAD_DIR, decoded));
    // 双保险：解析后必须仍在 UPLOAD_DIR 之内。
    // 用 relative 而非字符串前缀比较——Windows 分隔符是 '\'，用 '/' 拼接前缀会永远不匹配。
    const rel = relative(UPLOAD_DIR, abs);
    if (!rel || rel.startsWith('..') || isAbsolute(rel)) return null;
    if (!existsSync(abs)) return null;
    return abs;
}

/** 由文件名推断 Content-Type。 */
export function mimeOf(filename) {
    return IMAGE_TYPES.get(extname(String(filename).toLowerCase())) || 'application/octet-stream';
}

/** 删除一张已上传的图片；不存在时静默返回。 */
export function deleteImage(filename) {
    const abs = resolveUploadPath(filename);
    if (!abs) return false;
    try {
        statSync(abs);
        unlinkSync(abs);
        return true;
    } catch {
        return false;
    }
}
/**
 * 解析 multipart/form-data 请求，取出第一个文件字段。
 *
 * 说明：Express 5 的 req 不是原生 Request，**没有** req.formData()，
 * 因此这里用 busboy 自行解析（已安装为唯一新增依赖）。
 *
 * 不限制单文件体积（用户明确要求）；但保留一个整体上限防止把进程内存打满，
 * 超限时立即中断并报错，不静默截断。
 *
 * @param {import('express').Request} req
 * @param {number} [maxBytes=512*1024*1024] 整个请求体上限，默认 512MB
 * @returns {Promise<{buffer: Buffer, filename: string} | null>} 无文件字段时返回 null
 */
export function parseUploadFile(req, maxBytes = 512 * 1024 * 1024) {
    return new Promise((resolvePromise, rejectPromise) => {
        let bb;
        try {
            bb = Busboy({ headers: req.headers, limits: { fileSize: maxBytes, files: 1 } });
        } catch {
            rejectPromise(errorMap(new Error('请求不是有效的 multipart/form-data'), '(uploads)', 'invalid_input'));
            return;
        }

        let done = false;
        const fail = (err) => {
            if (done) return;
            done = true;
            req.unpipe(bb);
            rejectPromise(err);
        };
        const finish = (value) => {
            if (done) return;
            done = true;
            resolvePromise(value);
        };

        const chunks = [];
        let filename = '';
        let got = false;
        let truncated = false;

        bb.on('file', (_field, stream, info) => {
            got = true;
            filename = info && info.filename ? info.filename : '';
            stream.on('data', (c) => chunks.push(c));
            stream.on('limit', () => {
                truncated = true;
                fail(errorMap(new Error('图片体积超出限制'), '(uploads)', 'invalid_input'));
            });
            stream.on('error', (e) => fail(e));
        });

        bb.on('error', (e) => {
            fail(errorMap(e, '(uploads)', 'invalid_input'));
        });

        // 没有 file 字段时也要正常结束，否则请求会挂住
        bb.on('close', () => {
            if (truncated) return;
            if (!got) finish(null);
            else finish({ buffer: Buffer.concat(chunks), filename });
        });

        req.pipe(bb);
    });
}
