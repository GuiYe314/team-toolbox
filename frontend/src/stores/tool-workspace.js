import { reactive } from 'vue';
import { TOOLS } from '../utils/tool-catalog.js';
import { TOOL_GROUPS_KEY, readToolGroups, saveToolGroups, normalizeToolGroups, assignToolGroup } from '../utils/tool-groups.js';
import { TOOL_ORDER_STORAGE_KEY, loadToolOrder, moveTool, saveToolOrder } from '../utils/tool-order.js';

export const toolWorkspace = reactive({ tools: loadToolOrder(TOOLS), layout: readToolGroups(), saveError: false });
let initialized = false;
export function initToolWorkspace() {
    if (initialized) return;
    initialized = true;
    window.addEventListener('storage', event => {
        if (event.key !== null && ![TOOL_GROUPS_KEY, TOOL_ORDER_STORAGE_KEY].includes(event.key)) return;
        try { if (event.storageArea !== window.localStorage) return; } catch { return; }
        // 未保存的本地编辑保留，用户可主动重试。
        if (toolWorkspace.saveError) return;
        toolWorkspace.layout = readToolGroups(); toolWorkspace.tools = loadToolOrder(TOOLS);
    });
}
export function saveToolPreferences() {
    const groupsSaved = saveToolGroups(toolWorkspace.layout);
    const orderSaved = saveToolOrder(toolWorkspace.tools);
    toolWorkspace.saveError = !groupsSaved || !orderSaved;
}
export function applyToolGroups(layout) { toolWorkspace.layout = normalizeToolGroups(layout); saveToolPreferences(); }
export function setToolGroup(id, groupId) { toolWorkspace.layout = assignToolGroup(toolWorkspace.layout, id, groupId); saveToolPreferences(); }
export function setToolGroupFlag(id, flag, value) {
    if (!['enabled', 'collapsed'].includes(flag)) return;
    toolWorkspace.layout = { ...toolWorkspace.layout, groups: toolWorkspace.layout.groups.map(group => group.id === id ? { ...group, [flag]: value === true } : group) };
    saveToolPreferences();
}
export function moveWorkspaceTool(source, target, position) {
    toolWorkspace.tools = moveTool(toolWorkspace.tools, source, target, position);
    toolWorkspace.layout = assignToolGroup(toolWorkspace.layout, source, toolWorkspace.layout.assignments[target]);
    saveToolPreferences();
}
export function resetToolOrder() { toolWorkspace.tools = [...TOOLS]; saveToolPreferences(); }
