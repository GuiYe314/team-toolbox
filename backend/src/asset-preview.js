/**
 * 预览管线（Preview Pipeline）
 *
 * 职责：把「原始文件」加工成「可直接在网页里展示的派生文件」——
 *   preview   预览图（给大型预览窗口用，尺寸较大但仍在浏览器可承受范围）
 *   thumbnail 缩略图（给列表/网格用的缩略图，必须小）
 *
 * 设计原则（对应用户需求「统一预览系统」「每个版本独立 Preview」）：
 * 1. **每个版本各自独立** —— 派生文件落在 <assetId>/<versionId>/ 下，
 *    绝不与其它版本共享。历史版本的预览永远不会被新版本覆盖。
 * 2. **失败不影响原件** —— 处理器抛错时，原文件与元数据完好，
 *    只把 preview_status 置为 'failed' 并记录原因。
 * 3. **按需生成** —— 处理器声明自己能处理哪些类型，不支持的直接跳过
 *    （preview_status 保持 'none'），不浪费 CPU。
 * 4. **可替换** —— 每个处理器是独立模块，将来换实现（如引入 Blender
 *    或 ffmpeg）只需替换对应处理器，管线调度逻辑不动。
 */

import { existsSync, statSync, createReadStream } from 'node:fs';
import { extname, join } from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { ASSET_DIR, resolveAssetPath, saveDerivedFile } from './asset-storage.js';

/** 缩略图边长（像素）。列表里 40~80px 显示，256 足够覆盖 2x 屏。 */
const THUMB_SIZE = 256;
/** 预览图最长边（像素）。超过这个尺寸浏览器解码也会吃力。 */
const PREVIEW_MAX = 1600;
/** 预览图质量。 */
const PREVIEW_QUALITY = 82;
/** 缩略图质量。 */
const THUMB_QUALITY = 78;
/**
 * 生成派生物时原文件超过这个大小就放弃。
 * 原因：sharp 要把整张图解码进内存，2GB 的 TIFF 会直接 OOM。
 * 超限的记为 failed，让用户知道「这个文件太大没做预览」，
 * 而不是让整个 Node 进程崩掉。
 */
const MAX_SOURCE_BYTES = 256 * 1024 * 1024;

/** 视频/音频等媒体类型的扩展名（当前环境无 ffmpeg，保留扩展位）。 */
const VIDEO_EXTS = new Set(['.mp4', '.webm', '.mov', '.m4v']);
const AUDIO_EXTS = new Set(['.mp3', '.wav', '.ogg', '.flac', '.m4a']);

/**
 * 读取原始文件的大小。
 * @param {string} storageKey
 * @returns {{ size: number, abs: string } | null}
 */
function statSource(storageKey) {
    const abs = resolveAssetPath(storageKey);
    if (!abs || !existsSync(abs)) return null;
    try {
        return { size: statSync(abs).size, abs };
    } catch {
        return null;
    }
}

/**
 * 图片处理器。
 *
 * 产出：
 *   preview   → WebP，最长边 PREVIEW_MAX
 *   thumbnail → WebP，THUMB_SIZE × THUMB_SIZE（cover 裁切，视觉整齐）
 *
 * 为什么统一转 WebP：JPEG 对含透明通道的 PNG 会丢透明，
 * WebP 同时支持有损/无损/透明度，体积又比 PNG 小 60~80%。
 */
const imageProcessor = {
    id: 'image',
    exts: new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.tif', '.tiff', '.avif']),
    async run(ctx) {
        const { abs, size, ext } = ctx;
        if (size > MAX_SOURCE_BYTES) {
            throw new Error(`图片过大（${Math.round(size / 1048576)}MB），已跳过预览生成`);
        }

        // 一次性解码，缩放两次 —— 避免读两遍文件
        const pipeline = sharp(abs, { failOn: 'none', animated: false });
        const meta = await pipeline.metadata();

        // 极小图直接原样当缩略图（放大只会糊）
        const thumb = (meta.width && meta.height && meta.width <= THUMB_SIZE && meta.height <= THUMB_SIZE)
            ? await sharp(abs, { failOn: 'none' }).webp({ quality: THUMB_QUALITY }).toBuffer()
            : await sharp(abs, { failOn: 'none' })
                .resize(THUMB_SIZE, THUMB_SIZE, { fit: 'cover', position: 'centre' })
                .webp({ quality: THUMB_QUALITY }).toBuffer();

        // 预览图：不放大小图（withoutEnlargement），GIF 动图取首帧
        const preview = await sharp(abs, { failOn: 'none', animated: false })
            .resize(PREVIEW_MAX, PREVIEW_MAX, { fit: 'inside', withoutEnlargement: true })
            .webp({ quality: PREVIEW_QUALITY }).toBuffer();

        ctx.outputs.push({ kind: 'thumbnail', buffer: thumb, ext: '.webp' });
        ctx.outputs.push({ kind: 'preview', buffer: preview, ext: '.webp' });

        return {
            width: meta.width || null,
            height: meta.height || null,
            format: meta.format || null,
            sourceBytes: size
        };
    }
};

/**
 * 3D 模型处理器 —— 解析 GLB 头部，提取统计信息。
 *
 * 不生成渲染图（那需要 headless WebGL / Blender，不在本轮范围），
 * 但**元数据抽取**很有价值：网页端 model-viewer 也要读这些信息，
 * 服务端先算好可以直接存进 metadata 字段，省得浏览器反复解析。
 *
 * GLB 结构（GLB 2.0）：
 *   12 字节头：magic 'glTF'(4) + version(4) + length(4)
 *   之后是 chunk：length(4) + type(4) + data
 *   JSON chunk 的 type 是 0x4E4F534A ('JSON')
 */
const modelProcessor = {
    id: 'model',
    exts: new Set(['.glb', '.gltf']),
    async run(ctx) {
        const { abs, size, ext } = ctx;
        if (ext === '.gltf') {
            // .gltf 是 JSON 文本格式，可以直接读
            const { readFileSync } = await import('node:fs');
            let gltf;
            try {
                gltf = JSON.parse(readFileSync(abs, 'utf8'));
            } catch (e) {
                throw new Error('gltf 解析失败：' + (e.message || 'JSON 格式错误'));
            }
            return { sourceBytes: size, ...summarizeGltf(gltf) };
        }

        // .glb：读头部 + JSON chunk
        const { open } = await import('node:fs/promises');
        const fh = await open(abs, 'r');
        try {
            const head = Buffer.alloc(12);
            await fh.read(head, 0, 12, 0);
            if (head.subarray(0, 4).toString('ascii') !== 'glTF') {
                throw new Error('不是有效的 GLB 文件（magic 不是 glTF）');
            }
            const totalLength = head.readUInt32LE(8);
            if (totalLength > size + 1024) {
                throw new Error('GLB 头声明的长度与实际文件大小不符，文件可能已损坏');
            }
            // 第一个 chunk 应该是 JSON
            const chunkHead = Buffer.alloc(8);
            await fh.read(chunkHead, 0, 8, 12);
            const chunkLength = chunkHead.readUInt32LE(0);
            const chunkType = chunkHead.readUInt32LE(4);
            if (chunkType !== 0x4e4f534a) {
                throw new Error('GLB 首个 chunk 不是 JSON，文件结构异常');
            }
            const jsonBuf = Buffer.alloc(chunkLength);
            await fh.read(jsonBuf, 0, chunkLength, 20);
            let gltf;
            try {
                gltf = JSON.parse(jsonBuf.toString('utf8'));
            } catch {
                throw new Error('GLB 的 JSON chunk 解析失败，文件可能已损坏');
            }
            return { sourceBytes: size, ...summarizeGltf(gltf) };
        } finally {
            await fh.close();
        }
    }
};

/**
 * 汇总 glTF 的统计信息。
 * @param {object} gltf
 */
function summarizeGltf(gltf) {
    const meshes = gltf.meshes || [];
    let vertices = 0;
    let triangles = 0;
    for (const mesh of meshes) {
        for (const prim of mesh.primitives || []) {
            const posCount = gltf.accessors?.[prim.attributes?.POSITION]?.count || 0;
            vertices += posCount;
            // 三角形模式（4）下顶点数 ÷ 3 得面数
            if (prim.mode === undefined || prim.mode === 4) {
                triangles += Math.floor(posCount / 3);
            }
        }
    }
    return {
        meshes: meshes.length,
        vertices,
        triangles,
        materials: (gltf.materials || []).length,
        textures: (gltf.textures || []).length,
        animations: (gltf.animations || []).length,
        nodes: (gltf.nodes || []).length,
        generator: gltf.asset?.generator || null
    };
}

/**
 * 文本类处理器（Markdown / JSON / 代码 / 纯文本）。
 *
 * 产出 preview：内容截断到 PREVIEW_TEXT_LIMIT 字符的纯文本。
 * 用途：网页端可以「先看内容再决定要不要下原文件」，
 * 也让搜索/预览不必每次拉全量文件。
 */
const PREVIEW_TEXT_LIMIT = 64 * 1024;
const textProcessor = {
    id: 'text',
    exts: new Set([
        '.md', '.markdown', '.txt', '.json', '.xml', '.html', '.css', '.js',
        '.ts', '.jsx', '.tsx', '.cs', '.shader', '.glsl', '.yaml', '.yml', '.csv'
    ]),
    async run(ctx) {
        const { abs, size, ext } = ctx;
        // 超过上限就只读前面一段（流式读，不用 readFileSync 拉整个文件）
        const limit = Math.min(size, PREVIEW_TEXT_LIMIT);
        const { open } = await import('node:fs/promises');
        const fh = await open(abs, 'r');
        try {
            const buf = Buffer.alloc(limit);
            await fh.read(buf, 0, limit, 0);
            let text = buf.toString('utf8');
            // 截断点可能落在多字节字符中间，切掉残缺尾巴
            if (text.includes('�')) text = text.slice(0, text.lastIndexOf('�'));
            const truncated = size > limit;
            // JSON 试着格式化一下，便于人读
            if (ext === '.json') {
                try {
                    text = JSON.stringify(JSON.parse(text), null, 2);
                } catch { /* 不合法就保持原样 */ }
            }
            ctx.outputs.push({
                kind: 'preview',
                buffer: Buffer.from(text, 'utf8'),
                ext: '.txt'
            });
            return {
                sourceBytes: size,
                chars: text.length,
                truncated,
                lines: text.split('\n').length
            };
        } finally {
            await fh.close();
        }
    }
};

/**
 * 音频处理器 —— 抽取时长与基础信息。
 * 不生成波形（需要完整解码音频并采样，CPU 成本高且本轮无 ffmpeg）。
 * 产出 preview：一个 JSON 描述文件，供网页端展示基本信息。
 */
const audioProcessor = {
    id: 'audio',
    exts: AUDIO_EXTS,
    async run(ctx) {
        const { abs, size, ext } = ctx;
        const info = await probeAudio(abs, ext);
        ctx.outputs.push({
            kind: 'preview',
            buffer: Buffer.from(JSON.stringify(info, null, 2), 'utf8'),
            ext: '.json'
        });
        return { sourceBytes: size, ...info };
    }
};

/**
 * 轻量音频探测：解析 WAV 头（唯一能纯 JS 精确读出时长的格式），
 * 其余格式只给文件大小。
 */
async function probeAudio(abs, ext) {
    const base = { duration: null, channels: null, sampleRate: null, codec: ext.slice(1) };
    if (ext !== '.wav') return base;
    try {
        const { open } = await import('node:fs/promises');
        const fh = await open(abs, 'r');
        try {
            const head = Buffer.alloc(44);
            await fh.read(head, 0, 44, 0);
            if (head.subarray(0, 4).toString('ascii') !== 'RIFF') return base;
            if (head.subarray(8, 12).toString('ascii') !== 'WAVE') return base;
            const channels = head.readUInt16LE(22);
            const sampleRate = head.readUInt32LE(24);
            const byteRate = head.readUInt32LE(28);
            const duration = byteRate > 0 ? (await fh.stat()).size / byteRate : null;
            return { ...base, channels, sampleRate, duration };
        } finally {
            await fh.close();
        }
    } catch {
        return base;
    }
}

/**
 * 视频处理器 —— 当前环境无 ffmpeg，只记录基础信息。
 * 保留处理器位置：将来装上 ffmpeg 只需在此实现抽帧，
 * 管线的其余部分（调度、落盘、状态机）完全不用改。
 */
const videoProcessor = {
    id: 'video',
    exts: VIDEO_EXTS,
    async run(ctx) {
        const { size, ext } = ctx;
        // 明确说明为什么没有预览图，而不是静默失败
        throw new Error('视频预览需要 ffmpeg，当前服务器未安装（原始文件不受影响）');
    }
};

/** 处理器注册表。新增类型只需在这里加一项。 */
const PROCESSORS = [
    imageProcessor,
    modelProcessor,
    textProcessor,
    audioProcessor,
    videoProcessor
];

/**
 * 找到能处理该扩展名的处理器。
 * @param {string} ext 扩展名（含点，小写）
 */
function pickProcessor(ext) {
    const e = String(ext || '').toLowerCase();
    return PROCESSORS.find((p) => p.exts.has(e)) || null;
}

/**
 * 计算派生文件的 sha256（用于去重与完整性校验）。
 */
function sha256(buffer) {
    return createHash('sha256').update(buffer).digest('hex');
}

/**
 * 为一个版本生成预览与缩略图。
 *
 * @param {object} params
 * @param {number} params.assetId
 * @param {number} params.versionId
 * @param {string} params.originalStorageKey 原始文件存储键
 * @param {string} [params.ext] 扩展名（不传则从存储键推断）
 * @returns {Promise<{ status: string, previewKey?: string, thumbnailKey?: string,
 *   metadata?: object, error?: string, processor?: string }>}
 */
export async function generatePreview({ assetId, versionId, originalStorageKey, ext }) {
    const fileExt = (ext || extname(originalStorageKey || '')).toLowerCase();
    const processor = pickProcessor(fileExt);

    // 不支持的类型 —— 不是错误，只是「没有预览」而已
    if (!processor) {
        return { status: 'none', processor: null };
    }

    const src = statSource(originalStorageKey);
    if (!src) {
        return {
            status: 'failed',
            processor: processor.id,
            error: '原始文件不存在或不可读'
        };
    }

    const ctx = {
        assetId,
        versionId,
        ext: fileExt,
        abs: src.abs,
        size: src.size,
        outputs: []
    };

    let metadata;
    try {
        metadata = await processor.run(ctx);
    } catch (e) {
        // 处理器失败**绝不影响原件** —— 这里只把失败原因带出去
        return {
            status: 'failed',
            processor: processor.id,
            error: e.message || String(e)
        };
    }

    // 落盘：每个版本的派生文件在自己的 <assetId>/<versionId>/ 目录下
    const keys = {};
    for (const out of ctx.outputs) {
        try {
            keys[out.kind] = saveDerivedFile({
                assetId,
                versionId,
                buffer: out.buffer,
                kind: out.kind,
                ext: out.ext
            });
        } catch (e) {
            return {
                status: 'failed',
                processor: processor.id,
                error: `派生文件写入失败：${e.message || e}`
            };
        }
    }

    return {
        status: 'ready',
        processor: processor.id,
        previewKey: keys.preview || null,
        thumbnailKey: keys.thumbnail || null,
        metadata: {
            ...(metadata || {}),
            generatedAt: new Date().toISOString(),
            processor: processor.id
        }
    };
}

/**
 * 处理器清单（供前端/诊断展示当前服务器支持哪些类型）。
 */
export function listProcessors() {
    return PROCESSORS.map((p) => ({ id: p.id, exts: [...p.exts] }));
}

/**
 * 补生成存量资源的预览。
 *
 * 为什么需要：预览管线只在**上传时**触发。管线接入之前就已存在的
 * 资源（或上传时进程没跑起来）会永远停在 preview_status='pending'，
 * 前端就一直显示「正在生成预览」—— 实际是没人管。
 *
 * 服务启动时扫一遍，把 pending / failed 的版本补跑一次，
 * 存量数据就能自动获得预览。
 *
 * @param {object} params
 * @param {import('better-sqlite3').Database} params.connection
 * @param {number} [params.limit=200] 一次最多处理多少个版本
 * @returns {Promise<{ scanned: number, ready: number, failed: number, none: number }>}
 */
export async function backfillPreviews({ connection: db, limit = 200 }) {
    const rows = db.prepare(`
        SELECT v.id, v.asset_id, v.original_storage_key
        FROM asset_versions v
        WHERE v.preview_status IN ('pending', 'failed')
          AND v.original_storage_key IS NOT NULL
          AND v.original_storage_key <> ''
        ORDER BY v.id
        LIMIT ?
    `).all(limit);

    const stat = { scanned: rows.length, ready: 0, failed: 0, none: 0 };
    for (const row of rows) {
        const r = await generatePreview({
            assetId: row.asset_id,
            versionId: row.id,
            originalStorageKey: row.original_storage_key
        });
        if (r.status === 'ready') {
            db.prepare(`
                UPDATE asset_versions
                SET preview_storage_key = ?, thumbnail_storage_key = ?,
                    metadata = ?, preview_status = 'ready', preview_error = NULL
                WHERE id = ?
            `).run(
                r.previewKey || null,
                r.thumbnailKey || null,
                JSON.stringify(r.metadata || {}),
                row.id
            );
            stat.ready++;
        } else if (r.status === 'failed') {
            db.prepare(
                "UPDATE asset_versions SET preview_status = 'failed', preview_error = ? WHERE id = ?"
            ).run(r.error || '预览生成失败', row.id);
            stat.failed++;
        } else {
            db.prepare("UPDATE asset_versions SET preview_status = 'none' WHERE id = ?").run(row.id);
            stat.none++;
        }
    }
    return stat;
}

export { THUMB_SIZE, PREVIEW_MAX, imageProcessor, modelProcessor, textProcessor };
