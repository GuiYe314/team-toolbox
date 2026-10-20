// team-toolbox 后端启动入口（TASK-001 脚手架 + TASK-003 业务接口）
//
// 健康检查：TASK-001 脚手架验证。
// 业务接口（文档 CRUD / 分类 / 标签）：TASK-003 落地于 ./api.js。
// 搜索接口：待 TASK-007。

import 'dotenv/config';
import express from 'express';
import { existsSync, statSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { getDefaultDatabase, closeDefaultDatabase, DB_PATH, PROJECT_ROOT } from './db.js';
import { registerApi } from './api.js';
import { registerAssetApi } from './asset-api.js';
import { backfillPreviews } from './asset-preview.js';

const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT) || 3000;

const app = express();
// 导入备份会携带全部文档正文，默认 2mb 不足以承载较大知识库，这里放宽到 16mb。
app.use(express.json({ limit: '16mb' }));

// 业务接口（TASK-003）：文档 / 分类 / 标签的 CRUD 与关联读写
registerApi(app, { getDb: getDefaultDatabase });

// 资源管理接口（独立子系统）：Asset / AssetVersion / Folder / 标签 / 操作记录
registerAssetApi(app, { getDb: getDefaultDatabase });

// 健康检查：返回 DB 路径与可达性
app.get('/api/health', (_req, res) => {
    let dbOk = false;
    let dbSize = 0;
    try {
        const db = getDefaultDatabase();
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

// 静态资源：阶段二开始提供前端构建产物；TASK-001 暂不挂载。
// app.use('/', express.static(resolvePath(__dirname, '..', '..', 'frontend', 'dist')));

app.use((_req, res) => res.status(404).json({ error: 'not_found' }));

const server = app.listen(PORT, HOST, () => {
    console.log(`[server] listening on http://${HOST}:${PORT}`);
    console.log(`[server] db path: ${resolvePath(DB_PATH)}`);
    console.log(`[server] node: ${process.version}`);

    // 补生成存量资源的预览。
    //
    // 预览管线只在上传时触发，管线接入之前就已存在的资源会永远停在
    // preview_status='pending'，前端就一直显示「正在生成预览」——
    // 实际是没人管。启动时扫一遍补上。
    //
    // 刻意不 await：预览生成可能耗时（模型解析），不该拖慢服务启动。
    (async () => {
        try {
            const s = await backfillPreviews({ connection: getDefaultDatabase() });
            if (s.scanned > 0) {
                console.log(`[assets] 补生成存量预览：扫描 ${s.scanned}，就绪 ${s.ready}，失败 ${s.failed}，无预览 ${s.none}`);
            }
        } catch (e) {
            console.warn('[assets] 补生成存量预览失败（不影响服务）:', e && e.message);
        }
    })();
});

function shutdown(signal) {
    console.log(`[server] received ${signal}, shutting down`);
    server.close(() => {
        closeDefaultDatabase();
        process.exit(0);
    });
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));