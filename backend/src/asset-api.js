// 资源管理：HTTP 接口层。
//
// 与 api.js 的关系：风格完全对齐（同款 wrap/wrapAsync/sendError、同款响应体约定），
// 但**独立注册**为另一个路由组，挂在 /api/assets 与 /api/asset-folders 下。
// 不混进 api.js 的原因：资源管理是独立子系统，路由数量已超 30 条，
// 混在一起会让两个子系统互相干扰，也让将来整体下线资源模块变得困难。
//
// 统一响应体（与 api.js 一致）：
//   成功：{ ...data }
//   失败：{ error: <code>, message: <string>, current?, detail? }
//
// 错误码复用 api.js 的映射表：invalid_input→400 / not_found→404 /
// conflict|constraint_failed→409 / 其他→500。

import express from 'express';
import { createReadStream, statSync, unlinkSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve as resolvePath } from 'node:path';
import * as store from './asset-store.js';
import * as collections from './asset-collection-store.js';
import {
    saveAssetFile, saveDerivedFile, deleteAssetFile,
    deleteVersionDir, deleteAssetDir, resolveAssetPath, assetMimeOf, classifyAsset,
    isViewableType, assetDiskUsage, MAX_ASSET_BYTES,
    stageAssetFileCopy, commitStagedAssetFile, ASSET_DIR
} from './asset-storage.js';
import { parseUploadWithFields } from './asset-upload-parser.js';
import {
    getMirrorPath, setMirrorPath, mirrorAll, mirrorStats, clearMirror, normalizeMirrorPath,
    mirrorVersion
} from './asset-mirror.js';
import { exportAssetsToZip, extractZip, importAssets } from './asset-transfer.js';
import { generatePreview, listProcessors } from './asset-preview.js';
import { sendError } from './api.js';

/** 解析正整数 ID；非法返回 null。 */
function parseId(value) {
    const id = Number(value);
    return Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * 把一个版本同步到镜像目录（用户设置的保存路径）。
 *
 * 未配置镜像时直接返回；拷贝失败只记日志不抛错 ——
 * 外部盘掉线不应让上传失败（主存储才是权威副本）。
 *
 * @param {import('better-sqlite3').Database} db
 * @param {number} assetId
 * @param {number} versionId
 */
function syncToMirror(db, assetId, versionId) {
    try {
        const root = getMirrorPath(db);
        if (!root) return;
        const v = db.prepare(
            'SELECT * FROM asset_versions WHERE id = ? AND asset_id = ?'
        ).get(versionId, assetId);
        if (!v) return;
        const r = mirrorVersion(root, assetId, versionId, v);
        if (r.failed > 0) {
            console.warn(`[assets] 镜像同步部分失败：asset=${assetId} version=${versionId} failed=${r.failed}`);
        }
    } catch (e) {
        // 失败必须留下痕迹：吞掉异常会让「同步其实一直没生效」这种问题
        // 极难排查（曾经就因为漏 import 导致同步静默失效）。
        console.warn('[assets] 镜像同步异常（不影响上传）:', e && e.message);
        try {
            db.prepare(
                'INSERT INTO asset_operation_logs (asset_id, version_id, action, detail, operator) VALUES (?, ?, ?, ?, ?)'
            ).run(assetId, versionId, 'mirror_failed',
                `镜像同步失败：${(e && e.message) || '未知原因'}`, 'system');
        } catch { /* 日志写不进去就算了 */ }
    }
}

/**
 * 触发预览生成（异步，不阻塞上传响应）。
 *
 * 为什么异步：预览生成涉及图片解码 / 模型解析，856MB 的 GLB
 * 可能要几秒。上传接口必须立刻返回，否则用户会以为卡死了。
 *
 * 状态机（对应用户需求的 previewStatus）：
 *   pending → processing → ready / failed
 * 上传落盘后先置 pending，后台处理完再改终态。
 * 前端据此显示「正在生成预览 / 预览已完成 / 预览生成失败」。
 *
 * 失败**不影响原件**：原文件与元数据完好，只是没有预览图。
 *
 * @param {import('better-sqlite3').Database} db
 * @param {number} assetId
 * @param {number} versionId
 * @param {string} [ext] 扩展名（不传则从存储键推断）
 */
function schedulePreview(db, assetId, versionId, ext) {
    const v = db.prepare(
        'SELECT original_storage_key FROM asset_versions WHERE id = ? AND asset_id = ?'
    ).get(versionId, assetId);
    if (!v || !v.original_storage_key) return;

    db.prepare(
        "UPDATE asset_versions SET preview_status = 'pending' WHERE id = ? AND asset_id = ?"
    ).run(versionId, assetId);

    // 故意不 await —— 队列化处理，上传立即返回
    (async () => {
        try {
            db.prepare(
                "UPDATE asset_versions SET preview_status = 'processing' WHERE id = ? AND asset_id = ?"
            ).run(versionId, assetId);

            const r = await generatePreview({
                assetId,
                versionId,
                originalStorageKey: v.original_storage_key,
                ext
            });

            if (r.status === 'ready') {
                db.prepare(`
                    UPDATE asset_versions
                    SET preview_storage_key = ?,
                        thumbnail_storage_key = ?,
                        metadata = ?,
                        preview_status = 'ready',
                        preview_error = NULL
                    WHERE id = ? AND asset_id = ?
                `).run(
                    r.previewKey || null,
                    r.thumbnailKey || null,
                    JSON.stringify(r.metadata || {}),
                    versionId, assetId
                );
            } else if (r.status === 'failed') {
                db.prepare(`
                    UPDATE asset_versions
                    SET preview_status = 'failed', preview_error = ?
                    WHERE id = ? AND asset_id = ?
                `).run(r.error || '预览生成失败', versionId, assetId);
                try {
                    db.prepare(
                        'INSERT INTO asset_operation_logs (asset_id, version_id, action, detail, operator) VALUES (?, ?, ?, ?, ?)'
                    ).run(assetId, versionId, 'preview_failed',
                        `预览生成失败：${r.error || '未知原因'}`, 'system');
                } catch { /* 日志写不进去就算了 */ }
            } else {
                // none：该类型本来就不做预览，属正常
                db.prepare(
                    "UPDATE asset_versions SET preview_status = 'none' WHERE id = ? AND asset_id = ?"
                ).run(versionId, assetId);
            }
        } catch (e) {
            // 兜底：管线本身抛错也不能让状态卡在 processing
            try {
                db.prepare(
                    "UPDATE asset_versions SET preview_status = 'failed', preview_error = ? WHERE id = ? AND asset_id = ?"
                ).run((e && e.message) || '预览管线异常', versionId, assetId);
            } catch { /* 忽略 */ }
            console.warn('[assets] 预览生成异常（不影响上传）:', e && e.message);
        }
    })();
}

function clampInt(value, def, min, max) {
    const n = Number(value);
    if (!Number.isInteger(n)) return def;
    return Math.min(max, Math.max(min, n));
}

/**
 * 注册资源管理路由。
 * @param {import('express').Application} app
 * @param {{ getDb: () => import('better-sqlite3').Database, basePath?: string }} config
 */
export function registerAssetApi(app, { getDb, basePath = '/api' }) {
    const router = express.Router();

    const wrap = (fn) => (req, res) => {
        try { fn(req, res); } catch (err) { sendError(res, err); }
    };
    const wrapAsync = (fn) => (req, res) => {
        Promise.resolve(fn(req, res)).catch((err) => sendError(res, err));
    };

    // ══════════════════════════════════════════════════════════════
    // 文件夹
    // ══════════════════════════════════════════════════════════════

    router.get('/asset-folders', wrap((_req, res) => {
        res.json({ items: store.listFolders({ connection: getDb() }) });
    }));

    router.post('/asset-folders', wrap((req, res) => {
        const { name, parentId } = req.body || {};
        res.status(201).json(store.createFolder({
            connection: getDb(),
            name,
            parentId: parentId === undefined ? null : parentId
        }));
    }));

    router.put('/asset-folders/:id', wrap((req, res) => {
        const id = parseId(req.params.id);
        if (id === null) return res.status(400).json({ error: 'invalid_input', message: '文件夹 ID 无效' });
        const { name, parentId } = req.body || {};
        // 同时带 name 与 parentId 时走移动（两者语义不同，分开处理避免歧义）
        if (parentId !== undefined && name === undefined) {
            return res.json(store.moveFolder({
                connection: getDb(), id, parentId: parentId === null ? null : parseId(parentId)
            }));
        }
        res.json(store.renameFolder({ connection: getDb(), id, name }));
    }));

    router.delete('/asset-folders/:id', wrap((req, res) => {
        const id = parseId(req.params.id);
        if (id === null) return res.status(400).json({ error: 'invalid_input', message: '文件夹 ID 无效' });
        res.json(store.deleteFolder({ connection: getDb(), id }));
    }));

    // ══════════════════════════════════════════════════════════════
    // 集合（Packs）—— 跨目录的资源编组
    //
    // 与文件夹的区别：文件夹是一棵树（一个资源只能待在一个位置），
    // 集合是多对多（一个资源可属多个集合），回答「这次要交付哪些」。
    // ══════════════════════════════════════════════════════════════

    router.get('/collections', wrap((_req, res) => {
        res.json({ items: collections.listCollections({ connection: getDb() }) });
    }));

    router.post('/collections', wrap((req, res) => {
        const { name, description } = req.body || {};
        res.status(201).json(collections.createCollection({
            connection: getDb(), name, description
        }));
    }));

    router.get('/collections/:id', wrap((req, res) => {
        const id = parseId(req.params.id);
        if (id === null) return res.status(400).json({ error: 'invalid_input', message: '集合 ID 无效' });
        const r = collections.getCollection({ connection: getDb(), id });
        if (!r.collection) return res.status(404).json({ error: 'not_found', message: '集合不存在' });
        res.json(r);
    }));

    router.put('/collections/:id', wrap((req, res) => {
        const id = parseId(req.params.id);
        if (id === null) return res.status(400).json({ error: 'invalid_input', message: '集合 ID 无效' });
        const { name, description } = req.body || {};
        res.json(collections.updateCollection({ connection: getDb(), id, name, description }));
    }));

    /**
     * 删除集合。
     * **只删集合本身，不删资源** —— 集合是视图不是容器，
     * 删掉「展会包」不该让包里的模型跟着消失。前端必须说清这点。
     */
    router.delete('/collections/:id', wrap((req, res) => {
        const id = parseId(req.params.id);
        if (id === null) return res.status(400).json({ error: 'invalid_input', message: '集合 ID 无效' });
        res.json(collections.deleteCollection({ connection: getDb(), id }));
    }));

    router.post('/collections/:id/items', wrap((req, res) => {
        const id = parseId(req.params.id);
        if (id === null) return res.status(400).json({ error: 'invalid_input', message: '集合 ID 无效' });
        const { assetIds } = req.body || {};
        res.json(collections.addAssetsToCollection({ connection: getDb(), collectionId: id, assetIds }));
    }));

    router.delete('/collections/:id/items', wrap((req, res) => {
        const id = parseId(req.params.id);
        if (id === null) return res.status(400).json({ error: 'invalid_input', message: '集合 ID 无效' });
        const { assetIds } = req.body || {};
        res.json(collections.removeAssetsFromCollection({ connection: getDb(), collectionId: id, assetIds }));
    }));

    /** 反向查询：某个资源属于哪些集合（资源详情页显示「它还在哪些包里」）。 */
    router.get('/assets/:id/collections', wrap((req, res) => {
        const id = parseId(req.params.id);
        if (id === null) return res.status(400).json({ error: 'invalid_input', message: '资源 ID 无效' });
        res.json({ items: collections.listCollectionsOfAsset({ connection: getDb(), assetId: id }) });
    }));

    // ══════════════════════════════════════════════════════════════
    // 资产读取
    // ══════════════════════════════════════════════════════════════

    router.get('/assets', wrap((req, res) => {
        const q = req.query;
        // folderId 三态必须区分「未传」与「显式传 null」：
        //   未传 → 不限文件夹；null / 'root' → 未分类。
        // 用 hasOwnProperty 判断，不能只看 undefined（?folderId= 会变成空串）。
        let folderId;
        if (Object.prototype.hasOwnProperty.call(q, 'folderId')) {
            const raw = q.folderId;
            folderId = (raw === 'null' || raw === '' || raw === 'root') ? 'root' : raw;
        }

        res.json(store.listAssets({
            connection: getDb(),
            filter: {
                folderId,
                search: typeof q.search === 'string' ? q.search : undefined,
                type: typeof q.type === 'string' ? q.type : undefined,
                status: typeof q.status === 'string' ? q.status : undefined,
                scope: typeof q.scope === 'string' ? q.scope : 'all',
                page: clampInt(q.page, 1, 1, 100000),
                pageSize: clampInt(q.pageSize, 50, 1, 200),
                sort: typeof q.sort === 'string' ? q.sort : 'updated_at',
                order: typeof q.order === 'string' ? q.order : 'desc'
            }
        }));
    }));

    router.get('/assets/stats', wrap((_req, res) => {
        const db = getDb();
        res.json({
            ...store.assetStats({ connection: db }),
            breakdown: store.assetTypeBreakdown({ connection: db })
        });
    }));

    router.get('/assets/:id', wrap((req, res) => {
        const id = parseId(req.params.id);
        if (id === null) return res.status(400).json({ error: 'invalid_input', message: '资源 ID 无效' });
        const db = getDb();
        const asset = store.getAsset({ connection: db, id });
        const versions = store.listVersions({ connection: db, assetId: id });
        // 能否预览以「资产类型」为准：资源可被重命名，
        // 名字里的扩展名可能已与真实格式不符（如 .txt 改名成 .glb），
        // 类型来自上传时按扩展名判定并落库，更可靠。
        res.json({
            ...asset,
            versions,
            logs: store.listOperationLogs({ connection: db, assetId: id }),
            disk: assetDiskUsage(id),
            viewable: isViewableType(asset.type)
        });
    }));

    router.get('/assets/:id/versions', wrap((req, res) => {
        const id = parseId(req.params.id);
        if (id === null) return res.status(400).json({ error: 'invalid_input', message: '资源 ID 无效' });
        res.json({ items: store.listVersions({ connection: getDb(), assetId: id }) });
    }));

    router.get('/assets/:id/logs', wrap((req, res) => {
        const id = parseId(req.params.id);
        if (id === null) return res.status(400).json({ error: 'invalid_input', message: '资源 ID 无效' });
        res.json({
            items: store.listOperationLogs({
                connection: getDb(), assetId: id, limit: clampInt(req.query.limit, 50, 1, 200)
            })
        });
    }));

    // ══════════════════════════════════════════════════════════════
    // 资产写入
    // ══════════════════════════════════════════════════════════════

    /**
     * 上传（新资源或追加版本）。
     *
     * multipart 字段：
     *   file        必填，文件本体
     *   folderId    可选，目标文件夹
     *   tags        可选，逗号分隔
     *   description 可选，描述
     *   comment     可选，版本说明
     *   assetId     可选。传入则**追加版本**；不传则新建资源。
     *
     * 「同名文件」的处理交给前端：前端先查目标文件夹是否已有同名资源，
     * 有则弹窗让用户选「作为新版本上传 / 创建新资源 / 取消」，
     * 选前者时带上既有 assetId 走追加版本分支。这样决策在 UI 层、后端保持单一职责。
     */
    router.post('/assets/upload', wrapAsync(async (req, res) => {
        const db = getDb();

        // 同时取文件与表单字段（folderId / tags / description / comment / assetId）
        const uploaded = await parseUploadWithFields(req, MAX_ASSET_BYTES);
        if (!uploaded || !uploaded.buffer) {
            return res.status(400).json({ error: 'invalid_input', message: '缺少上传文件' });
        }

        // 表单字段以 busboy 收到的为准；query 作为兜底（便于 curl 调试与强制参数）
        const field = (name) => {
            const fromBody = uploaded.fields[name];
            if (typeof fromBody === 'string') return fromBody;
            const v = req.query[name];
            return typeof v === 'string' ? v : undefined;
        };

        const assetIdRaw = field('assetId');
        const existingId = assetIdRaw ? parseId(assetIdRaw) : null;
        const tags = (field('tags') || '').split(',').map((s) => s.trim()).filter(Boolean);
        const comment = field('comment') || '';
        const description = field('description') || '';
        const folderRaw = field('folderId');
        const folderId = folderRaw ? parseId(folderRaw) : null;

        // ── 分支A：追加版本到既有资源 ──
        if (existingId !== null) {
            const asset = store.getAsset({ connection: db, id: existingId });

            // 需要先知道新版本的 id 才能定存储目录，故先建元数据行再落盘。
            // 这里反过来：先落盘到临时位置不可行（目录依赖 versionId），
            // 改为「事务内先插行拿 id → 落盘 → 事务外回填 storage_key」。
            // 若落盘失败，需把刚插的行删掉，避免留下无文件的幽灵版本。
            let versionId;
            const tx = db.transaction(() => {
                const maxRow = db.prepare(
                    'SELECT MAX(version_number) n FROM asset_versions WHERE asset_id = ?'
                ).get(existingId);
                const next = (maxRow.n || 0) + 1;
                const info = db.prepare(`
                    INSERT INTO asset_versions
                        (asset_id, version_number, original_storage_key, file_size, sha256,
                         mime_type, preview_status, comment, created_by)
                    VALUES (?, ?, '', 0, NULL, ?, 'pending', ?, 'local')
                `).run(existingId, next, uploaded.buffer && classifyAsset(uploaded.filename).mime, comment);
                versionId = Number(info.lastInsertRowid);
            });
            tx();

            let saved;
            try {
                saved = saveAssetFile({
                    connection: db, assetId: existingId, versionId,
                    buffer: uploaded.buffer, originalName: uploaded.filename
                });
            } catch (e) {
                // 落盘失败 → 回滚刚插入的行，不能留幽灵版本
                db.prepare('DELETE FROM asset_versions WHERE id = ?').run(versionId);
                throw e;
            }

            // 回填真实文件信息
            db.prepare(`
                UPDATE asset_versions
                SET original_storage_key = ?, file_size = ?, sha256 = ?, mime_type = ?
                WHERE id = ?
            `).run(saved.storageKey, saved.size, saved.sha256, saved.mime, versionId);

            // 镜像同步：新版本也要进外部保存路径
            syncToMirror(db, existingId, versionId);
            // 预览生成：后台异步，不阻塞响应
            schedulePreview(db, existingId, versionId, classifyAsset(uploaded.filename).ext);

            db.prepare(`
                UPDATE assets
                SET latest_version_id = ?,
                    status = CASE WHEN status = 'deprecated' THEN 'draft' ELSE status END,
                    updated_at = datetime('now')
                WHERE id = ?
            `).run(versionId, existingId);

            const vrow = db.prepare('SELECT version_number FROM asset_versions WHERE id = ?').get(versionId);
            // 两条日志：上传动作 + 版本创建。放在回填之后，
            // 才能在 detail 里写出真实的版本号（建行阶段还拿不到）
            db.prepare(`
                INSERT INTO asset_operation_logs (asset_id, version_id, action, detail, operator)
                VALUES (?, ?, 'upload', ?, 'local')
            `).run(existingId, versionId, `上传新版本 v${vrow.version_number}`);
            db.prepare(`
                INSERT INTO asset_operation_logs (asset_id, version_id, action, detail, operator)
                VALUES (?, ?, 'create_version', ?, 'local')
            `).run(existingId, versionId, `v${vrow.version_number}`);

            const result = store.getAsset({ connection: db, id: existingId });
            return res.status(201).json({
                ...result,
                versionId,
                versionNumber: vrow.version_number,
                /** 上传成功但未发布 —— Unity 侧仍用旧的 published 版本 */
                publishedVersionId: result.publishedVersionId,
                hasUnpublished: result.hasUnpublished
            });
        }

        // ── 分支B：新建资源 ──
        if (folderId !== null) {
            const f = db.prepare('SELECT id FROM asset_folders WHERE id = ?').get(folderId);
            if (!f) {
                return res.status(400).json({ error: 'invalid_input', message: '目标文件夹不存在' });
            }
        }

        const name = (uploaded.filename || '').replace(/[\\/]/g, '_');
        if (!name) return res.status(400).json({ error: 'invalid_input', message: '缺少文件名' });

        // 同名检查：同文件夹下已存在同名未删除资源时，提示前端走「作为新版本」流程。
        // folderId 为 null 时只匹配「未分类」的资产 —— 不能写成
        //   folder_id IS NULL OR folder_id = NULL
        // 后者第二支恒为假，虽不出错但语义含混；这里显式分两支。
        const dup = folderId === null
            ? db.prepare(`
                SELECT id FROM assets
                WHERE LOWER(name) = LOWER(?) AND is_deleted = 0 AND folder_id IS NULL
                LIMIT 1
            `).get(name)
            : db.prepare(`
                SELECT id FROM assets
                WHERE LOWER(name) = LOWER(?) AND is_deleted = 0 AND folder_id = ?
                LIMIT 1
            `).get(name, folderId);
        if (dup && req.query.force !== '1') {
            return res.status(409).json({
                error: 'conflict',
                message: `当前文件夹已存在同名资源「${name}」`,
                existingAssetId: dup.id,
                /** 前端据此弹窗：作为新版本上传 / 创建新资源 / 取消 */
                resolutionRequired: true
            });
        }

        // 先建资产+版本行拿 id，再落盘回填；失败回滚
        const created = db.transaction(() => store.createAsset({
            connection: db,
            input: {
                name,
                folderId,
                type: classifyAsset(name).type,
                mimeType: classifyAsset(name).mime,
                ext: classifyAsset(name).ext,
                fileSize: 0,
                originalStorageKey: 'pending',
                comment,
                description
            },
            tags
        }))();

        let saved;
        try {
            saved = saveAssetFile({
                connection: db, assetId: created.assetId, versionId: created.versionId,
                buffer: uploaded.buffer, originalName: uploaded.filename
            });
        } catch (e) {
            db.prepare('DELETE FROM assets WHERE id = ?').run(created.assetId);
            throw e;
        }

        db.prepare(`
            UPDATE asset_versions
            SET original_storage_key = ?, file_size = ?, sha256 = ?, mime_type = ?
            WHERE id = ?
        `).run(saved.storageKey, saved.size, saved.sha256, saved.mime, created.versionId);

        // 镜像：设置过保存路径后，新资源自动拷贝到该目录。
        // 失败不影响主流程 —— 外部盘不可用时主存储照常工作。
        syncToMirror(db, created.assetId, created.versionId);
        // 预览生成：后台异步，不阻塞响应
        schedulePreview(db, created.assetId, created.versionId, classifyAsset(uploaded.filename).ext);

        // 删掉建行时的占位上传日志，重写成带真实信息的
        db.prepare(`DELETE FROM asset_operation_logs WHERE asset_id = ? AND action = 'upload'`).run(created.assetId);
        db.prepare(`
            INSERT INTO asset_operation_logs (asset_id, version_id, action, detail, operator)
            VALUES (?, ?, 'upload', ?, 'local')
        `).run(created.assetId, created.versionId, `创建资源 ${name} v1`);

        res.status(201).json({
            ...store.getAsset({ connection: db, id: created.assetId }),
            versionId: created.versionId,
            versionNumber: 1
        });
    }));

    /**
     * 重新生成某个版本的预览与缩略图。
     *
     * 用途：预览失败（例如服务器后来装上了 ffmpeg）后可以重试，
     * 不必重新上传原始文件。
     * 同步执行并返回结果 —— 这是用户主动触发的动作，需要立刻知道成败。
     */
    router.post('/assets/:id/versions/:versionId/preview', wrapAsync(async (req, res) => {
        const assetId = parseId(req.params.id);
        const versionId = parseId(req.params.versionId);
        if (assetId === null || versionId === null) {
            return res.status(400).json({ error: 'invalid_input', message: 'ID 无效' });
        }
        const db = getDb();
        const v = db.prepare(
            'SELECT original_storage_key FROM asset_versions WHERE id = ? AND asset_id = ?'
        ).get(versionId, assetId);
        if (!v) {
            return res.status(404).json({ error: 'not_found', message: '版本不存在' });
        }
        if (!v.original_storage_key) {
            return res.status(400).json({ error: 'invalid_input', message: '该版本没有原始文件' });
        }

        db.prepare("UPDATE asset_versions SET preview_status = 'processing' WHERE id = ?").run(versionId);
        const r = await generatePreview({
            assetId,
            versionId,
            originalStorageKey: v.original_storage_key
            // 扩展名从存储键推断（asset_versions 表里没有 ext 列，ext 在 assets 表）
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
                versionId
            );
        } else if (r.status === 'failed') {
            db.prepare(
                "UPDATE asset_versions SET preview_status = 'failed', preview_error = ? WHERE id = ?"
            ).run(r.error || '预览生成失败', versionId);
        } else {
            db.prepare("UPDATE asset_versions SET preview_status = 'none' WHERE id = ?").run(versionId);
        }

        res.json({
            status: r.status,
            processor: r.processor || null,
            error: r.error || null,
            metadata: r.metadata || null,
            previewStorageKey: r.previewKey || null,
            thumbnailStorageKey: r.thumbnailKey || null
        });
    }));

    /** 当前服务器支持哪些预览类型（诊断用）。 */
    router.get('/assets/preview/processors', wrap((_req, res) => {
        res.json({ items: listProcessors() });
    }));

    /** 上传派生文件（preview / thumbnail）。第一版由 UI 手动触发或留空。 */
    router.post('/assets/:id/versions/:versionId/derived', wrapAsync(async (req, res) => {        const assetId = parseId(req.params.id);
        const versionId = parseId(req.params.versionId);
        if (assetId === null || versionId === null) {
            return res.status(400).json({ error: 'invalid_input', message: 'ID 无效' });
        }
        const uploaded = await parseUploadWithFields(req, 64 * 1024 * 1024);
        if (!uploaded || !uploaded.buffer) {
            return res.status(400).json({ error: 'invalid_input', message: '缺少文件' });
        }

        const kind = (req.query.kind === 'thumbnail') ? 'thumbnail' : 'preview';
        const key = saveDerivedFile({
            assetId, versionId, buffer: uploaded.buffer,
            kind, ext: classifyAsset(uploaded.filename).ext || '.bin'
        });
        getDb().prepare(`
            UPDATE asset_versions
            SET ${kind === 'preview' ? 'preview_storage_key' : 'thumbnail_storage_key'} = ?,
                preview_status = 'ready'
            WHERE id = ? AND asset_id = ?
        `).run(key, versionId, assetId);

        res.status(201).json({ storageKey: key, previewStatus: 'ready' });
    }));

    /** 重命名 / 移动 / 更新元信息。 */
    router.patch('/assets/:id', wrap((req, res) => {
        const id = parseId(req.params.id);
        if (id === null) return res.status(400).json({ error: 'invalid_input', message: '资源 ID 无效' });
        const db = getDb();
        const body = req.body || {};

        if (body.folderId !== undefined) {
            return res.json(store.moveAssets({
                connection: db,
                assetIds: [id],
                folderId: body.folderId === null ? null : parseId(body.folderId)
            }));
        }
        if (body.name !== undefined) {
            return res.json(store.renameAsset({ connection: db, assetId: id, name: body.name }));
        }
        res.json(store.updateAsset({ connection: db, assetId: id, patch: body }));
    }));

    // ══════════════════════════════════════════════════════════════
    // 版本操作
    // ══════════════════════════════════════════════════════════════

    /** 发布指定版本（省略 versionId 则发布 latest）。唯一移动 published 指针的入口。 */
    router.post('/assets/:id/publish', wrap((req, res) => {
        const id = parseId(req.params.id);
        if (id === null) return res.status(400).json({ error: 'invalid_input', message: '资源 ID 无效' });
        const versionId = req.body && req.body.versionId ? parseId(req.body.versionId) : undefined;
        res.json(store.publishAssetVersion({ connection: getDb(), assetId: id, versionId }));
    }));

    /** 取消发布。 */
    router.post('/assets/:id/unpublish', wrap((req, res) => {
        const id = parseId(req.params.id);
        if (id === null) return res.status(400).json({ error: 'invalid_input', message: '资源 ID 无效' });
        res.json(store.unpublishAsset({ connection: getDb(), assetId: id }));
    }));

    /**
     * 恢复历史版本：复制该版本内容生成**新版本**，latest 前进而不后退。
     * 用户明确要求：Latest=v7 时恢复 v3，应生成 v8（内容=v3），历史一个不少。
     */
    router.post('/assets/:id/versions/:versionId/restore', wrap((req, res) => {
        const assetId = parseId(req.params.id);
        const sourceVersionId = parseId(req.params.versionId);
        if (assetId === null || sourceVersionId === null) {
            return res.status(400).json({ error: 'invalid_input', message: 'ID 无效' });
        }
        const db = getDb();
        const source = db.prepare('SELECT * FROM asset_versions WHERE id = ? AND asset_id = ?')
            .get(sourceVersionId, assetId);
        if (!source) return res.status(404).json({ error: 'not_found', message: '版本不存在' });

        // 先占位建行拿新 id
        // ── 恢复流程：先暂存文件，再一次性建行 ──────────────────
        // 顺序很关键：版本目录按 versionId 分，而 versionId 要建行才有。
        // 若先建占位行占号，restoreAssetVersion 内部再取 MAX+1 就会跳号
        // （v2 之后占位成 v3，正式插入又成 v4 —— 版本号出现空洞且与预期不符）。
        // 所以改为：先把源文件复制成 tmp 暂存 → 交给 store 一次成型建行 →
        // 再把暂存文件搬进新版本目录。建行失败时只需删掉暂存文件。
        let stagedKey;
        try {
            stagedKey = stageAssetFileCopy(source.original_storage_key);
        } catch (e) {
            throw e;
        }

        let result;
        let newKey = null;
        try {
            // 先建行拿到 versionId（此时 original_storage_key 先填占位）
            result = store.restoreAssetVersion({
                connection: db,
                assetId,
                sourceVersionId,
                newStorageKey: '__staging__',
                newFileSize: source.file_size,
                newSha256: source.sha256,
                comment: req.body && req.body.comment
            });
            newKey = commitStagedAssetFile(stagedKey, assetId, result.versionId);
            db.prepare('UPDATE asset_versions SET original_storage_key = ? WHERE id = ?')
                .run(newKey, result.versionId);
        } catch (e) {
            // 建行成功但搬文件失败 → 把刚建的版本行删掉，不留无文件的版本
            if (result && result.versionId) {
                db.prepare('DELETE FROM asset_versions WHERE id = ?').run(result.versionId);
                db.prepare('UPDATE assets SET latest_version_id = (SELECT MAX(id) FROM asset_versions WHERE asset_id = ?) WHERE id = ?')
                    .run(assetId, assetId);
            }
            // 暂存文件清理
            try { unlinkSync(resolvePath(join(ASSET_DIR, stagedKey))); } catch { /* 已不存在 */ }
            throw e;
        }

        res.status(201).json({ ...result, ...store.getAsset({ connection: db, id: assetId }) });
    }));

    /** 删除版本（latest / published 受保护）。 */
    router.delete('/assets/:id/versions/:versionId', wrap((req, res) => {
        const assetId = parseId(req.params.id);
        const versionId = parseId(req.params.versionId);
        if (assetId === null || versionId === null) {
            return res.status(400).json({ error: 'invalid_input', message: 'ID 无效' });
        }
        const db = getDb();
        const v = db.prepare('SELECT original_storage_key, preview_storage_key, thumbnail_storage_key FROM asset_versions WHERE id = ? AND asset_id = ?')
            .get(versionId, assetId);
        const result = store.deleteAssetVersion({ connection: db, assetId, versionId });
        // 元数据已删，物理文件一并清理
        if (v) {
            deleteAssetFile(v.original_storage_key);
            if (v.preview_storage_key) deleteAssetFile(v.preview_storage_key);
            if (v.thumbnail_storage_key) deleteAssetFile(v.thumbnail_storage_key);
            deleteVersionDir(assetId, versionId);
            // 若这是最后一个版本，顺带清掉空的资源目录
            //（deleteAssetDir 内部只删空目录，有其他版本时不会误删）
            deleteAssetDir(assetId);
        }
        res.json(result);
    }));

    // ══════════════════════════════════════════════════════════════
    // 文件下载 / 预览
    // ══════════════════════════════════════════════════════════════

    /**
     * 取一个版本的某个文件流。
     *
     * 这是给 <img> / <video> / <model-viewer> 等用的**字节端点**，
     * 必须是 GET 可直接访问的裸 URL（不能要求自定义 header）。
     *
     * kind：original（默认）/ preview / thumbnail
     * 指针：latest（默认）/ published / 版本号数字
     *
     * published 是给 Unity 客户端的标准入口：
     *   GET /api/assets/files/123/original/published
     * 永远拿已发布版本，不受最新上传影响 —— 这正是发布机制的意义。
     */
    router.get('/assets/files/:id/:kind/:pointer', wrap((req, res) => {
        const assetId = parseId(req.params.id);
        if (assetId === null) return res.status(400).json({ error: 'invalid_input', message: '资源 ID 无效' });

        const kind = ['original', 'preview', 'thumbnail'].includes(req.params.kind)
            ? req.params.kind : 'original';
        const pointer = req.params.pointer;

        const db = getDb();
        const asset = db.prepare('SELECT id, latest_version_id, published_version_id FROM assets WHERE id = ?')
            .get(assetId);
        if (!asset) return res.status(404).json({ error: 'not_found', message: '资源不存在' });

        // 解析版本指针
        let version = null;
        if (pointer === 'latest') {
            version = asset.latest_version_id
                ? db.prepare('SELECT * FROM asset_versions WHERE id = ?').get(asset.latest_version_id)
                : null;
        } else if (pointer === 'published') {
            version = asset.published_version_id
                ? db.prepare('SELECT * FROM asset_versions WHERE id = ?').get(asset.published_version_id)
                : null;
            if (!version) {
                return res.status(404).json({
                    error: 'not_found',
                    message: '该资源尚未发布任何版本'
                });
            }
        } else if (pointer === 'auto') {
            // auto：有发布版就用发布版，没有则退回最新版。
            //
            // 为什么不直接用 published：演示库与多数团队的早期资源都没发布过，
            // 文档里写死 published 会大面积裂图。auto 让「引用」总能显示，
            // 且资源一旦发布，文档引用的内容自动跟进到正式版 ——
            // 这正是版本管理该有的语义。
            const preferred = asset.published_version_id || asset.latest_version_id;
            version = preferred
                ? db.prepare('SELECT * FROM asset_versions WHERE id = ?').get(preferred)
                : null;
        } else {
            const num = parseId(pointer);
            version = num
                ? db.prepare('SELECT * FROM asset_versions WHERE asset_id = ? AND version_number = ?').get(assetId, num)
                : null;
        }
        if (!version) return res.status(404).json({ error: 'not_found', message: '版本不存在' });

        const key = kind === 'preview' ? version.preview_storage_key
            : kind === 'thumbnail' ? version.thumbnail_storage_key
                : version.original_storage_key;

        // 派生文件可能尚未生成（预览管线未跑）→ 明确 404，前端据此显示「预览生成中」
        if (!key) {
            return res.status(404).json({
                error: 'not_found',
                message: kind === 'preview' ? '该版本的预览尚未生成' : '该版本没有缩略图',
                previewStatus: version.preview_status
            });
        }

        const abs = resolveAssetPath(key);
        if (!abs) return res.status(404).json({ error: 'not_found', message: '文件不存在或已被清理' });

        let size;
        try { size = statSync(abs).size; } catch { return res.status(404).json({ error: 'not_found', message: '文件不存在' }); }

        res.setHeader('Content-Type', assetMimeOf(key));
        res.setHeader('Content-Length', String(size));
        res.setHeader('Cache-Control', 'private, max-age=3600');
        // 下载走 attachment + 安全的文件名编码，避免中文名乱码
        if (req.query.download === '1') {
            const assetRow = db.prepare('SELECT name FROM assets WHERE id = ?').get(assetId);
            const name = assetRow ? assetRow.name : `asset-${assetId}`;
            res.setHeader(
                'Content-Disposition',
                `attachment; filename="${assetId}-v${version.version_number}"; ` +
                `filename*=UTF-8''${encodeURIComponent(name)}`
            );
        }
        // 用流而不是 readFileSync：大文件（856MB 的 GLB）绝不能整个读进内存
        createReadStream(abs).pipe(res);
    }));

    // ══════════════════════════════════════════════════════════════
    // 批量 / 回收站
    // ══════════════════════════════════════════════════════════════

    router.post('/assets/batch-move', wrap((req, res) => {
        const { assetIds, folderId } = req.body || {};
        res.json(store.moveAssets({
            connection: getDb(),
            assetIds,
            folderId: folderId === null || folderId === undefined ? null : parseId(folderId)
        }));
    }));

    router.post('/assets/batch-tags', wrap((req, res) => {
        const { assetIds, tags } = req.body || {};
        res.json(store.addTagsToAssets({ connection: getDb(), assetIds, tags }));
    }));

    /** 移入回收站（软删除，不碰文件）。 */
    router.post('/assets/batch-delete', wrap((req, res) => {
        const { assetIds } = req.body || {};
        res.json(store.setAssetsDeleted({ connection: getDb(), assetIds, toTrash: true }));
    }));

    /** 从回收站恢复。 */
    router.post('/assets/batch-restore', wrap((req, res) => {
        const { assetIds } = req.body || {};
        res.json(store.setAssetsDeleted({ connection: getDb(), assetIds, toTrash: false }));
    }));

    /**
     * 永久删除：真正移除元数据与磁盘文件。
     * 必须显式 purge=1，确认前端已做过二次确认。
     */
    router.post('/assets/purge', wrap((req, res) => {
        if (req.query.confirm !== '1') {
            return res.status(400).json({
                error: 'invalid_input',
                message: '永久删除需要二次确认'
            });
        }
        const ids = (req.body && req.body.assetIds) || [];
        const db = getDb();

        // 先收集要删的版本目录 —— purgeAssets 之后 asset_versions 已被
        // ON DELETE CASCADE 清掉，届时就无从得知该删哪些目录了。
        const dirTargets = [];
        for (const assetId of ids.map(Number).filter((n) => Number.isInteger(n) && n > 0)) {
            const versions = db.prepare('SELECT id FROM asset_versions WHERE asset_id = ?').all(assetId);
            for (const v of versions) dirTargets.push([assetId, v.id]);
        }

        const r = store.purgeAssets({ connection: db, assetIds: ids });
        // 元数据已清，磁盘文件随后清理；个别文件删不掉也不回滚
        //（已无元数据指向它，留孤儿文件也比回滚数据更可接受）
        for (const [assetId, versionId] of dirTargets) deleteVersionDir(assetId, versionId);
        // 版本目录删光后 <assetId>/ 会剩空壳，必须一并删掉 ——
        // 否则磁盘上会堆积无主的空目录（元数据已 purge，再也无法回收）
        for (const assetId of r.assetIds) deleteAssetDir(assetId);
        res.json(r);
    }));

    /** 清空回收站。 */
    router.post('/assets/trash/empty', wrap((req, res) => {
        if (req.query.confirm !== '1') {
            return res.status(400).json({ error: 'invalid_input', message: '清空回收站需要二次确认' });
        }
        const db = getDb();
        const ids = store.listTrashIds({ connection: db });

        // 同 purge：先记目录再删元数据
        const dirTargets = [];
        for (const assetId of ids) {
            const versions = db.prepare('SELECT id FROM asset_versions WHERE asset_id = ?').all(assetId);
            for (const v of versions) dirTargets.push([assetId, v.id]);
        }

        const r = store.purgeAssets({ connection: db, assetIds: ids });
        for (const [assetId, versionId] of dirTargets) deleteVersionDir(assetId, versionId);
        for (const assetId of r.assetIds) deleteAssetDir(assetId);
        res.json(r);
    }));

    /** 标签列表。 */
    router.get('/asset-tags', wrap((_req, res) => {
        res.json({ items: store.listAssetTags({ connection: getDb() }) });
    }));

    // ══════════════════════════════════════════════════════════════
    // 存储路径（镜像目录）设置
    // ══════════════════════════════════════════════════════════════

    /**
     * 读取当前保存路径设置。
     * 返回路径 + 镜像目录的现状统计（已同步文件数、占用空间）。
     */
    router.get('/assets/settings/storage', wrap((_req, res) => {
        const db = getDb();
        const path = getMirrorPath(db);
        res.json({
            ...mirrorStats(path),
            /** 主存储位置 —— 始终是服务端的权威副本，UI 要展示出来让用户知道 */
            primaryPath: ASSET_DIR,
            /** 目录是否存在（外部盘可能被拔掉） */
            available: path ? existsSync(path) : null
        });
    }));

    /**
     * 设置保存路径。
     *
     * 行为：写入配置 → **立即把现有资源全量拷贝到该目录**（用户要求
     * 「当选择路径后资源自动拷贝到指定路径」）→ 之后每次上传自动增量同步。
     *
     * 传空字符串则清除配置（停止镜像，不动已有文件）。
     */
    router.put('/assets/settings/storage', wrap((req, res) => {
        const db = getDb();
        const raw = (req.body && req.body.path !== undefined) ? req.body.path : '';
        const path = setMirrorPath(db, raw);

        if (!path) {
            // 清除配置：不再镜像，但保留已拷贝的文件（用户可能还要用）
            res.json({ ...mirrorStats(null), primaryPath: ASSET_DIR, cleared: true });
            return;
        }

        // 全量同步现有资源
        const sync = mirrorAll(path);
        res.json({
            ...mirrorStats(path),
            primaryPath: ASSET_DIR,
            synced: sync
        });
    }));

    /** 手动触发一次全量同步（不改变配置）。 */
    router.post('/assets/settings/storage/sync', wrap((_req, res) => {
        const db = getDb();
        const path = getMirrorPath(db);
        if (!path) {
            return res.status(400).json({ error: 'invalid_input', message: '尚未设置保存路径' });
        }
        res.json({ ...mirrorStats(path), synced: mirrorAll(path) });
    }));

    /** 校验一个路径是否可用（UI 输入时实时提示，不写入配置）。 */
    router.post('/assets/settings/storage/validate', wrap((req, res) => {
        const raw = (req.body && req.body.path) || '';
        try {
            const normalized = normalizeMirrorPath(raw);
            res.json({ ok: true, path: normalized });
        } catch (e) {
            res.status(400).json({ error: 'invalid_input', message: (e && e.message) || '路径不可用' });
        }
    }));

    /** 清空镜像目录内容（保留配置与目录本身）。 */
    router.post('/assets/settings/storage/clear', wrap((_req, res) => {
        const db = getDb();
        const path = getMirrorPath(db);
        if (!path) {
            return res.status(400).json({ error: 'invalid_input', message: '尚未设置保存路径' });
        }
        res.json({ removed: clearMirror(path).removed, ...mirrorStats(path) });
    }));

    // ══════════════════════════════════════════════════════════════
    // 导入 / 导出
    // ══════════════════════════════════════════════════════════════

    /**
     * 导出资源为 ZIP。
     *
     * 流式写出（archiver 边压边写），大文件不会撑爆内存 ——
     * 这是「批量下载不能把所有文件加载进浏览器内存」的服务端正解。
     */
    router.post('/assets/export', wrapAsync(async (req, res) => {
        const ids = (req.body && req.body.assetIds) || [];
        if (!Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ error: 'invalid_input', message: '未选择任何资源' });
        }
        await exportAssetsToZip({ connection: getDb(), assetIds: ids, res });
    }));

    /**
     * 导入资源包（ZIP）。
     *
     * 流程：接收 ZIP → 解压到临时目录 → 校验 manifest → 重新分配全部 id 后入库。
     * id 重新分配保证同一个包可以重复导入，得到两份独立资源。
     */
    router.post('/assets/import', wrapAsync(async (req, res) => {
        const db = getDb();
        const uploaded = await parseUploadWithFields(req, 8 * 1024 * 1024 * 1024);
        if (!uploaded || !uploaded.buffer) {
            return res.status(400).json({ error: 'invalid_input', message: '缺少资源包文件' });
        }

        const tmpDir = join(tmpdir(), `tt-asset-import-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`);
        const zipPath = join(tmpDir, 'package.zip');
        try {
            mkdirSync(tmpDir, { recursive: true });
            writeFileSync(zipPath, uploaded.buffer);

            const { manifest, filesDir } = await extractZip(zipPath, join(tmpDir, 'extracted'));
            const result = importAssets({
                connection: db,
                manifest,
                filesDir,
                assetsRoot: ASSET_DIR
            });

            // 导入的资源也要进镜像目录
            const mirror = getMirrorPath(db);
            if (mirror) mirrorAll(mirror);

            res.status(201).json({ ...result, importedAt: new Date().toISOString() });
        } catch (e) {
            const msg = (e && e.message) || '导入失败';
            res.status(400).json({ error: (e && e.code) || 'invalid_input', message: msg });
        } finally {
            // 清理临时目录（导入的大文件不该留在临时区）
            try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* 忽略 */ }
        }
    }));

    /** 最近操作（「最近使用」视图）。 */
    router.get('/assets-activity/recent', wrap((req, res) => {
        res.json({
            items: store.listRecentOperations({
                connection: getDb(), limit: clampInt(req.query.limit, 20, 1, 100)
            })
        });
    }));

    // 与 api.js 一致：路由内路径不带前缀，由 basePath 统一挂载
    app.use(basePath, router);
}