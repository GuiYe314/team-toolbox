import express from 'express';
import { createToolAccess } from './tool-access.js';
import { createPortViewer, PortViewerError } from './port-viewer.js';

export function registerPortViewerApi(app, { service = createPortViewer(), access = createToolAccess() } = {}) {
    const router = express.Router();
    router.use((req, res, next) => {
        res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
        if (!access.allows(req, { browser: true })) return access.deny(res);
        if (req.method !== 'GET' || Object.keys(req.query).length || req.get('x-toolbox-ports') !== '1') {
            return res.status(403).json({ error: 'forbidden', message: '请从工具箱端口查看页面读取，不接受附加参数或写操作' });
        }
        next();
    });
    router.get('/snapshot', async (_req, res) => {
        const controller = new AbortController();
        const cancel = () => { if (!res.writableEnded) controller.abort(); };
        res.once('close', cancel);
        try {
            const snapshot = await service.read(controller.signal);
            if (!res.destroyed && !controller.signal.aborted) res.json(snapshot);
        } catch (error) {
            if (!res.destroyed && !controller.signal.aborted) res.status(error instanceof PortViewerError ? error.status : 503)
                .json({ error: error instanceof PortViewerError ? error.code : 'read_failed', message: error instanceof PortViewerError ? error.message : '端口读取失败，请稍后重试' });
        } finally { res.removeListener('close', cancel); }
    });
    app.use('/api/ports', router);
    return service;
}
