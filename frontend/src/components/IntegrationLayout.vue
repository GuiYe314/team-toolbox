<template>
    <div class="view-page ext-page">
        <header class="view-head ext-head">
            <div class="ext-stack ext-title-group"><RouterLink class="ext-back" to="/tools">返回工具箱</RouterLink><div class="ext-row"><ToolIcon :tool-id="toolId" /><h1 class="view-title">{{ title }}</h1></div><p class="view-subtitle">{{ subtitle }}</p></div>
            <div class="ext-actions"><slot name="actions" /></div>
        </header>
        <slot />
        <footer class="ext-footer"><slot name="footer" /></footer>
    </div>
</template>

<script setup>
import ToolIcon from './ToolIcon.vue';
defineProps({ title: String, subtitle: String, toolId: String });
</script>
