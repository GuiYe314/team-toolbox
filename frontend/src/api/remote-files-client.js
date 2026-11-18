const base = '/api/remote-files';
const headers = session => ({ 'X-Toolbox-Remote': '1', ...(session ? { 'X-Toolbox-Remote-Token': session.token } : {}) });
async function request(path, { session, signal, method = 'GET', body, keepalive = false } = {}) {
    const c = new AbortController(), abort = () => c.abort(); signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort();
    const timer = setTimeout(abort, 25_000);
    try {
        const res = await fetch(base + path, { method, signal: c.signal, cache: 'no-store', keepalive, headers: { ...headers(session), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
        const result = await res.json(); if (!res.ok) throw Object.assign(new Error(result.message || '远端文件请求失败'), { code: result.error, status: res.status }); return result;
    } catch (error) { if (c.signal.aborted && !signal?.aborted) throw new Error('请求超时，连接可能已关闭，请刷新状态'); throw error; }
    finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}
const path = s => `/sessions/${s.id}`;
export const remoteFilesApi = {
    probe: (body, signal) => request('/probe', { method: 'POST', body, signal }),
    connect: (body, signal) => request('/sessions', { method: 'POST', body: { ...body, confirm: true }, signal }),
    status: (session, signal) => request(path(session), { session, signal }),
    entries: (session, directory, signal) => request(path(session) + '/entries?path=' + encodeURIComponent(directory), { session, signal }),
    alter: (session, body, signal) => request(path(session) + '/alter', { session, method: 'POST', body: { ...body, confirm: true }, signal }),
    prepare: (session, body, signal) => request(path(session) + '/transfers', { session, method: 'POST', body: { ...body, confirm: true }, signal }),
    cancel: session => request(path(session) + '/cancel', { session, method: 'POST', body: { confirm: true } }),
    disconnect: (session, keepalive = false) => request(path(session), { session, method: 'DELETE', body: { confirm: true }, keepalive }),
    upload(session, job, file, signal, progress) {
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest(), abort = () => xhr.abort(); signal?.addEventListener('abort', abort, { once: true });
            const done = (error, value) => { signal?.removeEventListener('abort', abort); error ? reject(error) : resolve(value); };
            xhr.open('POST', base + path(session) + '/uploads/' + job.id); xhr.timeout = 15 * 60_000;
            for (const [name, value] of Object.entries(headers(session))) xhr.setRequestHeader(name, value);
            xhr.setRequestHeader('Content-Type', 'application/octet-stream');
            xhr.upload.onprogress = event => progress(event.loaded);
            xhr.onload = () => { let result; try { result = JSON.parse(xhr.responseText); } catch { return done(new Error('未收到远端保存回执，请重新连接核对文件')); }
                done(xhr.status >= 200 && xhr.status < 300 ? null : new Error(result.message || '上传失败'), result); };
            xhr.onerror = () => done(new Error('上传连接中断，请核对远端文件'));
            xhr.ontimeout = () => done(new Error('上传超时，请重新连接核对远端文件'));
            xhr.onabort = () => done(Object.assign(new Error('传输已停止，请核对远端文件与临时文件'), { name: 'AbortError' }));
            if (signal?.aborted) return done(Object.assign(new Error('已停止'), { name: 'AbortError' })); xhr.send(file);
        });
    },
};
