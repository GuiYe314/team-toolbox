const base = '/api/file-share';
const headers = share => ({ 'X-Toolbox-Share': '1', ...(share ? { 'X-Toolbox-Share-Token': share.token } : { 'X-Toolbox-Share-Manage': '1' }) });
async function request(path, { share, signal, method = 'GET', body } = {}) {
    const controller = new AbortController(), abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort();
    const timer = setTimeout(abort, 30_000);
    try {
        const response = await fetch(base + path, { method, signal: controller.signal, cache: 'no-store', headers: { ...headers(share), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
        const result = await response.json();
        if (!response.ok) throw Object.assign(new Error(result.message || '文件共享请求失败'), { status: response.status, code: result.error });
        return result;
    } catch (error) { if (controller.signal.aborted && !signal?.aborted) throw new Error('请求超时，请重试'); throw error; }
    finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}
export const fileShareApi = {
    config: signal => request('/config', { signal }),
    create: (body, signal) => request('/shares', { method: 'POST', body: { ...body, confirm: true }, signal }),
    stop: (id, signal) => request(`/shares/${id}`, { method: 'DELETE', body: { confirm: true }, signal }),
    entries: (share, path, signal) => request(`/shares/${share.id}/entries?path=${encodeURIComponent(path)}`, { share, signal }),
    folder: (share, path, name, signal) => request(`/shares/${share.id}/folders`, { method: 'POST', share, signal, body: { path, name } }),
    ticket: (share, path, signal) => request(`/shares/${share.id}/downloads`, { method: 'POST', share, signal, body: { path } }),
    upload(share, path, item, signal, progress) {
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest(), abort = () => xhr.abort();
            signal?.addEventListener('abort', abort, { once: true });
            const done = (error, result) => { signal?.removeEventListener('abort', abort); error ? reject(error) : resolve(result); };
            xhr.open('POST', `${base}/shares/${share.id}/files`); xhr.timeout = 10 * 60_000;
            for (const [key, value] of Object.entries(headers(share))) xhr.setRequestHeader(key, value);
            xhr.setRequestHeader('Content-Type', 'application/octet-stream');
            xhr.setRequestHeader('X-Toolbox-Share-File', encodeURIComponent(JSON.stringify({ path, name: item.file.name, size: item.file.size, requestId: item.requestId })));
            xhr.upload.onprogress = event => progress(event.lengthComputable ? Math.min(99, Math.floor(event.loaded / Math.max(1, event.total) * 100)) : 0);
            xhr.onload = () => { let result; try { result = JSON.parse(xhr.responseText); } catch { return done(new Error('未收到保存回执，请刷新目录核对')); }
                done(xhr.status >= 200 && xhr.status < 300 ? null : Object.assign(new Error(result.message || '上传失败'), { status: xhr.status }), result); };
            xhr.onerror = () => done(new Error('连接中断，请刷新目录核对后重试'));
            xhr.ontimeout = () => done(new Error('上传超时，请刷新目录核对后重试'));
            xhr.onabort = () => done(Object.assign(new Error('上传已停止，请刷新目录核对已完成文件'), { name: 'AbortError' }));
            if (signal?.aborted) return done(Object.assign(new Error('上传已停止'), { name: 'AbortError' }));
            xhr.send(item.file);
        });
    },
};
