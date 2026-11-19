import express from 'express';
import { createToolAccess } from './tool-access.js';
import { MediaToolError } from './media-tool-error.js';
import { createVideoPresets } from './video-presets.js';

export function registerVideoPresetsApi(app, { service = createVideoPresets(), access = createToolAccess(), log = () => {} } = {}) {
    const router = express.Router();
    router.use((req, res, next) => {
        res.set('Cache-Control', 'no-store').set('X-Content-Type-Options', 'nosniff');
        if (!access.allows(req, { browser: true })) return access.deny(res);
        if (req.get('x-toolbox-media') !== '1') return res.status(403).json({ message: '请从工具箱视频处理页面操作' });
        if (Object.keys(req.query).length || (req.method !== 'GET' && !req.is('application/json'))) return res.status(400).json({ message: '模板请求格式无效' });
        next();
    });
    router.use(express.json({ limit: '8kb', strict: true }));
    const wrap = work => (req, res) => {
        try { work(req, res); }
        catch (error) {
            log({ action: 'video_presets', ok: false, code: error instanceof MediaToolError ? error.status : 503 });
            res.status(error instanceof MediaToolError ? error.status : 503).json({ message: error instanceof MediaToolError ? error.message : '模板读取或保存失败，请重试' });
        }
    };
    router.get('/', wrap((_req, res) => res.json({ items: service.list() })));
    router.post('/', wrap((req, res) => res.status(201).json({ item: service.save(req.body) })));
    router.put('/:id', wrap((req, res) => res.json({ item: service.save(req.body, req.params.id) })));
    router.delete('/:id', wrap((req, res) => { service.remove(req.params.id, req.body); res.json({ deleted: true }); }));
    router.use((error, _req, res, _next) => res.status(error.status === 413 ? 413 : 400).json({ message: error.status === 413 ? '模板参数超过8KiB限制' : '模板JSON格式无效' }));
    app.use('/api/video-presets', router);
}
