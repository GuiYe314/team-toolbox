<template>
    <!-- Notion 风格的单色文档图标（描边文件 + 折角） -->
    <svg
        :width="size"
        :height="size"
        viewBox="0 0 16 16"
        fill="none"
        aria-hidden="true"
        focusable="false"
        class="doc-icon"
    >
        <path
            d="M9.2 1.6H4.6a1 1 0 0 0-1 1v10.8a1 1 0 0 0 1 1h6.8a1 1 0 0 0 1-1V4.8L9.2 1.6Z"
            stroke="currentColor"
            stroke-width="1.1"
            stroke-linejoin="round"
        />
        <path
            d="M9.1 1.8v3.1h3.1"
            stroke="currentColor"
            stroke-width="1.1"
            stroke-linejoin="round"
        />
        <path d="M5.9 8.4h4.2M5.9 10.9h4.2" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" />
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
    color: var(--color-text-faint);
}
</style>
