import express from 'express';
import { createToolAccess } from './tool-access.js';
import { createNetworkSpeedMonitor } from './network-speed.js';

export function registerNetworkSpeedApi(app, { monitor = createNetworkSpeedMonitor(), access = createToolAccess() } = {}) {
    const router = express.Router();
    router.use((req, res, next) => {
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        if (!access.allows(req, { browser: true })) return access.deny(res);
        if (req.method !== 'GET' || Object.keys(req.query).length || req.get('x-toolbox-network-speed') !== '1') {
            return res.status(403).json({ error: 'forbidden', message: '请从工具箱实时网速页面读取，不接受附加参数' });
        }
        next();
    });
    router.get('/snapshot', (_req, res) => res.json(monitor.snapshot()));
    app.use('/api/network-speed', router);
    return monitor;
}
