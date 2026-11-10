<template>
    <div class="view-page solar-page">
        <header class="solar-header">
            <router-link class="btn btn-sm btn-ghost solar-back" :to="{ name: 'tools' }"><svg class="icon icon-sm" viewBox="0 0 24 24" aria-hidden="true"><path d="m14.5 6-6 6 6 6" /></svg>返回工具箱</router-link>
            <div class="solar-heading-row"><div><h1 class="view-title">地球光照</h1><p class="view-subtitle">此时此刻，阳光照在哪里</p></div><span class="solar-live"><span></span>每 30 秒更新</span></div>
        </header>
        <section class="solar-dashboard" aria-label="当前地球光照">
            <div class="solar-visual">
                <div class="solar-visual-head"><h2 class="solar-section-title">地球与太阳</h2><span class="solar-caption">{{ markerVisible ? '黄色圆点 · 太阳直射点' : '直射点在地球背面或地平线外' }}</span></div>
                <SolarGlobe :solar="solar" :view-latitude="viewLatitude" :view-longitude="viewLongitude" :view-altitude="viewAltitude" :reset-key="resetKey"
                    @rotate="rotate" @reset="resetView" @zoom="viewAltitude = $event" @mode="renderMode = $event" />
                <div class="solar-view-controls">
                    <button id="solar-rotate-left" class="btn btn-sm" type="button" aria-label="向西转动地球" @click="rotate({ longitude: -30, latitude: 0 })"><svg class="icon icon-sm" viewBox="0 0 24 24" aria-hidden="true"><path d="m14.5 6-6 6 6 6" /></svg></button>
                    <button id="solar-reset" class="btn btn-sm" type="button" @click="resetView">回到光照视角</button>
                    <button id="solar-rotate-right" class="btn btn-sm" type="button" aria-label="向东转动地球" @click="rotate({ longitude: 30, latitude: 0 })"><svg class="icon icon-sm" viewBox="0 0 24 24" aria-hidden="true"><path d="m9.5 6 6 6-6 6" /></svg></button>
                </div>
                <div class="solar-legend" aria-label="图例"><span><i class="solar-day-swatch"></i>白昼</span><span><i class="solar-night-swatch"></i>黑夜</span><span><i class="solar-line-swatch"></i>昼夜分界</span></div>
                <div class="solar-legend solar-reference-legend" aria-label="地理纬线图例"><span><i class="solar-equator-swatch"></i>赤道 0°</span><span><i class="solar-tropic-swatch"></i>北回归线 23.44°N · 南回归线 23.44°S</span></div>
                <p class="solar-drag-hint">拖动或方向键旋转 · 滚轮、双指或 ＋/－ 缩放 · Home 复位</p>
            </div>
            <aside class="solar-info">
                <div class="solar-info-head"><span class="solar-eyebrow">此刻的太阳直射点</span><button id="solar-refresh" class="btn btn-sm" type="button" @click="refreshNow">立即刷新</button></div>
                <p class="solar-coordinate" aria-live="polite">{{ coordinateText }}</p>
                <p class="solar-location-note">{{ hemisphereDescription }}</p>
                <dl class="solar-stats">
                    <div><dt>本机时间</dt><dd id="solar-local-time">{{ localTimeText }}</dd></div>
                    <div><dt>UTC 时间</dt><dd id="solar-utc-time" :data-updated-at="now.toISOString()">{{ utcTimeText }}</dd></div>
                    <div><dt>当前视角中心</dt><dd>{{ viewCoordinateText }}</dd></div>
                </dl>
                <div class="solar-note"><svg class="icon icon-sm" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 10.5v5m0-8h.01" /></svg><p>按本机时钟计算，无需定位或外部网络。电脑时间不准确时，照射位置也会受影响。</p></div>
            </aside>
        </section>
        <section class="solar-explanation" aria-label="光照图说明"><div><h2 class="solar-section-title">怎么看这张图</h2><p>明亮区域是白昼，暗色区域是黑夜；金色虚线附近正在日出或日落。太阳射线的箭头指向地球，黄色圆点表示阳光近似垂直照射的位置。青色实线是赤道，紫色虚线是约南北纬 23.44° 的回归线；太阳直射点在两条回归线之间往返。</p></div><div><p class="solar-caption">太阳位置为近似计算；云层和城市灯光为静态示意，并非实时天气或用电数据。太阳表面、日冕、大小与射线长度均为示意。</p><p class="solar-credits">地球素材：<a href="https://www.solarsystemscope.com/textures/" target="_blank" rel="noopener noreferrer">Solar System Scope / INOVE</a> · <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener noreferrer">CC BY 4.0</a>（缩放与压缩）</p></div></section>
    </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import SolarGlobe from '../components/SolarGlobe.vue';
import { calculateSolarPosition, formatLatitude, formatLongitude, normalizeLongitude, pointToView } from '../utils/solar-position.js';
import { DEFAULT_GLOBE_ALTITUDE, isSurfaceVisible } from '../utils/solar-geometry.js';
import '../styles/solar.css';
const now = ref(new Date()), longitudeOffset = ref(0), viewLatitude = ref(15);
const viewAltitude = ref(DEFAULT_GLOBE_ALTITUDE), resetKey = ref(0), renderMode = ref('loading');
const solar = computed(() => calculateSolarPosition(now.value));
const coordinateText = computed(() => `${formatLatitude(solar.value.subsolarLatitude)} · ${formatLongitude(solar.value.subsolarLongitude)}`);
const viewLongitude = computed(() => normalizeLongitude(solar.value.subsolarLongitude - 55 + longitudeOffset.value));
const viewCoordinateText = computed(() => `${formatLatitude(viewLatitude.value)} · ${formatLongitude(viewLongitude.value)}`);
const markerVisible = computed(() => renderMode.value === 'fallback'
    ? pointToView(solar.value.subsolarLatitude, solar.value.subsolarLongitude, viewLatitude.value, viewLongitude.value).z > 0
    : isSurfaceVisible(solar.value.subsolarLatitude, solar.value.subsolarLongitude, viewLatitude.value, viewLongitude.value, viewAltitude.value));
const localTimeText = computed(() => new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(now.value));
const utcTimeText = computed(() => `${now.value.toISOString().slice(0, 19).replace('T', ' ')} UTC`);
const hemisphereDescription = computed(() => Math.abs(solar.value.subsolarLatitude) < 0.3 ? '太阳直射点接近赤道，全球昼夜长短大致相当。' : `太阳直射点位于${solar.value.subsolarLatitude >= 0 ? '北' : '南'}半球，该半球的白昼整体较长。`);
let timer;
function refreshNow() { now.value = new Date(); }
function rotate(change) { longitudeOffset.value = normalizeLongitude(longitudeOffset.value + change.longitude); viewLatitude.value = Math.max(-75, Math.min(75, viewLatitude.value + change.latitude)); }
function resetView() { longitudeOffset.value = 0; viewLatitude.value = 15; viewAltitude.value = DEFAULT_GLOBE_ALTITUDE; resetKey.value++; }
function updateVisibility() {
    if (timer) clearInterval(timer);
    timer = null;
    if (!document.hidden) { refreshNow(); timer = setInterval(refreshNow, 30000); }
}
onMounted(() => { updateVisibility(); document.addEventListener('visibilitychange', updateVisibility); });
onBeforeUnmount(() => { if (timer) clearInterval(timer); document.removeEventListener('visibilitychange', updateVisibility); });
</script>
