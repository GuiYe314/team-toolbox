<template>
    <section class="share-browser" aria-label="共享文件浏览器">
        <div class="share-toolbar">
            <nav class="share-crumbs" aria-label="共享目录"><button class="btn btn-sm" :disabled="busy" @click="load('')">{{ snapshot?.name || '共享目录' }}</button><template v-for="part in crumbs" :key="part.path"><span aria-hidden="true">/</span><button class="btn btn-sm" :disabled="busy" @click="load(part.path)">{{ part.name }}</button></template></nav>
            <Button id="share-refresh" :disabled="loading || busy" @click="load(path)">刷新</Button>
        </div>
        <p v-if="error" class="notice notice-error" role="alert">{{ error }}</p>
        <p v-if="message" class="notice" role="status">{{ message }}</p>
        <p v-if="loading" class="share-muted" role="status">正在读取目录…</p>
        <template v-if="snapshot">
            <div class="share-toolbar">
                <InputText id="share-search" v-model="search" class="share-search" aria-label="搜索当前目录" placeholder="搜索当前目录文件名" />
                <span class="share-badge">{{ snapshot.writable ? '可上传' : '只读' }}</span>
                <template v-if="snapshot.writable"><Button id="share-pick" :disabled="busy" @click="fileInput.click()">上传文件</Button><Button id="share-mkdir" :disabled="busy" @click="folderName = ''; folderError = ''; folderDialog = true">新建文件夹</Button></template>
            </div>
            <input ref="fileInput" id="share-files" class="share-file-input" type="file" multiple aria-label="选择上传文件" :disabled="busy || !snapshot.writable" @change="choose($event.target.files); $event.target.value = ''" />
            <div v-if="snapshot.writable" class="share-drop" @dragover.prevent @drop.prevent="drop">可拖入文件，每批最多100项、单文件1GiB。文件直接保存到当前目录，同名自动加序号。</div>
            <p v-if="snapshot.truncated" class="notice">此目录只显示前2000项，请拆分目录后浏览。</p>
            <p v-if="!visible.length && !loading" class="share-muted">{{ search ? '没有匹配的文件' : '此目录为空' }}</p>
            <ul v-else class="share-file-list">
                <li v-for="item in visible" :key="item.path" class="share-file-row" :data-file-name="item.name">
                    <svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path v-if="item.type === 'directory'" d="M3 7h7l2 2h9v11H3zM3 7V4h7l2 3"/><path v-else d="M6 3h8l4 4v14H6zM14 3v5h4M9 12h6M9 16h6"/></svg>
                    <div class="share-file-main"><button v-if="item.type === 'directory'" class="share-file-name" :disabled="busy" @click="load(item.path)">{{ item.name }}</button><span v-else class="share-file-label">{{ item.name }}</span><span class="share-muted share-file-detail">{{ item.type === 'directory' ? '文件夹' : item.type === 'blocked' ? '链接或不可访问项目' : size(item.size) }} · {{ date(item.modifiedAt) }}</span></div>
                    <Button v-if="item.type === 'file'" class="btn-sm" :disabled="!!downloading" :aria-label="'下载 ' + item.name" @click="download(item)">{{ downloading === item.path ? '准备中…' : '下载' }}</Button>
                </li>
            </ul>
        </template>
        <section v-if="queue.length" class="share-upload-panel" aria-label="上传队列">
            <div class="share-toolbar"><h3>上传结果</h3><Button v-if="busy" id="share-cancel" @click="cancel">停止上传</Button><Button v-else-if="queue.some(item => item.status === '失败')" id="share-retry" @click="start(true)">重试失败项</Button><Button v-if="!busy" @click="queue = []">清空记录</Button></div>
            <ul class="share-file-list"><li v-for="item in queue" :key="item.requestId" class="share-upload-item"><div class="share-toolbar"><strong>{{ item.file.name }}</strong><span>{{ item.status }}<template v-if="item.status === '上传中'"> {{ item.progress }}%</template></span></div><progress v-if="item.status === '上传中'" :value="item.progress" max="100" :aria-label="item.file.name + ' 上传进度'"></progress><p v-if="item.detail" class="share-muted">{{ item.detail }}</p></li></ul>
        </section>
        <UiDialog v-if="folderDialog" title="新建文件夹" @close="!creating && (folderDialog = false)"><form class="ext-stack" @submit.prevent="mkdir"><label class="share-field">文件夹名称<InputText id="share-folder-name" v-model="folderName" maxlength="180" :disabled="creating" /></label><p v-if="folderError" class="notice notice-error" role="alert">{{ folderError }}</p><Button id="share-folder-create" type="submit" :disabled="creating || !folderName.trim()">{{ creating ? '创建中…' : '创建文件夹' }}</Button></form></UiDialog>
    </section>
</template>
<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import Button from 'primevue/button';
import InputText from 'primevue/inputtext';
import UiDialog from './ui/UiDialog.vue';
import { fileShareApi } from '../api/file-share-client.js';
import { fileShareSize as size, uploadRequestId } from '../utils/file-share.js';
const props = defineProps({ share: { type: Object, required: true } });
const snapshot = ref(null), path = ref(''), search = ref(''), loading = ref(false), busy = ref(false), error = ref(''), message = ref(''), downloading = ref('');
const queue = ref([]), fileInput = ref(null), folderDialog = ref(false), folderName = ref(''), folderError = ref(''), creating = ref(false);
let disposed = false, sequence = 0, readController, uploadController, actionController;
const crumbs = computed(() => path.value.split('/').filter(Boolean).map((name, i, parts) => ({ name, path: parts.slice(0, i + 1).join('/') })));
const visible = computed(() => (snapshot.value?.items || []).filter(item => item.name.toLocaleLowerCase().includes(search.value.toLocaleLowerCase())));
const date = value => value ? new Date(value).toLocaleString('zh-CN') : '—';
async function load(next = path.value) {
    readController?.abort(); const controller = readController = new AbortController(), request = ++sequence;
    loading.value = true; error.value = '';
    try { const result = await fileShareApi.entries(props.share, next, controller.signal); if (!disposed && request === sequence) { snapshot.value = result; path.value = next; search.value = ''; } }
    catch (e) { if (!disposed && request === sequence && !controller.signal.aborted) error.value = e.message + (snapshot.value ? '（仍显示上次目录）' : ''); }
    finally { if (!disposed && request === sequence) loading.value = false; }
}
function choose(files) {
    if (busy.value || !snapshot.value?.writable) return;
    const list = [...files]; error.value = ''; message.value = '';
    if (!list.length) return;
    if (list.length > 100 || list.some(file => file.size > 1024 ** 3)) { error.value = '每批最多100个文件，单文件不能超过1GiB'; return; }
    queue.value = list.map(file => ({ file, requestId: uploadRequestId(), path: path.value, status: '等待上传', progress: 0, detail: '' })); start();
}
function drop(event) {
    if ([...(event.dataTransfer?.items || [])].some(item => item.webkitGetAsEntry?.()?.isDirectory)) { error.value = '请进入目标目录后选择文件，暂不支持拖入整个文件夹'; return; }
    choose(event.dataTransfer?.files || []);
}
async function start(retry = false) {
    if (busy.value || document.hidden) return;
    const controller = uploadController = new AbortController(), share = props.share; busy.value = true; error.value = '';
    const pending = queue.value.filter(item => retry ? item.status === '失败' : item.status === '等待上传');
    for (const item of pending) {
        if (controller.signal.aborted || disposed) break;
        item.status = '上传中'; item.progress = 0; item.detail = '';
        try { const result = await fileShareApi.upload(share, item.path, item, controller.signal, value => { if (!disposed) item.progress = value; });
            if (disposed) break; item.status = '已保存'; item.progress = 100; item.detail = `${result.renamed ? '同名另存为 ' + result.name + ' · ' : ''}${size(result.size)} · SHA-256 ${result.sha256}`;
        } catch (e) { if (!disposed) { item.status = '失败'; item.detail = e.message; } if (controller.signal.aborted) break; }
    }
    for (const item of pending) if (item.status === '等待上传') { item.status = '失败'; item.detail = '未开始，可重试'; }
    if (!disposed) { busy.value = false; if (controller.signal.aborted) message.value = '上传已停止，已保存文件保留；请刷新目录核对。'; if (!document.hidden) await load(path.value); }
}
function cancel() { uploadController?.abort(); }
async function download(item) {
    actionController?.abort(); const controller = actionController = new AbortController(); downloading.value = item.path; error.value = ''; message.value = '';
    try { const result = await fileShareApi.ticket(props.share, item.path, controller.signal); if (disposed || controller.signal.aborted) return;
        const anchor = document.createElement('a'); anchor.href = `/api/file-share/downloads/${result.ticket}`; anchor.download = result.name; anchor.rel = 'noreferrer'; document.body.append(anchor); anchor.click(); anchor.remove();
        message.value = '已交给浏览器下载，请在浏览器下载列表查看进度或错误。';
    } catch (e) { if (!disposed && !controller.signal.aborted) error.value = e.message; }
    finally { if (!disposed) downloading.value = ''; }
}
async function mkdir() {
    actionController?.abort(); const controller = actionController = new AbortController(); creating.value = true; folderError.value = '';
    try { await fileShareApi.folder(props.share, path.value, folderName.value, controller.signal); if (!disposed && !controller.signal.aborted) { folderDialog.value = false; message.value = '文件夹已创建'; await load(path.value); } }
    catch (e) { if (!disposed && !controller.signal.aborted) folderError.value = e.message; }
    finally { if (!disposed) creating.value = false; }
}
function visibility() { if (document.hidden) { readController?.abort(); cancel(); actionController?.abort(); } else load(path.value); }
function leave() { readController?.abort(); cancel(); actionController?.abort(); }
watch(() => props.share.id, () => { leave(); snapshot.value = null; path.value = ''; queue.value = []; load(''); });
onMounted(() => { load(''); document.addEventListener('visibilitychange', visibility); window.addEventListener('pagehide', leave); });
onBeforeUnmount(() => { disposed = true; sequence++; leave(); document.removeEventListener('visibilitychange', visibility); window.removeEventListener('pagehide', leave); });
</script>
