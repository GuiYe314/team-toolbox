// 应用图标是个人界面偏好，只保存内置 ID，不接受资源 URL。
export const APP_ICON_STORAGE_KEY = 'team-toolbox-app-icon-v1';
export const DEFAULT_APP_ICON_ID = 'graphite-06';

function catIcon(id, file, name, description) {
    const base = `/icons/ink-cat/${file}`;
    return { id, name, description, image: `${base}-256.png`, favicon: `${base}-32.png`, touch: `${base}-180.png`, ico: `${base}.ico` };
}

export const APP_ICONS = Object.freeze([
    { id: DEFAULT_APP_ICON_ID, name: '06 石墨字标', description: '经典 TT · 默认图标', image: '/icons/brand.svg', vector: '/icons/brand.svg', favicon: '/icons/brand-32.png', touch: '/icons/brand-180.png', ico: '/icons/favicon.ico' },
    catIcon('ink-cat-silhouette', '01-ink-cat-silhouette', '墨猫剪影', '浅色玻璃 · 黑猫剪影'),
    catIcon('white-cat-smoke', '02-white-cat-smoke', '雪猫烟墨', '深色烟墨 · 白猫头像'),
    catIcon('cat-ink-circle', '03-cat-ink-circle', '圆墨小猫', '水墨圆环 · 安静小猫'),
    catIcon('cat-window', '04-cat-window', '窗边小猫', '灰色磨砂 · 窗边小猫')
].map(Object.freeze));

export function getAppIcon(id) {
    return APP_ICONS.find(icon => icon.id === id) || APP_ICONS[0];
}

function usableStorage(storage) {
    if (storage !== undefined) return storage;
    try { return globalThis.localStorage; } catch { return null; }
}

export function readAppIcon(storage) {
    try { return getAppIcon(usableStorage(storage)?.getItem(APP_ICON_STORAGE_KEY)).id; }
    catch { return DEFAULT_APP_ICON_ID; }
}

export function saveAppIcon(id, storage) {
    if (!APP_ICONS.some(icon => icon.id === id)) return false;
    try {
        const target = usableStorage(storage);
        if (!target) return false;
        target.setItem(APP_ICON_STORAGE_KEY, id);
        return true;
    } catch { return false; }
}
