<template>
    <div class="app-layout" :class="{ 'sidebar-open': sidebarOpen }">
        <!-- 移动端遮罩 -->
        <div class="sidebar-overlay" @click="closeSidebar" aria-hidden="true"></div>

        <!-- 左侧导航（Notion 风格：工作区 + 快捷入口 + 页面树） -->
        <nav class="sidebar" role="navigation" aria-label="主导航">
            <div class="sidebar-workspace" @click="closeSidebar">
                <span class="ws-avatar">📦</span>
                <span class="ws-name">工具箱</span>
                <span class="ws-caret">▾</span>
            </div>

            <div class="sidebar-menu">
                <router-link to="/" class="nav-link" :class="{ 'is-active': $route.path === '/' }" @click="closeSidebar">
                    <span class="nav-icon">🏠</span>
                    <span class="nav-label">首页</span>
                </router-link>
                <router-link to="/kb" class="nav-link" :class="{ 'is-active': $route.path.startsWith('/kb') }" @click="closeSidebar">
                    <span class="nav-icon">📚</span>
                    <span class="nav-label">知识库</span>
                </router-link>

                <router-link to="/tools" class="nav-link" :class="{ 'is-active': $route.path.startsWith('/tools') }" @click="closeSidebar">
                    <span class="nav-icon">🧰</span>
                    <span class="nav-label">工具箱</span>
                </router-link>
            </div>

            <div class="nav-footer">
                <span class="version-tag">v0.1 MVP</span>
            </div>
        </nav>

        <!-- 移动端菜单按钮 -->
        <button v-if="isMobile && !sidebarOpen" class="mobile-menu-btn" @click="openSidebar" aria-label="打开导航" ref="menuBtnRef">☰</button>

        <!-- 主内容区：左侧为二级页面菜单（仅知识库区块），右侧为页面内容 -->
        <main class="main-content" role="main" tabindex="-1" ref="mainContentRef">
            <aside v-if="onKbSection" class="sub-menu" aria-label="页面菜单">
                <h2 class="sub-menu-title">页面</h2>

                <p v-if="treeLoading" class="tree-hint">加载中…</p>
                <p v-else-if="treeError" class="tree-hint tree-hint-error">{{ treeError }}</p>
                <p v-else-if="pageTree.length === 0" class="tree-hint">还没有页面，点击下方新建</p>

                <PageTree
                    v-if="pageTree.length"
                    :nodes="pageTree"
                    :depth="0"
                    :active-id="activeId"
                    :expanded="expanded"
                    :renaming-id="renamingId"
                    @open="openNode"
                    @toggle="toggleNode"
                    @create-child="createChild"
                    @menu="openMenu"
                    @rename-submit="submitRename"
                    @rename-cancel="cancelRename"
                />

                <button class="tree-add" type="button" @click="createPage">＋ 新建页面</button>
            </aside>

            <div class="content-body">
                <router-view />
            </div>
        </main>

        <!-- 页面「···」菜单 -->
        <div v-if="menu" class="menu-backdrop" @click="menu = null"></div>
        <div v-if="menu" class="page-menu" role="menu" :style="{ top: menu.y + 'px', left: menu.x + 'px' }">
            <button class="menu-item" type="button" role="menuitem" @click="menuCreateChild">新建子页面</button>
            <button class="menu-item" type="button" role="menuitem" @click="menuRename">重命名</button>
            <button class="menu-item" type="button" role="menuitem" @click="menuCopyLink">复制链接</button>
            <div class="menu-sep"></div>
            <button class="menu-item menu-danger" type="button" role="menuitem" @click="menuDelete">删除</button>
        </div>

        <!-- 删除确认（与 Notion 一致：提示将连带删除子页面） -->
        <div v-if="deleteTarget" class="modal-mask" @click.self="cancelDelete">
            <div class="modal" role="dialog" aria-modal="true" aria-label="删除页面">
                <h2 class="modal-title">删除页面</h2>
                <p class="modal-text">
                    确定要删除「<strong>{{ deleteTarget.title }}</strong>」吗？
                </p>
                <p v-if="deleteDescendants > 0" class="modal-warn">
                    其下 {{ deleteDescendants }} 个子页面也会一并删除，且不可撤销。
                </p>
                <p v-else class="modal-note">此操作不可撤销。</p>
                <p v-if="deleteError" class="modal-error">{{ deleteError }}</p>
                <div class="modal-actions">
                    <button class="nt-btn" type="button" :disabled="deleting" @click="cancelDelete">取消</button>
                    <button class="nt-btn nt-btn-danger" type="button" :disabled="deleting" @click="confirmDelete">
                        {{ deleting ? '删除中…' : '删除' }}
                    </button>
                </div>
            </div>
        </div>
    </div>
</template>

<script>
import { api } from './api/client.js';
import PageTree from './components/PageTree.vue';

const EXPANDED_KEY = 'kb-tree-expanded';

export default {
    name: 'App',
    components: { PageTree },
    data() {
        return {
            sidebarOpen: false,
            isMobile: window.innerWidth <= 768,
            treeRows: [],
            treeLoading: true,
            treeError: '',
            expanded: {},
            renamingId: null,
            renameBusy: false,
            menu: null,
            deleteTarget: null,
            deleteDescendants: 0,
            deleteError: '',
            deleting: false
        };
    },
    computed: {
        /** 是否处于知识库区块（/kb/*），决定二级页面树是否显示 */
        onKbSection() {
            return this.$route.path.startsWith('/kb');
        },
        /** 扁平行 → 嵌套树；父页面缺失的行降级为顶层，避免数据异常时整棵树消失 */
        pageTree() {
            const map = new Map();
            this.treeRows.forEach((row) => map.set(row.id, { ...row, children: [] }));
            const roots = [];
            this.treeRows.forEach((row) => {
                const node = map.get(row.id);
                const parent = row.parent_id != null ? map.get(row.parent_id) : null;
                if (parent && parent !== node) parent.children.push(node);
                else roots.push(node);
            });
            return roots;
        },
        /** 当前正在阅读/编辑的页面 ID，用于树中高亮 */
        activeId() {
            if (this.$route.name === 'kb-detail' || this.$route.name === 'kb-edit') {
                const id = Number(this.$route.params.id);
                return Number.isInteger(id) ? id : null;
            }
            return null;
        }
    },
    watch: {
        '$route.fullPath'() {
            this.menu = null;
            this.focusActive();
        }
    },
    mounted() {
        this._resizeHandler = () => {
            this.isMobile = window.innerWidth <= 768;
        };
        window.addEventListener('resize', this._resizeHandler);
        document.addEventListener('keydown', this.handleKeydown);

        // 任意视图在新增/保存/删除后派发 kb-changed，侧边栏据此刷新页面树
        this._treeChangeHandler = () => this.loadTree();
        window.addEventListener('kb-changed', this._treeChangeHandler);

        this.loadExpanded();
        this.loadTree();
    },
    beforeUnmount() {
        window.removeEventListener('resize', this._resizeHandler);
        document.removeEventListener('keydown', this.handleKeydown);
        window.removeEventListener('kb-changed', this._treeChangeHandler);
    },
    methods: {
        // ── 树加载与展开状态 ──

        async loadTree() {
            this.treeError = '';
            try {
                const { res, body } = await api.listDocumentTree();
                if (!res.ok) throw new Error((body && body.message) || '页面树加载失败');
                this.treeRows = (body && body.items) || [];
                this.focusActive();
            } catch (e) {
                this.treeError = e.network ? '无法连接后端服务' : (e.message || '页面树加载失败');
            } finally {
                this.treeLoading = false;
            }
        },
        loadExpanded() {
            try {
                const raw = localStorage.getItem(EXPANDED_KEY);
                if (raw) this.expanded = JSON.parse(raw) || {};
            } catch {
                this.expanded = {};
            }
        },
        saveExpanded() {
            try {
                localStorage.setItem(EXPANDED_KEY, JSON.stringify(this.expanded));
            } catch { /* localStorage 不可用时忽略（仅影响折叠记忆） */ }
        },
        toggleNode(id) {
            this.expanded = { ...this.expanded, [id]: !this.expanded[id] };
            this.saveExpanded();
        },
        /** 自动展开当前页面及其祖先，打开子页面时父页面始终可见（Notion 行为） */
        focusActive() {
            const id = this.activeId;
            if (!id) return;
            const parentOf = new Map(this.treeRows.map((r) => [r.id, r.parent_id]));
            const next = { ...this.expanded };
            let changed = false;

            if (this.treeRows.some((r) => r.parent_id === id) && !next[id]) {
                next[id] = true;
                changed = true;
            }

            let p = parentOf.get(id);
            let guard = 0;
            while (p != null && guard++ < 200) {
                if (!next[p]) {
                    next[p] = true;
                    changed = true;
                }
                p = parentOf.get(p);
            }
            if (changed) {
                this.expanded = next;
                this.saveExpanded();
            }
        },

        // ── 导航 ──

        openNode(node) {
            this.closeSidebar();
            if (this.activeId === node.id) return;
            this.$router.push({ name: 'kb-detail', params: { id: node.id } }).catch(() => {});
        },
        createPage() {
            this.closeSidebar();
            this.$router.push({ name: 'kb-new' }).catch(() => {});
        },
        createChild(node) {
            this.menu = null;
            this.expanded = { ...this.expanded, [node.id]: true };
            this.saveExpanded();
            this.closeSidebar();
            this.$router.push({ name: 'kb-new', query: { parent: String(node.id) } }).catch(() => {});
        },

        // ── 「···」菜单 ──

        openMenu(node, ev) {
            const rect = ev.currentTarget.getBoundingClientRect();
            const MENU_W = 176;
            const MENU_H = 176;
            const x = Math.max(8, Math.min(rect.left, window.innerWidth - MENU_W - 8));
            const y = Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - MENU_H - 8));
            this.menu = { node, x, y };
        },
        menuCreateChild() {
            const node = this.menu.node;
            this.createChild(node);
        },
        menuRename() {
            const node = this.menu.node;
            this.menu = null;
            this.renamingId = node.id;
        },
        async menuCopyLink() {
            const node = this.menu.node;
            this.menu = null;
            const url = window.location.origin + '/kb/' + node.id;
            try {
                await navigator.clipboard.writeText(url);
            } catch {
                // 剪贴板被浏览器禁用时退化为手动复制
                window.prompt('复制页面链接', url);
            }
        },
        async menuDelete() {
            const node = this.menu.node;
            this.menu = null;
            this.deleteError = '';
            this.deleteDescendants = 0;
            try {
                const { res, body } = await api.getDocument(node.id);
                if (res.ok && body) this.deleteDescendants = body.descendant_count || 0;
            } catch {
                // 拿不到子页面数量不阻断删除，仅少一条提示
            }
            this.deleteTarget = node;
        },

        // ── 重命名（行内输入） ──

        async submitRename(node, rawTitle) {
            if (this.renamingId !== node.id || this.renameBusy) return;
            const title = String(rawTitle || '').trim();
            if (!title || title === node.title) {
                this.cancelRename();
                return;
            }
            this.renameBusy = true;
            try {
                const current = await api.getDocument(node.id);
                if (!current.res.ok) throw new Error((current.body && current.body.message) || '重命名失败');
                const updated = await api.updateDocument(node.id, { version: current.body.version, title });
                if (!updated.res.ok) throw new Error((updated.body && updated.body.message) || '重命名失败');
                this.renamingId = null;
                window.dispatchEvent(new Event('kb-changed'));
            } catch (e) {
                this.treeError = e.network ? e.message : (e.message || '重命名失败');
            } finally {
                this.renameBusy = false;
            }
        },
        cancelRename() {
            if (this.renameBusy) return;
            this.renamingId = null;
        },

        // ── 删除确认 ──

        cancelDelete() {
            if (this.deleting) return;
            this.deleteTarget = null;
            this.deleteError = '';
        },
        async confirmDelete() {
            if (!this.deleteTarget) return;
            const target = this.deleteTarget;
            this.deleting = true;
            this.deleteError = '';
            try {
                const { res, body } = await api.deleteDocument(target.id);
                if (!res.ok) throw new Error((body && body.message) || '删除失败');
                this.deleteTarget = null;
                if (this.activeId === target.id) {
                    this.$router.push({ name: 'kb-list' }).catch(() => {});
                }
                window.dispatchEvent(new Event('kb-changed'));
            } catch (e) {
                this.deleteError = e.network ? e.message : (e.message || '删除失败，请稍后重试');
            } finally {
                this.deleting = false;
            }
        },

        // ── 布局 ──

        openSidebar() {
            this.sidebarOpen = true;
        },
        closeSidebar() {
            this.sidebarOpen = false;
            this.$nextTick(() => {
                if (this.isMobile) {
                    this.$refs.menuBtnRef && this.$refs.menuBtnRef.focus();
                } else {
                    this.$refs.mainContentRef && this.$refs.mainContentRef.focus();
                }
            });
        },
        handleKeydown(e) {
            if (e.key === 'Escape') {
                if (this.menu) {
                    this.menu = null;
                    return;
                }
                if (this.deleteTarget) {
                    this.cancelDelete();
                    return;
                }
                if (this.sidebarOpen) {
                    e.preventDefault();
                    this.closeSidebar();
                }
            }
        }
    }
};
</script>

<style>
/* === 基础重置 === */
*, *::before, *::after {
    box-sizing: border-box;
}
:root {
    /* Notion 风格调色板 */
    --color-bg: #ffffff;
    --color-surface: #ffffff;
    --color-sidebar-bg: #f7f7f5;
    --color-sidebar-text: #5f5e5b;
    --color-sidebar-hover: #efefee;
    --color-sidebar-active: #e8e7e4;
    --color-text: #37352f;
    --color-text-muted: #787774;
    --color-text-faint: #9b9a97;
    --color-border: #e9e9e7;
    --color-border-strong: #dddddb;
    --color-focus: #2383e2;
    --color-danger: #eb5757;
    --color-code-bg: #f5f4f2;
    --sidebar-width: 248px;
    --content-width: 860px;
    font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI",
        "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", Helvetica, Arial, sans-serif;
}
body {
    margin: 0;
    background: var(--color-bg);
    color: var(--color-text);
    -webkit-font-smoothing: antialiased;
}
a { color: inherit; text-decoration: none; }
ul { list-style: none; padding: 0; margin: 0; }
button { font-family: inherit; }

/* === 布局 === */
.app-layout {
    display: flex;
    min-height: 100vh;
}

/* === 侧边栏（Notion：浅灰、圆角项、hover 显形） === */
.sidebar {
    position: fixed;
    top: 0;
    left: 0;
    width: var(--sidebar-width);
    height: 100vh;
    background: var(--color-sidebar-bg);
    color: var(--color-sidebar-text);
    display: flex;
    flex-direction: column;
    z-index: 100;
    overflow-y: auto;
    padding: 8px 0 10px;
}
.sidebar-workspace {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 4px 8px 10px;
    padding: 6px 8px;
    border-radius: 6px;
    cursor: pointer;
    color: var(--color-text);
    font-weight: 600;
    font-size: 14px;
}
.sidebar-workspace:hover {
    background: var(--color-sidebar-hover);
}
.ws-avatar {
    font-size: 18px;
    line-height: 1;
}
.ws-name {
    flex: 1;
}
.ws-caret {
    color: var(--color-text-faint);
    font-size: 12px;
}
.sidebar-menu {
    padding: 0 8px;
    display: flex;
    flex-direction: column;
    gap: 1px;
}
.nav-section-label {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--color-text-faint);
    padding: 14px 16px 4px;
}
.nav-link {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    border-radius: 6px;
    color: var(--color-sidebar-text);
    font-size: 14px;
    transition: background 0.12s;
}
.nav-link:hover,
.nav-link:focus-visible {
    background: var(--color-sidebar-hover);
    outline: none;
}
.nav-link:focus-visible {
    box-shadow: 0 0 0 2px var(--color-focus);
}
.nav-link.is-active {
    background: var(--color-sidebar-active);
    color: var(--color-text);
    font-weight: 500;
}
.nav-icon {
    font-size: 15px;
    width: 18px;
    text-align: center;
    flex-shrink: 0;
}
.nav-label {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

/* === 页面树容器（内容区二级菜单内） === */
.sidebar-tree {
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
}
.tree-hint {
    margin: 2px 0;
    padding: 4px 8px;
    font-size: 13px;
    color: var(--color-text-faint);
}
.tree-hint-error {
    color: var(--color-danger);
}
.tree-add {
    display: flex;
    align-items: center;
    width: 100%;
    margin-top: 2px;
    padding: 5px 8px;
    border: none;
    background: none;
    border-radius: 6px;
    color: var(--color-text-faint);
    font-size: 14px;
    text-align: left;
    cursor: pointer;
    transition: background 0.12s, color 0.12s;
}
.tree-add:hover {
    background: var(--color-sidebar-hover);
    color: var(--color-text);
}
.tree-add:focus-visible {
    outline: 2px solid var(--color-focus);
    outline-offset: -2px;
}

/* === 页面「···」菜单 === */
.menu-backdrop {
    position: fixed;
    inset: 0;
    z-index: 300;
}
.page-menu {
    position: fixed;
    z-index: 301;
    min-width: 176px;
    padding: 4px;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: 8px;
    box-shadow: 0 8px 28px rgba(15, 15, 15, 0.16);
}
.menu-item {
    display: block;
    width: 100%;
    padding: 7px 10px;
    border: none;
    background: none;
    border-radius: 5px;
    color: var(--color-text);
    font-size: 14px;
    text-align: left;
    cursor: pointer;
}
.menu-item:hover {
    background: var(--color-sidebar-hover);
}
.menu-danger {
    color: var(--color-danger);
}
.menu-danger:hover {
    background: #fdecec;
}
.menu-sep {
    height: 1px;
    margin: 4px 6px;
    background: var(--color-border);
}

/* === 删除确认弹窗 === */
.modal-mask {
    position: fixed;
    inset: 0;
    background: rgba(15, 15, 15, 0.4);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 320;
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
.modal-note {
    font-size: 13px;
    color: var(--color-text-muted);
    margin: 0 0 12px;
}
.modal-error {
    font-size: 13px;
    color: var(--color-danger);
    margin: 0 0 12px;
}
.modal-actions {
    display: flex;
    justify-content: flex-end;
    gap: 12px;
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
.nt-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
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

.nav-footer {
    margin-top: auto;
    padding: 12px 16px 4px;
    border-top: 1px solid var(--color-border);
}
.version-tag {
    font-size: 11px;
    color: var(--color-text-faint);
}

/* === 主内容区（含二级页面菜单） === */
.main-content {
    flex: 1;
    margin-left: var(--sidebar-width);
    padding: 0;
    background: var(--color-bg);
    min-height: 100vh;
    display: flex;
    align-items: stretch;
}
.main-content:focus {
    outline: none;
}

/* 二级页面菜单：位于主内容区左侧，点击「知识库」后出现 */
.sub-menu {
    flex-shrink: 0;
    align-self: flex-start;
    position: sticky;
    top: 0;
    width: 232px;
    max-height: 100vh;
    overflow-y: auto;
    padding: 24px 10px 40px 16px;
    border-right: 1px solid var(--color-border);
}
.sub-menu-title {
    margin: 0 0 8px;
    padding-left: 8px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--color-text-faint);
}
.content-body {
    flex: 1;
    min-width: 0;
}

/* === 移动端按钮 === */
.mobile-menu-btn {
    display: none;
    position: fixed;
    top: 12px;
    left: 12px;
    z-index: 90;
    background: var(--color-surface);
    color: var(--color-text);
    border: 1px solid var(--color-border);
    border-radius: 6px;
    padding: 8px 12px;
    font-size: 16px;
    cursor: pointer;
}
.mobile-menu-btn:focus-visible {
    outline: 2px solid var(--color-focus);
    outline-offset: 2px;
}
.sidebar-overlay {
    display: none;
    position: fixed;
    inset: 0;
    background: rgba(15, 15, 15, 0.4);
    z-index: 99;
}

/* === 响应式 === */
@media (max-width: 768px) {
    .sidebar {
        transform: translateX(-100%);
        transition: transform 0.2s;
        box-shadow: 0 0 24px rgba(15, 15, 15, 0.12);
    }
    .sidebar-open .sidebar {
        transform: translateX(0);
    }
    .sidebar-open .sidebar-overlay {
        display: block;
    }
    .mobile-menu-btn {
        display: block;
    }
    .main-content {
        margin-left: 0;
        padding-top: 56px;
        flex-direction: column;
    }
    /* 窄屏下二级页面菜单移到内容顶部 */
    .sub-menu {
        position: static;
        width: auto;
        max-height: 42vh;
        padding: 16px 16px 12px;
        border-right: none;
        border-bottom: 1px solid var(--color-border);
    }
    .app-layout:not(.sidebar-open) .sidebar {
        display: none;
    }
    .app-layout.sidebar-open .sidebar {
        display: flex;
    }
}

/* === Markdown 渲染区（Notion 阅读排版） === */
.markdown-body {
    line-height: 1.65;
    color: var(--color-text);
    word-wrap: break-word;
    overflow-wrap: break-word;
    font-size: 16px;
}
.markdown-body > *:first-child { margin-top: 0; }
.markdown-body > *:last-child { margin-bottom: 0; }
.markdown-body h1 { font-size: 1.7em; font-weight: 700; margin: 1.2em 0 0.5em; line-height: 1.3; }
.markdown-body h2 { font-size: 1.4em; font-weight: 600; margin: 1.1em 0 0.4em; line-height: 1.3; }
.markdown-body h3 { font-size: 1.2em; font-weight: 600; margin: 1em 0 0.4em; }
.markdown-body h4, .markdown-body h5, .markdown-body h6 { font-weight: 600; margin: 0.9em 0 0.4em; }
.markdown-body p { margin: 0.5em 0; }
.markdown-body ul, .markdown-body ol { padding-left: 1.6em; margin: 0.5em 0; }
.markdown-body li { margin: 0.2em 0; }
.markdown-body li::marker { color: var(--color-text-muted); }
.markdown-body code {
    background: var(--color-code-bg);
    padding: 0.12em 0.4em;
    border-radius: 4px;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 0.88em;
    color: #eb5757;
}
.markdown-body pre {
    background: var(--color-code-bg);
    color: var(--color-text);
    padding: 16px;
    border-radius: 8px;
    overflow: auto;
    font-size: 0.9em;
    border: 1px solid var(--color-border);
}
.markdown-body pre code { background: none; padding: 0; color: inherit; font-size: 1em; }
.markdown-body blockquote {
    border-left: 3px solid var(--color-border-strong);
    margin: 0.8em 0;
    padding: 0.2em 1em;
    color: var(--color-text-muted);
}
.markdown-body a { color: var(--color-focus); text-decoration: none; }
.markdown-body a:hover { text-decoration: underline; }
.markdown-body table { border-collapse: collapse; margin: 0.8em 0; width: 100%; }
.markdown-body th, .markdown-body td { border: 1px solid var(--color-border); padding: 6px 12px; text-align: left; }
.markdown-body th { background: var(--color-sidebar-bg); font-weight: 600; }
.markdown-body img { max-width: 100%; border-radius: 4px; }
.markdown-body hr { border: none; border-top: 1px solid var(--color-border); margin: 1.4em 0; }
</style>
