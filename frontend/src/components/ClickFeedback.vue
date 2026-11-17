<template>
    <!-- 独立绘制，不给原按钮增加 overflow/定位/子节点，避免裁掉下拉与焦点。 -->
    <Teleport to="body">
        <div v-for="effect in effects" :key="effect.id" class="click-feedback" :class="{ 'click-feedback--primary': effect.primary }" :style="effect.frame" aria-hidden="true">
            <span class="click-feedback-wave" :style="effect.wave" @animationend="remove(effect.id)"></span>
        </div>
    </Teleport>
</template>

<script setup>
import { nextTick, onBeforeUnmount, onMounted, shallowRef, watch } from 'vue';
import { useRoute } from 'vue-router';

const route = useRoute(), effects = shallowRef([]), timers = new Map();
const selector = 'button, [role="button"], [role="tab"], a.nav-item, a.btn, a.nt-btn, a.nt-ghost';
const excluded = '[data-click-feedback="off"], .vditor, .excalidraw, .monaco-editor';
const maxEffects = 4;
let nextId = 0, pruneFrame = 0, motion, transparency;

function remove(id) {
    clearTimeout(timers.get(id)); timers.delete(id);
    effects.value = effects.value.filter(effect => effect.id !== id);
}
function clear() {
    cancelAnimationFrame(pruneFrame); pruneFrame = 0;
    for (const effect of effects.value) remove(effect.id);
}
function prune() {
    effects.value = effects.value.map(effect => {
        const rect = effect.target.getBoundingClientRect();
        const frame = effect.target.isConnected && rect.width && rect.height ? frameFor(effect.target, rect) : null;
        if (frame) return { ...effect, frame };
        clearTimeout(timers.get(effect.id)); timers.delete(effect.id); return null;
    }).filter(Boolean);
}
function targetFor(event) {
    if (document.hidden || motion?.matches || transparency?.matches) return null;
    if (!(event.target instanceof Element) || event.target.closest('input, textarea, select, [contenteditable="true"]')) return null;
    const target = event.target.closest(selector);
    if (!target || target.closest(excluded) || target.matches(':disabled') || target.closest('[aria-disabled="true"], [inert]')) return null;
    return target;
}
function frameFor(target, rect) {
    // body绘制仍遵守原滚动容器的裁切，避免半露出的按钮把波纹画到相邻面板。
    const visible = { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
    for (let parent = target.parentElement; parent; parent = parent.parentElement) {
        const parentStyle = getComputedStyle(parent), bounds = parent.getBoundingClientRect();
        if (/(hidden|clip|auto|scroll)/.test(parentStyle.overflowX)) {
            visible.left = Math.max(visible.left, bounds.left + parent.clientLeft);
            visible.right = Math.min(visible.right, bounds.left + parent.clientLeft + parent.clientWidth);
        }
        if (/(hidden|clip|auto|scroll)/.test(parentStyle.overflowY)) {
            visible.top = Math.max(visible.top, bounds.top + parent.clientTop);
            visible.bottom = Math.min(visible.bottom, bounds.top + parent.clientTop + parent.clientHeight);
        }
    }
    if (visible.right <= rect.left || visible.left >= rect.right || visible.bottom <= rect.top || visible.top >= rect.bottom) return null;
    return {
        left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px`, borderRadius: getComputedStyle(target).borderRadius,
        clipPath: `inset(${Math.max(0, visible.top - rect.top)}px ${Math.max(0, rect.right - visible.right)}px ${Math.max(0, rect.bottom - visible.bottom)}px ${Math.max(0, visible.left - rect.left)}px)`
    };
}
function show(target, event, keyboard) {
    const rect = target.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const frame = frameFor(target, rect);
    if (!frame) return;
    const x = keyboard ? rect.width / 2 : Math.max(0, Math.min(rect.width, event.clientX - rect.left));
    const y = keyboard ? rect.height / 2 : Math.max(0, Math.min(rect.height, event.clientY - rect.top));
    const diameter = Math.hypot(Math.max(x, rect.width - x), Math.max(y, rect.height - y)) * 2;
    for (const effect of effects.value) if (effect.target === target) remove(effect.id);
    while (effects.value.length >= maxEffects) remove(effects.value[0].id);
    const id = ++nextId;
    effects.value = [...effects.value, {
        id, target, frame,
        primary: target.matches('.btn-primary, .nt-btn-primary'),
        wave: { left: `${x}px`, top: `${y}px`, width: `${diameter}px`, height: `${diameter}px` }
    }];
    // animationend 在减少动态、后台或目标消失时可能不触发，定时器作为有界回收保障。
    const token = getComputedStyle(document.documentElement).getPropertyValue('--dur-click-feedback').trim();
    const milliseconds = parseFloat(token) * (token.endsWith('ms') ? 1 : 1000);
    const duration = Number.isFinite(milliseconds) ? Math.max(120, Math.min(180, milliseconds)) : 180;
    timers.set(id, setTimeout(() => remove(id), duration));
    // 原生事件在捕获/目标监听器之间可能刷新微任务；下一帧才能确认业务操作后目标仍存在。
    if (!pruneFrame) pruneFrame = requestAnimationFrame(() => { pruneFrame = 0; prune(); });
}
function onClick(event) {
    if (event.button !== 0) return;
    const target = targetFor(event);
    if (target) show(target, event, event.detail === 0);
}
function onKey(event) {
    if (event.repeat || !['Enter', ' '].includes(event.key)) return;
    const target = targetFor(event);
    // 原生按钮/链接由浏览器产生 click；只有自定义 role 按钮需要额外的键盘反馈。
    if (target && !target.matches('button, a') && event.target === target) show(target, event, true);
}
function onVisibility() { if (document.hidden) clear(); }
function onPreference() { if (motion?.matches || transparency?.matches) clear(); }
watch(() => route.fullPath, () => nextTick(prune), { flush: 'post' });
onMounted(() => {
    motion = matchMedia('(prefers-reduced-motion: reduce)');
    transparency = matchMedia('(prefers-reduced-transparency: reduce)');
    motion.addEventListener('change', onPreference); transparency.addEventListener('change', onPreference);
    // 捕获仅用于观察 .stop 按钮；不阻止默认动作、不重放事件、不修改业务状态。
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('scroll', clear, true);
    window.addEventListener('resize', clear);
    window.addEventListener('pagehide', clear);
    document.addEventListener('dragstart', clear, true);
});
onBeforeUnmount(() => {
    clear();
    motion?.removeEventListener('change', onPreference); transparency?.removeEventListener('change', onPreference);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('scroll', clear, true);
    window.removeEventListener('resize', clear);
    window.removeEventListener('pagehide', clear);
    document.removeEventListener('dragstart', clear, true);
});
</script>
