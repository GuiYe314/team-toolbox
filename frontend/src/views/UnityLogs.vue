<template>
    <div class="view-page page-unity-logs">
        <header class="view-head ulog-head">
            <div><h1 class="view-title">Unity 设备日志</h1><p class="view-subtitle">搜索同局域网的 Android / iPad，读取已保存的运行日志</p></div>
            <span class="ulog-badge" :class="{ connected: session && !readError, interrupted: session && readError }">{{ session ? (readError ? '读取异常 · ' : '正在读取 · ') + session.device.deviceName : '等待选择设备' }}</span>
        </header>
        <div class="ulog-workspace">
            <aside class="ulog-panel ulog-devices" aria-label="局域网设备">
                <div class="ulog-section-title"><h2>局域网设备</h2><ToolIcon tool-id="unity-logs" /></div>
                <p class="ulog-note">电脑和设备连接同一网络，设备应用保持在前台。无需 ADB、扫码或访问码。</p>
                <div class="ulog-actions">
                    <button v-if="!searching" class="btn btn-primary" @click="searchDevices">搜索局域网</button>
                    <button v-else class="btn" @click="cancelSearch">取消搜索</button>
                    <span class="ulog-note" role="status">{{ searching ? '正在搜索，最多约 25 秒…' : searchSummary }}</span>
                </div>
                <details class="ulog-advanced"><summary>搜索设置与指定 IP</summary>
                    <label>日志端口<input v-model.number="port" type="number" min="1024" max="65535" :disabled="searching"></label>
                    <label>指定设备 IP（可留空）<input v-model.trim="address" placeholder="留空自动搜索局域网" :disabled="searching" maxlength="15"></label>
                    <p class="ulog-note">默认端口 17523。大网段最多搜索 1024 个地址；未覆盖的设备可指定同网段 IP 再搜索。</p>
                </details>
                <p v-if="searchError" class="ulog-error" role="alert">{{ searchError }}</p>
                <div v-if="scanReport" class="ulog-scan-report">
                    <span v-for="network in scanReport.networks" :key="network.name + network.cidr">{{ network.name }} · {{ network.cidr }}<br>已检查 {{ network.checked }}/{{ network.planned }} 个地址{{ network.limited ? ' · 范围已截断' : '' }}</span>
                    <span v-if="scanReport.timedOut" class="ulog-warning">搜索已达到时限，仅列出本次已找到的设备。</span>
                </div>
                <div class="ulog-device-list">
                    <button v-for="device in devices" :key="device.deviceId" class="ulog-device" :class="{ selected: session?.device.deviceId === device.deviceId }"
                        :aria-pressed="session?.device.deviceId === device.deviceId" @click="selectDevice(device)">
                        <span class="ulog-device-name">{{ device.deviceName }}<span v-if="session?.device.deviceId === device.deviceId" class="ulog-badge connected">已选中</span></span>
                        <span>{{ device.deviceModel || device.platform }} · {{ device.platform }}</span>
                        <span class="ulog-mono">{{ device.address }}:{{ device.port }}</span>
                        <span>版本 {{ device.appVersion || '未提供' }} · 编号 {{ device.deviceId.slice(0, 8) }}</span>
                    </button>
                    <p v-if="!devices.length" class="ulog-empty">{{ searching ? '正在查找日志设备…' : scanReport ? '本次未找到设备。请确认新版日志模块已运行、局域网读取已开启，并检查 iPad 本地网络权限及 Wi-Fi 设备隔离。' : '点击“搜索局域网”，查找正在运行日志模块的设备。' }}</p>
                </div>
                <p class="ulog-note">固定编号用于识别同一设备，IP 变化后重新搜索。重装或清除应用数据可能生成新编号。</p>
            </aside>
            <section class="ulog-panel ulog-reader" aria-label="日志读取">
                <template v-if="session || connecting || connectError">
                    <div class="ulog-section-title"><div><h2>{{ session?.device.deviceName || connectingName }}</h2><p class="ulog-note">{{ session?.device.appId || '正在建立只读会话' }}</p></div>
                        <button class="btn btn-sm" @click="disconnect">{{ connecting ? '取消连接' : '结束读取' }}</button>
                    </div>
                    <p v-if="connecting" class="ulog-note" role="status">正在连接并读取历史文件…</p>
                    <p v-if="connectError" class="ulog-error" role="alert">{{ connectError }}</p>
                </template>
                <template v-if="session">
                    <div class="ulog-file-toolbar">
                        <label class="ulog-file-picker">历史日志文件<select :value="selectedFile" @change="chooseFile($event.target.value)"><option v-if="!files.length" value="">暂无日志文件</option><option v-for="file in files" :key="file.name" :value="file.name">{{ formatTime(file.modifiedUtc) }} · {{ formatLogBytes(file.bytes) }} · {{ file.name }}</option></select></label>
                        <button class="btn" :disabled="loading" @click="refresh">{{ loading ? '读取中…' : '刷新' }}</button>
                    </div>
                    <div class="ulog-options">
                        <label><input v-model="autoRefresh" type="checkbox">每 3 秒刷新</label>
                        <label><input v-model="followFile" type="checkbox" @change="refresh">跟随最新文件</label>
                        <span class="ulog-note">{{ lastRead ? '上次读取 ' + lastRead : '尚未读取内容' }}</span>
                    </div>
                    <div class="ulog-filters">
                        <label>级别<select v-model="level"><option value="all">全部日志</option><option value="warning">警告与错误</option><option value="error">仅错误 / 异常</option></select></label>
                        <label class="ulog-keyword">关键词<input v-model="keyword" placeholder="搜索正文和调用堆栈" type="search" maxlength="200"></label>
                    </div>
                    <div class="ulog-actions">
                        <button class="btn btn-sm" :disabled="!matches.length" @click="copyMatches">复制匹配日志</button>
                        <button class="btn btn-sm" :disabled="!selectedFile || downloading" @click="download(false)">下载当前文件全文</button>
                        <button class="btn btn-sm" :disabled="downloading" @click="download(true)">{{ downloading ? '下载中…' : '下载全部日志 ZIP' }}</button>
                        <button v-if="downloading" class="btn btn-sm" @click="downloadController?.abort()">取消下载</button>
                        <label><input v-model="follow" type="checkbox">跟随最新记录</label>
                    </div>
                    <p v-if="readError" class="ulog-error" role="alert">{{ readError }}<span v-if="rawText"> · 保留上次成功读取的内容</span></p>
                    <p v-if="actionError" class="ulog-error" role="alert">{{ actionError }}</p>
                    <p v-if="actionMessage" class="ulog-note" role="status">{{ actionMessage }}</p>
                    <div class="ulog-preview-meta"><span>匹配 {{ matches.length }} / {{ entries.length }} 条<span v-if="matches.length > 1000"> · 显示最后 1000 条</span></span><span>{{ truncated ? '仅预览文件尾部 256 KiB，全文请下载' : '当前文件预览' }}</span></div>
                    <div ref="logList" class="ulog-log-list" :aria-busy="loading">
                        <details v-for="entry in shownEntries" :key="entry.id" class="ulog-log-entry" :class="entry.level.toLowerCase()">
                            <summary><time>{{ shortTime(entry.time) }}</time><span class="ulog-log-level">{{ entry.level }}</span><span class="ulog-log-message">{{ entry.message }}</span></summary>
                            <pre>{{ entry.detail }}</pre>
                        </details>
                        <p v-if="!shownEntries.length" class="ulog-empty">{{ loading ? '正在读取日志…' : !selectedFile ? '设备暂无已保存日志。' : entries.length ? '没有匹配的记录，请调整级别或关键词。' : '这个文件还没有日志内容。' }}</p>
                    </div>
                    <p class="ulog-note">点击记录展开完整正文与堆栈。自动刷新读取设备文件，未达到文件写入间隔的日志会稍后出现。</p>
                </template>
                <div v-else-if="!connecting && !connectError" class="ulog-reader-empty"><ToolIcon tool-id="unity-logs" /><h2>选择设备，查看历史日志</h2><p>支持启动阶段和热更代码输出的 Unity 日志。<br>日志保留在设备上，仅下载时保存到电脑。</p></div>
            </section>
        </div>
    </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import ToolIcon from '../components/ToolIcon.vue';
import { unityLogApi as api } from '../api/unity-log-client.js';
import { parseUnityLogs, filterUnityLogs, formatLogBytes } from '../utils/unity-log-view.js';

const devices = ref([]), scanReport = ref(null), port = ref(17523), address = ref(''), searching = ref(false), searchError = ref('');
const session = ref(null), connecting = ref(false), connectingName = ref(''), connectError = ref(''), files = ref([]), selectedFile = ref('');
const rawText = ref(''), truncated = ref(false), loading = ref(false), readError = ref(''), lastRead = ref(''), actionError = ref(''), actionMessage = ref('');
const autoRefresh = ref(true), followFile = ref(true), follow = ref(true), level = ref('all'), keyword = ref(''), logList = ref(null), downloading = ref(false);
let searchController, connectController, loadController, downloadController, refreshTimer, disposed = false, generation = 0;
const entries = computed(() => parseUnityLogs(rawText.value));
const matches = computed(() => filterUnityLogs(entries.value, level.value, keyword.value));
const shownEntries = computed(() => matches.value.slice(-1000));
const searchSummary = computed(() => scanReport.value ? `找到 ${devices.value.length} 台 · 已检查 ${scanReport.value.checked} 个地址` : '默认 TCP 17523');
const formatTime = value => new Date(value).toLocaleString();
const shortTime = value => value ? new Date(value).toLocaleTimeString() : '文件头';

async function searchDevices() {
    searchController?.abort(); searchController = new AbortController(); const controller = searchController;
    searching.value = true; searchError.value = '';
    try {
        const result = await api.discover(port.value, address.value, controller.signal);
        if (controller.signal.aborted || disposed) return;
        scanReport.value = result; devices.value = result.devices;
    } catch (error) { if (!controller.signal.aborted && !disposed) searchError.value = error.message; }
    finally { if (searchController === controller) { searching.value = false; searchController = null; } }
}
function cancelSearch() { searchController?.abort(); searchError.value = '搜索已取消，保留上次搜索结果。'; }
function stopRequests() {
    generation++; clearTimeout(refreshTimer); connectController?.abort(); loadController?.abort(); downloadController?.abort();
    connectController = loadController = downloadController = null;
    connecting.value = loading.value = downloading.value = false;
}
function disconnect() {
    stopRequests(); const id = session.value?.id; session.value = null;
    if (id) api.close(id).catch(() => {}); // 断网时由后端闲置超时回收。
    files.value = []; selectedFile.value = ''; rawText.value = ''; lastRead.value = ''; readError.value = ''; connectError.value = ''; actionError.value = ''; actionMessage.value = '';
}
async function selectDevice(device) {
    disconnect(); const current = generation; connectingName.value = device.deviceName; connecting.value = true;
    const controller = new AbortController(); connectController = controller;
    try {
        const result = await api.connect(device.deviceId, controller.signal);
        if (disposed || current !== generation || controller.signal.aborted) { api.close(result.id).catch(() => {}); return; }
        session.value = { id: result.id, device: result.device }; files.value = result.files; selectedFile.value = result.files[0]?.name || ''; followFile.value = true;
        await refresh(false);
    } catch (error) { if (!controller.signal.aborted && current === generation) connectError.value = error.message; }
    finally { if (current === generation) connecting.value = false; }
}
function scheduleRefresh() {
    clearTimeout(refreshTimer);
    if (!disposed && session.value && autoRefresh.value && !document.hidden) refreshTimer = setTimeout(refresh, 3000);
}
async function refresh(fetchFiles = true) {
    if (!session.value || disposed || document.hidden) return;
    clearTimeout(refreshTimer); loadController?.abort(); const controller = new AbortController(); loadController = controller;
    const id = session.value.id, current = generation; loading.value = true;
    const currentRequest = () => !disposed && generation === current && loadController === controller && !controller.signal.aborted;
    try {
        if (fetchFiles) {
            const result = await api.files(id, controller.signal); if (!currentRequest()) return;
            files.value = result.files;
            if (followFile.value || !files.value.some(file => file.name === selectedFile.value)) {
                const next = files.value[0]?.name || '';
                if (next !== selectedFile.value) { selectedFile.value = next; rawText.value = ''; truncated.value = false; lastRead.value = ''; }
            }
        }
        const name = selectedFile.value;
        if (name) {
            const body = await api.preview(id, name, controller.signal); if (!currentRequest()) return;
            rawText.value = body.text; truncated.value = body.truncated;
        } else { rawText.value = ''; truncated.value = false; }
        readError.value = ''; lastRead.value = new Date().toLocaleTimeString();
    } catch (error) { if (currentRequest()) { readError.value = error.message; if (['session_expired', 'device_changed'].includes(error.code)) autoRefresh.value = false; } }
    finally { if (currentRequest()) { loading.value = false; scheduleRefresh(); } }
}
function chooseFile(name) {
    selectedFile.value = name; followFile.value = false; rawText.value = ''; truncated.value = false; lastRead.value = ''; readError.value = ''; refresh(false);
}
async function copyMatches() {
    actionError.value = ''; actionMessage.value = '';
    try {
        const text = matches.value.map(entry => entry.detail).join('\n');
        if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
        else {
            const area = document.createElement('textarea'); area.value = text; area.className = 'ulog-copy-source'; document.body.append(area);
            try { area.select(); if (!document.execCommand('copy')) throw new Error('浏览器未允许复制，请使用下载'); } finally { area.remove(); }
        }
        actionMessage.value = `已复制 ${matches.value.length} 条匹配日志`;
    } catch (error) { actionError.value = '复制失败：' + error.message; }
}
async function download(archive) {
    if (!session.value || downloading.value) return;
    const id = session.value.id, current = generation, controller = new AbortController(); downloadController = controller;
    downloading.value = true; actionError.value = ''; actionMessage.value = '';
    try {
        const result = await api.download(id, selectedFile.value, archive, controller.signal);
        if (disposed || current !== generation || controller.signal.aborted) return;
        const url = URL.createObjectURL(result.blob), link = document.createElement('a'); link.href = url; link.download = result.name; document.body.append(link);
        try { link.click(); } finally { link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
        actionMessage.value = '日志文件已交给浏览器下载';
    } catch (error) { if (current === generation && !disposed) actionError.value = controller.signal.aborted ? '下载已取消' : '下载失败：' + error.message; }
    finally { if (current === generation) downloading.value = false; }
}
function visibilityChanged() {
    if (document.hidden) { clearTimeout(refreshTimer); connectController?.abort(); loadController?.abort(); loading.value = false; downloadController?.abort(); searchController?.abort(); }
    else scheduleRefresh();
}
watch(autoRefresh, scheduleRefresh);
watch([shownEntries, follow], async () => { await nextTick(); if (follow.value && logList.value) logList.value.scrollTop = logList.value.scrollHeight; });
onMounted(() => document.addEventListener('visibilitychange', visibilityChanged));
onBeforeUnmount(() => { disposed = true; searchController?.abort(); disconnect(); document.removeEventListener('visibilitychange', visibilityChanged); });
</script>
