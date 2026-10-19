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
import * as store from './store.js';
import { renderMarkdown } from './markdown.js';

// 业务错误码 → HTTP 状态码
const STATUS_MAP = {
    invalid_input: 400,
    not_found: 404,
    conflict: 409,
    constraint_failed: 409,
    cannot_open: 500,
    busy_lock: 500,
    unknown: 500
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
    router.get('/backup/export', wrap((_req, res) => {
        res.json(store.exportSnapshot({ connection: getDb() }));
    }));

    // 导入快照：合并模式，不删除既有数据；同级同标题跳过，返回导入统计
    router.post('/backup/import', wrap((req, res) => {
        const stats = store.importSnapshot({ connection: getDb(), snapshot: req.body });
        res.json(stats);
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
