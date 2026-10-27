// 自动更新的 HTTP 接口。
//
// 与 api.js / asset-api.js 风格对齐（同款 wrap / wrapAsync / sendError）。
//
// ── 这组接口比普通 CRUD 危险 ──
//
// 它能替换程序文件并重启服务。本系统按设计没有认证（受控内网边界），
// 因此用三层约束兜住：
//   1. 真正落地（apply）必须显式带 confirm=1，与「永久删除」同款门槛
//   2. 包必须与配置的更新源给出的 sha256 一致，否则丢弃
//   3. 落地前强制备份，且换文件由独立进程执行并带自动回滚
//
// 换一个角度说：谁能调这些接口，谁本来就能直接改磁盘上的文件。
// 门槛的作用是防**误触**与**半懂的操作**，不是防恶意用户。

import express from 'express';
import { sendError } from './api.js';
import { closeDefaultDatabase } from './db.js';
import * as updater from './updater.js';
import { getUpdateSource, setUpdateSource, UPDATE_ROOT } from './update-source.js';

/** 同一时刻只允许一个更新动作，避免并发下载/安装把状态搅乱。 */
let busy = null;

function begin(action) {
    if (busy) {
        const err = new Error(`正在${busy}，请等待完成`);
        err.code = 'conflict';
        throw err;
    }
    busy = action;
}

function end() {
    busy = null;
}

export function registerUpdateApi(app, { basePath = '/api' } = {}) {
    const router = express.Router();

    const wrap = (fn) => (req, res) => {
        try { fn(req, res); } catch (err) { sendError(res, err); }
    };
    const wrapAsync = (fn) => (req, res) => {
        Promise.resolve(fn(req, res)).catch((err) => sendError(res, err));
    };

    // ── 状态（纯本地读取，不触发网络请求）──
    //
    // 页面首屏要能立刻显示「当前版本 / 是否有新版」，不能因为更新源不通
    // 就卡住整个页面。所以状态接口只读缓存，检查要显式点按钮。
    router.get('/update/status', wrap((_req, res) => {
        res.json({
            ...updater.getUpdateSnapshot(),
            busy,
            updateRoot: UPDATE_ROOT
        });
    }));

    // ── 配置更新源 ──
    router.get('/update/source', wrap((_req, res) => {
        res.json(getUpdateSource());
    }));

    router.put('/update/source', wrap((req, res) => {
        const { source } = req.body || {};
        res.json(setUpdateSource(source));
    }));

    // ── 检查更新 ──
    router.post('/update/check', wrapAsync(async (_req, res) => {
        const r = await updater.checkForUpdate();
        // 检查失败不返回 4xx/5xx：这不是「请求错」，
        // 而是「检查结果就是不可用」，前端按结果渲染即可。
        res.json(r);
    }));

    // ── 下载并校验 ──
    router.post('/update/download', wrapAsync(async (req, res) => {
        const { version } = req.body || {};
        if (!version) {
            return res.status(400).json({ error: 'invalid_input', message: '缺少版本号' });
        }
        begin('下载更新包');
        try {
            const r = await updater.downloadUpdate(version);
            res.json(r);
        } finally {
            end();
        }
    }));

    // ── 解压并自检（不改变正在运行的版本）──
    //
    // 单独暴露出来是有意的：自检可能失败（ABI 不匹配、包结构不对），
    // 让它在「还没动任何文件」的阶段就失败，用户能看到原因。
    router.post('/update/stage', wrapAsync(async (req, res) => {
        const { version } = req.body || {};
        if (!version) {
            return res.status(400).json({ error: 'invalid_input', message: '缺少版本号' });
        }
        begin('解压更新包');
        try {
            res.json(await updater.stageUpdate(version));
        } finally {
            end();
        }
    }));

    // ── 安装并重启（最高危，必须 confirm=1）──
    router.post('/update/apply', wrapAsync(async (req, res) => {
        if (String(req.query.confirm || '') !== '1') {
            return res.status(400).json({
                error: 'invalid_input',
                message: '安装更新会替换程序文件并重启服务，需要 confirm=1 确认'
            });
        }
        const { version } = req.body || {};
        if (!version) {
            return res.status(400).json({ error: 'invalid_input', message: '缺少版本号' });
        }

        begin('安装更新');
        let result;
        try {
            result = await updater.applyUpdate({ version });
        } catch (err) {
            end();
            throw err;
        }

        res.json(result);

        // 先把响应发出去，再退出进程 —— 否则前端拿到的是连接中断，
        // 用户会以为「更新失败了」，而实际上换文件进程已经在跑了。
        setTimeout(() => {
            console.log(`[update] 正在升级到 ${version}，本进程退出以便替换文件`);
            try { closeDefaultDatabase(); } catch { /* 关库失败也要退出 */ }
            process.exit(0);
        }, 1200);
    }));

    // ── 确认已知晓「上次更新被回滚」──
    router.post('/update/dismiss-rollback', wrap((_req, res) => {
        res.json({ cleared: updater.clearRollbackNotice() });
    }));

    app.use(basePath, router);
}
