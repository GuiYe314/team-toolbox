import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { moveIndicator, stopUiMotion } from './motion.js';

export function useTabIndicator(activeId, tabs) {
    const tabList = ref(null), indicator = ref(null);
    let observer, alive = true, shown = false;
    async function update(immediate = false) {
        await nextTick();
        if (!alive || !indicator.value || !tabList.value) return;
        const selected = [...tabList.value.querySelectorAll('[data-tab-id]')].find(el => el.dataset.tabId === activeId.value);
        if (!selected) return;
        moveIndicator(indicator.value, selected.offsetLeft, selected.offsetWidth, immediate || !shown); shown = true;
    }
    watch([activeId, tabs], () => update());
    onMounted(() => {
        observer = new ResizeObserver(() => update(true)); observer.observe(tabList.value);
        document.fonts?.ready.then(() => { if (alive) update(true); }); update(true);
    });
    onBeforeUnmount(() => { alive = false; observer?.disconnect(); if (indicator.value) stopUiMotion(indicator.value); });
    return { tabList, indicator };
}
