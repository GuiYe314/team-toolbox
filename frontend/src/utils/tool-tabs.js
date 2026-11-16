import { TOOLS } from './tool-catalog.js';

export const TOOL_TABS_KEY = 'team-toolbox-open-tools-v1';
export function normalizeToolTabs(value) {
    if (!Array.isArray(value)) return [];
    return [...new Set(value.filter(id => TOOLS.some(tool => tool.id === id)))];
}
export function openToolTab(ids, id) { return normalizeToolTabs([...ids, id]); }
export function closeToolTab(ids, id, activeId) {
    const current = normalizeToolTabs(ids), index = current.indexOf(id);
    if (index < 0) return { ids: current, activeId };
    const next = current.filter(value => value !== id);
    return { ids: next, activeId: activeId === id ? (next[Math.max(0, index - 1)] || 'toolbox') : activeId };
}
function storageOrDefault(storage) {
    if (storage !== undefined) return storage;
    try { return globalThis.sessionStorage; } catch { return null; }
}
export function readToolTabs(storage) {
    try { return normalizeToolTabs(JSON.parse(storageOrDefault(storage)?.getItem(TOOL_TABS_KEY) || '[]')); }
    catch { return []; }
}
export function saveToolTabs(ids, storage) {
    try { const target = storageOrDefault(storage); if (!target) return false; target.setItem(TOOL_TABS_KEY, JSON.stringify(normalizeToolTabs(ids))); return true; }
    catch { return false; }
}
