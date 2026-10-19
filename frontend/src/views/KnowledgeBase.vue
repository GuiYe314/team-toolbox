<template>
    <div class="kb-page">
        <!-- ═══ 内容区页头：标题 + 主操作 ═══ -->
        <header class="kb-head">
            <div class="kb-head-text">
                <h1 class="kb-title">知识库</h1>
                <p class="kb-desc">
                    {{ searchMode ? `搜索「${searchQuery}」· ${searchTotal} 条结果` : `${total} 个团队文档` }}
                </p>
            </div>
            <button class="btn btn-primary" @click="goNew">
                <svg class="icon icon-sm" viewBox="0 0 24 24" aria-hidden="true">
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                新建
            </button>
        </header>

        <!-- ═══ 工具栏：搜索 + 导入导出 ═══ -->
        <div class="kb-toolbar">
            <div class="kb-search">
                <span class="kb-search-icon">
                    <svg class="icon icon-sm" viewBox="0 0 24 24" aria-hidden="true">
                        <circle cx="11" cy="11" r="6.5" />
                        <line x1="16" y1="16" x2="20.5" y2="20.5" />
                    </svg>
                </span>
                <input
                    class="input kb-search-input"
                    v-model="searchQuery"
                    type="search"
                    placeholder="搜索标题或正文…"
                    @input="onSearchInput"
                />
                <button v-if="searchQuery" class="kb-search-clear" type="button" @click="clearSearch">
                    <svg class="icon icon-sm" viewBox="0 0 24 24" aria-hidden="true">
                        <line x1="6" y1="6" x2="18" y2="18" />
                        <line x1="18" y1="6" x2="6" y2="18" />
                    </svg>
                </button>
            </div>

            <div class="kb-io">
                <!-- 导出下拉：json 体积小易读；gz 压缩后约为 1%，适合大库与归档 -->
                <div class="kb-io-menu" @mouseleave="exportMenu = false">
                    <button class="btn btn-sm" type="button" :disabled="ioBusy !== ''" @click="exportMenu = !exportMenu">
                        <svg class="icon icon-sm" viewBox="0 0 24 24" aria-hidden="true">
                            <path d="M12 3.5v11" />
                            <polyline points="7.5 10.5 12 15 16.5 10.5" />
                            <path d="M4.5 16.5v2A2.5 2.5 0 0 0 7 21h10a2.5 2.5 0 0 0 2.5-2.5v-2" />
                        </svg>
                        {{ ioBusy === 'export' ? '导出中…' : '导出' }}
                        <svg class="icon icon-sm kb-caret" :class="{ open: exportMenu }" viewBox="0 0 24 24" aria-hidden="true">
                            <polyline points="6 9.5 12 15.5 18 9.5" />
                        </svg>
                    </button>
                    <div v-if="exportMenu" class="dropdown kb-io-dropdown">
                        <button type="button" @click="doExport('json')">
                            <span class="dd-title">JSON 文件（.json）</span>
                            <span class="dd-desc">体积与数据库相当，内容可直接阅读</span>
                        </button>
                        <button type="button" @click="doExport('gzip')">
                            <span class="dd-title">压缩文件（.json.gz）</span>
                            <span class="dd-desc">体积约为 JSON 的 1%，推荐用于备份归档</span>
                        </button>
                    </div>
                </div>
                <button class="btn btn-sm" type="button" :disabled="ioBusy !== ''" @click="pickImportFile">
                    <svg class="icon icon-sm" viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M12 15.5v-11" />
                        <polyline points="7.5 8.5 12 4 16.5 8.5" />
                        <path d="M4.5 16.5v2A2.5 2.5 0 0 0 7 21h10a2.5 2.5 0 0 0 2.5-2.5v-2" />
                    </svg>
                    {{ ioBusy === 'import' ? '导入中…' : '导入' }}
                </button>
                <input
                    ref="fileInput"
                    class="kb-io-file"
                    type="file"
                    accept="application/json,.json,.gz,application/gzip"
                    @change="onImportFile"
                />
            </div>
        </div>

        <!-- ═══ 标签筛选（按标签 AND 过滤）═══ -->
        <div class="kb-tag-filter" v-if="tags.length">
            <button
                v-for="t in tags"
                :key="t.id"
                class="tag"
                :class="{ 'is-active': selectedTags.includes(t.name) }"
                @click="toggleTag(t.name)"
            >#{{ t.name }}</button>
            <button class="btn btn-sm btn-ghost kb-clear-filter" v-if="selectedTags.length" @click="clearTagFilter">
                清除筛选
            </button>
        </div>

        <div v-if="ioMessage" class="notice kb-io-msg" :class="ioError ? 'notice-error' : 'notice-success'">
            {{ ioMessage }}
        </div>

        <div class="scroll-area kb-scroll">
        <p v-if="loading" class="empty-hint">加载中…</p>
        <p v-else-if="error" class="empty-hint kb-error">{{ error }}</p>
        <div v-else-if="items.length === 0" class="kb-empty">
            <svg class="icon icon-lg kb-empty-icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4 4.5h6.5a2 2 0 0 1 2 2V20a1.6 1.6 0 0 0-1.6-1.5H4z" />
                <path d="M20 4.5h-6.5a2 2 0 0 0-2 2V20a1.6 1.6 0 0 1 1.6-1.5H20z" />
            </svg>
            <p v-if="searchMode">未找到与「{{ searchQuery }}」相关的文档。<button class="nt-link" type="button" @click="clearSearch">查看全部文档</button></p>
            <p v-else>这里还没有文档。点击右上角「新建」开始记录团队知识。</p>
        </div>

        <ul v-else class="doc-list">
            <li
                v-for="doc in items"
                :key="doc.id"
                class="doc-row"
                tabindex="0"
                @click="goDetail(doc.id)"
                @keyup.enter="goDetail(doc.id)"
            >
                <span class="doc-icon-wrap">
                    <DocIcon :size="18" />
                </span>
                <div class="doc-main">
                    <span class="doc-title">{{ doc.title }}</span>
                    <span v-if="doc.snippet" class="doc-snippet">{{ doc.snippet }}</span>
                </div>
                <div class="doc-meta">
                    <span v-if="doc.category_name" class="tag tag-static">{{ doc.category_name }}</span>
                    <span v-for="t in (doc.tags || [])" :key="t" class="tag tag-static">#{{ t }}</span>
                </div>
                <span class="doc-time">{{ formatTime(doc.updated_at) }}</span>
                <div class="doc-actions">
                    <button class="mini-btn" type="button" title="编辑" aria-label="编辑文档" @click.stop="goEdit(doc.id)">
                        <svg class="icon icon-sm" viewBox="0 0 24 24" aria-hidden="true">
                            <path d="M12 20h9" />
                            <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7.5 18.5l-4 1 1-4z" />
                        </svg>
                    </button>
                </div>
            </li>
        </ul>

        <div v-if="searchMode && searchTotal > items.length" class="kb-more">
            <button class="btn" type="button" @click="loadMoreSearch" :disabled="loading">加载更多</button>
        </div>
        </div>
    </div>
</template>

<script>
import { api } from '../api/client.js';
import DocIcon from '../components/DocIcon.vue';

/**
 * 解压 gzip 为字符串。使用浏览器内置 DecompressionStream，避免引入解压库。
 * 不支持时抛出带 __isGzip 标记的错误，便于上层给出准确提示。
 * @param {ArrayBuffer} buf
 * @returns {Promise<string>}
 */
async function gunzip(buf) {
    if (typeof DecompressionStream === 'undefined') {
        const err = new Error('当前浏览器不支持自动解压');
        err.__isGzip = true;
        throw err;
    }
    try {
        const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'));
        return await new Response(stream).text();
    } catch (err) {
        const e = new Error('gzip 解压失败');
        e.__isGzip = true;
        throw e;
    }
}

export default {
    name: 'KnowledgeBase',
    components: { DocIcon },
    data() {
        return {
            items: [],
            total: 0,
            loading: true,
            error: '',
            pages: [],
            tags: [],
            selectedTags: [],
            // 搜索（F-KB-006）
            searchQuery: '',
            searchMode: false,
            searchTotal: 0,
            searchTimer: null,
            // 备份导入 / 导出（F-KB-007、F-OPS-002）
            ioBusy: '',
            ioMessage: '',
            ioError: false,
            exportMenu: false
        };
    },
    async mounted() {
        this._onExternalChange = () => {
            this.loadPageMap();
            this.load();
        };
        window.addEventListener('kb-changed', this._onExternalChange);
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
                // 页面树加载失败不影响列表
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
        // ── 标签筛选（F-KB-005）──
        toggleTag(name) {
            const i = this.selectedTags.indexOf(name);
            if (i >= 0) this.selectedTags.splice(i, 1);
            else this.selectedTags.push(name);
            this.exitSearch();
            this.load();
        },
        clearTagFilter() {
            this.selectedTags = [];
            this.exitSearch();
            this.load();
        },
        // ── 搜索（F-KB-006）──
        onSearchInput() {
            // 防抖：停止输入 300ms 后发起搜索；空关键词回到普通列表
            if (this.searchTimer) clearTimeout(this.searchTimer);
            this.searchTimer = setTimeout(() => {
                const q = this.searchQuery.trim();
                if (!q) {
                    this.exitSearch();
                    this.load();
                } else {
                    this.searchMode = true;
                    this.doSearch(0);
                }
            }, 300);
        },
        async doSearch(offset) {
            if (!this.searchMode) return;
            this.loading = true;
            this.error = '';
            try {
                const { res, body } = await api.search(this.searchQuery.trim(), { limit: 20, offset });
                if (!res.ok) throw new Error(body?.message || '搜索失败');
                const list = (body && body.items) || [];
                this.searchTotal = (body && typeof body.total === 'number') ? body.total : list.length;
                if (offset > 0) this.items = this.items.concat(list);
                else this.items = list;
            } catch (e) {
                this.error = e.network ? e.message : (e.message || '搜索失败');
            } finally {
                this.loading = false;
            }
        },
        loadMoreSearch() {
            this.doSearch(this.items.length);
        },
        clearSearch() {
            this.searchQuery = '';
            this.exitSearch();
            this.load();
        },
        exitSearch() {
            this.searchMode = false;
            this.searchTotal = 0;
        },
        // ── 备份导入 / 导出（F-KB-007、F-OPS-002）──
        // 注意：ioBusy 用空字符串表示“空闲”，绑定 :disabled 时必须显式比较，
        // 不能直接写 :disabled="ioBusy"——Vue 3 中空字符串为真，会让按钮永久禁用。
        // 导出：拉取全量快照 → 转 Blob → 触发本地下载，不经过服务端文件落盘
        // format='json' 为可读明文；'gzip' 保存**服务端压缩后的原始字节**。
        // 注意：fetch 会自动解压 Content-Encoding: gzip 的响应体，
        // 因此 gz 分支改用 arrayBuffer 拿原始压缩流再自行打包，否则会存出「假 gz」。
        async doExport(format = 'json') {
            if (this.ioBusy !== '') return;
            this.exportMenu = false;
            this.ioBusy = 'export';
            this.ioMessage = '';
            try {
                let blob;
                let counts = {};
                if (format === 'gzip') {
                    const res = await fetch('/api/backup/export?format=gz');
                    if (!res.ok) throw new Error('导出失败');
                    const buf = await res.arrayBuffer();   // 原始 gzip 字节
                    blob = new Blob([buf], { type: 'application/gzip' });
                } else {
                    const { res, body } = await api.exportBackup();
                    if (!res.ok) throw new Error((body && body.message) || '导出失败');
                    counts = (body && body.counts) || {};
                    blob = new Blob([JSON.stringify(body, null, 2)], { type: 'application/json' });
                }
                const url = URL.createObjectURL(blob);
                const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
                const ext = format === 'gzip' ? '.json.gz' : '.json';
                const a = document.createElement('a');
                a.href = url;
                a.download = `team-toolbox-backup-${stamp}${ext}`;
                document.body.appendChild(a);
                a.click();
                a.remove();
                // 立即 revoke 会让部分浏览器下载中断，延后释放
                setTimeout(() => URL.revokeObjectURL(url), 10000);
                this.ioError = false;
                const sizeKb = (blob.size / 1024).toFixed(1);
                this.ioMessage = format === 'gzip'
                    ? `已导出压缩包（${sizeKb} KB）：全部分类与页面。导入时直接选择该 .gz 文件即可。`
                    : `已导出 ${counts.documents || 0} 个文档、${counts.categories || 0} 个分类（${sizeKb} KB）。`;
                if (format !== 'gzip' && (counts.documents || 0) > 500) {
                    this.ioMessage += ' 数据量较大，可改用「导出 ▾ → 压缩文件」以显著减小体积。';
                }
            } catch (e) {
                this.ioError = true;
                this.ioMessage = e.message === '导出失败'
                    ? '导出失败，请稍后重试'
                    : (e.message || '导出失败，请稍后重试');
            } finally {
                this.ioBusy = '';
            }
        },
        // 导入：选择本地备份文件
        pickImportFile() {
            if (this.ioBusy !== '') return;
            if (this.$refs.fileInput) this.$refs.fileInput.click();
        },
        async onImportFile(e) {
            const file = e.target && e.target.files && e.target.files[0];
            // 每次处理完都清空 value，保证同一个文件可再次选择
            if (e.target) e.target.value = '';
            if (!file) return;

            let snapshot;
            try {
                const buf = await file.arrayBuffer();
                // 按魔数判断而非扩展名：文件可能被改名，也可能扩展名是 .json 但内容其实是 gzip
                const isGzip = buf.byteLength > 2 && new Uint8Array(buf)[0] === 0x1f && new Uint8Array(buf)[1] === 0x8b;
                const text = isGzip ? await gunzip(buf) : new TextDecoder().decode(buf);
                snapshot = JSON.parse(text);
            } catch (err) {
                this.ioError = true;
                this.ioMessage = err && err.__isGzip
                    ? '压缩文件已损坏或格式不正确，无法解压。'
                    : '备份文件不是合法的 JSON，请选择由本页导出的 .json 或 .json.gz 文件。';
                return;
            }
            if (!snapshot || !Array.isArray(snapshot.documents)) {
                this.ioError = true;
                this.ioMessage = '备份文件缺少 documents 字段，可能不是本工具导出的备份。';
                return;
            }
            const n = snapshot.documents.length;
            if (!window.confirm(`即将导入 ${n} 个页面（合并模式，不会删除现有数据）。\n同父级下同名页面会自动跳过。是否继续？`)) {
                return;
            }

            this.ioBusy = 'import';
            this.ioMessage = '';
            try {
                const { res, body } = await api.importBackup(snapshot);
                if (!res.ok) throw new Error((body && body.message) || '导入失败');
                this.ioError = false;
                this.ioMessage = `导入完成：新增 ${body.imported || 0} 个页面，跳过 ${body.skipped || 0} 个已存在页面，新建 ${body.categories_created || 0} 个分类。`;
                // 通知页面树、分类、标签与详情页刷新
                await this.loadTags();
                await this.loadPageMap();
                this.load();
                window.dispatchEvent(new Event('kb-changed'));
            } catch (e) {
                this.ioError = true;
                this.ioMessage = e.network ? e.message : (e.message || '导入失败，请稍后重试');
            } finally {
                this.ioBusy = '';
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
</script><style scoped>
/* ==========================================================================
   知识库内容区
   布局职责：MainContent 已是玻璃容器，本视图只负责内部纵向节奏。
   左侧「页面树」与「分类」已提升为App.vue 的第二、三栏，此处不再重复。
   所有颜色一律走 tokens/theme 变量，禁止硬编码。
   ========================================================================== */

.kb-page {
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 26px 28px 22px;
    min-height: 0;
    height: 100%;
}

/* ── 页头 ────────────────────────────────────────────────────────── */
.kb-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
}
.kb-title {
    margin: 0;
    font-size: var(--text-page-title);
    font-weight: var(--weight-bold);
    letter-spacing: -0.015em;
    color: var(--text-primary);
}
.kb-desc {
    margin: 5px 0 0;
    font-size: var(--text-secondary);
    color: var(--text-tertiary);
}

/* ── 工具栏 ──────────────────────────────────────────────────────── */
.kb-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 14px;
    flex-wrap: wrap;
}
.kb-search {
    position: relative;
    display: flex;
    align-items: center;
    flex: 1;
    max-width: 420px;
    min-width: 200px;
}
.kb-search-icon {
    position: absolute;
    left: 11px;
    display: grid;
    place-items: center;
    color: var(--text-tertiary);
    pointer-events: none;
}
.kb-search-input {
    width: 100%;
    padding-left: 34px;
    padding-right: 32px;
}
.kb-search-input::-webkit-search-cancel-button { display: none; }
.kb-search-clear {
    position: absolute;
    right: 6px;
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    border: none;
    border-radius: var(--radius-pill);
    background: transparent;
    color: var(--text-tertiary);
    cursor: pointer;
    transition: background var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);
}
.kb-search-clear:hover { background: var(--hover-background); color: var(--text-primary); }

.kb-io { display: flex; align-items: center; gap: 8px; }
.kb-io-file { display: none; }
.kb-io-menu { position: relative; }
.kb-io-dropdown {
    right: 0;
    top: calc(100% + 8px);
    min-width: 268px;
}
.kb-io-dropdown .dd-title {
    display: block;
    font-size: var(--text-body);
    font-weight: var(--weight-semibold);
}
.kb-io-dropdown .dd-desc {
    display: block;
    margin-top: 2px;
    font-size: var(--text-secondary);
    line-height: var(--line-tight);
    color: var(--text-tertiary);
}
/* 下拉箭头随展开旋转 180°，180ms 内完成，无弹跳 */
.kb-caret { transition: transform var(--dur-base) var(--ease-out); }
.kb-caret.open { transform: rotate(180deg); }

.kb-io-msg { flex: none; }

/* ── 标签筛选 ────────────────────────────────────────────────────── */
.kb-tag-filter {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 7px;
}
.kb-clear-filter { color: var(--text-tertiary); }

/* ── 列表滚动区 ──────────────────────────────────────────────────── */
.kb-scroll {
    flex: 1;
    min-height: 0;
    margin: 0 -6px;
    padding: 0 6px 6px;
}
.kb-error { color: var(--danger); }

/* ── 空状态 ──────────────────────────────────────────────────────── */
.kb-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    min-height: 260px;
    padding: 40px 20px;
    text-align: center;
    font-size: var(--text-body);
    line-height: var(--line-relaxed);
    color: var(--text-tertiary);
}
.kb-empty p { margin: 0; }
.kb-empty-icon { color: var(--text-tertiary); opacity: 0.65; }

.nt-link {
    border: none;
    background: none;
    color: var(--accent);
    cursor: pointer;
    font-size: inherit;
    padding: 0 2px;
}
.nt-link:hover { text-decoration: underline; }

/* ── 文档行 ──────────────────────────────────────────────────────── */
/* 五列 Grid：图标 / 标题+摘要 / 分类标签 / 时间 / 操作。
   用 Grid 而非 Flex，保证时间戳右对齐成一条竖线，扫读更稳。*/
.doc-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
}
.doc-row {
    display: grid;
    grid-template-columns: 28px minmax(200px, 1fr) auto 104px 30px;
    align-items: center;
    gap: 12px;
    min-height: 52px;
    padding: 7px 10px;
    border-radius: var(--radius-md);
    border: 1px solid transparent;
    background: var(--panel-background);
    cursor: pointer;
    transition: background var(--dur-base) var(--ease-out),
                border-color var(--dur-base) var(--ease-out),
                transform var(--dur-base) var(--ease-out);
}
.doc-row:hover {
    background: var(--panel-background-hover);
    border-color: var(--panel-border);
    /* 极轻微上浮 1px：提供「可点」的反馈，但不做明显缩放 */
    transform: translateY(-1px);
}
.doc-row:focus-visible {
    outline: none;
    border-color: var(--accent-border);
    box-shadow: 0 0 0 3px var(--focus-ring);
}

.doc-icon-wrap {
    display: grid;
    place-items: center;
    color: var(--text-tertiary);
}
.doc-main {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
}
.doc-title {
    font-size: var(--text-doc-title);
    font-weight: var(--weight-semibold);
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.doc-snippet {
    font-size: var(--text-secondary);
    color: var(--text-tertiary);
    line-height: var(--line-tight);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
/* 标签区放不下时截断，不换行挤压标题 */
.doc-meta {
    display: flex;
    align-items: center;
    gap: 6px;
    max-width: 260px;
    overflow: hidden;
    flex-wrap: nowrap;
}
.doc-time {
    font-size: var(--text-secondary);
    color: var(--text-tertiary);
    font-variant-numeric: tabular-nums;
    text-align: right;
    white-space: nowrap;
}
.doc-actions {
    display: flex;
    justify-content: flex-end;
    opacity: 0;
    transition: opacity var(--dur-base) var(--ease-out);
}
.doc-row:hover .doc-actions,
.doc-row:focus-within .doc-actions { opacity: 1; }
.mini-btn {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
    transition: background var(--dur-fast) var(--ease-out),
                color var(--dur-fast) var(--ease-out);
}
.mini-btn:hover { background: var(--hover-background); color: var(--text-primary); }
.mini-btn:focus-visible {
    outline: none;
    border-color: var(--accent-border);
    box-shadow: 0 0 0 3px var(--focus-ring);
}

.kb-more {
    display: flex;
    justify-content: center;
    padding: 16px 0 6px;
}

/* ── 响应式：窄屏优先牺牲标签区，再牺牲时间列 ────────────────────── */
@media (max-width: 1500px) {
    .doc-row { grid-template-columns: 28px minmax(160px, 1fr) auto 30px; }
    .doc-time { display: none; }
}
@media (max-width: 1340px) {
    .doc-row { grid-template-columns: 28px minmax(140px, 1fr) 30px; }
    .doc-meta { display: none; }
    .kb-page { padding: 22px 20px 18px; }
}
</style>
