// 全量备份：文档数据 + 资源文件打成一份 ZIP。
//
// ── 为什么需要这个模块 ──
//
// 此前项目有**两条互不相干**的备份路径：
//   1. /api/backup/export   —— 导出文档（JSON/JSON.GZ），不含任何资源文件
//   2. /api/assets/export   —— 导出资源（ZIP），不含任何文档
//
// 这意味着用户点「导出备份」以为数据安全了，实际只备份了文字 ——
// 原图、模型、预览图一个都没进包。**这是数据保护漏洞，不是功能缺失。**
// 资源侧恰恰已有成熟的流式 ZIP 导出能力（asset-transfer.js），
// 缺的只是一个把两者合起来的入口。
//
// ── 包结构 ──
//
//   manifest.json          总清单（版本、导出时间、各部分计数）
//   documents.json         文档快照（沿用 store.exportSnapshot 的结构）
//   uploads/<filename>     文档内嵌图片（原 data/uploads/ 目录）
//   assets/manifest.json   资源清单（沿用 asset-transfer 的结构）
//   assets/files/...       资源文件（原图 / 预览图 / 缩略图）
//
// 两份 manifest 各自保持原有格式与版本号 —— 恢复时仍可复用
// 现有的 importSnapshot 与 importAssets，不必为统一备份重写一套解析。
//
// ── 为什么必须包含 uploads/ ──
//
// 文档里的图片存在 data/uploads/，Markdown 正文只存 ![](/api/uploads/xxx.png) 链接。
// 只备份文档 JSON 的话，换机器恢复后**所有图片都是死链** ——
// 正文还在，图没了。此前 uploads.js 的注释里承认了这一点
// （「需另行拷贝 data/uploads 目录」），但那只是写在代码里的提醒，
// 不是真正的保护。真正的保护是把它纳入备份包。
//
// ── 大文件处理 ──
//
// 资源文件可能是 856MB 的 GLB。必须**流式**写入：
// 内层先用 asset-transfer 的逻辑产出资源 ZIP 的各个条目，
// 外层用 archiver 逐条 pipe，全程不把文件读进内存。
// 不做「先在内存里拼 ZIP 再套一层」—— 那会让峰值内存翻倍。

import archiver from 'archiver';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { basename, join, resolve as resolvePath } from 'node:path';
import { exportSnapshot } from './store.js';
import { buildExportManifest, MANIFEST_NAME, FILES_PREFIX } from './asset-transfer.js';
import { resolveAssetPath } from './asset-storage.js';
import { UPLOAD_DIR } from './uploads.js';

/** 全量备份包格式版本 —— 格式变了靠它区分。 */
export const FULL_BACKUP_VERSION = 1;

/** 包内各部分的文件名。 */
export const FULL_MANIFEST_NAME = 'manifest.json';
export const DOCUMENTS_NAME = 'documents.json';
export const ASSETS_DIR = 'assets/';
export const UPLOADS_DIR = 'uploads/';

/**
 * 列出所有需要备份的资源 id（含回收站里的）。
 *
 * 回收站也要备份 —— 用户「删除」通常只是标记，文件还在。
 * 若这里漏掉回收站，误删的资源就再也找不回来了。
 *
 * @param {import('better-sqlite3').Database} db
 * @returns {number[]}
 */
export function listAllAssetIds(db) {
    return db.prepare('SELECT id FROM assets ORDER BY id ASC').all().map((r) => r.id);
}

/**
 * 列出文档内嵌图片文件。
 *
 * @returns {string[]} 文件名数组（不含路径）
 */
export function listUploadFiles() {
    if (!existsSync(UPLOAD_DIR)) return [];
    try {
        return readdirSync(UPLOAD_DIR).filter((name) => {
            try {
                return statSync(join(UPLOAD_DIR, name)).isFile();
            } catch {
                return false;
            }
        });
    } catch {
        return [];
    }
}

/**
 * 构造全量备份的总清单。
 *
 * @param {object} config
 * @param {import('better-sqlite3').Database} config.connection
 * @returns {{ manifest: object, documents: object, assetManifest: object|null, files: object[], uploads: string[] }}
 */
export function buildFullBackup({ connection: db }) {
    const documents = exportSnapshot({ connection: db });

    const assetIds = listAllAssetIds(db);
    let assetManifest = null;
    let files = [];
    if (assetIds.length > 0) {
        const built = buildExportManifest({ connection: db, assetIds });
        assetManifest = built.manifest;
        files = built.files;
    }

    const uploads = listUploadFiles();

    const manifest = {
        version: FULL_BACKUP_VERSION,
        app: 'team-toolbox',
        kind: 'full-backup',
        exported_at: new Date().toISOString(),
        counts: {
            documents: documents.counts.documents,
            categories: documents.counts.categories,
            tags: documents.counts.tags,
            assets: assetManifest ? assetManifest.assets.length : 0,
            asset_files: files.length,
            uploads: uploads.length
        }
    };

    return { manifest, documents, assetManifest, files, uploads };
}

/**
 * 把全量备份写成 ZIP 流。
 *
 * @param {object} config
 * @param {import('better-sqlite3').Database} config.connection
 * @param {import('express').Response} res 目标响应流
 * @returns {Promise<{ manifest: object, bytes: number }>}
 */
export async function exportFullBackup({ connection: db, res }) {
    const { manifest, documents, assetManifest, files, uploads } = buildFullBackup({ connection: db });

    const archive = archiver('zip', { zlib: { level: 6 } });

    let bytes = 0;
    const done = new Promise((resolvePromise, rejectPromise) => {
        archive.on('error', rejectPromise);
        archive.on('warning', (err) => {
            // ENOENT：文件在导出过程中被删了，跳过即可，不该中断整包
            if (err.code === 'ENOENT') return;
            rejectPromise(err);
        });
        archive.on('end', () => resolvePromise());
        res.on('close', () => {
            // 客户端提前断开（取消下载）：正常结束，不要当作错误
            if (!archive.finalized) archive.abort();
        });
    });

    archive.pipe(res);

    // 总清单
    archive.append(JSON.stringify(manifest, null, 2), { name: FULL_MANIFEST_NAME });

    // 文档快照
    archive.append(JSON.stringify(documents, null, 2), { name: DOCUMENTS_NAME });

    // 文档内嵌图片（data/uploads/）
    // 少了这一段，恢复后正文里的 ![](/api/uploads/xxx.png) 全是死链。
    for (const name of uploads) {
        const abs = join(UPLOAD_DIR, name);
        try {
            const st = statSync(abs);
            bytes += st.size;
            archive.file(abs, { name: `${UPLOADS_DIR}${name}` });
        } catch {
            // 文件在枚举后消失，跳过
        }
    }

    // 资源清单（与资源独立导出保持同一格式）
    if (assetManifest) {
        archive.append(JSON.stringify(assetManifest, null, 2), { name: `${ASSETS_DIR}${MANIFEST_NAME}` });
    }

    // 资源文件：逐个流式添加，不读进内存
    for (const f of files) {
        const abs = resolveAssetPath(f.storageKey);
        if (!abs) continue;   // 文件已不在主存储（如被永久删除），跳过
        try {
            const st = statSync(abs);
            bytes += st.size;
            // 包内路径：assets/files/<assetId>/<versionId>/<kind><ext>
            //
            // 必须**保留** files/ 这一层 —— 恢复侧 importAssets 期望的
            // filesDir 指向 <解压目录>/assets/files，资源清单里的
            // files 字段也是 files/... 开头。去掉前缀会导致
            // 「包结构看着对，但恢复时一个文件都找不到」。
            archive.file(abs, { name: `${ASSETS_DIR}${f.zipPath}` });
        } catch {
            // 文件在枚举后消失，跳过
        }
    }

    await archive.finalize();
    await done;

    return { manifest, bytes };
}
