<template>
    <div class="view-page remote-page">
        <header class="share-toolbar"><div><h1 class="view-title">FTP 文件客户端</h1><p class="share-muted">FTP / FTPS / SFTP · 双栏文件管理与传输队列</p></div><Button id="remote-help" @click="help = true">帮助</Button></header>
        <p v-if="error" class="notice notice-error" role="alert">{{ error }}</p><p v-if="notice" class="notice" role="status">{{ notice }}</p>
        <form class="share-panel remote-connect" @submit.prevent="askConnect">
            <label class="share-field">协议<UiChoice v-model="form.protocol" input-id="remote-protocol" aria-label="连接协议" :options="remoteProtocols" :disabled="!!session || busy" @update:model-value="form.port = defaultPort($event)" /></label>
            <label class="share-field">服务器<InputText id="remote-host" v-model="form.host" placeholder="IP 或主机名" :disabled="!!session || busy" autocomplete="off" /></label>
            <label class="share-field">端口<InputText id="remote-port" v-model="form.port" type="number" min="1" max="65535" :disabled="!!session || busy" /></label>
            <label class="share-field">用户名<InputText id="remote-user" v-model="form.username" :disabled="!!session || busy" autocomplete="off" /></label>
            <label class="share-field">密码<InputText id="remote-password" v-model="form.password" type="password" :disabled="!!session || busy" autocomplete="new-password" /></label>
            <Button v-if="!session" id="remote-connect" type="submit" :disabled="busy || !form.host.trim() || !form.username">{{ busy ? '连接准备中…' : '连接' }}</Button><Button v-else id="remote-disconnect" type="button" @click="disconnect()">断开连接</Button>
        </form>
        <p class="share-muted" id="remote-status">{{ session ? `${session.protocol.toUpperCase()} · ${session.username}@${session.host}:${session.port} · ${status?.connected ? '已连接' : '已断开，请重新连接'}` : '未连接 · 密码和连接信息仅在本次页面内使用' }}</p>
        <div class="remote-columns">
            <section class="share-panel remote-pane" aria-label="本地文件">
                <div class="share-toolbar"><h2>本地待传文件 <span class="share-muted">{{ files.length }} 项</span></h2><Button id="remote-pick" :disabled="locked" @click="picker.click()">选择文件</Button></div>
                <input id="remote-files" ref="picker" class="share-file-input" type="file" multiple @change="choose($event.target.files); $event.target.value = ''" />
                <div class="share-drop" @dragover.prevent @drop.prevent="!locked && choose($event.dataTransfer.files)">将文件拖到这里，或点击“选择文件”。文件来自当前浏览器所在电脑。</div>
                <ul class="share-file-list remote-list"><li v-for="(file, index) in files" :key="index" class="share-file-row"><div class="share-file-main"><strong class="share-path">{{ file.name }}</strong><span class="share-muted">{{ remoteBytes(file.size) }}</span></div><Button class="btn-sm" :disabled="locked" :aria-label="'移除 ' + file.name" @click="files.splice(index, 1)">移除</Button></li><li v-if="!files.length" class="share-empty">选择需要传到服务器的文件。</li></ul>
                <div class="share-toolbar"><Button id="remote-upload" :disabled="!ready || !files.length" @click="overwrite = false; dialog = { kind: 'upload' }">上传全部 →</Button><Button :disabled="locked || !files.length" @click="files = []">清空待传</Button></div>
            </section>
            <section class="share-panel remote-pane" aria-label="远端文件">
                <div class="share-toolbar"><h2>远端文件</h2><Button id="remote-refresh" :disabled="!ready" @click="list(directory)">刷新</Button></div>
                <form class="remote-path" @submit.prevent="list(pathInput)"><Button type="button" :disabled="!ready || directory === '/'" @click="list(parentRemotePath(directory))">上级</Button><InputText id="remote-path" v-model="pathInput" aria-label="远端目录" :disabled="!ready" /><Button type="submit" :disabled="!ready">前往</Button></form>
                <nav class="share-crumbs" aria-label="远端目录面包屑"><Button v-for="part in crumbs" :key="part.path" class="btn-sm" :disabled="!ready" @click="list(part.path)">{{ part.name }}</Button></nav>
                <InputText id="remote-search" v-model="search" placeholder="搜索当前目录" aria-label="搜索远端文件" />
                <ul class="share-file-list remote-list"><li v-for="item in visible" :key="item.path" :data-remote-name="item.name" class="share-file-row" :class="{ 'remote-selected': selected?.path === item.path }">
                    <label class="remote-select"><input v-model="selected" type="radio" name="remote-entry" :value="item" :disabled="!ready || item.type === 'blocked'" :aria-label="'选择 ' + item.name" /><span class="share-file-main"><button v-if="item.type === 'directory'" class="share-file-name" :disabled="!ready" @click.prevent="list(item.path)">{{ item.name }} /</button><strong v-else class="share-path">{{ item.name }}</strong><span class="share-muted">{{ item.type === 'directory' ? '文件夹' : item.type === 'blocked' ? '链接或特殊项目，暂不操作' : remoteBytes(item.size) }} · {{ date(item.modifiedAt) }}</span></span></label>
                </li><li v-if="!visible.length" class="share-empty">{{ !session ? '连接服务器后浏览远端目录。' : search ? '没有匹配的项目。' : '当前目录为空，或尚未读取。' }}</li></ul>
                <div class="remote-actions"><Button id="remote-download" :disabled="!ready || selected?.type !== 'file'" @click="dialog = { kind: 'download', item: selected }">← 下载所选</Button><Button id="remote-mkdir" :disabled="!ready" @click="editName = ''; dialog = { kind: 'mkdir' }">新建目录</Button><Button id="remote-rename" :disabled="!ready || !selected" @click="editName = selected.name; dialog = { kind: 'rename', item: selected }">重命名</Button><Button id="remote-delete" :disabled="!ready || !selected" @click="dialog = { kind: 'delete', item: selected }">删除</Button></div>
            </section>
        </div>
        <section class="share-panel" aria-label="传输队列"><div class="share-toolbar"><h2>传输队列</h2><Button id="remote-stop" :disabled="!session || (!locked && !status?.busy)" @click="stop">停止全部并断开</Button></div>
            <p v-if="!jobs.length" class="share-muted">确认传输后，在这里查看字节进度和结果。</p>
            <div v-for="job in jobs" :key="job.id" class="remote-job" :data-state="job.state"><div class="share-toolbar"><strong class="share-path">{{ job.direction === 'upload' ? '↑' : '↓' }} {{ job.name }}</strong><span>{{ remoteState(job.state) }} · {{ remoteBytes(job.bytes) }} / {{ remoteBytes(job.size) }}<template v-if="job.state === 'transferring'"> · {{ remoteBytes(speeds[job.id] || 0) }}/s</template></span></div><progress :value="job.bytes" :max="Math.max(1, job.size)" :aria-label="job.name + ' 传输进度'"></progress><p class="share-muted">{{ job.message || (job.direction === 'upload' && job.received >= job.size ? '已收到浏览器文件，等待远端确认保存…' : job.path) }}</p><p v-if="job.cleanupNeeded" class="notice notice-error">远端临时文件无法确认清理，请重新连接后核对：{{ job.temporaryPath }}</p></div>
        </section>
        <UiDialog v-if="help" title="FTP 客户端帮助" @close="help = false"><p>输入服务器主机名或 IP、端口、用户名和密码。推荐 SFTP；先获取 SHA-256 主机指纹，再通过服务器管理员等可信来源核对。FTPS 为显式 TLS（通常端口21），证书必须有效且受信任。FTP 会明文传送账号与文件，请仅在可信网络使用。</p><p>左栏选择当前浏览器的文件，右栏浏览服务器目录。支持多文件顺序上传、逐个原生下载、新建目录、重命名、删除文件或空目录。默认拒绝覆盖；覆盖上传须单独勾选并确认。上传中转到工具箱服务器，不进入资源库；成功表示远端确认保存，下载完成仍请核对浏览器下载列表。</p><p>每批100文件、合计4GiB，单项1GiB。每会话串行传输，最多4连接和2项活动传输；连接/命令15秒、传输15分钟、90秒无进展停止。离页、刷新或切到后台会断开，未开始任务停止；已完成文件保留。断连时可能遗留远端随机临时文件，队列会提示核对。</p><p>不保存密码、站点或主机指纹，不自动重连，不支持私钥、续传、文件夹递归传输或递归删除。账号权限由远端服务器管理；多个客户端同时修改文件时不能保证事务式覆盖。局域网 HTTP 访问时，浏览器到工具箱的这一段仍为 HTTP，请只在可信网络输入凭据。</p></UiDialog>
        <UiDialog v-if="dialog" :title="dialogTitle" @close="closeDialog">
            <template v-if="dialog.kind === 'connect'"><p>连接 {{ form.protocol.toUpperCase() }}：{{ form.username }}@{{ form.host }}:{{ form.port }}</p><p v-if="form.protocol === 'ftp'" class="notice notice-error">FTP 不加密，账号、密码与文件会以明文传输。</p><template v-if="form.protocol === 'sftp'"><p>请通过可信来源核对服务器 SHA-256 指纹：</p><code id="remote-fingerprint" class="share-path">{{ fingerprint }}</code><label class="share-toggle"><input id="remote-trust" v-model="trusted" type="checkbox" />已核对，信任本次连接</label></template></template>
            <template v-else-if="dialog.kind === 'upload'"><p>向 {{ session?.host }} 的 {{ directory }} 上传 {{ files.length }} 个文件，共 {{ remoteBytes(files.reduce((n, f) => n + f.size, 0)) }}。</p><ul class="remote-confirm-files"><li v-for="file in files" :key="file.name">{{ file.name }}</li></ul><label class="share-toggle"><input id="remote-overwrite" v-model="overwrite" type="checkbox" />允许覆盖远端同名普通文件（不能撤销）</label></template>
            <template v-else><p>{{ session?.host }} · {{ dialog.item?.path || directory }}</p><label v-if="['mkdir', 'rename'].includes(dialog.kind)" class="share-field">名称<InputText id="remote-edit-name" v-model="editName" maxlength="180" /></label><p v-if="dialog.kind === 'delete'" class="notice notice-error">确认永久删除所选文件或空目录？无法撤销，不会递归删除目录。</p><p v-if="dialog.kind === 'download'">将所选文件交给浏览器下载。</p></template>
            <div class="remote-actions"><Button id="remote-confirm" :disabled="busy || dialog.kind === 'connect' && form.protocol === 'sftp' && !trusted || ['mkdir','rename'].includes(dialog.kind) && !editName.trim()" @click="confirm">确认{{ dialog.kind === 'connect' ? '连接' : '' }}</Button><Button @click="closeDialog">取消</Button></div>
        </UiDialog>
    </div>
</template>
<script setup>
import { computed, onBeforeUnmount, reactive, ref, shallowRef } from 'vue';
import Button from 'primevue/button';
import InputText from 'primevue/inputtext';
import UiChoice from '../components/ui/UiChoice.vue';
import UiDialog from '../components/ui/UiDialog.vue';
import { remoteFilesApi as api } from '../api/remote-files-client.js';
import { remoteProtocols, defaultPort, parentRemotePath, validateRemoteFiles, remoteBytes, remoteState } from '../utils/remote-files.js';
const form = reactive({ protocol: 'sftp', host: '', port: 22, username: '', password: '' });
const session = shallowRef(null), status = ref(null), busy = ref(false), running = ref(false), help = ref(false), dialog = ref(null), error = ref(''), notice = ref(''), fingerprint = ref(''), trusted = ref(false), overwrite = ref(false), editName = ref('');
const directory = ref('/'), pathInput = ref('/'), items = ref([]), files = ref([]), selected = ref(null), search = ref(''), picker = ref(null), speeds = reactive({});
const locked = computed(() => busy.value || running.value || !!status.value?.busy), ready = computed(() => !!session.value && !!status.value?.connected && !locked.value);
const visible = computed(() => items.value.filter(item => item.name.toLocaleLowerCase().includes(search.value.toLocaleLowerCase()))), jobs = computed(() => status.value?.jobs || []);
const crumbs = computed(() => { const parts = directory.value.split('/').filter(Boolean); return [{ name: '/', path: '/' }, ...parts.map((name, i) => ({ name, path: '/' + parts.slice(0, i + 1).join('/') }))]; });
const dialogTitle = computed(() => ({ connect: '确认连接服务器', upload: '确认上传文件', download: '确认下载文件', mkdir: '新建远端目录', rename: '重命名远端项目', delete: '删除远端项目' })[dialog.value?.kind]);
let controller, pollController, pollTimer, alive = true, samples = new Map();
const date = value => value ? new Date(value).toLocaleString() : '时间未知';
function choose(input) { if (locked.value) return; const next = [...files.value, ...input], message = validateRemoteFiles(next); if (message) error.value = message; else { files.value = next; error.value = ''; } }
function closeDialog() { dialog.value = null; trusted.value = false; fingerprint.value = ''; form.password = ''; }
async function execute(fn) { busy.value = true; error.value = ''; controller = new AbortController(); try { await fn(controller.signal); } catch (e) { if (alive && e.name !== 'AbortError') error.value = e.message; } finally { busy.value = false; } }
async function askConnect() { await execute(async signal => { if (form.protocol === 'sftp') fingerprint.value = (await api.probe({ host: form.host.trim(), port: Number(form.port) }, signal)).fingerprint; if (!signal.aborted && alive) { trusted.value = false; dialog.value = { kind: 'connect' }; } }); }
async function readList(s, path, signal) { const result = await api.entries(s, path, signal); if (session.value === s && !signal.aborted) { directory.value = pathInput.value = result.path; items.value = result.items; selected.value = null; search.value = ''; } }
async function list(path) { const s = session.value; if (!s) return; await execute(signal => readList(s, path, signal)); }
async function poll() {
    const s = session.value; if (!s || !alive) return; pollController = new AbortController();
    try { const value = await api.status(s, pollController.signal); if (session.value !== s) return; const time = performance.now(); for (const job of value.jobs) { const prev = samples.get(job.id); if (prev) speeds[job.id] = Math.max(0, (job.bytes - prev.bytes) * 1000 / (time - prev.time)); samples.set(job.id, { time, bytes: job.bytes }); } status.value = value; }
    catch (e) { if (session.value === s && e.name !== 'AbortError') { error.value = e.message; if (status.value) status.value.connected = false; } }
    finally { if (session.value === s && alive) pollTimer = setTimeout(poll, 1000); }
}
async function confirm() {
    const action = dialog.value; dialog.value = null;
    if (action.kind === 'connect') { await execute(async signal => { try { const s = await api.connect({ ...form, host: form.host.trim(), port: Number(form.port), fingerprint: fingerprint.value }, signal); if (signal.aborted || !alive) { await api.disconnect(s); return; } session.value = s; status.value = s; notice.value = ''; await readList(s, s.home, signal); } finally { form.password = ''; fingerprint.value = ''; trusted.value = false; if (session.value) poll(); } }); return; }
    const s = session.value; if (!s) return;
    if (action.kind === 'upload') { const batch = [...files.value], path = directory.value, replace = overwrite.value; running.value = true; controller = new AbortController(); const signal = controller.signal; error.value = ''; let succeeded = 0;
        try { for (const file of batch) { if (signal.aborted || session.value !== s) break; try { const job = await api.prepare(s, { direction: 'upload', path, name: file.name, size: file.size, overwrite: replace }, signal); status.value = await api.status(s, signal); await api.upload(s, job, file, signal, received => { const found = status.value?.jobs.find(j => j.id === job.id); if (found) found.received = received; }); succeeded++; if (session.value === s) files.value = files.value.filter(f => f !== file); }
                catch (e) { if (!signal.aborted) error.value = `${file.name}：${e.message}`; if (signal.aborted || session.value !== s) break; const state = await api.status(s, signal); status.value = state; if (!state.connected) break; } }
            if (!signal.aborted && session.value === s) { status.value = await api.status(s, signal); if (status.value.connected) await readList(s, path, signal); notice.value = `本批上传成功 ${succeeded}/${batch.length}，其余文件保留在左栏，可核对后重新确认上传。`; } }
        catch (e) { if (alive && !signal.aborted) error.value = e.message; } finally { running.value = false; } return; }
    await execute(async signal => { if (action.kind === 'download') { const job = await api.prepare(s, { direction: 'download', path: action.item.path }, signal); const a = document.createElement('a'); a.href = '/api/remote-files/downloads/' + job.ticket; a.download = action.item.name; a.rel = 'noreferrer'; document.body.append(a); a.click(); a.remove(); status.value = await api.status(s, signal); }
        else { await api.alter(s, { action: action.kind, path: action.item?.path || directory.value, ...(action.kind !== 'delete' ? { name: editName.value.trim() } : {}) }, signal); await readList(s, directory.value, signal); } });
}
async function stop() { controller?.abort(); if (!session.value) return; try { status.value = await api.cancel(session.value); notice.value = '已停止并关闭连接。已完成的文件保留；重新连接前请核对队列结果。'; } catch (e) { error.value = e.message; } }
async function disconnect(keepalive = false) { const s = session.value; session.value = null; clearTimeout(pollTimer); pollController?.abort(); controller?.abort(); closeDialog(); if (status.value) status.value.connected = false; items.value = []; selected.value = null; if (s) { try { await api.disconnect(s, keepalive); } catch (e) { if (alive) error.value = e.message; } } }
function background() { if (document.hidden) { notice.value = '页面进入后台，连接已关闭；请重新连接。'; disconnect(true); } }
function leaving() { disconnect(true); }
document.addEventListener('visibilitychange', background); window.addEventListener('pagehide', leaving);
onBeforeUnmount(() => { alive = false; disconnect(true); document.removeEventListener('visibilitychange', background); window.removeEventListener('pagehide', leaving); samples.clear(); });
</script>
