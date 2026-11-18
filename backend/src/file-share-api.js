import express from 'express';
import { createToolAccess } from './tool-access.js';
import { createFileShareService } from './file-share.js';
import { FileShareError, shareFailure } from './file-share-paths.js';

export function registerFileShareApi(app, { access = createToolAccess(), service = createFileShareService() } = {}) {
    const router = express.Router();
    router.use((req, res, next) => {
        res.set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
        if (!access.allows(req, { browser: true })) return access.deny(res);
        const directDownload = req.method === 'GET' && /^\/downloads\/[a-f0-9]{48}$/.test(req.path);
        if (!directDownload && req.get('x-toolbox-share') !== '1') return res.status(403).json({ error: 'forbidden', message: '请从工具箱文件共享页面操作' });
        if (Object.keys(req.query).some(key => key !== 'path') || (Object.keys(req.query).length && !(req.method === 'GET' && /^\/shares\/[a-f0-9]{32}\/entries$/.test(req.path)))) return res.status(400).json({ error: 'invalid_input', message: '不支持的请求参数' });
        next();
    });
    const manage = (req, res, next) => req.get('x-toolbox-share-manage') === '1' ? next() : res.status(403).json({ error: 'forbidden', message: '请在工具箱文件共享管理页操作' });
    const json = [express.json({ limit: '8kb' }), (req, _res, next) => next(req.is('application/json') ? undefined : new FileShareError('invalid_input', '需要JSON请求内容'))];
    const wrap = fn => async (req, res) => {
        const controller = new AbortController(), abort = () => { if (!res.writableEnded) controller.abort(); };
        res.once('close', abort);
        try { const value = await fn(req, res, controller.signal); if (!res.writableEnded && !res.destroyed) res.json(value); }
        catch (error) {
            if (res.destroyed || res.writableEnded) return;
            if (res.headersSent) { res.destroy(); return; }
            const safe = shareFailure(error); res.status(safe.status).json({ error: safe.code, message: safe.message });
        } finally { res.removeListener('close', abort); }
    };
    router.get('/config', manage, wrap(req => {
        const host = new URL(`http://${req.headers.host}`), protocol = req.socket.encrypted ? 'https:' : 'http:';
        return { allowLan: access.allowLan, origins: access.addresses().map(ip => `${protocol}//${ip}${host.port ? ':' + host.port : ''}`), shares: service.list(), limits: service.limits };
    }));
    router.post('/shares', manage, ...json, wrap(async req => service.create(req.body)));
    router.delete('/shares/:id', manage, ...json, wrap(req => {
        if (req.body?.confirm !== true || Object.keys(req.body).length !== 1) throw new FileShareError('confirmation_required', '请确认停止共享');
        return service.stop(req.params.id);
    }));
    router.get('/shares/:id/entries', wrap((req, _res, signal) => service.entries(req.params.id, req.get('x-toolbox-share-token'), req.query.path ?? '', signal)));
    router.post('/shares/:id/folders', ...json, wrap((req, _res, signal) => service.newFolder(req.params.id, req.get('x-toolbox-share-token'), req.body, signal)));
    router.post('/shares/:id/downloads', ...json, wrap((req, _res, signal) => service.downloadTicket(req.params.id, req.get('x-toolbox-share-token'), req.body, signal)));
    router.post('/shares/:id/files', wrap((req, _res, signal) => {
        if (!req.is('application/octet-stream')) throw new FileShareError('invalid_input', '需要文件二进制内容');
        let input;
        try { const header = req.get('x-toolbox-share-file'); if (!header || header.length > 12000) throw new Error(); input = JSON.parse(decodeURIComponent(header)); }
        catch { throw new FileShareError('invalid_input', '文件信息无效'); }
        if (req.get('content-length') && Number(req.get('content-length')) !== input.size) throw new FileShareError('size_mismatch', '文件大小与声明不符');
        return service.upload(req, req.params.id, req.get('x-toolbox-share-token'), input, signal);
    }));
    router.get('/downloads/:ticket', wrap((req, res, signal) => service.download(req.params.ticket, res, signal)));
    router.use((error, _req, res, _next) => {
        const safe = error instanceof FileShareError ? error : new FileShareError('invalid_input', error.type === 'entity.too.large' ? '请求配置过大' : '请求配置格式无效', error.type === 'entity.too.large' ? 413 : 400);
        res.status(safe.status).json({ error: safe.code, message: safe.message });
    });
    app.use('/api/file-share', router); return service;
}
