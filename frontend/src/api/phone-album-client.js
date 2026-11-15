const BASE = '/api/phone-album';
function headers(session, manage) {
    return { 'X-Toolbox-Album': '1', ...(session ? { [manage ? 'X-Toolbox-Album-Manage' : 'X-Toolbox-Album-Token']: manage ? session.manageToken : session.uploadToken } : {}) };
}
async function request(path, { session, manage = false, method = 'GET', body, signal, keepalive = false } = {}) {
    const controller = new AbortController(), abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) controller.abort();
    const timer = setTimeout(abort, 15_000);
    try {
        const response = await fetch(BASE + path, { method, headers: { ...headers(session, manage), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: controller.signal, keepalive });
        const result = await response.json();
        if (!response.ok) throw Object.assign(new Error(result.message || '相册接收请求失败'), { code: result.error, status: response.status });
        return result;
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}
export const albumApi = {
    config: signal => request('/config', { signal }),
    create: (folderId, signal) => request('/sessions', { method: 'POST', body: { folderId }, signal }),
    status: (session, manage = false, signal) => request(`/sessions/${session.id}`, { session, manage, signal }),
    stop: (session, keepalive = false) => request(`/sessions/${session.id}`, { session, manage: true, method: 'DELETE', keepalive }),
    upload(session, item, signal, onProgress) {
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            const abort = () => xhr.abort();
            const finish = (error, result) => { signal?.removeEventListener('abort', abort); error ? reject(error) : resolve(result); };
            xhr.open('POST', BASE + `/sessions/${session.id}/files`);
            xhr.timeout = 5 * 60_000 + 10_000;
            for (const [name, value] of Object.entries(headers(session, false))) xhr.setRequestHeader(name, value);
            xhr.setRequestHeader('Content-Type', 'application/octet-stream');
            xhr.setRequestHeader('X-Toolbox-Album-File', encodeURIComponent(JSON.stringify({ id: item.id, name: item.file.name, size: item.file.size })));
            xhr.upload.onprogress = event => { if (event.lengthComputable) onProgress(Math.min(item.file.size, event.loaded)); };
            xhr.onload = () => {
                let result;
                try { result = JSON.parse(xhr.responseText); } catch { finish(new Error('服务器返回内容无效，请重试核对')); return; }
                if (xhr.status < 200 || xhr.status >= 300) finish(Object.assign(new Error(result.message || '上传失败'), { code: result.error, status: xhr.status }));
                else finish(null, result);
            };
            xhr.onerror = () => finish(new Error('网络中断，请重试核对是否已保存'));
            xhr.ontimeout = () => finish(new Error('传送超时，请重试核对是否已保存'));
            xhr.onabort = () => finish(Object.assign(new Error('已停止，重试会核对是否已保存'), { name: 'AbortError' }));
            signal?.addEventListener('abort', abort, { once: true });
            if (signal?.aborted) { finish(Object.assign(new Error('已停止'), { name: 'AbortError' })); return; }
            xhr.send(item.file);
        });
    }
};
