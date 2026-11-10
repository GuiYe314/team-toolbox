<template>
    <section class="adb-apk" aria-labelledby="adb-apk-title">
        <h2 id="adb-apk-title">APK 传送安装</h2>
        <label class="adb-apk-mode"><input id="adb-apk-batch-mode" v-model="batchMode" type="checkbox" :disabled="disabled || busy">多设备安装</label>
        <div class="adb-apk-row">
            <label v-if="!batchMode" for="adb-apk-device">安装设备
                <select id="adb-apk-device" v-model="serial" class="input adb-select" :disabled="disabled || busy">
                    <option value="">请选择在线设备</option>
                    <option v-for="device in onlineDevices" :key="device.serial" :value="device.serial">{{ device.model || device.product || '安卓设备' }} · {{ device.serial }}</option>
                </select>
            </label>
            <label for="adb-apk-file">选择 APK 文件
                <input ref="fileInput" id="adb-apk-file" class="input" type="file" accept=".apk,application/vnd.android.package-archive" :disabled="disabled || busy" @change="chooseFile" />
            </label>
        </div>
        <fieldset v-if="batchMode" class="adb-apk-devices" :disabled="disabled || busy" aria-label="批量安装设备">
            <legend>选择安装设备 · 已选 {{ selectedSerials.length }} / {{ onlineDevices.length }} 台（每批最多 20 台）</legend>
            <div class="adb-apk-actions">
                <button id="adb-apk-select-all" class="btn btn-sm" type="button" :disabled="!onlineDevices.length" @click="selectedSerials = onlineDevices.slice(0, 20).map(device => device.serial)">{{ onlineDevices.length > 20 ? '选择前 20 台' : '全选在线设备' }}</button>
                <button id="adb-apk-select-none" class="btn btn-sm" type="button" :disabled="!selectedSerials.length" @click="selectedSerials = []">取消全选</button>
            </div>
            <div class="adb-apk-device-list">
                <label v-for="device in onlineDevices" :key="device.serial" class="adb-apk-device-option">
                    <input v-model="selectedSerials" type="checkbox" :value="device.serial" :disabled="selectedSerials.length >= 20 && !selectedSerials.includes(device.serial)">
                    <span>{{ device.model || device.product || '安卓设备' }}<small>{{ device.serial }}</small></span>
                </label>
            </div>
            <p v-if="!onlineDevices.length" class="adb-apk-muted">暂无在线且已授权的设备，请先连接手机并刷新设备列表。</p>
            <p class="adb-apk-muted">同一个 APK 只上传一次，按所选设备顺序逐台安装；单台失败会继续下一台。</p>
        </fieldset>
        <p v-if="file" id="adb-apk-selected" class="adb-apk-muted">{{ file.name }} · {{ formatSize(file.size) }}</p>
        <div class="adb-apk-actions">
            <button id="adb-apk-install" class="btn btn-primary" type="button" :disabled="!canInstall" @click="pending = true">{{ batchMode ? `安装到 ${selectedSerials.length} 台设备` : '传送并安装' }}</button>
            <button v-if="busy" id="adb-apk-cancel" class="btn" type="button" @click="cancel">取消操作</button>
            <button v-else-if="file" id="adb-apk-clear" class="btn" type="button" :disabled="disabled" @click="clearFile">清除文件</button>
        </div>
        <div v-if="pending && !busy" class="adb-apk-confirm" role="group" aria-label="APK 安装确认">
            <template v-if="batchMode">
                <p>将 <strong>{{ file?.name }}</strong>（{{ formatSize(file?.size) }}）安装到以下 <strong>{{ targets.length }} 台设备</strong>？</p>
                <ul id="adb-apk-confirm-targets"><li v-for="device in targets" :key="device.serial">{{ device.model || device.product || '安卓设备' }} · {{ device.serial }}</li></ul>
            </template>
            <p v-else>将 <strong>{{ file?.name }}</strong>（{{ formatSize(file?.size) }}）安装到 <strong>{{ target?.model || '安卓设备' }} · {{ serial }}</strong>？</p>
            <p class="adb-apk-muted">同包名应用将覆盖安装并保留应用数据。手机可能要求确认安装。</p>
            <div class="adb-apk-actions">
                <button id="adb-apk-confirm" class="btn btn-primary" type="button" :disabled="!canInstall" @click="install">确认安装</button>
                <button id="adb-apk-dismiss" class="btn" type="button" @click="pending = false">取消</button>
            </div>
        </div>
        <div v-if="busy" class="adb-apk-progress" role="status" aria-live="polite">
            <template v-if="phase === 'upload'">
                <p>正在传送到工具箱：{{ progress }}%</p>
                <progress aria-label="APK 上传进度" :value="progress" max="100"></progress>
            </template>
            <p v-else>{{ batchMode ? `正在校验并逐台安装，已返回 ${finishedCount} / ${batchResults.length} 台结果…` : '正在校验安装包并通过 ADB 传送安装，请稍候…' }}</p>
        </div>
        <p v-if="error" id="adb-apk-error" class="adb-apk-error" role="alert">{{ error }}</p>
        <p v-if="notice" class="adb-apk-muted" role="status">{{ notice }}</p>
        <div v-if="result" id="adb-apk-result" class="adb-apk-result" role="status">
            <strong>{{ result.message }}</strong>
            <p>{{ result.fileName }} · {{ result.serial }}</p>
            <pre v-if="result.stdout || result.stderr">{{ result.stdout }}{{ result.stderr ? '\n' + result.stderr : '' }}</pre>
        </div>
        <div v-if="batchResults.length" id="adb-apk-batch-results" class="adb-apk-result" aria-live="polite">
            <strong>{{ batchResult?.message || (busy ? '设备安装进度' : '本次批量安装结果') }}</strong>
            <p>{{ batchFileName }}</p>
            <ol class="adb-apk-result-list">
                <li v-for="item in batchResults" :key="item.serial" :data-serial="item.serial" :data-status="item.status">
                    <div class="adb-apk-result-heading"><span>{{ item.label }} · {{ item.serial }}</span><strong :class="{ 'adb-apk-error': item.status === 'failed', 'adb-apk-success': item.status === 'success' }">{{ statusLabel(item.status) }}</strong></div>
                    <p>{{ item.message }}</p>
                    <details v-if="item.stdout || item.stderr"><summary>查看 ADB 输出</summary><pre>{{ item.stdout }}{{ item.stderr ? '\n' + item.stderr : '' }}</pre></details>
                </li>
            </ol>
            <button v-if="!busy && failedSerials.length" id="adb-apk-retry-failed" class="btn btn-sm" type="button" :disabled="disabled" @click="selectFailed">只选择失败设备（{{ failedSerials.length }} 台）</button>
        </div>
    </section>
</template>

<script>
import { androidApi } from '../api/android-client.js';

export default {
    name: 'AndroidApkInstaller',
    props: { devices: { type: Array, default: () => [] }, disabled: Boolean },
    emits: ['busy-change'],
    data() { return { serial: '', batchMode: false, selectedSerials: [], file: null, pending: false, busy: false, progress: 0, phase: '', error: '', notice: '', result: null,
        batchResults: [], batchResult: null, batchFileName: '' }; },
    computed: {
        onlineDevices() { return this.devices.filter(device => device.state === 'device'); },
        target() { return this.onlineDevices.find(device => device.serial === this.serial); },
        targets() { return this.batchMode ? this.selectedSerials.map(serial => this.onlineDevices.find(device => device.serial === serial)).filter(Boolean) : this.target ? [this.target] : []; },
        canInstall() { return this.targets.length > 0 && (!this.batchMode || this.targets.length === this.selectedSerials.length && this.targets.length <= 20) && !!this.file && !this.disabled && !this.busy; },
        finishedCount() { return this.batchResults.filter(item => ['success', 'failed'].includes(item.status)).length; },
        failedSerials() { return this.batchResults.filter(item => item.status === 'failed').map(item => item.serial); }
    },
    watch: {
        devices() {
            if (!this.batchMode && !this.target && this.serial) { this.cancel(); this.serial = ''; }
            if (this.batchMode && !this.busy) this.selectedSerials = this.selectedSerials.filter(serial => this.onlineDevices.some(device => device.serial === serial));
        },
        serial() { this.pending = false; this.result = null; this.error = ''; },
        batchMode() { this.pending = false; this.result = null; this.batchResults = []; this.batchResult = null; this.error = ''; this.notice = ''; },
        selectedSerials: { deep: true, handler() { this.pending = false; this.error = ''; } },
        disabled(value) { if (value && !this.busy) this.pending = false; }
    },
    beforeUnmount() { this._disposed = true; this._request?.abort(); this.file = null; },
    methods: {
        formatSize(size = 0) { return size >= 1024 * 1024 ? `${(size / (1024 * 1024)).toFixed(1)} MiB` : `${(size / 1024).toFixed(1)} KiB`; },
        clearFile() { this.file = null; this.pending = false; this.result = null; this.batchResults = []; this.batchResult = null; this.error = ''; this.notice = ''; if (this.$refs.fileInput) this.$refs.fileInput.value = ''; },
        chooseFile(event) {
            const file = event.target.files?.[0]; this.pending = false; this.result = null; this.batchResults = []; this.batchResult = null; this.error = ''; this.notice = ''; this.file = null;
            if (!file) return;
            if (!/^.+\.apk$/i.test(file.name)) this.error = '请选择 .apk 安装包，不支持 AAB/APKS';
            else if (!file.size) this.error = 'APK 文件为空，请重新选择';
            else if (file.size > 1024 * 1024 * 1024) this.error = 'APK 超出 1 GiB 大小限制';
            else this.file = file;
            if (!this.file) event.target.value = '';
        },
        cancel() {
            if (!this.busy) return;
            this.notice = this.batchMode ? '批量安装已取消，已完成安装不回滚，请在手机确认最终状态。' : '请求已取消，请在手机确认最终安装状态。'; this._request?.abort();
        },
        statusLabel(status) { return { pending: '等待安装', installing: '安装中', success: '成功', failed: '失败', cancelled: '已取消', stopped: '队列停止', unknown: '结果未确认' }[status] || status; },
        selectFailed() {
            this.selectedSerials = this.failedSerials.filter(serial => this.onlineDevices.some(device => device.serial === serial));
            this.pending = false;
            this.notice = this.selectedSerials.length ? `已选择 ${this.selectedSerials.length} 台在线的失败设备，请重新核对并确认安装。` : '失败设备当前不在线，请连接并刷新设备后重新选择。';
        },
        updateBatchResult(result) {
            this.batchResults = this.batchResults.map(item => item.serial === result.serial ? { ...item, ...result } : item);
        },
        async install() {
            if (!this.canInstall || !this.pending) return;
            const file = this.file, serial = this.serial, batch = this.batchMode, targets = [...this.targets];
            this.pending = false; this.busy = true; this.error = ''; this.notice = ''; this.result = null; this.progress = 0; this.phase = 'upload';
            this.batchResult = null; this.batchFileName = file.name;
            this.batchResults = batch ? targets.map(device => ({ serial: device.serial, label: device.model || device.product || '安卓设备', status: 'pending', message: '等待安装' })) : [];
            this._request = new AbortController(); this.$emit('busy-change', true);
            try {
                const progressChanged = (progress, phase) => {
                    if (!this._disposed) { this.progress = progress; this.phase = phase; }
                };
                if (batch) {
                    const result = await androidApi.installApkBatch(file, targets.map(device => device.serial), this._request.signal, progressChanged,
                        result => { if (!this._disposed) this.updateBatchResult(result); });
                    if (!this._disposed) { this.batchResult = result; for (const item of result.results) this.updateBatchResult(item); }
                } else {
                    const result = await androidApi.installApk(file, serial, this._request.signal, progressChanged);
                    if (!this._disposed) this.result = result;
                }
            } catch (error) {
                if (!this._disposed) {
                    if (!this._request.signal.aborted) this.error = error.message;
                    if (batch) this.batchResults = this.batchResults.map(item => ['pending', 'installing'].includes(item.status)
                        ? { ...item, status: item.status === 'pending' ? 'stopped' : this._request.signal.aborted ? 'cancelled' : 'unknown', message: '队列已停止；未收到最终结果，请核对手机实际安装状态。' } : item);
                }
            } finally {
                if (!this._disposed) { this.busy = false; this.$emit('busy-change', false); }
            }
        }
    }
};
</script>

<style scoped>
.adb-apk { padding: var(--page-padding); margin-bottom: var(--gap-column); border: 1px solid var(--panel-border); border-radius: var(--radius-md); background: var(--panel-background); }
.adb-apk h2 { margin: 0 0 var(--gap-column); font-size: var(--text-section-title); }
.adb-apk-row, .adb-apk-actions { display: flex; align-items: flex-end; flex-wrap: wrap; gap: var(--gap-column); }
.adb-apk-row label { flex: 1; min-width: min(var(--adb-command-column), 100%); color: var(--text-secondary); }
.adb-apk-row .input { display: block; width: 100%; box-sizing: border-box; margin-top: var(--adb-small-gap); }
.adb-apk-row input[type=file] { font-size: var(--text-body); }
.adb-apk-mode, .adb-apk-device-option { display: flex; align-items: center; gap: var(--adb-small-gap); color: var(--text-primary); }
.adb-apk-mode { margin-bottom: var(--gap-column); }
.adb-apk-mode input, .adb-apk-device-option input { accent-color: var(--accent); }
.adb-apk-devices { margin: var(--gap-column) 0 0; padding: var(--gap-column); border: 1px solid var(--panel-border); border-radius: var(--radius-sm); min-width: 0; }
.adb-apk-devices legend { color: var(--text-secondary); font-size: var(--text-body); }
.adb-apk-device-list { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(var(--adb-command-column), 100%), 1fr)); gap: var(--gap-column); max-height: var(--adb-output-height); overflow: auto; margin-top: var(--gap-column); }
.adb-apk-device-option { padding: var(--adb-small-gap); border-radius: var(--radius-sm); background: var(--surface-sunken); overflow-wrap: anywhere; cursor: pointer; }
.adb-apk-device-option small { display: block; color: var(--text-secondary); font-size: var(--text-body); }
.adb-apk-device-option input { flex-shrink: 0; }
.adb-apk-row input::file-selector-button { margin-right: var(--adb-small-gap); padding: var(--adb-small-gap) var(--gap-column); border: 1px solid var(--panel-border); border-radius: var(--radius-sm); background: var(--surface-sunken); color: var(--text-primary); font: inherit; cursor: pointer; }
.adb-apk-actions { margin-top: var(--gap-column); }
.adb-apk-muted { color: var(--text-secondary); line-height: var(--line-relaxed); overflow-wrap: anywhere; }
.adb-apk-confirm, .adb-apk-result { margin-top: var(--gap-column); padding: var(--gap-column); border-radius: var(--radius-sm); background: var(--surface-sunken); overflow-wrap: anywhere; }
.adb-apk-error { color: var(--danger); white-space: pre-wrap; overflow-wrap: anywhere; }
.adb-apk-progress progress { width: 100%; accent-color: var(--accent); }
.adb-apk-progress p { color: var(--text-secondary); }
.adb-apk-result pre { max-height: var(--adb-output-height); overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; font-family: var(--font-mono); font-size: var(--text-body); }
.adb-apk-result-list { list-style: none; margin: var(--gap-column) 0; padding: 0; }
.adb-apk-result-list li { padding: var(--gap-column) 0; border-bottom: 1px solid var(--panel-border); }
.adb-apk-result-heading { display: flex; justify-content: space-between; flex-wrap: wrap; gap: var(--adb-small-gap); }
.adb-apk-result-heading strong { flex-shrink: 0; }
.adb-apk-result-list p { color: var(--text-secondary); white-space: pre-wrap; overflow-wrap: anywhere; }
.adb-apk-success { color: var(--success); }
</style>
