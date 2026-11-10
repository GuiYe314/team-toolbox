<template>
    <section id="android-adb-settings" class="adb-settings">
        <p v-if="error" class="adb-settings-error" role="alert">{{ error }}</p>
        <p v-if="notice" role="status">{{ notice }}</p>
        <p v-if="warning" class="adb-settings-muted" role="status">{{ warning }}</p>
        <p v-if="!config && busy">正在读取 ADB 配置…</p>
        <button v-if="!config && !busy" class="btn" @click="load">重新读取 ADB 配置</button>
        <template v-if="config">
            <form id="adb-folder-form" class="adb-settings-row" @submit.prevent="searchFolder">
                <label class="adb-settings-grow" for="adb-folder">ADB 搜索文件夹（工具箱服务器）
                    <input id="adb-folder" v-model="folderInput" class="input" placeholder="C:\Android 或 C:\Android\platform-tools" :disabled="busy || config.origin === 'env'" autocomplete="off" spellcheck="false" @input="candidates = []; selectedCandidate = ''" />
                </label>
                <button class="btn btn-primary" type="submit" :disabled="busy || config.origin === 'env'">{{ busy ? '处理中…' : '搜索并配置' }}</button>
            </form>
            <p v-if="config.origin === 'env'" class="adb-settings-muted">路径由服务器的 ADB_PATH 环境变量指定。</p>
            <p v-else class="adb-settings-muted">搜索文件夹及子文件夹中的 adb.exe；找到多个版本时请选择一个。</p>
            <form v-if="candidates.length > 1" id="adb-candidate-form" class="adb-settings-row" @submit.prevent="saveCandidate">
                <label class="adb-settings-grow" for="adb-candidate">找到 {{ candidates.length }} 个 ADB
                    <select id="adb-candidate" v-model="selectedCandidate" class="input adb-select" :disabled="busy">
                        <option value="" disabled>请选择 ADB</option><option v-for="candidate in candidates" :key="candidate" :value="candidate">{{ candidate }}</option>
                    </select>
                </label>
                <button class="btn btn-primary" type="submit" :disabled="busy || !selectedCandidate">使用此 ADB</button>
            </form>
            <div v-if="config.configured" class="adb-settings-row">
                <p class="adb-settings-grow adb-settings-path">当前使用：{{ config.path }}</p>
                <button v-if="config.origin !== 'env'" id="adb-clear-config" class="btn btn-sm" :disabled="busy" @click="clearConfig">清除配置</button>
            </div>
            <pre v-if="version" class="adb-version">{{ version }}</pre>
        </template>
    </section>
</template>

<script>
import { androidApi } from '../api/android-client.js';
export default {
    name: 'AndroidAdbSettings',
    emits: ['saved'],
    data() { return { config: null, folderInput: '', candidates: [], selectedCandidate: '', version: '', busy: false, error: '', notice: '', warning: '' }; },
    mounted() { this._controller = new AbortController(); this.load(); },
    beforeUnmount() { this._disposed = true; this._controller.abort(); },
    methods: {
        async perform(action) {
            if (this.busy) return;
            this.busy = true; this.error = ''; this.notice = ''; this.warning = '';
            try { await action(); } catch (error) { if (!this._disposed) this.error = error.message; }
            finally { if (!this._disposed) this.busy = false; }
        },
        load() { return this.perform(async () => { this.config = await androidApi.config(this._controller.signal); this.folderInput = this.config.directory; }); },
        searchFolder() { return this.perform(async () => {
            this.candidates = []; this.selectedCandidate = '';
            const result = await androidApi.searchFolder(this.folderInput, this._controller.signal);
            if (result.truncated || result.skippedDirectories) this.warning = '部分目录未扫描，请尽量选择 Platform-Tools 所在文件夹。';
            this.candidates = result.candidates;
            if (!this.candidates.length) throw new Error('此文件夹中未找到 adb.exe，请检查是否已解压 Platform-Tools 或缩小搜索范围。');
            if (this.candidates.length === 1) await this.saveConfig(this.candidates[0]);
            else this.notice = `找到 ${this.candidates.length} 个 ADB，请选择后配置`;
        }); },
        saveCandidate() { return this.perform(() => this.saveConfig(this.selectedCandidate)); },
        clearConfig() { return this.perform(() => this.saveConfig('')); },
        async saveConfig(path) {
            const result = await androidApi.configure(path, this._controller.signal);
            this.config = result; this.folderInput = result.directory; this.version = result.version; this.candidates = []; this.selectedCandidate = '';
            this.notice = result.configured ? 'ADB 路径已校验并保存' : 'ADB 配置已清除';
            this.$emit('saved', result);
        }
    }
};
</script>

<style scoped>
.adb-settings { padding: var(--page-padding); margin-bottom: var(--gap-column); border: 1px solid var(--panel-border); border-radius: var(--radius-md); background: var(--panel-background); }
.adb-settings h2 { margin: 0 0 var(--gap-column); font-size: var(--text-section-title); }
.adb-settings p { line-height: var(--line-relaxed); overflow-wrap: anywhere; }
.adb-settings-row { display: flex; align-items: flex-end; gap: var(--gap-column); flex-wrap: wrap; }
.adb-settings-grow { flex: 1; min-width: 0; }
.adb-settings label { color: var(--text-secondary); font-size: var(--text-body); }
.adb-settings .input { width: 100%; display: block; box-sizing: border-box; margin-top: var(--adb-small-gap); }
.adb-settings-muted { color: var(--text-secondary); }
.adb-settings-error { color: var(--danger); }
.adb-settings-path, .adb-version { font-family: var(--font-mono); font-size: var(--text-body); }
.adb-version { white-space: pre-wrap; padding: var(--gap-column); border-radius: var(--radius-sm); background: var(--surface-sunken); }
</style>
