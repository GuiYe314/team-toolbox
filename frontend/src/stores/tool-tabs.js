import { reactive } from 'vue';
import { readToolTabs, saveToolTabs, openToolTab, normalizeToolTabs } from '../utils/tool-tabs.js';

export const toolTabs = reactive({ ids: readToolTabs(), saveError: false });
export function persistToolTabs() { toolTabs.saveError = !saveToolTabs(toolTabs.ids); }
export function addToolTab(id) {
    const next = openToolTab(toolTabs.ids, id);
    if (next.length === toolTabs.ids.length) return;
    toolTabs.ids = next; persistToolTabs();
}
export function setToolTabs(ids) { toolTabs.ids = normalizeToolTabs(ids); persistToolTabs(); }
