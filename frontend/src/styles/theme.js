// 主题管理：Light / Dark 切换与持久化。
//
// 设计要点：
//   1. 首次访问读localStorage；未设置则跟随系统 prefers-color-scheme。
//   2. 在 <html> 上设置 data-theme，所有 CSS 变量随之切换，避免闪烁。
//   3. 主题切换只改 CSS 变量，不触发组件重渲染，性能开销极低。

const KEY = 'tt-theme';
let sessionTheme = null;

export const THEMES = ['light', 'dark'];

function systemTheme() {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function savedTheme() {
    try { return localStorage.getItem(KEY); } catch { return null; }
}

/** 读取当前主题：本标签页手动选择、已保存偏好、系统偏好。 */
export function currentTheme() {
    if (sessionTheme) return sessionTheme;
    const saved = savedTheme();
    return THEMES.includes(saved) ? saved : systemTheme();
}

/** 应用主题到 <html>。 */
export function applyTheme(theme) {
    const t = THEMES.includes(theme) ? theme : 'light';
    document.documentElement.setAttribute('data-theme', t);
    // 同步浏览器 UI（如表单控件、滚动条）配色
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', t === 'dark' ? '#090f18' : '#eef1f6');
}

/** 切换并返回新主题。 */
export function toggleTheme() {
    const next = currentTheme() === 'dark' ? 'light' : 'dark';
    sessionTheme = next;
    try { localStorage.setItem(KEY, next); } catch { /* 无法保存时，本标签页仍可切换主题。 */ }
    applyTheme(next);
    return next;
}

/** 初始化：在应用挂载前调用，避免首屏主题闪烁。 */
export function initTheme() {
    applyTheme(currentTheme());
    // 用户未手动选择过时，跟随系统变化
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
        if (!THEMES.includes(savedTheme()) && !sessionTheme) applyTheme(e.matches ? 'dark' : 'light');
    });
}
