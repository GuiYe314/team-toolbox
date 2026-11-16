// 普通资源上传与手机相册上传共用的镜像、预览后处理。
import { getMirrorPath, mirrorVersion } from './asset-mirror.js';
import { generatePreview } from './asset-preview.js';

/**
 * 把一个版本同步到镜像目录（用户设置的保存路径）。
 *
 * 未配置镜像时直接返回；拷贝失败只记日志不抛错 ——
 * 外部盘掉线不应让上传失败（主存储才是权威副本）。
 *
 * @param {import('better-sqlite3').Database} db
 * @param {number} assetId
 * @param {number} versionId
 */
export function syncToMirror(db, assetId, versionId) {
    try {
        const root = getMirrorPath(db);
        if (!root) return;
        const v = db.prepare(
            'SELECT * FROM asset_versions WHERE id = ? AND asset_id = ?'
        ).get(versionId, assetId);
        if (!v) return;
        const r = mirrorVersion(root, assetId, versionId, v);
        if (r.failed > 0) {
            console.warn(`[assets] 镜像同步部分失败：asset=${assetId} version=${versionId} failed=${r.failed}`);
        }
    } catch (e) {
        // 失败必须留下痕迹：吞掉异常会让「同步其实一直没生效」这种问题
        // 极难排查（曾经就因为漏 import 导致同步静默失效）。
        console.warn('[assets] 镜像同步异常（不影响上传）:', e && e.message);
        try {
            db.prepare(
                'INSERT INTO asset_operation_logs (asset_id, version_id, action, detail, operator) VALUES (?, ?, ?, ?, ?)'
            ).run(assetId, versionId, 'mirror_failed',
                `镜像同步失败：${(e && e.message) || '未知原因'}`, 'system');
        } catch { /* 日志写不进去就算了 */ }
    }
}

/**
 * 触发预览生成（异步，不阻塞上传响应）。
 *
 * 为什么异步：预览生成涉及图片解码 / 模型解析，856MB 的 GLB
 * 可能要几秒。上传接口必须立刻返回，否则用户会以为卡死了。
 *
 * 状态机（对应用户需求的 previewStatus）：
 *   pending → processing → ready / failed
 * 上传落盘后先置 pending，后台处理完再改终态。
 * 前端据此显示「正在生成预览 / 预览已完成 / 预览生成失败」。
 *
 * 失败**不影响原件**：原文件与元数据完好，只是没有预览图。
 *
 * @param {import('better-sqlite3').Database} db
 * @param {number} assetId
 * @param {number} versionId
 * @param {string} [ext] 扩展名（不传则从存储键推断）
 */
export function schedulePreview(db, assetId, versionId, ext) {
    const v = db.prepare(
        'SELECT original_storage_key FROM asset_versions WHERE id = ? AND asset_id = ?'
    ).get(versionId, assetId);
    if (!v || !v.original_storage_key) return;

    db.prepare(
        "UPDATE asset_versions SET preview_status = 'pending' WHERE id = ? AND asset_id = ?"
    ).run(versionId, assetId);

    // 故意不 await —— 队列化处理，上传立即返回
    return (async () => {
        try {
            db.prepare(
                "UPDATE asset_versions SET preview_status = 'processing' WHERE id = ? AND asset_id = ?"
            ).run(versionId, assetId);

            const r = await generatePreview({
                assetId,
                versionId,
                originalStorageKey: v.original_storage_key,
                ext
            });

            if (r.status === 'ready') {
                db.prepare(`
                    UPDATE asset_versions
                    SET preview_storage_key = ?,
                        thumbnail_storage_key = ?,
                        metadata = ?,
                        preview_status = 'ready',
                        preview_error = NULL
                    WHERE id = ? AND asset_id = ?
                `).run(
                    r.previewKey || null,
                    r.thumbnailKey || null,
                    JSON.stringify(r.metadata || {}),
                    versionId, assetId
                );
                if (r.metadata?.livePhoto) syncToMirror(db, assetId, versionId);
            } else if (r.status === 'failed') {
                db.prepare(`
                    UPDATE asset_versions
                    SET preview_status = 'failed', preview_error = ?
                    WHERE id = ? AND asset_id = ?
                `).run(r.error || '预览生成失败', versionId, assetId);
                try {
                    db.prepare(
                        'INSERT INTO asset_operation_logs (asset_id, version_id, action, detail, operator) VALUES (?, ?, ?, ?, ?)'
                    ).run(assetId, versionId, 'preview_failed',
                        `预览生成失败：${r.error || '未知原因'}`, 'system');
                } catch { /* 日志写不进去就算了 */ }
            } else {
                // none：该类型本来就不做预览，属正常
                db.prepare(
                    "UPDATE asset_versions SET preview_status = 'none' WHERE id = ? AND asset_id = ?"
                ).run(versionId, assetId);
            }
        } catch (e) {
            // 兜底：管线本身抛错也不能让状态卡在 processing
            try {
                db.prepare(
                    "UPDATE asset_versions SET preview_status = 'failed', preview_error = ? WHERE id = ? AND asset_id = ?"
                ).run((e && e.message) || '预览管线异常', versionId, assetId);
            } catch { /* 忽略 */ }
            console.warn('[assets] 预览生成异常（不影响上传）:', e && e.message);
        }
    })();
}
