// Blob只组合文件引用；不把整批APK读入JS内存。
export function installApks(files, serials, jobs, signal, onProgress = () => {}, onUpdate = () => {}) {
    const metadata = new TextEncoder().encode(JSON.stringify({ files: files.map(file => ({ fileName: file.name, size: file.size })), serials, jobs, confirm: true }));
    if (metadata.byteLength > 64 * 1024) return Promise.reject(new Error('安装文件与设备信息过长，请减少本次选择'));
    const prefix = new Uint8Array(8); prefix.set([84, 84, 65, 80]); new DataView(prefix.buffer).setUint32(4, metadata.byteLength);
    const payload = new Blob([prefix, metadata, ...files], { type: 'application/octet-stream' });
    return new Promise((resolve, reject) => {
        if (signal?.aborted) { reject(new Error('多 APK 安装已取消')); return; }
        const xhr = new XMLHttpRequest(), expected = new Set(jobs.map(job => JSON.stringify([job.serial, job.fileIndex]))), finished = new Map();
        let settled = false, offset = 0, complete;
        const abort = () => xhr.abort();
        const finish = (error, result) => { if (settled) return; settled = true; signal?.removeEventListener('abort', abort); error ? reject(error) : resolve(result); };
        xhr.open('POST', '/api/android/apk/install-many'); xhr.timeout = 3960000;
        xhr.setRequestHeader('Content-Type', 'application/octet-stream'); xhr.setRequestHeader('X-Toolbox-Adb', '1'); xhr.setRequestHeader('X-Toolbox-Adb-Confirm', '1');
        xhr.upload.onprogress = event => { if (!settled && event.lengthComputable) onProgress(Math.round(event.loaded * 100 / event.total), 'upload'); };
        xhr.upload.onload = () => { if (!settled) onProgress(100, 'install'); };
        const updates = () => {
            if (settled || xhr.status !== 200 || !xhr.getResponseHeader('Content-Type')?.startsWith('application/x-ndjson')) return;
            try {
                if (xhr.responseText.length > 32 * 1024 * 1024) throw new Error('安装结果超出读取上限，请核对手机状态');
                let end;
                while ((end = xhr.responseText.indexOf('\n', offset)) !== -1) {
                    const event = JSON.parse(xhr.responseText.slice(offset, end)); offset = end + 1;
                    if (complete) throw new Error('安装汇总后的响应无效，请核对手机状态');
                    if (event.type === 'error') throw new Error(event.message || '安装队列已中断，请核对手机状态');
                    if (event.type === 'complete') { complete = event.result; continue; }
                    if (event.type !== 'device') continue;
                    const result = event.result, key = JSON.stringify([result?.serial, result?.fileIndex]);
                    if (!expected.has(key) || finished.has(key) || !['installing', 'success', 'failed'].includes(result.status)) throw new Error('安装结果与已确认的任务不一致');
                    if (result.status !== 'installing') finished.set(key, result.status);
                    onUpdate(result);
                }
            } catch (error) { finish(error instanceof SyntaxError ? new Error('安装响应不完整，请核对手机状态') : error); xhr.abort(); }
        };
        xhr.onprogress = updates;
        xhr.onload = () => {
            updates(); if (settled) return;
            const succeeded = [...finished.values()].filter(status => status === 'success').length;
            if (xhr.status === 200 && complete?.message && offset === xhr.responseText.length && complete.total === expected.size
                && finished.size === expected.size && complete.succeeded === succeeded && complete.failed === finished.size - succeeded) finish(null, complete);
            else { let body; try { body = JSON.parse(xhr.responseText); } catch {} finish(new Error(body?.message || '未收到完整安装结果，请核对手机实际状态')); }
        };
        xhr.onerror = () => finish(new Error('安装连接中断，请核对手机实际状态后重试'));
        xhr.ontimeout = () => finish(new Error('安装队列超时，请核对手机实际状态'));
        xhr.onabort = () => finish(new Error('多 APK 安装已取消，已完成安装不回滚'));
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) { finish(new Error('多 APK 安装已取消')); return; }
        xhr.send(payload);
    });
}
