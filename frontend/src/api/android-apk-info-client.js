export function inspectApkPackage(file, signal, progress) {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest(), abort = () => xhr.abort();
        const finish = (error, result) => { signal?.removeEventListener('abort', abort); error ? reject(error) : resolve(result); };
        xhr.open('POST', '/api/android/apk/inspect'); xhr.timeout = 310000;
        xhr.setRequestHeader('Content-Type', 'application/octet-stream');
        xhr.setRequestHeader('X-Toolbox-Adb', '1');
        xhr.setRequestHeader('X-Toolbox-Apk-Name', encodeURIComponent(file.name));
        xhr.setRequestHeader('X-Toolbox-Apk-Size', String(file.size));
        xhr.upload.onprogress = event => { if (event.lengthComputable) progress(Math.round(event.loaded * 100 / event.total)); };
        xhr.upload.onload = () => progress(100);
        xhr.onload = () => {
            let body; try { body = JSON.parse(xhr.responseText); } catch { body = {}; }
            finish(xhr.status === 200 && typeof body.packageName === 'string' ? null : new Error(body.message || '未能读取 APK 包名，请检查文件后重试'), body);
        };
        xhr.onerror = () => finish(new Error('APK 传送连接失败，请重试'));
        xhr.ontimeout = () => finish(new Error('APK 包名读取超时，请重试'));
        xhr.onabort = () => finish(new Error('APK 包名读取已取消'));
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) { finish(new Error('APK 包名读取已取消')); return; }
        xhr.send(file);
    });
}
