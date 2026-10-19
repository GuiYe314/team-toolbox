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

                <div
                    v-for="c in categories"
                    :key="c.id"
                    class="cat-row"
                    :class="{ active: selectedCategory === c.id }"
                >
                    <button
                        class="cat-item"
                        :class="{ active: selectedCategory === c.id }"
                        @click="selectCategory(c.id)"
                    >
                        <span class="cat-emoji">📁</span>
                        <input
                            v-if="editingCatId === c.id"
                            ref="catInput"
                            class="cat-rename-input"
                            v-model="editingCatName"
                            @keyup.enter="saveRename(c)"
                            @keyup.esc="cancelRename"
                            @click.stop
                        />
                        <span v-else class="cat-name">{{ c.name }}</span>
                        <span class="cat-count" v-if="selectedCategory === c.id">{{ total }}</span>
                    </button>
                    <div class="cat-actions" v-if="editingCatId !== c.id">
                        <button class="cat-act" title="重命名" @click.stop="startRename(c)">改名</button>
                        <button class="cat-act cat-act-danger" title="删除" @click.stop="confirmDeleteCategory(c)">删除</button>
                    </div>
                </div>

                <p v-if="!categories.length && !catLoading" class="cat-empty">暂无分类，点击下方新建</p>

                <!-- 新建分类 -->
                <div class="cat-new" v-if="addCatMode">
                    <input
                        ref="newCatInput"
                        class="cat-rename-input"
                        v-model="newCatName"
                        placeholder="分类名称（1–30 字）"
                        @keyup.enter="saveNewCategory"
                        @keyup.esc="addCatMode = false"
                    />
                </div>
                <button class="cat-add-btn" v-else @click="startAddCategory">＋ 新建分类</button>
            </aside>

            <!-- 右侧文档列表（Notion 列表视图） -->
            <section class="kb-list-wrap">
                <!-- 标签筛选（F-KB-005：按标签 AND 过滤） -->
                <div class="kb-tag-filter" v-if="tags.length">
                    <span class="filter-label">标签</span>
                    <button
                        v-for="t in tags"
                        :key="t.id"
                        class="tag-chip"
                        :class="{ selected: selectedTags.includes(t.name) }"
                        @click="toggleTag(t.name)"
                    >#{{ t.name }}</button>
                    <button class="clear-filter" v-if="selectedTags.length" @click="clearTagFilter">清除筛选</button>
                </div>

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
                pages: [],
                tags: [],
                selectedTags: [],
                editingCatId: null,
                editingCatName: '',
                addCatMode: false,
                newCatName: ''
            };
        },
        async mounted() {
            this._onExternalChange = () => {
                this.loadPageMap();
                this.load();
            };
            window.addEventListener('kb-changed', this._onExternalChange);
            await this.loadCategories();
            await this.loadTags();
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
        async loadTags() {
            try {
                const { res, body } = await api.listTags();
                if (res.ok) this.tags = body || [];
            } catch {
                // 标签加载失败不影响文档列表
            }
        },
        async load() {
            this.loading = true;
            this.error = '';
            try {
                const params = new URLSearchParams();
                params.set('limit', '200');
                if (this.selectedCategory !== null) {
                    params.set('category_id', String(this.selectedCategory));
                }
                if (this.selectedTags.length) {
                    params.set('tags', this.selectedTags.join(','));
                }
                const { res, body } = await api.listDocuments('?' + params.toString());
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
        // ── 标签筛选（F-KB-005）──
        toggleTag(name) {
            const i = this.selectedTags.indexOf(name);
            if (i >= 0) this.selectedTags.splice(i, 1);
            else this.selectedTags.push(name);
            this.load();
        },
        clearTagFilter() {
            this.selectedTags = [];
            this.load();
        },
        // ── 分类管理（F-KB-004）──
        startAddCategory() {
            this.addCatMode = true;
            this.$nextTick(() => {
                if (this.$refs.newCatInput) this.$refs.newCatInput.focus();
            });
        },
        async saveNewCategory() {
            const name = this.newCatName.trim();
            if (!name) { this.addCatMode = false; return; }
            try {
                const { res, body } = await api.createCategory(name);
                if (!res.ok) throw new Error(body?.message || '新建分类失败');
                this.newCatName = '';
                this.addCatMode = false;
                await this.loadCategories();
                window.dispatchEvent(new Event('kb-changed'));
                this.load();
            } catch (e) {
                this.error = e.network ? e.message : (e.message || '新建分类失败');
            }
        },
        startRename(c) {
            this.editingCatId = c.id;
            this.editingCatName = c.name;
            this.$nextTick(() => {
                if (this.$refs.catInput) this.$refs.catInput.focus();
            });
        },
        cancelRename() {
            this.editingCatId = null;
            this.editingCatName = '';
        },
        async saveRename(c) {
            const name = this.editingCatName.trim();
            if (!name || name === c.name) { this.cancelRename(); return; }
            try {
                const { res, body } = await api.updateCategory(c.id, name);
                if (!res.ok) throw new Error(body?.message || '重命名失败');
                this.cancelRename();
                await this.loadCategories();
                window.dispatchEvent(new Event('kb-changed'));
                this.load();
            } catch (e) {
                this.error = e.network ? e.message : (e.message || '重命名失败');
                this.cancelRename();
            }
        },
        async confirmDeleteCategory(c) {
            try {
                const { res, body } = await api.listDocuments(
                    '?category_id=' + encodeURIComponent(c.id) + '&limit=1'
                );
                const count = (res.ok && body && typeof body.total === 'number') ? body.total : 0;
                const msg = count > 0
                    ? `分类「${c.name}」下有 ${count} 篇文档，删除后这些文档将变为「未分类」。确定删除？`
                    : `确定删除分类「${c.name}」？`;
                if (!window.confirm(msg)) return;
                const del = await api.deleteCategory(c.id);
                if (!del.res.ok) throw new Error((del.body && del.body.message) || '删除失败');
                await this.loadCategories();
                if (this.selectedCategory === c.id) this.selectedCategory = null;
                window.dispatchEvent(new Event('kb-changed'));
                this.load();
            } catch (e) {
                this.error = e.network ? e.message : (e.message || '删除失败');
            }
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

.cat-row {
    display: flex;
    align-items: center;
    gap: 2px;
    border-radius: 6px;
}
.cat-row:hover {
    background: var(--color-sidebar-hover);
}
.cat-row.active {
    background: var(--color-sidebar-active);
}
.cat-row .cat-item {
    flex: 1;
    min-width: 0;
}
.cat-actions {
    display: flex;
    gap: 2px;
    opacity: 0;
    transition: opacity 0.12s;
}
.cat-row:hover .cat-actions,
.cat-row:focus-within .cat-actions {
    opacity: 1;
}
.cat-act {
    border: none;
    background: none;
    color: var(--color-text-muted);
    font-size: 12px;
    padding: 3px 6px;
    border-radius: 5px;
    cursor: pointer;
    white-space: nowrap;
}
.cat-act:hover {
    background: var(--color-sidebar-active);
    color: var(--color-text);
}
.cat-act-danger:hover {
    background: #fdecec;
    color: var(--color-danger);
}
.cat-rename-input {
    flex: 1;
    min-width: 0;
    border: 1px solid var(--color-focus);
    border-radius: 5px;
    padding: 3px 6px;
    font-size: 14px;
    background: var(--color-surface);
    color: var(--color-text);
}
.cat-rename-input:focus-visible {
    outline: 2px solid var(--color-focus);
    outline-offset: 1px;
}
.cat-add-btn {
    margin-top: 4px;
    border: none;
    background: none;
    color: var(--color-text-muted);
    font-size: 13px;
    padding: 6px 8px;
    border-radius: 6px;
    cursor: pointer;
    text-align: left;
}
.cat-add-btn:hover {
    background: var(--color-sidebar-hover);
    color: var(--color-text);
}
.cat-new {
    margin-top: 2px;
}

/* 标签筛选 */
.kb-tag-filter {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    padding: 0 4px 12px;
    border-bottom: 1px solid var(--color-border);
    margin-bottom: 8px;
}
.filter-label {
    font-size: 12px;
    color: var(--color-text-faint);
}
.tag-chip {
    font-size: 12px;
    padding: 2px 9px;
    border-radius: 12px;
    border: 1px solid var(--color-border);
    background: var(--color-surface);
    color: var(--color-text-muted);
    cursor: pointer;
    transition: background 0.12s, color 0.12s, border-color 0.12s;
}
.tag-chip:hover {
    border-color: var(--color-border-strong);
}
.tag-chip.selected {
    background: var(--color-focus);
    border-color: var(--color-focus);
    color: #fff;
}
.clear-filter {
    font-size: 12px;
    border: none;
    background: none;
    color: var(--color-focus);
    cursor: pointer;
    padding: 2px 6px;
}
.clear-filter:hover {
    text-decoration: underline;
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
    .cat-actions {
        opacity: 1;
    }
}
</style>
