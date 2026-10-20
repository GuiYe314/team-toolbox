<template>
    <!--
      右侧资源详情面板。
      宽屏固定在右侧；窄屏（≤1180px）由父组件渲染成带遮罩的抽屉。
    -->
    <div class="am-detail">
        <!-- 空态：未选中任何资源 -->
        <div v-if="!asset" class="am-detail-empty">
            <svg class="icon icon-lg" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4 4.5h6.5a2 2 0 0 1 2 2V20a1.6 1.6 0 0 0-1.6-1.5H4z" />
                <path d="M20 4.5h-6.5a2 2 0 0 0-2 2V20a1.6 1.6 0 0 0 1.6-1.5H20z" />
            </svg>
            <p class="am-hint">选中一个资源查看详情</p>
        </div>

        <template v-else>
            <!-- 头部：缩略图 + 名称 + 关闭 -->
            <header class="am-detail-head">
                <div class="am-detail-thumb">
                    <img v-if="thumbUrl" :src="thumbUrl" :alt="asset.name" @error="$event.target.style.display='none'" />
                    <svg v-else class="icon icon-lg" viewBox="0 0 24 24" aria-hidden="true">
                        <path v-for="(d, i) in typeIcon" :key="i" :d="d" />
                    </svg>
                </div>
                <div class="am-detail-titles">
                    <h3 class="am-detail-name" :title="asset.name">{{ asset.name }}</h3>
                    <div class="am-detail-badges">
                        <span class="am-ver" :class="statusTone">{{ statusLabel }}</span>
                        <span class="am-ver am-ver-latest" v-if="asset.latestVersionNumber">
                            最新 v{{ asset.latestVersionNumber }}
                        </span>
                        <span class="am-ver am-ver-pub" v-if="asset.publishedVersionNumber">
                            已发布 v{{ asset.publishedVersionNumber }}
                        </span>
                        <span class="am-ver am-ver-pending" v-else-if="asset.latestVersionNumber">
                            未发布
                        </span>
                    </div>
                </div>
                <button
                    v-hint
                    class="am-detail-close"
                    type="button"
                    title="关闭详情"
                    aria-label="关闭详情"
                    @click="$emit('close')"
                >
                    <svg class="icon icon-sm" viewBox="0 0 24 24" aria-hidden="true">
                        <line x1="6" y1="6" x2="18" y2="18" />
                        <line x1="18" y1="6" x2="6" y2="18" />
                    </svg>
                </button>
            </header>

            <!-- 主操作 -->
            <div class="am-detail-actions">
                <button
                    class="btn btn-sm"
                    type="button"
                    :disabled="!canPreview"
                    :title="canPreview ? '打开大型预览' : '该类型暂不支持浏览器内预览'"
                    @click="$emit('preview', asset)"
                >
                    预览
                </button>
                <button class="btn btn-sm" type="button" @click="download">下载</button>
                <button class="btn btn-sm btn-primary" type="button" @click="$emit('upload-new', asset)">
                    上传新版本
                </button>
            </div>
            <p v-if="asset.hasUnpublished && asset.publishedVersionId" class="am-detail-note">
                最新 v{{ asset.latestVersionNumber }} 尚未发布，客户端仍在使用 v{{ asset.publishedVersionNumber }}。
            </p>

            <!-- Tabs -->
            <nav class="am-tabs" role="tablist">
                <button
                    v-for="t in TABS"
                    :key="t.key"
                    class="am-tab"
                    :class="{ 'is-on': tab === t.key }"
                    role="tab"
                    :aria-selected="String(tab === t.key)"
                    @click="tab = t.key"
                >{{ t.label }}</button>
            </nav>

            <div class="am-detail-body scroll-area">
                <!-- ── 详情 ── -->
                <dl v-if="tab === 'info'" class="am-fields">
                    <div class="am-field"><dt>类型</dt><dd>{{ typeText }}</dd></div>
                    <div class="am-field"><dt>格式</dt><dd>{{ asset.mimeType }}</dd></div>
                    <div class="am-field">
                        <dt>大小</dt>
                        <dd>{{ sizeText }}<span v-if="asset.disk" class="am-field-sub">
                            共 {{ formatSize(asset.disk.total) }} / {{ asset.disk.versions }} 个版本
                        </span></dd>
                    </div>
                    <div class="am-field"><dt>上传者</dt><dd>{{ asset.createdBy }}</dd></div>
                    <div class="am-field"><dt>创建</dt><dd>{{ formatDateTime(asset.createdAt) }}</dd></div>
                    <div class="am-field"><dt>更新</dt><dd>{{ formatRelative(asset.updatedAt) }}</dd></div>
                    <div class="am-field" v-if="asset.description">
                        <dt>描述</dt><dd>{{ asset.description }}</dd>
                    </div>
                    <div class="am-field" v-if="asset.tags && asset.tags.length">
                        <dt>标签</dt>
                        <dd class="am-field-tags">
                            <span v-for="t in asset.tags" :key="t" class="am-tag">#{{ t }}</span>
                        </dd>
                    </div>
                    <div class="am-field">
                        <dt>状态</dt>
                        <dd>
                            <div class="am-status-actions">
                                <button
                                    v-for="s in STATUS_ACTIONS"
                                    :key="s.value"
                                    class="btn btn-sm"
                                    type="button"
                                    :disabled="asset.status === s.value || statusBusy"
                                    @click="changeStatus(s.value)"
                                >{{ s.label }}</button>
                            </div>
                        </dd>
                    </div>
                </dl>

                <!-- ── 版本历史 ── -->
                <div v-else-if="tab === 'versions'" class="am-versions">
                    <p v-if="versionsLoading" class="am-hint">加载中…</p>
                    <p v-else-if="versions.length === 0" class="am-hint">暂无版本</p>
                    <ul v-else class="am-version-list">
                        <li
                            v-for="v in versions"
                            :key="v.id"
                            class="am-version"
                            :class="{ 'is-latest': v.isLatest, 'is-published': v.isPublished }"
                        >
                            <div class="am-version-main">
                                <div class="am-version-head">
                                    <span class="am-version-no">v{{ v.versionNumber }}</span>
                                    <span class="am-ver am-ver-latest" v-if="v.isLatest">Latest</span>
                                    <span class="am-ver am-ver-pub" v-if="v.isPublished">Published</span>
                                </div>
                                <p class="am-version-meta">
                                    {{ formatSize(v.fileSize) }} · {{ v.createdBy }} · {{ formatRelative(v.createdAt) }}
                                </p>
                                <p v-if="v.comment" class="am-version-comment">{{ v.comment }}</p>
                                <p v-if="v.previewStatus === 'failed'" class="am-version-warn">
                                    预览生成失败：{{ v.previewError || '原因未知' }}（不影响原文件）
                                </p>
                            </div>
                            <div class="am-version-actions">
                                <button
                                    v-hint
                                    class="am-vbtn"
                                    type="button"
                                    title="预览该版本"
                                    aria-label="预览该版本"
                                    @click="$emit('preview', asset, v)"
                                >
                                    <svg class="icon icon-sm" viewBox="0 0 24 24" aria-hidden="true">
                                        <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
                                        <circle cx="12" cy="12" r="3" />
                                    </svg>
                                </button>
                                <button
                                    v-hint
                                    class="am-vbtn"
                                    type="button"
                                    title="下载该版本"
                                    aria-label="下载该版本"
                                    @click="downloadVersion(v)"
                                >
                                    <svg class="icon icon-sm" viewBox="0 0 24 24" aria-hidden="true">
                                        <path d="M12 4v10" /><polyline points="8 11 12 15 16 11" />
                                        <path d="M5 19h14" />
                                    </svg>
                                </button>
                                <button
                                    v-hint
                                    class="am-vbtn"
                                    type="button"
                                    title="发布该版本"
                                    aria-label="发布该版本"
                                    :disabled="v.isPublished || busy"
                                    @click="publish(v)"
                                >
                                    <svg class="icon icon-sm" viewBox="0 0 24 24" aria-hidden="true">
                                        <path d="M5 12.5l4.5 4.5L19 7.5" />
                                    </svg>
                                </button>
                                <button
                                    v-hint
                                    class="am-vbtn"
                                    type="button"
                                    title="恢复此版本（复制内容生成新版本）"
                                    aria-label="恢复此版本"
                                    :disabled="v.isLatest || busy"
                                    @click="restore(v)"
                                >
                                    <svg class="icon icon-sm" viewBox="0 0 24 24" aria-hidden="true">
                                        <path d="M4 11a8 8 0 1 1 2.3 6.3" /><polyline points="4 5 4 11 10 11" />
                                    </svg>
                                </button>
                                <button
                                    v-hint
                                    class="am-vbtn am-vbtn-danger"
                                    type="button"
                                    title="删除该版本"
                                    aria-label="删除该版本"
                                    :disabled="v.isLatest || v.isPublished || busy"
                                    @click="removeVersion(v)"
                                >
                                    <svg class="icon icon-sm" viewBox="0 0 24 24" aria-hidden="true">
                                        <path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12" />
                                    </svg>
                                </button>
                            </div>
                        </li>
                    </ul>
                </div>

                <!-- ── 操作记录 ── -->
                <div v-else class="am-logs">
                    <p v-if="!asset.logs || asset.logs.length === 0" class="am-hint">暂无操作记录</p>
                    <ol v-else class="am-log-list">
                        <li v-for="log in asset.logs" :key="log.id" class="am-log">
                            <span class="am-log-time">{{ formatDateTime(log.createdAt) }}</span>
                            <span class="am-log-action">{{ actionLabel(log.action) }}</span>
                            <span class="am-log-detail">{{ log.detail }}</span>
                            <span class="am-log-op">{{ log.operator }}</span>
                        </li>
                    </ol>
                </div>
            </div>

            <!-- 底部：移动 / 重命名 / 删除 -->
            <footer class="am-detail-foot">
                <button class="btn btn-sm" type="button" @click="$emit('rename', asset)">重命名</button>
                <button class="btn btn-sm" type="button" @click="$emit('move', asset)">移动</button>
                <button class="btn btn-sm btn-danger" type="button" @click="$emit('remove', asset)">
                    {{ isTrashView ? '永久删除' : '删除' }}
                </button>
            </footer>
        </template>
    </div>
</template>

<script>
import {
    typeLabel, typeMeta, formatSize, formatRelative, formatDateTime,
    ASSET_STATUS, ACTION_LABELS
} from '../../assets/asset-meta.js';
import assetApi from '../../api/asset-client.js';

export default {
    name: 'AssetDetails',
    props: {
        /** 资源详情（GET /assets/:id 的完整响应）；null 表示未选中 */
        asset: { type: Object, default: null },
        versions: { type: Array, default: () => [] },
        versionsLoading: { type: Boolean, default: false },
        canPreview: { type: Boolean, default: false },
        isTrashView: { type: Boolean, default: false },
        busy: { type: Boolean, default: false }
    },
    emits: ['close', 'preview', 'upload-new', 'rename', 'move', 'remove', 'refresh'],
    data() {
        return {
            tab: 'info',
            statusBusy: false,
            TABS: [
                { key: 'info', label: '详情' },
                { key: 'versions', label: '版本历史' },
                { key: 'logs', label: '操作记录' }
            ],
            // 状态操作按钮：把枚举转成 {value,label}，模板里直接 v-for
            STATUS_ACTIONS: Object.entries(ASSET_STATUS).map(([value, m]) => ({ value, label: m.label }))
        };
    },
    computed: {
        typeText() { return this.asset ? typeLabel(this.asset.type) : ''; },
        typeIcon() { return this.asset ? typeMeta(this.asset.type).paths : []; },
        sizeText() {
            if (!this.asset) return '';
            // 列表接口给 latestSize，详情接口可能没有，用它兜底
            return formatSize(this.asset.latestSize ?? 0);
        },
        statusLabel() { return this.asset ? (ASSET_STATUS[this.asset.status]?.label || this.asset.status) : ''; },
        statusTone() {
            if (!this.asset) return '';
            return 'am-ver-' + (ASSET_STATUS[this.asset.status]?.tone || 'neutral');
        },
        thumbUrl() {
            if (!this.asset) return '';
            // 缩略图可能尚未生成（预览管线未跑），此时会 404。
            // 不预先探测（多一次请求），而是给 <img> 挂 @error 隐藏自己，
            // 外层容器自然透出下方的类型图标。
            return assetApi.fileUrl(this.asset.id, 'thumbnail', 'latest');
        }
    },
    methods: {
        formatSize,
        formatRelative,
        formatDateTime,
        actionLabel(a) { return ACTION_LABELS[a] || a; },
        download() {
            if (!this.asset) return;
            window.open(assetApi.fileUrl(this.asset.id, 'original', 'latest', true), '_blank');
        },
        downloadVersion(v) {
            window.open(assetApi.fileUrl(this.asset.id, 'original', v.versionNumber, true), '_blank');
        },
        publish(v) { this.$emit('refresh', { action: 'publish', version: v }); },
        restore(v) { this.$emit('refresh', { action: 'restore', version: v }); },
        removeVersion(v) { this.$emit('refresh', { action: 'delete-version', version: v }); },
        async changeStatus(next) {
            if (!this.asset || this.statusBusy) return;
            this.statusBusy = true;
            try {
                const { res, body } = await assetApi.patch(this.asset.id, { status: next });
                if (!res.ok) throw new Error((body && body.message) || '更新失败');
                this.$emit('refresh', { action: 'status' });
            } catch (e) {
                // 失败必须让用户看到，不能静默
                window.alert(e.message || '更新失败');
            } finally {
                this.statusBusy = false;
            }
        }
    }
};
</script>

<style scoped>
.am-detail {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
}
.am-detail-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    height: 100%;
    color: var(--text-tertiary);
    opacity: 0.7;
}

.am-detail-head {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 13px 13px 11px;
    border-bottom: 1px solid var(--panel-border);
    flex: none;
}
.am-detail-thumb {
    flex: none;
    display: grid;
    place-items: center;
    width: 46px;
    height: 46px;
    border-radius: var(--radius-sm);
    background: var(--surface-sunken);
    border: 1px solid var(--panel-border);
    color: var(--text-tertiary);
    overflow: hidden;
}
.am-detail-thumb img { width: 100%; height: 100%; object-fit: cover; }
.am-detail-titles { flex: 1; min-width: 0; }
.am-detail-name {
    margin: 0 0 5px;
    font-size: var(--text-body);
    font-weight: var(--weight-semibold);
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.am-detail-badges { display: flex; flex-wrap: wrap; gap: 5px; }
.am-detail-close {
    flex: none;
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-tertiary);
    cursor: pointer;
    transition: background var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);
}
.am-detail-close:hover { background: var(--hover-background); color: var(--text-primary); }

.am-detail-actions {
    display: flex;
    gap: 6px;
    padding: 10px 13px;
    flex: none;
}
.am-detail-actions .btn { flex: 1; }
.am-detail-note {
    margin: 0 13px 10px;
    padding: 7px 9px;
    border-radius: var(--radius-sm);
    background: var(--warning-soft);
    color: var(--warning);
    font-size: var(--text-tag);
    line-height: var(--line-normal);
}

.am-tabs {
    display: flex;
    gap: 2px;
    padding: 0 13px;
    border-bottom: 1px solid var(--panel-border);
    flex: none;
}
.am-tab {
    height: 32px;
    padding: 0 10px;
    border: none;
    border-bottom: 2px solid transparent;
    background: none;
    color: var(--text-secondary);
    font-family: inherit;
    font-size: var(--text-secondary);
    font-weight: var(--weight-medium);
    cursor: pointer;
    transition: color var(--dur-fast) var(--ease-out), border-color var(--dur-fast) var(--ease-out);
}
.am-tab:hover { color: var(--text-primary); }
.am-tab.is-on { color: var(--accent); border-bottom-color: var(--accent); }

.am-detail-body { flex: 1; min-height: 0; padding: 12px 13px; }

/* ── 字段列表 ── */
.am-fields { margin: 0; display: flex; flex-direction: column; gap: 10px; }
.am-field { display: flex; flex-direction: column; gap: 3px; }
.am-field dt {
    font-size: var(--text-tag);
    color: var(--text-tertiary);
}
.am-field dd {
    margin: 0;
    font-size: var(--text-secondary);
    color: var(--text-primary);
    line-height: var(--line-normal);
    word-break: break-word;
}
.am-field-sub {
    display: block;
    margin-top: 2px;
    font-size: var(--text-tag);
    color: var(--text-tertiary);
}
.am-field-tags { display: flex; flex-wrap: wrap; gap: 5px; }
.am-tag {
    display: inline-flex;
    align-items: center;
    height: 19px;
    padding: 0 7px;
    border-radius: var(--radius-pill);
    background: var(--accent-soft);
    border: 1px solid var(--accent-border);
    color: var(--accent);
    font-size: var(--text-tag);
}
.am-status-actions { display: flex; gap: 5px; flex-wrap: wrap; }

/* ── 版本列表 ── */
.am-version-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.am-version {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 9px 10px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--panel-border);
    background: var(--panel-background);
}
.am-version.is-latest { border-color: var(--accent-border); }
.am-version.is-published { border-color: var(--success); }
.am-version-main { flex: 1; min-width: 0; }
.am-version-head { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.am-version-no {
    font-size: var(--text-secondary);
    font-weight: var(--weight-semibold);
    color: var(--text-primary);
    font-variant-numeric: tabular-nums;
}
.am-version-meta, .am-version-comment {
    margin: 4px 0 0;
    font-size: var(--text-tag);
    color: var(--text-tertiary);
    line-height: var(--line-normal);
}
.am-version-comment { color: var(--text-secondary); }
.am-version-warn {
    margin: 4px 0 0;
    font-size: var(--text-tag);
    color: var(--danger);
}
.am-version-actions { display: flex; gap: 1px; flex: none; }
.am-vbtn {
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--text-tertiary);
    cursor: pointer;
    transition: background var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);
}
.am-vbtn:hover:not(:disabled) { background: var(--hover-background); color: var(--text-primary); }
.am-vbtn:disabled { opacity: 0.35; cursor: not-allowed; }
.am-vbtn-danger:hover:not(:disabled) { background: var(--danger-soft); color: var(--danger); }

/* ── 日志 ── */
.am-log-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 7px; }
.am-log { display: flex; flex-direction: column; gap: 2px; padding-bottom: 7px; border-bottom: 1px solid var(--panel-border); }
.am-log:last-child { border-bottom: none; }
.am-log-time { font-size: var(--text-tag); color: var(--text-tertiary); font-variant-numeric: tabular-nums; }
.am-log-action { font-size: var(--text-secondary); color: var(--text-primary); font-weight: var(--weight-medium); }
.am-log-detail { font-size: var(--text-tag); color: var(--text-secondary); }
.am-log-op { font-size: var(--text-tag); color: var(--text-tertiary); }

.am-detail-foot {
    display: flex;
    gap: 6px;
    padding: 10px 13px;
    border-top: 1px solid var(--panel-border);
    flex: none;
}
.am-detail-foot .btn { flex: 1; }
</style>