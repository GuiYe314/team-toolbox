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
import { createReadStream, statSync, unlinkSync } from 'node:fs';
import { join, resolve as resolvePath } from 'node:path';
import * as store from './asset-store.js';
import {
    saveAssetFile, saveDerivedFile, deleteAssetFile,
    deleteVersionDir, resolveAssetPath, assetMimeOf, classifyAsset,
    isViewableType, assetDiskUsage, MAX_ASSET_BYTES,
    stageAssetFileCopy, commitStagedAssetFile, ASSET_DIR
} from './asset-storage.js';
import { parseUploadWithFields } from './asset-upload-parser.js';
import { sendError } from './api.js';

/** 解析正整数 ID；非法返回 null。 */
function parseId(value) {
    const id = Number(value);
    return Number.isInteger(id) && id > 0 ? id : null;
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

    /** 上传派生文件（preview / thumbnail）。第一版由 UI 手动触发或留空。 */
    router.post('/assets/:id/versions/:versionId/derived', wrapAsync(async (req, res) => {
        const assetId = parseId(req.params.id);
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
        res.json(r);
    }));

    /** 标签列表。 */
    router.get('/asset-tags', wrap((_req, res) => {
        res.json({ items: store.listAssetTags({ connection: getDb() }) });
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