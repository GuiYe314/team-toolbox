<template>
    <div class="doc-page">
        <div class="doc-container">
            <div class="doc-topbar">
                <!-- 面包屑：知识库 / 祖先页面 / 当前页（Notion 顶部路径） -->
                <div class="breadcrumb">
                    <button class="crumb-link" type="button" @click="goList">知识库</button>
                    <template v-for="p in (doc && doc.path) || []" :key="p.id">
                        <span class="crumb-sep">/</span>
                        <button class="crumb-link" type="button" @click="goDetail(p.id)">{{ p.title }}</button>
                    </template>
                    <template v-if="doc">
                        <span class="crumb-sep">/</span>
                        <span class="crumb-current">{{ doc.title }}</span>
                    </template>
                </div>
                <div class="topbar-actions" v-if="doc">
                    <button class="nt-ghost" type="button" @click="goEdit">编辑</button>
                    <button class="nt-ghost nt-ghost-danger" type="button" @click="askDelete">删除</button>
                </div>
            </div>

            <p v-if="loadError" class="nt-state nt-state-error">{{ loadError }}</p>

            <div v-else-if="doc" class="doc-reader">
                <h1 class="doc-title">{{ doc.title }}</h1>
                <div class="doc-meta">
                    <span v-if="doc.category_name" class="nt-pill">{{ doc.category_name }}</span>
                    <span v-for="t in (doc.tags || [])" :key="t" class="nt-pill nt-pill-tag">#{{ t }}</span>
                    <span class="doc-time">更新于 {{ formatTime(doc.updated_at) }}</span>
                    <span class="doc-version">v{{ doc.version }}</span>
                </div>

                <!-- 渲染 HTML 由后端 sanitize-html 白名单净化，可安全渲染 -->
                <article class="markdown-body" v-html="renderedHtml"></article>

                <!-- 子页面（Notion 页面下方的子页面链接列表） -->
                <div class="child-pages">
                    <router-link
                        v-for="c in children"
                        :key="c.id"
                        :to="{ name: 'kb-detail', params: { id: c.id } }"
                        class="child-page"
                    >
                        <DocIcon class="child-icon" :size="15" />
                        <span class="child-title">{{ c.title }}</span>
                    </router-link>
                    <button class="child-page child-new" type="button" @click="createChild">
                        <span class="child-icon child-plus" aria-hidden="true">＋</span>
                        <span class="child-title">新建子页面</span>
                    </button>
                </div>
            </div>

            <p v-else-if="loading" class="nt-state">加载中…</p>
        </div>

        <!-- 删除二次确认 -->
        <div v-if="showDelete" class="modal-mask" @click.self="closeDelete">
            <div class="modal" role="dialog" aria-modal="true" aria-label="删除确认">
                <h2 class="modal-title">确认删除</h2>
                <p class="modal-text">
                    确定要删除文档「<strong>{{ doc && doc.title }}</strong>」吗？此操作不可撤销。
                </p>
                <p v-if="doc && doc.descendant_count > 0" class="modal-warn">
                    其下 {{ doc.descendant_count }} 个子页面也会一并删除。
                </p>
                <p v-if="deleteError" class="nt-state nt-state-error">{{ deleteError }}</p>
                <div class="modal-actions">
                    <button class="nt-btn" type="button" :disabled="deleting" @click="closeDelete">取消</button>
                    <button class="nt-btn nt-btn-danger" type="button" :disabled="deleting" @click="doDelete">
                        {{ deleting ? '删除中…' : '确认删除' }}
                    </button>
                </div>
            </div>
        </div>
    </div>
</template>

<script>
import { api } from '../api/client.js';
import DocIcon from '../components/DocIcon.vue';

export default {
    name: 'DocumentDetail',
    components: { DocIcon },
    data() {
        return {
            doc: null,
            children: [],
            renderedHtml: '',
            loading: true,
            loadError: '',
            showDelete: false,
            deleting: false,
            deleteError: ''
        };
    },
    computed: {
        docId() {
            const id = Number(this.$route.params.id);
            return Number.isInteger(id) ? id : null;
        }
    },
    async mounted() {
        // 侧边栏重命名/删除后同步刷新当前页
        this._onExternalChange = () => this.load(true);
        window.addEventListener('kb-changed', this._onExternalChange);
        await this.load();
    },
    beforeUnmount() {
        window.removeEventListener('kb-changed', this._onExternalChange);
    },
    methods: {
        async load(silent = false) {
            if (!silent) this.loading = true;
            this.loadError = '';
            try {
                const { res, body } = await api.getDocument(this.docId);
                if (res.status === 404) {
                    this.loadError = '文档不存在或已被删除';
                    this.doc = null;
                    return;
                }
                if (!res.ok) throw new Error(body?.message || '加载失败');
                this.doc = body;
                const [rendered, childRes] = await Promise.all([
                    api.renderMarkdown(body.content_md || ''),
                    api.listChildren(this.docId)
                ]);
                this.renderedHtml = rendered.res.ok ? (rendered.body && rendered.body.html || '') : '';
                this.children = (childRes.res.ok && childRes.body && childRes.body.items) || [];
            } catch (e) {
                this.loadError = e.network ? e.message : (e.message || '加载失败');
            } finally {
                this.loading = false;
            }
        },
        goList() {
            this.$router.push({ name: 'kb-list' });
        },
        goDetail(id) {
            this.$router.push({ name: 'kb-detail', params: { id } }).catch(() => {});
        },
        goEdit() {
            this.$router.push({ name: 'kb-edit', params: { id: this.docId } });
        },
        createChild() {
            this.$router.push({ name: 'kb-new', query: { parent: String(this.docId) } });
        },
        askDelete() {
            this.showDelete = true;
            this.deleteError = '';
        },
        closeDelete() {
            if (this.deleting) return;
            this.showDelete = false;
        },
        async doDelete() {
            this.deleting = true;
            this.deleteError = '';
            try {
                const { res, body } = await api.deleteDocument(this.docId);
                if (!res.ok && res.status !== 204) {
                    throw new Error((body && body.message) || '删除失败');
                }
                this.showDelete = false;
                window.dispatchEvent(new Event('kb-changed'));
                this.$router.push({ name: 'kb-list' });
            } catch (e) {
                this.deleteError = e.network ? e.message : (e.message || '删除失败，请稍后重试');
            } finally {
                this.deleting = false;
            }
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
.doc-page {
    min-height: 100vh;
}
.doc-container {
    max-width: 760px;
    margin: 0 auto;
    padding: 20px 48px 96px;
}

/* 顶栏 + 面包屑 */
.doc-topbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 20px;
    min-height: 30px;
}
.breadcrumb {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 4px;
    min-width: 0;
    font-size: 13px;
    color: var(--color-text-muted);
}
.crumb-link {
    border: none;
    background: none;
    padding: 2px 4px;
    border-radius: 4px;
    color: var(--color-text-muted);
    font-size: 13px;
    cursor: pointer;
    max-width: 200px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.crumb-link:hover {
    background: var(--color-sidebar-hover);
    color: var(--color-text);
}
.crumb-sep {
    color: var(--color-text-faint);
}
.crumb-current {
    padding: 2px 4px;
    color: var(--color-text);
    max-width: 240px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.topbar-actions {
    display: flex;
    gap: 2px;
    flex-shrink: 0;
}
.doc-reader {
    margin-top: 8px;
}
.doc-title {
    font-size: 40px;
    font-weight: 700;
    margin: 0 0 14px;
    letter-spacing: -0.01em;
    line-height: 1.25;
}
.doc-meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    padding-bottom: 18px;
    margin-bottom: 8px;
    border-bottom: 1px solid var(--color-border);
}
.doc-time,
.doc-version {
    font-size: 13px;
    color: var(--color-text-faint);
}
.doc-version {
    margin-left: auto;
}
.nt-pill {
    font-size: 12px;
    padding: 2px 9px;
    border-radius: 4px;
    background: var(--color-sidebar-bg);
    color: var(--color-text-muted);
    border: 1px solid var(--color-border);
}

/* 子页面列表（Notion：正文之后的页面链接） */
.child-pages {
    display: flex;
    flex-direction: column;
    gap: 1px;
    margin-top: 28px;
    padding-top: 8px;
}
.child-page {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 5px 6px;
    border: none;
    background: none;
    border-radius: 6px;
    color: var(--color-text);
    font-size: 15px;
    text-align: left;
    cursor: pointer;
    transition: background 0.1s;
}
.child-page:hover {
    background: var(--color-sidebar-hover);
}
.child-page:hover .child-title {
    text-decoration-color: currentColor;
}
.child-page:focus-visible {
    outline: 2px solid var(--color-focus);
    outline-offset: -2px;
}
.child-icon {
    width: 18px;
    font-size: 15px;
    text-align: center;
    flex-shrink: 0;
    color: var(--color-text-faint);
}
.child-plus {
    color: var(--color-text-faint);
    line-height: 1;
}
.child-title {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-decoration: underline;
    text-underline-offset: 3px;
    text-decoration-color: #d9d8d5;
}
.child-new {
    color: var(--color-text-faint);
    font-size: 14px;
}
.child-new:hover {
    color: var(--color-text-muted);
}
.child-new:hover .child-title {
    text-decoration: none;
}

/* 状态/按钮 */
.nt-state {
    padding: 16px;
    font-size: 14px;
    color: var(--color-text-muted);
}
.nt-state-error {
    color: var(--color-danger);
}
.nt-ghost {
    border: none;
    background: none;
    color: var(--color-text-muted);
    font-size: 14px;
    padding: 6px 10px;
    border-radius: 6px;
    cursor: pointer;
    transition: background 0.12s, color 0.12s;
}
.nt-ghost:hover {
    background: var(--color-sidebar-hover);
    color: var(--color-text);
}
.nt-ghost:focus-visible {
    outline: 2px solid var(--color-focus);
    outline-offset: 2px;
}
.nt-ghost-danger:hover {
    background: #fdecec;
    color: var(--color-danger);
}
.nt-btn {
    padding: 7px 14px;
    border-radius: 6px;
    font-size: 14px;
    cursor: pointer;
    border: 1px solid var(--color-border-strong);
    background: var(--color-surface);
    color: var(--color-text);
    transition: background 0.12s;
}
.nt-btn:hover {
    background: var(--color-sidebar-bg);
}
.nt-btn:focus-visible {
    outline: 2px solid var(--color-focus);
    outline-offset: 2px;
}
.nt-btn-danger {
    background: var(--color-danger);
    color: #fff;
    border-color: var(--color-danger);
}
.nt-btn-danger:hover {
    background: #d64545;
}

/* 删除弹窗 */
.modal-mask {
    position: fixed;
    inset: 0;
    background: rgba(15, 15, 15, 0.4);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 200;
}
.modal {
    background: var(--color-surface);
    border-radius: 10px;
    padding: 24px;
    width: min(420px, 90vw);
    box-shadow: 0 14px 44px rgba(15, 15, 15, 0.2);
}
.modal-title {
    font-size: 18px;
    margin: 0 0 12px;
}
.modal-text {
    font-size: 14px;
    color: var(--color-text);
    margin: 0 0 8px;
    line-height: 1.6;
}
.modal-warn {
    font-size: 13px;
    color: #b54708;
    background: #fdf3e7;
    border: 1px solid #f3dcc0;
    border-radius: 6px;
    padding: 8px 10px;
    margin: 0 0 12px;
    line-height: 1.6;
}
.modal-actions {
    display: flex;
    justify-content: flex-end;
    gap: 12px;
}

@media (max-width: 768px) {
    .doc-container {
        padding: 20px 18px 64px;
    }
    .doc-title {
        font-size: 30px;
    }
    .doc-topbar {
        flex-wrap: wrap;
    }
}
</style>
