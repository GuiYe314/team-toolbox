import { AdbError } from './android-adb-protocol.js';
import { APK_QUEUE_HEADER_BYTES, APK_QUEUE_MAX_BYTES } from './android-apk-queue.js';

export function registerApkQueueApi(router, service) {
    router.post('/apk/install-many', async (req, res) => {
        const controller = new AbortController();
        const cancel = () => { if (!res.writableEnded) controller.abort(); };
        res.once('close', cancel);
        const update = event => {
            if (controller.signal.aborted || res.destroyed) return;
            if (res.writableLength > 128 * 1024) { controller.abort(); res.destroy(); throw new AdbError('slow_client', '安装结果接收过慢，队列已停止，请核对手机状态', 409); }
            if (!res.headersSent) { res.type('application/x-ndjson'); res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('X-Accel-Buffering', 'no'); }
            res.write(JSON.stringify(event) + '\n');
        };
        try {
            const size = req.get('content-length');
            if (!req.is('application/octet-stream') || Object.keys(req.query).length || req.get('x-toolbox-adb-confirm') !== '1'
                || !/^[1-9][0-9]{0,12}$/.test(size || '') || Number(size) > APK_QUEUE_MAX_BYTES + APK_QUEUE_HEADER_BYTES + 8) throw new AdbError('invalid_input', '请从安装面板选择多个 APK、核对全部设备与文件并确认');
            const result = await service.installApks(req, Number(size), controller.signal, update);
            if (!controller.signal.aborted && !res.destroyed) { update({ type: 'complete', result }); res.end(); }
        } catch (error) {
            if (!controller.signal.aborted && !res.destroyed) {
                const body = { error: error instanceof AdbError ? error.code : 'internal_error', message: error instanceof AdbError ? error.message : '多 APK 安装失败，请检查服务和手机状态' };
                if (res.headersSent) { update({ type: 'error', ...body }); res.end(); }
                else res.status(error instanceof AdbError ? error.status : 500).json(body);
            }
            if (!(error instanceof AdbError)) console.error('[android-adb] APK queue failed');
        } finally { res.removeListener('close', cancel); }
    });
}
