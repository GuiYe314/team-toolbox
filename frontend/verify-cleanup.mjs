// 验收脚本共用的数据清理工具。
//
// 为什么需要这个模块（TASK-016 之后）：
// 文档删除从「物理删除」改成了「移入回收站」。验收脚本原来收尾时调一次
// DELETE 就算清理干净，现在那只是把数据堆进回收站 ——
// 跑几次回归，演示库的回收站里就会积一堆 BD- / 验收· / __ui-verify- 垃圾。
//
// 所以清理必须两步：先 DELETE（移入回收站），再 purge（真正抹掉）。
//
// 用法：
//   import { purgeDocument, purgeTestDocuments } from './verify-cleanup.mjs';
//   await purgeDocument(API, id);                 // 单篇
//   await purgeTestDocuments(API, /^BD/);         // 按标题特征全量回收

/**
 * 彻底删除一篇文档：先移入回收站（若还在正常集合），再永久删除。
 * 两步都容错 —— 文档可能本来就不存在，清理不该因此失败。
 *
 * @param {string} apiBase **含 /api 的**基址，如 http://127.0.0.1:3000/api
 * @param {number} id
 */
export async function purgeDocument(apiBase, id) {
    if (!Number.isInteger(Number(id)) || Number(id) <= 0) return;
    try {
        await fetch(`${apiBase}/documents/${id}`, { method: 'DELETE' });
    } catch { /* 不存在也无所谓 */ }
    try {
        await fetch(`${apiBase}/documents/purge?confirm=1`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids: [Number(id)] })
        });
    } catch { /* 同上 */ }
}

/**
 * 按标题特征把测试数据从「正常集合 + 回收站」里全量回收。
 *
 * 为什么不只删本轮 id：脚本被中断时本轮 id 可能没记录下来，
 * 只删它会留下垃圾污染演示库（AGENTS.md 前端约定第 10 条）。
 *
 * @param {string} apiBase **含 /api 的**基址
 * @param {RegExp} pattern 标题匹配规则
 * @returns {Promise<number>} 被清理的文档数
 */
export async function purgeTestDocuments(apiBase, pattern) {
    let removed = 0;
    try {
        // 1. 正常集合里的：删了会进回收站，后面一并 purge
        const normal = await (await fetch(`${apiBase}/documents?limit=200`)).json();
        for (const d of (normal.items || []).filter((x) => pattern.test(x.title || ''))) {
            await fetch(`${apiBase}/documents/${d.id}`, { method: 'DELETE' }).catch(() => {});
            removed += 1;
        }
        // 2. 回收站里的：连同第 1 步产生的，一起永久删除
        const trash = await (await fetch(`${apiBase}/documents/trash?limit=200`)).json();
        const ids = (trash.items || []).filter((x) => pattern.test(x.title || '')).map((x) => x.id);
        if (ids.length > 0) {
            await fetch(`${apiBase}/documents/purge?confirm=1`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ids })
            }).catch(() => {});
            removed += ids.length;
        }
    } catch { /* 清理失败不应让验收脚本红掉 */ }
    return removed;
}

/**
 * 按名称特征把**测试资源**从「正常集合 + 回收站」里彻底清掉。
 *
 * 为什么必须扫两个 scope：资源列表默认 `scope=all` **不含回收站**。
 * 只扫正常集合时，一旦某次运行中途失败、残留沉进回收站，
 * 此后再也匹配不到，就会永久堆积
 * （实测演示库回收站里积了 10 个从 10-20 起的 `AMxxxxxx配图.png`）。
 *
 * 顺序不能反：先 batch-delete 把正常集合里的移入回收站（purge 只删已删的），
 * 再 purge 把回收站里的一并永久删除。
 *
 * @param {string} apiBase **含 /api 的**基址
 * @param {RegExp} pattern 名称匹配规则
 * @returns {Promise<number>} 被清理的资源数
 */
export async function purgeTestAssets(apiBase, pattern) {
    let removed = 0;
    try {
        const ids = new Set();

        // 1. 正常集合
        const normal = await (await fetch(`${apiBase}/assets?pageSize=200`)).json();
        for (const a of (normal.items || []).filter((x) => pattern.test(x.name || ''))) {
            ids.add(a.id);
        }
        // 2. 回收站（关键：漏了这一步就会永久堆积）
        const trash = await (await fetch(`${apiBase}/assets?scope=trash&pageSize=200`)).json();
        for (const a of (trash.items || []).filter((x) => pattern.test(x.name || ''))) {
            ids.add(a.id);
        }

        const all = [...ids];
        if (all.length === 0) return 0;

        // 先把正常集合里的移入回收站
        await fetch(`${apiBase}/assets/batch-delete`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ assetIds: all })
        }).catch(() => {});

        // 再永久删除（purge 只接受 is_deleted = 1 的，所以顺序不能反）
        const r = await fetch(`${apiBase}/assets/purge?confirm=1`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ assetIds: all })
        }).catch(() => null);
        if (r && r.ok) {
            const body = await r.json().catch(() => ({}));
            removed = body.deleted || all.length;
        } else {
            removed = all.length;
        }
    } catch { /* 清理失败不应让验收脚本红掉 */ }
    return removed;
}
