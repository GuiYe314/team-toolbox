import { reactive, readonly } from 'vue';
import { APP_ICON_STORAGE_KEY, DEFAULT_APP_ICON_ID, getAppIcon, readAppIcon, saveAppIcon } from '../utils/app-icon.js';

const state = reactive({ selectedId: DEFAULT_APP_ICON_ID, saveError: false, imageError: false, imageRevision: 0 });
export const appIconState = readonly(state);
let initialized = false;

export function displayedAppIcon() {
    return getAppIcon(state.imageError ? DEFAULT_APP_ICON_ID : state.selectedId);
}

function syncBrowserIcons() {
    const icon = displayedAppIcon();
    const resources = {
        ico: [icon.ico, 'image/x-icon'],
        vector: [icon.vector || icon.favicon, icon.vector ? 'image/svg+xml' : 'image/png'],
        png: [icon.favicon, 'image/png'],
        touch: [icon.touch, 'image/png']
    };
    for (const [name, [href, type]] of Object.entries(resources)) {
        const link = document.querySelector(`link[data-app-icon="${name}"]`);
        if (link) { link.href = href; link.type = type; }
    }
}

export function initAppIcon() {
    if (initialized) return;
    initialized = true;
    state.selectedId = readAppIcon();
    syncBrowserIcons();
    window.addEventListener('storage', event => {
        // sessionStorage 和其它网站的事件不能改变本偏好。
        if (event.key !== null && event.key !== APP_ICON_STORAGE_KEY) return;
        try { if (event.storageArea !== window.localStorage) return; } catch { return; }
        state.selectedId = readAppIcon();
        state.saveError = false;
        state.imageError = false;
        syncBrowserIcons();
    });
}

export function selectAppIcon(id) {
    state.selectedId = getAppIcon(id).id;
    state.imageError = false;
    state.saveError = !saveAppIcon(state.selectedId);
    syncBrowserIcons();
}

export function retryAppIconSave() {
    state.saveError = !saveAppIcon(state.selectedId);
}

export function reportAppIconError(id) {
    if (id !== state.selectedId || id === DEFAULT_APP_ICON_ID) return;
    state.imageError = true;
    syncBrowserIcons();
}

export function retryAppIconImage() {
    state.imageRevision++;
    state.imageError = false;
    syncBrowserIcons();
}
