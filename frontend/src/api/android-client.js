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

export const androidApi = {
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
