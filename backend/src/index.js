// team-toolbox 后端启动入口（TASK-001 脚手架 + TASK-003 业务接口）
//
// 健康检查：TASK-001 脚手架验证。
// 业务接口（文档 CRUD / 分类 / 标签）：TASK-003 落地于 ./api.js。
// 搜索接口：待 TASK-007。

import 'dotenv/config';
import express from 'express';
import { existsSync, statSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { getDefaultDatabase, closeDefaultDatabase, DB_PATH, PROJECT_ROOT } from './db.js';
import { registerApi } from './api.js';
import { registerAssetApi } from './asset-api.js';
import { registerUpdateApi } from './update-api.js';
import { backfillPreviews } from './asset-preview.js';
import { runMigrations } from './migrate.js';
import { ensureIndexSynced } from './search-index.js';
import { getAppVersion } from './version.js';
import { confirmStartupOk, readRollbackNotice } from './updater.js';

// ESM 没有 __dirname，手工取当前模块目录。
// 用于定位 frontend/dist —— 发布包内前端产物与后端同级目录结构：
//   <包根>/backend/src/index.js  →  <包根>/frontend/dist
const __dirname = dirname(fileURLToPath(import.meta.url));

const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT) || 3000;

const app = express();
// 导入备份会携带全部文档正文，默认 2mb 不足以承载较大知识库，这里放宽到 16mb。
app.use(express.json({ limit: '16mb' }));

// 业务接口（TASK-003）：文档 / 分类 / 标签的 CRUD 与关联读写
registerApi(app, { getDb: getDefaultDatabase });

// 资源管理接口（独立子系统）：Asset / AssetVersion / Folder / 标签 / 操作记录
registerAssetApi(app, { getDb: getDefaultDatabase });

// 自动更新接口：检查更新源、下载校验、安装重启。
// 默认不启用 —— 未配置更新源时所有接口都只返回「未配置」。
registerUpdateApi(app);

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
        // 版本号从 package.json 读，不再硬编码 ——
        // 硬编码会让「包自称的版本」与「实际装的版本」悄悄分叉，
        // 而自动更新完全依赖版本比对，分叉就等于更新检测失效。
        version: getAppVersion(),
        db: { path: DB_PATH, ok: dbOk, size_bytes: dbSize }
    });
});

// 静态资源：托管前端生产构建产物。
//
// 生产部署（发布包 / 内网部署）下，前端与 API 必须**同源** ——
// 前端调用的是相对路径 '/api/xxx'，若前端与后端不同源会直接跨域失败。
// 因此发布包里后端同时承担静态托管，单端口即可访问整个应用。
//
// 开发期不启用：dev server（Vite）已托管前端并把 /api 代理到本服务。
const frontendDist = resolvePath(__dirname, '..', '..', 'frontend', 'dist');
if (existsSync(frontendDist)) {
    // 带哈希的构建产物可长期缓存；index.html 必须每次校验，否则前端更新后
    // 浏览器仍加载旧的 chunk 引用。
    app.use(express.static(frontendDist, {
        index: false,
        setHeaders(res, filePath) {
            if (filePath.endsWith('index.html')) {
                res.setHeader('Cache-Control', 'no-cache');
            } else if (/-[A-Za-z0-9_-]{8}\.(js|css|mjs|woff2?|ttf|png|jpg|jpeg|webp|gif|svg|ico)$/i.test(filePath)) {
                // Vite 的产物名是「名称-内容哈希」形式（形如 Assets-5pQFi4kJ.js），
                // 内容变了文件名就变，因此可以放心长期缓存。
                // 注意哈希段在**扩展名之前**，且含 base64 字符（非纯 hex）。
                res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
            } else {
                // vendor/ 下的第三方资源（vditor 内核等）文件名不带哈希，
                // 保守起见给短缓存，避免升级后拿到旧文件。
                res.setHeader('Cache-Control', 'public, max-age=3600');
            }
        }
    }));

    // SPA 回退：前端用 history 模式（createWebHistory），
    // 刷新 /kb/12 这类深链时服务端收到的是该路径而非静态文件，
    // 不回退到 index.html 就会 404 —— 用户按 F5 就白屏。
    //
    // 注意 index.html 是经 sendFile 发送的，**不经过** express.static 的
    // setHeaders，必须在这里单独设 no-cache —— 否则浏览器会长期缓存
    // index.html，前端发版后仍加载旧的 chunk 引用（页面直接白屏）。
    app.get(/^(?!\/api\/).*/, (_req, res, next) => {
        res.setHeader('Cache-Control', 'no-cache');
        res.sendFile(resolvePath(frontendDist, 'index.html'), (err) => {
            if (err) next();
        });
    });
}

// 兜底 404：仅 API 未命中时返回 JSON
app.use('/api', (_req, res) => res.status(404).json({ error: 'not_found' }));

/**
 * 启动流程：先迁移数据库，再监听端口。
 *
 * 为什么迁移必须放在 listen 之前：
 * 发布包首次运行时数据库文件还不存在，若先监听再迁移，
 * 会有一个时间窗口内 /api/* 全部因「表不存在」而 500。
 * 用户看到的是「程序启动了但一进去就报错」，比启动失败更难排查。
 *
 * 迁移失败必须**直接退出**而不是继续服务 —— schema 不对的服务
 * 比启动失败更危险：数据可能写坏或写错位置。
 */
async function start() {
    try {
        const r = await runMigrations({ connection: getDefaultDatabase() });
        if (r.applied > 0) {
            console.log(`[migrate] 已应用 ${r.applied} 个迁移，版本=[${r.versions.join(', ')}]`);
        }
        if (r.errors && r.errors.length > 0) {
            console.error('[migrate] 迁移失败:', r.errors.join('; '));
            process.exit(1);
        }
    } catch (err) {
        console.error('[migrate] 迁移异常，服务未启动:', err && err.message);
        process.exit(1);
    }

    const server = app.listen(PORT, HOST, () => {
        console.log(`[server] listening on http://${HOST}:${PORT}`);
        console.log(`[server] db path: ${resolvePath(DB_PATH)}`);
        console.log(`[server] node: ${process.version}`);
        console.log(`[server] version: ${getAppVersion()}`);

        // 自动更新的「成功握手」。
        //
        // apply.cmd 在换完文件、拉起本进程后会盯着 data/updates/pending.json：
        // 标记还在就说明新版本没起来，它会自动回滚。所以这一行必须放在
        // listen 成功之后 —— 迁移失败会 exit(1)，那时标记应当保留。
        const upgraded = confirmStartupOk();
        if (upgraded) {
            console.log(`[update] 已完成升级：${upgraded.from} → ${upgraded.to}`);
        }
        const rollback = readRollbackNotice();
        if (rollback) {
            console.warn(`[update] 检测到上次升级被回滚：${rollback}`);
        }

        // 全文索引与主表同步检查。
        //
        // 索引在应用层维护（中文 bigram 分词需 JS，FTS5 自定义 tokenizer 要 C 扩展），
        // 因此存在漂移的可能：直接改库、异常中断、迁移后新增文档等。
        // 启动时比对行数，不一致就全量重建 —— 搜索结果错漏比慢几秒更糟。
        try {
            const s = ensureIndexSynced(getDefaultDatabase());
            if (s.rebuilt) {
                console.log(`[search] 全文索引已重建：${s.indexed} 篇文档`);
            }
        } catch (e) {
            // 索引不可用不阻断服务：searchDocuments 会退回 LIKE 实现
            console.warn('[search] 全文索引同步失败（搜索将退回基础模式）:', e && e.message);
        }

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

    server.on('error', (err) => {
        console.error('[server] 启动失败:', err && err.message);
        process.exit(1);
    });

    return server;
}

const server = await start();

function shutdown(signal) {
    console.log(`[server] received ${signal}, shutting down`);
    server.close(() => {
        closeDefaultDatabase();
        process.exit(0);
    });
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));