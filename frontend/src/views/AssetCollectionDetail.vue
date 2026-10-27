<template>
    <div class="cd-page">
        <header class="cd-head">
            <div class="cd-head-text">
                <router-link class="cd-back" to="/assets/collections">← 所有集合</router-link>
                <h1 class="cd-title">{{ collection ? collection.name : '集合' }}</h1>
                <p v-if="collection" class="cd-desc">
                    <template v-if="collection.description">{{ collection.description }} · </template>
                    <strong>{{ assets.length }}</strong> 个资源
                </p>
            </div>
            <div v-if="collection" class="cd-head-actions">
                <button
                    v-if="selectedIds.length > 0"
                    class="btn"
                    type="button"
                    :disabled="busy"
                    @click="askRemove"
                >从集合移除（{{ selectedIds.length }}）</button>
                <button class="btn btn-danger" type="button" :disabled="busy" @click="askDelete">删除集合</button>
            </div>
        </header>

        <p v-if="loading" class="state-loading">加载中…</p>

        <div v-else-if="errorText" class="state-error">
            <p>{{ errorText }}</p>
            <router-link class="btn btn-sm" to="/assets/collections">返回集合列表</router-link>
        </div>

        <div v-else-if="assets.length === 0" class="empty-state">
            <p class="empty-title">这个集合还是空的</p>
            <p class="empty-desc">
                去资源管理里勾选资源，用「加入集合」把它们加进来。
            </p>
            <router-link class="btn btn-sm" to="/assets">去资源管理</router-link>
        </div>

        <ul v-else class="cd-grid">
            <li v-for="a in assets" :key="a.id" class="cd-card" :class="{ 'is-selected': selectedIds.includes(a.id) }">
                <label class="cd-check">
                    <input
                        type="checkbox"
                        :checked="selectedIds.includes(a.id)"
                        :aria-label="`选择 ${a.name}`"
                        @change="toggleSelect(a.id)"
                    />
                </label>
                <div class="cd-thumb">
                    <img
                        v-if="a.type === 'image' && !thumbFailed[a.id]"
                        :src="`/api/assets/files/${a.id}/thumbnail/auto`"
                        :alt="a.name"
                        loading="lazy"
                        @error="onThumbError(a.id)"
                    />
                    <span v-else class="cd-thumb-fallback">{{ typeLabel(a.type) }}</span>
                </div>
                <div class="cd-card-body">
                    <p class="cd-name" :title="a.name">{{ a.name }}</p>
                    <p class="cd-meta">
                        {{ typeLabel(a.type) }}
                        <template v-if="a.latestVersionNumber"> · v{{ a.latestVersionNumber }}</template>
                    </p>
                </div>
            </li>
        </ul>

        <p v-if="message" class="cd-message" :class="{ 'is-error': messageIsError }">{{ message }}</p>

        <Teleport to="body">
            <div v-if="confirmState" class="overlay" @click.self="confirmState = null">
                <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="cd-confirm-title">
                    <h2 class="dialog-title" id="cd-confirm-title">{{ confirmState.title }}</h2>
                    <p class="dialog-text">{{ confirmState.text }}</p>
                    <p v-if="confirmState.warn" class="dialog-warn">{{ confirmState.warn }}</p>
                    <div class="dialog-actions">
                        <button class="btn" type="button" :disabled="busy" @click="confirmState = null">取消</button>
                        <button class="btn btn-danger-solid" type="button" :disabled="busy" @click="confirmState.onConfirm">
                            {{ busy ? '处理中…' : confirmState.confirmLabel }}
                        </button>
                    </div>
                </div>
            </div>
        </Teleport>
    </div>
</template>

<script>
import { assetApi } from '../api/asset-client.js';

const TYPE_LABELS = {
    image: '图片', video: '视频', audio: '音频', model: '模型',
    archive: '压缩包', text: '文本', other: '其他'
};

/**
 * 集合详情：列出成员资源，支持多选移出集合。
 *
 * 这里**只做移除，不做删除** —— 「从集合移除」与「删除资源」是两件事，
 * 混在一起会让用户以为移出集合等于删文件。删除资源的入口只在资源管理页。
 */
export default {
    name: 'AssetCollectionDetail',
    data() {
        return {
            collection: null,
            assets: [],
            loading: true,
            busy: false,
            errorText: '',
            message: '',
            messageIsError: false,
            selectedIds: [],
            thumbFailed: {},
            confirmState: null
        };
    },
    mounted() {
        this.load();
    },
    computed: {
        collectionId() {
            return Number(this.$route.params.id);
        }
    },
    methods: {
        async load() {
            this.loading = true;
            this.errorText = '';
            try {
                const { res, body } = await assetApi.getCollection(this.collectionId);
                if (res.status === 404) {
                    this.errorText = '集合不存在或已被删除';
                    return;
                }
                if (!res.ok) throw new Error((body && body.message) || '加载集合失败');
                this.collection = body.collection;
                this.assets = body.assets || [];
                // 刷新后清掉已不在集合里的选中项
                const alive = new Set(this.assets.map((a) => a.id));
                this.selectedIds = this.selectedIds.filter((id) => alive.has(id));
            } catch (e) {
                this.errorText = e.network ? e.message : (e.message || '加载集合失败');
            } finally {
                this.loading = false;
            }
        },
        typeLabel(t) {
            return TYPE_LABELS[t] || TYPE_LABELS.other;
        },
        onThumbError(id) {
            this.$set(this.thumbFailed, id, true);
        },
        toggleSelect(id) {
            const i = this.selectedIds.indexOf(id);
            if (i >= 0) this.selectedIds.splice(i, 1);
            else this.selectedIds.push(id);
        },
        notify(text, isError = false) {
            this.message = text;
            this.messageIsError = isError;
        },
        askRemove() {
            const n = this.selectedIds.length;
            this.confirmState = {
                title: '从集合移除',
                text: `即将把 ${n} 个资源从这个集合移除。`,
                // 必须说清楚：移出集合 ≠ 删文件。否则用户不敢点。
                warn: '资源本身不会被删除，仍可在资源管理里找到。',
                confirmLabel: `移除 ${n} 个`,
                onConfirm: () => this.doRemove()
            };
        },
        async doRemove() {
            if (this.busy) return;
            this.busy = true;
            try {
                const { res, body } = await assetApi.removeFromCollection(this.collectionId, this.selectedIds);
                if (!res.ok) throw new Error((body && body.message) || '移除失败');
                this.notify(`已从集合移除 ${body.removed || 0} 个资源（资源本身未删除）`);
                this.confirmState = null;
                this.selectedIds = [];
                await this.load();
            } catch (e) {
                this.notify(e.network ? e.message : (e.message || '移除失败'), true);
            } finally {
                this.busy = false;
            }
        },
        askDelete() {
            const name = this.collection ? this.collection.name : '';
            this.confirmState = {
                title: '删除集合',
                text: `确定删除集合「${name}」吗？`,
                warn: `只会删除这个编组，其中的 ${this.assets.length} 个资源不会被删除。`,
                confirmLabel: '删除集合',
                onConfirm: () => this.doDelete()
            };
        },
        async doDelete() {
            if (this.busy) return;
            this.busy = true;
            try {
                const { res, body } = await assetApi.deleteCollection(this.collectionId);
                if (!res.ok) throw new Error((body && body.message) || '删除失败');
                this.confirmState = null;
                this.$router.push('/assets/collections');
            } catch (e) {
                this.notify(e.network ? e.message : (e.message || '删除失败'), true);
                this.confirmState = null;
            } finally {
                this.busy = false;
            }
        }
    }
};
</script>

<style scoped>
.cd-page { padding: 8px 0 40px; }

.cd-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 24px;
    margin-bottom: 22px;
}

.cd-back {
    display: inline-block;
    margin-bottom: 6px;
    font-size: var(--font-size-sm);
    color: var(--text-tertiary);
    text-decoration: none;
}

.cd-back:hover { color: var(--accent); }

.cd-title {
    margin: 0 0 6px;
    font-size: var(--font-size-xl);
    color: var(--text-primary);
}

.cd-desc {
    margin: 0;
    max-width: 66ch;
    font-size: var(--font-size-sm);
    line-height: 1.6;
    color: var(--text-secondary);
}

.cd-desc strong { color: var(--text-primary); font-weight: 600; }

.cd-head-actions { display: flex; gap: 10px; flex-shrink: 0; }

.cd-grid {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: 12px;
}

.cd-card {
    position: relative;
    border: 1px solid var(--panel-border);
    border-radius: var(--radius-md);
    background: var(--panel-background);
    overflow: hidden;
    transition: border-color var(--duration-fast) var(--ease-out);
}

.cd-card.is-selected { border-color: var(--accent-border); background: var(--selected-background); }

.cd-check {
    position: absolute;
    top: 8px;
    left: 8px;
    z-index: 1;
    padding: 2px;
    border-radius: var(--radius-sm);
    background: var(--panel-background);
}

.cd-thumb {
    display: flex;
    align-items: center;
    justify-content: center;
    aspect-ratio: 4 / 3;
    background: var(--hover-background);
    overflow: hidden;
}

.cd-thumb img { width: 100%; height: 100%; object-fit: cover; }

.cd-thumb-fallback {
    font-size: var(--font-size-sm);
    color: var(--text-tertiary);
}

.cd-card-body { padding: 10px 12px 12px; }

.cd-name {
    margin: 0;
    font-size: var(--font-size-sm);
    font-weight: 600;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.cd-meta {
    margin: 4px 0 0;
    font-size: var(--font-size-xs);
    color: var(--text-tertiary);
}

.cd-message {
    margin: 16px 0 0;
    padding: 10px 14px;
    border-radius: var(--radius-md);
    background: var(--success-soft);
    border: 1px solid var(--panel-border);
    font-size: var(--font-size-sm);
    color: var(--text-primary);
}

.cd-message.is-error { background: var(--danger-soft); }

.state-loading,
.state-error,
.empty-state { padding: 48px 0; text-align: center; color: var(--text-secondary); }

.empty-title { margin: 0 0 6px; font-size: var(--font-size-md); color: var(--text-primary); }
.empty-desc { margin: 0 0 14px; font-size: var(--font-size-sm); color: var(--text-tertiary); }
</style>
