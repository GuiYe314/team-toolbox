/**
 * 工具卡片排序的个人界面偏好。
 * 工具定义仍由代码维护，浏览器只保存一组工具 id；新增工具会自动追加。
 */
export const TOOL_ORDER_STORAGE_KEY = 'team-toolbox-tool-order-v1';

function usableStorage(storage) {
    if (storage) return storage;
    try { return globalThis.localStorage; } catch { return null; }
}

/** 读取并过滤浏览器中保存的工具 id。 */
export function readToolOrder(storage) {
    const source = usableStorage(storage);
    if (!source) return [];
    try {
        const value = JSON.parse(source.getItem(TOOL_ORDER_STORAGE_KEY) || '[]');
        return Array.isArray(value)
            ? value.filter((id, index) => typeof id === 'string' && id.length > 0 && value.indexOf(id) === index)
            : [];
    } catch {
        return [];
    }
}

/** 按保存的 id 排列工具；未知/重复 id 被忽略，新工具自动追加。 */
export function orderTools(tools, savedIds = []) {
    const byId = new Map(tools.map((tool) => [tool.id, tool]));
    const ordered = [];
    const used = new Set();
    for (const id of savedIds) {
        if (!used.has(id) && byId.has(id)) {
            ordered.push(byId.get(id));
            used.add(id);
        }
    }
    for (const tool of tools) {
        if (!used.has(tool.id)) ordered.push(tool);
    }
    return ordered;
}

/** 使用当前浏览器保存工具 id 顺序；失败时不影响卡片使用。 */
export function saveToolOrder(tools, storage) {
    const target = usableStorage(storage);
    if (!target) return false;
    try {
        target.setItem(TOOL_ORDER_STORAGE_KEY, JSON.stringify(tools.map((tool) => tool.id)));
        return true;
    } catch {
        return false;
    }
}

/** 读取保存的顺序并应用到工具定义。 */
export function loadToolOrder(tools, storage) {
    return orderTools(tools, readToolOrder(storage));
}

/** 把 sourceId 放到 targetId 前面或后面；不修改原数组。 */
export function moveTool(tools, sourceId, targetId, position = 'before') {
    if (!sourceId || !targetId || sourceId === targetId) return tools.slice();
    const sourceIndex = tools.findIndex((tool) => tool.id === sourceId);
    const targetIndex = tools.findIndex((tool) => tool.id === targetId);
    if (sourceIndex < 0 || targetIndex < 0) return tools.slice();
    const next = tools.slice();
    const [item] = next.splice(sourceIndex, 1);
    const insertion = next.findIndex((tool) => tool.id === targetId) + (position === 'after' ? 1 : 0);
    next.splice(insertion, 0, item);
    return next;
}
