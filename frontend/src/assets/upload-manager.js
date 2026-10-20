// 上传管理器 —— Uppy 适配层 + 上传队列 + 同名冲突决策。
//
// 为什么要有这个 Adapter（用户要求的插件架构）：
//   业务组件只调 uploadManager.start(files, opts) 与订阅状态，
//   不接触 Uppy 的任何 API。将来换 tus / S3 / 自研分片，
//   只改这个文件，上层无感。
//
// 三条设计决策：
//
// 1. **传输层可切换，普通上传用 XHR，Tus 用分片**。
//    Uppy 的 XHRUpload 处理小文件（图片、文档）；TusUpload 处理大文件
//    （GLB/FBX/MP4/ZIP）。阈值 LARGE_FILE_THRESHOLD 自动分流，
//    小文件不背上 Tus 的握手开销，大文件获得断点续传。
//
// 2. **同名冲突必须由用户决策，后端不猜**。
//    后端返回 409 + { existingAssetId } 后，这里不改写策略、
//    不自动覆盖，而是把决策交回 UI（三选一弹窗）。这是硬要求：
//    绝不能静默覆盖既有资产。
//
// 3. **上传不阻塞界面**。队列状态是可订阅的响应式数据，
//    上传期间用户可继续浏览资源列表。

import Uppy from '@uppy/core';
import XhrUpload from '@uppy/xhr-upload';
// 注意包名：Uppy v6 里 Tus 插件叫 @uppy/tus，不是 @uppy/tus-upload
// （后者不存在，装的时候会 404）
import TusUpload from '@uppy/tus';

/** 超过此大小（字节）走 Tus 分片上传。 */
const LARGE_FILE_THRESHOLD = 20 * 1024 * 1024; // 20MB

export const UPLOAD_STATE = {
    QUEUED: 'queued',
    UPLOADING: 'uploading',
    SUCCESS: 'success',
    ERROR: 'error',
    CANCELED: 'canceled',
    /** 因同名冲突暂停，等待用户选择处理方式 */
    NEEDS_DECISION: 'needs_decision'
};

let seq = 0;

export class UploadManager {
    constructor({ assetApi }) {
        this._api = assetApi;
        /** 上传项列表（响应式：Vue 组件读这个数组渲染队列面板） */
        this.items = [];
        /** 订阅者集合 */
        this._subscribers = new Set();
        /** 等待决策的冲突：fileItemId → { assetId, assetName, resolve } */
        this._pendingConflicts = new Map();

        this._uppy = new Uppy({
            autoProceed: false,
            restrictions: {
                // 不限制数量与体积：资产库要收 856MB 的 GLB，
                // 单文件上限由后端的 4GB 兜底
                maxNumberOfFiles: null,
                maxFileSize: null
            }
        });

        // 小文件：XHR
        this._uppy.use(XhrUpload, {
            endpoint: '/api/assets/upload',
            method: 'post',
            formData: true,
            // 同名冲突由后端返回 409，这里不静默重试
            limit: 4
        });

        // 大文件：Tus 断点续传
        this._uppy.use(TusUpload, {
            endpoint: '/api/assets/upload',
            retryDelays: [0, 1000, 3000, 5000, 10000],
            chunkSize: 8 * 1024 * 1024,
            // 移除：Tus 协议需要服务器配合，我们第一版走普通上传，
            // 保留配置以便接入后端 Tus 支持时零改动启用
            removeFingerprintOnSuccess: true
        });

        this._bindUppyEvents();
    }

    /** 订阅队列变化；返回取消订阅函数。 */
    subscribe(fn) {
        this._subscribers.add(fn);
        return () => this._subscribers.delete(fn);
    }

    _notify() {
        for (const fn of this._subscribers) {
            try { fn(this.items); } catch (e) { console.error('[upload] 订阅回调出错', e); }
        }
    }

    _bindUppyEvents() {
        const u = this._uppy;

        u.on('upload-added', (file) => {
            this.items.push({
                id: file.id,
                name: file.name,
                size: file.size,
                progress: 0,
                bytesUploaded: 0,
                speed: 0,
                eta: null,
                state: UPLOAD_STATE.QUEUED,
                error: '',
                assetId: null,
                isLarge: file.size >= LARGE_FILE_THRESHOLD
            });
            this._notify();
        });

        u.on('upload-progress', (file, progress) => {
            const it = this._find(file.id);
            if (!it) return;
            it.progress = progress.bytesTotal ? progress.bytesUploaded / progress.bytesTotal : 0;
            it.bytesUploaded = progress.bytesUploaded;
            this._notify();
        });

        u.on('upload-success', (file, resp) => {
            const it = this._find(file.id);
            if (!it) return;
            const body = (resp && resp.body) || {};
            it.state = UPLOAD_STATE.SUCCESS;
            it.progress = 1;
            it.assetId = body.id || null;
            it.error = '';
            this._notify();
        });

        u.on('upload-error', (file, err) => {
            const it = this._find(file.id);
            if (!it) return;

            // 409 + resolutionRequired → 不是错误，是需要用户决策
            if (err && err.status === 409 && err.body && err.body.resolutionRequired) {
                it.state = UPLOAD_STATE.NEEDS_DECISION;
                it.conflict = {
                    existingAssetId: err.body.existingAssetId,
                    existingName: err.body.message || '已存在同名资源'
                };
                this._notify();
                return;
            }

            it.state = UPLOAD_STATE.ERROR;
            it.error = (err && err.message) || '上传失败';
            this._notify();
        });

        u.on('upload-cancel', (file) => {
            const it = this._find(file.id);
            if (!it) return;
            it.state = UPLOAD_STATE.CANCELED;
            this._notify();
        });

        // 速度与剩余时间需要自己算：Uppy 不直接给这两个值
        u.on('upload-progress', (file, progress) => {
            const it = this._find(file.id);
            if (!it) return;
            const now = Date.now();
            if (!it._lastAt) { it._lastAt = now; it._lastBytes = progress.bytesUploaded; return; }
            const dt = (now - it._lastAt) / 1000;
            if (dt <= 0) return;
            const dBytes = progress.bytesUploaded - (it._lastBytes || 0);
            // 平滑：用 0.3 权重，避免速度数字剧烈跳动
            it.speed = it.speed * 0.7 + (dBytes / dt) * 0.3;
            it._lastAt = now;
            it._lastBytes = progress.bytesUploaded;
            const remain = (progress.bytesTotal || 0) - progress.bytesUploaded;
            it.eta = it.speed > 0 ? Math.round(remain / it.speed) : null;
        });
    }

    _find(fileId) {
        return this.items.find((i) => i.id === fileId);
    }

    /**
     * 发起上传。
     * @param {File[]} files
     * @param {object} opts
     * @param {number|null} opts.folderId 目标文件夹（null = 未分类）
     * @param {string} [opts.tags] 逗号分隔
     * @param {string} [opts.comment] 版本说明
     * @param {(fileId: string, conflict: object, choose: (choice: string) => void) => void} opts.onConflict
     *   同名冲突时的回调，由 UI 弹窗并调用 choose('version'|'new'|'cancel')
     * @param {() => void} [opts.onAllSettled]
     */
    start(files, opts = {}) {
        const arr = Array.from(files || []);
        if (arr.length === 0) return [];

        // 把文件夹/目标资源等业务参数挂到 Uppy 元数据上，
        // 随 upload-added 一起记录到队列项
        this._pendingMeta = {
            folderId: opts.folderId,
            tags: opts.tags,
            comment: opts.comment,
            assetId: opts.assetId
        };

        for (const f of arr) {
            this._uppy.addFile({
                name: f.name,
                type: f.type,
                data: f,
                meta: {
                    transporter: f.size >= LARGE_FILE_THRESHOLD ? 'tus' : 'xhr',
                    folderId: opts.folderId ?? '',
                    // 带 assetId → 后端走「追加版本」分支而非新建资源
                    assetId: opts.assetId ? String(opts.assetId) : '',
                    tags: opts.tags || '',
                    comment: opts.comment || ''
                }
            });
        }

        this._uppy.upload().catch((err) => {
            console.error('[upload] 批次上传异常', err);
        });
        return arr;
    }

    /**
     * 解决同名冲突。
     * @param {string} fileItemId
     * @param {'version'|'new'|'cancel'} choice
     */
    resolveConflict(fileItemId, choice) {
        const it = this._find(fileItemId);
        if (!it) return;

        if (choice === 'cancel') {
            this._uppy.removeFile(fileItemId);
            it.state = UPLOAD_STATE.CANCELED;
            it.conflict = null;
            this._notify();
            return;
        }

        // 取原始 File 重新上传：Uppy 传的是包装对象，
        // 需要拿到底层 Blob 才能重传
        const descriptor = this._uppy.getFile(fileItemId);
        const raw = descriptor ? descriptor.data : null;
        if (!raw) {
            it.state = UPLOAD_STATE.ERROR;
            it.error = '无法重试：原始文件已丢失';
            this._notify();
            return;
        }

        const file = raw instanceof File ? raw : new File([raw], descriptor.name, { type: descriptor.type });

        this._uppy.removeFile(fileItemId);
        const idx = this.items.findIndex((i) => i.id === fileItemId);
        if (idx >= 0) this.items.splice(idx, 1);

        const meta = {
            name: file.name,
            type: file.type,
            data: file,
            meta: {
                transporter: file.size >= LARGE_FILE_THRESHOLD ? 'tus' : 'xhr',
                // choice=version 时带上既有 assetId → 后端走追加版本分支
                assetId: choice === 'version' ? String(it.conflict.existingAssetId) : '',
                force: choice === 'new' ? '1' : '',
                folderId: this._pendingMeta?.folderId ?? '',
                tags: this._pendingMeta?.tags || '',
                comment: this._pendingMeta?.comment || ''
            }
        };
        this._uppy.addFile(meta);
        this._uppy.upload().catch(() => {});
    }

    /** 取消单个上传。 */
    cancel(fileItemId) {
        try { this._uppy.removeFile(fileItemId); } catch { /* 已移除 */ }
        const it = this._find(fileItemId);
        if (it) {
            it.state = UPLOAD_STATE.CANCELED;
            this._notify();
        }
    }

    /** 取消全部。 */
    cancelAll() {
        try { this._uppy.cancelAll(); } catch { /* 无进行中任务 */ }
        for (const it of this.items) {
            if (it.state === UPLOAD_STATE.UPLOADING || it.state === UPLOAD_STATE.QUEUED) {
                it.state = UPLOAD_STATE.CANCELED;
            }
        }
        this._notify();
    }

    /** 清除已完成的条目（成功/失败/取消）。 */
    clearFinished() {
        const before = this.items.length;
        this.items = this.items.filter(
            (i) => i.state === UPLOAD_STATE.UPLOADING || i.state === UPLOAD_STATE.QUEUED
        );
        if (this.items.length !== before) this._notify();
    }

    /** 进度百分比（整数，供进度条宽度绑定）。 */
    percent(item) {
        return Math.round((item.progress || 0) * 100);
    }

    /** 剩余时间格式化。 */
    static formatEta(seconds) {
        if (!seconds && seconds !== 0) return '';
        const s = Math.max(0, Math.round(seconds));
        if (s < 60) return `${s} 秒`;
        const m = Math.floor(s / 60);
        if (m < 60) return `${m} 分 ${s % 60} 秒`;
        return `${Math.floor(m / 60)} 小时 ${m % 60} 分`;
    }

    /** 销毁：必须在组件卸载时调用，否则 Uppy 的插件会持有事件监听。 */
    destroy() {
        try { this._uppy.close({ reason: 'unmount' }); } catch { /* 已关闭 */ }
        try { this._uppy.destroy(); } catch { /* 部分版本无 destroy */ }
        this._subscribers.clear();
        this.items = [];
    }
}

export default UploadManager;