<template>
    <div class="view-page edit-page">
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
                            placeholder="逗号分隔，如：前端, 规范（英文自动小写、去重）"
                            title="多个标签用逗号分隔；保存时英文自动转为小写并去重，单篇最多 10 个"
                            @input="onInput"
                        />
                </div>
            </div>

            <div class="edit-mode-switch" role="tablist" aria-label="编辑模式">
                <!-- Vditor 是所见即所得编辑器，本身即渲染效果，
                     故不再需要 textarea+预览的「分屏」模式，只保留编写/预览切换。 -->
                <button class="mode-btn" :class="{ active: viewMode === 'write' }" @click="viewMode = 'write'">编写</button>
                <button class="mode-btn" :class="{ active: viewMode === 'preview' }" @click="viewMode = 'preview'">预览</button>
                <!-- 图片工具：选文件上传，或直接 Ctrl+V 粘贴剪贴板截图 -->
                <button
                    v-hint
                    class="mode-btn mode-btn-tool"
                    type="button"
                    :disabled="uploading"
                    :title="uploading ? '正在上传图片…' : '插入图片（也可直接粘贴截图或拖入图片）'"
                    @click="pickImage"
                >{{ uploading ? '上传中…' : '插入图片' }}</button>
                <!-- 资源引用：从资源库选一个资源插入正文 -->
                <button
                    v-hint
                    class="mode-btn mode-btn-tool"
                    type="button"
                    title="从资源库插入资源引用"
                    @click="showAssetPicker = true"
                >插入资源</button>
                <!-- 语法速查：写正文时随手可查 -->
                <MarkdownHelp compact />
                <input
                    ref="imageInput"
                    class="image-input-hidden"
                    type="file"
                    accept="image/png,image/jpeg,image/gif,image/webp,image/bmp,image/avif"
                    @change="onImageSelected"
                />
            </div>
            <p v-if="imageError" class="nt-state nt-state-error image-tip">{{ imageError }}</p>

            <div class="edit-body" :class="'mode-' + viewMode">
                <p v-if="loadError" class="nt-state nt-state-error">{{ loadError }}</p>

                <template v-else>
                    <!-- 编写态：Vditor 所见即所得编辑器（sv 模式） -->
                    <div v-show="viewMode !== 'preview'" class="pane pane-write">
                        <MarkdownEditor
                            ref="mdEditor"
                            v-model="form.content_md"
                            :uploading="uploading"
                            @image-error="imageError = $event"
                        />
                    </div>
                    <!-- 预览态：仍走后端 sanitize-html 白名单净化，与阅读页一致 -->
                    <div v-show="viewMode !== 'write'" class="pane pane-preview">
                        <MarkdownBody :html="previewHtml" />
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

        <!-- 资源引用选择器（从资源库选资源插入正文） -->
        <AssetReferencePicker
            v-if="showAssetPicker"
            @close="showAssetPicker = false"
            @pick="onAssetPicked"
        />
    </div>
</template>

<script>
import { api } from '../api/client.js';
import MarkdownHelp from '../components/MarkdownHelp.vue';
import MarkdownEditor from '../components/MarkdownEditor.vue';
import MarkdownBody from '../components/MarkdownBody.vue';
import AssetReferencePicker from '../components/assets/AssetReferencePicker.vue';

export default {
    name: 'DocumentEdit',
    components: { MarkdownHelp, MarkdownEditor, MarkdownBody, AssetReferencePicker },
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
            viewMode: 'write',
            uploading: false,
            imageError: '',
            /** 资源引用选择器是否打开 */
            showAssetPicker: false,
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
        // Vditor 实例是异步创建的（要等脚本与3.7MB lute 内核加载完），
        // 所以把已加载的内容推进编辑器必须排到 nextTick 之后。
        // 组件内部会先把内容排队，等实例 ready 后补灌。
        this.$nextTick(() => this.syncEditorContent());
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
        // ── 图片插入（TASK-012）──
        // 三种入口：工具栏按钮选文件、Ctrl+V 粘贴剪贴板截图、直接拖拽到编辑区。
        // 统一走 uploadImage → 在光标处插入 Markdown 图片语法。
        pickImage() {
            if (this.uploading) return;
            if (this.$refs.imageInput) this.$refs.imageInput.click();
        },
        onImageSelected(e) {
            const file = e.target && e.target.files && e.target.files[0];
            if (e.target) e.target.value = '';   // 允许重复选择同一文件
            if (file) this.uploadImage(file);
        },
        // 注：粘贴截图与拖拽入图改由 Vditor 内置处理（MarkdownEditor 的
        // uploadPaste / upload 回调），无需在此再接一遍 DOM 事件。
        async uploadImage(file) {
            if (this.uploading) return;
            this.uploading = true;
            this.imageError = '';
            try {
                const { res, body } = await api.uploadImage(file);
                if (!res.ok) throw new Error((body && body.message) || '图片上传失败');
                // 文件名去掉扩展名作为 alt，更有助于无障碍阅读
                const alt = (file.name || '').replace(/\.[^.]+$/, '');
                this.insertAtCursor(`\n![${alt}](${body.url})\n`);
            } catch (err) {
                this.imageError = err.network ? err.message : (err.message || '图片上传失败，请稍后重试');
            } finally {
                this.uploading = false;
            }
        },
        /**
         * 在编辑器光标处插入文本。
         * 委托给 MarkdownEditor 内部的 vditor.insertValue，
         * 由它管理选区；拿不到实例时退化为追加到末尾。
         */
        insertAtCursor(text) {
            const ed = this.$refs.mdEditor;
            if (ed && typeof ed.insertAtCursor === 'function') {
                ed.insertAtCursor(text);
                this.scheduleDraft();
                return;
            }
            this.form.content_md = (this.form.content_md || '') + text;
        },
        /**
         * 插入资源引用。
         *
         * 生成的是**标准 Markdown 图片语法**：
         *   ![资源名](/api/assets/files/<资产id>/<kind>/auto)
         *
         * 为什么用标准语法而不是自定义标记：
         *   1. 服务端渲染零改动 —— sanitize-html 白名单已放行 img，
         *      不需要为引用引入新的解析路径；
         *   2. Vditor 里直接显示成图片，所见即所得；
         *   3. 纯文本可读、可手改、可粘到别处，语义不依赖本工具。
         *
         * kind 的选择：图片用 preview（缩略后的预览图，避免正文里塞几百 MB 的原图），
         * 其他类型用 original（模型、纹理等本就是要下载使用的）。
         *
         * pointer 用 auto：有发布版就用发布版，没有则退回最新版 ——
         * 资源发布新版后，文档里的引用自动跟进到正式版。
         */
        onAssetPicked(a) {
            this.showAssetPicker = false;
            if (!a || !a.id) return;
            const kind = a.type === 'image' ? 'preview' : 'original';
            const url = `/api/assets/files/${a.id}/${kind}/auto`;
            // alt 用资源名；图片的 alt 里不要带方括号等会破坏语法的字符
            const alt = String(a.name || '资源').replace(/[\[\]]/g, '');
            this.insertAtCursor(`\n![${alt}](${url})\n`);
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
        },
        /**
         * 把 form.content_md 推入编辑器实例。
         *
         * 必要性：Vditor 自管内部状态，外部改 form.content_md（加载草稿、
         * 加载冲突版本、切换父页面重载等）不会自动反映到编辑器里，
         * 不推就会出现「页面数据已变、编辑器仍是旧内容」的错位。
         */
        syncEditorContent() {
            const ed = this.$refs.mdEditor;
            if (!ed || typeof ed.setContent !== 'function') return;
            // 已在编辑中时不要打断用户：只在内容确实不同时才覆盖
            ed.setContent(this.form.content_md || '');
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
/* 根容器走全局 .view-page（负责滚动）；.edit-container 只收窄编辑宽度。
   旧版 min-height:100vh 会让编辑区在玻璃面板内被裁且无法滚动。*/
.edit-container {
    width: 100%;
    max-width: 920px;
    padding: 4px 0 40px;
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
    font-size: var(--text-page-title);
    font-weight: var(--weight-bold);
    color: var(--text-primary);
    padding: 0;
    line-height: 1.2;
    letter-spacing: -0.01em;
}
.edit-title::placeholder {
    color: var(--text-tertiary);
}

/* 元信息行 */
.edit-meta-row {
    display: flex;
    flex-wrap: wrap;
    gap: 20px;
    margin: 18px 0 14px;
    padding-bottom: 14px;
    border-bottom: 1px solid var(--panel-border);
}
.meta-field {
    display: flex;
    align-items: center;
    gap: 8px;
}
.meta-label {
    font-size: 13px;
    color: var(--text-secondary);
}
.nt-select,
.nt-input {
    border: 1px solid var(--panel-border);
    border-radius: 6px;
    padding: 5px 9px;
    font-size: 14px;
    background: var(--panel-background);
    color: var(--text-primary);
}
.nt-select:focus-visible,
.nt-input:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
}
.nt-input {
    min-width: 200px;
}

/* 模式切换 */
.edit-mode-switch {
    display: inline-flex;
    gap: 2px;
    background: var(--hover-background);
    border-radius: 8px;
    padding: 3px;
    margin-bottom: 14px;
}
.mode-btn {
    border: none;
    background: none;
    color: var(--text-secondary);
    font-size: 13px;
    padding: 5px 14px;
    border-radius: 6px;
    cursor: pointer;
    transition: background 0.12s, color 0.12s;
}
.mode-btn:hover {
    color: var(--text-primary);
}
.mode-btn.active {
    background: var(--panel-background);
    color: var(--text-primary);
    box-shadow: var(--shadow-inset);
}

/* 图片插入工具按钮：与模式切换视觉区分，避免误以为也是模式切换 */
.mode-btn-tool {
    margin-left: auto;
    color: var(--text-secondary);
    border: 1px dashed var(--panel-border);
}
.mode-btn-tool:hover:not(:disabled) {
    color: var(--accent);
    border-color: var(--accent);
    border-style: solid;
}
.mode-btn-tool:disabled {
    opacity: 0.6;
    cursor: progress;
}
.image-input-hidden {
    display: none;
}
.image-tip {
    margin: 6px 0 0;
}

/* 编辑区：Vditor 已是所见即所得，没有左右分栏，只剩单栏容器。
   高度给足，编辑器内部自行滚动。 */
.edit-body {
    margin-top: 14px;
    /* 用视口相对高度而不是 100vh：100vh 会超出玻璃面板的可视区并把
       顶部标题与工具栏顶出屏幕（旧的 min-height:100vh 就有这个毛病）。
       这里让编辑区占满「面板剩余高度」，内部滚动。 */
    height: calc(100vh - 320px);
    min-height: 460px;
}
.pane {
    min-height: 460px;
}
/* 编写态必须是 flex 列且有确定高度：.md-editor 用的是 height:100%，
   若父级只有 min-height（高度不確定），子级的 100% 会解析成内容高度，
   编辑器就会塌成一行。给了 100% 后由 .edit-body 的高度向下传递。 */
.pane-write {
    display: flex;
    flex-direction: column;
    height: 100%;
}
.pane-preview {
    padding: 18px;
    background: var(--panel-background);
    border: 1px solid var(--panel-border);
    border-radius: var(--radius-md);
    overflow: auto;
    max-height: 640px;
}

/* 通知 */
.draft-notice {
    font-size: 13px;
    color: var(--warning);
    background: var(--warning-soft);
    border: 1px solid var(--warning);
    border-radius: 6px;
    padding: 8px 12px;
    margin: 16px 0 0;
}
.link-btn {
    background: none;
    border: none;
    color: var(--accent);
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
    color: var(--danger);
    border: 1px solid var(--danger);
    background: var(--danger-soft);
}
.nt-state-ok {
    color: var(--success);
    border: 1px solid var(--success);
    background: var(--success-soft);
}
.conflict-banner {
    padding: 12px 14px;
    border-radius: 6px;
    font-size: 14px;
    color: var(--warning);
    border: 1px solid var(--warning);
    background: var(--warning-soft);
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
    border: 1px solid var(--panel-border);
    background: var(--panel-background);
    color: var(--text-primary);
    transition: background 0.12s;
}
.nt-btn:hover {
    background: var(--hover-background);
}
.nt-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}
.nt-btn:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
}
.nt-btn-primary {
    background: var(--accent);
    color: var(--text-inverse);
    border-color: var(--accent);
}
.nt-btn-primary:hover {
    background: var(--accent-hover);
}
.nt-btn-danger {
    background: var(--danger);
    color: var(--text-inverse);
    border-color: var(--danger);
}
.nt-btn-danger:hover {
    background: var(--danger);
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

@media (max-width: 1340px) {
    /* 主内容区变窄时编辑器容器跟着收窄即可，无需切换布局 */
    .pane {
        min-height: 380px;
    }
}
</style>
