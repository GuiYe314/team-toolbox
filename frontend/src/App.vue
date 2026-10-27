<template>
    <div
        class="app-layout"
        :class="{
            // 非知识库区块与知识库区块现在都是两栏：主导航+（页面树）+ 主内容。
            // 页面树可折叠，因此只需 col-page-hidden 一个变体。
            'col-single': !onKbSection || pageColHidden
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
                <router-link to="/assets" class="nav-item" :class="{ 'is-active': $route.path.startsWith('/assets') }">
                    <span class="nav-icon">
                        <svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
                            <path d="M3 6.5h18v4H3z" />
                            <path d="M5 10.5v8.5a1.5 1.5 0 0 0 1.5 1.5h11a1.5 1.5 0 0 0 1.5-1.5v-8.5" />
                            <path d="M12 13v5M9.5 15.5 12 18l2.5-2.5" />
                        </svg>
                    </span>
                    <span class="nav-label">资源管理</span>
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
                <router-link to="/settings" class="nav-item" :class="{ 'is-active': $route.path.startsWith('/settings') }">
                    <span class="nav-icon">
                        <svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
                            <circle cx="12" cy="12" r="3" />
                            <path d="M12 3.5v2M12 18.5v2M20.5 12h-2M5.5 12h-2M17.9 6.1l-1.4 1.4M7.5 16.5l-1.4 1.4M17.9 17.9l-1.4-1.4M7.5 7.5 6.1 6.1" />
                        </svg>
                    </span>
                    <span class="nav-label">设置</span>
                </router-link>
            </div>

            <div class="nav-footer">
                <!-- 侧栏折叠开关：窄屏自动折叠后，仍可手动唤回 -->
                <div class="col-toggles" v-if="onKbSection">
                    <button
                        v-hint
                        class="mini-btn"
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
                </div>
                <ThemeToggle />
                <!-- 页面二维码：扫后用手机打开当前页面（所有页面通用） -->
                <button
                    v-hint
                    class="mini-btn"
                    type="button"
                    title="生成二维码，在手机上打开本页"
                    aria-label="生成页面二维码"
                    @click="showQr = true"
                >
                    <svg class="icon icon-sm" viewBox="0 0 24 24" aria-hidden="true">
                        <rect x="3.5" y="3.5" width="7" height="7" rx="1" />
                        <rect x="13.5" y="3.5" width="7" height="7" rx="1" />
                        <rect x="3.5" y="13.5" width="7" height="7" rx="1" />
                        <path d="M14 14v3M14 20.5h.01M17.5 14h3v3h-3zM17.5 20.5h.01M20.5 17.5h.01" />
                    </svg>
                </button>
                <span class="version-tag">
                    <span class="dot"></span>v0.1 MVP
                </span>
            </div>
        </nav>

        <!-- ═══ 栏 2：页面树（仅知识库区块）═══ -->
        <aside v-if="onKbSection" class="sidebar glass-panel page-sidebar" :class="{ 'is-collapsed': pageColHidden }" aria-label="页面">
            <header class="side-head">
                <h2 class="side-title">页面</h2>
                <button v-hint class="icon-btn" type="button" title="新建页面" aria-label="新建页面" @click="createPage">
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

        <!-- ═══ 栏 3：主内容 ═══ -->
        <main class="main-content glass-panel glass-sheen" role="main" ref="mainContentRef">
            <router-view />
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
        <!-- Teleport 到 body：.main-content 上的 backdrop-filter 会创建包含块，
             使 position: fixed 相对该元素而非视口定位，遮罩就只盖住主内容区。 -->
        <Teleport to="body">
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
        </Teleport>

        <!-- 页面二维码（所有页面通用） -->
        <AssetQrDialog
            v-if="showQr"
            mode="page"
            @close="showQr = false"
        />

    </div>
</template>

<script>
import { api } from './api/client.js';
import PageTree from './components/PageTree.vue';
import ThemeToggle from './components/ThemeToggle.vue';
import AssetQrDialog from './components/assets/AssetQrDialog.vue';

const EXPANDED_KEY = 'kb-tree-expanded';

export default {
    name: 'App',
    components: { PageTree, ThemeToggle, AssetQrDialog },
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
            // 响应式折叠（仅页面树一栏）
            pageColHidden: false,
            // 页面二维码弹窗
            showQr: false
        };
    },
    computed: {
        /** 是否处于知识库区块（/kb/*），决定页面树栏是否显示 */
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

        // 任意视图在新增/保存/删除后派发 kb-changed，页面树据此刷新
        this._changeHandler = () => {
            this.loadTree();
        };
        window.addEventListener('kb-changed', this._changeHandler);

        this.applyResponsive();
        window.addEventListener('resize', this.applyResponsive);

        this.loadExpanded();
        this.loadTree();
    },
    beforeUnmount() {
        window.removeEventListener('resize', this.applyResponsive);
        document.removeEventListener('keydown', this.handleKeydown);
        window.removeEventListener('kb-changed', this._changeHandler);
    },
    methods: {
        // ── 响应式：窄屏收起页面树栏 ──
        applyResponsive() {
            // 用 class 而非改 CSS 变量，折叠状态才能由用户手动切换，
            // 不被媒体查询强制覆盖
            this.pageColHidden = window.innerWidth <= 1320;
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

/* 折叠开关与页面树操作共用的小圆钮 */
.mini-btn {
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    padding: 0;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
    transition: background var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);
}
.mini-btn:hover { background: var(--hover-background); color: var(--text-primary); }
.mini-btn:focus-visible {
    outline: none;
    box-shadow: 0 0 0 3px var(--focus-ring);
}
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