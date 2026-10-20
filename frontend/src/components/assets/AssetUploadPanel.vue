<template>
    <!--
      右下角全局上传任务面板。
      可折叠：收起时只显示一个带计数的悬浮按钮，不遮挡资源列表。
      上传不阻塞界面 —— 用户可继续浏览资源，本面板只是状态镜像。
    -->
    <div class="am-upload-panel" :class="{ 'is-open': open }">
        <button
            class="am-upload-fab"
            type="button"
            :aria-expanded="String(open)"
            aria-label="上传任务"
            @click="open = !open"
        >
            <svg class="icon icon-sm" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 16V5" /><polyline points="7.5 9.5 12 5 16.5 9.5" />
                <path d="M4.5 19h15" />
            </svg>
            <span v-if="activeCount > 0" class="am-upload-badge">{{ activeCount }}</span>
        </button>

        <div v-if="open" class="am-upload-body">
            <header class="am-upload-head">
                <h3 class="am-upload-title">
                    上传任务
                    <span v-if="items.length" class="am-hint">{{ items.length }}</span>
                </h3>
                <div class="am-upload-tools">
                    <button
                        v-if="finishedCount > 0"
                        class="btn btn-sm btn-ghost"
                        type="button"
                        @click="$emit('clear-finished')"
                    >清除已完成</button>
                    <button
                        v-if="activeCount > 0"
                        class="btn btn-sm btn-ghost"
                        type="button"
                        @click="$emit('cancel-all')"
                    >全部取消</button>
                    <button
                        v-hint
                        class="am-vbtn"
                        type="button"
                        title="收起"
                        aria-label="收起上传面板"
                        @click="open = false"
                    >
                        <svg class="icon icon-sm" viewBox="0 0 24 24" aria-hidden="true">
                            <polyline points="6 9.5 12 15.5 18 9.5" />
                        </svg>
                    </button>
                </div>
            </header>

            <p v-if="items.length === 0" class="am-hint am-upload-empty">暂无上传任务</p>

            <ul v-else class="am-upload-list">
                <li v-for="item in items" :key="item.id" class="am-upload-item">
                    <!-- 同名冲突：三选一决策面板 -->
                    <div v-if="item.state === 'needs-decision'" class="am-conflict">
                        <p class="am-conflict-title">文件已经存在</p>
                        <p class="am-conflict-text">{{ item.conflict.existingName }}</p>
                        <p class="am-hint">选择如何处理本次上传：</p>
                        <div class="am-conflict-actions">
                            <!-- 默认推荐：作为新版本上传（保留完整历史） -->
                            <button
                                class="btn btn-sm btn-primary"
                                type="button"
                                @click="$emit('resolve', item.id, 'version')"
                            >作为新版本上传</button>
                            <button
                                class="btn btn-sm"
                                type="button"
                                @click="$emit('resolve', item.id, 'new')"
                            >创建新的资源</button>
                            <button
                                class="btn btn-sm"
                                type="button"
                                @click="$emit('resolve', item.id, 'cancel')"
                            >取消</button>
                        </div>
                    </div>

                    <template v-else>
                        <div class="am-upload-row">
                            <span class="am-upload-name" :title="item.name">{{ item.name }}</span>
                            <span class="am-upload-state">
                                <template v-if="item.state === 'success'">完成</template>
                                <template v-else-if="item.state === 'error'">失败</template>
                                <template v-else-if="item.state === 'canceled'">已取消</template>
                                <template v-else>{{ percent(item) }}%</template>
                            </span>
                            <button
                                v-if="item.state === 'uploading' || item.state === 'queued'"
                                v-hint
                                class="am-vbtn"
                                type="button"
                                title="取消该上传"
                                aria-label="取消该上传"
                                @click="$emit('cancel', item.id)"
                            >
                                <svg class="icon icon-sm" viewBox="0 0 24 24" aria-hidden="true">
                                    <line x1="6" y1="6" x2="18" y2="18" />
                                    <line x1="18" y1="6" x2="6" y2="18" />
                                </svg>
                            </button>
                        </div>

                        <div class="am-upload-bar" :class="'is-' + item.state">
                            <div class="am-upload-fill" :style="{ width: percent(item) + '%' }"></div>
                        </div>

                        <p class="am-upload-meta">
                            <span>{{ formatSize(item.size) }}</span>
                            <span v-if="item.isLarge" class="am-ver">分片上传</span>
                            <span v-if="item.speed > 0">{{ formatSize(Math.round(item.speed)) }}/s</span>
                            <span v-if="item.eta">剩余 {{ formatEta(item.eta) }}</span>
                            <span v-if="item.error" class="am-upload-err">{{ item.error }}</span>
                        </p>
                    </template>
                </li>
            </ul>
        </div>
    </div>
</template>

<script>
import { formatSize } from '../../assets/asset-meta.js';
import UploadManager from '../../assets/upload-manager.js';

export default {
    name: 'AssetUploadPanel',
    props: {
        items: { type: Array, default: () => [] }
    },
    emits: ['cancel', 'cancel-all', 'clear-finished', 'resolve'],
    data() {
        return { open: false };
    },
    computed: {
        activeCount() {
            return this.items.filter(
                (i) => i.state === 'uploading' || i.state === 'queued'
            ).length;
        },
        finishedCount() {
            return this.items.filter(
                (i) => i.state === 'success' || i.state === 'error' || i.state === 'canceled'
            ).length;
        }
    },
    watch: {
        // 有任务时自动展开一次，让用户知道上传已经开始；
        // 之后不打扰，由用户自己收起
        items: {
            immediate: true,
            handler(val) {
                if (val.length > 0 && !this.open) this.open = true;
            }
        }
    },
    methods: {
        formatSize,
        formatEta: UploadManager.formatEta,
        percent(item) { return Math.round((item.progress || 0) * 100); }
    }
};
</script>

<style scoped>
.am-upload-panel {
    position: fixed;
    right: calc(var(--page-padding) + 8px);
    bottom: calc(var(--page-padding) + 8px);
    z-index: var(--z-dropdown);
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 8px;
}
.am-upload-fab {
    position: relative;
    display: grid;
    place-items: center;
    width: 38px;
    height: 38px;
    border-radius: var(--radius-pill);
    border: 1px solid var(--panel-border);
    background: var(--surface-solid);
    color: var(--text-secondary);
    cursor: pointer;
    box-shadow: var(--shadow-overlay);
    transition: background var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);
}
.am-upload-fab:hover { color: var(--accent); }
.am-upload-badge {
    position: absolute;
    top: -4px;
    right: -4px;
    min-width: 17px;
    height: 17px;
    padding: 0 4px;
    display: grid;
    place-items: center;
    border-radius: var(--radius-pill);
    background: var(--accent);
    color: var(--accent-contrast);
    font-size: 10px;
    font-weight: var(--weight-semibold);
    font-variant-numeric: tabular-nums;
}

.am-upload-body {
    width: min(320px, calc(100vw - var(--page-padding) * 2));
    max-height: 46vh;
    display: flex;
    flex-direction: column;
    border-radius: var(--radius-lg);
    border: 1px solid var(--panel-border);
    background: var(--surface-solid);
    box-shadow: var(--shadow-overlay);
    overflow: hidden;
}
.am-upload-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    flex: none;
    padding: 10px 12px;
    border-bottom: 1px solid var(--panel-border);
}
.am-upload-title {
    margin: 0;
    font-size: var(--text-secondary);
    font-weight: var(--weight-semibold);
    color: var(--text-primary);
    display: flex;
    align-items: center;
    gap: 6px;
}
.am-upload-tools { display: flex; align-items: center; gap: 4px; }
.am-upload-empty { padding: 16px 12px; text-align: center; }

.am-upload-list {
    list-style: none;
    margin: 0;
    padding: 8px 12px 12px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 10px;
}
.am-upload-item { display: flex; flex-direction: column; gap: 4px; }
.am-upload-row { display: flex; align-items: center; gap: 8px; }
.am-upload-name {
    flex: 1;
    min-width: 0;
    font-size: var(--text-secondary);
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.am-upload-state {
    flex: none;
    font-size: var(--text-tag);
    color: var(--text-tertiary);
    font-variant-numeric: tabular-nums;
}
.am-upload-bar {
    height: 4px;
    border-radius: var(--radius-pill);
    background: var(--panel-background-hover);
    overflow: hidden;
}
.am-upload-fill {
    height: 100%;
    background: var(--accent);
    transition: width var(--dur-base) var(--ease-out);
}
.am-upload-bar.is-success .am-upload-fill { background: var(--success); }
.am-upload-bar.is-error .am-upload-fill { background: var(--danger); }
.am-upload-bar.is-canceled .am-upload-fill { background: var(--text-tertiary); }
.am-upload-meta {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    margin: 0;
    font-size: var(--text-tag);
    color: var(--text-tertiary);
}
.am-upload-err { color: var(--danger); }

/* ── 同名冲突三选一 ── */
.am-conflict {
    padding: 10px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--warning);
    background: var(--warning-soft);
}
.am-conflict-title {
    margin: 0 0 3px;
    font-size: var(--text-secondary);
    font-weight: var(--weight-semibold);
    color: var(--warning);
}
.am-conflict-text {
    margin: 0 0 6px;
    font-size: var(--text-tag);
    color: var(--text-secondary);
    line-height: var(--line-normal);
}
.am-conflict-actions { display: flex; gap: 5px; flex-wrap: wrap; margin-top: 7px; }
</style>