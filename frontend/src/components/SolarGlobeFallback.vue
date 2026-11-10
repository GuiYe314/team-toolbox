<template>
    <div class="solar-canvas-wrap">
        <canvas ref="canvas" class="solar-globe" tabindex="0" role="img"
            :aria-label="`可拖动或用方向键旋转的地球，太阳直射点：${coordinateText}`"
            :data-view-longitude="viewLongitude.toFixed(2)" :data-view-latitude="viewLatitude.toFixed(2)"
            :data-solar-latitude="solar.subsolarLatitude.toFixed(3)" :data-solar-longitude="solar.subsolarLongitude.toFixed(3)"
            @pointerdown="startDrag" @pointermove="drag" @pointerup="endDrag" @pointercancel="endDrag" @lostpointercapture="endDrag"
            @keydown="onKeydown" />
        <p v-if="error" class="notice notice-error">{{ error }}</p>
    </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { formatLatitude, formatLongitude } from '../utils/solar-position.js';
import { createSolarGlobeRenderer, GLOBE_WIDTH } from '../utils/solar-globe.js';

const props = defineProps({ solar: { type: Object, required: true }, viewLatitude: { type: Number, required: true }, viewLongitude: { type: Number, required: true } });
const emit = defineEmits(['rotate', 'reset']);
const canvas = ref(null), error = ref('');
const coordinateText = computed(() => `${formatLatitude(props.solar.subsolarLatitude)}，${formatLongitude(props.solar.subsolarLongitude)}`);
let renderer, resizeObserver, themeObserver, frame, pointer;

function draw() {
    frame = null;
    if (!renderer || !canvas.value) return;
    try {
        const style = getComputedStyle(canvas.value);
        const value = name => style.getPropertyValue(`--solar-${name}`).trim();
        renderer({ solar: props.solar, viewLatitude: props.viewLatitude, viewLongitude: props.viewLongitude,
            scale: canvas.value.clientWidth / GLOBE_WIDTH * Math.min(2, devicePixelRatio || 1),
            colors: { ocean: value('ocean'), land: value('land'), landStroke: value('land-stroke'), grid: value('grid'), terminator: value('terminator'), outline: value('globe-outline'), ray: value('ray'), sun: value('sun'), marker: value('marker'),
                equator: value('equator'), tropic: value('tropic'), labelBackground: value('label-background'), sunCore: value('sun-core'), sunRim: value('sun-rim'), sunCoronaSoft: value('sun-corona-soft'), transparent: value('transparent'),
                label: style.getPropertyValue('--solar-stage-text').trim(), font: style.getPropertyValue('--font-sans').trim() }
        });
        error.value = '';
    } catch (e) { error.value = e.message || '地球绘制失败，请刷新页面重试。'; }
}
function scheduleDraw() { if (!frame) frame = requestAnimationFrame(draw); }
function startDrag(event) {
    if (!event.isPrimary || event.button !== 0) return;
    pointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
    canvas.value.setPointerCapture(event.pointerId); canvas.value.focus({ preventScroll: true });
}
function drag(event) {
    if (!pointer || event.pointerId !== pointer.id) return;
    const sensitivity = 180 / Math.max(300, canvas.value.clientWidth);
    emit('rotate', { longitude: (pointer.x - event.clientX) * sensitivity, latitude: (event.clientY - pointer.y) * sensitivity });
    pointer = { ...pointer, x: event.clientX, y: event.clientY };
}
function endDrag(event) {
    if (pointer?.id !== event.pointerId) return;
    const id = pointer.id; pointer = null;
    if (canvas.value?.hasPointerCapture(id)) canvas.value.releasePointerCapture(id);
}
function onKeydown(event) {
    const rotations = { ArrowLeft: { longitude: -15, latitude: 0 }, ArrowRight: { longitude: 15, latitude: 0 }, ArrowUp: { longitude: 0, latitude: 10 }, ArrowDown: { longitude: 0, latitude: -10 } };
    if (rotations[event.key]) { event.preventDefault(); emit('rotate', rotations[event.key]); }
    if (event.key === 'Home') { event.preventDefault(); emit('reset'); }
}
watch(() => [props.solar, props.viewLatitude, props.viewLongitude], scheduleDraw);
onMounted(() => {
    try { renderer = createSolarGlobeRenderer(canvas.value); } catch (e) { error.value = e.message; return; }
    resizeObserver = new ResizeObserver(scheduleDraw); resizeObserver.observe(canvas.value);
    themeObserver = new MutationObserver(scheduleDraw);
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    scheduleDraw();
});
onBeforeUnmount(() => { resizeObserver?.disconnect(); themeObserver?.disconnect(); if (frame) cancelAnimationFrame(frame); renderer = null; pointer = null; });
</script>
