async function request(method, path, body, signal) {
    const timeout = new AbortController(), timer = setTimeout(() => timeout.abort(), 15000);
    try {
        const response = await fetch('/api/project-todos' + path, {
            method,
            signal: signal ? AbortSignal.any([signal, timeout.signal]) : timeout.signal,
            headers: { 'X-Toolbox-Project-Todos': '1', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
            body: body === undefined ? undefined : JSON.stringify(body)
        });
        const value = await response.json().catch(() => null);
        if (!response.ok) { const error = new Error(value?.message || '项目待办操作失败，请重试'); error.code = value?.error; throw error; }
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('服务器响应不完整，请刷新核对记录后重试');
        return value;
    } catch (error) {
        if (signal?.aborted) throw error;
        if (timeout.signal.aborted) throw new Error('操作超时，请刷新核对服务器记录后重试');
        if (error instanceof TypeError) throw new Error('无法连接工具箱，请检查服务后重试');
        throw error;
    } finally { clearTimeout(timer); }
}

export const projectTodosApi = {
    state: (view = 'active', signal) => request('GET', `/state?view=${encodeURIComponent(view)}`, undefined, signal),
    project: (id, signal) => request('GET', `/projects/${id}`, undefined, signal),
    saveProject: (value, id, signal) => request(id ? 'PUT' : 'POST', '/projects' + (id ? `/${id}` : ''), value, signal),
    removeProject: (item, signal) => request('DELETE', `/projects/${item.id}?confirm=1&version=${item.version}`, undefined, signal),
    saveTodo: (value, projectId, id, signal) => request(id ? 'PUT' : 'POST', id ? `/todos/${id}` : `/projects/${projectId}/todos`, value, signal),
    archiveTodo: (item, archived, signal) => request('PATCH', `/todos/${item.id}`, { version: item.version, archived }, signal),
    removeTodo: (item, signal) => request('DELETE', `/todos/${item.id}?confirm=1&version=${item.version}`, undefined, signal)
};
