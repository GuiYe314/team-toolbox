async function request(method, path, body, signal) {
    const timeout = new AbortController(), timer = setTimeout(() => timeout.abort(), 15000);
    try {
        const response = await fetch('/api/knowledge-sops' + path, { method, signal: signal ? AbortSignal.any([signal, timeout.signal]) : timeout.signal,
            headers: { 'X-Toolbox-SOP': '1', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) });
        const value = await response.json();
        if (!response.ok) { const error = new Error(value.message || 'SOP操作失败，请重试'); error.code = value.error; throw error; } return value;
    } catch (error) {
        if (signal?.aborted) throw error;
        if (timeout.signal.aborted) throw new Error('操作超时，请刷新核对服务器记录后重试');
        if (error instanceof TypeError) throw new Error('无法连接工具箱，请检查服务后重试'); throw error;
    } finally { clearTimeout(timer); }
}
export const sopApi = {
    templates: signal => request('GET', '/templates', undefined, signal),
    template: (id, signal) => request('GET', `/templates/${id}`, undefined, signal),
    saveTemplate: (value, id, signal) => request(id ? 'PUT' : 'POST', '/templates' + (id ? '/' + id : ''), value, signal),
    start: (id, value, signal) => request('POST', `/templates/${id}/runs`, value, signal),
    runs: (offset, status, signal) => request('GET', `/runs?offset=${offset}&status=${status}`, undefined, signal),
    run: (id, signal) => request('GET', `/runs/${id}`, undefined, signal),
    change: (id, value, signal) => request('PATCH', `/runs/${id}`, value, signal),
    remove: (kind, item, signal) => request('DELETE', `/${kind}/${item.id}?confirm=1&version=${item.version}`, undefined, signal)
};
