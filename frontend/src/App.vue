<template>
    <div
        class="app-layout"
        :class="{
            // 非知识库区块只有「主导航 + 主内容」两栏。
            // 必须显式声明两列：否则沿用四栏模板时，第二栏（页面树）不渲染，
            // 内容会被挤到第三/四列位置上，宽度只剩几百像素。
            'col-single': !onKbSection,
            'col-page-hidden': onKbSection && pageColHidden,
            'col-category-hidden': onKbSection && categoryColHidden,
            'col-both-hidden': onKbSection && pageColHidden && categoryColHidden
        }"
    >
        <!-- 环境层：为玻璃提供可折射的背景内容 -->
        <div class="app-backdrop" aria-hidden="true"></div>

        <!-- ═══ 栏 1：主导航 ═══ -->
        <nav class="sidebar glass-panel glass-sheen main-sidebar" aria-label="主导航">
            <div class="ws-head">
                <span class="ws-mark">
                    <svg class="icon icon-lg" viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M21 8.4v7.2a1.8 1.8 0 0 1-.95 1.6l-6.4 3.4a1.8 1.8 0 0 1-1.7 0l-6.4-3.4a1.8 1.8 0 0 1-.95-1.6V8.4a1.8 1.8 0 0 1 .95-1.6l6.4-3.4a1.8 1.8 0 0 1 1.7 0l6.4 3.4A1.8 1.8 0 0 1 21 8.4z" />
                        <path d="M3.5 7.6 12 12.3l8.5-4.7" />
                        <path d="M12 21.1v-8.8" />
                    </svg>
                </span>
                <span class="ws-name">工具箱</span>
                <svg class="icon icon-sm ws-caret" viewBox="0 0 24 24" aria-hidden="true">
                    <polyline points="9 18 15 12 9 6" />
                </svg>
            </div>

            <div class="nav-group">
                <router-link to="/" class="nav-item" :class="{ 'is-active': $route.path === '/' }">
                    <span class="nav-icon">
                        <svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
                            <path d="M3 10.5 12 3.5l9 7" />
                            <path d="M5.5 9.5V20h13V9.5" />
                        </svg>
                    </span>
                    <span class="nav-label">首页</span>
                </router-link>
                <router-link to="/kb" class="nav-item" :class="{ 'is-active': onKbSection }">
                    <span class="nav-icon">
                        <svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
                            <path d="M4 4.5h6.5a2 2 0 0 1 2 2V20a1.6 1.6 0 0 0-1.6-1.5H4z" />
                            <path d="M20 4.5h-6.5a2 2 0 0 0-2 2V20a1.6 1.6 0 0 1 1.6-1.5H20z" />
                        </svg>
                    </span>
                    <span class="nav-label">知识库</span>
                </router-link>
                <router-link to="/tools" class="nav-item" :class="{ 'is-active': $route.path.startsWith('/tools') }">
                    <span class="nav-icon">
                        <svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
                            <rect x="3" y="8" width="18" height="12" rx="2" />
                            <path d="M9 8V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V8" />
                            <path d="M3 13h18" />
                        </svg>
                    </span>
                    <span class="nav-label">工具箱</span>
                </router-link>
            </div>

            <div class="nav-footer">
                <!-- 侧栏折叠开关：窄屏自动折叠后，仍可手动唤回 -->
                <div class="col-toggles" v-if="onKbSection">
                    <button
                        class="mini-btn"
                        type="button"
                        :class="{ 'is-on': !pageColHidden }"
                        :title="pageColHidden ? '显示页面栏' : '隐藏页面栏'"
                        :aria-pressed="String(!pageColHidden)"
                        @click="pageColHidden = !pageColHidden"
                    >
                        <svg class="icon icon-sm" viewBox="0 0 24 24" aria-hidden="true">
                            <rect x="3" y="4.5" width="18" height="15" rx="2" />
                            <line x1="9" y1="4.5" x2="9" y2="19.5" />
                        </svg>
                    </button>
                    <button
                        class="mini-btn"
                        type="button"
                        :class="{ 'is-on': !categoryColHidden }"
                        :title="categoryColHidden ? '显示分类栏' : '隐藏分类栏'"
                        :aria-pressed="String(!categoryColHidden)"
                        @click="categoryColHidden = !categoryColHidden"
                    >
                        <svg class="icon icon-sm" viewBox="0 0 24 24" aria-hidden="true">
                            <rect x="3" y="4.5" width="18" height="15" rx="2" />
                            <line x1="15" y1="4.5" x2="15" y2="19.5" />
                        </svg>
                    </button>
                </div>
                <ThemeToggle />
                <span class="version-tag">
                    <span class="dot"></span>v0.1 MVP
                </span>
            </div>
        </nav>

        <!-- ═══ 栏 2：页面树（仅知识库区块）═══ -->
        <aside v-if="onKbSection" class="sidebar glass-panel page-sidebar" :class="{ 'is-collapsed': pageColHidden }" aria-label="页面">
            <header class="side-head">
                <h2 class="side-title">页面</h2>
                <button class="icon-btn" type="button" title="新建页面" aria-label="新建页面" @click="createPage">
                    <svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
                        <line x1="12" y1="5" x2="12" y2="19" />
                        <line x1="5" y1="12" x2="19" y2="12" />
                    </svg>
                </button>
            </header>

            <div class="scroll-area">
                <p v-if="treeLoading" class="empty-hint">加载中…</p>
                <p v-else-if="treeError" class="empty-hint notice-error-text">{{ treeError }}</p>
                <p v-else-if="pageTree.length === 0" class="empty-hint">还没有页面，点击下方新建</p>

                <PageTree
                    v-else
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
            </div>

            <button class="btn side-add" type="button" @click="createPage">
                <svg class="icon icon-sm" viewBox="0 0 24 24" aria-hidden="true">
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                新建页面
            </button>
        </aside>

        <!-- ═══ 栏 3：分类（仅知识库区块）═══ -->
        <aside v-if="onKbSection" class="sidebar glass-panel category-sidebar" :class="{ 'is-collapsed': categoryColHidden }" aria-label="分类">
            <header class="side-head">
                <h2 class="side-title">分类</h2>
            </header>

            <div class="scroll-area">
                <button
                    class="nav-item cat-item"
                    :class="{ 'is-active': selectedCategory === null }"
                    type="button"
                    @click="selectCategory(null)"
                >
                    <span class="nav-icon">
                        <svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
                            <path d="M4 6.5h16" />
                            <path d="M4 12h16" />
                            <path d="M4 17.5h16" />
                        </svg>
                    </span>
                    <span class="nav-label">全部文档</span>
                    <span class="count-badge">{{ totalCount }}</span>
                </button>

                <p v-if="categoryLoading" class="empty-hint">加载中…</p>
                <p v-else-if="categories.length === 0" class="empty-hint">还没有分类</p>

                <div v-for="c in categories" :key="c.id" class="cat-row">
                    <!-- 编辑态：行内输入改名 -->
                    <input
                        v-if="editingCatId === c.id"
                        ref="catInput"
                        class="input cat-input"
                        v-model="editingCatName"
                        maxlength="30"
                        @keyup.enter="saveRenameCategory(c)"
                        @keyup.esc="cancelRenameCategory"
                        @blur="saveRenameCategory(c)"
                    />
                    <button
                        v-else
                        class="nav-item cat-item"
                        :class="{ 'is-active': selectedCategory === c.id }"
                        type="button"
                        @click="selectCategory(c.id)"
                    >
                        <span class="nav-icon">
                            <svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
                                <path d="M3.5 7.2A1.7 1.7 0 0 1 5.2 5.5h3.9a1.7 1.7 0 0 1 1.36.68l.94 1.12a1.7 1.7 0 0 0 1.36.68h6.78A1.7 1.7 0 0 1 20.5 9.7v7.1a1.7 1.7 0 0 1-1.7 1.7H5.2a1.7 1.7 0 0 1-1.7-1.7z" />
                            </svg>
                        </span>
                        <span class="nav-label">{{ c.name }}</span>
                        <span v-if="c.document_count" class="count-badge">{{ c.document_count }}</span>
                    </button>

                    <!-- hover 显形的分类操作 -->
                    <div v-if="editingCatId !== c.id" class="cat-actions">
                        <button class="mini-btn" type="button" title="重命名" aria-label="重命名分类" @click="startRenameCategory(c)">
                            <svg class="icon icon-sm" viewBox="0 0 24 24" aria-hidden="true">
                                <path d="M12 20h9" />
                                <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7.5 18.5l-4 1 1-4z" />
                            </svg>
                        </button>
                        <button class="mini-btn" type="button" title="删除" aria-label="删除分类" @click="askDeleteCategory(c)">
                            <svg class="icon icon-sm" viewBox="0 0 24 24" aria-hidden="true">
                                <polyline points="3 6 5 6 21 6" />
                                <path d="M19 6v13.5A1.5 1.5 0 0 1 17.5 21h-11A1.5 1.5 0 0 1 5 19.5V6" />
                                <path d="M9 6V4.5A1.5 1.5 0 0 1 10.5 3h3A1.5 1.5 0 0 1 15 4.5V6" />
                            </svg>
                        </button>
                    </div>
                </div>

                <!-- 新建分类：行内输入 -->
                <div v-if="addCatMode" class="cat-row">
                    <input
                        ref="newCatInput"
                        class="input cat-input"
                        v-model="newCatName"
                        placeholder="分类名称（1–30 字）"
                        maxlength="30"
                        @keyup.enter="saveNewCategory"
                        @keyup.esc="cancelAddCategory"
                    />
                </div>
            </div>

            <button v-if="!addCatMode" class="btn side-add" type="button" @click="startAddCategory">
                <svg class="icon icon-sm" viewBox="0 0 24 24" aria-hidden="true">
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                新建分类
            </button>
        </aside>

        <!-- ═══ 栏 4：主内容 ═══ -->
        <main class="main-content glass-panel glass-sheen" role="main" ref="mainContentRef">
            <router-view :category="selectedCategory" @category-change="onCategoryChange" />
        </main>

        <!-- 页面「···」菜单 -->
        <div v-if="menu" class="dropdown menu-pop" role="menu" :style="{ top: menu.y + 'px', left: menu.x + 'px' }">
            <button type="button" role="menuitem" @click="menuCreateChild">新建子页面</button>
            <button type="button" role="menuitem" @click="menuRename">重命名</button>
            <button type="button" role="menuitem" @click="menuCopyLink">复制链接</button>
            <div class="dd-sep"></div>
            <button class="dd-danger" type="button" role="menuitem" @click="menuDelete">删除</button>
        </div>

        <!-- 删除确认（提示将连带删除子页面） -->
        <div v-if="deleteTarget" class="overlay" @click.self="cancelDelete">
            <div class="dialog" role="dialog" aria-modal="true" aria-label="删除页面">
                <h2 class="dialog-title">删除页面</h2>
                <p class="dialog-text">确定要删除「<strong>{{ deleteTarget.title }}</strong>」吗？</p>
                <p v-if="deleteDescendants > 0" class="dialog-warn">
                    其下 {{ deleteDescendants }} 个子页面也会一并删除，且不可撤销。
                </p>
                <p v-else class="dialog-text">此操作不可撤销。</p>
                <p v-if="deleteError" class="notice notice-error">{{ deleteError }}</p>
                <div class="dialog-actions">
                    <button class="btn" type="button" :disabled="deleting" @click="cancelDelete">取消</button>
                    <button class="btn btn-danger" type="button" :disabled="deleting" @click="confirmDelete">
                        {{ deleting ? '删除中…' : '删除' }}
                    </button>
                </div>
            </div>
        </div>

        <!-- 分类删除确认 -->
        <div v-if="deleteCatTarget" class="overlay" @click.self="cancelDeleteCategory">
            <div class="dialog" role="dialog" aria-modal="true" aria-label="删除分类">
                <h2 class="dialog-title">删除分类</h2>
                <p class="dialog-text">确定要删除分类「<strong>{{ deleteCatTarget.name }}</strong>」吗？</p>
                <p class="dialog-warn">该分类下的文档不会被删除，但会变为「未分类」。</p>
                <p v-if="categoryError" class="notice notice-error">{{ categoryError }}</p>
                <div class="dialog-actions">
                    <button class="btn" type="button" :disabled="categoryBusy" @click="cancelDeleteCategory">取消</button>
                    <button class="btn btn-danger" type="button" :disabled="categoryBusy" @click="confirmDeleteCategory">
                        {{ categoryBusy ? '删除中…' : '删除' }}
                    </button>
                </div>
            </div>
        </div>
    </div>
</template>

<script>
import { api } from './api/client.js';
import PageTree from './components/PageTree.vue';
import ThemeToggle from './components/ThemeToggle.vue';

const EXPANDED_KEY = 'kb-tree-expanded';

export default {
    name: 'App',
    components: { PageTree, ThemeToggle },
    data() {
        return {
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
            deleting: false,
            // 分类（第三栏）
            categories: [],
            categoryLoading: true,
            selectedCategory: null,
            totalCount: 0,
            addCatMode: false,
            newCatName: '',
            editingCatId: null,
            editingCatName: '',
            deleteCatTarget: null,
            categoryError: '',
            categoryBusy: false,
            // 响应式折叠
            pageColHidden: false,
            categoryColHidden: false
        };
    },
    computed: {
        /** 是否处于知识库区块（/kb/*），决定页面栏与分类栏是否显示 */
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
        document.addEventListener('keydown', this.handleKeydown);

        // 任意视图在新增/保存/删除后派发 kb-changed，侧边栏据此刷新
        this._changeHandler = () => {
            this.loadTree();
            this.loadCategories();
        };
        window.addEventListener('kb-changed', this._changeHandler);

        this.applyResponsive();
        window.addEventListener('resize', this.applyResponsive);

        this.loadExpanded();
        this.loadTree();
        this.loadCategories();
    },
    beforeUnmount() {
        window.removeEventListener('resize', this.applyResponsive);
        document.removeEventListener('keydown', this.handleKeydown);
        window.removeEventListener('kb-changed', this._changeHandler);
    },
    methods: {
        // ── 响应式：逐级折叠侧栏 ──
        applyResponsive() {
            const w = window.innerWidth;
            // ≤1440 收起分类栏；≤1320 再收起页面栏（用 hidden class 而非改 CSS 变量，
            // 这样折叠状态可由用户手动切换，不被媒体查询强制覆盖）
            this.categoryColHidden = w <= 1440;
            this.pageColHidden = w <= 1320;
        },

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
            if (this.activeId === node.id) return;
            this.$router.push({ name: 'kb-detail', params: { id: node.id } }).catch(() => {});
        },
        createPage() {
            this.$router.push({ name: 'kb-new' }).catch(() => {});
        },
        createChild(node) {
            this.menu = null;
            this.expanded = { ...this.expanded, [node.id]: true };
            this.saveExpanded();
            this.$router.push({ name: 'kb-new', query: { parent: String(node.id) } }).catch(() => {});
        },

        // ── 分类 ──
        async loadCategories() {
            this.categoryError = '';
            try {
                const [cats, docs] = await Promise.all([api.listCategories(), api.listDocuments('?limit=1')]);
                if (cats.res.ok) {
                    // 后端分类列表含 document_count；缺失时补 0 保证模板取值安全
                    this.categories = (cats.body || []).map((c) => ({ ...c, document_count: c.document_count || 0 }));
                }
                if (docs.res.ok) this.totalCount = (docs.body && docs.body.total) || 0;
            } catch (e) {
                this.categoryError = e.network ? '无法连接后端服务' : (e.message || '分类加载失败');
            } finally {
                this.categoryLoading = false;
            }
        },
        selectCategory(id) {
            this.selectedCategory = id;
        },
        onCategoryChange(id) {
            this.selectedCategory = id;
        },
        startAddCategory() {
            this.addCatMode = true;
            this.$nextTick(() => this.$refs.newCatInput && this.$refs.newCatInput.focus());
        },
        cancelAddCategory() {
            this.addCatMode = false;
            this.newCatName = '';
        },
        async saveNewCategory() {
            const name = this.newCatName.trim();
            if (!name) { this.addCatMode = false; return; }
            this.categoryBusy = true;
            this.categoryError = '';
            try {
                const { res, body } = await api.createCategory(name);
                if (!res.ok) throw new Error((body && body.message) || '新建分类失败');
                this.cancelAddCategory();
                await this.loadCategories();
                window.dispatchEvent(new Event('kb-changed'));
            } catch (e) {
                this.categoryError = e.network ? e.message : (e.message || '新建分类失败');
            } finally {
                this.categoryBusy = false;
            }
        },
        startRenameCategory(c) {
            this.editingCatId = c.id;
            this.editingCatName = c.name;
            this.$nextTick(() => this.$refs.catInput && this.$refs.catInput[0] && this.$refs.catInput[0].focus());
        },
        cancelRenameCategory() {
            this.editingCatId = null;
            this.editingCatName = '';
        },
        async saveRenameCategory(c) {
            if (this.editingCatId !== c.id || this.categoryBusy) return;
            const name = this.editingCatName.trim();
            if (!name || name === c.name) { this.cancelRenameCategory(); return; }
            this.categoryBusy = true;
            try {
                const { res, body } = await api.updateCategory(c.id, name);
                if (!res.ok) throw new Error((body && body.message) || '重命名失败');
                this.cancelRenameCategory();
                await this.loadCategories();
                window.dispatchEvent(new Event('kb-changed'));
            } catch (e) {
                this.categoryError = e.network ? e.message : (e.message || '重命名失败');
                this.cancelRenameCategory();
            } finally {
                this.categoryBusy = false;
            }
        },
        askDeleteCategory(c) {
            this.categoryError = '';
            this.deleteCatTarget = c;
        },
        cancelDeleteCategory() {
            if (this.categoryBusy) return;
            this.deleteCatTarget = null;
            this.categoryError = '';
        },
        async confirmDeleteCategory() {
            if (!this.deleteCatTarget) return;
            const target = this.deleteCatTarget;
            this.categoryBusy = true;
            try {
                const { res, body } = await api.deleteCategory(target.id);
                if (!res.ok) throw new Error((body && body.message) || '删除分类失败');
                this.deleteCatTarget = null;
                if (this.selectedCategory === target.id) this.selectedCategory = null;
                await this.loadCategories();
                window.dispatchEvent(new Event('kb-changed'));
            } catch (e) {
                this.categoryError = e.network ? e.message : (e.message || '删除分类失败');
            } finally {
                this.categoryBusy = false;
            }
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

        handleKeydown(e) {
            if (e.key !== 'Escape') return;
            if (this.menu) { this.menu = null; return; }
            if (this.deleteTarget) { this.cancelDelete(); return; }
            if (this.deleteCatTarget) { this.cancelDeleteCategory(); return; }
            if (this.addCatMode) { this.cancelAddCategory(); return; }
        }
    }
};
</script>

<style>
/* 本组件的样式全部走全局样式文件（styles/*），此处只保留布局专属部分，
   避免与 token 体系形成两套并行规则。 */
.main-sidebar { padding: 16px 12px; }
.ws-head {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 4px 10px 14px;
}
.ws-mark {
    display: grid;
    place-items: center;
    color: var(--accent);
}
.ws-name {
    flex: 1;
    font-size: var(--text-section-title);
    font-weight: var(--weight-semibold);
    letter-spacing: 0.1px;
}
.ws-caret { color: var(--text-tertiary); }

.nav-group { display: flex; flex-direction: column; gap: 2px; }

.nav-footer {
    margin-top: auto;
    padding-top: 12px;
    display: flex;
    align-items: center;
    gap: 8px;
}
/* 侧栏折叠开关组：两枚图标按钮，常驻但仅在知识库区块显示 */
.col-toggles {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 2px;
    border-radius: var(--radius-sm);
    background: var(--panel-background);
    border: 1px solid var(--panel-border);
}
/* 开启态用 accent Tint 表示「该栏可见」，与关闭态一眼可辨 */
.col-toggles .mini-btn.is-on { color: var(--accent); background: var(--accent-soft); }
.version-tag {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: var(--text-tag);
    color: var(--text-tertiary);
}
.version-tag .dot {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: var(--accent);
}

.side-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 4px 10px 12px;
}
.side-title {
    margin: 0;
    font-size: var(--text-section-title);
    font-weight: var(--weight-semibold);
    color: var(--text-primary);
}
.side-add { width: 100%; margin-top: 10px; color: var(--text-secondary); }
.side-add:hover { color: var(--text-primary); }

.icon-btn {
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    padding: 0;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
    transition: background var(--dur-base) var(--ease-out), color var(--dur-base) var(--ease-out);
}
.icon-btn:hover { background: var(--hover-background); color: var(--text-primary); }
.icon-btn:focus-visible { outline: none; border-color: var(--accent-border); box-shadow: 0 0 0 3px var(--focus-ring); }

/* 分类栏 */
.cat-row { position: relative; }
.cat-item { padding-right: 8px; }
.cat-actions {
    position: absolute;
    top: 50%;
    right: 8px;
    transform: translateY(-50%);
    display: none;
    gap: 2px;
    padding: 2px;
    border-radius: 8px;
    background: var(--glass-background-strong);
    border: 1px solid var(--panel-border);
}
.cat-row:hover .cat-actions { display: flex; }
.mini-btn {
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    padding: 0;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
    transition: background var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);
}
.mini-btn:hover { background: var(--hover-background); color: var(--text-primary); }
.cat-input { width: 100%; height: 34px; font-size: var(--text-nav); }
.notice-error-text { color: var(--danger); }

/* 页面菜单定位在视口坐标系，故用 fixed */
.menu-pop { position: fixed; }

/* 主内容区滚动由子视图自身负责，这里仅提供内边距与溢出边界 */
.main-content > * { min-height: 0; }

@media (max-width: 1280px) {
    /* 低于 1280 时侧栏已由 JS 折叠，此处仅保证内容区可用宽度 */
    body { overflow: auto; }
}
</style>