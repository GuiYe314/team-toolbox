const base = '/api/integrations';

async function request(method, path, body, signal, onEvent, timeoutMs = 45000) {
    const controller = new AbortController();
    const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    const timer = setTimeout(() => controller.abort(new Error('操作超时，请重试')), timeoutMs);
    try {
        const response = await fetch(base + path, { method, headers: { 'X-Toolbox-Integration': '1', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body), signal: combined });
        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            const failure = new Error(error.message || `请求失败（HTTP ${response.status}）`);
            if (Array.isArray(error.attempts)) failure.attempts = error.attempts;
            throw failure;
        }
        if (!onEvent) return await response.json();
        if (!response.body || !response.headers.get('content-type')?.includes('application/x-ndjson')) throw new Error('服务器未返回实时结果');
        const reader = response.body.getReader(), decoder = new TextDecoder();
        let buffer = '', result = null;
        function consume(line) {
            if (!line.trim()) return;
            const event = JSON.parse(line);
            if (event.type === 'error') throw new Error(event.message || '操作失败');
            onEvent(event);
            if (event.type === 'done') result = event;
        }
        try {
            while (true) {
                const { done, value } = await reader.read(); if (done) break;
                buffer += decoder.decode(value, { stream: true });
                let boundary;
                while ((boundary = buffer.indexOf('\n')) >= 0) { consume(buffer.slice(0, boundary)); buffer = buffer.slice(boundary + 1); }
                if (buffer.length > 131072) throw new Error('实时结果超过单条大小上限');
            }
            buffer += decoder.decode(); if (buffer.trim()) consume(buffer);
            if (!result) throw new Error('连接提前中断，尚未收到完成确认，请重试');
            return result;
        } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    } finally { clearTimeout(timer); }
}

export const integrationApi = {
    videoConfig: signal => request('GET', '/yoinks/config', undefined, signal),
    videoResolvers: signal => request('GET', '/yoinks/resolvers', undefined, signal),
    saveVideoConfig: (value, signal) => request('PUT', '/yoinks/config', value, signal),
    analyzeVideo: (url, signal, resolverId = '') => request('POST', '/yoinks/analyze', { url, ...(resolverId ? { resolverId } : {}) }, signal, undefined, 150000),
    downloadVideo: (probeId, choiceId, signal, update) => request('POST', '/yoinks/download', { probeId, choiceId }, signal, update, 16 * 60000),
    removeVideo: (id, keepalive = false) => keepalive
        ? fetch(`${base}/yoinks/results/${encodeURIComponent(id)}/remove`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Toolbox-Integration': '1' }, body: '{}', keepalive: true, signal: AbortSignal.timeout(5000) }).then(async response => { if (!response.ok) throw new Error((await response.json()).message || '结果清理失败'); return response.json(); })
        : request('POST', `/yoinks/results/${encodeURIComponent(id)}/remove`, {}),
    freeConfig: signal => request('GET', '/freellmapi/config', undefined, signal),
    saveFreeConfig: (value, signal) => request('PUT', '/freellmapi/config', value, signal),
    models: signal => request('GET', '/freellmapi/models', undefined, signal, undefined, 125000),
    chat: (value, signal, update) => request('POST', '/freellmapi/chat', value, signal, update, 125000),
    artcraftConfig: signal => request('GET', '/artcraft/config', undefined, signal),
    saveArtcraftConfig: (path, signal) => request('PUT', '/artcraft/config', { path }, signal),
    launchArtcraft: signal => request('POST', '/artcraft/launch', { confirm: true }, signal)
};

export const operationMessage = (error, signal) => signal?.aborted ? '操作已取消' : (error?.message || '操作失败，请重试');
