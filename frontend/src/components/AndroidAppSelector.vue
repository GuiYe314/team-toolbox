<template>
    <div class="adb-app-selector">
        <div class="adb-app-row">
            <label for="adb-app-search">搜索应用包名<input id="adb-app-search" v-model="query" class="input" placeholder="例如 com.company.app" :disabled="disabled || busy || !serial" /></label>
            <button id="adb-app-refresh" class="btn" :disabled="disabled || busy || !serial" @click="load">{{ busy ? '读取中…' : '刷新应用' }}</button>
        </div>
        <label for="adb-app-select">已安装应用（包名）
            <select id="adb-app-select" v-model="packageName" class="input adb-select" :disabled="disabled || busy || !packages.length" @change="selectionChanged">
                <option value="" disabled>请选择要查看的应用</option><option v-for="name in options" :key="name" :value="name">{{ name }}</option>
            </select>
        </label>
        <p v-if="!serial" class="adb-app-muted">先选择日志设备，再读取应用。</p>
        <p v-else-if="loaded && !packages.length" class="adb-app-muted">设备中未读取到应用，点击“刷新应用”重试。</p>
        <p v-else-if="query && !filtered.length" class="adb-app-muted">没有匹配的包名，当前选择保持不变。</p>
        <p v-if="truncated" class="adb-app-muted">应用过多，仅列出前 2000 个包名。</p>
        <p v-if="error" class="adb-app-error" role="alert">{{ error }}</p>
        <div v-if="packageName" class="adb-app-state-row">
            <div id="adb-app-state" role="status">
                <strong :class="{ 'adb-app-running': displayed?.running }">{{ displayed ? displayed.running ? '运行中' : '未运行' : '运行状态待读取' }}</strong>
                <span v-if="displayed?.running"> · PID {{ displayed.processes.map(item => item.pid).join('、') }}</span>
                <small v-if="displayed">最后检查 {{ new Date(displayed.checkedAt).toLocaleTimeString() }}</small>
            </div>
            <button id="adb-app-status-refresh" class="btn btn-sm" :disabled="disabled || busy" @click="inspect">刷新状态</button>
        </div>
        <p v-if="packageName" class="adb-app-muted">运行中表示进程存在；采集期间自动更新，应用未运行时等待启动。</p>
    </div>
</template>
<script>
import { androidApi } from '../api/android-client.js';
export default {
    name: 'AndroidAppSelector', props: { serial: String, disabled: Boolean, runtime: Object }, emits: ['change', 'busy-change'],
    data() { return { packages: [], packageName: '', query: '', application: null, loaded: false, truncated: false, busy: false, error: '' }; },
    computed: {
        filtered() { const query = this.query.trim().toLowerCase(); return this.packages.filter(name => name.toLowerCase().includes(query)); },
        options() { return this.packageName && !this.filtered.includes(this.packageName) ? [this.packageName, ...this.filtered] : this.filtered; },
        displayed() { return [this.application, this.runtime].filter(item => item?.packageName === this.packageName).sort((a, b) => b.checkedAt.localeCompare(a.checkedAt))[0]; }
    },
    mounted() { this._revision = 0; if (this.serial) this.load(); },
    beforeUnmount() { this._disposed = true; this._controller?.abort(); this.$emit('busy-change', false); },
    methods: {
        async perform(action, apply) {
            this._controller?.abort(); const revision = ++this._revision; this._controller = new AbortController();
            this.busy = true; this.error = ''; this.$emit('busy-change', true);
            try { const result = await action(this._controller.signal); if (!this._disposed && revision === this._revision) apply(result); }
            catch (error) { if (!this._disposed && revision === this._revision) this.error = error.message; }
            finally { if (!this._disposed && revision === this._revision) { this.busy = false; this.$emit('busy-change', false); } }
        },
        load() {
            if (!this.serial) return;
            return this.perform(signal => androidApi.listApps(this.serial, signal), result => {
                this.packages = result.packages; this.truncated = result.truncated; this.loaded = true;
                if (this.packageName && !this.packages.includes(this.packageName)) { this.packageName = ''; this.application = null; this.$emit('change', ''); }
            });
        },
        selectionChanged() { this.application = null; this.$emit('change', this.packageName); if (this.packageName) this.inspect(); },
        inspect() {
            if (!this.serial || !this.packageName) return;
            return this.perform(signal => androidApi.appStatus(this.serial, this.packageName, signal), result => { this.application = result; });
        }
    }
};
</script>
<style scoped>
.adb-app-selector { padding: var(--gap-column); margin-bottom: var(--gap-column); border: 1px solid var(--panel-border); border-radius: var(--radius-sm); background: var(--surface-sunken); }
.adb-app-row, .adb-app-state-row { display: flex; align-items: flex-end; gap: var(--gap-column); flex-wrap: wrap; margin-bottom: var(--gap-column); }
.adb-app-row label, .adb-app-state-row > div { flex: 1; min-width: 0; }
.adb-app-selector label { display: block; color: var(--text-secondary); font-size: var(--text-body); }
.adb-app-selector .input { display: block; width: 100%; box-sizing: border-box; margin-top: var(--adb-small-gap); }
.adb-app-state-row { margin-top: var(--gap-column); margin-bottom: 0; font-size: var(--text-body); overflow-wrap: anywhere; }
.adb-app-state-row small { display: block; margin-top: var(--adb-small-gap); color: var(--text-secondary); }
.adb-app-running { color: var(--success); }
.adb-app-muted { color: var(--text-secondary); font-size: var(--text-body); line-height: var(--line-normal); }
.adb-app-error { color: var(--danger); font-size: var(--text-body); overflow-wrap: anywhere; }
</style>
