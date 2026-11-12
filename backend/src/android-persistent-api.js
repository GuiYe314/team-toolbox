import { AdbError } from './android-adb-protocol.js';

/** 此 router 已由安卓网络/同源/专用头策略保护。 */
export function registerPersistentApi(router, service) {
    const action = fn => async (req, res) => {
        const controller = new AbortController();
        const abort = () => { if (!res.writableEnded) controller.abort(); };
        res.once('close', abort);
        try {
            if (Object.keys(req.query).length) throw new AdbError('invalid_input', '文件接口不接受附加查询参数');
            const result = await fn(req, res, controller.signal);
            if (!controller.signal.aborted && !res.headersSent) res.json(result);
        } catch (error) {
            if (!controller.signal.aborted && !res.headersSent) res.status(error instanceof AdbError ? error.status : 500).json({
                error: error instanceof AdbError ? error.code : 'internal_error',
                message: error instanceof AdbError ? error.message : '应用文件操作失败，请检查服务器'
            });
            else if (!res.writableEnded) res.destroy();
            if (!(error instanceof AdbError)) console.error('[android-persistent] operation_failed');
        } finally { res.removeListener('close', abort); }
    };
    router.post('/persistent/list', action((req, _res, signal) => service.listPersistent(req.body, signal)));
    router.post('/persistent/inspect', action((req, _res, signal) => service.inspectPersistent(req.body, signal)));
    router.post('/persistent/read', action((req, res, signal) => service.readPersistent(req.body, signal, meta => new Promise((resolve, reject) => {
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('X-File-SHA256', meta.sha256);
        res.type('application/octet-stream');
        res.download(meta.file, meta.fileName, error => error ? reject(error) : resolve());
    }))));
    router.post('/persistent/upload', action((req, _res, signal) => {
        if (!req.is('application/octet-stream')) throw new AdbError('invalid_input', '请选择文件后确认传送');
        let input;
        try { input = JSON.parse(decodeURIComponent(req.get('x-toolbox-persistent') || '')); }
        catch { throw new AdbError('invalid_input', '文件传送参数无效'); }
        const size = req.get('content-length');
        if (size !== undefined && size !== String(input?.size)) throw new AdbError('invalid_input', '文件大小与传送内容不符');
        return service.uploadPersistent(input, req, signal);
    }));
}
