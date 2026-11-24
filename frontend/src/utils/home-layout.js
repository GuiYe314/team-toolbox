import { TOOLS } from './tool-catalog.js';

export const HOME_LAYOUT_KEY = 'team-toolbox-home-layout-v1';
export const HOME_SHORTCUT_LIMIT = 50;
export const homeShortcuts = [
    { id: 'module:kb', name: '知识库', desc: '浏览和管理团队文档', routeName: 'kb-list' },
    { id: 'module:projects', name: '项目管理', desc: '查看项目进度和待办事项', routeName: 'project-management' },
    { id: 'module:assets', name: '资源管理', desc: '浏览图片、视频和文件', routeName: 'assets' },
    { id: 'module:tools', name: '工具箱', desc: '打开完整工具目录', routeName: 'tools' },
    ...TOOLS.map(tool => ({ ...tool, id: 'tool:' + tool.id, toolId: tool.id }))
];
const builtin = new Map(homeShortcuts.map(item => [item.id, item]));

function documentId(key) {
    if (!/^doc:[1-9]\d{0,15}$/.test(key)) return null;
    const id = Number(key.slice(4));
    return Number.isSafeInteger(id) ? id : null;
}

export function resolveHomeShortcut(key, documents) {
    const known = builtin.get(key);
    if (known) return known;
    const id = documentId(key);
    if (!id) return null;
    const doc = documents.get(id);
    return { id: key, name: doc?.title || '文档 #' + id, desc: '知识库文档', routeName: 'kb-detail', params: { id } };
}

export function normalizeHomeLayout(value) {
    if (value?.version !== 1 || !Array.isArray(value.shortcuts)) {
        return { version: 1, shortcuts: [], showRecent: false };
    }
    const keys = new Set();
    for (const key of value.shortcuts) {
        if (typeof key === 'string' && (builtin.has(key) || documentId(key))) keys.add(key);
        if (keys.size === HOME_SHORTCUT_LIMIT) break;
    }
    return { version: 1, shortcuts: [...keys], showRecent: value.showRecent === true };
}

export function readHomeLayout() {
    try {
        return normalizeHomeLayout(JSON.parse(window.localStorage.getItem(HOME_LAYOUT_KEY)));
    } catch {
        return normalizeHomeLayout(null);
    }
}

export function saveHomeLayout(value) {
    try {
        window.localStorage.setItem(HOME_LAYOUT_KEY, JSON.stringify(normalizeHomeLayout(value)));
        return true;
    } catch {
        return false;
    }
}
