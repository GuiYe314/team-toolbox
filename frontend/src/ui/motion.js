import { animateMini as animate } from 'motion-v';

const running = new Map();
let reducedMotion, reducedTransparency;
function blocked() { return document.hidden || reducedMotion?.matches || reducedTransparency?.matches; }
function token(name, fallback) { return Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name)) || fallback; }
export function stopUiMotion(element) { running.get(element)?.(); }
export function stopAllUiMotion() { for (const stop of [...running.values()]) stop(); }

// 所有动效都有最终态和释放路径；页面从不等待退出动画。
function play(element, frames, settle) {
    stopUiMotion(element);
    if (blocked() || !element.isConnected) { settle(); return; }
    let controls, finished = false;
    const finish = () => {
        if (finished) return;
        finished = true; controls?.cancel(); running.delete(element); delete element.dataset.uiMotion; settle();
    };
    const stop = () => finish();
    try {
        element.dataset.uiMotion = 'active';
        controls = animate(element, frames, { type: 'tween', duration: token('--dur-base', 150) / 1000, ease: [0.22, 0.61, 0.36, 1] });
        running.set(element, stop); controls.then(finish, finish);
    } catch { finish(); /* 动效不支持时直接显示最终状态，不阻断控件操作。 */ }
}
function enter(element) {
    const original = { opacity: element.style.opacity, transform: element.style.transform };
    play(element, { opacity: [token('--ui-enter-opacity', 0.75), 1], transform: [`translateY(${token('--ui-enter-distance', 5)}px)`, 'translateY(0px)'] }, () => {
        element.style.opacity = original.opacity; element.style.transform = original.transform;
    });
}
export function moveIndicator(element, left, width, immediate = false) {
    const settle = () => { element.style.left = `${left}px`; element.style.width = `${width}px`; };
    if (immediate) { stopUiMotion(element); settle(); }
    else play(element, { left, width }, settle);
}
const key = value => typeof value === 'object' && value !== null ? value.key : value;
export const uiMotionPlugin = {
    install(app) {
        reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
        reducedTransparency = matchMedia('(prefers-reduced-transparency: reduce)');
        const visibility = () => { if (document.hidden) stopAllUiMotion(); };
        document.addEventListener('visibilitychange', visibility);
        document.addEventListener('dragstart', stopAllUiMotion, true);
        window.addEventListener('pagehide', stopAllUiMotion);
        reducedMotion.addEventListener('change', stopAllUiMotion);
        reducedTransparency.addEventListener('change', stopAllUiMotion);
        app.directive('enter-motion', {
            mounted(el, { value }) { if (!value?.disabled) enter(el); },
            updated(el, binding) { if (binding.value?.disabled) stopUiMotion(el); else if (key(binding.value) !== key(binding.oldValue)) enter(el); },
            beforeUnmount: stopUiMotion,
        });
        app.onUnmount(() => {
            stopAllUiMotion(); document.removeEventListener('visibilitychange', visibility);
            document.removeEventListener('dragstart', stopAllUiMotion, true); window.removeEventListener('pagehide', stopAllUiMotion);
            reducedMotion.removeEventListener('change', stopAllUiMotion); reducedTransparency.removeEventListener('change', stopAllUiMotion);
        });
    },
};
