/**
 * v-hint：延迟 1 秒的悬停提示（tooltip）
 *
 * ── 为什么需要它，而不是直接用原生 title─────────────────────────
 * 1. 原生 title 的气泡样式由浏览器决定，深色主题下常是白底黑字，与设计体系不合；
 * 2. 原生 title 几乎立刻弹出，鼠标扫过一排按钮时会连闪一片，反而干扰阅读；
 * 3. 原生 title 无法承载「操作说明」以外的内容（如快捷键、状态）。
 *
 * ── 延迟 1 秒的理由 ──────────────────────────────────────────────
 * 鼠标在密集图标之间移动时路径是连续的，若悬停即显示，
 * 任何一次「路过」都会触发气泡。要让气泡只对「有意停留」的元素出现，
 * 就必须引入足够长的延迟（业界惯例 500~1500ms，本项目取 1000ms）。
 *
 * ── 为什么用指令而不是改每个模板 ──────────────────────────────────
 * 全项目图标按钮分散在 6 个文件、各自有不同的 class（icon-btn / nt-btn /
 * mini-btn / mode-btn / lock-btn …）。逐个包组件极易遗漏，且以后新增按钮
 * 又要记得手动加。指令只要在按钮上留title / aria-label 即可自动生效。
 */
/** 延迟时长：与产品动效规范一致（120~180ms 是动效，这是「意图等待」，可以更长） */
const DELAY = 1000;
/** 移出后的收尾延迟：给用户一点缓冲，避免掠过时闪一下 */
const HIDE_DELAY = 120;

/** 纯图标按钮的class 白名单。
 *  刻意**不含**带可见文字的按钮：那些文字已经说明了作用，
 *  再弹气泡是冗余信息，且会让界面显得聒噪。 */
const ICON_BTN_CLASSES = [
    'icon-btn',
    'mini-btn',
    'nt-ghost',
    'mode-btn',
    'lock-btn',
    'more-btn',
    'side-add',
    'link-btn',
    'tree-act',      // 页面树节点上的操作按钮
    'theme-toggle',// 左下角主题切换
    'btn-copy'      // 复制按钮
];

/**
 * 判断元素是否是「无可见文字的图标按钮」。
 * 判据：命中按钮 class，且自身文本内容为空（图标都是 svg，不产生文本节点）。
 *
 * 例外：ALLOW_TEXT_CLASSES 里的按钮虽有文字，但仍接管。
 * 用于「文字 + title 里藏着补充说明」的场景——
 * 例如「插入图片」按钮，可见文字只有4 个字，但 title 里有
 * 「也可直接粘贴截图或拖入图片」这类放不下的操作提示。
 */
const ALLOW_TEXT_CLASSES = [
    'mode-btn-tool'
];

function isIconButton(el) {
    if (!el || el.nodeType !== 1) return false;
    if (!el.matches('button, [role="button"], a[href]')) return false;
    // 有可见文字 → 默认不接管，除非在例外名单里
    if ((el.textContent || '').trim() && !ALLOW_TEXT_CLASSES.some((c) => el.classList.contains(c))) {
        return false;
    }
    return ICON_BTN_CLASSES.some((c) => el.classList.contains(c));
}

let uid = 0;

function mount(el, binding) {
    // 无提示内容、或不是图标按钮 → 不接管，保留原生行为
    const text = binding.value || el.getAttribute('title') || el.getAttribute('aria-label');
    if (!text || !isIconButton(el)) return;

    // 关键：移除原生 title。
    // 否则会出现「1 秒后出现我们的气泡，同时浏览器原生气泡也弹出」的双气泡。
    el.removeAttribute('title');

    // 补 aria-label：纯图标按钮如果只有 title，屏幕阅读器读不到按钮名
    // （title 在多数读屏里被当作「描述」而非「名称」）。移除 title 前先落一份。
    if (!el.hasAttribute('aria-label')) el.setAttribute('aria-label', text);

    // ── 防「动态 :title 被 Vue 写回来」────────────────────────────────────
    // 模板里写的是 :title="cond ? 'A' : 'B'"。指令只在 mounted 移除一次属性，
    // 但 Vue 在条件变化后会把新值重新 patch 回 DOM —— 原生气泡会重新冒出来（双气泡），
    // 且我们存下的文案变陈旧。这里用 MutationObserver 盯住 title：
    // 一旦被写回，先把新文案收进 source，再立刻移除。
    let source = text;
    const hadAria = el.hasAttribute('aria-label');
    const titleWatcher = new MutationObserver(() => {
        const t = el.getAttribute('title');
        if (!t) return;
        source = t;
        el.removeAttribute('title');
        // aria-label 若原本就有（模板作者显式写的），保持与文案同步；
        // 若是我们补的，也一并更新，否则读屏拿到的名字会停在旧状态。
        if (hadAria || el.hasAttribute('aria-label')) el.setAttribute('aria-label', source);
    });
    titleWatcher.observe(el, { attributes: true, attributeFilter: ['title'] });

    const id = `vhint-${++uid}`;
    el.setAttribute('data-vhint', id);
    const tip = document.createElement('div');
    tip.className = 'vhint';
    tip.id = id;
    tip.setAttribute('role', 'tooltip');
    tip.textContent = text;
    tip.style.display = 'none';
    document.body.appendChild(tip);

    let showTimer = null;
    let hideTimer = null;
    let visible = false;

    const place = () => {
        const r = el.getBoundingClientRect();
        const tw = tip.offsetWidth;
        const th = tip.offsetHeight;
        const cx = r.left + r.width / 2;

        // 水平：先按锚点居中，贴边时用 --vhint-shift 做补偿
        // （不能直接改 transform：那会覆盖 .is-in 的垂直位移）
        tip.style.left = `${cx}px`;
        tip.style.setProperty('--vhint-shift', '0px');
        const half = tw / 2;
        if (cx - half < 8) {
            tip.style.setProperty('--vhint-shift', `${Math.round(half + 8 - cx)}px`);
        } else if (cx + half > window.innerWidth - 8) {
            tip.style.setProperty('--vhint-shift', `${Math.round(window.innerWidth - 8 - half - cx)}px`);
        }

        // 垂直：默认在下方，空间不够翻到上方
        const below = r.bottom + 8;
        tip.style.top = `${below + th > window.innerHeight - 8 ? r.top - th - 8 : below}px`;
    };

    const show = () => {
        clearTimeout(hideTimer);
        // 每次显示前重读文案：同一个按钮的提示语会随状态变化
        // （如「隐藏页面栏」↔「显示页面栏」）。source 由 titleWatcher 持续同步。
        if (source) tip.textContent = source;
        // 首次显示前不transition，避免从 opacity:0 位置闪一下
        tip.style.display = 'block';
        tip.classList.remove('is-in');
        place();
        // 强制回流后再加is-in，确保过渡真的发生
        void tip.offsetHeight;
        tip.classList.add('is-in');
        visible = true;
    };

    const hide = () => {
        clearTimeout(showTimer);
        if (!visible) return;
        visible = false;
        tip.classList.remove('is-in');
        hideTimer = setTimeout(() => {
            if (!visible) tip.style.display = 'none';
        }, HIDE_DELAY);
    };

    const onEnter = () => {
        clearTimeout(hideTimer);
        clearTimeout(showTimer);
        showTimer = setTimeout(show, DELAY);
    };
    const onLeave = () => {
        clearTimeout(showTimer);
        hide();
    };
    const onFocus = () => {
        // 键盘可达的按钮：聚焦立即显示（无障碍场景不该让用户等 1 秒）
        clearTimeout(showTimer);
        show();
    };
    const onBlur = () => {
        clearTimeout(showTimer);
        hide();
    };
    // 页面滚动时位置会变，直接隐藏比每帧重算更省
    const onScroll = () => { if (visible) hide(); };

    el.addEventListener('mouseenter', onEnter);
    el.addEventListener('mouseleave', onLeave);
    el.addEventListener('focus', onFocus);
    el.addEventListener('blur', onBlur);
    el.addEventListener('click', onLeave);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);

    // 供卸载时清理。
    // tip 一并暴露：页面上同时存在多个气泡，调试/验收必须能按「触发它的那个元素」
    // 精确定位，否则 document.querySelector('.vhint') 取到的会是别的按钮的气泡。
    el.__vhint = { tip, get text() { return source; }, destroy: () => {
        clearTimeout(showTimer);
        clearTimeout(hideTimer);
        titleWatcher.disconnect();
        el.removeEventListener('mouseenter', onEnter);
        el.removeEventListener('mouseleave', onLeave);
        el.removeEventListener('focus', onFocus);
        el.removeEventListener('blur', onBlur);
        el.removeEventListener('click', onLeave);
        window.removeEventListener('scroll', onScroll, true);
        window.removeEventListener('resize', onScroll);
        tip.remove();
    } };
}

function unmount(el) {
    if (el.__vhint) {
        el.__vhint.destroy();
        el.__vhint = null;
    }
}

/**
 * 指令对象。
 * 不要用 defineDirective 包装——它不是 Vue 的公开 API，运行时不存在，
 * 会抛「does not provide an export named 'defineDirective'」并让整个应用挂载失败。
 * 自定义指令就是个普通对象，直接写mounted / unmounted 即可。
 */
export const vHint = { mounted: mount, unmounted: unmount };

export default { install(app) { app.directive('hint', vHint); } };