async function request(path, input, signal, download = false) {
    const response = await fetch('/api/android/persistent/' + path, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Toolbox-Adb': '1' },
        body: JSON.stringify(input), signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(310000)])
    });
    if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.message || `文件操作失败（${response.status}）`);
    }
    return download ? response.blob() : response.json();
}

export const persistentApi = {
    list: (input, signal) => request('list', input, signal),
    inspect: (input, signal) => request('inspect', input, signal),
    preview: (input, signal) => request('read', { ...input, preview: true }, signal),
    download: (input, signal) => request('read', input, signal, true),
    upload(file, input, signal, progress) {
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            const abort = () => xhr.abort();
            const finish = (error, result) => { signal?.removeEventListener('abort', abort); error ? reject(error) : resolve(result); };
            xhr.open('POST', '/api/android/persistent/upload'); xhr.timeout = 320000;
            xhr.setRequestHeader('Content-Type', 'application/octet-stream');
            xhr.setRequestHeader('X-Toolbox-Adb', '1');
            xhr.setRequestHeader('X-Toolbox-Persistent', encodeURIComponent(JSON.stringify({ ...input, size: file.size, confirm: true })));
            xhr.upload.onprogress = event => { if (event.lengthComputable) progress(Math.round(event.loaded * 100 / event.total)); };
            xhr.upload.onload = () => progress(100);
            xhr.onload = () => {
                let body; try { body = JSON.parse(xhr.responseText); } catch { body = {}; }
                finish(xhr.status === 200 && body.message ? null : new Error(body.message || '未收到文件写入确认，请刷新并核对手机文件'), body);
            };
            xhr.onerror = () => finish(new Error('文件传送连接失败，请核对手机文件后重试'));
            xhr.ontimeout = () => finish(new Error('文件传送超时，请刷新并核对手机文件'));
            xhr.onabort = () => finish(new Error('文件操作已取消；若刚提交替换，请刷新并核对手机文件'));
            signal?.addEventListener('abort', abort, { once: true });
            if (signal?.aborted) { finish(new Error('文件操作已取消')); return; }
            xhr.send(file);
        });
    }
};
