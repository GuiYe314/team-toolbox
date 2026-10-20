// Vditor 资源加载器（共享）。
//
// 为什么抽出来：
//   原来这段逻辑内嵌在 MarkdownEditor.vue 里，只有编辑页能用。
//   资源管理的「Markdown 预览」也需要 Vditor，若复制一份就会出现
//   两个 loader、两套 Promise 去重逻辑，并发时可能重复注入脚本。
//   抽成模块后编辑页与预览页共用同一个 loaderPromise，
//   无论谁先加载都只注入一次 <link>/<script>。
//
// Vditor 4.x 的路径约定（踩过的坑，改动前务必确认）：
//   内部固定在 cdn 值后拼接 `/dist/js/...` 与 `/dist/css/...`，
//   所以 cdn 必须填到 `/vendor/vditor`，主样式也必须引
//   `/vendor/vditor/dist/index.css`，不能引 `/vendor/vditor/index.css`。

let loaderPromise = null;

/**
 * 按需加载 Vditor 的 UMD 脚本与样式。
 * @returns {Promise<any>} Vditor 构造器（挂载在 window.Vditor）
 */
export function loadVditor() {
    if (window.Vditor) return Promise.resolve(window.Vditor);
    if (loaderPromise) return loaderPromise;

    loaderPromise = new Promise((resolve, reject) => {
        if (!document.querySelector('link[data-vditor-css]')) {
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = '/vendor/vditor/dist/index.css';
            link.dataset.vditorCss = '1';
            document.head.appendChild(link);
        }
        const script = document.createElement('script');
        script.src = '/vendor/vditor/dist/index.min.js';
        script.async = true;
        script.onload = () => {
            if (window.Vditor) resolve(window.Vditor);
            else reject(new Error('Vditor 脚本已加载但未挂载全局对象'));
        };
        script.onerror = () => {
            // 允许重试：清空缓存的 Promise，下次调用会重新注入
            loaderPromise = null;
            reject(new Error('编辑器资源加载失败，请确认 /vendor/vditor/ 已正确部署'));
        };
        document.head.appendChild(script);
    });
    return loaderPromise;
}

export default loadVditor;