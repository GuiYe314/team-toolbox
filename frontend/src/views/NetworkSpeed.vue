<template>
    <div class="view-page net-page">
        <header class="net-header">
            <router-link class="btn btn-sm btn-ghost" :to="{ name: 'tools' }"><svg class="icon icon-sm" viewBox="0 0 24 24" aria-hidden="true"><path d="m14.5 6-6 6 6 6" /></svg>返回工具箱</router-link>
            <div class="net-heading">
                <div><h1 class="view-title">实时网速</h1><p class="view-subtitle">运行工具箱的电脑 · 约每秒采样</p></div>
                <div class="net-actions"><button id="net-pause" type="button" class="btn" @click="togglePause">{{ paused ? '继续采样' : '暂停采样' }}</button><button id="net-clear" type="button" class="btn" @click="clearRecords">清空记录</button></div>
            </div>
        </header>

        <section class="net-panel net-adapter-panel" aria-label="网卡选择">
            <div class="net-adapter-picker"><label for="net-adapter">观察网卡</label><select id="net-adapter" v-model="selectedId" class="net-select" @change="changeAdapter"><option v-if="!snapshot?.adapters.length" value="">等待网卡列表…</option><option v-if="missing" :value="selectedId">{{ selectedName }}（已移除）</option><option v-for="item in snapshot?.adapters || []" :key="item.id" :value="item.id">{{ item.name }} · {{ item.connected ? '已连接' : '未连接' }}{{ item.virtual ? ' · 虚拟网卡' : '' }}</option></select></div>
            <div class="net-adapter-info"><strong>{{ adapter?.description || '读取服务器电脑的网络适配器' }}</strong><span>{{ adapter ? `${adapter.virtual ? '虚拟网卡' : '物理网卡'} · 链路 ${adapter.connected ? networkBits(adapter.linkSpeedBps) : '未连接'}` : '默认优先选择在线物理网卡' }}</span></div>
            <span id="net-status" class="net-status" :class="{ 'is-live': live }" role="status"><i></i>{{ statusText }}</span>
        </section>
        <div v-if="notice" id="net-notice" class="net-notice" role="status"><span>{{ notice }}</span><button v-if="localError || ['error', 'stale'].includes(snapshot?.state)" id="net-retry" type="button" class="btn btn-sm" @click="retry">重试</button></div>

        <section class="net-rates" aria-label="当前上传和下载速度">
            <article v-for="direction in directions" :key="direction.key" class="net-rate-card" :class="`net-${direction.key}`">
                <div class="net-rate-heading"><span class="net-arrow"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path :d="direction.key === 'download' ? 'M12 3v16m-6-6 6 6 6-6M4 21h16' : 'M12 19V3m-6 6 6-6 6 6M4 21h16'" /></svg></span><h2>{{ direction.label }}</h2><span>{{ paused || hidden ? '最后读数' : '当前速度' }}</span></div>
                <div class="net-rate" :id="`net-${direction.key}-rate`"><strong>{{ networkBytes(displayRates?.[direction.key], true).value }}</strong><span>{{ networkBytes(displayRates?.[direction.key], true).unit }}</span></div>
                <p class="net-bits">{{ displayRates ? networkBits(displayRates[direction.key] * 8) : '等待有效采样' }}</p>
                <dl class="net-rate-details"><div><dt>本轮平均</dt><dd :id="`net-${direction.key}-average`">{{ networkBytes(totals.duration ? totals[direction.key] / totals.duration * 1000 : null, true).text }}</dd></div><div><dt>本轮峰值</dt><dd>{{ networkBytes(totals.duration ? totals[`${direction.key}Peak`] : null, true).text }}</dd></div><div><dt>本轮流量</dt><dd :id="`net-${direction.key}-total`">{{ networkBytes(totals[direction.key]).text }}</dd></div></dl>
            </article>
        </section>

        <section class="net-panel net-trend" aria-label="最近 60 秒网速趋势">
            <div class="net-chart-heading"><div><h2>网速趋势</h2><p>最近 60 秒 · {{ networkBytes(chart.ceiling, true).text }} 刻度上限</p></div><div class="net-legend"><span class="net-download"><i></i>下载</span><span class="net-upload"><i></i>上传</span></div></div>
            <div class="net-chart-wrap">
                <svg id="net-chart" class="net-chart" viewBox="0 0 900 242" role="img" aria-label="下载和上传速度折线图" :data-points="chart.count">
                    <g class="net-grid"><path d="M40 20H880M40 68H880M40 116H880M40 164H880M40 212H880M40 20V212M250 20V212M460 20V212M670 20V212M880 20V212" /></g>
                    <g class="net-axis"><text x="40" y="236">60 秒前</text><text x="460" y="236" text-anchor="middle">30 秒前</text><text x="880" y="236" text-anchor="end">现在</text><text x="30" y="216" text-anchor="end">0</text></g>
                    <polyline v-for="(line, index) in chart.down" :key="`down-${index}`" class="net-line net-download-line" :points="line" />
                    <polyline v-for="(line, index) in chart.up" :key="`up-${index}`" class="net-line net-upload-line" :points="line" />
                </svg>
                <p v-if="chart.count < 2" class="net-chart-empty">{{ chart.count ? '正在积累趋势数据…' : '有效采样后显示趋势' }}</p>
            </div>
            <footer class="net-chart-footer"><span id="net-sampled-at">最后采样：{{ lastTime }}</span><span>有效观察 {{ (totals.duration / 1000).toFixed(1) }} 秒</span></footer>
        </section>
        <details class="net-help net-panel"><summary>使用说明</summary><p>这里显示运行工具箱的 Windows 电脑网速。通过手机或其他电脑访问时，看到的仍是服务器网卡流量。数据包含局域网及互联网，不是宽带测速，也不区分单个应用。</p><p>字节单位按 1024 换算（KB/s、MB/s），比特单位按 1000 换算（Mbps、Gbps）。链路速率是网卡协商值，不等于互联网可用带宽。请选择一张网卡观察，VPN、虚拟网卡和物理网卡可能统计同一份流量。</p><p>平均值按有效采样时长计算。切换网卡、清空或恢复采样会重新统计本轮数据；进入后台或离开页面停止轮询，所有页面都停止后服务器最多十秒释放采集。计数复位或连接恢复先重新建立基线，失败或过期时不显示旧速度为实时值。记录只在本页内存，刷新页面即清空。</p></details>
    </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { networkBytes, networkBits, networkChart, networkTrafficDelta } from '../utils/network-speed.js';
import '../styles/network-speed.css';

const directions = [{ key: 'download', label: '下载速度' }, { key: 'upload', label: '上传速度' }];
const snapshot = ref(null), selectedId = ref(''), selectedName = ref('');
const paused = ref(false), hidden = ref(false), localError = ref(''), history = ref([]), lastRates = ref(null);
const emptyTotals = () => ({ download: 0, upload: 0, duration: 0, downloadPeak: 0, uploadPeak: 0 });
const totals = ref(emptyTotals()), chartTime = ref(performance.now());
let timer, requestController, revision = 0, unmounted = false, lastSample = null, lastCounters = null, gap = true;
const adapter = computed(() => snapshot.value?.adapters.find(item => item.id === selectedId.value));
const missing = computed(() => !!selectedId.value && !!snapshot.value && !adapter.value);
const live = computed(() => !paused.value && !hidden.value && !localError.value && snapshot.value?.state === 'ready' && adapter.value?.connected && adapter.value?.downloadBps !== null && !!lastRates.value);
const displayRates = computed(() => paused.value || hidden.value || live.value ? lastRates.value : null);
const statusText = computed(() => paused.value ? '已暂停' : hidden.value ? '后台已暂停' : localError.value ? '连接失败' : live.value ? '实时采样中' : missing.value ? '网卡已移除' : adapter.value && !adapter.value.connected ? '网卡未连接' : snapshot.value?.state === 'unsupported' ? '当前系统不支持' : ['error', 'stale'].includes(snapshot.value?.state) ? '等待恢复' : '准备采样');
const notice = computed(() => localError.value || (missing.value ? '所选网卡已移除，请重新选择。' : '') || snapshot.value?.message || '');
const chart = computed(() => networkChart(history.value, chartTime.value));
const lastTime = computed(() => snapshot.value?.sampledAt ? new Date(snapshot.value.sampledAt).toLocaleTimeString('zh-CN', { hour12: false }) : '—');

function resetRecords() { chartTime.value = performance.now(); history.value = []; totals.value = emptyTotals(); lastRates.value = null; lastSample = null; lastCounters = null; gap = true; }
function cancelPoll() { revision++; clearTimeout(timer); timer = null; requestController?.abort(); requestController = null; }
function startPoll() { cancelPoll(); if (!unmounted && !paused.value && !hidden.value) poll(revision); }
function consume(data) {
    chartTime.value = performance.now(); snapshot.value = data;
    if (!selectedId.value && data.adapters.length) selectedId.value = (data.adapters.find(item => item.connected && !item.virtual) || data.adapters.find(item => item.connected) || data.adapters[0]).id;
    const current = adapter.value;
    if (current) selectedName.value = current.name;
    if (data.state !== 'ready' || !current?.connected) { lastCounters = null; gap = true; return; }
    if (data.sampleId === lastSample) return;
    lastSample = data.sampleId;
    const delta = networkTrafficDelta(lastCounters, current);
    lastCounters = current;
    if (current.downloadBps === null || current.uploadBps === null) { gap = true; return; }
    lastRates.value = { download: current.downloadBps, upload: current.uploadBps };
    if (delta) { totals.value.download += delta.download; totals.value.upload += delta.upload; totals.value.duration += delta.duration; }
    else gap = true;
    totals.value.downloadPeak = Math.max(totals.value.downloadPeak, current.downloadBps);
    totals.value.uploadPeak = Math.max(totals.value.uploadPeak, current.uploadBps);
    const time = chartTime.value;
    history.value = [...history.value.filter(point => point.time >= time - 60000), { time, down: current.downloadBps, up: current.uploadBps, gap }].slice(-120);
    gap = false;
}
async function poll(version) {
    const controller = new AbortController(); requestController = controller;
    const timeout = setTimeout(() => controller.abort(), 6000);
    try {
        const response = await fetch('/api/network-speed/snapshot', { headers: { Accept: 'application/json', 'X-Toolbox-Network-Speed': '1' }, cache: 'no-store', signal: controller.signal });
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || `读取网速失败（HTTP ${response.status}）`);
        if (!Array.isArray(data.adapters) || data.adapters.length > 64 || !Number.isInteger(data.sampleId) || typeof data.state !== 'string'
            || data.adapters.some(item => typeof item.id !== 'string' || typeof item.connected !== 'boolean'
                || ![item.downloadBps, item.uploadBps].every(value => value === null || Number.isFinite(value) && value >= 0)
                || !Number.isFinite(item.counterTimeMs) || !Number.isInteger(item.counterEpoch)
                || !/^\d{1,20}$/.test(item.receivedBytes) || !/^\d{1,20}$/.test(item.sentBytes))) throw new Error('网速数据格式无效');
        if (version !== revision || unmounted) return;
        localError.value = ''; consume(data);
    } catch (error) {
        if (version !== revision || unmounted) return;
        chartTime.value = performance.now(); localError.value = controller.signal.aborted ? '读取网速超时，正在重试…' : error.message || '连接失败，正在重试…'; lastCounters = null; gap = true;
    } finally {
        clearTimeout(timeout);
        if (requestController === controller) requestController = null;
        if (version === revision && !unmounted && !paused.value && !hidden.value && snapshot.value?.state !== 'unsupported') timer = setTimeout(() => poll(version), 1000);
    }
}
function changeAdapter() { resetRecords(); startPoll(); }
function clearRecords() { resetRecords(); if (!paused.value) startPoll(); }
function togglePause() { paused.value = !paused.value; if (paused.value) cancelPoll(); else { resetRecords(); startPoll(); } }
function retry() { if (paused.value) paused.value = false; startPoll(); }
function visibility() { hidden.value = document.hidden; if (hidden.value) cancelPoll(); else if (!paused.value) { resetRecords(); startPoll(); } }
onMounted(() => { hidden.value = document.hidden; document.addEventListener('visibilitychange', visibility); startPoll(); });
onBeforeUnmount(() => { unmounted = true; cancelPoll(); document.removeEventListener('visibilitychange', visibility); });
</script>
