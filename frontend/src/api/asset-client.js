// 资源管理前端 API 客户端。
//
// 为什么不直接用 api/client.js：
//   那是知识库文档的出口，路径与语义都绑死在 documents 上。
//   资源管理是独立子系统，将来若要整体下线/换实现，不该牵动文档模块。
//   但**请求约定完全一致**（同款 {res, body} 返回、网络错误打 .network 标记），
//   这样上层组件的错误处理写法可以照搬现有视图，不必学两套。
//
// 后端契约要点（见 backend/src/asset-api.js）：
//   - GET /api/assets?folderId&search&type&status&scope&page&pageSize&sort&order
//   - 文件字节端点：/api/assets/files/:id/:kind/:pointer
//       kind    = original | preview | thumbnail
//       pointer = latest | published | <版本号>
//     pointer=published 是给 Unity 客户端的标准入口。
//   - 上传同名冲突返回 409 + { resolutionRequired: true, existingAssetId }
//     上层据此弹「作为新版本 / 创建新资源 / 取消」。

const BASE = '/api';

/**
 * 发起一次 API 请求。网络层失败时抛带 .network = true 的错误。
 * @param {string} method
 * @param {string} path 相对 /api
 * @param {object} [payload]
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
        try { body = await res.json(); } catch { /* 非 JSON（如 404 兜底） */ }
    }
    return { res, body };
}

/**
 * 构造列表查询串。
 *
 * folderId 的三态必须原样透传，不能用 `if (folderId)` 判断：
 *   undefined → 不限文件夹
 *   null      → 只看「未分类」
 *   数字      → 指定文件夹
 * `if (folderId)` 会把 null 当成「不传」，未分类视图就永远查不出来。
 *
 * @param {object} q
 * @returns {string} 以 ? 开头，无参数时返回空串
 */
function listQuery(q = {}) {
    const params = new URLSearchParams();
    // folderId 的三态必须原样透传，不能用 `if (folderId)` 判断：
    //   undefined → 不限文件夹（看全部）
    //   null      → 只看「未分类」（folder_id IS NULL）
    //   数字      → 指定文件夹
    // `if (folderId)` 会把 null 当成「不传」，未分类视图就永远查不出来；
    // 而「看全部」若误传 null，又会只看到未分类 —— 两者方向相反，都不能用真值判断。
    if (q.folderId === undefined) {
        // 不设置该参数 = 不限文件夹
    } else {
        params.set('folderId', q.folderId === null ? 'root' : String(q.folderId));
    }
    if (q.search) params.set('search', q.search);
    if (q.type && q.type !== 'all') params.set('type', q.type);
    if (q.status && q.status !== 'all') params.set('status', q.status);
    if (q.scope && q.scope !== 'all') params.set('scope', q.scope);
    if (q.sort) params.set('sort', q.sort);
    if (q.order) params.set('order', q.order);
    if (q.page) params.set('page', String(q.page));
    if (q.pageSize) params.set('pageSize', String(q.pageSize));
    const s = params.toString();
    return s ? '?' + s : '';
}

export const assetApi = {
    // ── 资产 ──
    list: (q) => request('GET', '/assets' + listQuery(q)),
    get: (id) => request('GET', '/assets/' + id),
    stats: () => request('GET', '/assets/stats'),
    patch: (id, patch) => request('PATCH', '/assets/' + id, patch),
    rename: (id, name) => request('PATCH', '/assets/' + id, { name }),
    moveOne: (id, folderId) => request('PATCH', '/assets/' + id, { folderId }),

    /**
     * 上传文件。
     * @param {File} file
     * @param {object} [opts]
     * @param {number|null} [opts.folderId]
     * @param {string} [opts.assetId] 传入则追加为新版本
     * @param {string} [opts.comment] 版本说明
     * @param {string} [opts.description]
     * @param {string[]} [opts.tags]
     * @param {boolean} [opts.force] 同名冲突时强制创建为新资源
     * @returns {Promise<{res:Response, body:any}>}
     */
    upload(file, opts = {}) {
        const form = new FormData();
        form.append('file', file, file.name || 'asset.bin');
        if (opts.folderId !== undefined && opts.folderId !== null) {
            form.append('folderId', String(opts.folderId));
        } else if (opts.folderId === null) {
            form.append('folderId', '');
        }
        if (opts.assetId != null) form.append('assetId', String(opts.assetId));
        if (opts.comment) form.append('comment', opts.comment);
        if (opts.description) form.append('description', opts.description);
        if (opts.tags && opts.tags.length) form.append('tags', opts.tags.join(','));

        const url = BASE + '/assets/upload' + (opts.force ? '?force=1' : '');
        return fetch(url, { method: 'POST', body: form })
            .then(async (res) => {
                let body = null;
                try { body = await res.json(); } catch { /* 非 JSON */ }
                return { res, body };
            })
            .catch(() => {
                const err = new Error('上传失败，请检查网络与后端服务');
                err.network = true;
                throw err;
            });
    },

    // ── 版本 ──
    versions: (assetId) => request('GET', `/assets/${assetId}/versions`),
    publish: (assetId, versionId) => request(
        'POST', `/assets/${assetId}/publish`,
        versionId ? { versionId } : {}
    ),
    unpublish: (assetId) => request('POST', `/assets/${assetId}/unpublish`),
    restore: (assetId, versionId, comment) => request(
        'POST', `/assets/${assetId}/versions/${versionId}/restore`, { comment }
    ),
    deleteVersion: (assetId, versionId) =>
        request('DELETE', `/assets/${assetId}/versions/${versionId}`),

    // ── 文件夹 ──
    listFolders: () => request('GET', '/asset-folders'),
    createFolder: (name, parentId = null) =>
        request('POST', '/asset-folders', { name, parentId }),
    renameFolder: (id, name) => request('PUT', `/asset-folders/${id}`, { name }),
    moveFolder: (id, parentId) => request('PUT', `/asset-folders/${id}`, { parentId }),
    deleteFolder: (id) => request('DELETE', `/asset-folders/${id}`),

    // ── 集合（Packs）──
    // 与文件夹的区别：文件夹是一棵树（一个资源只能待在一个位置），
    // 集合是多对多（一个资源可属多个集合），回答「这次要交付哪些」。
    listCollections: () => request('GET', '/collections'),
    getCollection: (id) => request('GET', `/collections/${id}`),
    createCollection: (name, description = '') =>
        request('POST', '/collections', { name, description }),
    updateCollection: (id, patch) => request('PUT', `/collections/${id}`, patch),
    // 删集合**不删资源** —— 集合是视图不是容器
    deleteCollection: (id) => request('DELETE', `/collections/${id}`),
    addToCollection: (id, assetIds) =>
        request('POST', `/collections/${id}/items`, { assetIds }),
    removeFromCollection: (id, assetIds) =>
        request('DELETE', `/collections/${id}/items`, { assetIds }),
    // 反向查询：这个资源还在哪些包里
    collectionsOfAsset: (assetId) => request('GET', `/assets/${assetId}/collections`),

    // ── 回收站 / 批量 ──
    batchDelete: (assetIds) => request('POST', '/assets/batch-delete', { assetIds }),
    batchRestore: (assetIds) => request('POST', '/assets/batch-restore', { assetIds }),
    batchMove: (assetIds, folderId) =>
        request('POST', '/assets/batch-move', { assetIds, folderId }),
    batchTags: (assetIds, tags) => request('POST', '/assets/batch-tags', { assetIds, tags }),
    purge: (assetIds) => request('POST', '/assets/purge?confirm=1', { assetIds }),
    emptyTrash: () => request('POST', '/assets/trash/empty?confirm=1'),

    // ── 标签 / 日志 ──
    listTags: () => request('GET', '/asset-tags'),
    logs: (assetId) => request('GET', `/assets/${assetId}/logs`),
    recentActivity: (limit = 20) => request('GET', `/assets-activity/recent?limit=${limit}`),

    // ── 存储路径（镜像目录）──
    /** 读取当前保存路径设置与镜像目录统计。 */
    getStorageSettings: () => request('GET', '/assets/settings/storage'),
    /** 设置保存路径；服务端会立即把现有资源全量拷贝过去。传空串清除。 */
    setStoragePath: (path) => request('PUT', '/assets/settings/storage', { path }),
    /** 校验路径是否可用（不写入配置）。 */
    validateStoragePath: (path) => request('POST', '/assets/settings/storage/validate', { path }),
    /** 手动触发一次全量同步。 */
    syncStorage: () => request('POST', '/assets/settings/storage/sync'),
    /** 清空镜像目录内容（保留配置）。 */
    clearStorage: () => request('POST', '/assets/settings/storage/clear'),

    // ── 导入 / 导出 ──
    /**
     * 导出资源为 ZIP。
     * 不走 request()：响应是二进制流（不是 JSON），要交给浏览器下载。
     * @param {number[]} assetIds
     * @returns {Promise<{ok: boolean, blob?: Blob, message?: string}>}
     */
    exportZip: async (assetIds) => {
        try {
            const res = await fetch(BASE + '/assets/export', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ assetIds })
            });
            if (!res.ok) {
                let msg = '导出失败';
                try {
                    const body = await res.json();
                    msg = body.message || msg;
                } catch { /* 非 JSON 响应 */ }
                return { ok: false, message: msg };
            }
            return { ok: true, blob: await res.blob() };
        } catch {
            return { ok: false, message: '网络请求失败，请确认后端服务已启动' };
        }
    },

    /**
     * 导入资源包（ZIP）。
     * @param {File} file
     * @returns {Promise<{res: Response, body: any}>}
     */
    importZip: (file) => {
        const form = new FormData();
        form.append('file', file, file.name || 'package.zip');
        return fetch(BASE + '/assets/import', { method: 'POST', body: form })
            .then(async (res) => {
                let body = null;
                try { body = await res.json(); } catch { /* 非 JSON */ }
                return { res, body };
            })
            .catch(() => {
                const err = new Error('导入失败，请检查网络与后端服务');
                err.network = true;
                throw err;
            });
    },

    /**
     * 拼一个文件字节 URL。
     *
     * 必须是**裸 URL**（不带自定义 header），因为它要直接塞进
     * <img src> / <video src> / <model-viewer src>，浏览器自行发起请求。
     *
     * @param {number} assetId
     * @param {'original'|'preview'|'thumbnail'} kind
     * @param {'latest'|'published'|number} pointer
     * @param {boolean} [download=false] 追加 ?download=1 触发浏览器下载而非内联
     * @returns {string}
     */
    fileUrl(assetId, kind = 'original', pointer = 'latest', download = false) {
        const p = pointer === 'published' ? 'published'
            : pointer === 'latest' ? 'latest'
                : String(pointer);
        return `${BASE}/assets/files/${assetId}/${kind}/${p}` + (download ? '?download=1' : '');
    },

    /**
     * 重新生成某个版本的预览与缩略图。
     * 用于预览失败后重试（例如服务器后来装上了 ffmpeg）。
     * @param {number} assetId
     * @param {number} versionId
     */
    regeneratePreview: (assetId, versionId) =>
        request('POST', `/assets/${assetId}/versions/${versionId}/preview`),

    /** 当前服务器支持哪些预览类型（诊断用） */
    previewProcessors: () => request('GET', '/assets/preview/processors')
};

export default assetApi;