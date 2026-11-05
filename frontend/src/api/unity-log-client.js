async function request(path, payload = {}, signal, download = false) {
    const controller = new AbortController();
    const cancel = () => controller.abort();
    signal?.addEventListener('abort', cancel, { once: true }); if (signal?.aborted) cancel();
    const timer = setTimeout(cancel, download ? 60000 : 35000);
    try {
        const response = await fetch('/api/unity-logs' + path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Toolbox-Unity-Log': '1' },
            body: JSON.stringify(payload), signal: controller.signal, keepalive: path.endsWith('/close') });
        if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            const error = new Error(body.message || `请求失败（${response.status}）`); error.code = body.error; throw error;
        }
        if (!download) return await response.json();
        const type = response.headers.get('content-type')?.split(';')[0];
        if (!['text/plain', 'application/zip'].includes(type)) throw new Error('未返回有效的日志文件');
        return { blob: await response.blob(), name: response.headers.get('content-disposition')?.match(/filename="([\w.\-]+)"/)?.[1] || 'StartupLogs.zip' };
    } catch (error) {
        if (controller.signal.aborted) throw new Error(signal?.aborted ? '操作已取消' : '请求超时，请保持设备应用在前台后重试');
        if (error instanceof TypeError) throw new Error('无法连接工具箱服务，请检查服务是否运行');
        throw error;
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel); }
}
export const unityLogApi = {
    discover: (port, address, signal) => request('/discover', { port, address }, signal),
    connect: (deviceId, signal) => request('/sessions', { deviceId }, signal),
    files: (id, signal) => request(`/sessions/${id}/files`, {}, signal),
    preview: (id, name, signal) => request(`/sessions/${id}/preview`, { name }, signal),
    download: (id, name, archive, signal) => request(`/sessions/${id}/download`, { name, archive }, signal, true),
    close: id => request(`/sessions/${id}/close`)
};
