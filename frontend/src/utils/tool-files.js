export function downloadBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a'); link.href = url; link.download = name; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function formatSize(size = 0) {
    if (!size) return '0 B';
    const unit = Math.min(3, Math.floor(Math.log(size) / Math.log(1024)));
    return `${(size / 1024 ** unit).toFixed(unit ? 1 : 0)} ${['B', 'KiB', 'MiB', 'GiB'][unit]}`;
}
export function uploadMedia(file, kind, options, signal, onProgress, subtitle) {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest(), form = new FormData();
        form.append('options', JSON.stringify(options)); form.append('file', file);
        if (subtitle) form.append('subtitle', subtitle);
        const abort = () => xhr.abort();
        const done = () => signal?.removeEventListener('abort', abort);
        xhr.open('POST', `/api/media-tools/${kind}`); xhr.responseType = 'blob'; xhr.timeout = 660_000;
        xhr.setRequestHeader('X-Toolbox-Media', '1');
        xhr.upload.onprogress = event => onProgress?.(event.lengthComputable ? Math.min(100, Math.round(event.loaded / event.total * 100)) : 0);
        xhr.onload = async () => {
            done();
            if (xhr.status < 200 || xhr.status >= 300) {
                let message = '处理失败，请检查文件或稍后重试';
                try { message = JSON.parse(await xhr.response.text()).message || message; } catch { /* 保留可恢复错误 */ }
                reject(new Error(message)); return;
            }
            let name = '处理结果'; try { name = decodeURIComponent(xhr.getResponseHeader('X-Toolbox-Result-Name') || name); } catch { /* 使用默认名 */ }
            resolve({ blob: xhr.response, name });
        };
        xhr.onerror = () => { done(); reject(new Error('网络连接失败，请检查工具箱服务')); };
        xhr.ontimeout = () => { done(); reject(new Error('处理超时，请缩短视频或减小尺寸')); };
        xhr.onabort = () => { done(); reject(new DOMException('已停止', 'AbortError')); };
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) { done(); reject(new DOMException('已停止', 'AbortError')); return; }
        xhr.send(form);
    });
}
