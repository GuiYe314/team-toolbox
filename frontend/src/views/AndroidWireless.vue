<template>
    <div class="view-page adb-page">
        <header class="view-head">
            <button class="btn btn-sm" @click="$router.push({ name: 'tools' })">返回工具箱</button>
            <h1 class="view-title">安卓无线调试</h1>
            <p class="view-subtitle">在运行工具箱的电脑上连接和管理安卓设备。</p>
            <div class="adb-row">
                <AndroidHelp />
                <AndroidSettingsDialog :disabled="!!busy || qrActive" @saved="configurationSaved" @open-change="settingsActive = $event" />
                <span class="adb-muted">{{ configured ? 'ADB 已配置' : 'ADB 未配置' }}</span>
            </div>
        </header>

        <div v-if="error" class="adb-alert adb-error" role="alert">{{ error }}</div>
        <div v-if="notice" class="adb-alert adb-success" role="status">{{ notice }}</div>
        <div v-if="warning" class="adb-alert adb-warning" role="status">{{ warning }}</div>
        <p v-if="!config && busy" class="state-loading">正在读取配置…</p>
        <button v-if="!config && !busy" class="btn" @click="load">重新读取配置</button>

        <template v-if="config">
            <div class="adb-workspace">
            <section class="adb-pane adb-device-pane" aria-labelledby="adb-device-pane-title">
            <h2 id="adb-device-pane-title" class="adb-pane-title">设备连接与列表</h2>
            <AndroidQrPairing :disabled="!!busy || !configured" @active-change="qrActivityChanged" @result="applyResult" />

            <div class="adb-columns">
                <section class="adb-card">
                    <h2>连接无线设备</h2>
                    <form class="adb-row" @submit.prevent="connect(endpoint)">
                        <label class="adb-grow" for="adb-endpoint">手机 IP 地址与连接端口
                            <input id="adb-endpoint" v-model="endpoint" class="input" placeholder="192.168.1.20:37123" :disabled="unavailable || !configured" autocomplete="off" spellcheck="false" />
                        </label>
                        <button class="btn btn-primary" type="submit" :disabled="unavailable || !configured || !endpoint.trim()">连接</button>
                    </form>
                </section>

                <section class="adb-card">
                    <div class="adb-row">
                        <h2 class="adb-grow">搜索无线服务</h2>
                        <button id="adb-discover" class="btn" :disabled="unavailable || !configured" @click="discover">搜索无线设备</button>
                    </div>
                    <p v-if="searched && !services.length" class="adb-empty">未发现无线服务，请确认同一局域网及无线调试已开启。</p>
                    <ul v-if="services.length" class="adb-services">
                        <li v-for="service in services" :key="service.id" class="adb-service">
                            <div class="adb-grow"><strong>{{ service.kind === 'pairing' ? '配对服务' : '连接服务' }}</strong>
                                <span class="adb-code">{{ service.endpoint }}</span><small>{{ service.name }}</small>
                            </div>
                            <button class="btn btn-sm" :disabled="unavailable" @click="service.kind === 'pairing' ? choosePair(service) : connect(service.endpoint)">{{ service.kind === 'pairing' ? '配对' : '连接' }}</button>
                        </li>
                    </ul>
                    <form v-if="pairService" id="adb-pair-form" class="adb-pair" @submit.prevent="pair">
                        <p>配对目标：<strong>{{ pairService.endpoint }}</strong></p>
                        <label for="adb-pair-code">手机显示的六位配对码
                            <input id="adb-pair-code" v-model="pairCode" class="input" type="password" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="new-password" :disabled="unavailable" required />
                        </label>
                        <div class="adb-row">
                            <button class="btn btn-primary" type="submit" :disabled="unavailable || !/^\d{6}$/.test(pairCode)">确认配对</button>
                            <button class="btn" type="button" :disabled="unavailable" @click="cancelPair">取消</button>
                        </div>
                        <small class="adb-muted">配对码仅用于本次配对，提交后立即清空。</small>
                    </form>
                </section>
            </div>

            <section class="adb-card">
                <div class="adb-row">
                    <h2 class="adb-grow">设备列表</h2>
                    <button id="adb-refresh" class="btn" :disabled="unavailable || !configured" @click="refresh">刷新设备</button>
                </div>
                <p v-if="!configured" class="adb-empty">请先点击上方“ADB 设置”配置 ADB。</p>
                <p v-else-if="!loadedDevices" class="adb-empty">点击“刷新设备”读取 USB、无线设备和模拟器。</p>
                <p v-else-if="!devices.length" class="adb-empty">尚未检测到设备。请连接设备后刷新。</p>
                <div v-else class="adb-table-wrap">
                    <table class="adb-table">
                        <thead><tr><th>设备</th><th>连接状态</th><th>操作</th></tr></thead>
                        <tbody><tr v-for="device in devices" :key="device.serial">
                            <td><strong>{{ device.model || device.product || '未知' }}</strong><small class="adb-code adb-device-serial">{{ device.serial }}</small></td>
                            <td><span :class="['adb-state', { connected: device.state === 'device' }]">{{ stateLabel(device.state) }}</span><small class="adb-device-serial adb-muted">{{ connectionLabel(device.connection) }}</small></td>
                            <td><button v-if="device.connection === 'wireless'" class="btn btn-sm btn-danger" :disabled="unavailable" @click="pendingDisconnect = device.serial">断开</button><span v-else class="adb-muted">—</span></td>
                        </tr></tbody>
                    </table>
                </div>
                <div v-if="pendingDisconnect" class="adb-confirm" role="group" aria-label="断开设备确认">
                    <p>确定断开无线设备 <strong>{{ pendingDisconnect }}</strong>？</p>
                    <div class="adb-row"><button id="adb-disconnect-confirm" class="btn btn-danger" :disabled="unavailable" @click="disconnect">确认断开</button>
                        <button class="btn" :disabled="unavailable" @click="pendingDisconnect = ''">取消</button></div>
                </div>
            </section>
            </section>
            <section class="adb-pane adb-tools-pane" aria-labelledby="adb-tools-pane-title">
            <h2 id="adb-tools-pane-title" class="adb-pane-title">命令、APK、屏幕与日志</h2>
            <AndroidCommands :devices="devices" :disabled="unavailable || !configured" @busy-change="commandActivityChanged" />
            <AndroidApkInstaller :key="logVersion" :devices="devices" :disabled="unavailable || !configured" @busy-change="apkActivityChanged" />
            <AndroidPersistentFiles :key="logVersion" :devices="devices" :disabled="unavailable || !configured" @busy-change="persistentActivityChanged" />
            <AndroidScreenPreview :key="logVersion" :devices="devices" :disabled="unavailable || !configured" />
            <AndroidLogcat :key="logVersion" :devices="devices" :disabled="unavailable || !configured" @busy-change="logActivityChanged" />
            </section>
            </div>
            <p v-if="busy" class="adb-muted" role="status">{{ busy }}，请稍候…</p>
        </template>
    </div>
</template>

<script>
import { androidApi } from '../api/android-client.js';
import AndroidQrPairing from '../components/AndroidQrPairing.vue';
import AndroidHelp from '../components/AndroidHelp.vue';
import AndroidCommands from '../components/AndroidCommands.vue';
import AndroidSettingsDialog from '../components/AndroidSettingsDialog.vue';
import AndroidLogcat from '../components/AndroidLogcat.vue';
import AndroidScreenPreview from '../components/AndroidScreenPreview.vue';
import AndroidApkInstaller from '../components/AndroidApkInstaller.vue';
import AndroidPersistentFiles from '../components/AndroidPersistentFiles.vue';

export default {
    name: 'AndroidWireless',
    components: { AndroidQrPairing, AndroidHelp, AndroidCommands, AndroidSettingsDialog, AndroidLogcat, AndroidScreenPreview, AndroidApkInstaller, AndroidPersistentFiles },
    data() {
        return { config: null, qrActive: false, settingsActive: false, logVersion: 0, endpoint: '', devices: [], services: [], searched: false, loadedDevices: false,
            pairService: null, pairCode: '', pendingDisconnect: '', busy: '', error: '', notice: '', warning: '' };
    },
    computed: { configured() { return !!this.config?.configured; }, unavailable() { return !!this.busy || this.qrActive || this.settingsActive; } },
    mounted() { this._controller = new AbortController(); this.load(); },
    beforeUnmount() { this._disposed = true; this._controller.abort(); this.pairCode = ''; },
    methods: {
        configurationSaved(config) { this.config = config; this.devices = []; this.services = []; this.searched = false; this.loadedDevices = false; this.pendingDisconnect = ''; this.cancelPair(); this.logVersion++; },
        logActivityChanged(active) { this.busy = active ? '读取日志设备信息' : ''; },
        commandActivityChanged(active) { this.busy = active ? '执行 ADB 命令' : ''; },
        apkActivityChanged(active) { this.busy = active ? '传送并安装 APK' : ''; },
        persistentActivityChanged(active) { this.busy = active ? '管理 Unity 应用文件' : ''; },
        qrActivityChanged(active) {
            this.qrActive = active;
            if (active) { this.cancelPair(); this.pendingDisconnect = ''; this.notice = ''; this.error = ''; this.warning = ''; }
        },
        async perform(label, action) {
            if (this.unavailable) return;
            this.busy = label; this.error = ''; this.notice = ''; this.warning = '';
            try { await action(); } catch (error) { if (!this._disposed) this.error = error.message; }
            finally { if (!this._disposed) this.busy = ''; }
        },
        load() { return this.perform('读取配置', async () => {
            this.config = await androidApi.config(this._controller.signal);
            if (this.configured) await this.readDevices();
        }); },
        async readDevices() {
            const result = await androidApi.devices(this._controller.signal); this.devices = result.devices; this.loadedDevices = true;
            if (!this.devices.some((item) => item.serial === this.pendingDisconnect)) this.pendingDisconnect = '';
        },
        refresh() { return this.perform('刷新设备', () => this.readDevices()); },
        async readServices() {
            this.services = []; this.searched = false; this.cancelPair();
            const result = await androidApi.discover(this._controller.signal); this.services = result.services; this.searched = true;
        },
        discover() { return this.perform('搜索无线服务', () => this.readServices()); },
        applyResult(result) {
            this.notice = result.message; this.warning = result.warning || '';
            this.devices = result.devices || []; this.loadedDevices = result.devices !== null; this.pendingDisconnect = '';
        },
        connect(endpoint) { return this.perform('连接设备', async () => this.applyResult(await androidApi.connect(endpoint, this._controller.signal))); },
        choosePair(service) { this.pairService = service; this.pairCode = ''; },
        cancelPair() { this.pairService = null; this.pairCode = ''; },
        pair() {
            const service = this.pairService;
            const code = this.pairCode; this.pairCode = '';
            if (!service) return;
            return this.perform('配对设备', async () => {
                const result = await androidApi.pair(service.id, code, this._controller.signal); this.notice = result.message;
                try { await this.readServices(); } catch (error) { this.warning = `配对成功，但重新搜索失败：${error.message}`; }
            });
        },
        disconnect() { const serial = this.pendingDisconnect; return this.perform('断开设备', async () => this.applyResult(await androidApi.disconnect(serial, this._controller.signal))); },
        stateLabel(state) { return ({ device: '已连接', offline: '离线', unauthorized: '未授权', 'no permissions': '无访问权限', recovery: '恢复模式', sideload: '侧载模式', bootloader: '引导模式' })[state] || state; },
        connectionLabel(connection) { return ({ wireless: '无线 ADB', usb: 'USB', emulator: '模拟器' })[connection] || connection; }
    }
};
</script>

<style scoped>
.adb-page { width: 100%; max-width: var(--adb-workspace-width); box-sizing: border-box; margin: 0 auto; overflow: hidden; }
.adb-page > * { flex-shrink: 0; }
.adb-workspace { display: grid; grid-template-columns: minmax(0, 0.95fr) minmax(0, 1.05fr); gap: var(--page-padding); flex: 1; min-height: 0; }
.adb-pane { min-width: 0; min-height: 0; overflow-y: auto; padding-right: var(--adb-small-gap); scrollbar-width: thin; scrollbar-color: var(--text-tertiary) transparent; }
.adb-pane-title { margin: 0 0 var(--gap-column); padding-bottom: var(--gap-column); border-bottom: 1px solid var(--panel-border); font-size: var(--text-section-title); color: var(--text-secondary); }
.adb-device-serial { display: block; margin-top: var(--adb-small-gap); overflow-wrap: anywhere; }
.adb-page .view-head, .adb-card, .adb-alert { margin-bottom: var(--gap-column); }
.adb-page h1 { margin-top: var(--gap-column); }
.adb-card { padding: var(--page-padding); border: 1px solid var(--panel-border); border-radius: var(--radius-md); background: var(--panel-background); }
.adb-card h2 { margin: 0 0 var(--gap-column); font-size: var(--text-section-title); font-weight: var(--weight-semibold); }
.adb-card p, .adb-card ol { margin: var(--gap-column) 0; line-height: var(--line-relaxed); }
.adb-row { display: flex; align-items: flex-end; gap: var(--gap-column); flex-wrap: wrap; }
.adb-row h2 { align-self: center; margin-bottom: 0; }
.adb-grow { flex: 1; min-width: 0; }
.adb-card label { display: block; font-size: var(--text-body); color: var(--text-secondary); }
.adb-card .input { display: block; width: 100%; box-sizing: border-box; margin-top: var(--adb-small-gap); }
.adb-columns { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(var(--adb-min-column), 100%), 1fr)); gap: var(--gap-column); }
.adb-muted, .adb-empty, .adb-service small { color: var(--text-secondary); font-size: var(--text-body); }
.adb-code, .adb-version { font-family: var(--font-mono); font-size: var(--text-body); overflow-wrap: anywhere; }
.adb-version { white-space: pre-wrap; background: var(--surface-sunken); padding: var(--gap-column); border-radius: var(--radius-sm); }
.adb-services { list-style: none; padding: 0; margin: var(--gap-column) 0 0; }
.adb-service { display: flex; gap: var(--gap-column); align-items: center; padding: var(--gap-column) 0; border-bottom: 1px solid var(--panel-border); }
.adb-service small, .adb-service .adb-code { display: block; margin-top: var(--adb-small-gap); overflow-wrap: anywhere; }
.adb-pair, .adb-confirm { margin-top: var(--gap-column); padding: var(--gap-column); border-radius: var(--radius-sm); background: var(--surface-sunken); }
.adb-pair .adb-row { margin: var(--gap-column) 0; }
.adb-table-wrap { overflow-x: auto; }
.adb-table { width: 100%; border-collapse: collapse; text-align: left; font-size: var(--text-body); }
.adb-table th, .adb-table td { padding: var(--gap-column); border-bottom: 1px solid var(--panel-border); }
.adb-table th { color: var(--text-secondary); font-weight: var(--weight-medium); }
.adb-state { color: var(--warning); white-space: nowrap; }
.adb-state.connected { color: var(--success); }
.adb-alert { padding: var(--gap-column); border-radius: var(--radius-sm); overflow-wrap: anywhere; white-space: pre-wrap; }
.adb-error { color: var(--danger); background: var(--danger-soft); }
.adb-success { color: var(--success); background: var(--success-soft); }
.adb-warning { color: var(--warning); background: var(--warning-soft); }
</style>
