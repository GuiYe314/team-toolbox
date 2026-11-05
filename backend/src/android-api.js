import express from 'express';
import { AdbError, createAndroidAdbService } from './android-adb.js';

const loopback = (address) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address);
const localHost = (hostname) => ['127.0.0.1', 'localhost', '[::1]'].includes(hostname);

/** 不信任代理头：无账号阶段，只让服务器本机浏览器管理 ADB。 */
export function requireLocalAndroidRequest(req, res, next) {
    let host;
    try { host = new URL(`http://${req.headers.host}`).hostname; } catch { /* 无效 Host */ }
    const site = req.get('sec-fetch-site');
    let originAllowed = true;
    if (req.get('origin')) {
        try { originAllowed = localHost(new URL(req.get('origin')).hostname); } catch { originAllowed = false; }
    }
    if (!loopback(req.socket.remoteAddress) || !localHost(host) || !originAllowed || (site && !['same-origin', 'none'].includes(site))) {
        return res.status(403).json({ error: 'local_only', message: '安卓调试仅允许在服务器本机通过 localhost 或 127.0.0.1 打开工具箱使用' });
    }
    if (req.method !== 'GET' && (!req.is('application/json') || req.get('x-toolbox-adb') !== '1')) {
        return res.status(403).json({ error: 'forbidden', message: '请从工具箱安卓调试页面执行操作' });
    }
    res.setHeader('Cache-Control', 'no-store');
    next();
}

export function registerAndroidApi(app, { service = createAndroidAdbService() } = {}) {
    const router = express.Router();
    router.use(requireLocalAndroidRequest);
    const action = (fn, binary = false) => async (req, res) => {
        const controller = new AbortController();
        const cancel = () => { if (!res.writableEnded) controller.abort(); };
        res.once('close', cancel);
        try {
            const result = await fn(req, controller.signal);
            if (controller.signal.aborted) return;
            if (binary) {
                res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('X-Screen-Captured-At', result.capturedAt);
                res.type('image/png').send(result.data);
            } else res.json(result);
        }
        catch (error) {
            if (!controller.signal.aborted) {
                res.status(error instanceof AdbError ? error.status : 500).json({
                    error: error instanceof AdbError ? error.code : 'internal_error',
                    message: error instanceof AdbError ? error.message : '安卓调试操作失败，请查看服务器日志'
                });
                if (!(error instanceof AdbError)) console.error('[android-adb] unexpected operation failure');
            }
        } finally { res.removeListener('close', cancel); }
    };
    router.get('/config', action(() => service.getConfig()));
    router.post('/screen', action((req, signal) => {
        if (!req.body || Object.keys(req.body).some(key => key !== 'serial')) throw new AdbError('invalid_input', '请选择屏幕目标设备');
        return service.captureScreen(req.body.serial, signal);
    }, true));
    router.post('/apps', action((req, signal) => {
        if (!req.body || Object.keys(req.body).some(key => key !== 'serial')) throw new AdbError('invalid_input', '请选择应用目标设备');
        return service.listApps(req.body.serial, signal);
    }));
    router.post('/apps/status', action((req, signal) => {
        if (!req.body || Object.keys(req.body).some(key => !['serial', 'packageName'].includes(key))) throw new AdbError('invalid_input', '请选择应用与目标设备');
        return service.appStatus(req.body.serial, req.body.packageName, signal);
    }));
    router.post('/logcat', action((req, signal) => {
        if (!req.body || Object.keys(req.body).some(key => !['serial', 'packageName'].includes(key))) throw new AdbError('invalid_input', '请选择日志目标设备');
        return service.startLogcat(req.body.serial, signal, req.body.packageName);
    }));
    router.post('/logcat/:id/poll', action((req, signal) => service.pollLogcat(req.params.id, req.body?.after ?? 0, signal)));
    router.post('/logcat/:id/stop', action(req => service.stopLogcat(req.params.id)));
    router.get('/commands', action(() => service.commands()));
    router.post('/commands/home-apps', action((req, signal) => {
        if (!req.body || Object.keys(req.body).some(key => key !== 'serial')) throw new AdbError('invalid_input', '桌面应用查询只接受目标设备');
        return service.listHomeApps(req.body.serial, signal);
    }));
    router.post('/commands/custom', action(req => service.saveCommand(req.body)));
    router.put('/commands/custom/:id', action(req => service.saveCommand(req.body, req.params.id)));
    router.delete('/commands/custom/:id', action(req => {
        if (!req.body || Object.keys(req.body).some(key => !['confirm', 'revision'].includes(key))) throw new AdbError('invalid_input', '删除命令只接受确认和版本');
        return service.deleteCommand(req.params.id, req.body);
    }));
    router.post('/commands/execute', action((req, signal) => {
        if (!req.body || Object.keys(req.body).some((key) => !['id', 'serial', 'confirm', 'revision', 'component', 'userId'].includes(key))) {
            throw new AdbError('invalid_input', '常用命令只接受命令选项和目标设备');
        }
        return service.executeCommand(req.body, signal);
    }));
    router.put('/config', action((req, signal) => service.configure(req.body?.path, signal)));
    router.post('/search-folder', action((req, signal) => service.searchFolder(req.body?.folder, signal)));
    router.post('/qr', action((_req, signal) => service.startQr(signal)));
    router.post('/qr/:id/poll', action((req, signal) => service.pollQr(req.params.id, signal)));
    router.post('/qr/:id/cancel', action((req) => service.cancelQr(req.params.id)));
    router.get('/devices', action((_req, signal) => service.devices(signal)));
    router.post('/discover', action((_req, signal) => service.discover(signal)));
    router.post('/connect', action((req, signal) => service.connect(req.body?.endpoint, signal)));
    router.post('/pair', action((req, signal) => service.pair(req.body?.serviceId, req.body?.code, signal)));
    router.post('/disconnect', action((req, signal) => {
        if (req.body?.confirm !== true) throw new AdbError('invalid_input', '断开设备需要确认');
        return service.disconnect(req.body?.serial, signal);
    }));
    app.use('/api/android', router);
    return service;
}
