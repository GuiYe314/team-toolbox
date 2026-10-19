// TASK-005：前端 API 客户端（封装 fetch，统一 /api 前缀）
//
// 约定：
//   - 所有请求走相对路径 /api，开发期由 Vite 代理到 backend:3000（见 vite.config.js）。
//   - 网络层失败（断网 / 服务不可达）时抛出带 .network = true 的错误，供 UI 区分并提示重试。
//   - 204（删除成功）无响应体，单独处理避免 JSON 解析报错。
// 数据写入的校验与冲突语义由后端负责（见 backend/src/api.js）：
//   - 400 invalid_input：字段级错误
//   - 409 conflict：乐观锁版本冲突，响应体含 current 快照
//   - 其他非 2xx：统一视为可重试的服务错误

const BASE = '/api';

/**
 * 发起一次 API 请求。
 * @param {string} method HTTP 方法
 * @param {string} path 相对 /api 的路径
 * @param {object} [payload] JSON 请求体（GET/DELETE 省略）
 * @returns {Promise<{ res: Response, body: any }>}
 */
async function request(method, path, payload) {
    const opts = { method, headers: {} };
    if (payload !== undefined) {
        opts.headers['Content-Type'] = 'application/json';
        opts.body = JSON.stringify(payload);
    }

    let res;
    try {
        res = await fetch(BASE + path, opts);
    } catch (networkErr) {
        const err = new Error('网络请求失败，请确认后端服务已启动且网络连通');
        err.network = true;
        throw err;
    }

    let body = null;
    if (res.status !== 204) {
        try {
            body = await res.json();
        } catch {
            // 非 JSON 响应（如 404 兜底）忽略，交由调用方按状态码判断
        }
    }
    return { res, body };
}

export const api = {
    listDocuments: (query = '') => request('GET', '/documents' + query),
    search: (q, { limit = 20, offset = 0 } = {}) => {
        const params = new URLSearchParams();
        params.set('q', q);
        params.set('limit', String(limit));
        params.set('offset', String(offset));
        return request('GET', '/search?' + params.toString());
    },
    listDocumentTree: () => request('GET', '/documents/tree'),
    listChildren: (id) => request('GET', '/documents/' + id + '/children'),
    getDocument: (id) => request('GET', '/documents/' + id),
    createDocument: (payload) => request('POST', '/documents', payload),
    updateDocument: (id, payload) => request('PUT', '/documents/' + id, payload),
    deleteDocument: (id) => request('DELETE', '/documents/' + id),
    listCategories: () => request('GET', '/categories'),
    createCategory: (name) => request('POST', '/categories', { name }),
    updateCategory: (id, name) => request('PUT', '/categories/' + id, { name }),
    deleteCategory: (id) => request('DELETE', '/categories/' + id),
    listTags: () => request('GET', '/tags'),
    deleteTag: (id) => request('DELETE', '/tags/' + id),
    renderMarkdown: (md) => request('POST', '/markdown/render', { md })
};
