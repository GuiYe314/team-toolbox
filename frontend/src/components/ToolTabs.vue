<template>
    <div class="tool-workspace-header">
        <div class="tool-tabs" role="tablist" aria-label="工具标签">
            <div v-for="tab in tabs" :key="tab.id" class="tool-tab" role="presentation" :class="{ 'is-active': activeId === tab.id }" :data-tab-id="tab.id">
                <button :id="`tool-tab-${tab.id}`" class="tool-tab-select" type="button" role="tab" :aria-selected="activeId === tab.id" aria-controls="tool-workspace-panel" :tabindex="activeId === tab.id ? 0 : -1" @click="selectTab(tab)" @keydown="tabKey($event, tab)">
                    <svg v-if="tab.id === 'toolbox'" class="icon icon-sm" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="8" width="18" height="12" rx="2"/><path d="M9 8V5h6v3M3 13h18"/></svg>
                    <span>{{ tab.name }}</span>
                </button>
                <button v-if="tab.id !== 'toolbox'" v-hint class="tool-tab-close" type="button" tabindex="-1" :aria-label="`关闭${tab.name}标签`" :title="`关闭${tab.name}（Delete）`" :disabled="closing" @click="closeTab(tab.id)">
                    <svg class="icon icon-sm" viewBox="0 0 24 24" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17"/></svg>
                </button>
            </div>
        </div>
        <p v-if="toolTabs.saveError || navigationError" class="tool-tabs-message" role="alert">
            <span>{{ navigationError || '标签未能保存，当前仍可使用；刷新后可能丢失。' }}</span>
            <button v-if="toolTabs.saveError" class="btn btn-sm" type="button" @click="persistToolTabs">重试保存标签</button>
        </p>
    </div>
</template>

<script setup>
import { computed, nextTick, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { TOOLS, toolByRoute } from '../utils/tool-catalog.js';
import { closeToolTab } from '../utils/tool-tabs.js';
import { toolTabs, addToolTab, setToolTabs, persistToolTabs } from '../stores/tool-tabs.js';
const route = useRoute(), router = useRouter(), closing = ref(false), navigationError = ref('');
const activeId = computed(() => toolByRoute(route.name)?.id || 'toolbox');
const tabs = computed(() => [{ id: 'toolbox', name: '工具箱', routeName: 'tools' }, ...toolTabs.ids.map(id => TOOLS.find(tool => tool.id === id)).filter(Boolean)]);
async function revealActive(focus = false) {
    await nextTick();
    const button = document.getElementById(`tool-tab-${activeId.value}`);
    button?.closest('.tool-tab')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    if (focus) button?.focus({ preventScroll: true });
}
watch(() => route.name, () => {
    const tool = toolByRoute(route.name); if (tool) addToolTab(tool.id);
    navigationError.value = ''; revealActive();
}, { immediate: true });
async function selectTab(tab) {
    if (route.name === tab.routeName) return true;
    try { const failure = await router.push({ name: tab.routeName }); if (!failure) return true; }
    catch { /* 保留当前页面，并向用户说明切换失败。 */ }
    navigationError.value = '未能切换标签，请重试'; return false;
}
async function closeTab(id) {
    if (closing.value || !toolTabs.ids.includes(id)) return;
    closing.value = true;
    try {
        const next = closeToolTab(toolTabs.ids, id, activeId.value);
        if (activeId.value === id && !await selectTab(tabs.value.find(tab => tab.id === next.activeId))) return;
        setToolTabs(next.ids); await revealActive(true);
    } finally { closing.value = false; }
}
async function tabKey(event, tab) {
    if (event.key === 'Delete' && tab.id !== 'toolbox') { event.preventDefault(); await closeTab(tab.id); return; }
    const index = tabs.value.findIndex(item => item.id === tab.id);
    const target = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.value.length - 1 : event.key === 'ArrowLeft' ? (index + tabs.value.length - 1) % tabs.value.length : event.key === 'ArrowRight' ? (index + 1) % tabs.value.length : -1;
    if (target < 0) return;
    event.preventDefault(); if (await selectTab(tabs.value[target])) await revealActive(true);
}
</script>
