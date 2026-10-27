// TASK-003：文档 / 分类 / 标签的 HTTP 接口层。
//
// 职责：
//   - 在 store.js（同步存储层）之上暴露 HTTP 路由
//   - 把 store 抛出的业务错误码（见 errors.js）映射为 HTTP 状态码与统一响应体
//   - 解析并校验路径/查询参数
//
// 覆盖特性：F-KB-001（新建/读取）、F-KB-002（编辑 + 409 冲突）、F-KB-003（删除）、
//           F-KB-004/F-KB-005 的“分类/标签关联读写支持”部分，以及 F-KB-006 搜索、F-KB-007/F-OPS-002 备份导入导出。
// 注意：标签名“英文小写合并”属于 F-KB-005，已在 TASK-006 落地。
//
// 统一响应体：
//   成功：{ ...data }
//   失败：{ error: <code>, message: <string>, current?: <object>, detail?: <string> }
//         - conflict 时附带服务端当前快照 current
//         - 非生产环境附带内部 detail

import express from 'express';
import { gzipSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as store from './store.js';
import { renderMarkdown } from './markdown.js';
import { saveImage, resolveUploadPath, mimeOf, parseUploadFile } from './uploads.js';
import { exportFullBackup } from './full-backup.js';
import { extractFullBackup, restoreFullBackup, writeBackupBuffer, cleanupBackupTemp } from './full-backup-restore.js';
import { ASSET_DIR } from './asset-storage.js';

// 业务错误码 → HTTP 状态码
const STATUS_MAP = {
    invalid_input: 400,
    not_found: 404,
    conflict: 409,
    constraint_failed: 409,
    cannot_open: 500,
    busy_lock: 500,
    unknown: 500,

    // 自动更新（updater.js）。刻意把「更新源侧的问题」与「本地操作顺序问题」
    // 分开：前者是 502（网关/上游不可达，换个源可能就好了），
    // 后者是 409（状态不满足，按提示补齐前置步骤即可）。
    not_configured: 400,
    invalid_source: 400,
    source_unreachable: 502,
    manifest_invalid: 502,
    download_failed: 502,
    checksum_mismatch: 502,
    package_invalid: 422,
    package_too_large: 413,
    self_check_failed: 422,
    extract_failed: 422,
    not_downloaded: 409,
    not_staged: 409,
    update_failed: 500
};

/**
 * 将 store 抛出的业务错误转换为 HTTP 响应。
 * @param {import('express').Response} res
 * @param {Error & { code?: string, current?: any, detail?: string }} err
 */
export function sendError(res, err) {
    const code = (err && err.code) || 'unknown';
    const status = STATUS_MAP[code] || 500;
    const body = {
        error: code,
        message: (err && err.message) || '操作失败，请稍后重试'
    };
    // 版本冲突：附带服务端当前快照，供前端“加载最新”使用
    if (code === 'conflict' && err.current) {
        body.current = err.current;
    }
    // 调试信息仅在非生产环境暴露
    if (process.env.NODE_ENV !== 'production' && err && err.detail) {
        body.detail = err.detail;
    }
    res.status(status).json(body);
}

/** 解析正整数 ID；非法返回 null。 */
function parseId(value) {
    const id = Number(value);
    if (!Number.isInteger(id) || id < 1) return null;
    return id;
}

/** 把查询参数限制为整数范围，非法则取默认值。 */
function clampInt(value, def, min, max) {
    const n = Number(value);
    if (!Number.isInteger(n)) return def;
    return Math.min(max, Math.max(min, n));
}

/** 备份文件名时间戳：2026-10-19-08-24-14（本地时间，便于人工辨认与排序）。 */
function stamp() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
        + `-${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

/**
 * 把 API 路由挂载到 app。
 * @param {import('express').Express} app
 * @param {object} options
 * @param {() => import('better-sqlite3').Database} options.getDb - 返回当前数据库连接
 * @param {string} [options.basePath='/api']
 * @returns {import('express').Router}
 */
export function registerApi(app, { getDb, basePath = '/api' }) {
    const router = express.Router();

    // store 层是同步的（better-sqlite3），用 try/catch 统一捕获业务错误
    const wrap = (fn) => (req, res) => {
        try {
            fn(req, res);
        } catch (err) {
            sendError(res, err);
        }
    };

    // 异步 handler（multipart 上传需要 await）
    const wrapAsync = (fn) => (req, res) => {
        Promise.resolve(fn(req, res)).catch((err) => sendError(res, err));
    };

    // ───────────────────────── 文档 ─────────────────────────

    // 列表（分页 + 可选分类 / 父页面过滤）
    router.get('/documents', wrap((req, res) => {
        const filter = {
            limit: clampInt(req.query.limit, 20, 1, 100),
            offset: clampInt(req.query.offset, 0, 0, 100000)
        };
        if (req.query.category_id !== undefined && req.query.category_id !== '') {
            const cid = parseId(req.query.category_id);
            if (cid === null) {
                return res.status(400).json({ error: 'invalid_input', message: '分类 ID 无效' });
            }
            filter.category_id = cid;
        }
        // root=1 → 只看顶层页面；parent_id=<id> → 只看该页面的直接子页面
        if (req.query.root === '1' || req.query.root === 'true') {
            filter.root = true;
        } else if (req.query.parent_id !== undefined && req.query.parent_id !== '') {
            const pid = parseId(req.query.parent_id);
            if (pid === null) {
                return res.status(400).json({ error: 'invalid_input', message: '父页面 ID 无效' });
            }
            filter.parent_id = pid;
        }
        // tags：逗号分隔或重复参数，按标签 AND 过滤
        if (req.query.tags !== undefined && req.query.tags !== '') {
            const raw = Array.isArray(req.query.tags)
                ? req.query.tags.join(',')
                : String(req.query.tags);
            const tagArr = raw.split(',').map((s) => s.trim()).filter(Boolean);
            if (tagArr.length > 0) filter.tags = tagArr;
        }
        res.json(store.listDocuments({ connection: getDb(), filter }));
    }));

    // 搜索（F-KB-006）：关键词匹配标题或正文（参数化 LIKE，转义通配符），
    // 结果按 updated_at 倒序、分页。空关键词不发起查询，直接返回空结果。
    router.get('/search', wrap((req, res) => {
        const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
        if (!q) {
            return res.json({ total: 0, items: [], query: '' });
        }
        const limit = clampInt(req.query.limit, 20, 1, 100);
        const offset = clampInt(req.query.offset, 0, 0, 100000);
        const { total, items } = store.searchDocuments({
            connection: getDb(),
            keyword: q,
            limit,
            offset
        });
        res.json({ total, items, query: q });
    }));

    // 页面树（侧边栏用；必须在 /documents/:id 之前注册，避免被当成 ID）
    router.get('/documents/tree', wrap((_req, res) => {
        res.json({ items: store.listDocumentTree({ connection: getDb() }) });
    }));

    // 新建
    router.post('/documents', wrap((req, res) => {
        const body = req.body || {};
        const created = store.createDocument({
            connection: getDb(),
            title: body.title,
            content_md: body.content_md,
            category_id: body.category_id,
            parent_id: body.parent_id,
            tags: body.tags
        });
        res.status(201).json(created);
    }));

    // 子页面列表
    router.get('/documents/:id/children', wrap((req, res) => {
        const id = parseId(req.params.id);
        if (id === null) {
            return res.status(400).json({ error: 'invalid_input', message: '文档 ID 无效' });
        }
        const doc = store.getDocument({ connection: getDb(), id });
        if (!doc) {
            return res.status(404).json({ error: 'not_found', message: '文档不存在' });
        }
        res.json({ items: store.listChildren({ connection: getDb(), id }) });
    }));

    // ───────────────────────── 文档回收站 ─────────────────────────
    // 注意：这些路径必须注册在 /documents/:id 之前，
    // 否则 "trash" 会被当成文档 id 解析。

    /** 回收站列表（按删除时间倒序）。 */
    router.get('/documents/trash', wrap((req, res) => {
        const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
        const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
        res.json(store.listTrashDocuments({ connection: getDb(), limit, offset }));
    }));

    /** 从回收站恢复（连带子树；父级已不可用时提升为顶层）。 */
    router.post('/documents/restore', wrap((req, res) => {
        const ids = req.body && req.body.ids;
        res.json(store.restoreDocuments({ connection: getDb(), ids }));
    }));

    /**
     * 永久删除：物理移除，不可恢复。
     * 必须显式 confirm=1（与资源侧 purge 的约定一致），
     * 且只允许删已在回收站里的文档 —— 从机制上杜绝一键抹掉正常文档。
     */
    router.post('/documents/purge', wrap((req, res) => {
        if (req.query.confirm !== '1') {
            return res.status(400).json({
                error: 'invalid_input',
                message: '永久删除需要二次确认'
            });
        }
        const ids = req.body && req.body.ids;
        res.json(store.purgeDocuments({ connection: getDb(), ids }));
    }));

    /** 清空回收站（物理删除全部已删文档）。 */
    router.post('/documents/trash/empty', wrap((req, res) => {
        if (req.query.confirm !== '1') {
            return res.status(400).json({
                error: 'invalid_input',
                message: '清空回收站需要二次确认'
            });
        }
        const ids = store.listTrashDocumentIds({ connection: getDb() });
        if (ids.length === 0) {
            return res.json({ deleted: 0, detached: 0, missing: [] });
        }
        res.json(store.purgeDocuments({ connection: getDb(), ids }));
    }));

    // 读取单个
    router.get('/documents/:id', wrap((req, res) => {
        const id = parseId(req.params.id);
        if (id === null) {
            return res.status(400).json({ error: 'invalid_input', message: '文档 ID 无效' });
        }
        const doc = store.getDocument({ connection: getDb(), id });
        if (!doc) {
            return res.status(404).json({ error: 'not_found', message: '文档不存在' });
        }
        res.json(doc);
    }));

    // 更新（乐观锁，需携带 version）
    router.put('/documents/:id', wrap((req, res) => {
        const id = parseId(req.params.id);
        if (id === null) {
            return res.status(400).json({ error: 'invalid_input', message: '文档 ID 无效' });
        }
        const body = req.body || {};
        if (body.version === undefined || body.version === null) {
            return res.status(400).json({ error: 'invalid_input', message: '缺少 version 字段（乐观锁）' });
        }
        const updated = store.updateDocument({
            connection: getDb(),
            id,
            version: body.version,
            title: body.title,
            content_md: body.content_md,
            category_id: body.category_id,
            parent_id: body.parent_id,
            tags: body.tags
        });
        res.json(updated);
    }));

    // 删除
    router.delete('/documents/:id', wrap((req, res) => {
        const id = parseId(req.params.id);
        if (id === null) {
            return res.status(400).json({ error: 'invalid_input', message: '文档 ID 无效' });
        }
        store.deleteDocument({ connection: getDb(), id });
        res.status(204).end();
    }));

    // 批量删除：单事务原子操作。不存在的 id 跳过并记入 missing，不整批失败。
    // 放在 /documents/:id 之后但用独立路径，避免与单条删除的语义混淆。
    router.post('/documents/batch-delete', wrap((req, res) => {
        const ids = req.body && req.body.ids;
        const result = store.deleteDocuments({ connection: getDb(), ids });
        res.json(result);
    }));

    // ───────────────────────── 分类 ─────────────────────────

    router.get('/categories', wrap((_req, res) => {
        res.json(store.listCategories({ connection: getDb() }));
    }));

    router.post('/categories', wrap((req, res) => {
        const body = req.body || {};
        const created = store.createCategory({ connection: getDb(), name: body.name });
        res.status(201).json(created);
    }));

    // 重命名分类（F-KB-004）
    router.put('/categories/:id', wrap((req, res) => {
        const id = parseId(req.params.id);
        if (id === null) {
            return res.status(400).json({ error: 'invalid_input', message: '分类 ID 无效' });
        }
        const body = req.body || {};
        const updated = store.updateCategory({ connection: getDb(), id, name: body.name });
        res.json(updated);
    }));

    router.delete('/categories/:id', wrap((req, res) => {
        const id = parseId(req.params.id);
        if (id === null) {
            return res.status(400).json({ error: 'invalid_input', message: '分类 ID 无效' });
        }
        store.deleteCategory({ connection: getDb(), id });
        res.status(204).end();
    }));

    // ───────────────────────── 标签 ─────────────────────────

    router.get('/tags', wrap((_req, res) => {
        res.json(store.listTags({ connection: getDb() }));
    }));

    router.delete('/tags/:id', wrap((req, res) => {
        const id = parseId(req.params.id);
        if (id === null) {
            return res.status(400).json({ error: 'invalid_input', message: '标签 ID 无效' });
        }
        store.deleteTag({ connection: getDb(), id });
        res.status(204).end();
    }));

    // ───────────────────── 备份导入 / 导出 ─────────────────────
    // F-KB-007（导出为独立于引擎的备份格式）、F-OPS-002（备份/恢复）。
    // 快照使用分类名与相对引用（ref / parent_ref），可跨库跨机还原，见 store.exportSnapshot。

    // 导出全量快照（分类 / 标签 / 文档 + 正文 + 父子层级）
    // ?format=gz 时返回 **原始 gzip 字节**（实测约为明文的 1%）。
    // 刻意不设置 Content-Encoding: gzip —— 那样浏览器会自动解压，
    // 前端拿到的将是明文而非可保存为 .gz 的压缩流。文件名在 Content-Disposition 中给出。
    router.get('/backup/export', wrap((req, res) => {
        const snapshot = store.exportSnapshot({ connection: getDb() });
        const useGz = String(req.query.format || '').toLowerCase() === 'gz';
        const json = JSON.stringify(snapshot, null, 2);
        if (useGz) {
            const gz = gzipSync(Buffer.from(json, 'utf8'), { level: 9 });
            res.setHeader('Content-Type', 'application/gzip');
            res.setHeader('Content-Length', String(gz.length));
            res.setHeader(
                'Content-Disposition',
                `attachment; filename="team-toolbox-backup-${stamp()}.json.gz"`
            );
            res.end(gz);
            return;
        }
        res.json(snapshot);
    }));

    // 导入快照：合并模式，不删除既有数据；同级同标题跳过，返回导入统计
    router.post('/backup/import', wrap((req, res) => {
        const stats = store.importSnapshot({ connection: getDb(), snapshot: req.body });
        res.json(stats);
    }));

    // ───────────────────── 全量备份（文档 + 图片 + 资源） ─────────────────────
    //
    // 为什么单独一个端点：
    //   /backup/export 只含文档数据，资源文件与文档图片都不在里面。
    //   用户点「导出备份」以为数据安全了，实际只保住了文字 ——
    //   这不是功能缺失，是**数据保护漏洞**。
    //
    // 全量备份包结构：manifest.json + documents.json + uploads/ + assets/
    // 详见 backend/src/full-backup.js。

    // 导出全量备份：ZIP 流式下载
    const rawFullExport = async (req, res) => {
        const name = `team-toolbox-full-backup-${stamp()}.zip`;
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader(
            'Content-Disposition',
            `attachment; filename="${name}"; filename*=UTF-8''${encodeURIComponent(name)}`
        );
        const result = await exportFullBackup({ connection: getDb(), res });
        console.log(
            `[backup] 全量备份导出完成：文档 ${result.manifest.counts.documents}，`
            + `资源 ${result.manifest.counts.assets}，文件 ${result.manifest.counts.asset_files}，`
            + `图片 ${result.manifest.counts.uploads}，字节 ${result.bytes}`
        );
    };
    router.get('/backup/full-export', wrapAsync(rawFullExport));

    // 恢复全量备份：multipart 上传 ZIP，合并模式
    const rawFullImport = async (req, res) => {
        const uploaded = await parseUploadFile(req, 8 * 1024 * 1024 * 1024);
        if (!uploaded || !uploaded.buffer) {
            return res.status(400).json({ error: 'invalid_input', message: '缺少备份包文件（字段名应为 file）' });
        }

        const tmpDir = join(tmpdir(), `tt-full-restore-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`);
        try {
            const zipPath = writeBackupBuffer(uploaded.buffer, tmpDir);
            const extracted = await extractFullBackup(zipPath, join(tmpDir, 'extracted'));
            const result = restoreFullBackup({
                connection: getDb(),
                extractTo: join(tmpDir, 'extracted'),
                extracted,
                assetsRoot: ASSET_DIR
            });
            res.status(201).json({
                ...result,
                restoredAt: new Date().toISOString()
            });
        } catch (e) {
            const msg = (e && e.message) || '恢复失败';
            res.status(400).json({ error: (e && e.code) || 'invalid_input', message: msg });
        } finally {
            // 清理临时目录（备份包可能很大，不该留在临时区）
            cleanupBackupTemp(tmpDir);
        }
    };
    router.post('/backup/full-import', wrapAsync(rawFullImport));

    // ───────────────────── 图片附件 ─────────────────────
    // TASK-012。图片落盘到 data/uploads/，Markdown 正文存 ![](/api/uploads/xxx.png) 链接。
    // 使用 Node 20+ 内置的 Request.formData() 解析 multipart，不引入 multer 依赖。

    // 上传图片：multipart/form-data，字段名 image
    // Express 5 的 req 无 formData()，由 uploads.parseUploadFile 用 busboy 解析。
    const rawUpload = async (req, res) => {
        const file = await parseUploadFile(req);
        if (!file) {
            return res.status(400).json({ error: 'invalid_input', message: '缺少图片文件（字段名应为 image）' });
        }
        const saved = saveImage({ buffer: file.buffer, originalName: file.filename });
        res.status(201).json(saved);
    };

    // 异步 handler（multipart 上传需要 await）
    router.post('/uploads', wrapAsync(rawUpload));

    // 读取图片
    router.get('/uploads/:filename', wrap((req, res) => {
        const abs = resolveUploadPath(req.params.filename);
        if (!abs) {
            return res.status(404).json({ error: 'not_found', message: '图片不存在' });
        }
        res.type(mimeOf(req.params.filename));
        // 文件名含时间戳且内容不可变，可长期缓存
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        res.sendFile(abs);
    }));

    // ───────────────────── Markdown 安全渲染 ─────────────────────
    // 供前端编辑预览与详情页渲染使用：marked 解析 + sanitize-html 白名单净化，
    // 防存储型 XSS（见 ARCHITECTURE 第 7 节）。原 _dev 端点已合并至此稳定路由。
    router.post('/markdown/render', wrap((req, res) => {
        const md = String((req.body && req.body.md) || '');
        const html = renderMarkdown(md);
        res.json({ html });
    }));

    app.use(basePath, router);
    return router;
}
