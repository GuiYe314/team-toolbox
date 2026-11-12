<template>
    <section class="apk-info-panel" aria-labelledby="adb-apk-info-title">
        <h2 id="adb-apk-info-title">查看 APK 包名</h2>
        <div class="apk-info-row">
            <label>电脑上的 APK 文件<input ref="fileInput" id="adb-apk-info-file" class="input" type="file" accept=".apk" :disabled="disabled || busy" @change="chooseFile" /></label>
            <button id="adb-apk-info-read" class="btn btn-primary" :disabled="disabled || busy || !file" @click="readPackage">读取包名</button>
            <button v-if="busy" id="adb-apk-info-cancel" class="btn" @click="cancel(true)">取消读取</button>
            <button v-else-if="file" id="adb-apk-info-clear" class="btn" :disabled="disabled" @click="clear">清空</button>
        </div>
        <p class="apk-info-muted">无需连接手机或配置 ADB。选择单个 APK 后读取包名，单文件最多 1 GiB。</p>
        <p v-if="file" class="apk-info-muted">{{ file.name }} · {{ formatSize(file.size) }}</p>
        <div v-if="busy" id="adb-apk-info-progress" role="status"><progress :value="progress" max="100" /><p>{{ progress < 100 ? `上传 ${progress}%` : '正在读取 APK 清单…' }}</p></div>
        <p v-if="error" id="adb-apk-info-error" class="apk-info-error" role="alert">{{ error }}</p>
        <p v-if="notice" id="adb-apk-info-notice" role="status">{{ notice }}</p>
        <div v-if="result" class="apk-info-row apk-info-result">
            <label>APK 包名<input id="adb-apk-info-package" class="input" :value="result.packageName" readonly @focus="$event.target.select()" /></label>
            <button id="adb-apk-info-copy" class="btn" @click="copyPackage">复制包名</button>
        </div>
    </section>
</template>

<script>
import { inspectApkPackage } from '../api/android-apk-info-client.js';
import { copyText } from '../utils/clipboard.js';
export default {
    name: 'AndroidApkInfo', props: { disabled: Boolean }, emits: ['busy-change'],
    data() { return { file: null, result: null, busy: false, progress: 0, error: '', notice: '' }; },
    mounted() {
        this._revision = 0;
        this._visibility = () => { if (document.hidden && this.busy) this.cancel(true); };
        this._exit = () => this.cancel(false);
        document.addEventListener('visibilitychange', this._visibility); window.addEventListener('pagehide', this._exit);
    },
    beforeUnmount() { this._disposed = true; this.cancel(false); document.removeEventListener('visibilitychange', this._visibility); window.removeEventListener('pagehide', this._exit); },
    methods: {
        formatSize(bytes) { return bytes >= 1048576 ? `${(bytes / 1048576).toFixed(2)} MiB` : `${(bytes / 1024).toFixed(1)} KiB`; },
        cancel(inform = true) { ++this._revision; this._controller?.abort(); this._controller = null; this.busy = false; this.$emit('busy-change', false); if (inform) this.notice = 'APK 包名读取已取消，可重新读取'; },
        clear() { this.cancel(false); this.file = null; this.result = null; this.error = ''; this.notice = ''; this.progress = 0; if (this.$refs.fileInput) this.$refs.fileInput.value = ''; },
        chooseFile(event) {
            this.cancel(false); this.result = null; this.error = ''; this.notice = ''; this.progress = 0; this.file = null;
            const file = event.target.files?.[0];
            if (!file) return;
            if (!/^.+\.apk$/i.test(file.name) || !file.size) { this.error = '请选择单个非空 .apk 文件，不支持 AAB/APKS'; return; }
            if (file.size > 1024 * 1024 * 1024) { this.error = 'APK 超出 1 GiB 大小限制'; return; }
            this.file = file;
        },
        async readPackage() {
            if (!this.file || this.disabled || this.busy) return;
            const revision = ++this._revision, controller = this._controller = new AbortController();
            this.busy = true; this.progress = 0; this.result = null; this.error = ''; this.notice = ''; this.$emit('busy-change', true);
            try {
                const result = await inspectApkPackage(this.file, controller.signal, value => { if (!this._disposed && revision === this._revision) this.progress = value; });
                if (!this._disposed && revision === this._revision) this.result = result;
            } catch (error) { if (!this._disposed && revision === this._revision) this.error = error.message || '无法读取 APK 包名'; }
            finally { if (!this._disposed && revision === this._revision) { this.busy = false; this._controller = null; this.$emit('busy-change', false); } }
        },
        async copyPackage() {
            if (!this.result) return;
            this.error = ''; this.notice = '';
            const revision = this._revision, text = this.result.packageName;
            try { await copyText(text); if (!this._disposed && revision === this._revision) this.notice = '包名已复制'; }
            catch (error) { if (!this._disposed && revision === this._revision) this.error = error.message || '无法复制，请手动选择包名复制'; }
        }
    }
};
</script>

<style scoped>
.apk-info-panel { padding: var(--page-padding); margin-bottom: var(--gap-column); border: 1px solid var(--panel-border); border-radius: var(--radius-md); background: var(--panel-background); }
.apk-info-panel h2 { margin: 0 0 var(--gap-column); font-size: var(--text-section-title); }
.apk-info-row { display: flex; flex-wrap: wrap; align-items: flex-end; gap: var(--gap-column); }
.apk-info-row label { flex: 1; min-width: min(var(--adb-command-column), 100%); color: var(--text-secondary); }
.apk-info-row .input { display: block; width: 100%; box-sizing: border-box; margin-top: var(--adb-small-gap); }
.apk-info-row input::file-selector-button { margin-right: var(--adb-small-gap); padding: var(--adb-small-gap) var(--gap-column); border: 1px solid var(--panel-border); border-radius: var(--radius-sm); background: var(--surface-sunken); color: var(--text-primary); font: inherit; cursor: pointer; }
.apk-info-muted, .apk-info-panel p { overflow-wrap: anywhere; }
.apk-info-muted, #adb-apk-info-progress p { color: var(--text-secondary); }
.apk-info-error { color: var(--danger); }
.apk-info-result { padding-top: var(--gap-column); }
#adb-apk-info-package { font-family: var(--font-mono); }
#adb-apk-info-progress progress { width: 100%; accent-color: var(--accent); }
</style>
