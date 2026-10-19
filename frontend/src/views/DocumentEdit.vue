<template>
    <div class="edit-page">
        <div class="edit-container">
            <div class="edit-topbar">
                <button class="nt-ghost" @click="goBack">← 返回</button>
                <div class="edit-top-actions">
                    <button class="nt-btn" :disabled="saving" @click="goBack">取消</button>
                    <button class="nt-btn nt-btn-primary" :disabled="saving" @click="save">
                        {{ saving ? '保存中…' : '保存' }}
                    </button>
                </div>
            </div>

            <div class="edit-head">
                <input
                    id="title"
                    v-model="form.title"
                    class="edit-title"
                    type="text"
                    maxlength="100"
                    placeholder="无标题"
                    @input="onInput"
                />
            </div>

            <div class="edit-meta-row">
                <div class="meta-field">
                    <span class="meta-label">父页面</span>
                    <select
                        id="parent"
                        v-model="form.parent_id"
                        class="nt-select"
                        @change="onInput"
                    >
                        <option :value="null">（顶层页面）</option>
                        <option v-for="p in parentOptions" :key="p.id" :value="p.id">{{ p.label }}</option>
                    </select>
                </div>
                <div class="meta-field">
                    <span class="meta-label">分类</span>
                    <select
                        id="category"
                        v-model="form.category_id"
                        class="nt-select"
                        @change="onInput"
                    >
                        <option :value="null">未分类</option>
                        <option v-for="c in categories" :key="c.id" :value="c.id">{{ c.name }}</option>
                    </select>
                </div>
                <div class="meta-field">
                    <span class="meta-label">标签</span>
                    <input
                        id="tags"
                        v-model="form.tagsText"
                        class="nt-input"
                        type="text"
                        placeholder="逗号分隔，如：前端, 规范"
                        @input="onInput"
                    />
                </div>
            </div>

            <div class="edit-mode-switch" role="tablist" aria-label="编辑模式">
                <button class="mode-btn" :class="{ active: viewMode === 'write' }" @click="viewMode = 'write'">编写</button>
                <button class="mode-btn" :class="{ active: viewMode === 'split' }" @click="viewMode = 'split'">分屏</button>
                <button class="mode-btn" :class="{ active: viewMode === 'preview' }" @click="viewMode = 'preview'">预览</button>
            </div>

            <div class="edit-body" :class="'mode-' + viewMode">
                <p v-if="loadError" class="nt-state nt-state-error">{{ loadError }}</p>

                <template v-else>
                    <div v-show="viewMode !== 'preview'" class="pane pane-write">
                        <textarea
                            v-model="form.content_md"
                            class="md-input"
                            spellcheck="false"
                            placeholder="输入 Markdown 正文…"
                            @input="onInput"
                        ></textarea>
                    </div>
                    <div v-show="viewMode !== 'write'" class="pane pane-preview">
                        <!-- 预览 HTML 由后端 sanitize-html 白名单净化，可安全渲染 -->
                        <div class="markdown-body" v-html="previewHtml"></div>
                    </div>
                </template>
            </div>

            <p v-if="draftRestored" class="draft-notice">
                已恢复此前未保存的草稿。
                <button class="link-btn" @click="clearDraft">放弃草稿</button>
            </p>
            <p v-if="fieldError" class="nt-state nt-state-error">{{ fieldError }}</p>
            <p v-if="conflict" class="conflict-banner">
                文档已在别处被修改（版本冲突）。请选择：
                <button class="nt-btn" @click="loadLatest">加载最新</button>
                <button class="nt-btn nt-btn-danger" @click="confirmOverwrite">基于最新覆盖保存</button>
            </p>
            <p v-if="saveError && !conflict" class="nt-state nt-state-error">{{ saveError }}</p>
            <p v-if="savedOk" class="nt-state nt-state-ok">已保存，正在跳转…</p>
        </div>
    </div>
</template>

<script>
import { api } from '../api/client.js';

export default {
    name: 'DocumentEdit',
    data() {
        return {
            form: { title: '', content_md: '', category_id: null, parent_id: null, tagsText: '' },
            baseVersion: 0,
            categories: [],
            allPages: [],
            loadingDoc: false,
            loadError: '',
            saving: false,
            fieldError: '',
            saveError: '',
            savedOk: false,
            conflict: false,
            conflictCurrent: null,
            previewHtml: '',
            draftRestored: false,
            viewMode: 'split',
            _previewTimer: null,
            _draftTimer: null
        };
    },
    computed: {
        isNew() {
            return this.$route.name === 'kb-new';
        },
        docId() {
            const id = Number(this.$route.params.id);
            return Number.isInteger(id) ? id : null;
        },
        draftKey() {
            return this.isNew ? 'kb-draft-new' : 'kb-draft-edit-' + this.docId;
        },
        /** 可选父页面：按层级缩进；编辑时排除自身及其后代，避免形成环 */
        parentOptions() {
            const rows = this.allPages;
            if (!rows.length) return [];
            const ids = new Set(rows.map((r) => r.id));
            const byParent = new Map();
            rows.forEach((r) => {
                const key = (r.parent_id != null && ids.has(r.parent_id)) ? r.parent_id : 0;
                if (!byParent.has(key)) byParent.set(key, []);
                byParent.get(key).push(r);
            });

            const banned = new Set();
            if (this.docId) {
                banned.add(this.docId);
                const stack = [this.docId];
                while (stack.length) {
                    const cur = stack.pop();
                    (byParent.get(cur) || []).forEach((c) => {
                        if (!banned.has(c.id)) {
                            banned.add(c.id);
                            stack.push(c.id);
                        }
                    });
                }
            }

            const out = [];
            const walk = (parentKey, depth) => {
                (byParent.get(parentKey) || []).forEach((n) => {
                    if (banned.has(n.id)) return;
                    out.push({ id: n.id, label: '\u3000'.repeat(depth) + (n.title || '无标题') });
                    walk(n.id, depth + 1);
                });
            };
            walk(0, 0);
            return out;
        }
    },
    async mounted() {
        await Promise.all([this.loadCategories(), this.loadPages()]);
        if (!this.isNew) {
            await this.loadDoc();
        } else {
            this.loadDraft();
            // 从侧边栏「新建子页面」进入时，父页面以 URL 参数为准
            const parentFromQuery = Number(this.$route.query.parent);
            if (Number.isInteger(parentFromQuery) && parentFromQuery > 0) {
                this.form.parent_id = parentFromQuery;
            }
        }
        this.renderPreview();
    },
    beforeUnmount() {
        clearTimeout(this._previewTimer);
        clearTimeout(this._draftTimer);
    },
    methods: {
        async loadCategories() {
            try {
                const { res, body } = await api.listCategories();
                if (res.ok) this.categories = body || [];
            } catch {
                // 分类加载失败不阻断编辑（分类为可选）
            }
        },
        async loadPages() {
            try {
                const { res, body } = await api.listDocumentTree();
                if (res.ok) this.allPages = (body && body.items) || [];
            } catch {
                // 页面树加载失败不阻断编辑（父页面为可选项）
            }
        },
        async loadDoc() {
            this.loadingDoc = true;
            this.loadError = '';
            try {
                const { res, body } = await api.getDocument(this.docId);
                if (res.status === 404) {
                    this.loadError = '文档不存在或已被删除';
                    return;
                }
                if (!res.ok) throw new Error(body?.message || '加载失败');
                this.form.title = body.title;
                this.form.content_md = body.content_md || '';
                this.form.category_id = (body.category_id === null || body.category_id === undefined)
                    ? null
                    : body.category_id;
                this.form.parent_id = (body.parent_id === null || body.parent_id === undefined)
                    ? null
                    : body.parent_id;
                this.form.tagsText = (body.tags || []).join(', ');
                this.baseVersion = body.version;
                this.loadDraft(); // 若存在未保存草稿则覆盖（草稿优先）
            } catch (e) {
                this.loadError = e.network ? e.message : (e.message || '加载失败');
            } finally {
                this.loadingDoc = false;
            }
        },
        onInput() {
            this.scheduleDraft();
        },
        scheduleDraft() {
            clearTimeout(this._draftTimer);
            this._draftTimer = setTimeout(() => this.persistDraft(), 400);
        },
        persistDraft() {
            try {
                sessionStorage.setItem(this.draftKey, JSON.stringify({
                    ...this.form,
                    baseVersion: this.baseVersion
                }));
            } catch {
                // sessionStorage 不可用时静默忽略（草稿仅为便利）
            }
        },
        loadDraft() {
            try {
                const raw = sessionStorage.getItem(this.draftKey);
                if (!raw) return;
                const d = JSON.parse(raw);
                this.form = {
                    title: d.title ?? '',
                    content_md: d.content_md ?? '',
                    category_id: (d.category_id === null || d.category_id === undefined)
                        ? null
                        : d.category_id,
                    parent_id: (d.parent_id === null || d.parent_id === undefined)
                        ? null
                        : d.parent_id,
                    tagsText: d.tagsText ?? ''
                };
                this.baseVersion = d.baseVersion || 0;
                this.draftRestored = true;
            } catch {
                // 草稿损坏则忽略
            }
        },
        clearDraft() {
            try {
                sessionStorage.removeItem(this.draftKey);
            } catch { /* noop */ }
            this.draftRestored = false;
        },
        schedulePreview() {
            clearTimeout(this._previewTimer);
            this._previewTimer = setTimeout(() => this.renderPreview(), 300);
        },
        async renderPreview() {
            try {
                const { res, body } = await api.renderMarkdown(this.form.content_md || '');
                this.previewHtml = res.ok ? (body && body.html || '') : '';
            } catch {
                this.previewHtml = '';
            }
        },
        buildTags() {
            return this.form.tagsText
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean);
        },
        async save() {
            this.saving = true;
            this.fieldError = '';
            this.saveError = '';
            this.savedOk = false;
            this.conflict = false;

            const payload = {
                title: this.form.title,
                content_md: this.form.content_md,
                category_id: this.form.category_id,
                parent_id: this.form.parent_id,
                tags: this.buildTags()
            };
            if (!this.isNew) payload.version = this.baseVersion;

            try {
                const { res, body } = this.isNew
                    ? await api.createDocument(payload)
                    : await api.updateDocument(this.docId, payload);

                if (res.status === 400) {
                    this.fieldError = (body && body.message) || '输入有误，请检查标题与正文（标题不能为空）';
                    return;
                }
                if (res.status === 409) {
                    this.conflict = true;
                    this.conflictCurrent = (body && body.current) || null;
                    return;
                }
                if (!res.ok) throw new Error((body && body.message) || '保存失败');

                // 保存成功：清除草稿并跳转详情
                this.clearDraft();
                this.savedOk = true;
                window.dispatchEvent(new Event('kb-changed'));
                const id = this.isNew ? body.id : this.docId;
                this.$router.replace({ name: 'kb-detail', params: { id } });
            } catch (e) {
                this.saveError = e.network ? e.message : (e.message || '保存失败，请稍后重试');
            } finally {
                this.saving = false;
            }
        },
        loadLatest() {
            const c = this.conflictCurrent;
            if (!c) {
                this.conflict = false;
                return;
            }
            this.form.title = c.title;
            this.form.content_md = c.content_md || '';
            this.form.category_id = (c.category_id === null || c.category_id === undefined)
                ? null
                : c.category_id;
            this.form.parent_id = (c.parent_id === null || c.parent_id === undefined)
                ? null
                : c.parent_id;
            this.form.tagsText = (c.tags || []).join(', ');
            this.baseVersion = c.version;
            this.conflict = false;
            this.conflictCurrent = null;
            this.persistDraft();
            this.renderPreview();
        },
        async confirmOverwrite() {
            if (!window.confirm('将基于服务端最新内容覆盖保存，本地未保存的修改会丢失。确定继续？')) return;
            const c = this.conflictCurrent;
            if (!c) return;
            // 以服务端最新版本为基准覆盖写入
            this.baseVersion = c.version;
            this.conflict = false;
            this.conflictCurrent = null;
            await this.save();
        },
        goBack() {
            if (this.isNew) {
                this.$router.push({ name: 'kb-list' });
            } else {
                this.$router.push({ name: 'kb-detail', params: { id: this.docId } });
            }
        }
    },
    watch: {
        'form.content_md'() {
            this.schedulePreview();
        }
    }
};
</script>

<style scoped>
.edit-page {
    min-height: 100vh;
}
.edit-container {
    max-width: 860px;
    margin: 0 auto;
    padding: 28px 48px 96px;
}
.edit-topbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 22px;
}
.edit-top-actions {
    display: flex;
    gap: 8px;
}

/* 标题（Notion 式无边框大标题） */
.edit-head {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    margin-top: 8px;
}
.edit-title {
    flex: 1;
    border: none;
    outline: none;
    background: transparent;
    font-size: 38px;
    font-weight: 700;
    color: var(--color-text);
    padding: 0;
    line-height: 1.2;
    letter-spacing: -0.01em;
}
.edit-title::placeholder {
    color: var(--color-text-faint);
}

/* 元信息行 */
.edit-meta-row {
    display: flex;
    flex-wrap: wrap;
    gap: 20px;
    margin: 18px 0 14px;
    padding-bottom: 14px;
    border-bottom: 1px solid var(--color-border);
}
.meta-field {
    display: flex;
    align-items: center;
    gap: 8px;
}
.meta-label {
    font-size: 13px;
    color: var(--color-text-muted);
}
.nt-select,
.nt-input {
    border: 1px solid var(--color-border);
    border-radius: 6px;
    padding: 5px 9px;
    font-size: 14px;
    background: var(--color-surface);
    color: var(--color-text);
}
.nt-select:focus-visible,
.nt-input:focus-visible {
    outline: 2px solid var(--color-focus);
    outline-offset: 1px;
}
.nt-input {
    min-width: 200px;
}

/* 模式切换 */
.edit-mode-switch {
    display: inline-flex;
    gap: 2px;
    background: var(--color-sidebar-bg);
    border-radius: 8px;
    padding: 3px;
    margin-bottom: 14px;
}
.mode-btn {
    border: none;
    background: none;
    color: var(--color-text-muted);
    font-size: 13px;
    padding: 5px 14px;
    border-radius: 6px;
    cursor: pointer;
    transition: background 0.12s, color 0.12s;
}
.mode-btn:hover {
    color: var(--color-text);
}
.mode-btn.active {
    background: var(--color-surface);
    color: var(--color-text);
    box-shadow: 0 1px 2px rgba(15, 15, 15, 0.08);
}

/* 编辑区 */
.edit-body.mode-split {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0;
    border: 1px solid var(--color-border);
    border-radius: 8px;
    overflow: hidden;
}
.pane {
    min-height: 420px;
}
.pane-write {
    border-right: 1px solid var(--color-border);
}
.md-input {
    width: 100%;
    height: 100%;
    min-height: 420px;
    border: none;
    outline: none;
    resize: none;
    padding: 18px;
    background: var(--color-surface);
    color: var(--color-text);
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 14px;
    line-height: 1.7;
}
.pane-preview {
    padding: 18px;
    background: var(--color-surface);
    overflow: auto;
    max-height: 640px;
}

/* 通知 */
.draft-notice {
    font-size: 13px;
    color: #92691a;
    background: #fbf3df;
    border: 1px solid #f3e2b8;
    border-radius: 6px;
    padding: 8px 12px;
    margin: 16px 0 0;
}
.link-btn {
    background: none;
    border: none;
    color: var(--color-focus);
    cursor: pointer;
    font-size: 13px;
    text-decoration: underline;
    padding: 0 4px;
}
.nt-state {
    padding: 12px 14px;
    border-radius: 6px;
    font-size: 14px;
    margin: 16px 0 0;
}
.nt-state-error {
    color: var(--color-danger);
    border: 1px solid #f3c9c9;
    background: #fdecec;
}
.nt-state-ok {
    color: #1e7a46;
    border: 1px solid #bfe6cd;
    background: #ecf8f0;
}
.conflict-banner {
    padding: 12px 14px;
    border-radius: 6px;
    font-size: 14px;
    color: #92691a;
    border: 1px solid #f3e2b8;
    background: #fbf3df;
    margin: 16px 0 0;
}
.conflict-banner .nt-btn {
    margin-left: 8px;
}

/* 按钮（Notion 风格） */
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
.nt-btn-primary {
    background: var(--color-focus);
    color: #fff;
    border-color: var(--color-focus);
}
.nt-btn-primary:hover {
    background: #1a6fc4;
}
.nt-btn-danger {
    background: var(--color-danger);
    color: #fff;
    border-color: var(--color-danger);
}
.nt-btn-danger:hover {
    background: #d64545;
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

@media (max-width: 768px) {
    .edit-container {
        padding: 20px 18px 64px;
    }
    .edit-title {
        font-size: 30px;
    }
    .edit-body.mode-split {
        grid-template-columns: 1fr;
    }
    .pane-write {
        border-right: none;
        border-bottom: 1px solid var(--color-border);
    }
}
</style>
