<template>
    <!--
      Markdown 渲染容器。

      除了承载渲染后的 HTML，还负责一件事：**图片失效时的降级**。

      背景：文档正文里可能引用两种图片
        1. 上传到本工具的附件（/api/uploads/xxx.png）
        2. 资源库的资源（/api/assets/files/<id>/<kind>/auto）
      两者的文件都可能不在了 —— 附件被清理、资源被删除、资源被永久删除。

      没有降级时，浏览器显示原生破图图标，用户只看到一个裂图，
      不知道是「图片加载失败」还是「网络断了」，更不知道去哪找替代。

      这里统一处理：图片加载失败 → 替换为带 alt 文本的占位块，
      鼠标悬停显示失败原因。alt 文本是唯一的线索，必须显示出来。

      用组件而不是在每个页面写 v-html + 手动绑定 onerror，
      是因为 v-html 渲染的内容需要手动遍历 DOM 挂事件，
      两处渲染点各写一遍容易漏 —— 预览态与阅读态行为必须一致。
    -->
    <div ref="root" class="markdown-body" v-html="html" @click="onClick"></div>
</template>

<script>
export default {
    name: 'MarkdownBody',
    props: {
        html: { type: String, default: '' }
    },
    watch: {
        html() {
            // 内容变了要重新绑定（v-html 会整体替换 DOM）
            this.$nextTick(() => this.bindImages());
        }
    },
    mounted() {
        this.bindImages();
    },
    methods: {
        /**
         * 给容器内的图片挂 error 监听。
         *
         * 用捕获阶段监听（addEventListener 的第三个参数 true），
         * 因为 error 事件不冒泡 —— 直接绑在 img 上收不到，
         * 绑在容器上用捕获才能收到。
         */
        bindImages() {
            const root = this.$refs.root;
            if (!root) return;
            const imgs = root.querySelectorAll('img');
            imgs.forEach((img) => {
                // 已经处理过的跳过（html 未变时 watch 不会触发，这里是幂等保护）
                if (img.dataset.mdFallback === '1') return;
                img.dataset.mdFallback = '1';
                img.addEventListener('error', () => this.markBroken(img), { once: true });
                // 已经失败过的（缓存里的坏图）不会重新触发 error，需主动检查
                if (img.complete && img.naturalWidth === 0) this.markBroken(img);
            });
        },
        /**
         * 把裂图替换成占位块。
         * @param {HTMLImageElement} img
         */
        markBroken(img) {
            if (!img || img.dataset.mdBroken === '1') return;
            img.dataset.mdBroken = '1';

            const alt = (img.getAttribute('alt') || '').trim();
            const src = img.getAttribute('src') || '';
            const box = document.createElement('span');
            box.className = 'md-broken';
            box.setAttribute('role', 'img');
            box.setAttribute('aria-label', alt ? `图片不可用：${alt}` : '图片不可用');
            // 保留原始地址：失效后这是唯一能查「原来指向哪」的线索
            box.dataset.mdSrc = src;

            const label = document.createElement('span');
            label.className = 'md-broken-label';
            label.textContent = alt || '图片不可用';
            box.appendChild(label);

            const hint = document.createElement('span');
            hint.className = 'md-broken-hint';
            // 资源引用被删 vs 附件丢失，说法不同但都指向同一件事：文件不在了
            hint.textContent = src.includes('/assets/files/')
                ? '引用的资源已删除或不可用'
                : '图片文件已丢失';
            box.appendChild(hint);

            box.title = alt ? `${alt} —— ${hint.textContent}` : hint.textContent;

            if (img.parentNode) img.parentNode.replaceChild(box, img);
        },
        /**
         * 点击图片引用时提示其真实地址。
         *
         * 失效的引用最想知道的是「原来指向哪」，但 URL 已经随裂图消失。
         * 所以这里在点击时把地址写进剪贴板，替代原来的右键「复制图片地址」。
         */
        onClick(e) {
            const box = e.target && e.target.closest && e.target.closest('.md-broken');
            if (!box) return;
            const src = box.dataset.mdSrc || '';
            if (!src) return;
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(src).catch(() => {});
            }
        }
    }
};
</script>

<style scoped>
.md-broken {
    display: inline-flex;
    flex-direction: column;
    gap: 2px;
    padding: 8px 12px;
    border: 1px dashed var(--panel-border);
    border-radius: var(--radius-sm, 6px);
    background: var(--panel-background-hover);
    color: var(--text-tertiary);
    font-size: 12px;
    line-height: 1.5;
    vertical-align: middle;
    cursor: help;
}

.md-broken-label {
    color: var(--text-secondary);
}

.md-broken-hint {
    font-size: 11px;
    opacity: 0.8;
}
</style>
