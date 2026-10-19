<template>
    <!-- 触发按钮：放在文档顶栏 / 编辑工具栏 -->
    <button
        class="nt-ghost help-trigger"
        :class="{ 'is-compact': compact }"
        type="button"
        :title="compact ? 'Markdown 语法速查' : ''"
        :aria-haspopup="'dialog'"
        @click="open"
    >
        <svg class="icon icon-sm" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="8.5" />
            <path d="M9.6 9.4a2.5 2.5 0 1 1 3.3 2.4c-.6.2-.9.8-.9 1.4v.6" />
            <line x1="12" y1="17.2" x2="12" y2="17.3" />
        </svg>
        <span v-if="!compact">帮助</span>
    </button>

    <!-- 语法速查弹窗 -->
    <div v-if="show" class="overlay" @click.self="close">
        <div
            class="dialog dialog-lg"
            role="dialog"
            aria-modal="true"
            aria-labelledby="md-help-title"
        >
            <div class="help-head">
                <div class="help-head-text">
                    <h2 class="dialog-title" id="md-help-title">Markdown 语法速查</h2>
                    <p class="help-sub">点击任意一行可复制语法</p>
                </div>
                <button class="help-close" type="button" aria-label="关闭" @click="close">
                    <svg class="icon icon-sm" viewBox="0 0 24 24" aria-hidden="true">
                        <line x1="6" y1="6" x2="18" y2="18" />
                        <line x1="18" y1="6" x2="6" y2="18" />
                    </svg>
                </button>
            </div>

            <div class="help-body">
                <section v-for="g in GROUPS" :key="g.title" class="help-group">
                    <h3 class="help-group-title">{{ g.title }}</h3>
                    <ul class="help-list">
                        <li v-for="it in g.items" :key="it.syntax" class="help-row">
                            <button class="help-item" type="button" @click="copy(it)">
                                <code class="help-syntax">{{ it.syntax }}</code>
                                <span class="help-desc">{{ it.desc }}</span>
                            </button>
                        </li>
                    </ul>
                </section>

                <section class="help-group">
                    <h3 class="help-group-title help-group-warn">注意：不支持的写法</h3>
                    <p class="help-warn-text">
                        以下写法在其他编辑器里常见，但本工具<b>不会生效</b>，写进正文只会显示原始符号：
                    </p>
                    <ul class="help-list">
                        <li v-for="it in UNSUPPORTED" :key="it.syntax" class="help-row">
                            <div class="help-item is-static">
                                <code class="help-syntax">{{ it.syntax }}</code>
                                <span class="help-desc">{{ it.desc }}</span>
                            </div>
                        </li>
                    </ul>
                    <p class="help-warn-text help-warn-tail">
                        另外，行内 HTML（如 <code>&lt;div&gt;</code>）会被安全过滤掉，请改用 Markdown 语法。
                    </p>
                </section>
            </div>

            <div class="dialog-actions help-actions">
                <span class="help-tip">{{ copied ? '已复制到剪贴板' : '' }}</span>
                <button class="btn" type="button" @click="close">关闭</button>
            </div>
        </div>
    </div>
</template>

<script>
/**
 * Markdown 语法速查弹窗。
 *
 * 内容严格对应后端 markdown.js 的真实能力（marked + sanitize-html 白名单），
 * 每条语法都在实现前实测过渲染结果，不收录「写了但不生效」的写法。
 * 新增/调整白名单后需同步维护此表。
 */
const GROUPS = [
    {
        title: '基础排版',
        items: [
            { syntax: '# 一级标题', desc: '标题分六级：# ~ ######' },
            { syntax: '**加粗**', desc: '也可用 __加粗__' },
            { syntax: '*斜体*', desc: '也可用 _斜体_' },
            { syntax: '~~删除线~~', desc: '表示已废弃或不再适用的内容' },
            { syntax: '---', desc: '单独一行，插入分隔线' }
        ]
    },
    {
        title: '段落与列表',
        items: [
            { syntax: '空行', desc: '空一行分段，段内换行不会另起一段' },
            { syntax: '行尾两空格', desc: '在行尾打两个空格可强制换行' },
            { syntax: '- 项目', desc: '无序列表，- / * / + 都可' },
            { syntax: '1. 项目', desc: '有序列表，数字会自动排序' },
            { syntax: '  - 缩进', desc: '缩进 2~4 个空格可嵌套子列表' }
        ]
    },
    {
        title: '引用与代码',
        items: [
            { syntax: '> 引用', desc: '引用块，可叠加 > 形成嵌套' },
            { syntax: '`行内代码`', desc: '短代码或字段名' },
            { syntax: '```js', desc: '三反引号围栏代码块，结束围栏另起一行' }
        ]
    },
    {
        title: '表格',
        items: [
            { syntax: '| 列 A | 列 B |', desc: '表头行' },
            { syntax: '| --- | --- |', desc: '分隔行，必须有；: 可设左右对齐' }
        ]
    },
    {
        title: '链接与图片',
        items: [
            { syntax: '[文字](https://…)', desc: '超链接，外链会自动加安全属性' },
            { syntax: '<https://…>', desc: '尖括号包裹可自动识别为链接' },
            { syntax: '![说明](图片地址)', desc: '图片，编辑页可用「插入图片」按钮上传' }
        ]
    }
];

// 实测确认「不生效」的写法。列出它们比让人白试一场更有用。
const UNSUPPORTED = [
    { syntax: '- [ ] 待办', desc: '任务列表：方括号会被丢弃，不会出现勾选框' },
    { syntax: '[^1]', desc: '脚注：会被当成普通链接渲染成乱码' },
    { syntax: '$$公式$$', desc: '数学公式：不解析' },
    { syntax: '==高亮==', desc: '高亮：不解析' },
    { syntax: '^上标^', desc: '上下标：不解析' }
];

export default {
    name: 'MarkdownHelp',
    props: {
        // compact：只显示图标，用于空间紧张的编辑工具栏
        compact: { type: Boolean, default: false }
    },
    data() {
        return { show: false, copied: false, GROUPS, UNSUPPORTED };
    },
    mounted() {
        this._onEsc = (e) => {
            if (e.key === 'Escape' && this.show) this.close();
        };
        window.addEventListener('keydown', this._onEsc);
    },
    beforeUnmount() {
        if (this._onEsc) window.removeEventListener('keydown', this._onEsc);
    },
    methods: {
        open() {
            this.show = true;
            this.copied = false;
        },
        close() {
            this.show = false;
        },
        async copy(item) {
            // clipboard 需安全上下文；不可用时静默降级，不打扰用户
            try {
                await navigator.clipboard.writeText(item.syntax);
                this.copied = true;
                clearTimeout(this._copyTimer);
                this._copyTimer = setTimeout(() => { this.copied = false; }, 1600);
            } catch {
                // 忽略：非 HTTPS 或权限被拒时无法复制
            }
        }
    }
};
</script>

<style scoped>
/* 触发按钮沿用详情页顶栏的 .nt-ghost，仅补图标对齐 */
.help-trigger {
    display: inline-flex;
    align-items: center;
    gap: 6px;
}
.help-trigger.is-compact {
    padding: 0 8px;
}

/* ── 弹窗 ──────────────────────────────────────────────────────
   宽于默认 .dialog（440px）：两列排布语法表才不拥挤 */
.dialog-lg {
    width: min(720px, calc(100vw - 48px));
    max-height: min(78vh, 720px);
    display: flex;
    flex-direction: column;
    padding: 0;
}

.help-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
    flex: none;
    padding: 20px 22px 14px;
    border-bottom: 1px solid var(--panel-border);
}
.help-head-text { min-width: 0; }
.help-sub {
    margin: 4px 0 0;
    font-size: var(--text-secondary);
    color: var(--text-tertiary);
}
.help-close {
    flex: none;
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
.help-close:hover { background: var(--hover-background); color: var(--text-primary); }
.help-close:focus-visible {
    outline: none;
    border-color: var(--accent-border);
    box-shadow: 0 0 0 3px var(--focus-ring);
}

/* 滚动区：弹窗再高也不撑破视口 */
.help-body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 16px 22px 4px;
    scrollbar-width: thin;
    scrollbar-color: var(--text-tertiary) transparent;
}

.help-group + .help-group { margin-top: 18px; }
.help-group-title {
    margin: 0 0 8px;
    font-size: var(--text-secondary);
    font-weight: var(--weight-semibold);
    letter-spacing: 0.02em;
    color: var(--text-tertiary);
}
.help-group-warn { color: var(--warning); }

.help-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
}
.help-row { min-width: 0; }

.help-item {
    display: grid;
    /* 左列固定宽度放语法片段，右列自适应放说明。
       不用两列瀑布流：说明文字被压到 ~180px 时会频繁折行并留下孤字。*/
    grid-template-columns: 132px minmax(0, 1fr);
    align-items: baseline;
    gap: 14px;
    width: 100%;
    padding: 6px 8px;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: transparent;
    text-align: left;
    font-family: inherit;
    cursor: pointer;
    transition: background var(--dur-fast) var(--ease-out),
                border-color var(--dur-fast) var(--ease-out);
}
.help-item:not(.is-static):hover {
    background: var(--panel-background-hover);
    border-color: var(--panel-border);
}
.help-item:not(.is-static):focus-visible {
    outline: none;
    border-color: var(--accent-border);
    box-shadow: 0 0 0 3px var(--focus-ring);
}
.help-item.is-static { cursor: default; }

/* 语法片段：等宽字体 + 淡底，与右侧说明区分 */
.help-syntax {
    justify-self: start;
    max-width: 100%;
    padding: 2px 7px;
    border-radius: var(--radius-pill);
    background: var(--panel-background-hover);
    border: 1px solid var(--panel-border);
    font-family: var(--font-mono);
    font-size: var(--text-secondary);
    color: var(--text-primary);
    overflow-wrap: anywhere;
}
.help-desc {
    font-size: var(--text-secondary);
    color: var(--text-tertiary);
    line-height: var(--line-tight);
    min-width: 0;
}

.help-warn-text {
    margin: 0 0 8px;
    font-size: var(--text-secondary);
    line-height: var(--line-relaxed);
    color: var(--text-secondary);
}
.help-warn-text b { color: var(--warning); font-weight: var(--weight-semibold); }
.help-warn-text code {
    font-family: var(--font-mono);
    font-size: var(--text-secondary);
    padding: 1px 4px;
    border-radius: 4px;
    background: var(--panel-background-hover);
}
.help-warn-tail { margin-top: 8px; }

.help-actions {
    flex: none;
    margin-top: 0;
    padding: 12px 22px 16px;
    border-top: 1px solid var(--panel-border);
    align-items: center;
}
.help-tip {
    flex: 1;
    font-size: var(--text-secondary);
    color: var(--success);
}

/* 窄弹窗下语法列不能占 168px 固定宽，否则说明被挤成一条。
   改为上下堆叠：语法在上、说明在下。 */
@media (max-width: 640px) {
    .dialog-lg { width: calc(100vw - 32px); }
    .help-item {
        grid-template-columns: minmax(0, 1fr);
        gap: 3px;
    }
}
</style>
