import { TOOLS } from './tool-catalog.js';

export const TOOL_GROUPS_KEY = 'team-toolbox-tool-groups-v1';
export const UNGROUPED_ID = 'ungrouped';
export const MAX_GROUPS = 16;
const presets = [['media', '媒体与相册'], ['network', '网络工具'], ['devices', '设备调试'], ['everyday', '常用工具']];
const fallback = () => ({ id: UNGROUPED_ID, name: '未分组', enabled: true, collapsed: false });
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export function defaultToolGroups() {
    return { version: 1, groups: [...presets.map(([id, name]) => ({ id, name, enabled: true, collapsed: false })), fallback()], assignments: Object.fromEntries(TOOLS.map(tool => [tool.id, tool.group])) };
}

export function normalizeToolGroups(value) {
    if (!object(value) || value.version !== 1 || !Array.isArray(value.groups) || value.groups.length > MAX_GROUPS) return defaultToolGroups();
    const groups = [], ids = new Set(), names = new Set();
    for (const item of value.groups) {
        if (!object(item) || typeof item.id !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(item.id) || ids.has(item.id)) continue;
        if (item.id !== UNGROUPED_ID && typeof item.name !== 'string') continue;
        const name = item.id === UNGROUPED_ID ? '未分组' : item.name.trim();
        const key = name.normalize('NFKC').toLowerCase();
        if (!name || name.length > 24 || names.has(key) || (item.id !== UNGROUPED_ID && key === '未分组')) continue;
        if (groups.length === MAX_GROUPS - 1 && item.id !== UNGROUPED_ID && !ids.has(UNGROUPED_ID)) continue;
        groups.push({ id: item.id, name, enabled: item.enabled !== false, collapsed: item.collapsed === true });
        ids.add(item.id); names.add(key);
    }
    if (value.groups.length && !groups.length) return defaultToolGroups();
    if (!ids.has(UNGROUPED_ID)) { groups.push(fallback()); ids.add(UNGROUPED_ID); }
    const assigned = object(value.assignments) ? value.assignments : {};
    const assignments = Object.fromEntries(TOOLS.map(tool => {
        const candidate = Object.hasOwn(assigned, tool.id) ? assigned[tool.id] : tool.group;
        return [tool.id, ids.has(candidate) ? candidate : UNGROUPED_ID];
    }));
    return { version: 1, groups, assignments };
}

function storageOrDefault(storage) {
    if (storage !== undefined) return storage;
    try { return globalThis.localStorage; } catch { return null; }
}
export function readToolGroups(storage) {
    try { return normalizeToolGroups(JSON.parse(storageOrDefault(storage)?.getItem(TOOL_GROUPS_KEY) || 'null')); }
    catch { return defaultToolGroups(); }
}
export function saveToolGroups(value, storage) {
    try { const target = storageOrDefault(storage); if (!target) return false; target.setItem(TOOL_GROUPS_KEY, JSON.stringify(normalizeToolGroups(value))); return true; }
    catch { return false; }
}
export const groupForTool = (layout, id) => layout.assignments[id] || UNGROUPED_ID;
export const toolIsEnabled = (layout, id) => layout.groups.find(group => group.id === groupForTool(layout, id))?.enabled === true;

export function assignToolGroup(layout, toolId, groupId) {
    if (!TOOLS.some(tool => tool.id === toolId) || !layout.groups.some(group => group.id === groupId)) return layout;
    return { ...layout, assignments: { ...layout.assignments, [toolId]: groupId } };
}
export function deleteToolGroup(layout, groupId) {
    if (groupId === UNGROUPED_ID) return layout;
    return { ...layout, groups: layout.groups.filter(group => group.id !== groupId), assignments: Object.fromEntries(Object.entries(layout.assignments).map(([id, assigned]) => [id, assigned === groupId ? UNGROUPED_ID : assigned])) };
}
export function groupNameError(name, groups, exceptId = '') {
    const text = String(name || '').trim();
    if (!text || text.length > 24) return '分组名称请输入1～24个字符';
    if (groups.some(group => group.id !== exceptId && group.name.trim().normalize('NFKC').toLowerCase() === text.normalize('NFKC').toLowerCase())) return '已有同名分组，请换一个名称';
    return '';
}
