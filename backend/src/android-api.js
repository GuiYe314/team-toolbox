import express from 'express';
import { AdbError, createAndroidAdbService } from './android-adb.js';
import { createToolAccess } from './tool-access.js';
import { registerPersistentApi } from './android-persistent-api.js';
import { registerApkQueueApi } from './android-apk-queue-api.js';

/** 按启动模式校验真实来源，保留专用头及 APK 上传边界。 */
export function requireLocalAndroidRequest(req, res, next, access = createToolAccess()) {
    if (!access.allows(req, { browser: true })) {
        return res.status(403).json({ error: access.allowLan ? 'access_denied' : 'local_only', message: '请在同源工具箱页面操作 ADB；局域网访问需要以 Lan 模式启动' });
    }
    const apkUpload = req.method === 'POST' && ['/apk/install', '/apk/install-batch', '/apk/install-many', '/apk/inspect', '/persistent/upload'].includes(req.path) && req.is('application/octet-stream');
    if (req.method !== 'GET' && ((!req.is('application/json') && !apkUpload) || req.get('x-toolbox-adb') !== '1')) {
        return res.status(403).json({ error: 'forbidden', message: '请从工具箱安卓调试页面执行操作' });
    }
    res.setHeader('Cache-Control', 'no-store');
    next();
}

export function registerAndroidApi(app, { service = createAndroidAdbService(), access = createToolAccess() } = {}) {
    const router = express.Router();
    router.use((req, res, next) => requireLocalAndroidRequest(req, res, next, access));
    registerPersistentApi(router, service);
    registerApkQueueApi(router, service);
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
    router.post('/apk/inspect', action((req, signal) => {
        if (!req.is('application/octet-stream') || Object.keys(req.query).length) throw new AdbError('invalid_input', '请从查看 APK 包名面板选择文件');
        let fileName;
        try { fileName = decodeURIComponent(req.get('x-toolbox-apk-name') || ''); }
        catch { throw new AdbError('invalid_input', 'APK 文件名无效'); }
        const sizeText = req.get('x-toolbox-apk-size') || '';
        if (!/^[1-9][0-9]{0,12}$/.test(sizeText) || req.get('content-length') && req.get('content-length') !== sizeText) throw new AdbError('invalid_input', 'APK 文件大小无效或传送不完整');
        return service.inspectApkPackage({ fileName, size: Number(sizeText) }, req, signal);
    }));
    router.post('/apk/install', action((req, signal) => {
        if (!req.is('application/octet-stream') || Object.keys(req.query).length) throw new AdbError('invalid_input', '请从 APK 安装面板选择文件并确认');
        let fileName;
        try { fileName = decodeURIComponent(req.get('x-toolbox-apk-name') || ''); }
        catch { throw new AdbError('invalid_input', 'APK 文件名无效'); }
        const sizeText = req.get('x-toolbox-apk-size') || '';
        if (!/^[1-9][0-9]{0,12}$/.test(sizeText) || (req.get('content-length') && req.get('content-length') !== sizeText)) throw new AdbError('invalid_input', 'APK 文件大小无效或传送不完整');
        return service.installApk({ serial: req.get('x-toolbox-adb-serial'), fileName, size: Number(sizeText), confirm: req.get('x-toolbox-adb-confirm') === '1' }, req, signal);
    }));
    router.post('/apk/install-batch', async (req, res) => {
        const controller = new AbortController();
        const cancel = () => { if (!res.writableEnded) controller.abort(); };
        res.once('close', cancel);
        const update = event => {
            if (controller.signal.aborted || res.destroyed) return;
            if (!res.headersSent) {
                res.type('application/x-ndjson'); res.setHeader('X-Content-Type-Options', 'nosniff');
                res.setHeader('X-Accel-Buffering', 'no');
            }
            res.write(JSON.stringify(event) + '\n');
        };
        try {
            if (!req.is('application/octet-stream') || Object.keys(req.query).length || req.get('x-toolbox-adb-serial')) throw new AdbError('invalid_input', '请选择 APK 文件和明确的设备列表后确认');
            let fileName, serials;
            try { fileName = decodeURIComponent(req.get('x-toolbox-apk-name') || ''); serials = JSON.parse(req.get('x-toolbox-adb-serials') || ''); }
            catch { throw new AdbError('invalid_input', 'APK 文件名或设备列表无效'); }
            const sizeText = req.get('x-toolbox-apk-size') || '';
            if (!/^[1-9][0-9]{0,12}$/.test(sizeText) || req.get('content-length') && req.get('content-length') !== sizeText) throw new AdbError('invalid_input', 'APK 文件大小无效或传送不完整');
            const result = await service.installApkBatch({ serials, fileName, size: Number(sizeText), confirm: req.get('x-toolbox-adb-confirm') === '1' }, req, controller.signal, update);
            if (!controller.signal.aborted) { update({ type: 'complete', result }); res.end(); }
        } catch (error) {
            if (!controller.signal.aborted && !res.destroyed) {
                const body = { error: error instanceof AdbError ? error.code : 'internal_error', message: error instanceof AdbError ? error.message : '批量安装失败，请检查服务和手机状态' };
                if (res.headersSent) { update({ type: 'error', ...body }); res.end(); }
                else res.status(error instanceof AdbError ? error.status : 500).json(body);
            }
            if (!(error instanceof AdbError)) console.error('[android-adb] batch installation failed');
        } finally { res.removeListener('close', cancel); }
    });
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
