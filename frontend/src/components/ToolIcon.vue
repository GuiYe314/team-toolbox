<template>
    <!-- 工具图标：按 toolId 映射到 Lucide 风格线性图标。
         规范禁止 Emoji 与 3D 图标，因此工具卡片、工具详情页统一走这里，
         保证同一工具在不同页面出现时视觉完全一致。 -->
    <span class="tool-glyph" :class="`is-${resolved}`" aria-hidden="true">
        <svg v-if="resolved === 'braces'" class="icon" viewBox="0 0 24 24">
            <path d="M8 4.5c-2 0-2.6 1-2.6 2.6v2.2c0 1.4-.6 2.2-2 2.2v1c1.4 0 2 .8 2 2.2v2.2C5.4 18.5 6 19.5 8 19.5" />
            <path d="M16 4.5c2 0 2.6 1 2.6 2.6v2.2c0 1.4.6 2.2 2 2.2v1c-1.4 0-2 .8-2 2.2v2.2c0 1.6-.6 2.6-2.6 2.6" />
        </svg>
        <svg v-else-if="resolved === 'qrcode'" class="icon" viewBox="0 0 24 24">
            <rect x="3.5" y="3.5" width="7" height="7" rx="1.4" />
            <rect x="13.5" y="3.5" width="7" height="7" rx="1.4" />
            <rect x="3.5" y="13.5" width="7" height="7" rx="1.4" />
            <path d="M13.5 13.5h3v3h-3zM20.5 13.5v3M17.5 20.5h3M13.5 20.5h1" />
        </svg>
        <svg v-else-if="resolved === 'ratio'" class="icon" viewBox="0 0 24 24">
            <rect x="3.5" y="5" width="17" height="14" rx="2" />
            <path d="M8.5 5v14M15.5 5v14M3.5 12h17" />
        </svg>
        <svg v-else-if="resolved === 'android-wireless'" class="icon" viewBox="0 0 24 24">
            <rect x="6.5" y="2.5" width="11" height="19" rx="2" />
            <path d="M10 18h4M9 8a5 5 0 0 1 6 0M10.5 10.5a2.5 2.5 0 0 1 3 0" />
        </svg>
        <svg v-else-if="resolved === 'unity-logs'" class="icon" viewBox="0 0 24 24">
            <rect x="5" y="2.5" width="14" height="19" rx="2" />
            <path d="M8.5 7h7M8.5 11h7M8.5 15h4M11 18.5h2" />
        </svg>
        <svg v-else class="icon" viewBox="0 0 24 24">
            <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
            <path d="M3.5 9.5h17M9.5 9.5v10" />
        </svg>
    </span>
</template>

<script>
const MAP = {
    'unity-logs': 'unity-logs',
    'android-wireless': 'android-wireless',
    'json-fmt': 'braces',
    jsonfmt: 'braces',
    'qrcode': 'qrcode',
    'qr-code': 'qrcode',
    'ratio': 'ratio',
    'ratio-lock': 'ratio',
    'ratiolock': 'ratio'
};

export default {
    name: 'ToolIcon',
    props: {
        toolId: { type: String, default: '' }
    },
    computed: {
        resolved() {
            return MAP[this.toolId] || MAP[this.toolId.toLowerCase()] || 'grid';
        }
    }
};
</script>

<style scoped>
.tool-glyph {
    display: grid;
    place-items: center;
    width: 34px;
    height: 34px;
    border-radius: var(--radius-sm);
    background: var(--accent-soft);
    color: var(--accent);
}
.tool-glyph.is-grid { background: var(--panel-background-hover); color: var(--text-secondary); }
</style>
