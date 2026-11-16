import { createWorker } from 'tesseract.js';
// 外层 Worker 使模型加载期间也能立即停止；终止时同时释放其子 Worker。
self.onmessage = async ({ data }) => {
    let engine;
    try {
        engine = await createWorker(data.language, 1, {
            workerPath: new URL('/vendor/tools/ocr/worker.min.js', self.location.origin).href,
            corePath: new URL('/vendor/tools/ocr/core', self.location.origin).href,
            langPath: new URL('/vendor/tools/ocr/lang', self.location.origin).href,
            cacheMethod: 'none', workerBlobURL: false,
            logger: message => self.postMessage({ type: 'progress', status: message.status, progress: message.progress || 0 })
        });
        const result = await engine.recognize(data.file);
        self.postMessage({ type: 'result', text: result.data.text });
    } catch (error) { self.postMessage({ type: 'error', message: error.message || '文字识别失败' }); }
    finally { await engine?.terminate().catch(() => {}); }
};
