import express from 'express';
import { rm, stat } from 'node:fs/promises';
import { createToolAccess } from './tool-access.js';
import { MediaToolError, MEDIA_LIMITS, receiveToolFile, processImage, processVideo } from './media-tools.js';

export function registerMediaToolsApi(app, { access = createToolAccess(), videoProcessor = processVideo, timeoutMs = MEDIA_LIMITS.timeout, log = entry => console.info('[media-tools]', JSON.stringify(entry)) } = {}) {
    const active = new Set();
    const completions = new Map();
    const router = express.Router();
    router.use((req, res, next) => {
        res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
        if (!access.allows(req, { browser: true })) return access.deny(res);
        if (req.get('x-toolbox-media') !== '1' || Object.keys(req.query).length) return res.status(403).json({ message: '请从工具箱媒体处理页面操作' });
        next();
    });
    router.post('/:kind', async (req, res) => {
        const kind = req.params.kind;
        if (!['image', 'video'].includes(kind) || !req.is('multipart/form-data')) return res.status(400).json({ message: '请选择图片或视频文件' });
        if (active.size >= 2) return res.status(409).json({ message: '已有两个处理任务，请稍后重试' });
        const controller = new AbortController(); active.add(controller);
        let complete;
        completions.set(controller, new Promise(resolve => { complete = resolve; }));
        const cancel = () => { if (!res.writableEnded) controller.abort(); };
        res.once('close', cancel);
        const deadline = setTimeout(() => controller.abort(new MediaToolError('文件接收或处理超时，请减小文件或缩短视频后重试', 408)), timeoutMs);
        let file;
        try {
            file = await receiveToolFile(req, { maxBytes: MEDIA_LIMITS[kind], signal: controller.signal });
            const result = kind === 'image' ? await processImage(file, controller.signal) : await videoProcessor(file, controller.signal);
            controller.signal.throwIfAborted();
            if ((await stat(result.output)).size > MEDIA_LIMITS.output) throw new MediaToolError('处理结果超过256MiB限制', 413);
            res.type(result.type).set('X-Toolbox-Result-Name', encodeURIComponent(result.name));
            await new Promise((resolve, reject) => res.sendFile(result.output, error => error ? reject(error) : resolve()));
            log({ kind, ok: true });
        } catch (error) {
            log({ kind, ok: false, code: controller.signal.aborted ? 'cancelled' : String(error.status || 'failed') });
            const failure = controller.signal.aborted ? controller.signal.reason : error;
            if (!res.destroyed && !res.headersSent) res.status(failure instanceof MediaToolError ? failure.status : 422).json({ message: failure instanceof MediaToolError ? failure.message : '文件无法读取或处理，请检查格式与完整性' });
            else if (!res.destroyed) res.destroy();
        } finally {
            clearTimeout(deadline); res.removeListener('close', cancel);
            try { if (file) await rm(file.directory, { recursive: true, force: true }); }
            finally { active.delete(controller); completions.delete(controller); complete(); }
        }
    });
    app.use('/api/media-tools', router);
    return { dispose() {
        const pending = [...completions.values()];
        for (const controller of active) controller.abort(new MediaToolError('工具箱服务正在关闭，处理已停止', 503));
        return Promise.all(pending);
    } };
}
