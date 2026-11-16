import express from 'express';
import { createToolAccess } from './tool-access.js';
import { createTransferRooms, TransferError } from './transfer-rooms.js';
export function registerTransferApi(app, { access = createToolAccess(), service = createTransferRooms() } = {}) {
    const router = express.Router();
    router.use((req, res, next) => {
        res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
        if (!access.allows(req, { browser: true })) return access.deny(res);
        if (req.get('x-toolbox-transfer') !== '1') return res.status(403).json({ message: '请从工具箱双向互传页面操作' });
        if (req.method !== 'GET' && (!req.is('application/json') || Buffer.byteLength(JSON.stringify(req.body || {})) > 40 * 1024)) return res.status(400).json({ message: '请求内容无效或过长' });
        next();
    });
    const action = fn => (req, res) => { try { res.json(fn(req)); } catch (error) { res.status(error instanceof TransferError ? error.status : 500).json({ message: error instanceof TransferError ? error.message : '互传连接失败' }); } };
    router.get('/config', action(req => {
        const port = new URL(`http://${req.get('host')}`).port;
        return { allowLan: access.allowLan, addresses: access.addresses().map(address => `http://${address}${port ? ':' + port : ''}`) };
    }));
    router.post('/rooms', action(() => service.create()));
    router.post('/rooms/:id/join', action(req => service.join(req.params.id, req.body.invite)));
    router.get('/rooms/:id', action(req => service.poll(req.params.id, req.get('x-toolbox-transfer-token'), Number(req.query.after || 0))));
    router.post('/rooms/:id/signal', action(req => service.signal(req.params.id, req.get('x-toolbox-transfer-token'), req.body.kind, req.body.payload)));
    router.delete('/rooms/:id', action(req => service.close(req.params.id, req.get('x-toolbox-transfer-token'))));
    app.use('/api/transfer', router); return service;
}
