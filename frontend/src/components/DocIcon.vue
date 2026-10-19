<template>
    <!-- 文档图标：与全局 .icon 统一为 Lucide 风格（24 视图 / stroke 1.8），
         使列表内图标与导航、工具栏图标视觉重量一致。 -->
    <svg
        :width="size"
        :height="size"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
        focusable="false"
        class="doc-icon"
    >
        <path d="M14 3.5H6.8A1.8 1.8 0 0 0 5 5.3v13.4a1.8 1.8 0 0 0 1.8 1.8h10.4a1.8 1.8 0 0 0 1.8-1.8V8.5z" />
        <path d="M13.8 3.6v4.2H19" />
        <path d="M8.6 13h6.8M8.6 16.4h4.6" />
    </svg>
</template>

<script>
export default {
    name: 'DocIcon',
    props: {
        size: { type: Number, default: 14 }
    }
};
</script>

<style scoped>
.doc-icon {
    display: block;
    flex-shrink: 0;
    color: inherit;
}
</style>