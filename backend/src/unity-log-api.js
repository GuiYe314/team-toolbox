import express from 'express';
import { pipeline } from 'node:stream/promises';
import { createUnityLogService } from './unity-logs.js';
import { UnityLogError } from './unity-log-http.js';
import { createToolAccess } from './tool-access.js';

export function requireLocalUnityLogRequest(req, res, next, access = createToolAccess()) {
    if (!access.allows(req, { browser: true })
        || !req.is('application/json') || req.get('x-toolbox-unity-log') !== '1')
        return res.status(403).json({ error: access.allowLan ? 'access_denied' : 'local_only', message: '请在同源工具箱页面使用 Unity 日志；局域网访问需要以 Lan 模式启动' });
    res.setHeader('Cache-Control', 'no-store'); next();
}
function fields(body, allowed) {
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !allowed.includes(key)))
        throw new UnityLogError('invalid_input', '日志请求参数无效');
    return body;
}
export function registerUnityLogApi(app, { service = createUnityLogService(), access = createToolAccess() } = {}) {
    const router = express.Router(); router.use((req, res, next) => requireLocalUnityLogRequest(req, res, next, access));
    const action = (fn, onCanceled) => async (req, res) => {
        const controller = new AbortController();
        const cancel = () => { if (!res.writableEnded) controller.abort(); }; res.once('close', cancel);
        try {
            const result = await fn(req, controller.signal);
            if (controller.signal.aborted) { result?.stream?.destroy(); onCanceled?.(result); return; }
            if (result?.stream) {
                res.type(result.contentType);
                res.setHeader('Content-Disposition', `attachment; filename="${result.name}"`);
                res.setHeader('X-Content-Type-Options', 'nosniff');
                if (result.length !== null) res.setHeader('Content-Length', result.length);
                await pipeline(result.stream, res, { signal: controller.signal });
            } else res.json(result);
        } catch (error) {
            if (controller.signal.aborted) return;
            if (res.headersSent || res.destroyed) { res.destroy(); return; }
            res.status(error instanceof UnityLogError ? error.status : 500).json({ error: error instanceof UnityLogError ? error.code : 'internal_error',
                message: error instanceof UnityLogError ? error.message : '日志读取失败，请重新搜索并检查设备连接' });
            if (!(error instanceof UnityLogError)) console.error('[unity-logs] operation failed');
        } finally { res.removeListener('close', cancel); }
    };
    router.post('/discover', action((req, signal) => {
        const { port = 17523, address = '' } = fields(req.body, ['port', 'address']);
        if (typeof address !== 'string' || address.length > 15) throw new UnityLogError('invalid_input', '指定设备 IP 无效');
        return service.discover({ port, address }, signal);
    }));
    router.post('/sessions', action((req, signal) => service.connect(fields(req.body, ['deviceId']).deviceId, signal), result => { if (result?.id) service.close(result.id); }));
    router.post('/sessions/:id/files', action((req, signal) => { fields(req.body, []); return service.files(req.params.id, signal); }));
    router.post('/sessions/:id/preview', action((req, signal) => service.preview(req.params.id, fields(req.body, ['name']).name, signal)));
    router.post('/sessions/:id/download', action((req, signal) => {
        const { name, archive = false } = fields(req.body, ['name', 'archive']);
        if (typeof archive !== 'boolean') throw new UnityLogError('invalid_input', '下载参数无效');
        return service.download(req.params.id, name, archive, signal);
    }));
    router.post('/sessions/:id/close', action(req => { fields(req.body, []); return service.close(req.params.id); }));
    app.use('/api/unity-logs', router);
    return service;
}
