<template>
    <div class="view-page page-home">
        <header class="view-head home-head">
            <h1 class="view-title">首页</h1>
            <button id="edit-home-layout" class="btn" type="button" @click="openEditor">编辑首页</button>
        </header>

        <div v-if="!shortcuts.length && !layout.showRecent" class="empty-state">
            <p>首页还没有内容</p>
            <p class="empty-hint">点击“编辑首页”，添加想显示的功能、工具或文档。</p>
        </div>

        <section v-if="shortcuts.length" class="section">
            <h2 class="section-title">快捷入口</h2>
            <div class="tools-grid">
                <article v-for="item in shortcuts" :key="item.id" class="tool-card" :data-home-shortcut="item.id">
                    <ToolIcon :tool-id="item.toolId" />
                    <h3 class="tool-name">{{ item.name }}</h3>
                    <p class="tool-desc">{{ item.desc }}</p>
                    <button class="btn btn-sm" type="button" :disabled="item.unavailable"
                        @click="$router.push({ name: item.routeName, params: item.params })">
                        {{ item.unavailable ? '无法打开' : '打开' }}
                    </button>
                </article>
            </div>
        </section>

        <section v-if="layout.showRecent" class="section">
            <h2 class="section-title">最近更新</h2>

            <p v-if="loading && recent.length === 0" class="state-loading">加载中…</p>

            <div v-else-if="error && recent.length === 0" class="state-error">
                <p>加载失败：{{ error }}</p>
                <button class="retry-btn" @click="retry">重试</button>
            </div>

            <div v-else-if="recent.length === 0" class="empty-state">
                <svg class="icon icon-lg empty-icon" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M4 4.5h6.5a2 2 0 0 1 2 2V20a1.6 1.6 0 0 0-1.6-1.5H4z" />
                    <path d="M20 4.5h-6.5a2 2 0 0 0-2 2V20a1.6 1.6 0 0 1 1.6-1.5H20z" />
                </svg>
                <p>知识库还没有文档</p>
                <p class="empty-hint">点击下方按钮创建第一篇文档，开始沉淀团队知识。</p>
                <button class="btn btn-primary" @click="goNew">新建文档</button>
            </div>

            <template v-else>
                <p v-if="error" class="state-error-inline">
                    加载失败：{{ error }}
                    <button class="retry-link" @click="retry">重试</button>
                </p>
                <ul class="recent-list">
                    <li
                        v-for="doc in recent"
                        :key="doc.id"
                        class="recent-item"
                        @click="goDoc(doc.id)"
                    >
                        <div class="recent-head">
                            <span class="recent-title">{{ doc.title }}</span>
                            <span class="recent-time">{{ formatTime(doc.updated_at) }}</span>
                        </div>
                        <p v-if="doc.snippet" class="recent-snippet">{{ doc.snippet }}</p>
                        <p v-else class="recent-snippet recent-snippet-empty">暂无内容</p>
                        <div v-if="doc.category_name || (doc.tags || []).length" class="recent-sub">
                            <span v-if="doc.category_name" class="doc-pill">{{ doc.category_name }}</span>
                            <span
                                v-for="t in (doc.tags || [])"
                                :key="t"
                                class="doc-pill doc-pill-tag"
                            >#{{ t }}</span>
                        </div>
                    </li>
                </ul>
                <button
                    v-if="hasMore"
                    class="btn more-btn"
                    :disabled="loading"
                    @click="loadMore"
                >{{ loading ? '加载中…' : '查看更多' }}</button>
            </template>
        </section>

        <HomeLayoutEditor
            v-if="editing"
            :layout="layout"
            :documents="documents"
            :documents-loading="documentsLoading"
            :documents-error="documentsError"
            :save-error="saveError"
            @close="editing = false"
            @save="saveLayout"
            @load-documents="loadDocuments"
        />
    </div>
</template>

<script>
import { api } from '../api/client.js';
import HomeLayoutEditor from '../components/HomeLayoutEditor.vue';
import ToolIcon from '../components/ToolIcon.vue';
import { HOME_LAYOUT_KEY, normalizeHomeLayout, readHomeLayout, resolveHomeShortcut, saveHomeLayout } from '../utils/home-layout.js';

const RECENT_LIMIT = 20;

export default {
    name: 'Home',
    components: { HomeLayoutEditor, ToolIcon },
    data() {
        return {
            layout: readHomeLayout(),
            editing: false,
            saveError: '',
            documents: new Map(),
            documentsLoaded: false,
            documentsLoading: false,
            documentsError: '',
            documentsRequest: 0,
            recent: [],
            recentTotal: 0,
            loading: false,
            error: '',
            recentRequest: 0,
            failedRecentOffset: 0
        };
    },
    computed: {
        hasPinnedDocuments() {
            return this.layout.shortcuts.some(key => key.startsWith('doc:'));
        },
        shortcuts() {
            return this.layout.shortcuts.map(key => {
                const item = resolveHomeShortcut(key, this.documents);
                if (item.routeName !== 'kb-detail' || !this.documentsLoaded || this.documents.has(item.params.id)) {
                    return item;
                }
                return { ...item, desc: '文档已移除或不可用', unavailable: true };
            });
        },
        hasMore() {
            return this.recent.length < this.recentTotal;
        }
    },
    watch: {
        hasPinnedDocuments(pinned) {
            if (pinned) this.loadDocuments();
        },
        'layout.showRecent'(show) {
            if (show) this.loadRecent();
            else this.clearRecent();
        }
    },
    mounted() {
        window.addEventListener('storage', this.syncLayout);
        window.addEventListener('kb-changed', this.refreshDocuments);
        if (this.hasPinnedDocuments) this.loadDocuments();
        if (this.layout.showRecent) this.loadRecent();
    },
    beforeUnmount() {
        window.removeEventListener('storage', this.syncLayout);
        window.removeEventListener('kb-changed', this.refreshDocuments);
        this.documentsRequest++;
        this.recentRequest++;
    },
    methods: {
        openEditor() {
            this.saveError = '';
            this.editing = true;
        },
        saveLayout(draft) {
            const layout = normalizeHomeLayout(draft);
            if (!saveHomeLayout(layout)) {
                this.saveError = '无法保存首页，请检查浏览器存储设置后重试。';
                return;
            }
            this.layout = layout;
            this.editing = false;
        },
        syncLayout(event) {
            if (event.key === HOME_LAYOUT_KEY || event.key === null) this.layout = readHomeLayout();
        },
        refreshDocuments() {
            this.documentsRequest++;
            this.documentsLoaded = false;
            this.documentsLoading = false;
            if (this.hasPinnedDocuments || this.editing) this.loadDocuments();
            if (this.layout.showRecent) this.loadRecent();
        },
        async loadDocuments() {
            if (this.documentsLoading || this.documentsLoaded) return;
            const request = ++this.documentsRequest;
            this.documentsLoading = true;
            this.documentsError = '';
            try {
                const { res, body } = await api.listDocumentTree();
                if (request !== this.documentsRequest) return;
                if (!res.ok || !Array.isArray(body?.items)) {
                    throw new Error(body?.message || '知识库文档加载失败');
                }
                this.documents = new Map(body.items.map(doc => [doc.id, doc]));
                this.documentsLoaded = true;
            } catch (error) {
                if (request === this.documentsRequest) this.documentsError = error.message;
            } finally {
                if (request === this.documentsRequest) this.documentsLoading = false;
            }
        },
        clearRecent() {
            this.recentRequest++;
            this.recent = [];
            this.recentTotal = 0;
            this.loading = false;
            this.error = '';
        },
        async loadRecent(offset = 0) {
            const request = ++this.recentRequest;
            this.loading = true;
            this.error = '';
            try {
                const { res, body } = await api.listDocuments(`?limit=${RECENT_LIMIT}&offset=${offset}`);
                if (request !== this.recentRequest) return;
                if (!res.ok || !Array.isArray(body?.items)) {
                    throw new Error(body?.message || '最近更新加载失败');
                }
                this.recent = offset ? this.recent.concat(body.items) : body.items;
                this.recentTotal = body.total;
            } catch (error) {
                if (request !== this.recentRequest) return;
                this.error = error.message;
                this.failedRecentOffset = offset;
            } finally {
                if (request === this.recentRequest) this.loading = false;
            }
        },
        loadMore() {
            if (!this.loading && this.hasMore) this.loadRecent(this.recent.length);
        },
        retry() {
            if (!this.loading) this.loadRecent(this.failedRecentOffset);
        },
        goDoc(id) {
            this.$router.push({ name: 'kb-detail', params: { id } });
        },
        goNew() {
            this.$router.push({ name: 'kb-new' });
        },
        formatTime(iso) {
            if (!iso) return '';
            const d = new Date(iso);
            if (Number.isNaN(d.getTime())) return iso;
            return d.toLocaleString('zh-CN', {
                year: 'numeric', month: '2-digit', day: '2-digit',
                hour: '2-digit', minute: '2-digit'
            });
        }
    }
};
</script>

<style scoped>
/* 根容器统一用全局 .view-page（自带纵向滚动 + token 内边距），
   这里只做栅格与卡片外观，不再重复写 max-width / padding。*/

.home-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--ext-gap-md);
}

.section {
    flex: none;
    margin-bottom: 26px;
}
.section:last-child { margin-bottom: 0; }
.section-title {
    margin: 0 0 12px;
    font-size: var(--text-section-title);
    font-weight: var(--weight-semibold);
    color: var(--text-primary);
}

/* ── 状态 ────────────────────────────────────────────────────────── */
.state-loading,
.state-error {
    padding: 22px;
    border-radius: var(--radius-md);
    background: var(--panel-background);
    border: 1px solid var(--panel-border);
    font-size: var(--text-body);
    color: var(--text-secondary);
}
.state-error { border-color: var(--danger); color: var(--danger); }
.state-error p { margin: 0 0 10px; }
.state-error-inline {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 0 0 10px;
    padding: 8px 12px;
    border-radius: var(--radius-sm);
    background: var(--danger-soft);
    color: var(--danger);
    font-size: var(--text-secondary);
}
.retry-btn,
.retry-link {
    border: none;
    background: none;
    color: var(--accent);
    font-size: inherit;
    cursor: pointer;
    padding: 0;
    text-decoration: underline;
}
.retry-link { font-size: var(--text-secondary); }

/* ── 空状态 ──────────────────────────────────────────────────────── */
.empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 44px 24px;
    text-align: center;
    border-radius: var(--radius-lg);
    background: var(--panel-background);
    border: 1px solid var(--panel-border);
    color: var(--text-secondary);
    font-size: var(--text-body);
}
.empty-state p { margin: 0; }
.empty-icon { color: var(--text-tertiary); opacity: 0.7; margin-bottom: 4px; }
.empty-hint {
    font-size: var(--text-secondary);
    color: var(--text-tertiary);
    margin-bottom: 8px !important;
}

/* ── 最近更新：与知识库同一套卡片语言 ──────────────────────────── */
/* 文档标题普遍很短，单行列表会浪费横向空间；改为自适应卡片网格，
   一屏能看到的内容量约为原来 3~4 倍。 */
.recent-list {
    display: grid;
    /* auto-fit：折叠空轨道并拉伸现有列，避免 3 张卡片在 2 列容器里
       第 3 张单独占一行、右侧留大片空白 */
    grid-template-columns: repeat(auto-fit, minmax(min(300px, 100%), 1fr));
    gap: 10px;
}
.recent-item {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
    padding: 12px 14px;
    border-radius: var(--radius-md);
    border: 1px solid var(--panel-border);
    background: var(--panel-background);
    cursor: pointer;
    transition: background var(--dur-base) var(--ease-out),
                border-color var(--dur-base) var(--ease-out);
}
.recent-item:hover {
    background: var(--panel-background-hover);
    border-color: var(--accent-border);
}
/* 标题行：标题吃掉剩余宽度，时间固定在右上角 */
.recent-head {
    display: flex;
    align-items: baseline;
    gap: 10px;
    min-width: 0;
}
.recent-title {
    flex: 1;
    min-width: 0;
    font-size: var(--text-doc-title);
    font-weight: var(--weight-semibold);
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.recent-time {
    flex: none;
    font-size: var(--text-tag);
    color: var(--text-tertiary);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
}
/* 摘要固定 2 行：卡片高度一致，整排底部才齐。
   flex:1 让它吃掉多余高度，无摘要时也保留同样空间。 */
.recent-snippet {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    flex: 1;
    margin: 0;
    font-size: var(--text-secondary);
    color: var(--text-tertiary);
    line-height: var(--line-relaxed);
    overflow: hidden;
}
.recent-snippet-empty { font-style: italic; opacity: 0.7; }
.recent-sub {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: auto;
}
.recent-sub:empty { display: none; }
.doc-pill {
    display: inline-flex;
    align-items: center;
    height: 20px;
    padding: 0 8px;
    border-radius: var(--radius-pill);
    background: var(--panel-background-hover);
    border: 1px solid var(--panel-border);
    color: var(--text-secondary);
    font-size: var(--text-tag);
    font-weight: var(--weight-medium);
    white-space: nowrap;
}
.doc-pill-tag { color: var(--accent); background: var(--accent-soft); border-color: var(--accent-border); }

/* ── 工具卡片网格：自适应列，窄屏自动降列 ──────────────────────── */
.tools-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(228px, 100%), 1fr));
    gap: 12px;
}
.tool-card {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 16px;
    border-radius: var(--radius-lg);
    background: var(--surface-material);
    border: 1px solid var(--panel-border);
    box-shadow: var(--surface-shadow);
    transition: background var(--dur-base) var(--ease-out),
                border-color var(--dur-base) var(--ease-out),
                transform var(--dur-base) var(--ease-out);
}
.tool-card:hover {
    background: var(--surface-material-hover);
    border-color: var(--accent-border);
    transform: translateY(var(--surface-hover-offset));
}
.tool-name {
    overflow-wrap: anywhere;
    margin: 2px 0 0;
    font-size: var(--text-doc-title);
    font-weight: var(--weight-semibold);
    color: var(--text-primary);
}
.tool-desc {
    margin: 0;
    flex: 1;
    font-size: var(--text-secondary);
    line-height: var(--line-relaxed);
    color: var(--text-tertiary);
}
.tool-card .btn { align-self: flex-start; }

.more-btn {
    align-self: center;
    margin-top: 14px;
}

/* 卡片网格靠 auto-fill 自动降列，无需额外断点 */
</style>
