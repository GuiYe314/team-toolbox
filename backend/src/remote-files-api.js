import express from 'express';
import { createToolAccess } from './tool-access.js';
import { createRemoteFilesService } from './remote-files.js';
import { invalid, RemoteFilesError, remoteFailure } from './remote-files-protocol.js';

export function registerRemoteFilesApi(app, { access = createToolAccess(), service = createRemoteFilesService() } = {}) {
    const router = express.Router();
    router.use((req, res, next) => {
        res.set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
        if (!access.allows(req, { browser: true })) return access.deny(res);
        const download = req.method === 'GET' && /^\/downloads\/[a-f0-9]{48}$/.test(req.path);
        if (!download && req.get('x-toolbox-remote') !== '1') return res.status(403).json({ error: 'forbidden', message: '请从工具箱FTP客户端操作' });
        if (Object.keys(req.query).some(key => key !== 'path') || (Object.keys(req.query).length && !(req.method === 'GET' && /^\/sessions\/[a-f0-9]{32}\/entries$/.test(req.path)))) return res.status(400).json({ error: 'invalid_input', message: '不支持的请求参数' });
        next();
    });
    const json = [express.json({ limit: '8kb' }), (req, _res, next) => next(req.is('application/json') ? undefined : invalid('需要JSON请求内容'))];
    const wrap = fn => async (req, res) => {
        const c = new AbortController(), abort = () => { if (!res.writableEnded) c.abort(); };
        res.once('close', abort);
        try { const result = await fn(req, res, c.signal); if (!res.writableEnded && !res.destroyed) res.json(result); }
        catch (error) { if (res.destroyed || res.writableEnded) return; if (res.headersSent) return res.destroy(); const safe = remoteFailure(error); res.status(safe.status).json({ error: safe.code, message: safe.message }); }
        finally { res.removeListener('close', abort); }
    };
    const secret = req => req.get('x-toolbox-remote-token');
    const confirmed = req => { if (req.body?.confirm !== true || Object.keys(req.body).length !== 1) throw invalid('请确认关闭连接'); };
    router.post('/probe', ...json, wrap((req, _res, signal) => service.probe(req.body, signal)));
    router.post('/sessions', ...json, wrap(async (req, res, signal) => {
        const session = await service.connect(req.body, signal);
        if (signal.aborted || res.destroyed) { await service.disconnect(session.id, session.token); throw invalid('连接已取消'); }
        return session;
    }));
    router.get('/sessions/:id', wrap(req => service.status(req.params.id, secret(req))));
    router.get('/sessions/:id/entries', wrap((req, _res, signal) => service.entries(req.params.id, secret(req), req.query.path, signal)));
    router.post('/sessions/:id/alter', ...json, wrap((req, _res, signal) => service.alter(req.params.id, secret(req), req.body, signal)));
    router.post('/sessions/:id/transfers', ...json, wrap((req, _res, signal) => service.prepare(req.params.id, secret(req), req.body, signal)));
    router.post('/sessions/:id/uploads/:job', wrap((req, _res, signal) => {
        if (!req.is('application/octet-stream')) throw invalid('需要文件二进制内容');
        return service.upload(req, req.params.id, secret(req), req.params.job, signal);
    }));
    router.post('/sessions/:id/cancel', ...json, wrap(req => { confirmed(req); return service.cancel(req.params.id, secret(req)); }));
    router.delete('/sessions/:id', ...json, wrap(req => { confirmed(req); return service.disconnect(req.params.id, secret(req)); }));
    router.get('/downloads/:ticket', wrap((req, res, signal) => service.download(req.params.ticket, res, signal)));
    router.use((error, _req, res, _next) => {
        const safe = error instanceof RemoteFilesError ? error : new RemoteFilesError('invalid_input', error.type === 'entity.too.large' ? '请求配置过大' : '请求配置格式无效', error.type === 'entity.too.large' ? 413 : 400);
        res.status(safe.status).json({ error: safe.code, message: safe.message });
    });
    app.use('/api/remote-files', router); return service;
}
