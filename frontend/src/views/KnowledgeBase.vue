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
                    <span class="kb-count" v-if="!searchMode">{{ total }} 个文档</span>
                    <span class="kb-count" v-else>搜索「{{ searchQuery }}」· {{ searchTotal }} 条结果</span>
                    <div class="kb-search">
                        <input
                            class="kb-search-input"
                            v-model="searchQuery"
                            type="search"
                            placeholder="搜索标题或正文…"
                            @input="onSearchInput"
                        />
                        <button v-if="searchQuery" class="kb-search-clear" type="button" @click="clearSearch">清除</button>
                    </div>
                    <div class="kb-io">
                        <!-- 导出下拉：json 体积小易读；gz 压缩后约为 1%，适合大库与归档 -->
                        <div class="kb-io-menu" @mouseleave="exportMenu = false">
                            <button class="kb-io-btn" type="button" :disabled="ioBusy !== ''" @click="exportMenu = !exportMenu">
                                {{ ioBusy === 'export' ? '导出中…' : '导出 ▾' }}
                            </button>
                            <div v-if="exportMenu" class="kb-io-dropdown">
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
                        <button class="kb-io-btn" type="button" :disabled="ioBusy !== ''" @click="pickImportFile">
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

                <p v-if="ioMessage" class="kb-io-msg" :class="{ 'kb-io-msg-error': ioError }">{{ ioMessage }}</p>

                <p v-if="loading" class="nt-state">加载中…</p>
                <p v-else-if="error" class="nt-state nt-state-error">{{ error }}</p>
                <p v-else-if="items.length === 0" class="nt-empty">
                    <span class="nt-empty-emoji">🗒️</span>
                    <template v-if="searchMode">未找到与「{{ searchQuery }}」相关的文档。<button class="nt-link" type="button" @click="clearSearch">查看全部文档</button></template>
                    <template v-else>这里还没有文档。点击右上角「新建」开始记录团队知识。</template>
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
                            <span v-if="doc.snippet" class="doc-snippet">{{ doc.snippet }}</span>
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

                <p v-if="searchMode && searchTotal > items.length" class="kb-more">
                    <button class="nt-btn" type="button" @click="loadMoreSearch" :disabled="loading">加载更多</button>
                </p>
            </section>
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
                categories: [],
                catLoading: true,
                selectedCategory: null,
                pages: [],
                tags: [],
                selectedTags: [],
                editingCatId: null,
                editingCatName: '',
                addCatMode: false,
                newCatName: '',
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
            this.exitSearch();
            this.load();
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
                await this.loadCategories();
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
.kb-search {
    display: flex;
    align-items: center;
    gap: 6px;
}
/* 备份导入 / 导出按钮组 */
.kb-io {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-left: 4px;
}
.kb-io-btn {
    padding: 5px 12px;
    font-size: 13px;
    color: var(--color-text);
    background: var(--color-surface);
    border: 1px solid var(--color-border-strong);
    border-radius: 7px;
    cursor: pointer;
}
.kb-io-btn:hover:not(:disabled) {
    border-color: var(--color-focus);
    color: var(--color-focus);
}
.kb-io-btn:disabled {
    opacity: 0.55;
    cursor: not-allowed;
}
.kb-io-file {
    display: none;
}
/* 导出格式下拉 */
.kb-io-menu {
    position: relative;
}
.kb-io-dropdown {
    position: absolute;
    right: 0;
    top: calc(100% + 6px);
    z-index: 30;
    min-width: 268px;
    padding: 4px;
    background: var(--color-surface, #fff);
    border: 1px solid var(--color-border-strong, #d4d3cf);
    border-radius: 10px;
    box-shadow: 0 6px 20px rgba(15, 15, 15, 0.12);
}
.kb-io-dropdown button {
    display: block;
    width: 100%;
    padding: 8px 10px;
    text-align: left;
    background: transparent;
    border: none;
    border-radius: 7px;
    cursor: pointer;
}
.kb-io-dropdown button:hover {
    background: var(--color-surface-muted, #f7f7f5);
}
.dd-title {
    display: block;
    font-size: 13px;
    font-weight: 500;
    color: var(--color-text);
}
.dd-desc {
    display: block;
    margin-top: 2px;
    font-size: 12px;
    line-height: 1.45;
    color: var(--color-text-muted, #787774);
}
.kb-io-msg {
    margin: 0 0 8px;
    padding: 7px 10px;
    font-size: 12.5px;
    line-height: 1.5;
    color: var(--color-success, #1a7f4b);
    background: var(--color-surface-muted, #f2faf5);
    border: 1px solid var(--color-border);
    border-radius: 8px;
}
.kb-io-msg-error {
    color: var(--color-danger, #c0392b);
    background: var(--color-surface-muted, #fdf3f2);
}
.kb-search-input {
    width: 220px;
    max-width: 50vw;
    padding: 5px 10px;
    font-size: 13px;
    border: 1px solid var(--color-border-strong);
    border-radius: 7px;
    background: var(--color-surface);
    color: var(--color-text);
    outline: none;
}
.kb-search-input:focus-visible {
    border-color: var(--color-focus);
    outline: 2px solid var(--color-focus);
    outline-offset: 1px;
}
.kb-search-clear {
    border: none;
    background: none;
    color: var(--color-focus);
    font-size: 12px;
    cursor: pointer;
    padding: 4px 6px;
    border-radius: 5px;
}
.kb-search-clear:hover {
    text-decoration: underline;
}
.doc-snippet {
    font-size: 13px;
    color: var(--color-text-muted);
    line-height: 1.5;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.kb-more {
    text-align: center;
    padding: 14px 0 4px;
}
.nt-link {
    border: none;
    background: none;
    color: var(--color-focus);
    cursor: pointer;
    font-size: 14px;
    padding: 0 2px;
}
.nt-link:hover {
    text-decoration: underline;
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
