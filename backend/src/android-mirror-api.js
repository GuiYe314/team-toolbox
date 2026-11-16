import { AdbError } from './android-adb-protocol.js';
export function registerMirrorApi(router, service) {
    const action = fn => async (req, res) => {
        if (req.get('x-toolbox-adb') !== '1' || Object.keys(req.query).length) return res.status(403).json({ message: '请从工具箱安卓投屏页面操作' });
        const controller = new AbortController(), cancel = () => { if (!res.writableEnded) controller.abort(); };
        res.once('close', cancel);
        try {
            const result = await fn(req, res, controller.signal);
            if (!res.headersSent && !controller.signal.aborted) res.json(result || { ok: true });
        } catch (error) {
            if (!res.headersSent && !controller.signal.aborted) res.status(error instanceof AdbError ? error.status : 500).json({ message: error instanceof AdbError ? error.message : '安卓投屏失败，请检查手机连接' });
        } finally { res.removeListener('close', cancel); }
    };
    router.get('/mirror/capabilities', action(() => service.mirrorCapabilities()));
    router.post('/mirror', action((req, _res, signal) => {
        if (req.body?.confirmed !== true || Object.keys(req.body).some(key => !['serial', 'confirmed'].includes(key))) throw new AdbError('invalid_input', '请确认目标手机并启动投屏');
        return service.startMirror(req.body.serial, signal);
    }));
    router.get('/mirror/:id/video', action((req, res) => service.attachMirror(req.params.id, res)));
    router.get('/mirror/:id', action(req => service.mirrorHeartbeat(req.params.id)));
    router.post('/mirror/:id/control', action(req => service.controlMirror(req.params.id, req.body)));
    router.delete('/mirror/:id', action(async req => { await service.stopMirror(req.params.id); return { ok: true }; }));
}
