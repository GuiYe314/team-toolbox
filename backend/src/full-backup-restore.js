// 全量备份的恢复：把 ZIP 拆回文档与资源两部分，分别交给既有的导入逻辑。
//
// ── 为什么不复用 asset-transfer 的 extractZip ──
//
// extractZip 硬编码了三处假设，都不适用于全量备份包：
//   1. manifest.json 必须在**根目录**
//   2. manifest.format 必须是 'team-toolbox-assets'
//   3. 返回的 filesDir 固定指向 <解压目录>/files
//
// 全量备份包里资源清单在 assets/manifest.json，资源文件在 assets/files/。
// 所以这里自己解压，再把 assets/ 子树**挪**成 importAssets 期望的形状，
// 让它零改动可用 —— 不为统一备份重写一套资源解析。
//
// ── 恢复语义 ──
//
// 与既有的两个导入接口一致，都是**合并模式**：
//   - 文档：同级同标题视为已存在并跳过
//   - 资源：重新分配全部 id，同名文件夹跳过
// 不会删除既有数据。误操作可再导一次，不会丢东西。

import { createWriteStream, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import yauzl from 'yauzl';
import { errorMap } from './errors.js';
import { importSnapshot } from './store.js';
import { importAssets } from './asset-transfer.js';
import { ASSETS_DIR, DOCUMENTS_NAME, FULL_MANIFEST_NAME, UPLOADS_DIR } from './full-backup.js';
import { UPLOAD_DIR } from './uploads.js';

const err = (msg, code = 'invalid_input') => errorMap(new Error(msg), '(backup)', code);

/**
 * 解压全量备份包到指定目录。
 *
 * @param {string} zipPath
 * @param {string} extractTo
 * @returns {Promise<{ manifest: object, documents: object|null, assetManifest: object|null, extractedDir: string }>}
 */
export function extractFullBackup(zipPath, extractTo) {
    return new Promise((resolvePromise, rejectPromise) => {
        yauzl.open(zipPath, { lazyEntries: true, autoClose: true }, (openErr, zipfile) => {
            if (openErr) {
                rejectPromise(err('无法打开备份包：' + openErr.message));
                return;
            }

            const extracted = [];
            let settled = false;

            const fail = (e) => {
                if (settled) return;
                settled = true;
                rejectPromise(e);
            };

            zipfile.on('entry', (entry) => {
                const entryName = entry.fileName;
                // 防目录穿越：拒绝含 .. 或绝对路径的条目
                if (entryName.includes('..') || entryName.startsWith('/') || /^[A-Za-z]:/.test(entryName)) {
                    fail(err('备份包含非法路径条目，已中止：' + entryName));
                    return;
                }
                // 目录条目直接跳过（yauzl 会单独给出目录项）
                if (entryName.endsWith('/')) {
                    zipfile.readEntry();
                    return;
                }

                const target = join(extractTo, entryName);
                zipfile.openReadStream(entry, (e2, readStream) => {
                    if (e2) { fail(err('读取条目失败：' + e2.message)); return; }
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
                try {
                    const manifestPath = join(extractTo, FULL_MANIFEST_NAME);
                    if (!existsSync(manifestPath)) {
                        rejectPromise(err('备份包内缺少 manifest.json，不是本工具导出的全量备份'));
                        return;
                    }
                    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
                    if (manifest.kind !== 'full-backup') {
                        rejectPromise(err('不是本工具导出的全量备份包'));
                        return;
                    }

                    // 文档快照（可选 —— 允许只备份资源的包）
                    let documents = null;
                    const docsPath = join(extractTo, DOCUMENTS_NAME);
                    if (existsSync(docsPath)) {
                        documents = JSON.parse(readFileSync(docsPath, 'utf8'));
                    }

                    // 资源清单（可选）
                    let assetManifest = null;
                    const assetManifestPath = join(extractTo, ASSETS_DIR, 'manifest.json');
                    if (existsSync(assetManifestPath)) {
                        assetManifest = JSON.parse(readFileSync(assetManifestPath, 'utf8'));
                    }

                    resolvePromise({ manifest, documents, assetManifest, extractedDir: extractTo });
                } catch (e) {
                    rejectPromise(err('备份包解析失败：' + (e && e.message)));
                }
            });

            zipfile.readEntry();
        });
    });
}

/**
 * 恢复全量备份。
 *
 * @param {object} config
 * @param {import('better-sqlite3').Database} config.connection
 * @param {string} config.extractTo 已解压的目录
 * @param {object} config.extracted - extractFullBackup 的结果
 * @param {string} config.assetsRoot 资源落盘根目录（主存储）
 * @returns {{ documents: object|null, assets: object|null, uploads: number }}
 */
export function restoreFullBackup({ connection: db, extractTo, extracted, assetsRoot }) {
    const result = { documents: null, assets: null, uploads: 0 };

    // ── 1. 文档 ──
    if (extracted.documents) {
        result.documents = importSnapshot({ connection: db, snapshot: extracted.documents });
    }

    // ── 2. 文档内嵌图片 ──
    // 恢复到 UPLOAD_DIR。**不覆盖**已存在的同名文件 ——
    // 文件名带时间戳与随机串，撞名几乎不可能；真撞了保留本地那份更安全。
    const uploadsSrc = join(extractTo, UPLOADS_DIR);
    if (existsSync(uploadsSrc)) {
        mkdirSync(UPLOAD_DIR, { recursive: true });
        for (const name of readdirSync(uploadsSrc)) {
            const src = join(uploadsSrc, name);
            const dst = join(UPLOAD_DIR, name);
            if (existsSync(dst)) continue;
            try {
                copyFileSync(src, dst);
                result.uploads++;
            } catch {
                // 单个文件失败不该中断整包恢复
            }
        }
    }

    // ── 3. 资源 ──
    // importAssets 期望 filesDir 指向「含 <assetId>/<versionId>/<kind><ext> 的目录」，
    // 而全量包里是 assets/files/<assetId>/... —— 正好对得上，无需挪动。
    if (extracted.assetManifest) {
        const filesDir = join(extractTo, ASSETS_DIR, 'files');
        result.assets = importAssets({
            connection: db,
            manifest: extracted.assetManifest,
            filesDir,
            assetsRoot
        });
    }

    return result;
}

/**
 * 把上传的备份包写到临时文件。
 *
 * @param {Buffer} buffer
 * @param {string} tmpDir
 * @returns {string} zip 文件路径
 */
export function writeBackupBuffer(buffer, tmpDir) {
    const zipPath = join(tmpDir, 'full-backup.zip');
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(zipPath, buffer);
    return zipPath;
}

/**
 * 清理临时目录（导入的大文件不该留在临时区）。
 *
 * @param {string} dir
 */
export function cleanupBackupTemp(dir) {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* 忽略 */ }
}
