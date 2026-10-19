<template>
    <div class="view-page doc-page">
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
                    <MarkdownHelp />
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

                <!-- 子页面（二级页面列表：不进入左侧导航，展示在本文档下方） -->
                <div class="child-pages">
                    <h2 class="child-heading">
                        子页面
                        <span v-if="children.length" class="child-count">{{ children.length }}</span>
                    </h2>
                    <div class="child-list">
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
import MarkdownHelp from '../components/MarkdownHelp.vue';

export default {
    name: 'DocumentDetail',
    components: { DocIcon, MarkdownHelp },
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
    watch: {
        // 详情 → 详情 切换时 Vue Router 会复用本组件实例，mounted 不会再次触发；
        // 必须监听路由参数变化重新加载，否则 URL 已变而右侧内容停留在上一篇文档。
        docId(id, oldId) {
            if (id === oldId || id == null) return;
            this.doc = null;
            this.renderedHtml = '';
            this.children = [];
            this.load();
        }
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
/* 根容器走全局 .view-page（负责滚动）；.doc-container 只收窄阅读宽度。
   旧版 min-height:100vh 会让内容在玻璃面板内被裁且无法滚动。*/
.doc-container {
    width: 100%;
    max-width: 780px;
    padding: 4px 0 40px;
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
    color: var(--text-secondary);
}
.crumb-link {
    border: none;
    background: none;
    padding: 2px 4px;
    border-radius: 4px;
    color: var(--text-secondary);
    font-size: 13px;
    cursor: pointer;
    max-width: 200px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.crumb-link:hover {
    background: var(--hover-background);
    color: var(--text-primary);
}
.crumb-sep {
    color: var(--text-tertiary);
}
.crumb-current {
    padding: 2px 4px;
    color: var(--text-primary);
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
    font-size: var(--text-page-title);
    font-weight: var(--weight-bold);
    margin: 0 0 12px;
    letter-spacing: -0.015em;
    line-height: 1.25;
    color: var(--text-primary);
}
.doc-meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    padding-bottom: 18px;
    margin-bottom: 8px;
    border-bottom: 1px solid var(--panel-border);
}
.doc-time,
.doc-version {
    font-size: 13px;
    color: var(--text-tertiary);
}
.doc-version {
    margin-left: auto;
}
.nt-pill {
    font-size: 12px;
    padding: 2px 9px;
    border-radius: 4px;
    background: var(--hover-background);
    color: var(--text-secondary);
    border: 1px solid var(--panel-border);
}

/* 子页面列表（Notion：正文之后的页面链接） */
.child-pages {
    margin-top: 40px;
    padding-top: 20px;
    border-top: 1px solid var(--panel-border);
}
.child-heading {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0 0 10px;
    font-size: 15px;
    font-weight: 600;
    color: var(--text-secondary);
}
.child-count {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 18px;
    height: 18px;
    padding: 0 6px;
    border-radius: 9px;
    background: var(--selected-background);
    color: var(--text-secondary);
    font-size: 11px;
    font-weight: 500;
}
.child-list {
    display: flex;
    flex-direction: column;
    gap: 1px;
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
    color: var(--text-primary);
    font-size: 15px;
    text-align: left;
    cursor: pointer;
    transition: background 0.1s;
}
.child-page:hover {
    background: var(--hover-background);
}
.child-page:hover .child-title {
    text-decoration-color: currentColor;
}
.child-page:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
}
.child-icon {
    width: 18px;
    font-size: 15px;
    text-align: center;
    flex-shrink: 0;
    color: var(--text-tertiary);
}
.child-plus {
    color: var(--text-tertiary);
    line-height: 1;
}
.child-title {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-decoration: underline;
    text-underline-offset: 3px;
    text-decoration-color: var(--text-tertiary);
}
.child-new {
    color: var(--text-tertiary);
    font-size: 14px;
}
.child-new:hover {
    color: var(--text-secondary);
}
.child-new:hover .child-title {
    text-decoration: none;
}

/* 状态/按钮 */
.nt-state {
    padding: 16px;
    font-size: 14px;
    color: var(--text-secondary);
}
.nt-state-error {
    color: var(--danger);
}
.nt-ghost {
    border: none;
    background: none;
    color: var(--text-secondary);
    font-size: 14px;
    padding: 6px 10px;
    border-radius: 6px;
    cursor: pointer;
    transition: background 0.12s, color 0.12s;
}
.nt-ghost:hover {
    background: var(--hover-background);
    color: var(--text-primary);
}
.nt-ghost:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
}
.nt-ghost-danger:hover {
    background: var(--danger-soft);
    color: var(--danger);
}
.nt-btn {
    padding: 7px 14px;
    border-radius: 6px;
    font-size: 14px;
    cursor: pointer;
    border: 1px solid var(--panel-border);
    background: var(--panel-background);
    color: var(--text-primary);
    transition: background 0.12s;
}
.nt-btn:hover {
    background: var(--hover-background);
}
.nt-btn:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
}
.nt-btn-danger {
    background: var(--danger);
    color: var(--text-inverse);
    border-color: var(--danger);
}
.nt-btn-danger:hover {
    background: var(--danger);
}

/* 删除弹窗 */
.modal-mask {
    position: fixed;
    inset: 0;
    background: var(--overlay-backdrop);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 200;
}
.modal {
    background: var(--panel-background);
    border-radius: 10px;
    padding: 24px;
    width: min(420px, 90vw);
    box-shadow: var(--shadow-overlay);
}
.modal-title {
    font-size: 18px;
    margin: 0 0 12px;
}
.modal-text {
    font-size: 14px;
    color: var(--text-primary);
    margin: 0 0 8px;
    line-height: 1.6;
}
.modal-warn {
    font-size: 13px;
    color: var(--warning);
    background: var(--warning-soft);
    border: 1px solid var(--warning);
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

@media (max-width: 1340px) {
    /* 主内容区变窄时顶栏换行，避免面包屑把按钮挤出可视区 */
    .doc-topbar {
        flex-wrap: wrap;
    }
}
</style>
