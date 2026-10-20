<template>
    <div class="md-editor" :class="{ 'is-loading': loading, 'is-dragging': dragging }">
        <!-- 加载态：lute 内核有 3.7MB，首屏需要一点时间 -->
        <div v-if="loading" class="md-editor-loading">
            <span class="md-editor-spinner" aria-hidden="true"></span>
            <span>编辑器加载中…</span>
        </div>

        <!-- Vditor 会把自己的 DOM 挂到这里 -->
        <div ref="host" class="md-editor-host"></div>

        <!-- 拖拽悬停提示：Vditor 自身的 drop 处理不提供视觉反馈 -->
        <div v-if="dragging" class="md-editor-drop">松开以插入图片</div>
    </div>
</template>

<script>
/**
 * Markdown 所见即所得编辑器（基于 Vditor）。
 *
 * 与旧 textarea 方案的关键差异：
 *   - 编辑时渲染的是 HTML，保存时才转回 Markdown（vditor.getValue()），
 *     因此 onChange 拿到的一律是**标准 Markdown 源码**，可直接存 content_md，
 *     阅读页仍走后端 marked + sanitize-html 渲染，两边结果一致。
 *   - 资源全部本地自托管（/vendor/vditor/），不请求 unpkg。见 vite.config.js。
 *
 * 图片：Vditor 自带 upload 回调，直接对接既有 /api/uploads，
 * 复用原上传链路与错误提示，不新增接口。
 */
import { api } from '../api/client.js';
// Vditor 加载逻辑已抽到共享模块，资源管理的 Markdown 预览也复用它，
// 避免两处各自注入脚本/样式
import { loadVditor } from './MarkdownLoader.js';


export default {
    name: 'MarkdownEditor',
    props: {
        modelValue: { type: String, default: '' },
        // 只读模式（预览态）时禁用编辑
        readonly: { type: Boolean, default: false },
        uploading: { type: Boolean, default: false }
    },
    emits: ['update:modelValue', 'image-error'],
    data() {
        return { loading: true, dragging: false, ready: false };
    },
    async mounted() {
        let Vditor;
        try {
            Vditor = await loadVditor();
        } catch (e) {
            this.loading = false;
            this.$emit('image-error', e.message);
            return;
        }
        if (this._isUnmounted) return;

        this.vditor = new Vditor(this.$refs.host, {
            // 关键：指向本地自托管路径，而不是默认的 unpkg CDN。
            // Vditor 会在此值后自行拼接 /dist/js/... 与 /dist/css/...，
            // 因此这里填到 /vendor/vditor 为止，不要多写也不要少写 dist。
            cdn: '/vendor/vditor',
            // ir = 即时渲染（instant render）：输入时实时排版，但不把光标前的
            // 标记语法（##、** 等）吃掉，打字不打断。
            // 别选 sv ——sv 的语义是「左源码 + 右预览」的分屏，
            // 与本工具刚去掉的老「分屏」模式是同一形态，反而更难用。
            mode: 'ir',
            lang: 'zh_CN',
            icon: 'ant',
            // 工具栏常驻，滚动时也能改格式
            toolbarPin: true,
            placeholder: '输入 Markdown 正文…',
            // 只保留文档场景真正常用的动作，去掉图表/流程图/思维导图等
            // 本项目用不到且会按需拉外部内核的按钮。
            toolbar: [
                'emoji', 'headings', 'bold', 'italic', 'strike', '|',
                'hr', 'quote', 'list', 'ordered-list', 'check', 'outdent', 'indent', '|',
                'link', 'image', 'table', 'code', 'inline-code', 'undo', 'redo'
            ],
            // 上传走既有 /api/uploads，返回值需是 Vditor 认得的 { msg, code, data }
            upload: (files) => this.handleUpload(files),
            // 关闭默认的 Markdown 源码切换按钮：模式已固定 sv，避免用户误入源码模式
            showEdit: false,
            // 关闭目录/大纲，减少与主导航的重复
            outline: { enable: false },
            // 编辑器异步渲染完成回调。
            // 注意：V4 里这个选项叫 after，afterUpdate 是 V3 的旧名，写错会导致
            // 回调永不触发（编辑器一直卡在加载态、初始内容灌不进去），且不报错。
            after: () => {
                this.ready = true;
                this.loading = false;
                // 补灌实例就绪前排队的初始内容
                if (this._pendingContent !== undefined) {
                    const md = this._pendingContent || '';
                    this._pendingContent = undefined;
                    this.vditor.setValue(md);
                    this.$emit('update:modelValue', md);
                }
            },
            // 内容变化：Vditor 的 sv 模式下值已是 Markdown
            input: (md) => this.$emit('update:modelValue', md),
            // 粘贴图片：与旧的 Ctrl+V 行为保持一致
            uploadPaste: (file) => this.handlePasteUpload(file),
            cache: { enable: false }   // 草稿由外层sessionStorage 统一管理，避免双份
        });
        // 把实例挂到 DOM 上：Vditor 不暴露全局单例，验证脚本与浏览器
        // 调试都需要一个入口拿到 getValue/setValue。
        this.$refs.host.__vditor = this.vditor;
    },
    beforeUnmount() {
        this._isUnmounted = true;
        // 必须销毁，否则 Vditor 会在 document 上留下全局事件监听
        if (this.vditor) {
            try { this.vditor.destroy(); } catch { /* 已销毁 */ }
            this.vditor = null;
        }
    },
    methods: {
        async handleUpload(files) {
            const file = files && files[0];
            if (!file) return { msg: '未选择文件', code: 1 };
            try {
                const { res, body } = await api.uploadImage(file);
                if (!res.ok) throw new Error((body && body.message) || '图片上传失败');
                // Vditor 期望的返回结构：data 为插入 Markdown 的链接
                return { msg: '上传成功', code: 0, data: body.url };
            } catch (err) {
                const msg = err.network ? err.message : (err.message || '图片上传失败，请稍后重试');
                this.$emit('image-error', msg);
                return { msg, code: 1 };
            }
        },
        async handlePasteUpload(file) {
            // Vditor 的 uploadPaste 需要返回字符串 URL；失败时返回空表示放弃
            try {
                const { res, body } = await api.uploadImage(file);
                if (!res.ok) throw new Error((body && body.message) || '图片上传失败');
                return body.url;
            } catch (err) {
                this.$emit('image-error', err.network ? err.message : (err.message || '图片上传失败'));
                return '';
            }
        },
        /**
         * 由父组件调用：在光标处插入 Markdown 片段。
         * Vditor 用 insertValue，走它的选区管理比手工拼字符串可靠。
         */
        insertAtCursor(text) {
            if (!this.vditor) return;
            this.vditor.insertValue(text);
            this.$emit('update:modelValue', this.vditor.getValue());
        },
        /** 切换只读态（预览模式复用同一实例，避免重建 3.7MB 内核）。 */
        setReadonly(flag) {
            if (!this.vditor || !this.ready) return;
            if (flag) this.vditor.disabled(true);
            else this.vditor.disabled(false);
        },
        /**
         * 由父组件把外部内容灌入编辑器。
         *
         * Vditor 自管内部状态，父组件改了 modelValue（恢复草稿、加载冲突
         * 版本等）不会自动同步，不调用就会出现「数据已变、编辑器仍是旧内容」。
         * 内容一致时跳过，避免把光标重置到开头打断正在输入的用户。
         */
        setContent(md) {
            // 实例尚未就绪（lute 内核还在加载）时先记下来，
            // 等 afterUpdate 触发后再补灌，否则首次进入编辑页会显示空白
            if (!this.vditor || !this.ready) {
                this._pendingContent = md;
                return;
            }
            if (this.vditor.getValue() === md) return;
            this.vditor.setValue(md || '');
            this.$emit('update:modelValue', md || '');
        }
    }
};
</script>

<style scoped>
/* ── 外壳 ──────────────────────────────────────────────────────
   Vditor 自带样式会设死高度，这里只负责占位与状态反馈。
   颜色一律走 token，不硬编码。 */
.md-editor {
    position: relative;
    display: flex;
    flex-direction: column;
    min-height: 0;
    height: 100%;
    border-radius: var(--radius-md);
    border: 1px solid var(--panel-border);
    background: var(--panel-background);
    overflow: hidden;
    transition: border-color var(--dur-base) var(--ease-out);
}
.md-editor:focus-within {
    border-color: var(--accent-border);
    box-shadow: 0 0 0 3px var(--focus-ring);
}

/* 拖拽悬停：仅描边变化 + 居中提示，不做整块高亮，避免刺眼 */
.md-editor.is-dragging {
    border-color: var(--accent);
}

.md-editor-host {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
}
/* Vditor 会生成 .vditor 并设 height:100%，这里让它吃满宿主高度。
   颜色 / 边框 / 字号等视觉一律由 styles/vditor.css 的 token 适配层负责，
   此处只管布局，避免同一属性两处维护。 */
.md-editor-host :deep(.vditor) {
    flex: 1;
    min-height: 0;
}
.md-editor-host :deep(.vditor-content) {
    flex: 1;
    min-height: 0;
    overflow: auto;
}

.md-editor-loading {
    position: absolute;
    inset: 0;
    z-index: 2;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    font-size: var(--text-secondary);
    color: var(--text-tertiary);
    background: var(--panel-background);
}
/* 纯 CSS 转圈：只做匀速旋转，无弹跳，符合动效规范 */
.md-editor-spinner {
    width: 14px;
    height: 14px;
    border: 1.8px solid var(--panel-border);
    border-top-color: var(--accent);
    border-radius: var(--radius-pill);
    animation: md-spin 720ms linear infinite;
}
@keyframes md-spin {
    to { transform: rotate(360deg); }
}

.md-editor-drop {
    position: absolute;
    inset: 0;
    z-index: 3;
    display: grid;
    place-items: center;
    font-size: var(--text-body);
    color: var(--text-primary);
    background: var(--accent-soft);
    border: 1.5px dashed var(--accent);
    border-radius: var(--radius-md);
    pointer-events: none;
}
</style>
