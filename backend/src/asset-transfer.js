// 资源管理：导入 / 导出。
//
// ── 导出格式 ──
//
// 导出包是一个 ZIP，内含：
//   manifest.json          资源清单（资产、版本、文件夹、标签、预览状态）
//   files/<assetId>/<versionId>/original.<ext>
//   files/<assetId>/<versionId>/preview.<ext>      （若有）
//   files/<assetId>/<versionId>/thumbnail.<ext>    （若有）
//
// 清单里不存绝对路径，只存**包内相对路径** —— 这样包可以随便搬走。
//
// ── 为什么用 ZIP 而不是 JSON ──
//
// 资源是二进制文件（GLB/MP4/纹理），JSON base64 会膨胀 33% 且极慢。
// ZIP 是资源库交换的事实标准，各家 3D 工具链都能认。
//
// ── 大文件处理 ──
//
// 导出：archiver 的流式写入 —— 逐个文件 pipe 进去，边压边写，
//       不会把 856MB 的 GLB 读进内存。这是「批量下载不爆内存」的正确做法。
// 导入：yauzl 逐条解压到临时目录，再入库 —— 同样是流式。
//
// ── 导入时的 ID 映射 ──
//
// 导出的包来自别的库，asset id / folder id 必然与本地冲突。
// 所以导入时**重新分配**所有 id，只保留包内的引用关系：
//   manifest 里的 folderId 指向包内的 parentId 关系 → 重新映射成新 id
//   manifest 里的 assetId 指向包内的版本 → 重新映射成新 id
// 这样同一个包可以重复导入，得到两份独立资源。

import archiver from 'archiver';
import yauzl from 'yauzl';
import { randomBytes } from 'node:crypto';
import {
    createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync,
    readdirSync, statSync, unlinkSync, rmdirSync, renameSync, copyFileSync
} from 'node:fs';
import { join, dirname, sep, resolve as resolvePath, relative, isAbsolute } from 'node:path';
import { errorMap } from './errors.js';
import { resolveAssetPath, classifyAsset } from './asset-storage.js';

const err = (msg, code = 'invalid_input') => errorMap(new Error(msg), '(assets)', code);

/** 清单文件名。 */
export const MANIFEST_NAME = 'manifest.json';
/** 包内文件根目录。 */
export const FILES_PREFIX = 'files/';
/** 清单格式版本 —— 将来格式变了靠它区分。 */
export const MANIFEST_VERSION = 1;

/**
 * 构造导出清单。
 *
 * @param {object} config
 * @param {import('better-sqlite3').Database} config.connection
 * @param {number[]} config.assetIds 要导出的资源 id
 * @param {number[]|null} [config.folderIds] 连带导出的文件夹（用于保留层级）
 * @returns {{ manifest: object, files: object[] }}
 *   files 元素：{ assetId, versionId, kind, storageKey, zipPath }
 */
export function buildExportManifest({ connection: db, assetIds, folderIds = null }) {
    const ids = (assetIds || []).filter((n) => Number.isInteger(Number(n)) && Number(n) > 0).map(Number);
    if (ids.length === 0) throw err('未选择任何资源');

    const assets = [];
    const files = [];
    const tagNames = new Set();

    for (const id of ids) {
        const asset = db.prepare('SELECT * FROM assets WHERE id = ?').get(id);
        if (!asset) continue;

        const versions = db.prepare(
            'SELECT * FROM asset_versions WHERE asset_id = ? ORDER BY version_number ASC'
        ).all(id);

        const tagRows = db.prepare(`
            SELECT t.name FROM asset_tags t
            JOIN asset_tag_links atl ON atl.tag_id = t.id
            WHERE atl.asset_id = ?
        `).all(id);
        for (const t of tagRows) tagNames.add(t.name);

        const assetOut = {
            id: asset.id,
            name: asset.name,
            type: asset.type,
            mimeType: asset.mime_type,
            ext: asset.ext,
            status: asset.status,
            description: asset.description,
            createdBy: asset.created_by,
            createdAt: asset.created_at,
            updatedAt: asset.updated_at,
            folderId: asset.folder_id,
            latestVersionId: asset.latest_version_id,
            publishedVersionId: asset.published_version_id,
            tags: tagRows.map((t) => t.name),
            versions: []
        };

        for (const v of versions) {
            const versionOut = {
                id: v.id,
                versionNumber: v.version_number,
                fileSize: v.file_size,
                sha256: v.sha256,
                mimeType: v.mime_type,
                metadata: safeParse(v.metadata),
                previewStatus: v.preview_status,
                comment: v.comment,
                createdBy: v.created_by,
                createdAt: v.created_at,
                files: {}
            };

            const kinds = [
                ['original', v.original_storage_key],
                ['preview', v.preview_storage_key],
                ['thumbnail', v.thumbnail_storage_key]
            ];
            for (const [kind, storageKey] of kinds) {
                if (!storageKey) continue;
                // 包内路径：files/<assetId>/<versionId>/<kind><ext>
                const ext = extOf(storageKey);
                const zipPath = `${FILES_PREFIX}${asset.id}/${v.id}/${kind}${ext}`;
                versionOut.files[kind] = zipPath;
                files.push({ assetId: asset.id, versionId: v.id, kind, storageKey, zipPath });
            }
            assetOut.versions.push(versionOut);
        }
        assets.push(assetOut);
    }

    // 文件夹：只导出被引用到的（沿 parent 链向上）
    const needed = new Set();
    for (const a of assets) {
        let fid = a.folderId;
        let guard = 0;
        while (fid != null && guard++ < 50) {
            if (needed.has(fid)) break;
            needed.add(fid);
            const row = db.prepare('SELECT id, parent_id FROM asset_folders WHERE id = ?').get(fid);
            if (!row) break;
            fid = row.parent_id;
        }
    }
    const folders = [];
    for (const fid of needed) {
        const f = db.prepare('SELECT id, parent_id, name, created_by, created_at FROM asset_folders WHERE id = ?').get(fid);
        if (f) folders.push(f);
    }

    const manifest = {
        format: 'team-toolbox-assets',
        version: MANIFEST_VERSION,
        exportedAt: new Date().toISOString(),
        folders,
        assets,
        tags: [...tagNames]
    };

    return { manifest, files };
}

function extOf(storageKey) {
    const m = /\.[a-z0-9]{1,10}$/i.exec(String(storageKey || ''));
    return m ? m[0].toLowerCase() : '';
}

function safeParse(json) {
    try {
        const v = JSON.parse(json || '{}');
        return v && typeof v === 'object' ? v : {};
    } catch {
        return {};
    }
}

/**
 * 把导出的流式写入一个 ZIP。
 *
 * 用 archiver 的流式 API：逐个文件 pipe，绝不整体读进内存。
 *
 * @param {object} config
 * @param {import('better-sqlite3').Database} config.connection
 * @param {number[]} config.assetIds
 * @param {import('express').Response} config.res HTTP 响应
 * @returns {Promise<{ assets: number, files: number, bytes: number }>}
 */
export async function exportAssetsToZip({ connection: db, assetIds, res }) {
    const { manifest, files } = buildExportManifest({ connection: db, assetIds });

    res.setHeader('Content-Type', 'application/zip');
    const name = `team-toolbox-assets-${stamp()}.zip`;
    res.setHeader(
        'Content-Disposition',
        `attachment; filename="${name}"; filename*=UTF-8''${encodeURIComponent(name)}`
    );

    const archive = archiver('zip', { zlib: { level: 6 } });

    let bytes = 0;
    const done = new Promise((resolvePromise, rejectPromise) => {
        archive.on('error', rejectPromise);
        archive.on('warning', (err) => {
            // ENOENT 是「文件在导出过程中被删了」，跳过即可，不该中断整包
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

    // 清单先写
    archive.append(JSON.stringify(manifest, null, 2), { name: MANIFEST_NAME });

    // 逐个文件流式添加
    for (const f of files) {
        const abs = resolveAssetPath(f.storageKey);
        if (!abs) continue;   // 文件已不在主存储（如被永久删除），跳过
        try {
            const st = statSync(abs);
            bytes += st.size;
            archive.file(abs, { name: f.zipPath });
        } catch {
            // 文件在枚举后消失，跳过
        }
    }

    await archive.finalize();
    await done;

    return { assets: manifest.assets.length, files: files.length, bytes };
}

/** 时间戳：2026-10-20-15-30-00（便于人工辨认与排序）。 */
function stamp() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
        + `-${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

/**
 * 解压一个 ZIP 到临时目录，返回解压后的目录与清单。
 *
 * 用 yauzl 逐条解压（流式），不做整体读入。
 *
 * @param {string} zipPath ZIP 文件路径
 * @param {string} extractTo 解压目标目录
 * @returns {Promise<{ manifest: object, filesDir: string }>}
 */
export function extractZip(zipPath, extractTo) {
    return new Promise((resolvePromise, rejectPromise) => {
        yauzl.open(zipPath, { lazyEntries: true, autoClose: true }, (openErr, zipfile) => {
            if (openErr) {
                // 注意：回调参数名不能叫 err —— 它会遮蔽外层的 err() 业务错误构造函数，
                // 导致这里变成 "err is not a function"，异常被 Promise 吞成未处理 rejection，
                // 表现为「接口永远不返回、测试挂死」。
                rejectPromise(err('无法打开 ZIP 文件：' + openErr.message));
                return;
            }

            const extracted = [];
            let manifest = null;
            let settled = false;

            const fail = (e) => {
                if (settled) return;
                settled = true;
                try { zipfile.close(); } catch { /* 已关闭 */ }
                rejectPromise(e);
            };

            zipfile.on('error', (e) => fail(err('ZIP 解压失败：' + e.message)));

            zipfile.on('entry', (entry) => {
                // ── 路径穿越防护 ──
                // ZIP 里的路径可能形如 ../../evil.sh。必须解析后确认仍在目标目录内。
                const entryName = entry.fileName.replace(/\\/g, '/');
                const target = resolvePath(join(extractTo, entryName));
                const rel = relative(extractTo, target);
                if (!rel || rel.startsWith('..') || isAbsolute(rel)) {
                    fail(err(`压缩包内含非法路径：${entry.fileName}`));
                    return;
                }

                if (entry.fileName.endsWith('/')) {
                    // 目录项
                    try { mkdirSync(target, { recursive: true }); } catch { /* 忽略 */ }
                    zipfile.readEntry();
                    return;
                }

                zipfile.openReadStream(entry, (e2, readStream) => {
                    if (e2) { fail(err('读取压缩包条目失败：' + e2.message)); return; }
                    try {
                        mkdirSync(dirname(target), { recursive: true });
                        const out = createWriteStream(target);
                        readStream.pipe(out);
                        out.on('close', () => {
                            extracted.push({ name: entryName, path: target, size: entry.uncompressedSize });
                            zipfile.readEntry();
                        });
                        out.on('error', (e3) => fail(err('写入解压文件失败：' + e3.message)));
                    } catch (e4) {
                        fail(err('解压失败：' + e4.message));
                    }
                });
            });

            zipfile.on('end', () => {
                if (settled) return;
                settled = true;
                const manifestPath = join(extractTo, MANIFEST_NAME);
                if (!existsSync(manifestPath)) {
                    rejectPromise(err('压缩包内缺少 manifest.json，不是本工具导出的资源包'));
                    return;
                }
                try {
                    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
                } catch {
                    rejectPromise(err('manifest.json 解析失败'));
                    return;
                }
                if (manifest.format !== 'team-toolbox-assets') {
                    rejectPromise(err('不是本工具导出的资源包'));
                    return;
                }
                resolvePromise({ manifest, filesDir: join(extractTo, FILES_PREFIX) });
            });

            zipfile.readEntry();
        });
    });
}

/**
 * 从解压结果导入资源。
 *
 * ID 全部重新分配：包里的 id 在本地必然冲突。
 * 只保留**引用关系**（folder 父子、asset→version、latest/published 指针）。
 *
 * @param {object} config
 * @param {import('better-sqlite3').Database} config.connection
 * @param {object} config.manifest
 * @param {string} config.filesDir 解压后的 files/ 目录
 * @param {string} config.assetsRoot 落盘的目标根目录（主存储）
 * @returns {{ assets: number, folders: number, versions: number, skipped: number }}
 */
export function importAssets({ connection: db, manifest, filesDir, assetsRoot }) {
    const srcFolders = Array.isArray(manifest.folders) ? manifest.folders : [];
    const srcAssets = Array.isArray(manifest.assets) ? manifest.assets : [];
    if (srcAssets.length === 0) throw err('资源包内没有资源');

    const result = { assets: 0, folders: 0, versions: 0, skipped: 0 };

    const tx = db.transaction(() => {
        // ── 1. 文件夹：按 parent 链深度优先重建，保证父先于子 ──
        const folderMap = new Map();     // 源 id → 新 id
        const byId = new Map(srcFolders.map((f) => [f.id, f]));
        const ordered = [];
        const visit = (f, guard) => {
            if (!f || ordered.includes(f)) return;
            if (guard > 100) return;
            const parent = f.parent_id != null ? byId.get(f.parent_id) : null;
            if (parent) visit(parent, guard + 1);
            ordered.push(f);
        };
        for (const f of srcFolders) visit(f, 0);

        for (const f of ordered) {
            const parentNewId = f.parent_id != null ? (folderMap.get(f.parent_id) ?? null) : null;
            try {
                const info = db.prepare(
                    'INSERT INTO asset_folders (parent_id, name, created_by) VALUES (?, ?, ?)'
                ).run(parentNewId, f.name || '未命名', f.created_by || 'import');
                folderMap.set(f.id, Number(info.lastInsertRowid));
                result.folders++;
            } catch {
                // 同级同名冲突 → 跳过该文件夹（资源仍导入为未分类）
                result.skipped++;
            }
        }

        // ── 2. 资源与版本 ──
        for (const a of srcAssets) {
            const folderNewId = a.folderId != null ? (folderMap.get(a.folderId) ?? null) : null;

            // 资产 id 映射：源版本 id → 新版本 id
            const versionMap = new Map();

            // 先建资产行（版本指针稍后回填）
            const info = db.prepare(`
                INSERT INTO assets (name, folder_id, type, mime_type, ext, status, description, created_by)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                a.name || '未命名',
                folderNewId,
                a.type || 'other',
                a.mimeType || 'application/octet-stream',
                a.ext || '',
                a.status || 'draft',
                a.description || '',
                a.createdBy || 'import'
            );
            const newAssetId = Number(info.lastInsertRowid);
            result.assets++;

            // 版本：逐个复制文件
            let latestNew = null;
            let publishedNew = null;
            const srcVersions = Array.isArray(a.versions) ? a.versions : [];

            for (const v of srcVersions) {
                const originalRel = v.files && v.files.original;
                if (!originalRel) { result.skipped++; continue; }

                const srcFile = join(filesDir, originalRel.replace(/^files\//, ''));
                if (!existsSync(srcFile)) { result.skipped++; continue; }

                // ── 落盘 + 入库顺序 ──
                // 目录结构必须与主存储一致：<assetId>/<versionId>/<file>。
                // 而 versionId 是**自增主键**，插入前拿不到 —— 所以必须
                // 「先插版本行拿 id → 再按 id 建目录落盘 → 回填 storage_key」。
                // 若图省事用 versionNumber 当目录层，存储键就与 resolveAssetPath
                // 的白名单不匹配，表现为「导入成功但文件下载 404」。
                const vInfo = db.prepare(`
                    INSERT INTO asset_versions
                        (asset_id, version_number, original_storage_key, file_size, sha256,
                         mime_type, metadata, preview_status, comment, created_by)
                    VALUES (?, ?, '', ?, ?, ?, ?, ?, ?, ?)
                `).run(
                    newAssetId,
                    v.versionNumber || 1,
                    v.fileSize || 0,
                    v.sha256 || null,
                    v.mimeType || 'application/octet-stream',
                    JSON.stringify(v.metadata || {}),
                    v.previewStatus || 'none',
                    v.comment || '',
                    v.createdBy || 'import'
                );
                const newVersionId = Number(vInfo.lastInsertRowid);

                const versionDir = join(assetsRoot, String(newAssetId), String(newVersionId));
                try { mkdirSync(versionDir, { recursive: true }); } catch { /* 忽略 */ }

                const ext = extOf(originalRel) || '.bin';
                // 文件名必须与 asset-storage.js 生成的一致：
                // <kind><13~16位时间戳>-<恰好16位hex><ext>。
                // 用 randomBytes 而不是 Math.random().toString(16) ——
                // 后者长度不固定（可能只有 11~13 位），会被 resolveAssetPath
                // 的白名单正则拒绝，表现为「文件在磁盘上但下载 404」。
                const fileName = `original${Date.now()}-${randomBytes(8).toString('hex')}${ext}`;
                const destPath = join(versionDir, fileName);
                try {
                    // copyFileSync 是内核级流式复制，不会把整个文件读进 JS 堆 ——
                    // 856MB 的 GLB 也不会炸内存。
                    copyFileSync(srcFile, destPath);
                } catch {
                    // 拷贝失败 → 删掉刚建的版本行，不留「有版本无文件」的幽灵数据
                    db.prepare('DELETE FROM asset_versions WHERE id = ?').run(newVersionId);
                    result.skipped++;
                    continue;
                }
                const storageKey = `${newAssetId}/${newVersionId}/${fileName}`;

                // preview / thumbnail 若包内有也一并落盘
                const extraKeys = {};
                for (const kind of ['preview', 'thumbnail']) {
                    const rel = v.files && v.files[kind];
                    if (!rel) continue;
                    const srcExtra = join(filesDir, rel.replace(/^files\//, ''));
                    if (!existsSync(srcExtra)) continue;
                    try {
                        const eExt = extOf(rel) || '.bin';
                        const eName = `${kind}${Date.now()}-${randomBytes(8).toString('hex')}${eExt}`;
                        copyFileSync(srcExtra, join(versionDir, eName));
                        extraKeys[kind] = `${newAssetId}/${newVersionId}/${eName}`;
                    } catch { /* 派生文件缺失不影响导入 */ }
                }

                // 回填真实存储键
                db.prepare(`
                    UPDATE asset_versions
                    SET original_storage_key = ?, preview_storage_key = ?, thumbnail_storage_key = ?,
                        preview_status = ?
                    WHERE id = ?
                `).run(
                    storageKey,
                    extraKeys.preview || null,
                    extraKeys.thumbnail || null,
                    extraKeys.preview ? 'ready' : (v.previewStatus || 'none'),
                    newVersionId
                );
                result.versions++;
                versionMap.set(v.id, newVersionId);

                // 记录 latest / published 指向哪个**源**版本
                if (a.latestVersionId === v.id) latestNew = newVersionId;
                if (a.publishedVersionId === v.id) publishedNew = newVersionId;
            }

            // 回填指针
            db.prepare(`
                UPDATE assets SET latest_version_id = ?, published_version_id = ? WHERE id = ?
            `).run(latestNew, publishedNew, newAssetId);

            // 标签
            for (const tagName of (a.tags || [])) {
                const clean = String(tagName).trim();
                if (!clean) continue;
                let row = db.prepare('SELECT id FROM asset_tags WHERE name = ?').get(clean);
                if (!row) {
                    const ti = db.prepare('INSERT INTO asset_tags (name) VALUES (?)').run(clean);
                    row = { id: Number(ti.lastInsertRowid) };
                }
                db.prepare('INSERT OR IGNORE INTO asset_tag_links (asset_id, tag_id) VALUES (?, ?)')
                    .run(newAssetId, row.id);
            }

            db.prepare(
                'INSERT INTO asset_operation_logs (asset_id, action, detail, operator) VALUES (?, ?, ?, ?)'
            ).run(newAssetId, 'import', `导入资源「${a.name || '未命名'}」`, 'import');
        }
    });

    tx();
    return result;
}
