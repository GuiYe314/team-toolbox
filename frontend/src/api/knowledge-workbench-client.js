const BASE = '/api/knowledge-workbench';
export async function knowledgeRequest(path, { method = 'GET', body, signal, blob = false } = {}) {
    const timeout = AbortSignal.timeout(20000), joined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    let response;
    try { response = await fetch(BASE + path, { method, signal: joined, headers: { 'X-Toolbox-Knowledge': '1', ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }); }
    catch (error) { if (signal?.aborted) throw error; throw new Error(timeout.aborted ? '知识库请求超时，请重试' : '知识库连接失败，请检查服务后重试'); }
    if (!response.ok) { const data = await response.json().catch(() => ({})); const error = new Error(data.message || '知识库操作失败，请重试'); error.status = response.status; throw error; }
    return blob ? response.blob() : response.json();
}
export const kbApi = {
    state: signal => knowledgeRequest('/state', { signal }),
    note: (id, signal) => knowledgeRequest(`/notes/${id}`, { signal }),
    create: (body, signal) => knowledgeRequest('/notes', { method: 'POST', body, signal }),
    saveNote: (id, body, signal) => knowledgeRequest(`/notes/${id}`, { method: 'PUT', body, signal }),
    saveEntry: (item, signal) => knowledgeRequest(item.id ? `/entries/${item.id}` : '/entries', { method: item.id ? 'PUT' : 'POST', body: item.id ? { name: item.name, data: item.data, version: item.version } : { name: item.name, data: item.data, kind: item.kind }, signal }),
    remove: (item, signal) => knowledgeRequest(`/entries/${item.id}?confirm=1&version=${item.version}`, { method: 'DELETE', signal }),
    history: (id, signal) => knowledgeRequest(`/notes/${id}/history`, { signal }),
    restore: (id, revisionId, version, signal) => knowledgeRequest(`/notes/${id}/restore?confirm=1`, { method: 'POST', body: { revisionId, version }, signal }),
    clip: (url, signal) => knowledgeRequest('/clip', { method: 'POST', body: { url }, signal }),
    import: (files, signal) => knowledgeRequest('/markdown/import', { method: 'POST', body: { files }, signal }),
    export: signal => knowledgeRequest('/markdown/export', { blob: true, signal }),
    run: (item, docId, requestId, signal) => knowledgeRequest(`/actions/${item.id}/run`, { method: 'POST', body: { version: item.version, docId, requestId }, signal })
};
