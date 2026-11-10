async function request(method, path, payload, signal, binary = false) {
    const controller = new AbortController();
    const cancel = () => controller.abort();
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) cancel();
    const timer = setTimeout(cancel, 45000);
    try {
        const response = await fetch('/api/android' + path, {
            method,
            headers: { 'Content-Type': 'application/json', 'X-Toolbox-Adb': '1' },
            body: payload === undefined ? undefined : JSON.stringify(payload),
            signal: controller.signal,
            keepalive: path.endsWith('/cancel') || path.endsWith('/stop')
        });
        if (binary && response.ok) {
            if (response.headers.get('content-type')?.split(';')[0] !== 'image/png') throw new Error('服务器未返回有效的屏幕图片');
            return { blob: await response.blob(), capturedAt: response.headers.get('x-screen-captured-at') };
        }
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.message || `请求失败（${response.status}）`);
        return body;
    } catch (error) {
        if (controller.signal.aborted) throw new Error(signal?.aborted ? '操作已取消' : '请求超时，请检查服务器和手机连接');
        if (error instanceof TypeError) throw new Error('无法连接工具箱服务器，请检查服务是否运行');
        throw error;
    } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', cancel);
    }
}

function uploadApk(file, target, signal, onProgress = () => {}, onUpdate = () => {}) {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) { reject(new Error('APK 安装请求已取消，请核对手机实际安装状态')); return; }
        const xhr = new XMLHttpRequest();
        const abort = () => xhr.abort();
        const batch = Array.isArray(target);
        let settled = false, offset = 0, completed;
        const finish = (error, result) => {
            if (settled) return;
            settled = true; signal?.removeEventListener('abort', abort);
            if (error) reject(error); else resolve(result);
        };
        xhr.open('POST', '/api/android/apk/' + (batch ? 'install-batch' : 'install'));
        xhr.timeout = batch ? 360000 + target.length * 300000 : 660000;
        xhr.setRequestHeader('Content-Type', 'application/octet-stream');
        xhr.setRequestHeader('X-Toolbox-Adb', '1');
        xhr.setRequestHeader(batch ? 'X-Toolbox-Adb-Serials' : 'X-Toolbox-Adb-Serial', batch ? JSON.stringify(target) : target);
        xhr.setRequestHeader('X-Toolbox-Adb-Confirm', '1');
        xhr.setRequestHeader('X-Toolbox-Apk-Name', encodeURIComponent(file.name));
        xhr.setRequestHeader('X-Toolbox-Apk-Size', String(file.size));
        xhr.upload.onprogress = event => { if (!settled && event.lengthComputable) onProgress(Math.round(event.loaded * 100 / event.total), 'upload'); };
        xhr.upload.onload = () => { if (!settled) onProgress(100, 'install'); };
        const readUpdates = () => {
            if (settled || !batch || xhr.status !== 200 || !xhr.getResponseHeader('Content-Type')?.startsWith('application/x-ndjson')) return;
            try {
                // 兼容最多 20 台的逐台事件及最终汇总，包含 JSON 转义后的有界 ADB 输出。
                if (xhr.responseText.length > 16 * 1024 * 1024) throw new Error('批量安装结果超出读取上限，请核对设备状态');
                let end;
                while ((end = xhr.responseText.indexOf('\n', offset)) !== -1) {
                    const event = JSON.parse(xhr.responseText.slice(offset, end)); offset = end + 1;
                    if (event.type === 'error') { finish(new Error(event.message || '批量安装中断，请核对手机实际状态')); return; }
                    if (event.type === 'complete') completed = event.result;
                    else if (event.type === 'device' && target.includes(event.result?.serial)
                        && ['installing', 'success', 'failed'].includes(event.result.status)) onUpdate(event.result);
                }
            } catch (error) { finish(error instanceof SyntaxError ? new Error('批量安装响应不完整，请核对手机实际状态') : error); xhr.abort(); }
        };
        xhr.onprogress = readUpdates;
        xhr.onload = () => {
            if (batch && xhr.status === 200 && xhr.getResponseHeader('Content-Type')?.startsWith('application/x-ndjson')) {
                readUpdates();
                if (completed?.message && Array.isArray(completed.results)) finish(null, completed);
                else finish(new Error('批量安装连接已结束，但未收到完整结果，请核对手机实际状态'));
                return;
            }
            let body;
            try { body = JSON.parse(xhr.responseText); } catch { body = {}; }
            if (xhr.status >= 200 && xhr.status < 300 && body.message) finish(null, body);
            else finish(new Error(body.message || `APK 安装请求失败（${xhr.status}）`));
        };
        xhr.onerror = () => finish(new Error('无法连接工具箱服务器，请检查服务后重试，并核对手机实际安装状态'));
        xhr.ontimeout = () => finish(new Error('APK 安装请求超时，请检查连接并核对手机实际安装状态'));
        xhr.onabort = () => finish(new Error('APK 安装请求已取消，请核对手机实际安装状态'));
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) { abort(); finish(new Error('APK 安装请求已取消')); return; }
        xhr.send(file);
    });
}

const installApk = (file, serial, signal, onProgress) => uploadApk(file, serial, signal, onProgress);
const installApkBatch = (file, serials, signal, onProgress, onUpdate) => uploadApk(file, serials, signal, onProgress, onUpdate);

export const androidApi = {
    installApk,
    installApkBatch,
    config: (signal) => request('GET', '/config', undefined, signal),
    captureScreen: (serial, signal) => request('POST', '/screen', { serial }, signal, true),
    listApps: (serial, signal) => request('POST', '/apps', { serial }, signal),
    appStatus: (serial, packageName, signal) => request('POST', '/apps/status', { serial, packageName }, signal),
    startLogcat: (serial, signal, packageName = '') => request('POST', '/logcat', { serial, packageName }, signal),
    pollLogcat: (id, after, signal) => request('POST', `/logcat/${encodeURIComponent(id)}/poll`, { after }, signal),
    stopLogcat: (id, signal) => request('POST', `/logcat/${encodeURIComponent(id)}/stop`, {}, signal),
    commands: (signal) => request('GET', '/commands', undefined, signal),
    homeApps: (serial, signal) => request('POST', '/commands/home-apps', { serial }, signal),
    saveCommand: (command, id, signal) => request(id ? 'PUT' : 'POST', '/commands/custom' + (id ? '/' + encodeURIComponent(id) : ''), command, signal),
    deleteCommand: (id, revision, signal) => request('DELETE', '/commands/custom/' + encodeURIComponent(id), { confirm: true, revision }, signal),
    executeCommand: (id, serial, confirm, signal, revision, home) => request('POST', '/commands/execute', { id, serial, confirm, ...(revision ? { revision } : {}), ...(home || {}) }, signal),
    configure: (path, signal) => request('PUT', '/config', { path }, signal),
    searchFolder: (folder, signal) => request('POST', '/search-folder', { folder }, signal),
    startQr: (signal) => request('POST', '/qr', {}, signal),
    pollQr: (id, signal) => request('POST', `/qr/${encodeURIComponent(id)}/poll`, {}, signal),
    cancelQr: (id, signal) => request('POST', `/qr/${encodeURIComponent(id)}/cancel`, {}, signal),
    devices: (signal) => request('GET', '/devices', undefined, signal),
    discover: (signal) => request('POST', '/discover', {}, signal),
    connect: (endpoint, signal) => request('POST', '/connect', { endpoint }, signal),
    pair: (serviceId, code, signal) => request('POST', '/pair', { serviceId, code }, signal),
    disconnect: (serial, signal) => request('POST', '/disconnect', { serial, confirm: true }, signal)
};
