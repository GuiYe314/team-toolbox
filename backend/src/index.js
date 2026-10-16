// team-toolbox 后端启动入口（TASK-001 脚手架）
//
// 当前仅暴露健康检查接口，用于阶段一脚手架验证。
// 业务接口（文档 CRUD / 分类 / 标签 / 搜索）将在 TASK-002、TASK-003 落地。

import express from 'express';
import { existsSync, statSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { db, DB_PATH } from './db.js';
import { renderMarkdown } from './markdown.js';

const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT) || 3000;

const app = express();
app.use(express.json({ limit: '2mb' }));

// 健康检查：返回 DB 路径与可达性
app.get('/api/health', (_req, res) => {
    let dbOk = false;
    let dbSize = 0;
    try {
        db.prepare('SELECT 1 AS ok').get();
        dbOk = true;
        if (existsSync(DB_PATH)) {
            dbSize = statSync(DB_PATH).size;
        }
    } catch (err) {
        return res.status(500).json({
            status: 'error',
            error: 'database_unavailable',
            message: String(err && err.message || err)
        });
    }
    res.json({
        status: 'ok',
        service: 'team-toolbox-backend',
        version: '0.1.0',
        db: { path: DB_PATH, ok: dbOk, size_bytes: dbSize }
    });
});

// Markdown 渲染验证（仅供 TASK-001 冒烟；后续会移除或合并）
app.post('/api/_dev/render-markdown', (req, res) => {
    const md = String(req.body?.md || '');
    try {
        const html = renderMarkdown(md);
        res.json({ html });
    } catch (err) {
        res.status(500).json({ error: 'render_failed', message: String(err && err.message || err) });
    }
});

// 静态资源：阶段二开始提供前端构建产物；TASK-001 暂不挂载。
// app.use('/', express.static(resolvePath(__dirname, '..', '..', 'frontend', 'dist')));

app.use((_req, res) => res.status(404).json({ error: 'not_found' }));

const server = app.listen(PORT, HOST, () => {
    console.log(`[server] listening on http://${HOST}:${PORT}`);
    console.log(`[server] db path: ${resolvePath(DB_PATH)}`);
    console.log(`[server] node: ${process.version}`);
});

function shutdown(signal) {
    console.log(`[server] received ${signal}, shutting down`);
    server.close(() => {
        try { db.close(); } catch (_) { /* ignore */ }
        process.exit(0);
    });
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));