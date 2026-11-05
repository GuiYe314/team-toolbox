<template>
    <section class="adb-qr-card">
        <div class="adb-qr-head">
            <h2>扫码配对并连接</h2>
            <button v-if="!active" id="adb-qr-start" class="btn btn-primary" :disabled="disabled || loading" @click="start">{{ loading ? '正在生成…' : '生成配对二维码' }}</button>
            <button v-else id="adb-qr-cancel" class="btn" :disabled="loading" @click="stop">取消扫码</button>
        </div>
        <div v-if="svg && active" class="adb-qr-content">
            <!-- 内容仅来自二维码库生成的 SVG，不插入外部 HTML。 -->
            <div id="adb-pair-qr" class="adb-qr-image" role="img" aria-label="安卓无线调试配对二维码" v-html="svg"></div>
            <div>
                <p id="adb-qr-status" role="status">{{ session.message }}</p>
                <p class="adb-qr-muted">二维码剩余 {{ secondsLeft }} 秒，到期后可重新生成。</p>
                <p class="adb-qr-muted">请保持此页面打开，连接结果会自动显示在设备列表。</p>
            </div>
        </div>
        <p v-else-if="session && !error" id="adb-qr-status" role="status">{{ session.message }}</p>
        <p v-if="error" class="adb-qr-error" role="alert">{{ error }}</p>
    </section>
</template>

<script>
import { androidApi } from '../api/android-client.js';

const activeStates = ['waiting', 'pairing', 'connecting'];

export default {
    name: 'AndroidQrPairing',
    props: { disabled: Boolean },
    emits: ['active-change', 'result'],
    data() { return { session: null, svg: '', active: false, loading: false, error: '', clock: Date.now() }; },
    computed: { secondsLeft() { return Math.max(0, Math.ceil(((this.session?.expiresAt || 0) - this.clock) / 1000)); } },
    mounted() {
        this._lifetime = new AbortController();
        this._leave = () => this.release();
        window.addEventListener('pagehide', this._leave);
    },
    beforeUnmount() {
        this._disposed = true;
        window.removeEventListener('pagehide', this._leave);
        this.release(); this._lifetime.abort();
    },
    methods: {
        setActive(active) { this.active = active; this.$emit('active-change', active); },
        clearTimers() { clearTimeout(this._pollTimer); clearInterval(this._clockTimer); },
        release() {
            this.clearTimers(); this._pollController?.abort(); this.svg = '';
            if (this.active && this.session) {
                // 导航/关闭页面时尽力撤销；断网时服务器仍会在两分钟后清理会话。
                void androidApi.cancelQr(this.session.id).catch(() => {});
            }
            this.setActive(false);
        },
        async start() {
            if (this.active || this.disabled || this.loading) return;
            this.loading = true; this.error = ''; this.session = null; this.setActive(true);
            try {
                const { payload, ...session } = await androidApi.startQr(this._lifetime.signal);
                this.session = session;
                if (this._disposed) { void androidApi.cancelQr(session.id).catch(() => {}); return; }
                const module = await import('qrcode');
                const colors = getComputedStyle(document.documentElement);
                const svg = await (module.default || module).toString(payload, {
                    type: 'svg', margin: 4, width: 280, errorCorrectionLevel: 'M',
                    color: { dark: colors.getPropertyValue('--adb-qr-foreground').trim(), light: colors.getPropertyValue('--adb-qr-background').trim() }
                });
                if (this._disposed) { void androidApi.cancelQr(session.id).catch(() => {}); return; }
                this.svg = svg; this.clock = Date.now(); this.setActive(true);
                this._clockTimer = setInterval(() => {
                    this.clock = Date.now();
                    if (!this.secondsLeft) void this.stop(true);
                }, 1000);
                this._pollTimer = setTimeout(() => this.poll(), 1000);
            } catch (error) {
                this.error = error.message;
                if (this.session) void androidApi.cancelQr(this.session.id).catch(() => {});
                this.setActive(false);
            } finally { this.loading = false; }
        },
        async poll() {
            if (!this.active || this._disposed) return;
            const id = this.session.id;
            this._pollController = new AbortController();
            try {
                const result = await androidApi.pollQr(id, this._pollController.signal);
                if (!this.active || this._disposed || this.session.id !== id) return;
                this.session = result;
                if (activeStates.includes(result.state)) this._pollTimer = setTimeout(() => this.poll(), 1500);
                else {
                    this.svg = ''; this.clearTimers(); this.setActive(false);
                    if (result.state === 'connected') this.$emit('result', result);
                    if (['failed', 'expired'].includes(result.state)) this.error = result.message;
                }
            } catch (error) {
                if (!this.active || this._disposed) return;
                await this.stop(false);
                this.error = error.message;
            }
        },
        async stop(expired = false) {
            if (!this.active) return;
            const id = this.session.id;
            this.loading = true; this.svg = ''; this.clearTimers(); this.setActive(false); this._pollController?.abort();
            this.session = { ...this.session, state: expired === true ? 'expired' : 'cancelled', message: expired === true ? '二维码已过期，请重新生成后扫码' : '已取消扫码连接' };
            try { await androidApi.cancelQr(id, this._lifetime.signal); }
            catch (error) { if (!this._disposed) this.error = `二维码已隐藏，但未能确认服务器会话结束：${error.message}`; }
            finally { if (!this._disposed) this.loading = false; }
        }
    }
};
</script>

<style scoped>
.adb-qr-card { padding: var(--page-padding); margin-bottom: var(--gap-column); border: 1px solid var(--panel-border); border-radius: var(--radius-md); background: var(--panel-background); }
.adb-qr-head { display: flex; justify-content: space-between; align-items: center; gap: var(--gap-column); flex-wrap: wrap; }
.adb-qr-head h2 { margin: 0; font-size: var(--text-section-title); font-weight: var(--weight-semibold); }
.adb-qr-card p { margin: var(--gap-column) 0; line-height: var(--line-relaxed); }
.adb-qr-content { display: flex; align-items: center; gap: var(--page-padding); flex-wrap: wrap; }
.adb-qr-image { width: var(--adb-qr-size); max-width: 100%; flex: none; background: var(--adb-qr-background); border-radius: var(--radius-sm); overflow: hidden; }
.adb-qr-image :deep(svg) { display: block; width: 100%; height: auto; }
.adb-qr-muted { color: var(--text-secondary); }
.adb-qr-error { color: var(--danger); overflow-wrap: anywhere; }
</style>
