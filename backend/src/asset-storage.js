// 资源管理：资产类型判定与存储。
//
// 与 uploads.js（Markdown 图片附件）的关系：
//   uploads.js 只服务单张图片的场景（Markdown 内嵌），约束很紧（仅图片白名单 + 魔数）。
//   资产库要收 GLB/FBX/MP4/ZIP 等几十种格式，约束必须放宽，但**安全底线一致**：
//     1. 存储文件名完全由服务端生成，绝不采用用户提供的文件名（杜绝路径穿越）；
//     2. 解析后的绝对路径必须仍位于 ASSET_DIR 之内（双保险）；
//     3. SVG 默认拒绝（可内嵌 <script>），除非显式允许。
//
// 布局：data/assets/<assetId>/<versionId>/{original,preview,thumbnail}.<ext>
//   每个版本各有自己的目录 —— 预览与缩略图**不共享 latest 版本**，
//   这样历史版本随时可以独立预览（用户明确要求）。
//
// 注意：预览/缩略图是「可重新生成的派生文件」，缺失不影响 original；
// 但本模块只负责**存取**它们，生成逻辑（GLB→glb、视频抽帧等）属服务端
// PreviewProcessor 范畴，第一版不实现，preview_status 停在 pending。

import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, existsSync, writeFileSync, readFileSync, copyFileSync, statSync, unlinkSync, readdirSync, rmSync } from 'node:fs';
import { resolve as resolvePath, join, extname, dirname, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { errorMap } from './errors.js';

const PROJECT_ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** 资产根目录：默认 <项目根>/data/assets，可用 ASSET_DIR 覆盖。 */
export const ASSET_DIR = process.env.ASSET_DIR
    ? resolvePath(PROJECT_ROOT, process.env.ASSET_DIR)
    : resolvePath(PROJECT_ROOT, 'data', 'assets');

/** 资产文件的公开 URL 前缀（原始文件与预览文件共用）。 */
export const ASSET_URL_PREFIX = '/api/assets/files/';

/** 单文件体积上限：4GB。超过则拒绝，避免把进程内存打满。 */
export const MAX_ASSET_BYTES = 4 * 1024 * 1024 * 1024;

// ══════════════════════════════════════════════════════════════════
// 类型判定
// ══════════════════════════════════════════════════════════════════

/**
 * 资产归类。**type 决定用哪个 PreviewProvider**，是前端统一预览的路由键。
 * 与 mime_type 分离：3D 模型一类跨多种 MIME（.glb/.gltf/.fbx/.obj/.stl），
 * 按扩展名归类比按 MIME 更可靠。
 */
export const ASSET_TYPE = {
    IMAGE: 'image',
    VIDEO: 'video',
    AUDIO: 'audio',
    MODEL: 'model',
    PDF: 'pdf',
    MARKDOWN: 'markdown',
    TEXT: 'text',
    ARCHIVE: 'archive',
    OTHER: 'other'
};

/** 扩展名 → { type, mime }。键一律小写（含点）。 */
const EXT_MAP = new Map(Object.entries({
    // 图片
    '.png': { type: 'image', mime: 'image/png' },
    '.jpg': { type: 'image', mime: 'image/jpeg' },
    '.jpeg': { type: 'image', mime: 'image/jpeg' },
    '.gif': { type: 'image', mime: 'image/gif' },
    '.webp': { type: 'image', mime: 'image/webp' },
    '.bmp': { type: 'image', mime: 'image/bmp' },
    '.avif': { type: 'image', mime: 'image/avif' },
    // 视频
    '.mp4': { type: 'video', mime: 'video/mp4' },
    '.webm': { type: 'video', mime: 'video/webm' },
    '.mov': { type: 'video', mime: 'video/quicktime' },
    '.m4v': { type: 'video', mime: 'video/x-m4v' },
    // 音频
    '.mp3': { type: 'audio', mime: 'audio/mpeg' },
    '.wav': { type: 'audio', mime: 'audio/wav' },
    '.ogg': { type: 'audio', mime: 'audio/ogg' },
    '.flac': { type: 'audio', mime: 'audio/flac' },
    '.m4a': { type: 'audio', mime: 'audio/mp4' },
    // 3D 模型
    '.glb': { type: 'model', mime: 'model/gltf-binary' },
    '.gltf': { type: 'model', mime: 'model/gltf+json' },
    '.fbx': { type: 'model', mime: 'application/octet-stream' },
    '.obj': { type: 'model', mime: 'model/obj' },
    '.stl': { type: 'model', mime: 'model/stl' },
    '.blend': { type: 'model', mime: 'application/x-blender' },
    '.usdz': { type: 'model', mime: 'model/vnd.usdz+zip' },
    // PDF
    '.pdf': { type: 'pdf', mime: 'application/pdf' },
    // Markdown
    '.md': { type: 'markdown', mime: 'text/markdown' },
    '.markdown': { type: 'markdown', mime: 'text/markdown' },
    // 文本 / 代码 / 配置
    '.txt': { type: 'text', mime: 'text/plain' },
    '.json': { type: 'text', mime: 'application/json' },
    '.xml': { type: 'text', mime: 'application/xml' },
    '.html': { type: 'text', mime: 'text/html' },
    '.htm': { type: 'text', mime: 'text/html' },
    '.css': { type: 'text', mime: 'text/css' },
    '.js': { type: 'text', mime: 'text/javascript' },
    '.mjs': { type: 'text', mime: 'text/javascript' },
    '.ts': { type: 'text', mime: 'text/typescript' },
    '.cs': { type: 'text', mime: 'text/plain' },
    '.shader': { type: 'text', mime: 'text/plain' },
    '.vert': { type: 'text', mime: 'text/plain' },
    '.frag': { type: 'text', mime: 'text/plain' },
    '.yaml': { type: 'text', mime: 'text/yaml' },
    '.yml': { type: 'text', mime: 'text/yaml' },
    '.ini': { type: 'text', mime: 'text/plain' },
    '.csv': { type: 'text', mime: 'text/csv' },
    // Unity 资源（.unity 为场景、.prefab 为预制体、.mat 为材质）
    '.unity': { type: 'text', mime: 'text/plain' },
    '.prefab': { type: 'text', mime: 'text/plain' },
    '.mat': { type: 'text', mime: 'text/plain' },
    '.asset': { type: 'other', mime: 'application/octet-stream' },
    '.meta': { type: 'text', mime: 'text/plain' },
    // 压缩包
    '.zip': { type: 'archive', mime: 'application/zip' },
    '.gz': { type: 'archive', mime: 'application/gzip' },
    '.tar': { type: 'archive', mime: 'application/x-tar' },
    '.7z': { type: 'archive', mime: 'application/x-7z-compressed' },
    '.rar': { type: 'archive', mime: 'application/vnd.rar' }
}));

/** 可在浏览器内直接预览的扩展名（用于「预览」按钮可用性判断）。 */
export const BROWSER_VIEWABLE = new Set([
    '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.avif',
    '.mp4', '.webm',
    '.mp3', '.wav', '.ogg',
    '.glb', '.gltf',
    '.pdf', '.md', '.markdown',
    '.txt', '.json', '.xml', '.html', '.css', '.js', '.ts', '.cs', '.yaml', '.yml'
]);

/**
 * 按文件名判定资产类型与 MIME。
 * 未登记的扩展名归为 other，不拒绝 —— 资产库是通用存储，
 * 「不认识」不等于「不允许」，只是没有预览器。
 *
 * @param {string} filename 用户提供的原始文件名（仅用于取扩展名）
 * @returns {{ type: string, mime: string, ext: string }}
 */
export function classifyAsset(filename) {
    const ext = extname(String(filename || '')).toLowerCase();
    const hit = EXT_MAP.get(ext);
    return {
        ext,
        type: hit ? hit.type : ASSET_TYPE.OTHER,
        mime: hit ? hit.mime : 'application/octet-stream'
    };
}

/** 该类型能否在浏览器内预览（决定 UI 上「预览」是否可用）。 */
export function isViewable(filename) {
    return BROWSER_VIEWABLE.has(extname(String(filename || '')).toLowerCase());
}

/**
 * 按资产类型判断能否预览。
 *
 * 为什么不直接用 isViewable(name)：
 *   资源可以重命名，改完名字后扩展名可能已变（比如从 .txt 改成 .glb），
 *   但**它仍是同一个资产**，latest 版本的 mime 才是真实格式。
 *   所以详情页以「类型 + latest 版本」为准，名字只作兜底。
 *
 * @param {string} type 资产类型
 * @returns {boolean}
 */
export function isViewableType(type) {
    // 这些类型都有对应的 PreviewProvider
    return ['image', 'video', 'audio', 'model', 'pdf', 'markdown', 'text'].includes(type);
}

// ══════════════════════════════════════════════════════════════════
// 魔数校验
// ══════════════════════════════════════════════════════════════════

/**
 * 文件魔数 → 归属的扩展名集合；用于「内容与扩展名是否相符」的粗筛。
 * 只覆盖有明确文件头的格式；返回 null 表示不限制（无法判定不等于校验失败）。
 */
const MAGIC_SIGNATURES = [
    { exts: ['.png'], bytes: [0x89, 0x50, 0x4e, 0x47] },
    { exts: ['.jpg', '.jpeg'], bytes: [0xff, 0xd8, 0xff] },
    { exts: ['.gif'], prefix: 'GIF8' },
    { exts: ['.pdf'], prefix: '%PDF' },
    { exts: ['.zip'], bytes: [0x50, 0x4b, 0x03, 0x04] }, // ZIP 容器
    // GLB 虽是基于 ZIP 的容器，但其**前 4 字节被规范改为ASCII "glTF"**，
    // 不是 PK\x03\x04。若沿用 ZIP 签名会把所有合法 GLB 判为伪装。
    { exts: ['.glb'], ascii: { offset: 0, len: 4, value: 'gltf' } },
    { exts: ['.gz'], bytes: [0x1f, 0x8b] },
    { exts: ['.mp4'], prefix: null, offset: 4, bytes: [0x66, 0x74, 0x79, 0x70] }, // ftyp box
    { exts: ['.wav'], prefix: 'RIFF', secondary: { offset: 8, prefix: 'WAVE' } },
    { exts: ['.webp'], prefix: 'RIFF', secondary: { offset: 8, prefix: 'WEBP' } },
    { exts: ['.stl'], ascii: { offset: 0, len: 5, value: 'solid' } }
];

/**
 * 校验内容与扩展名是否相符。
 *
 * 策略是**粗筛而非全量验证**：GLB/FBX/MP4 的尾部结构复杂，
 * 完整解析成本高且收益有限。这里只做「明显伪装」的拦截 ——
 * 例如把 .exe 改名成 .glb（ZIP 头不符）、把 .png 改名成 .mp4。
 * 判不出来的格式一律放行，由后续的预览生成环节兜底。
 *
 * @param {Buffer} buf 文件内容（至少前 512 字节）
 * @param {string} ext 小写扩展名（含点）
 * @returns {{ ok: boolean, reason?: string }}
 */
export function verifyMagic(buf, ext) {
    const head = buf.subarray(0, 512);
    const ascii = head.toString('latin1');

    // 二进制格式：有明确头则必须匹配；无对应签名则放行
    const sig = MAGIC_SIGNATURES.find((s) => s.exts.includes(ext));
    if (sig) {
        if (sig.prefix) {
            if (ascii.slice(0, sig.prefix.length) !== sig.prefix) {
                return { ok: false, reason: '文件头与扩展名不符' };
            }
            if (sig.secondary &&
                ascii.slice(sig.secondary.offset, sig.secondary.offset + sig.secondary.prefix.length) !== sig.secondary.prefix) {
                return { ok: false, reason: '文件头与扩展名不符' };
            }
        } else if (sig.ascii) {
            const a = sig.ascii;
            if (ascii.slice(a.offset, a.offset + a.len).trim().toLowerCase() !== a.value) {
                return { ok: false, reason: '文件头与扩展名不符' };
            }
        } else if (sig.bytes) {
            const off = sig.offset || 0;
            for (let i = 0; i < sig.bytes.length; i++) {
                if (head[off + i] !== sig.bytes[i]) {
                    return { ok: false, reason: '文件头与扩展名不符' };
                }
            }
        }
        return { ok: true };
    }

    // 文本类：不允许出现过多 NUL 字节（二进制伪装成 txt/prefab）
    if (['.txt', '.json', '.xml', '.md', '.markdown', '.css', '.js', '.ts',
        '.cs', '.yaml', '.yml', '.html', '.htm', '.csv', '.shader',
        '.unity', '.prefab', '.mat', '.meta'].includes(ext)) {
        let nul = 0;
        for (let i = 0; i < head.length; i++) if (head[i] === 0) nul++;
        if (nul > head.length * 0.05) {
            return { ok: false, reason: '内容看起来是二进制文件，与文本扩展名不符' };
        }
    }

    return { ok: true };
}

// ══════════════════════════════════════════════════════════════════
// 存储
// ══════════════════════════════════════════════════════════════════

/**
 * 生成一个存储文件名：`<kind><时间戳>-<16位十六进制><扩展名>`。
 *
 * 三种 kind 都带前缀（original / preview / thumbnail），不是只有派生文件带。
 * 原因：resolveAssetPath 的白名单正则靠这个前缀区分文件种类，
 * 若原始文件没有前缀就会解析失败、所有字节端点 404。
 * 同时前缀让人在磁盘上直接扫一眼就能分辨文件用途，排错时省事。
 */
function storageName(ext, kind = 'original') {
    return `${kind}${Date.now()}-${randomBytes(8).toString('hex')}${ext}`;
}

/** 版本的存储子目录（相对 ASSET_DIR）。 */
export function versionDirKey(assetId, versionId) {
    return `${assetId}/${versionId}`;
}

/**
 * 保存一个版本的原始文件。
 *
 * @param {object} config
 * @param {import('better-sqlite3').Database} config.connection
 * @param {number} config.assetId
 * @param {number} config.versionId
 * @param {Buffer} config.buffer 文件内容
 * @param {string} config.originalName 用户提供的文件名（仅取扩展名）
 * @returns {{ storageKey: string, size: number, sha256: string, mime: string, ext: string, type: string }}
 * @throws {{ code:'invalid_input'|'constraint_failed', message:string }}
 */
export function saveAssetFile({ connection, assetId, versionId, buffer, originalName }) {
    if (!buffer || buffer.length === 0) {
        throw errorMap(new Error('文件内容为空'), '(assets)', 'invalid_input');
    }
    if (buffer.length > MAX_ASSET_BYTES) {
        throw errorMap(
            new Error(`文件超出上限 ${Math.floor(MAX_ASSET_BYTES / 1024 / 1024 / 1024)}GB`),
            '(assets)', 'invalid_input'
        );
    }

    const { ext, type, mime } = classifyAsset(originalName);

    // SVG 默认拒绝：可内嵌 <script>，即便经 <img> 加载一般不执行，仍是多余风险面
    if (ext === '.svg') {
        throw errorMap(
            new Error('出于安全考虑不支持 SVG 格式（可内嵌脚本），请改用 PNG 或 WebP'),
            '(assets)', 'invalid_input'
        );
    }

    const magic = verifyMagic(buffer, ext);
    if (!magic.ok) {
        throw errorMap(
            new Error(`${originalName || '文件'}：${magic.reason}`),
            '(assets)', 'invalid_input'
        );
    }

    const relDir = versionDirKey(assetId, versionId);
    const absDir = join(ASSET_DIR, relDir);
    if (!existsSync(absDir)) mkdirSync(absDir, { recursive: true });

    // 文件名由服务端生成，杜绝路径穿越与同名覆盖
    const filename = storageName(ext, 'original');
    writeFileSync(join(absDir, filename), buffer);

    return {
        storageKey: `${relDir}/${filename}`,
        size: buffer.length,
        sha256: createHash('sha256').update(buffer).digest('hex'),
        mime,
        ext,
        type
    };
}

/**
 * 写入派生文件（preview / thumbnail）。
 * 与原文件同目录，文件名以 kind 前缀区分。
 *
 * @param {object} config
 * @param {number} config.assetId
 * @param {number} config.versionId
 * @param {Buffer} config.buffer
 * @param {'preview'|'thumbnail'} config.kind
 * @param {string} config.ext 目标扩展名（含点，如 '.glb'、'.png'）
 * @returns {string} 相对 ASSET_DIR 的存储键
 */
export function saveDerivedFile({ assetId, versionId, buffer, kind, ext }) {
    const relDir = versionDirKey(assetId, versionId);
    const absDir = join(ASSET_DIR, relDir);
    if (!existsSync(absDir)) mkdirSync(absDir, { recursive: true });
    // storageName 内部已加 kind 前缀，这里不要再拼一次
    const filename = storageName(ext, kind);
    writeFileSync(join(absDir, filename), buffer);
    return `${relDir}/${filename}`;
}

/**
 * 把某个存储键解析为绝对路径；非法或不存在时返回 null。
 *
 * 防目录穿越的双保险：
 *   1. 正则白名单 —— 只接受 "<数字>/<数字>/<kind><时间戳>-<hex>.<ext>" 形态；
 *   2. relative 边界校验 —— 解析后必须仍在 ASSET_DIR 之内。
 *      必须用 relative 而非字符串前缀比较：Windows 分隔符是 '\'，
 *      用 '/' 拼前缀会永远不匹配（uploads.js 已踩过这个坑）。
 *
 * @param {string} storageKey 相对 ASSET_DIR 的存储键
 * @returns {string|null}
 */
export function resolveAssetPath(storageKey) {
    const key = String(storageKey || '');
    // <assetId>/<versionId>/<kind><13~16位时间戳>-<16位hex>.<ext>
    // kind 含 tmp：恢复版本时先把源文件复制成 tmp 暂存，待新版本行建好后再搬进正式目录。
    if (!/^\d{1,12}\/\d{1,12}\/(original|preview|thumbnail|tmp)\d{10,16}-[0-9a-f]{16}\.[a-z0-9]{1,10}$/.test(key)) {
        return null;
    }
    const abs = resolvePath(join(ASSET_DIR, key));
    const rel = relative(ASSET_DIR, abs);
    if (!rel || rel.startsWith('..') || isAbsolute(rel)) return null;
    if (!existsSync(abs)) return null;
    return abs;
}

/**
 * 复制一份已存在的存储文件，用于「恢复历史版本」。
 * 用户明确要求：恢复 v3 时复制其内容生成新版本 v8，而非把 latest 指针回拨。
 *
 * @param {string} fromKey 源存储键
 * @param {number} assetId
 * @param {number} newVersionId 新版本 id（副本落到它的目录）
 * @param {string} ext 扩展名（含点）
 * @returns {string} 新存储键
 */
export function copyAssetFile(fromKey, assetId, newVersionId, ext) {
    const src = resolveAssetPath(fromKey);
    if (!src) {
        throw errorMap(new Error('源文件已不存在，无法恢复'), '(assets)', 'not_found');
    }
    const absDir = join(ASSET_DIR, versionDirKey(assetId, newVersionId));
    if (!existsSync(absDir)) mkdirSync(absDir, { recursive: true });
    const filename = storageName(ext, 'original');
    const dest = join(absDir, filename);
    copyFileSync(src, dest);
    return `${versionDirKey(assetId, newVersionId)}/${filename}`;
}

/** 读取一个存储键的内容（供预览/下载/文本预览用）。不存在返回 null。 */
export function readAssetFile(storageKey) {
    const abs = resolveAssetPath(storageKey);
    if (!abs) return null;
    try {
        return readFileSync(abs);
    } catch {
        return null;
    }
}

/** 删除一个存储文件；不存在或非法键返回 false。 */
export function deleteAssetFile(storageKey) {
    const abs = resolveAssetPath(storageKey);
    if (!abs) return false;
    try {
        unlinkSync(abs);
        return true;
    } catch {
        return false;
    }
}

/**
 * 把某个存储文件复制到**同一版本目录**下的临时名。
 *
 * 用途：恢复历史版本时，目标版本的 versionId 尚未生成
 * （建行与文件复制有先后依赖），而版本目录又是按 versionId 分的。
 * 先复制到源版本的目录里拿到内容，建行后再由 moveAssetFile() 挪进新目录。
 *
 * @param {string} fromKey 源存储键
 * @returns {string} 同目录下的临时存储键（形如 <assetId>/<versionId>/tmp<hex>.<ext>）
 */
export function stageAssetFileCopy(fromKey) {
    const src = resolveAssetPath(fromKey);
    if (!src) {
        throw errorMap(new Error('源文件已不存在，无法恢复'), '(assets)', 'not_found');
    }
    const ext = extname(fromKey);
    const dir = dirname(src);
    const staged = `tmp${Date.now()}-${randomBytes(8).toString('hex')}${ext}`;
    writeFileSync(join(dir, staged), readFileSync(src));
    return `${relative(ASSET_DIR, join(dir, staged)).split('\\').join('/')}`;
}

/**
 * 把暂存文件移动到目标版本目录的正式位置。
 *
 * @param {string} stagedKey stageAssetFileCopy 返回的暂存键
 * @param {number} assetId
 * @param {number} versionId 目标版本 id（建行后才有）
 * @returns {string} 正式存储键
 */
export function commitStagedAssetFile(stagedKey, assetId, versionId) {
    const src = resolvePath(join(ASSET_DIR, stagedKey));
    const rel = relative(ASSET_DIR, src);
    if (!rel || rel.startsWith('..') || isAbsolute(rel) || !existsSync(src)) {
        throw errorMap(new Error('暂存文件不存在'), '(assets)', 'not_found');
    }
    const ext = extname(stagedKey);
    const absDir = join(ASSET_DIR, versionDirKey(assetId, versionId));
    if (!existsSync(absDir)) mkdirSync(absDir, { recursive: true });
    const filename = storageName(ext, 'original');
    copyFileSync(src, join(absDir, filename));
    unlinkSync(src);
    return `${versionDirKey(assetId, versionId)}/${filename}`;
}

/** 删除一个版本目录（永久删除版本时用，清理该版本全部三个文件）。 */
export function deleteVersionDir(assetId, versionId) {
    const abs = resolvePath(join(ASSET_DIR, versionDirKey(assetId, versionId)));
    const rel = relative(ASSET_DIR, abs);
    if (!rel || rel.startsWith('..') || isAbsolute(rel)) return false;
    try {
        rmSync(abs, { recursive: true, force: true });
        return true;
    } catch {
        return false;
    }
}

/**
 * 统计磁盘占用（详情页「资产统计」用）。
 * @param {number} assetId
 * @returns {{ total: number, versions: number }}
 */
export function assetDiskUsage(assetId) {
    const abs = resolvePath(join(ASSET_DIR, String(assetId)));
    const rel = relative(ASSET_DIR, abs);
    if (!rel || rel.startsWith('..') || isAbsolute(rel) || !existsSync(abs)) {
        return { total: 0, versions: 0 };
    }
    let total = 0;
    let versions = 0;
    for (const entry of readdirSync(abs, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        versions++;
        for (const f of readdirSync(join(abs, entry.name), { withFileTypes: true })) {
            if (!f.isFile()) continue;
            try { total += statSync(join(abs, entry.name, f.name)).size; } catch { /* 并发删除，忽略 */ }
        }
    }
    return { total, versions };
}

/** 由存储键推断 Content-Type（预览文件下载时用）。 */
export function assetMimeOf(storageKey, fallback = 'application/octet-stream') {
    const ext = extname(String(storageKey || '')).toLowerCase();
    return EXT_MAP.get(ext)?.mime || fallback;
}