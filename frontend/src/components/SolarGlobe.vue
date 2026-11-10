<template>
    <div class="solar-canvas-wrap">
        <div class="solar-globe-viewport" :data-mode="mode" :aria-busy="mode === 'loading'">
            <div v-show="mode !== 'fallback'" ref="host" class="solar-globe solar-webgl" tabindex="0" role="img"
                :aria-label="`可拖动、缩放或用方向键旋转的三维地球，太阳直射点：${coordinateText}`"
                :data-view-longitude="viewLongitude.toFixed(2)" :data-view-latitude="viewLatitude.toFixed(2)"
                :data-solar-latitude="solar.subsolarLatitude.toFixed(3)" :data-solar-longitude="solar.subsolarLongitude.toFixed(3)"
                :data-altitude="viewAltitude.toFixed(2)" @keydown="onKeydown" @pointerdown="focusGlobe" />
            <SolarGlobeFallback v-if="mode === 'fallback'" :solar="solar" :view-latitude="viewLatitude" :view-longitude="viewLongitude"
                @rotate="emit('rotate', $event)" @reset="emit('reset')" />
            <p v-if="mode === 'loading'" class="solar-loading" role="status">正在加载地球与本地贴图…</p>
            <div v-if="mode === 'webgl'" class="solar-annotations" aria-label="地球纬线与太阳标注">
                <span v-for="label in annotations" :key="label.id" v-show="label.visible" class="solar-map-label" :class="`solar-label-${label.kind}`"
                    :data-guide="label.id" :data-latitude="label.latitude" :data-visible="label.visible"
                    :style="{ left: `${label.x}px`, top: `${label.y}px` }">{{ label.name }}<small v-if="label.coordinate">{{ label.coordinate }}</small></span>
            </div>
            <div v-if="mode === 'webgl'" class="solar-zoom-controls" aria-label="地球缩放">
                <button id="solar-zoom-in" class="btn btn-sm" type="button" aria-label="放大地球" :disabled="viewAltitude <= minAltitude + 0.01" @click="zoom(-0.3)"><svg class="icon icon-sm" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg></button>
                <button id="solar-zoom-out" class="btn btn-sm" type="button" aria-label="缩小地球" :disabled="viewAltitude >= maxAltitude - 0.01" @click="zoom(0.3)"><svg class="icon icon-sm" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14" /></svg></button>
            </div>
        </div>
        <p v-if="mode === 'fallback'" class="solar-fallback-note" role="status">{{ error }}<button id="solar-retry" type="button" class="btn btn-sm" @click="start">重试三维显示</button></p>
    </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import SolarGlobeFallback from './SolarGlobeFallback.vue';
import { formatLatitude, formatLongitude, normalizeLongitude } from '../utils/solar-position.js';
import { MIN_GLOBE_ALTITUDE as minAltitude, MAX_GLOBE_ALTITUDE as maxAltitude } from '../utils/solar-geometry.js';

const props = defineProps({ solar: { type: Object, required: true }, viewLatitude: { type: Number, required: true },
    viewLongitude: { type: Number, required: true }, viewAltitude: { type: Number, required: true }, resetKey: { type: Number, default: 0 } });
const emit = defineEmits(['rotate', 'reset', 'zoom', 'mode']);
const host = ref(null), mode = ref('loading'), error = ref('');
const annotations = ref([]);
const coordinateText = computed(() => `${formatLatitude(props.solar.subsolarLatitude)}，${formatLongitude(props.solar.subsolarLongitude)}`);
let renderer, controller, resizeObserver, themeObserver, generation = 0, unmounted = false;

function readColors() {
    const style = getComputedStyle(host.value);
    const value = name => style.getPropertyValue(`--solar-${name}`).trim();
    return { atmosphere: value('atmosphere'), transparent: value('transparent'), cloud: value('cloud'), twilight: value('twilight'),
        stars: value('stars'), marker: value('marker'), sun: value('sun'), sunCore: value('sun-core'), sunRim: value('sun-rim'),
        sunCorona: value('sun-corona'), equator: value('equator'), tropic: value('tropic'), terminator: value('terminator'), ray: value('ray') };
}
function viewChanged(view) {
    if (unmounted || mode.value !== 'webgl') return;
    const longitude = normalizeLongitude(view.lng - props.viewLongitude), latitude = view.lat - props.viewLatitude;
    if (Math.abs(longitude) + Math.abs(latitude) > 0.00001) emit('rotate', { longitude, latitude });
    if (Math.abs(view.altitude - props.viewAltitude) > 0.00001) emit('zoom', view.altitude);
}
function stop() { controller?.abort(); controller = null; renderer?.dispose(); renderer = null; annotations.value = []; }
function fail(reason, current) {
    if (unmounted || current !== generation) return;
    console.warn('地球三维视图已降级：', reason);
    stop();
    error.value = reason.message?.includes('已切换') ? reason.message : '地球贴图未能加载，已切换为简化示意。';
    mode.value = 'fallback';
}
async function start() {
    const current = ++generation;
    stop(); mode.value = 'loading'; error.value = '';
    const request = new AbortController(); controller = request;
    try {
        const { createRealisticGlobe } = await import('../utils/solar-globe-3d.js');
        if (unmounted || request.signal.aborted) return;
        // v-show 从降级恢复时先让 Vue 还原宿主尺寸。
        await nextTick();
        const instance = await createRealisticGlobe(host.value, { signal: request.signal, colors: readColors(), onViewChange: viewChanged,
            onAnnotations: labels => { if (!unmounted && current === generation) annotations.value = labels; },
            onError: reason => fail(reason, current) });
        if (unmounted || request.signal.aborted || current !== generation) { instance.dispose(); return; }
        renderer = instance;
        renderer.updateTheme(readColors());
        renderer.setSolar(props.solar);
        renderer.setView(props.viewLatitude, props.viewLongitude, props.viewAltitude);
        renderer.setVisible(!document.hidden);
        renderer.resize();
        mode.value = 'webgl';
    } catch (reason) { if (!request.signal.aborted) fail(reason, current); }
}
function focusGlobe() { host.value?.focus({ preventScroll: true }); }
function zoom(change) { emit('zoom', Math.max(minAltitude, Math.min(maxAltitude, props.viewAltitude + change))); }
function onKeydown(event) {
    const rotations = { ArrowLeft: { longitude: -15, latitude: 0 }, ArrowRight: { longitude: 15, latitude: 0 }, ArrowUp: { longitude: 0, latitude: 10 }, ArrowDown: { longitude: 0, latitude: -10 } };
    if (rotations[event.key]) { event.preventDefault(); emit('rotate', rotations[event.key]); }
    if (event.key === 'Home') { event.preventDefault(); emit('reset'); }
    if (event.key === '+' || event.key === '=') { event.preventDefault(); zoom(-0.3); }
    if (event.key === '-') { event.preventDefault(); zoom(0.3); }
}
function visibilityChanged() { renderer?.setVisible(!document.hidden); }
watch(mode, value => emit('mode', value));
watch(() => props.solar, solar => renderer?.setSolar(solar));
watch(() => [props.viewLatitude, props.viewLongitude, props.viewAltitude, props.resetKey], () => renderer?.setView(props.viewLatitude, props.viewLongitude, props.viewAltitude));
onMounted(() => {
    resizeObserver = new ResizeObserver(() => renderer?.resize()); resizeObserver.observe(host.value);
    themeObserver = new MutationObserver(() => renderer?.updateTheme(readColors()));
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    document.addEventListener('visibilitychange', visibilityChanged);
    start();
});
onBeforeUnmount(() => {
    unmounted = true; generation++;
    stop(); resizeObserver?.disconnect(); themeObserver?.disconnect();
    document.removeEventListener('visibilitychange', visibilityChanged);
});
</script>
