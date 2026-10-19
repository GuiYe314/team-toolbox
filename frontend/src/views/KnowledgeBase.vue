<template>
    <div class="kb-page">
        <header class="kb-head">
            <div class="kb-title-row">
                <span class="kb-emoji">📚</span>
                <h1 class="kb-title">知识库</h1>
                <button class="nt-btn nt-btn-primary" @click="goNew">新建</button>
            </div>
            <p class="kb-desc">团队 Markdown 知识沉淀</p>
        </header>

        <div class="kb-body">
            <!-- 左侧目录（Notion 式页面树） -->
            <aside class="kb-catalog">
                <button
                    class="cat-item"
                    :class="{ active: selectedCategory === null }"
                    @click="selectCategory(null)"
                >
                    <span class="cat-emoji">📄</span>
                    <span class="cat-name">全部文档</span>
                    <span class="cat-count" v-if="selectedCategory === null">{{ total }}</span>
                </button>
                <template v-if="categories.length">
                    <button
                        v-for="c in categories"
                        :key="c.id"
                        class="cat-item"
                        :class="{ active: selectedCategory === c.id }"
                        @click="selectCategory(c.id)"
                    >
                        <span class="cat-emoji">📁</span>
                        <span class="cat-name">{{ c.name }}</span>
                    </button>
                </template>
                <p v-else-if="!catLoading" class="cat-empty">暂无分类（分类管理将在后续版本开放）</p>
            </aside>

            <!-- 右侧文档列表（Notion 列表视图） -->
            <section class="kb-list-wrap">
                <div class="kb-toolbar">
                    <span class="kb-count">{{ total }} 个文档</span>
                    <span class="kb-search-hint">搜索即将在 TASK-007 开放</span>
                </div>

                <p v-if="loading" class="nt-state">加载中…</p>
                <p v-else-if="error" class="nt-state nt-state-error">{{ error }}</p>
                <p v-else-if="items.length === 0" class="nt-empty">
                    <span class="nt-empty-emoji">🗒️</span>
                    这里还没有文档。点击右上角「新建」开始记录团队知识。
                </p>

                <ul v-else class="nt-doc-list">
                    <li
                        v-for="doc in items"
                        :key="doc.id"
                        class="nt-doc-row"
                        @click="goDetail(doc.id)"
                    >
                        <DocIcon class="doc-emoji" :size="16" />
                        <div class="doc-info">
                            <span class="doc-title">{{ doc.title }}</span>
                            <span class="doc-sub">
                                <span v-if="doc.parent_id" class="doc-path">{{ pathLabel(doc.parent_id) }}</span>
                                <span v-if="doc.category_name" class="nt-pill">{{ doc.category_name }}</span>
                                <span v-for="t in (doc.tags || [])" :key="t" class="nt-pill nt-pill-tag">#{{ t }}</span>
                                <span class="doc-time">{{ formatTime(doc.updated_at) }}</span>
                            </span>
                        </div>
                        <div class="doc-actions">
                            <button class="nt-ghost" @click.stop="goDetail(doc.id)">打开</button>
                            <button class="nt-ghost" @click.stop="goEdit(doc.id)">编辑</button>
                        </div>
                    </li>
                </ul>
            </section>
        </div>
    </div>
</template>

<script>
import { api } from '../api/client.js';
import DocIcon from '../components/DocIcon.vue';

export default {
    name: 'KnowledgeBase',
    components: { DocIcon },
    data() {
        return {
            items: [],
            total: 0,
            loading: true,
            error: '',
            categories: [],
            catLoading: true,
            selectedCategory: null,
            pages: []
        };
    },
    async mounted() {
        this._onExternalChange = () => {
            this.loadPageMap();
            this.load();
        };
        window.addEventListener('kb-changed', this._onExternalChange);
        await this.loadCategories();
        await this.loadPageMap();
        await this.load();
    },
    beforeUnmount() {
        window.removeEventListener('kb-changed', this._onExternalChange);
    },
    methods: {
        async loadPageMap() {
            try {
                const { res, body } = await api.listDocumentTree();
                if (res.ok) this.pages = (body && body.items) || [];
            } catch {
                // 页面树加载失败只影响层级面包屑，不影响列表
            }
        },
        /** 由 parent_id 反查祖先标题，拼成「父 / 祖父」路径 */
        pathLabel(parentId) {
            const map = new Map(this.pages.map((p) => [p.id, p]));
            const names = [];
            let cur = parentId;
            let guard = 0;
            while (cur != null && map.has(cur) && guard++ < 50) {
                const node = map.get(cur);
                names.unshift(node.title);
                cur = node.parent_id;
            }
            return names.join(' / ');
        },
        async loadCategories() {
            this.catLoading = true;
            try {
                const { res, body } = await api.listCategories();
                if (res.ok) this.categories = body || [];
            } catch {
                // 分类加载失败不影响文档列表
            } finally {
                this.catLoading = false;
            }
        },
        async load() {
            this.loading = true;
            this.error = '';
            try {
                let query = '?limit=200';
                if (this.selectedCategory !== null) {
                    query += '&category_id=' + encodeURIComponent(this.selectedCategory);
                }
                const { res, body } = await api.listDocuments(query);
                if (!res.ok) throw new Error(body?.message || '加载失败');
                this.items = (body && body.items) || [];
                this.total = (body && typeof body.total === 'number') ? body.total : this.items.length;
            } catch (e) {
                this.error = e.network ? e.message : (e.message || '加载失败');
            } finally {
                this.loading = false;
            }
        },
        selectCategory(id) {
            this.selectedCategory = id;
            this.load();
        },
        goNew() {
            this.$router.push({ name: 'kb-new' });
        },
        goDetail(id) {
            this.$router.push({ name: 'kb-detail', params: { id } });
        },
        goEdit(id) {
            this.$router.push({ name: 'kb-edit', params: { id } });
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
.kb-page {
    max-width: 1080px;
    margin: 0 auto;
    padding: 52px 48px 72px;
}

/* 页头 */
.kb-head {
    margin-bottom: 28px;
}
.kb-title-row {
    display: flex;
    align-items: center;
    gap: 12px;
}
.kb-emoji {
    font-size: 34px;
    line-height: 1;
}
.kb-title {
    font-size: 38px;
    font-weight: 700;
    margin: 0;
    flex: 1;
    letter-spacing: -0.01em;
}
.kb-desc {
    color: var(--color-text-muted);
    margin: 8px 0 0 46px;
    font-size: 14px;
}

/* 主体两栏 */
.kb-body {
    display: grid;
    grid-template-columns: 200px 1fr;
    gap: 28px;
    align-items: start;
}

/* 左侧目录 */
.kb-catalog {
    position: sticky;
    top: 24px;
    display: flex;
    flex-direction: column;
    gap: 2px;
}
.cat-item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 6px 8px;
    border: none;
    background: none;
    border-radius: 6px;
    cursor: pointer;
    color: var(--color-sidebar-text);
    font-size: 14px;
    text-align: left;
    transition: background 0.12s;
}
.cat-item:hover {
    background: var(--color-sidebar-hover);
}
.cat-item.active {
    background: var(--color-sidebar-active);
    color: var(--color-text);
    font-weight: 500;
}
.cat-emoji {
    font-size: 14px;
    flex-shrink: 0;
}
.cat-name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.cat-count {
    font-size: 12px;
    color: var(--color-text-faint);
}
.cat-empty {
    font-size: 12px;
    color: var(--color-text-faint);
    padding: 6px 8px;
    margin: 4px 0 0;
}

/* 右侧列表 */
.kb-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 4px 10px;
    border-bottom: 1px solid var(--color-border);
    margin-bottom: 6px;
}
.kb-count {
    font-size: 13px;
    color: var(--color-text-muted);
    font-weight: 500;
}
.kb-search-hint {
    font-size: 12px;
    color: var(--color-text-faint);
}

.nt-doc-list {
    display: flex;
    flex-direction: column;
}
.nt-doc-row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 8px;
    border-radius: 6px;
    cursor: pointer;
    border-bottom: 1px solid var(--color-border);
    transition: background 0.12s;
}
.nt-doc-row:hover {
    background: var(--color-sidebar-bg);
}
.nt-doc-row:focus-visible {
    outline: 2px solid var(--color-focus);
    outline-offset: -2px;
}
.doc-emoji {
    flex-shrink: 0;
    margin-top: 2px;
    color: var(--color-text-faint);
}
.doc-info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 3px;
}
.doc-title {
    font-size: 15px;
    font-weight: 500;
    color: var(--color-text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.doc-sub {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
}
.doc-time {
    font-size: 12px;
    color: var(--color-text-faint);
}
.doc-path {
    font-size: 12px;
    color: var(--color-text-muted);
    max-width: 260px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.nt-pill {
    font-size: 12px;
    padding: 1px 8px;
    border-radius: 4px;
    background: var(--color-sidebar-bg);
    color: var(--color-text-muted);
    border: 1px solid var(--color-border);
}
.nt-pill-tag {
    color: var(--color-text-muted);
}
.doc-actions {
    display: flex;
    gap: 4px;
    opacity: 0;
    transition: opacity 0.12s;
}
.nt-doc-row:hover .doc-actions,
.nt-doc-row:focus-within .doc-actions {
    opacity: 1;
}
.nt-ghost {
    border: none;
    background: none;
    color: var(--color-text-muted);
    font-size: 13px;
    padding: 4px 8px;
    border-radius: 5px;
    cursor: pointer;
}
.nt-ghost:hover {
    background: var(--color-sidebar-active);
    color: var(--color-text);
}

/* 状态 */
.nt-state {
    padding: 16px;
    font-size: 14px;
    color: var(--color-text-muted);
}
.nt-state-error {
    color: var(--color-danger);
}
.nt-empty {
    text-align: center;
    padding: 56px 20px;
    color: var(--color-text-muted);
    font-size: 14px;
    line-height: 1.7;
}
.nt-empty-emoji {
    display: block;
    font-size: 40px;
    margin-bottom: 12px;
}

/* 通用按钮（Notion 风格） */
.nt-btn {
    padding: 7px 14px;
    border-radius: 6px;
    font-size: 14px;
    cursor: pointer;
    border: 1px solid var(--color-border-strong);
    background: var(--color-surface);
    color: var(--color-text);
    transition: background 0.12s, border-color 0.12s;
}
.nt-btn:hover {
    background: var(--color-sidebar-bg);
}
.nt-btn:focus-visible {
    outline: 2px solid var(--color-focus);
    outline-offset: 2px;
}
.nt-btn-primary {
    background: var(--color-focus);
    color: #fff;
    border-color: var(--color-focus);
}
.nt-btn-primary:hover {
    background: #1a6fc4;
}

@media (max-width: 768px) {
    .kb-page {
        padding: 32px 18px 48px;
    }
    .kb-title {
        font-size: 30px;
    }
    .kb-desc {
        margin-left: 0;
    }
    .kb-body {
        grid-template-columns: 1fr;
        gap: 16px;
    }
    .kb-catalog {
        position: static;
        flex-direction: row;
        flex-wrap: wrap;
    }
    .doc-actions {
        opacity: 1;
    }
}
</style>
