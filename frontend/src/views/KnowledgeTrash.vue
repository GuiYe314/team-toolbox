<template>
    <div class="trash-page">
        <!-- 页头 -->
        <header class="trash-head">
            <div class="trash-head-text">
                <h1 class="trash-title">回收站</h1>
                <p class="trash-desc">
                    删除的文档会先放在这里，不会立刻消失。
                    <strong>永久删除后无法恢复</strong>，请确认再操作。
                </p>
            </div>
            <div class="trash-head-actions">
                <router-link class="btn" to="/kb">返回知识库</router-link>
                <button
                    v-if="total > 0"
                    class="btn btn-danger"
                    type="button"
                    :disabled="busy"
                    @click="askEmpty"
                >清空回收站</button>
            </div>
        </header>

        <!-- 状态条 -->
        <div v-if="total > 0" class="trash-bar">
            <span class="trash-count">{{ total }} 篇文档在回收站</span>
            <button
                v-if="selectedIds.length > 0"
                class="btn btn-sm"
                type="button"
                :disabled="busy"
                @click="restoreSelected"
            >恢复选中（{{ selectedIds.length }}）</button>
            <button
                v-if="selectedIds.length > 0"
                class="btn btn-sm btn-danger"
                type="button"
                :disabled="busy"
                @click="askPurgeSelected"
            >永久删除选中</button>
        </div>

        <!-- 加载 / 错误 -->
        <p v-if="loading && items.length === 0" class="state-loading">加载中…</p>
        <div v-else-if="errorText && items.length === 0" class="state-error">
            <p>{{ errorText }}</p>
            <button class="btn btn-sm" type="button" @click="load">重试</button>
        </div>

        <!-- 空状态 -->
        <div v-else-if="items.length === 0" class="empty-state">
            <p class="empty-title">回收站是空的</p>
            <p class="empty-desc">删除文档后可以在这里找回。</p>
            <router-link class="btn btn-sm" to="/kb">去知识库看看</router-link>
        </div>

        <!-- 列表 -->
        <ul v-else class="trash-list">
            <li v-for="doc in items" :key="doc.id" class="trash-item">
                <label class="trash-check">
                    <input
                        type="checkbox"
                        :checked="selectedIds.includes(doc.id)"
                        :aria-label="`选择 ${doc.title}`"
                        @change="toggleSelect(doc.id)"
                    />
                </label>
                <div class="trash-body">
                    <div class="trash-item-head">
                        <span class="trash-item-title">{{ doc.title }}</span>
                        <span v-if="doc.category_name" class="trash-tag">{{ doc.category_name }}</span>
                        <span v-for="t in doc.tags" :key="t" class="trash-tag trash-tag-plain">{{ t }}</span>
                    </div>
                    <p v-if="doc.snippet" class="trash-snippet">{{ doc.snippet }}</p>
                    <p class="trash-meta">
                        删除于 {{ formatTime(doc.deleted_at) }}
                        <template v-if="doc.child_count > 0">
                            · 含 {{ doc.child_count }} 个子页
                        </template>
                    </p>
                </div>
                <div class="trash-item-actions">
                    <button class="btn btn-sm" type="button" :disabled="busy" @click="restoreOne(doc)">恢复</button>
                    <button class="btn btn-sm btn-danger" type="button" :disabled="busy" @click="askPurgeOne(doc)">永久删除</button>
                </div>
            </li>
        </ul>

        <!-- 提示条 -->
        <p v-if="message" class="trash-message" :class="{ 'is-error': messageIsError }">{{ message }}</p>

        <!-- 确认弹窗：必须 Teleport 到 body，
             .glass-panel 的 backdrop-filter 会创建包含块，否则 fixed 定位会错位 -->
        <Teleport to="body">
            <div v-if="confirmState" class="overlay" @click.self="confirmState = null">
                <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="trash-confirm-title">
                    <h2 class="dialog-title" id="trash-confirm-title">{{ confirmState.title }}</h2>
                    <p class="dialog-text">{{ confirmState.text }}</p>
                    <p v-if="confirmState.warn" class="dialog-warn">{{ confirmState.warn }}</p>
                    <div class="dialog-actions">
                        <button class="btn" type="button" :disabled="busy" @click="confirmState = null">取消</button>
                        <button class="btn btn-danger" type="button" :disabled="busy" @click="confirmState.onConfirm">
                            {{ busy ? '处理中…' : confirmState.confirmLabel }}
                        </button>
                    </div>
                </div>
            </div>
        </Teleport>
    </div>
</template>

<script>
import { api } from '../api/client.js';

/**
 * 文档回收站。
 *
 * 为什么要独立页面而不是在知识库列表里加「回收站模式」：
 * 知识库页已有批量模式、搜索、导入导出、页面树，再塞一个模式会显著增加耦合；
 * 而回收站的操作（恢复 / 永久删除 / 清空）与正常浏览的交互几乎不重叠。
 *
 * 前端只做两件事：展示与二次确认。
 * 「只允许删回收站里的文档」「永久删除不带走已恢复的子页」这些约束都在服务端，
 * 前端不可能绕过。
 */
export default {
    name: 'KnowledgeTrash',
    data() {
        return {
            items: [],
            total: 0,
            loading: false,
            busy: false,
            errorText: '',
            message: '',
            messageIsError: false,
            selectedIds: [],
            confirmState: null
        };
    },
    mounted() {
        this.load();
    },
    methods: {
        async load() {
            this.loading = true;
            this.errorText = '';
            try {
                const { res, body } = await api.listTrashDocuments('?limit=200');
                if (!res.ok) throw new Error((body && body.message) || '加载回收站失败');
                this.items = (body && body.items) || [];
                this.total = (body && body.total) || 0;
                // 列表刷新后，清掉已不存在的选中项
                const alive = new Set(this.items.map((d) => d.id));
                this.selectedIds = this.selectedIds.filter((id) => alive.has(id));
            } catch (e) {
                this.errorText = e.network ? e.message : (e.message || '加载回收站失败');
            } finally {
                this.loading = false;
            }
        },
        formatTime(v) {
            if (!v) return '未知时间';
            // SQLite 的 datetime('now') 是 "YYYY-MM-DD HH:MM:SS"（UTC），
            // 直接 new Date() 在部分浏览器会被当本地时间，这里显式补 Z
            const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(v) ? v.replace(' ', 'T') + 'Z' : v;
            const d = new Date(iso);
            if (Number.isNaN(d.getTime())) return v;
            const pad = (n) => String(n).padStart(2, '0');
            return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
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

        // ── 恢复 ──
        async restoreOne(doc) {
            await this.doRestore([doc.id]);
        },
        async restoreSelected() {
            await this.doRestore([...this.selectedIds]);
        },
        async doRestore(ids) {
            if (ids.length === 0 || this.busy) return;
            this.busy = true;
            this.confirmState = null;
            try {
                const { res, body } = await api.restoreDocuments(ids);
                if (!res.ok) throw new Error((body && body.message) || '恢复失败');
                const parts = [`已恢复 ${body.restored || 0} 篇文档`];
                // 父级不可用时会把文档提升为顶层，必须告诉用户，否则他会找不到它
                if (body.reparented > 0) {
                    parts.push(`${body.reparented} 篇的上级页面已不存在，已改为顶层页面`);
                }
                this.notify(parts.join('；'));
                await this.load();
            } catch (e) {
                this.notify(e.network ? e.message : (e.message || '恢复失败'), true);
            } finally {
                this.busy = false;
            }
        },

        // ── 永久删除 ──
        askPurgeOne(doc) {
            const childWarn = doc.child_count > 0
                ? `该文档还有 ${doc.child_count} 个子页，若它们也在回收站里，会一并永久删除。`
                : '';
            this.confirmState = {
                title: '永久删除文档',
                text: `「${doc.title}」将被彻底删除，无法恢复。`,
                warn: childWarn,
                confirmLabel: '永久删除',
                onConfirm: () => this.doPurge([doc.id])
            };
        },
        askPurgeSelected() {
            const n = this.selectedIds.length;
            this.confirmState = {
                title: '永久删除所选文档',
                text: `即将永久删除 ${n} 篇文档，无法恢复。`,
                warn: '若其中有父子关系，子页会一并被删除。已恢复到知识库的子页不受影响。',
                confirmLabel: `永久删除 ${n} 篇`,
                onConfirm: () => this.doPurge([...this.selectedIds])
            };
        },
        async doPurge(ids) {
            if (ids.length === 0 || this.busy) return;
            this.busy = true;
            try {
                const { res, body } = await api.purgeDocuments(ids);
                if (!res.ok) throw new Error((body && body.message) || '永久删除失败');
                const parts = [`已永久删除 ${body.deleted || 0} 篇文档`];
                if (body.detached > 0) {
                    parts.push(`${body.detached} 篇已恢复到知识库的子页已保留并移为顶层`);
                }
                this.notify(parts.join('；'));
                this.confirmState = null;
                await this.load();
            } catch (e) {
                this.notify(e.network ? e.message : (e.message || '永久删除失败'), true);
            } finally {
                this.busy = false;
            }
        },
        askEmpty() {
            this.confirmState = {
                title: '清空回收站',
                text: `即将永久删除回收站里的全部 ${this.total} 篇文档，无法恢复。`,
                warn: '建议先确认其中没有还需要找回的内容。',
                confirmLabel: '清空',
                onConfirm: () => this.doEmpty()
            };
        },
        async doEmpty() {
            if (this.busy) return;
            this.busy = true;
            try {
                const { res, body } = await api.emptyTrash();
                if (!res.ok) throw new Error((body && body.message) || '清空失败');
                this.notify(`已清空回收站，永久删除 ${body.deleted || 0} 篇文档`);
                this.confirmState = null;
                this.selectedIds = [];
                await this.load();
            } catch (e) {
                this.notify(e.network ? e.message : (e.message || '清空失败'), true);
            } finally {
                this.busy = false;
            }
        }
    }
};
</script>

<style scoped>
.trash-page {
    padding: 8px 0 40px;
}

.trash-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 24px;
    margin-bottom: 20px;
}

.trash-title {
    margin: 0 0 6px;
    font-size: var(--font-size-xl);
    color: var(--text-primary);
}

.trash-desc {
    margin: 0;
    max-width: 62ch;
    font-size: var(--font-size-sm);
    line-height: 1.6;
    color: var(--text-secondary);
}

.trash-desc strong {
    color: var(--danger);
    font-weight: 600;
}

.trash-head-actions {
    display: flex;
    gap: 10px;
    flex-shrink: 0;
}

.trash-bar {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 14px;
    margin-bottom: 12px;
    border: 1px solid var(--panel-border);
    border-radius: var(--radius-md);
    background: var(--panel-background);
}

.trash-count {
    margin-right: auto;
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
}

.trash-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.trash-item {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: 14px 16px;
    border: 1px solid var(--panel-border);
    border-radius: var(--radius-md);
    background: var(--panel-background);
    transition: background var(--duration-fast) var(--ease-out);
}

.trash-item:hover {
    background: var(--panel-background-hover);
}

.trash-check {
    padding-top: 2px;
    flex-shrink: 0;
}

.trash-body {
    flex: 1;
    min-width: 0;
}

.trash-item-head {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
}

.trash-item-title {
    font-size: var(--font-size-md);
    font-weight: 600;
    color: var(--text-primary);
}

.trash-tag {
    padding: 1px 7px;
    border-radius: var(--radius-sm);
    background: var(--accent-soft);
    border: 1px solid var(--accent-border);
    font-size: var(--font-size-xs);
    color: var(--accent);
}

.trash-tag-plain {
    background: var(--hover-background);
    border-color: var(--panel-border);
    color: var(--text-secondary);
}

.trash-snippet {
    margin: 6px 0 0;
    font-size: var(--font-size-sm);
    line-height: 1.55;
    color: var(--text-tertiary);
    overflow: hidden;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
}

.trash-meta {
    margin: 6px 0 0;
    font-size: var(--font-size-xs);
    color: var(--text-tertiary);
}

.trash-item-actions {
    display: flex;
    gap: 8px;
    flex-shrink: 0;
}

.trash-message {
    margin: 14px 0 0;
    padding: 10px 14px;
    border-radius: var(--radius-md);
    background: var(--success-soft);
    border: 1px solid var(--panel-border);
    font-size: var(--font-size-sm);
    color: var(--text-primary);
}

.trash-message.is-error {
    background: var(--danger-soft);
}

.state-loading,
.state-error,
.empty-state {
    padding: 48px 0;
    text-align: center;
    color: var(--text-secondary);
}

.empty-title {
    margin: 0 0 6px;
    font-size: var(--font-size-md);
    color: var(--text-primary);
}

.empty-desc {
    margin: 0 0 14px;
    font-size: var(--font-size-sm);
    color: var(--text-tertiary);
}
</style>
