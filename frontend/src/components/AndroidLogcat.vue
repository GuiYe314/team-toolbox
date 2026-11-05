<template>
    <section class="adb-logcat">
        <div class="adb-logcat-head"><h2>设备日志 <span>Logcat</span></h2><span class="adb-logcat-badge" :class="{ live: running }">{{ running ? '采集中' : '已停止' }}</span></div>
        <div class="adb-logcat-controls">
            <label for="adb-log-device">日志设备
                <select id="adb-log-device" v-model="serial" class="input adb-select" :disabled="disabled || busy || applicationBusy">
                    <option value="" disabled>请选择已连接设备</option><option v-for="device in onlineDevices" :key="device.serial" :value="device.serial">{{ device.model || device.serial }} · {{ device.serial }}</option>
                </select>
            </label>
            <button v-if="!running" id="adb-log-start" class="btn btn-primary" :disabled="disabled || busy || applicationBusy || !serial || (scope === 'app' && !packageName)" @click="start">{{ busy ? '处理中…' : '开始采集' }}</button>
            <button v-else id="adb-log-stop" class="btn" :disabled="busy" @click="stop">停止采集</button>
        </div>
        <div class="adb-logcat-controls"><label for="adb-log-scope">日志范围<select id="adb-log-scope" v-model="scope" class="input adb-select" :disabled="disabled || busy || applicationBusy"><option value="device">设备全部日志</option><option value="app">指定应用</option></select></label></div>
        <AndroidAppSelector v-if="scope === 'app'" :key="serial" :serial="serial" :disabled="disabled || busy" :runtime="session?.application" @change="applicationChanged" @busy-change="applicationActivityChanged" />
        <div class="adb-logcat-controls adb-logcat-filters">
            <label for="adb-log-level">最低级别<select id="adb-log-level" v-model="level" class="input adb-select"><option v-for="item in levels" :key="item" :value="item">{{ item === 'V' ? '全部级别' : item + ' 及以上' }}</option></select></label>
            <label class="adb-logcat-search" for="adb-log-search">关键词<input id="adb-log-search" v-model="keyword" class="input" placeholder="搜索标签、进程或正文" /></label>
        </div>
        <div class="adb-logcat-toolbar"><label><input v-model="autoScroll" type="checkbox" /> 自动滚动</label><span>{{ visible.length }} / {{ entries.length }} 条</span><button id="adb-log-clear" class="btn btn-sm" @click="clear">清空显示</button></div>
        <p v-if="error" class="adb-logcat-error" role="alert">{{ error }}</p>
        <p v-if="message" class="adb-logcat-status" role="status">{{ message }}</p>
        <p v-if="dropped" class="adb-logcat-status">旧日志已轮换 {{ dropped }} 条，内存中最多保留 2000 条。</p>
        <div ref="viewport" id="adb-log-output" class="adb-logcat-output" tabindex="0" aria-label="设备日志内容">
            <p v-if="!visible.length" class="adb-logcat-empty">{{ entries.length ? '没有符合筛选的日志' : running ? '等待设备日志…' : '选择设备后开始采集日志' }}</p>
            <div v-for="entry in visible" :key="entry.seq" class="adb-logcat-line" :class="'adb-log-level-' + entry.level">
                <span class="adb-logcat-time">{{ entry.time }}{{ entry.pid ? ' ' + entry.pid + '/' + entry.tid : '' }}</span>
                <span class="adb-logcat-level">{{ entry.level }}</span><span><b v-if="entry.tag">{{ entry.tag }}: </b>{{ entry.message }}</span>
            </div>
        </div>
    </section>
</template>
<script>
import { androidApi } from '../api/android-client.js';
import AndroidAppSelector from './AndroidAppSelector.vue';
const rank = { V: 0, D: 1, I: 2, W: 3, E: 4, F: 5, A: 5, S: 5 };
export default {
    name: 'AndroidLogcat', components: { AndroidAppSelector }, props: { devices: { type: Array, default: () => [] }, disabled: Boolean }, emits: ['busy-change'],
    data() { return { serial: '', scope: 'device', packageName: '', applicationBusy: false, session: null, entries: [], cursor: 0, dropped: 0, level: 'V', levels: ['V', 'D', 'I', 'W', 'E', 'F'], keyword: '', autoScroll: true, running: false, busy: false, error: '', message: '' }; },
    computed: {
        onlineDevices() { return this.devices.filter(item => item.state === 'device'); },
        visible() { const query = this.keyword.trim().toLowerCase(); return this.entries.filter(item => (rank[item.level] ?? 2) >= rank[this.level] && (!query || item.raw.toLowerCase().includes(query))); }
    },
    watch: {
        devices() { if (this.serial && !this.onlineDevices.some(item => item.serial === this.serial)) this.serial = ''; },
        serial() { this.release(true); this.packageName = ''; this.error = ''; this.message = ''; },
        scope() { this.release(true); this.packageName = ''; this.error = ''; this.message = ''; }
    },
    mounted() { this._revision = 0; this._lifetime = new AbortController(); this._leave = () => this.release(false); window.addEventListener('pagehide', this._leave); },
    beforeUnmount() { this._disposed = true; window.removeEventListener('pagehide', this._leave); this.release(false); this._lifetime.abort(); },
    methods: {
        applicationChanged(packageName) { this.release(true); this.packageName = packageName; this.error = ''; this.message = ''; },
        applicationActivityChanged(active) { this.applicationBusy = active; this.$emit('busy-change', active); },
        release(clear) {
            this._revision++; clearTimeout(this._timer); this._pollController?.abort(); this._startController?.abort();
            if (this.session && this.running) void androidApi.stopLogcat(this.session.id).catch(() => {});
            this.running = false; this.busy = false; this.session = null; this.$emit('busy-change', false);
            if (clear) { this.entries = []; this.cursor = 0; this.dropped = 0; }
        },
        async start() {
            if (this.disabled || this.busy || this.applicationBusy || !this.serial || (this.scope === 'app' && !this.packageName)) return;
            this.release(true); const revision = this._revision;
            this.busy = true; this.error = ''; this.message = ''; this._startController = new AbortController(); this.$emit('busy-change', true);
            try {
                const session = await androidApi.startLogcat(this.serial, this._startController.signal, this.scope === 'app' ? this.packageName : '');
                if (this._disposed || revision !== this._revision) { void androidApi.stopLogcat(session.id).catch(() => {}); return; }
                this.session = session; this.running = true; this.message = session.message; this._timer = setTimeout(() => this.poll(), 0);
            } catch (error) { if (!this._disposed && revision === this._revision) this.error = error.message; }
            finally { if (!this._disposed && revision === this._revision) { this.busy = false; this.$emit('busy-change', false); } }
        },
        async poll() {
            if (!this.session || this._disposed) return;
            const id = this.session.id, revision = this._revision; this._pollController = new AbortController();
            try {
                const result = await androidApi.pollLogcat(id, this.cursor, this._pollController.signal);
                if (this._disposed || revision !== this._revision) return;
                this.entries = [...this.entries, ...result.entries.filter(item => item.seq > this.cursor)].slice(-2000);
                this.cursor = Math.max(this.cursor, result.cursor); this.dropped = result.dropped; this.session = result;
                this.running = result.state === 'running'; this.message = result.message;
                if (result.state === 'failed') this.error = result.message;
                await this.$nextTick(); if (this.autoScroll && this.$refs.viewport) this.$refs.viewport.scrollTop = this.$refs.viewport.scrollHeight;
                if (this.running || result.hasMore) this._timer = setTimeout(() => this.poll(), result.hasMore ? 0 : 1000);
            } catch (error) {
                if (this._disposed || revision !== this._revision || !this.running) return;
                this.error = error.message; this.message = '日志采集已停止'; this.release(false);
            }
        },
        async stop() {
            if (!this.session || this.busy) return;
            this.busy = true; this.running = false; clearTimeout(this._timer); this._pollController?.abort();
            try { await androidApi.stopLogcat(this.session.id, this._lifetime.signal); await this.poll(); }
            catch (error) { if (!this._disposed) { this.error = error.message; this.message = '未能确认服务器停止采集，断网时会自动超时停止'; } }
            finally { if (!this._disposed) this.busy = false; }
        },
        clear() { this.entries = []; this.cursor = this.session?.total ?? this.cursor; }
    }
};
</script>
<style scoped>
.adb-logcat { min-width: 0; padding: var(--page-padding); border: 1px solid var(--panel-border); border-radius: var(--radius-md); background: var(--panel-background); }
.adb-logcat-head, .adb-logcat-controls, .adb-logcat-toolbar { display: flex; align-items: center; gap: var(--gap-column); flex-wrap: wrap; }
.adb-logcat-head { justify-content: space-between; margin-bottom: var(--gap-column); }
.adb-logcat h2 { margin: 0; font-size: var(--text-section-title); }
.adb-logcat h2 span { font-size: var(--text-body); color: var(--text-secondary); font-weight: var(--weight-regular); }
.adb-logcat-controls { align-items: flex-end; margin-bottom: var(--gap-column); }
.adb-logcat-controls label { flex: 1; min-width: 0; color: var(--text-secondary); font-size: var(--text-body); }
.adb-logcat-controls .input { display: block; width: 100%; box-sizing: border-box; margin-top: var(--adb-small-gap); }
.adb-logcat-filters label { flex: none; }
.adb-logcat-filters .adb-logcat-search { flex: 1; }
.adb-logcat-toolbar { justify-content: space-between; color: var(--text-secondary); font-size: var(--text-body); }
.adb-logcat-badge { padding: var(--adb-small-gap) var(--gap-column); background: var(--surface-sunken); color: var(--text-secondary); border-radius: var(--radius-pill); font-size: var(--text-body); }
.adb-logcat-badge.live { color: var(--success); background: var(--success-soft); }
.adb-logcat-output { height: var(--adb-log-height); overflow: auto; margin-top: var(--gap-column); padding: var(--gap-column); background: var(--adb-log-background); border: 1px solid var(--panel-border); border-radius: var(--radius-sm); font-family: var(--font-mono); font-size: var(--text-body); }
.adb-logcat-line { display: grid; grid-template-columns: var(--adb-log-time-width) var(--adb-log-level-width) minmax(0, 1fr); gap: var(--adb-small-gap); padding: var(--adb-small-gap) 0; border-bottom: 1px solid var(--panel-border); line-height: var(--line-normal); overflow-wrap: anywhere; white-space: pre-wrap; color: var(--text-primary); }
.adb-logcat-time, .adb-logcat-empty, .adb-logcat-status { color: var(--text-secondary); }
.adb-logcat-level { font-weight: var(--weight-bold); }
.adb-log-level-W .adb-logcat-level { color: var(--warning); }
.adb-log-level-E .adb-logcat-level, .adb-log-level-F .adb-logcat-level, .adb-log-level-A .adb-logcat-level, .adb-logcat-error { color: var(--danger); }
.adb-logcat-error, .adb-logcat-status { overflow-wrap: anywhere; font-size: var(--text-body); }
</style>
