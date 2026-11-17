<template>
    <!-- 工具图标：按 toolId 映射到 Lucide 风格线性图标。
         规范禁止 Emoji 与 3D 图标，因此工具卡片、工具详情页统一走这里，
         保证同一工具在不同页面出现时视觉完全一致。 -->
    <span class="tool-glyph" :class="`is-${resolved}`" aria-hidden="true">
        <svg v-if="resolved === 'image-batch'" class="icon" viewBox="0 0 24 24"><rect x="3" y="3" width="15" height="15" rx="2"/><path d="m3 14 4-4 4 4 3-3 4 4M7 21h12a2 2 0 0 0 2-2V7"/><circle cx="7" cy="7" r="1"/></svg>
        <svg v-else-if="resolved === 'quick-calculation'" class="icon" viewBox="0 0 24 24"><rect x="5" y="2" width="14" height="20" rx="2"/><path d="M8 5h8v4H8zM8 13h2M14 13h2M8 17h2M15 16v3M14 18h2"/></svg>
        <svg v-else-if="resolved === 'image-ocr'" class="icon" viewBox="0 0 24 24"><path d="M8 3H4a1 1 0 0 0-1 1v4M16 3h4a1 1 0 0 1 1 1v4M3 16v4a1 1 0 0 0 1 1h4M16 21h4a1 1 0 0 0 1-1v-4M7 8h10M12 8v9M9 17h6"/></svg>
        <svg v-else-if="resolved === 'pdf-tools'" class="icon" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8 13h8M8 17h6"/></svg>
        <svg v-else-if="resolved === 'video-process'" class="icon" viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m10 9 5 3-5 3zM7 5v14M17 5v14"/></svg>
        <svg v-else-if="resolved === 'whiteboard'" class="icon" viewBox="0 0 24 24"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21l4-4 4 4M6 8h4v5H6zM15 8h3v5h-3M10 10h5"/></svg>
        <svg v-else-if="resolved === 'peer-transfer'" class="icon" viewBox="0 0 24 24"><rect x="2" y="3" width="11" height="9" rx="1"/><rect x="16" y="11" width="6" height="10" rx="1"/><path d="M4 17h8l-3-3M12 17l-3 3M20 6h-4l2-2M16 6l2 2"/></svg>
        <svg v-else-if="resolved === 'android-mirror'" class="icon" viewBox="0 0 24 24"><rect x="2" y="3" width="16" height="12" rx="2"/><rect x="15" y="9" width="7" height="12" rx="1"/><path d="M5 19h7M9 15v4M18 18h1"/></svg>
        <svg v-else-if="resolved === 'braces'" class="icon" viewBox="0 0 24 24">
            <path d="M8 4.5c-2 0-2.6 1-2.6 2.6v2.2c0 1.4-.6 2.2-2 2.2v1c1.4 0 2 .8 2 2.2v2.2C5.4 18.5 6 19.5 8 19.5" />
            <path d="M16 4.5c2 0 2.6 1 2.6 2.6v2.2c0 1.4.6 2.2 2 2.2v1c-1.4 0-2 .8-2 2.2v2.2c0 1.6-.6 2.6-2.6 2.6" />
        </svg>
        <svg v-else-if="resolved === 'phone-album'" class="icon" viewBox="0 0 24 24"><rect x="4" y="3" width="13" height="18" rx="2" /><path d="m4 15 4-4 4 4 3-3 2 2M19 4v6m-2-2 2 2 2-2" /><circle cx="8" cy="7" r="1" /></svg>
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
        <svg v-else-if="resolved === 'port-viewer'" class="icon" viewBox="0 0 24 24">
            <rect x="5" y="7" width="14" height="10" rx="2" /><path d="M8 7V3M12 7V3M16 7V3M8 17v4M12 17v4M16 17v4M2 12h3M19 12h3M9 11v2M15 11v2" />
        </svg>
        <svg v-else-if="resolved === 'network-speed'" class="icon" viewBox="0 0 24 24">
            <path d="M3 13a9 9 0 1 1 18 0v5H3zM12 13l4-5M6 13h.01M8 7h.01M16 13h.01" /><circle cx="12" cy="13" r="1.4" />
        </svg>
        <svg v-else-if="resolved === 'solar-globe'" class="icon" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="8.5" />
            <path d="M3.8 12h16.4M12 3.5c2.1 2.2 3.2 5 3.2 8.5S14.1 18.3 12 20.5M12 3.5C9.9 5.7 8.8 8.5 8.8 12s1.1 6.3 3.2 8.5" />
            <path d="M5.1 7.6c2 1 4.3 1.5 6.9 1.5s4.9-.5 6.9-1.5M5.1 16.4c2-1 4.3-1.5 6.9-1.5s4.9.5 6.9 1.5" />
        </svg>
        <svg v-else-if="resolved === 'yoinks'" class="icon" viewBox="0 0 24 24">
            <path d="M12 3v11m-4-4 4 4 4-4M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" />
        </svg>
        <svg v-else-if="resolved === 'freellmapi'" class="icon" viewBox="0 0 24 24">
            <path d="M5 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-6 4V6a2 2 0 0 1 2-2Z" /><path d="M7 9h10M7 13h7" />
        </svg>
        <svg v-else-if="resolved === 'artcraft'" class="icon" viewBox="0 0 24 24">
            <rect x="3" y="3" width="18" height="18" rx="3" /><circle cx="8" cy="8" r="1.5" /><path d="m3 17 5-5 4 4 4-6 5 7" />
        </svg>
        <svg v-else class="icon" viewBox="0 0 24 24">
            <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
            <path d="M3.5 9.5h17M9.5 9.5v10" />
        </svg>
    </span>
</template>

<script>
const MAP = {
    'quick-calculation': 'quick-calculation',
    'image-batch': 'image-batch', 'image-ocr': 'image-ocr', 'pdf-tools': 'pdf-tools', 'video-process': 'video-process', 'whiteboard': 'whiteboard', 'peer-transfer': 'peer-transfer', 'android-mirror': 'android-mirror', 'developer-tools': 'braces',
    'phone-album': 'phone-album',
    'port-viewer': 'port-viewer',
    'network-speed': 'network-speed',
    yoinks: 'yoinks',
    freellmapi: 'freellmapi',
    artcraft: 'artcraft',
    'unity-logs': 'unity-logs',
    'android-wireless': 'android-wireless',
    'json-fmt': 'braces',
    jsonfmt: 'braces',
    'qrcode': 'qrcode',
    'qr-code': 'qrcode',
    'ratio': 'ratio',
    'ratio-lock': 'ratio',
    'ratiolock': 'ratio',
    'earth-sunlight': 'solar-globe',
    'solar-globe': 'solar-globe'
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
    width: var(--tool-glyph-size);
    height: var(--tool-glyph-size);
    border-radius: var(--radius-sm);
    border: var(--glass-line) solid var(--accent-border);
    background: var(--control-highlight), var(--accent-soft);
    box-shadow: var(--shadow-inset);
    color: var(--accent);
}
.tool-glyph.is-grid { background: var(--panel-background-hover); color: var(--text-secondary); }
</style>
