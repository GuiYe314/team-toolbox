import express from 'express';
import { pipeline } from 'node:stream/promises';
import { IntegrationError, createIntegrationConfig, problem } from './integration-common.js';
import { createYoinksService } from './yoinks.js';
import { createFreeLlmService } from './freellmapi.js';
import { createArtcraftService } from './artcraft.js';
import { createToolAccess } from './tool-access.js';

export function requireLocalIntegrationRequest(req, res, next, access = createToolAccess()) {
    if (!access.allows(req, { browser: true })) {
        return res.status(403).json({ error: access.allowLan ? 'access_denied' : 'local_only', message: '请在同源工具箱页面使用开源工具；局域网访问需要以 Lan 模式启动' });
    }
    if (Object.keys(req.query).length || req.method !== 'GET' && (!req.is('application/json') || req.get('x-toolbox-integration') !== '1')) {
        return res.status(403).json({ error: 'forbidden', message: '请从工具箱页面执行操作，不接受附加查询参数' });
    }
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
    next();
}

export function createIntegrationServices({ config = createIntegrationConfig(), yoinksOptions = {}, freeOptions = {}, artcraftOptions = {} } = {}) {
    const yoinks = createYoinksService({ config, ...yoinksOptions });
    const freellmapi = createFreeLlmService({ config, ...freeOptions });
    const artcraft = createArtcraftService({ config, ...artcraftOptions });
    return { yoinks, freellmapi, artcraft, async dispose() { freellmapi.dispose(); await yoinks.dispose(); } };
}

export function registerIntegrationApi(app, { service = createIntegrationServices(), access = createToolAccess(), log = entry => console.info('[integrations]', JSON.stringify(entry)) } = {}) {
    const router = express.Router(); router.use((req, res, next) => requireLocalIntegrationRequest(req, res, next, access));
    const action = (name, fn, mode = 'json') => async (req, res) => {
        const controller = new AbortController();
        const cancel = () => { if (!res.writableEnded) controller.abort(); };
        res.once('close', cancel);
        const emit = event => {
            if (controller.signal.aborted || res.destroyed) return;
            if (res.writableLength > 128 * 1024) { controller.abort(); return; }
            if (!res.headersSent) { res.type('application/x-ndjson'); res.setHeader('X-Accel-Buffering', 'no'); }
            res.write(JSON.stringify(event) + '\n');
        };
        try {
            const result = await fn(req, controller.signal, emit);
            if (controller.signal.aborted) { result?.stream?.destroy(); if (!res.destroyed) res.destroy(); return; }
            if (mode === 'stream') { if (!res.headersSent) throw problem('invalid_output', '操作未返回结果', 502); res.end(); }
            else if (mode === 'file') {
                res.setHeader('Content-Disposition', `attachment; filename="download${result.name.endsWith('.mp3') ? '.mp3' : '.media'}"; filename*=UTF-8''${encodeURIComponent(result.name).replace(/['()*]/g, c => '%' + c.charCodeAt(0).toString(16))}`);
                res.setHeader('Content-Length', result.size); res.type('application/octet-stream');
                await pipeline(result.stream, res, { signal: controller.signal });
            } else res.json(result);
            // 仅记动作；不记录链接、路径、密钥、问题、模型输出或上游原始错误。
            if (req.method !== 'GET') log({ action: name, ok: true });
        } catch (error) {
            const safe = error instanceof IntegrationError ? error : problem('internal_error', '开源工具操作失败，请检查组件状态或服务器配置', 500);
            log({ action: name, ok: false, code: safe.code });
            if (!controller.signal.aborted && !res.destroyed) {
                if (res.headersSent) { if (mode === 'stream') { emit({ type: 'error', error: safe.code, message: safe.message }); res.end(); } else res.destroy(); }
                else res.status(safe.status).json({ error: safe.code, message: safe.message, ...(Array.isArray(safe.attempts) ? { attempts: safe.attempts } : {}) });
            }
        } finally { res.removeListener('close', cancel); }
    };
    router.get('/yoinks/config', action('yoinks_config', () => service.yoinks.tools()));
    router.get('/yoinks/resolvers', action('yoinks_resolvers', () => service.yoinks.resolvers?.() ?? { resolvers: [] }));
    router.put('/yoinks/config', action('yoinks_configure', (req, signal) => service.yoinks.configure(req.body, signal)));
    router.post('/yoinks/analyze', action('yoinks_analyze', (req, signal) => service.yoinks.analyze(req.body, signal)));
    router.post('/yoinks/download', action('yoinks_download', (req, signal, emit) => service.yoinks.download(req.body, signal, emit), 'stream'));
    router.get('/yoinks/results/:id/file', action('yoinks_file', req => service.yoinks.openResult(req.params.id), 'file'));
    router.post('/yoinks/results/:id/remove', action('yoinks_remove', req => {
        if (!req.body || Object.keys(req.body).length) throw problem('invalid_input', '清理下载不接受其他字段');
        return service.yoinks.removeResult(req.params.id);
    }));
    router.get('/freellmapi/config', action('free_config', () => service.freellmapi.getConfig()));
    router.put('/freellmapi/config', action('free_configure', req => service.freellmapi.configure(req.body)));
    router.get('/freellmapi/models', action('free_models', (_req, signal) => service.freellmapi.models(signal)));
    router.post('/freellmapi/chat', action('free_chat', (req, signal, emit) => service.freellmapi.chat(req.body, signal, emit), 'stream'));
    router.get('/artcraft/config', action('artcraft_config', () => service.artcraft.getConfig()));
    router.put('/artcraft/config', action('artcraft_configure', req => service.artcraft.configure(req.body)));
    router.post('/artcraft/launch', action('artcraft_launch', req => service.artcraft.launch(req.body)));
    app.use('/api/integrations', router);
    return service;
}
