<template>
    <section class="adb-section persistent-panel" aria-labelledby="adb-persistent-title">
        <h2 id="adb-persistent-title">Unity 替换 persistentDataPath 中文件</h2>
        <div class="persistent-row">
            <label>目标设备<select id="adb-persistent-device" v-model="serial" class="input adb-select" :disabled="disabled || !!busy">
                <option value="" disabled>选择已连接设备</option><option v-for="device in online" :key="device.serial" :value="device.serial">{{ device.model || '安卓设备' }} · {{ device.serial }}</option>
            </select></label>
            <button id="adb-persistent-apps-refresh" class="btn" :disabled="disabled || !!busy || !serial" @click="loadApps">读取应用</button>
        </div>
        <div v-if="apps.length" class="persistent-row">
            <label>搜索应用<input id="adb-persistent-search" v-model="query" class="input" placeholder="输入 Unity App 的包名" :disabled="disabled || !!busy" /></label>
            <label>已安装应用<select id="adb-persistent-app" v-model="packageName" class="input adb-select" :disabled="disabled || !!busy">
                <option value="" disabled>选择 Unity App 包名</option><option v-for="name in appOptions" :key="name" :value="name">{{ name }}</option>
            </select></label>
        </div>
        <div class="persistent-actions">
            <button id="adb-persistent-load" class="btn" :disabled="disabled || !!busy || !packageName" @click="loadDirectory(directory ? path : '')">{{ directory ? '刷新目录' : '读取 persistentDataPath' }}</button>
            <button v-if="directory" id="adb-persistent-root" class="btn" :disabled="disabled || !!busy" @click="reopenRoot">重新定位根目录</button>
            <button v-if="directory && path" id="adb-persistent-up" class="btn" :disabled="disabled || !!busy" @click="loadDirectory(parentPath)">返回上级</button>
            <button v-if="busy" id="adb-persistent-cancel" class="btn" @click="cancel(true)">取消操作</button>
        </div>
        <p class="adb-muted">读取标准 Android/data/包名/files 目录。请先启动一次 App；应用列表按包名显示，不能自动判断是否使用 Unity。替换前建议关闭 App 并下载原文件备份。</p>
        <p v-if="error" id="adb-persistent-error" class="persistent-error" role="alert">{{ error }}</p>
        <p v-if="notice" id="adb-persistent-notice" role="status">{{ notice }}</p>
        <p v-if="busy" id="adb-persistent-progress" class="adb-muted" role="status">{{ busy }}{{ uploading ? progress < 100 ? ` · 上传 ${progress}%` : ' · 正在通过 ADB 写入并校验…' : '…' }}</p>
        <template v-if="directory">
            <p id="adb-persistent-path" class="persistent-path">{{ directory.root }}{{ path ? '/' + path : '' }}<small>Android 用户 {{ directory.userId }}</small></p>
            <p v-if="directory.truncated || directory.skipped" class="adb-muted">{{ directory.truncated ? '当前目录只显示前 1000 项。' : '' }}{{ directory.skipped ? ` ${directory.skipped} 项文件名不受支持，已跳过。` : '' }}</p>
            <div class="persistent-list"><table class="adb-table"><thead><tr><th>文件名</th><th>大小 / 修改时间</th><th>操作</th></tr></thead><tbody>
                <tr v-for="entry in directory.entries" :key="entry.name" :data-persistent-name="entry.name">
                    <td><button v-if="entry.kind === 'directory'" class="btn btn-sm" :disabled="disabled || !!busy" @click="loadDirectory(childPath(entry.name))">{{ entry.name }}/</button><span v-else>{{ entry.name }}{{ entry.kind === 'blocked' ? '（链接或特殊文件，不可操作）' : '' }}</span></td>
                    <td>{{ entry.kind === 'file' ? size(entry.size) : '—' }}<small>{{ entry.modifiedAt ? new Date(entry.modifiedAt * 1000).toLocaleString() : '' }}</small></td>
                    <td v-if="entry.kind === 'file'"><div class="persistent-actions">
                        <button class="btn btn-sm persistent-preview" :disabled="disabled || !!busy || entry.size > 262144" @click="preview(entry)">预览文本</button>
                        <button class="btn btn-sm persistent-download" :disabled="disabled || !!busy || entry.size > maximum" @click="download(entry)">下载</button>
                        <button class="btn btn-sm persistent-replace" :disabled="disabled || !!busy" @click="selectReplace(entry)">替换</button>
                    </div></td><td v-else>—</td>
                </tr>
            </tbody></table><p v-if="!directory.entries.length" class="adb-empty">当前目录为空，可添加文件。</p></div>
            <div v-if="previewResult" class="persistent-preview-box"><div class="persistent-actions"><strong>{{ previewResult.path }}</strong><button class="btn btn-sm" @click="previewResult = null">关闭预览</button></div><pre id="adb-persistent-preview">{{ previewResult.text }}</pre></div>
            <h3>{{ mode === 'replace' ? '替换已选文件' : '添加文件到当前目录' }}</h3>
            <div class="persistent-row">
                <label>电脑上的文件<input ref="fileInput" id="adb-persistent-file" type="file" class="input" :disabled="disabled || !!busy" @change="chooseFile" /></label>
                <label>手机端文件名<input id="adb-persistent-name" v-model="fileName" class="input" :readonly="mode === 'replace'" :disabled="disabled || !!busy" /></label>
            </div>
            <p v-if="file" class="adb-muted">{{ file.name }} · {{ size(file.size) }} → {{ childPath(fileName) }}</p>
            <div class="persistent-actions">
                <button id="adb-persistent-prepare" class="btn btn-primary" :disabled="!canWrite" @click="prepare">{{ mode === 'replace' ? '核对并替换' : '添加文件' }}</button>
                <button v-if="mode === 'replace'" id="adb-persistent-add-mode" class="btn" :disabled="disabled || !!busy" @click="addMode">改为添加文件</button>
            </div>
            <div v-if="pending" id="adb-persistent-confirmation" class="persistent-confirm" role="group" aria-label="确认写入应用文件">
                <strong>{{ mode === 'replace' ? '确认替换手机文件' : '确认添加手机文件' }}</strong>
                <p>{{ targetLabel }} · {{ serial }}<br />{{ packageName }} · Android 用户 {{ directory.userId }}<br />{{ directory.root }}/{{ pending.path }}</p>
                <p>{{ mode === 'replace' ? `原文件 ${size(pending.originalSize)} → ` : '' }}新文件 {{ size(file.size) }}。{{ mode === 'replace' ? '确认后覆盖原内容，请先下载备份。' : '同名文件存在时会拒绝写入。' }}</p>
                <div class="persistent-actions"><button id="adb-persistent-confirm" class="btn btn-primary" :disabled="!canWrite" @click="writeFile">确认{{ mode === 'replace' ? '替换' : '添加' }}</button><button id="adb-persistent-dismiss" class="btn" @click="pending = null">取消</button></div>
            </div>
            <p class="adb-muted">仅支持普通文件，单文件最多 256 MiB；UTF-8 文本预览最多 256 KiB。不会停止 App；运行中的 App 可能继续修改文件。设备拒绝访问时请检查权限，不会自动 root 或更改权限。</p>
        </template>
    </section>
</template>

<script>
import { androidApi } from '../api/android-client.js';
import { persistentApi } from '../api/android-persistent-client.js';
export default {
    name: 'AndroidPersistentFiles', props: { devices: { type: Array, default: () => [] }, disabled: Boolean }, emits: ['busy-change'],
    data() { return { serial: '', packageName: '', apps: [], query: '', directory: null, path: '', file: null, fileName: '', mode: 'add', pending: null, previewResult: null, busy: '', uploading: false, progress: 0, error: '', notice: '', maximum: 256 * 1024 * 1024 }; },
    computed: {
        online() { return this.devices.filter(device => device.state === 'device'); },
        targetLabel() { return this.online.find(device => device.serial === this.serial)?.model || '安卓设备'; },
        appOptions() { const list = this.apps.filter(name => name.toLowerCase().includes(this.query.trim().toLowerCase())); return this.packageName && !list.includes(this.packageName) ? [this.packageName, ...list] : list; },
        parentPath() { return this.path.split('/').slice(0, -1).join('/'); },
        canWrite() { return !this.busy && !this.disabled && this.directory && this.file && this.fileName && this.online.some(d => d.serial === this.serial); }
    },
    watch: {
        serial() { this.reset(); this.apps = []; this.packageName = ''; this.query = ''; },
        packageName() { this.reset(); },
        devices() { if (this.serial && !this.online.some(d => d.serial === this.serial)) { this.reset(); this.serial = ''; } },
        fileName() { this.pending = null; },
        disabled(value) { if (value && !this.busy) this.pending = null; }
    },
    mounted() { this._revision = 0; this._urls = new Map(); this._visibility = () => { if (document.hidden) this.cancel(!!this.busy); }; document.addEventListener('visibilitychange', this._visibility); this._pageExit = () => this.cancel(false); window.addEventListener('pagehide', this._pageExit); },
    beforeUnmount() { this._disposed = true; this.cancel(false); document.removeEventListener('visibilitychange', this._visibility); window.removeEventListener('pagehide', this._pageExit); for (const [url, timer] of this._urls) { clearTimeout(timer); URL.revokeObjectURL(url); } this._urls.clear(); },
    methods: {
        size(bytes) { return bytes >= 1048576 ? `${(bytes / 1048576).toFixed(2)} MiB` : bytes >= 1024 ? `${(bytes / 1024).toFixed(1)} KiB` : `${bytes} B`; },
        childPath(name) { return this.path ? this.path + '/' + name : name; },
        input(path = this.path) { return { serial: this.serial, packageName: this.packageName, path, ...(this.directory ? { userId: this.directory.userId } : {}) }; },
        cancel(inform = true) { ++this._revision; this._controller?.abort(); this._controller = null; this.busy = ''; this.uploading = false; this.pending = null; this.$emit('busy-change', false); if (inform) this.notice = '操作已取消；若刚提交写入，请刷新并核对手机文件。'; },
        reset() { this.cancel(false); this.directory = null; this.path = ''; this.previewResult = null; this.file = null; this.fileName = ''; this.mode = 'add'; this.error = ''; this.notice = ''; if (this.$refs.fileInput) this.$refs.fileInput.value = ''; },
        async perform(label, action, apply) {
            const revision = ++this._revision, controller = this._controller = new AbortController();
            this.busy = label; this.error = ''; this.notice = ''; this.$emit('busy-change', true);
            try { const result = await action(controller.signal); if (!this._disposed && revision === this._revision) await apply(result); }
            catch (error) { if (!this._disposed && revision === this._revision) this.error = controller.signal.aborted ? '操作已取消' : error.message || '无法连接服务器'; }
            finally { if (!this._disposed && revision === this._revision) { this.busy = ''; this.uploading = false; this.$emit('busy-change', false); } }
        },
        loadApps() { this.reset(); return this.perform('读取应用', signal => androidApi.listApps(this.serial, signal), result => { this.apps = result.packages; if (!this.apps.length) this.notice = '未读取到已安装应用'; if (result.truncated) this.notice = '仅显示前 2000 个包名'; if (!this.apps.includes(this.packageName)) this.packageName = ''; }); },
        reopenRoot() { this.reset(); return this.loadDirectory(''); },
        loadDirectory(path) {
            this.pending = null; this.previewResult = null;
            return this.perform('读取应用目录', signal => persistentApi.list(this.input(path), signal), result => { this.directory = result; this.path = result.path; this.file = null; this.fileName = ''; this.mode = 'add'; if (this.$refs.fileInput) this.$refs.fileInput.value = ''; });
        },
        preview(entry) { return this.perform('读取文件', signal => persistentApi.preview(this.input(this.childPath(entry.name)), signal), result => { this.previewResult = result; }); },
        download(entry) {
            return this.perform('下载文件', signal => persistentApi.download(this.input(this.childPath(entry.name)), signal), blob => {
                const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = entry.name; document.body.append(link); link.click(); link.remove();
                this._urls.set(url, setTimeout(() => { URL.revokeObjectURL(url); this._urls.delete(url); }, 1000)); this.notice = '文件已交给浏览器下载';
            });
        },
        selectReplace(entry) { this.pending = null; this.mode = 'replace'; this.fileName = entry.name; this.error = ''; this.notice = `已选择替换 ${entry.name}，请选择电脑上的新文件`; this.$refs.fileInput?.focus(); },
        addMode() { this.pending = null; this.mode = 'add'; this.fileName = this.file?.name || ''; },
        chooseFile(event) {
            this.pending = null; this.error = ''; const file = event.target.files?.[0]; this.file = null;
            if (!file) return;
            if (file.size > this.maximum) { this.error = '文件超过 256 MiB 上传限制'; return; }
            this.file = file; if (this.mode === 'add') this.fileName = file.name;
        },
        async prepare() {
            this.pending = null;
            if (!this.canWrite) return;
            if (/[\x00-\x1f\x7f/\\]/.test(this.fileName) || ['.', '..'].includes(this.fileName) || this.fileName.startsWith('.toolbox-transfer-') || new TextEncoder().encode(this.fileName).length > 255) { this.error = '请填写单个有效文件名，不能包含路径'; return; }
            const path = this.childPath(this.fileName);
            if (this.mode === 'add') {
                if (this.directory.entries.some(entry => entry.name === this.fileName)) { this.error = '同名文件已存在，请从列表点击“替换”'; return; }
                this.pending = { path }; return;
            }
            return this.perform('核对原文件', signal => persistentApi.inspect(this.input(path), signal), meta => { this.pending = { path, expectedHash: meta.sha256, originalSize: meta.size }; });
        },
        async writeFile() {
            if (!this.pending || !this.canWrite) return;
            const pending = this.pending, input = { ...this.input(pending.path), mode: this.mode, ...(this.mode === 'replace' ? { expectedHash: pending.expectedHash } : {}) };
            this.pending = null; this.uploading = true; this.progress = 0;
            return this.perform('传送应用文件', async signal => {
                const result = await persistentApi.upload(this.file, input, signal, value => { if (!signal.aborted) this.progress = value; });
                let directory, warning; try { directory = await persistentApi.list(this.input(), signal); } catch { warning = '文件已写入，但目录刷新失败，请手动刷新'; }
                return { result, directory, warning };
            }, ({ result, directory, warning }) => { this.notice = warning || result.message; if (directory) this.directory = directory; this.file = null; this.previewResult = null; this.fileName = ''; this.mode = 'add'; if (this.$refs.fileInput) this.$refs.fileInput.value = ''; });
        }
    }
};
</script>

<style scoped>
.persistent-panel { padding: var(--page-padding); margin-bottom: var(--gap-column); border: 1px solid var(--panel-border); border-radius: var(--radius-md); background: var(--panel-background); }
.persistent-panel h2 { font-size: var(--text-section-title); margin: 0 0 var(--gap-column); }
.persistent-row, .persistent-actions { display: flex; gap: var(--gap-column); align-items: flex-end; flex-wrap: wrap; margin-bottom: var(--gap-column); }
.persistent-row label { flex: 1; min-width: 0; color: var(--text-secondary); font-size: var(--text-body); }
.persistent-row .input { display: block; margin-top: var(--adb-small-gap); width: 100%; box-sizing: border-box; }
.persistent-panel h3 { font-size: var(--text-section-title); }
.persistent-error { color: var(--danger); }
.persistent-path, .persistent-panel td, .persistent-confirm { overflow-wrap: anywhere; }
.persistent-path { color: var(--text-secondary); font-family: var(--font-mono); }
.persistent-panel small { display: block; margin-top: var(--adb-small-gap); color: var(--text-secondary); }
.persistent-list { max-height: var(--adb-file-list-height); overflow: auto; }
.persistent-list .persistent-actions { margin: 0; gap: var(--adb-small-gap); }
.persistent-preview-box, .persistent-confirm { padding: var(--gap-column); background: var(--surface-sunken); border: 1px solid var(--panel-border); border-radius: var(--radius-sm); margin-block: var(--gap-column); }
.persistent-preview-box pre { max-height: var(--adb-file-preview-height); overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; color: var(--text-primary); font-family: var(--font-mono); }
</style>
