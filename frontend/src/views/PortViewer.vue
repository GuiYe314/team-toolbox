<template>
    <div class="view-page ports-page">
        <header class="ports-header">
            <div><h1 class="view-title">端口查看</h1><p class="view-subtitle">查看运行工具箱的 Windows 电脑上，哪些进程正在占用端口。</p></div>
            <router-link class="btn btn-sm" to="/tools">返回工具箱</router-link>
        </header>
        <section class="ports-panel ports-toolbar" aria-label="刷新控制">
            <button id="ports-refresh" class="btn btn-primary" :disabled="loading || hidden" @click="refresh">{{ loading ? '正在读取…' : '立即刷新' }}</button>
            <label class="ports-auto"><input id="ports-auto" v-model="automatic" type="checkbox" @change="changeAutomatic">每 5 秒自动刷新</label>
            <span id="ports-status" role="status">{{ status }}</span>
            <span class="ports-sampled">上次成功：{{ sampledTime }}</span>
        </section>
        <p v-if="error" id="ports-error" class="ports-notice" role="alert">{{ error }}<span v-if="snapshot?.state === 'ready'">当前保留上次成功快照，请刷新后核对。</span></p>
        <p v-if="snapshot?.state === 'unsupported'" class="ports-notice">{{ snapshot.message }}</p>
        <p v-if="snapshot?.truncated" id="ports-truncated" class="ports-notice">端点超过 5000 条，仅展示本次截取的 5000 条；筛选结果可能不完整。</p>
        <section class="ports-stats" aria-label="快照概览">
            <div class="ports-panel"><span>TCP 监听</span><strong id="ports-listen-count">{{ count('listen') }}</strong></div>
            <div class="ports-panel"><span>UDP 绑定</span><strong id="ports-udp-count">{{ count('udp') }}</strong></div>
            <div class="ports-panel"><span>TCP 已连接</span><strong>{{ count('connected') }}</strong></div>
            <div class="ports-panel"><span>快照端点总数</span><strong id="ports-total">{{ snapshot?.state === 'ready' ? rows.length : '—' }}</strong></div>
        </section>
        <section class="ports-panel">
            <div class="ports-filters">
                <label>协议<select id="ports-protocol" v-model="protocol" class="ports-select"><option value="all">TCP + UDP</option><option value="TCP">TCP</option><option value="UDP">UDP</option></select></label>
                <label>范围<select id="ports-scope" v-model="scope" class="ports-select"><option value="listening">监听端口 / UDP 绑定</option><option value="all">全部连接和端口</option></select></label>
                <label>本地端口（精确）<input id="ports-port" v-model="port" class="input" inputmode="numeric" placeholder="例如 3000" maxlength="5"></label>
                <label class="ports-search">搜索进程 / PID / 地址<input id="ports-query" v-model="query" class="input" placeholder="例如 node、1234、127.0.0.1" maxlength="256"></label>
                <button id="ports-clear" class="btn btn-sm" @click="clearFilters">清除筛选</button>
            </div>
            <div class="ports-results-head"><p id="ports-match-count">匹配 {{ filtered.length }} 条 · {{ scope === 'listening' ? 'TCP 监听及所有 UDP 绑定' : '全部 TCP / UDP 端点' }}</p><span role="status">{{ copyNotice }}</span></div>
            <div class="ports-table-wrap">
                <table id="ports-table"><thead><tr><th>协议</th><th>本地地址 : 端口</th><th>状态</th><th>PID</th><th>占用进程</th><th>远端地址 : 端口</th><th>操作</th></tr></thead>
                    <tbody><tr v-for="(row,index) in visibleRows" :key="index">
                        <td><span class="ports-protocol">{{ row.protocol }}</span></td><td class="ports-endpoint">{{ portEndpoint(row.localAddress,row.localPort) }}</td>
                        <td><span :class="{ 'ports-listening': row.state === 'Listen' }">{{ portStateLabels[row.state] }}</span></td><td>{{ row.pid }}</td>
                        <td>{{ row.processName || (row.pid === 0 ? '系统 / 无当前进程' : '名称不可用（权限或进程已退出）') }}</td>
                        <td class="ports-endpoint">{{ row.protocol === 'UDP' || row.state === 'Listen' ? '—' : portEndpoint(row.remoteAddress,row.remotePort) }}</td>
                        <td><button class="btn btn-sm ports-copy" @click="copyRow(row)">复制</button></td>
                    </tr></tbody>
                </table>
                <p v-if="!visibleRows.length" id="ports-empty" class="ports-empty">{{ !snapshot ? (loading ? '正在读取端口快照…' : '尚未取得端口快照，请点击立即刷新。') : snapshot.state === 'unsupported' ? '当前系统不支持端口读取。' : '没有符合筛选条件的端点。' }}</p>
            </div>
            <div class="ports-pagination"><span>第 {{ page }} / {{ pageCount }} 页 · 每页 100 条</span><div><button id="ports-prev" class="btn btn-sm" :disabled="page <= 1" @click="page--">上一页</button><button id="ports-next" class="btn btn-sm" :disabled="page >= pageCount" @click="page++">下一页</button></div></div>
        </section>
        <details class="ports-panel ports-help"><summary>查看说明</summary><p>这里显示服务器电脑的端口，不是访问网页的手机或其他电脑。UDP 为本地绑定端点，没有 TCP 式的监听/连接状态；不会据此判断端口可从外网访问。</p><p>采集无需主动提权。进程可能已退出或因权限无法读取名称，PID 也可能被系统复用；端点与进程名为短期、非原子快照，成功结果最多复用 2 秒。后台及离页取消读取，页面不会结束进程或修改防火墙。遇到端口冲突时，可用精确端口筛选查看占用者。</p></details>
    </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { filterPorts, portEndpoint, portStateLabels, validatePortSnapshot } from '../utils/port-viewer.js';
import { copyText } from '../utils/clipboard.js';
import '../styles/port-viewer.css';

const snapshot = ref(null), error = ref(''), loading = ref(false), automatic = ref(true), hidden = ref(false);
const query = ref(''), port = ref(''), protocol = ref('all'), scope = ref('listening'), page = ref(1), copyNotice = ref('');
let request, timer, revision = 0, disposed = false;
const rows = computed(() => snapshot.value?.rows || []);
const filtered = computed(() => filterPorts(rows.value, { query: query.value, port: port.value, protocol: protocol.value, scope: scope.value }));
const pageCount = computed(() => Math.max(1, Math.ceil(filtered.value.length / 100)));
const visibleRows = computed(() => filtered.value.slice((page.value - 1) * 100, page.value * 100));
const sampledTime = computed(() => snapshot.value?.sampledAt ? new Date(snapshot.value.sampledAt).toLocaleTimeString('zh-CN', { hour12: false }) : '—');
const status = computed(() => hidden.value ? '后台已暂停' : loading.value ? '正在读取快照' : error.value ? '读取失败' : snapshot.value?.state === 'unsupported' ? '当前系统不支持' : automatic.value ? '每 5 秒刷新' : '仅手动刷新');
function count(kind) { return snapshot.value?.state !== 'ready' ? '—' : rows.value.filter(row => kind === 'listen' ? row.protocol === 'TCP' && row.state === 'Listen' : kind === 'udp' ? row.protocol === 'UDP' : row.protocol === 'TCP' && row.state === 'Established').length; }
function stop() { revision++; clearTimeout(timer); timer = null; request?.abort(); request = null; loading.value = false; }
async function poll(version) {
    if (disposed || hidden.value || version !== revision) return;
    const controller = new AbortController(); request = controller; loading.value = true;
    const deadline = setTimeout(() => controller.abort(), 18000);
    try {
        const response = await fetch('/api/ports/snapshot', { headers: { Accept: 'application/json', 'X-Toolbox-Ports': '1' }, cache: 'no-store', signal: controller.signal });
        const text = await response.text(); if (text.length > 2 * 1024 * 1024) throw new Error('端口快照超出读取上限');
        const data = JSON.parse(text); if (!response.ok) throw new Error(data.message || `端口读取失败（HTTP ${response.status}）`);
        validatePortSnapshot(data);
        if (version !== revision || disposed) return;
        snapshot.value = data; error.value = ''; copyNotice.value = ''; page.value = Math.min(page.value, pageCount.value);
    } catch (problem) {
        if (version !== revision || disposed) return;
        error.value = controller.signal.aborted ? '端口读取超时，请重试。' : problem instanceof SyntaxError ? '服务返回了无效快照，请重试。' : problem.message || '端口读取失败，请重试。';
    } finally {
        clearTimeout(deadline); if (request === controller) request = null;
        if (version === revision && !disposed) {
            loading.value = false;
            if (automatic.value && !hidden.value && snapshot.value?.state !== 'unsupported') timer = setTimeout(() => poll(version), 5000);
        }
    }
}
function refresh() { stop(); if (!hidden.value) poll(revision); }
function changeAutomatic() { if (automatic.value) refresh(); else stop(); }
function clearFilters() { query.value = ''; port.value = ''; protocol.value = 'all'; scope.value = 'listening'; page.value = 1; }
async function copyRow(row) {
    try { await copyText(`${row.protocol}\t${portEndpoint(row.localAddress,row.localPort)}\t${portStateLabels[row.state]}\tPID ${row.pid}\t${row.processName || '名称不可用'}`); if (!disposed) copyNotice.value = '已复制端口与进程信息'; }
    catch (problem) { if (!disposed) copyNotice.value = problem.message || '复制失败，请手动选择内容'; }
}
function visibility() { hidden.value = document.hidden; stop(); if (!hidden.value && automatic.value) poll(revision); }
watch([query, port, protocol, scope], () => { page.value = 1; copyNotice.value = ''; });
onMounted(() => { hidden.value = document.hidden; document.addEventListener('visibilitychange', visibility); if (!hidden.value) poll(revision); });
onBeforeUnmount(() => { disposed = true; stop(); snapshot.value = null; document.removeEventListener('visibilitychange', visibility); });
</script>
