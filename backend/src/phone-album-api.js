import express from 'express';
import { createToolAccess } from './tool-access.js';
import { createPhoneAlbumService } from './phone-album.js';
import { ALBUM_LIMITS, AlbumError } from './phone-album-protocol.js';

export function registerPhoneAlbumApi(app, { getDb, access = createToolAccess(), service = createPhoneAlbumService({ getDb }) } = {}) {
    const router = express.Router();
    router.use((req, res, next) => {
        res.set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
        if (!access.allows(req, { browser: true })) return access.deny(res);
        if (req.get('x-toolbox-album') !== '1' || Object.keys(req.query).length) return res.status(403).json({ error: 'forbidden', message: '请在工具箱相册上传页面操作' });
        next();
    });
    const wrap = fn => async (req, res) => {
        try { await fn(req, res); }
        catch (error) {
            if (res.destroyed || res.writableEnded) return;
            res.status(error instanceof AlbumError ? error.status : 500).json({ error: error instanceof AlbumError ? error.code : 'upload_failed', message: error instanceof AlbumError ? error.message : '相册接收失败，请稍后重试' });
        }
    };
    const json = express.json({ limit: '2kb' });
    router.get('/config', wrap((req, res) => {
        const host = new URL(`http://${req.headers.host}`), protocol = req.socket.encrypted ? 'https:' : 'http:';
        res.json({ allowLan: access.allowLan, origins: access.addresses().map(ip => `${protocol}//${ip}${host.port ? ':' + host.port : ''}`), limits: ALBUM_LIMITS });
    }));
    router.post('/sessions', json, wrap((req, res) => {
        if (!req.is('application/json')) throw new AlbumError('invalid_input', '创建接收会话需要 JSON 参数');
        if (!access.allowLan) throw new AlbumError('lan_required', '手机扫码需要以 Lan 模式启动工具箱', 409);
        res.status(201).json(service.create(req.body));
    }));
    router.get('/sessions/:id', wrap((req, res) => res.json(service.status(req.params.id, req.get('x-toolbox-album-manage') || req.get('x-toolbox-album-token'), req.get('x-toolbox-album-manage') ? 'manage' : 'upload'))));
    router.delete('/sessions/:id', wrap(async (req, res) => res.json(await service.stop(req.params.id, req.get('x-toolbox-album-manage')))));
    router.post('/sessions/:id/files', wrap(async (req, res) => {
        if (!req.is('application/octet-stream')) throw new AlbumError('invalid_input', '请选择照片或视频文件');
        let metadata;
        try {
            const raw = req.get('x-toolbox-album-file');
            if (!raw || raw.length > 4096) throw new Error();
            metadata = JSON.parse(decodeURIComponent(raw));
        } catch { throw new AlbumError('invalid_input', '文件信息无效'); }
        const controller = new AbortController();
        const cancel = () => { if (!res.writableEnded) controller.abort(); };
        res.once('close', cancel);
        try { res.status(201).json(await service.upload(req, req.params.id, req.get('x-toolbox-album-token'), metadata, controller.signal)); }
        finally { res.removeListener('close', cancel); }
    }));
    router.use((error, _req, res, _next) => {
        const tooLarge = error.type === 'entity.too.large';
        res.status(tooLarge ? 413 : 400).json({ error: 'invalid_input', message: tooLarge ? '接收配置过大' : '接收配置格式无效' });
    });
    app.use('/api/phone-album', router);
    return service;
}
