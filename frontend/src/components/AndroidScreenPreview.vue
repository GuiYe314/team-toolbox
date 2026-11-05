<template>
    <section class="adb-screen">
        <div class="adb-screen-head"><h2>手机屏幕</h2><span class="adb-screen-muted">{{ continuous ? '连续刷新中' : busy ? '读取中' : '已停止' }}</span></div>
        <div class="adb-screen-controls">
            <label for="adb-screen-device">屏幕设备<select id="adb-screen-device" v-model="serial" class="input adb-select" :disabled="disabled"><option value="" disabled>请选择已连接设备</option><option v-for="device in onlineDevices" :key="device.serial" :value="device.serial">{{ device.model || device.serial }} · {{ device.serial }}</option></select></label>
            <label for="adb-screen-interval">刷新间隔<select id="adb-screen-interval" v-model="interval" class="input adb-select"><option :value="1000">1 秒</option><option :value="2000">2 秒</option><option :value="5000">5 秒</option></select></label>
        </div>
        <div class="adb-screen-actions">
            <button id="adb-screen-refresh" class="btn" :disabled="disabled || busy || continuous || !serial" @click="read">刷新画面</button>
            <button v-if="!continuous && !busy" id="adb-screen-start" class="btn btn-primary" :disabled="disabled || !serial" @click="start">开始连续刷新</button>
            <button v-else id="adb-screen-stop" class="btn" @click="stop(false)">停止读取</button>
            <button ref="enlarge" id="adb-screen-enlarge" class="btn btn-sm" :disabled="!url" @click="open">放大查看</button>
            <button id="adb-screen-clear" class="btn btn-sm" :disabled="!url && !busy && !continuous" @click="stop(true)">清空画面</button>
        </div>
        <p v-if="error" class="adb-screen-error" role="alert">{{ error }}</p>
        <p v-if="url" id="adb-screen-info" class="adb-screen-muted">{{ width }} × {{ height }} · 最后读取 {{ capturedAt }}{{ !continuous && !busy ? ' · 显示最后画面' : '' }}</p>
        <div class="adb-screen-display"><img v-if="url" id="adb-screen-image" :src="url" alt="所选安卓设备的屏幕画面" :draggable="false" /><p v-else class="adb-screen-muted">选择设备后点击刷新，查看手机当前画面。</p></div>
        <p class="adb-screen-muted">每轮读取完成后等待所选间隔再刷新，速度取决于设备和网络。</p>
    </section>
    <Teleport to="body">
        <div v-if="enlarged && url" class="overlay" @click.self="close" @keydown="onKeydown">
            <section ref="dialog" class="dialog adb-screen-dialog" role="dialog" aria-modal="true" aria-labelledby="adb-screen-dialog-title">
                <header class="adb-screen-head"><h2 id="adb-screen-dialog-title" class="dialog-title">手机屏幕</h2><button ref="closeButton" id="adb-screen-close" class="btn btn-sm" @click="close">关闭</button></header>
                <div class="adb-screen-large"><img :src="url" alt="手机屏幕放大画面" :draggable="false" /></div>
            </section>
        </div>
    </Teleport>
</template>
<script>
import { androidApi } from '../api/android-client.js';
export default {
    name: 'AndroidScreenPreview', props: { devices: { type: Array, default: () => [] }, disabled: Boolean },
    data() { return { serial: '', interval: 2000, continuous: false, busy: false, url: '', width: 0, height: 0, capturedAt: '', error: '', enlarged: false }; },
    computed: { onlineDevices() { return this.devices.filter(device => device.state === 'device'); } },
    watch: {
        devices() { if (this.serial && !this.onlineDevices.some(device => device.serial === this.serial)) this.serial = ''; },
        serial() { this.stop(true); this.error = ''; }
    },
    mounted() {
        this._revision = 0; this._leave = () => this.stop(true); this._visibility = () => { if (document.hidden) this.stop(false); };
        window.addEventListener('pagehide', this._leave); document.addEventListener('visibilitychange', this._visibility);
    },
    beforeUnmount() {
        this._disposed = true; window.removeEventListener('pagehide', this._leave); document.removeEventListener('visibilitychange', this._visibility); this.stop(true);
    },
    methods: {
        stop(clear) {
            this._revision++; this.continuous = false; this.busy = false; clearTimeout(this._timer); this._controller?.abort();
            if (this._decodingUrl) { URL.revokeObjectURL(this._decodingUrl); this._decodingUrl = null; }
            if (clear) { this.close(); if (this.url) URL.revokeObjectURL(this.url); this.url = ''; this.width = 0; this.height = 0; this.capturedAt = ''; this.error = ''; }
        },
        schedule() { clearTimeout(this._timer); if (this.continuous && this.serial && !this._disposed) this._timer = setTimeout(() => this.read(), Number(this.interval)); },
        start() { if (this.disabled || this.busy || !this.serial) return; this.continuous = true; this.read(); },
        async read() {
            if (this._disposed || !this.serial || this.busy) return;
            if (document.hidden) { this.stop(false); return; }
            if (this.disabled) { this.schedule(); return; }
            const revision = this._revision, controller = this._controller = new AbortController();
            this.busy = true; this.error = ''; let url;
            try {
                const result = await androidApi.captureScreen(this.serial, controller.signal);
                if (this._disposed || revision !== this._revision) return;
                url = this._decodingUrl = URL.createObjectURL(result.blob);
                const picture = new Image(); picture.src = url;
                try { await picture.decode(); } catch { throw new Error('设备画面无法显示，请重新读取'); }
                if (this._disposed || revision !== this._revision) return;
                const previous = this.url; this.url = url; this._decodingUrl = null; this.width = picture.naturalWidth; this.height = picture.naturalHeight;
                const timestamp = Date.parse(result.capturedAt); this.capturedAt = new Date(Number.isFinite(timestamp) ? timestamp : Date.now()).toLocaleTimeString();
                if (previous) URL.revokeObjectURL(previous);
            } catch (error) {
                if (!this._disposed && revision === this._revision && !controller.signal.aborted) { this.error = error.message; this.continuous = false; }
            } finally {
                if (url && url !== this.url) URL.revokeObjectURL(url);
                if (this._decodingUrl === url) this._decodingUrl = null;
                if (!this._disposed && revision === this._revision) { this.busy = false; this.schedule(); }
            }
        },
        async open() { if (!this.url) return; this.enlarged = true; await this.$nextTick(); this.$refs.closeButton?.focus(); },
        close() { const wasOpen = this.enlarged; this.enlarged = false; if (wasOpen && !this._disposed) this.$refs.enlarge?.focus(); },
        onKeydown(event) {
            if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); this.close(); }
            if (event.key === 'Tab') { event.preventDefault(); this.$refs.closeButton?.focus(); }
        }
    }
};
</script>
<style scoped>
.adb-screen { padding: var(--page-padding); margin-bottom: var(--gap-column); min-width: 0; border: 1px solid var(--panel-border); border-radius: var(--radius-md); background: var(--panel-background); }
.adb-screen-head, .adb-screen-controls, .adb-screen-actions { display: flex; align-items: center; flex-wrap: wrap; gap: var(--gap-column); margin-bottom: var(--gap-column); }
.adb-screen-head { justify-content: space-between; }
.adb-screen h2 { margin: 0; font-size: var(--text-section-title); }
.adb-screen-controls { align-items: flex-end; }
.adb-screen-controls label { flex: 1; min-width: 0; color: var(--text-secondary); font-size: var(--text-body); }
.adb-screen-controls label:last-child { flex: none; }
.adb-screen-controls .input { display: block; width: 100%; box-sizing: border-box; margin-top: var(--adb-small-gap); }
.adb-screen-display, .adb-screen-large { display: flex; align-items: center; justify-content: center; background: var(--adb-log-background); border-radius: var(--radius-sm); overflow: auto; }
.adb-screen-display { min-height: var(--adb-screen-empty-height); padding: var(--gap-column); }
.adb-screen-display img { display: block; max-width: 100%; max-height: var(--adb-screen-height); object-fit: contain; }
.adb-screen-muted { color: var(--text-secondary); font-size: var(--text-body); line-height: var(--line-normal); }
.adb-screen-error { color: var(--danger); font-size: var(--text-body); overflow-wrap: anywhere; }
.adb-screen-dialog { width: min(var(--adb-screen-dialog-width), calc(100vw - var(--page-padding) * 2)); max-width: none; max-height: calc(100vh - var(--page-padding) * 2); box-sizing: border-box; display: flex; flex-direction: column; }
.adb-screen-large { min-height: 0; padding: var(--gap-column); }
.adb-screen-large img { display: block; max-width: 100%; max-height: calc(100vh - var(--adb-screen-dialog-offset)); object-fit: contain; }
</style>
