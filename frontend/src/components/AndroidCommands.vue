<template>
    <section class="adb-commands">
        <div class="adb-command-heading"><h2>常用 ADB 命令</h2><div class="adb-command-actions"><button ref="addButton" id="adb-command-add" class="btn btn-sm" :disabled="busy || managing || loading || homeLoading" @click="openEditor(false)">添加命令</button><button ref="editButton" id="adb-command-edit" class="btn btn-sm" :disabled="busy || managing || homeLoading || !selected?.custom" @click="openEditor(true)">编辑</button><button id="adb-command-delete" class="btn btn-sm" :disabled="busy || managing || homeLoading || !selected?.custom" @click="pendingDelete = true; pending = false">删除</button></div></div>
        <p v-if="error" class="adb-command-error" role="alert">{{ error }}</p>
        <button v-if="!loading" id="adb-command-reload" class="btn btn-sm" :disabled="busy || managing || homeLoading" @click="load">重新读取命令</button>
        <p v-if="loading" role="status">正在读取常用命令…</p>
        <form v-if="commands.length" class="adb-command-row" @submit.prevent="execute(false)">
            <label for="adb-command-device">目标设备
                <select id="adb-command-device" v-model="serial" class="input adb-select" :disabled="disabled || busy || managing || loading">
                    <option value="" disabled>请选择已连接设备</option>
                    <option v-for="device in onlineDevices" :key="device.serial" :value="device.serial">{{ device.model || device.serial }} · {{ device.serial }}</option>
                </select>
            </label>
            <label for="adb-command-select">常用命令
                <select id="adb-command-select" v-model="commandId" class="input adb-select" :disabled="disabled || busy || managing || loading">
                    <optgroup v-for="category in categories" :key="category" :label="category">
                        <option v-for="command in commands.filter(item => item.category === category)" :key="command.id" :value="command.id">{{ command.title }}{{ command.custom ? '（自定义）' : '' }}</option>
                    </optgroup>
                </select>
            </label>
            <button id="adb-command-run" class="btn btn-primary" type="submit" :disabled="disabled || busy || managing || loading || homeLoading || !serial || !selected || (selected.requiresHome && !homeChoice)">{{ busy ? '执行中…' : '执行' }}</button>
        </form>
        <p v-if="!onlineDevices.length" class="adb-command-muted">连接设备后点击“刷新设备”，再选择目标。</p>
        <template v-if="selected">
            <p class="adb-command-muted">{{ selected.description }}</p>
            <code class="adb-command-preview">{{ preview }}</code>
        </template>
        <AndroidHomeSelector v-if="selected?.requiresHome && serial" ref="homeSelector" :key="serial + ':' + commandId" :serial="serial" :mode="commandId" :disabled="busy || managing || (disabled && !homeLoading)" @change="homeChanged" @busy-change="homeActivityChanged" />
        <div v-if="pending" class="adb-command-confirm" role="group" :aria-label="selected?.custom ? '自定义命令执行确认' : '默认桌面修改确认'">
            <p>在 <strong>{{ serial }}</strong> 执行“{{ selected.title }}”？</p><code class="adb-command-preview">{{ preview }}</code>
            <p v-if="selected.requiresHome" class="adb-command-muted">将改变此用户的默认桌面，按主页键进入所选程序；可通过“解锁程序（恢复桌面）”选回桌面。</p>
            <div class="adb-command-row">
                <button id="adb-command-confirm" class="btn btn-danger" :disabled="disabled || busy" @click="execute(true)">{{ selected?.custom ? '确认执行' : '确认设置' }}</button>
                <button id="adb-command-cancel" class="btn" :disabled="busy" @click="pending = false">取消</button>
            </div>
        </div>
        <div v-if="pendingDelete && selected?.custom" class="adb-command-confirm" role="group" aria-label="删除自定义命令确认"><p>删除“{{ selected.title }}”？</p><div class="adb-command-actions"><button id="adb-command-delete-confirm" class="btn btn-danger" :disabled="managing || busy" @click="remove">确认删除</button><button id="adb-command-delete-cancel" class="btn" :disabled="managing" @click="pendingDelete = false">取消</button></div></div>
        <div v-if="result" class="adb-command-result">
            <p role="status">{{ result.message }} · {{ result.serial }}</p>
            <pre id="adb-command-output" tabindex="0">{{ result.stdout || (result.stderr ? '' : '命令已完成，无文本输出。') }}{{ result.stderr ? '\n标准错误：\n' + result.stderr : '' }}</pre>
            <button class="btn btn-sm" @click="result = null">清空结果</button>
        </div>
        <AndroidCommandEditor v-if="editorOpen" :record="editing" @close="closeEditor" @saved="saved" @busy-change="managementChanged" />
    </section>
</template>

<script>
import { androidApi } from '../api/android-client.js';
import AndroidCommandEditor from './AndroidCommandEditor.vue';
import AndroidHomeSelector from './AndroidHomeSelector.vue';
export default {
    name: 'AndroidCommands',
    components: { AndroidCommandEditor, AndroidHomeSelector },
    props: { devices: { type: Array, default: () => [] }, disabled: Boolean },
    emits: ['busy-change'],
    data() { return { commands: [], commandId: 'device-info', serial: '', loading: false, busy: false, managing: false, homeLoading: false, homeChoice: null, pending: false, pendingDelete: false, editorOpen: false, editing: null, result: null, error: '' }; },
    computed: {
        onlineDevices() { return this.devices.filter(device => device.state === 'device'); },
        selected() { return this.commands.find(command => command.id === this.commandId); },
        categories() { return [...new Set(this.commands.map(command => command.category))]; },
        preview() { return (this.selected?.preview || '').replace('<设备>', this.serial || '<设备>').replace('<当前用户>', this.homeChoice?.userId ?? '<当前用户>').replace(/<所选(?:程序|桌面)>/, this.homeChoice?.component || '<请选择程序>'); }
    },
    watch: {
        devices() { if (!this.onlineDevices.some(device => device.serial === this.serial)) this.serial = ''; },
        serial() { this.homeChoice = null; this.clear(); },
        commandId() { this.homeChoice = null; this.clear(); },
        disabled(value) { if (value && !this.busy) this.pending = false; }
    },
    mounted() { this._controller = new AbortController(); this.load(); },
    beforeUnmount() { this._disposed = true; this._controller.abort(); },
    methods: {
        clear() { this.pending = false; this.pendingDelete = false; this.result = null; this.error = ''; },
        homeChanged(value) { this.homeChoice = value; this.clear(); },
        homeActivityChanged(value) { this.homeLoading = value; this.$emit('busy-change', value); },
        openEditor(edit) { this.clear(); this.editing = edit ? { ...this.selected } : null; this.editorOpen = true; },
        async closeEditor() { this.editorOpen = false; await this.$nextTick(); (this.editing ? this.$refs.editButton : this.$refs.addButton)?.focus(); },
        managementChanged(value) { this.managing = value; this.$emit('busy-change', value); },
        saved(command) {
            this.commands = [...this.commands.filter(item => item.id !== command.id), command]; this.commandId = command.id; this.clear();
            this.managementChanged(false); this.closeEditor();
        },
        async remove() {
            if (!this.selected?.custom || this.busy || this.managing) return;
            const command = this.selected; this.managementChanged(true); this.error = '';
            try {
                await androidApi.deleteCommand(command.id, command.revision, this._controller.signal);
                if (!this._disposed) { this.commands = this.commands.filter(item => item.id !== command.id); this.commandId = this.commands[0]?.id || ''; this.clear(); }
            } catch (error) { if (!this._disposed) this.error = error.message; }
            finally { if (!this._disposed) this.managementChanged(false); }
        },
        async load() {
            if (this.loading || this.busy || this.managing) return;
            this.loading = true; this.clear();
            try { this.commands = (await androidApi.commands(this._controller.signal)).commands; if (!this.selected) this.commandId = this.commands[0]?.id || ''; }
            catch (error) { if (!this._disposed) this.error = error.message; }
            finally { if (!this._disposed) this.loading = false; }
        },
        async execute(confirmed) {
            if (this.disabled || this.busy || this.managing || this.loading || this.homeLoading || this.editorOpen || !this.serial || !this.selected || (this.selected.requiresHome && !this.homeChoice)) return;
            if (this.selected.requiresConfirmation && !confirmed) { this.pending = true; return; }
            this.pending = false; this.error = ''; this.result = null; this.busy = true; this.$emit('busy-change', true);
            try { this.result = await androidApi.executeCommand(this.commandId, this.serial, confirmed, this._controller.signal, this.selected.revision, this.selected.requiresHome ? this.homeChoice : null); if (this.selected.requiresHome) this.$refs.homeSelector?.applied(this.result); }
            catch (error) { if (!this._disposed) this.error = error.message; }
            finally { if (!this._disposed) { this.busy = false; this.$emit('busy-change', false); } }
        }
    }
};
</script>

<style scoped>
.adb-commands { padding: var(--page-padding); margin-bottom: var(--gap-column); border: 1px solid var(--panel-border); border-radius: var(--radius-md); background: var(--panel-background); }
.adb-commands h2 { margin: 0 0 var(--gap-column); font-size: var(--text-section-title); }
.adb-command-heading, .adb-command-actions { display: flex; align-items: center; flex-wrap: wrap; gap: var(--adb-small-gap); }
.adb-command-heading { justify-content: space-between; margin-bottom: var(--gap-column); }
.adb-command-heading h2 { margin: 0; }
#adb-command-reload { margin-bottom: var(--gap-column); }
.adb-command-row { display: flex; align-items: flex-end; flex-wrap: wrap; gap: var(--gap-column); }
.adb-command-row label { flex: 1; min-width: min(var(--adb-command-column), 100%); color: var(--text-secondary); }
.adb-command-row .input { display: block; width: 100%; box-sizing: border-box; margin-top: var(--adb-small-gap); }
.adb-command-muted { color: var(--text-secondary); line-height: var(--line-relaxed); }
.adb-command-preview { display: block; overflow-wrap: anywhere; font-size: var(--text-body); }
.adb-command-error { color: var(--danger); white-space: pre-wrap; overflow-wrap: anywhere; }
.adb-command-confirm, .adb-command-result { margin-top: var(--gap-column); padding: var(--gap-column); border-radius: var(--radius-sm); background: var(--surface-sunken); overflow-wrap: anywhere; }
.adb-command-result pre { max-height: var(--adb-output-height); overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; font-family: var(--font-mono); font-size: var(--text-body); }
</style>
