<template>
    <div class="view-page share-page">
        <header class="share-toolbar"><div><h1 class="view-title">局域网文件共享</h1><p class="share-muted">共享电脑文件夹，通过手机或其他电脑的浏览器上传、下载。</p></div><Button id="share-help" @click="help = true">帮助</Button></header>
        <p v-if="error" class="notice notice-error" role="alert">{{ error }} <button class="btn btn-sm" :disabled="busy" @click="load">刷新状态</button></p>
        <div class="share-layout">
            <aside class="share-panel">
                <h2>开启共享</h2>
                <form class="ext-stack" @submit.prevent="confirmCreate = true">
                    <label class="share-field">工具箱电脑的文件夹路径<InputText id="share-root" v-model="root" placeholder="例如 D:\共享文件" :disabled="busy" /></label>
                    <label class="share-toggle" for="share-writable"><ToggleSwitch v-model="writable" input-id="share-writable" :disabled="busy" /><span>允许上传和新建文件夹</span></label>
                    <label class="share-field">共享有效期<UiChoice v-model="hours" input-id="share-hours" aria-label="共享有效期" :options="durationOptions" :disabled="busy" /></label>
                    <Button id="share-create" type="submit" :disabled="busy || !root.trim() || !config">{{ busy ? '处理中…' : '开启共享' }}</Button>
                </form>
                <p v-if="config && !config.allowLan" class="notice">当前为仅本机模式，可在本机试用。手机访问请先以 Lan 模式重启工具箱。</p>
                <h2>正在共享 <span class="share-muted">{{ config?.shares.length || 0 }}/8</span></h2>
                <p v-if="!config?.shares.length" class="share-muted">选择现有文件夹并开启后，分享链接会显示在这里。</p>
                <div v-for="item in config?.shares || []" :key="item.id" class="share-session" :class="{ 'is-active': selectedId === item.id }">
                    <button class="share-session-title" :aria-pressed="selectedId === item.id" @click="selectedId = item.id">{{ item.name }}</button><p class="share-muted share-path">{{ item.root }}</p><p class="share-muted">{{ item.writable ? '可上传' : '只读' }} · {{ date(item.expiresAt) }} 到期</p><Button class="btn-sm" :disabled="busy" @click="stopping = item">停止共享</Button>
                </div>
            </aside>
            <main class="share-content">
                <section v-if="selected" class="share-panel share-access" aria-label="访问链接">
                    <div class="share-access-main"><h2>{{ selected.name }}</h2><label class="share-field">访问地址<UiChoice v-model="origin" input-id="share-origin" aria-label="访问地址" :options="origins.map(value => ({ label: value, value }))" /></label><div class="share-toolbar"><Button id="share-copy" @click="copy">复制共享链接</Button><a id="share-open" class="btn" :href="url" target="_blank" rel="noreferrer">打开访问页</a><span role="status">{{ copied }}</span></div><p class="share-muted">链接持有者可浏览和下载{{ selected.writable ? '，也可上传' : '' }}。关闭此页面后共享继续，到期或停止后链接失效。</p></div>
                    <div class="share-qr" v-html="qr"></div>
                </section>
                <section class="share-panel"><SharedFileBrowser v-if="selected" :key="selected.id" :share="selected" /><p v-else class="share-empty">开启或选择一个共享，即可浏览文件与生成手机扫码入口。</p></section>
            </main>
        </div>
        <UiDialog v-if="confirmCreate" title="确认共享文件夹" @close="!busy && (confirmCreate = false)"><p class="share-path">{{ root }}</p><p>权限：{{ writable ? '浏览、下载、上传和新建文件夹' : '只读：浏览和下载' }}；有效期 {{ hours }} 小时。</p><p>此目录及子目录中的普通文件将通过共享链接开放。同名上传另存，不覆盖原件。</p><Button id="share-confirm-create" :disabled="busy" @click="create">{{ busy ? '正在开启…' : '确认开启' }}</Button></UiDialog>
        <UiDialog v-if="stopping" title="停止共享" @close="!busy && (stopping = null)"><p>停止“{{ stopping.name }}”后链接立即失效，未完成的传输会中止，已保存文件保留。</p><Button id="share-confirm-stop" :disabled="busy" @click="stop">确认停止共享</Button></UiDialog>
        <UiDialog v-if="help" title="局域网文件共享帮助" @close="help = false"><p>填写运行工具箱的电脑上的现有文件夹路径，默认只读；需要手机上传时开启上传权限。确认后复制链接或扫码访问，手机与电脑需位于同一网段。</p><p>可浏览子文件夹、搜索当前目录并下载文件；可上传共享支持批量文件上传、新建文件夹。同名自动加序号，每批最多100项、单文件1GiB。切后台或离开上传页会停止上传，已保存文件保留。</p><p>共享最多保留24小时，离开管理页继续有效；手动停止、到期或工具箱服务器退出后失效，重启需重新开启。文件直接在所选目录读写，不进入资源库或备份。</p><p>只共享你愿意开放的文件夹。链接、目录联接、硬链接和磁盘根目录不支持；共享期间请勿用其他程序替换目录结构。管理功能沿用工具箱受控局域网访问范围。</p></UiDialog>
    </div>
</template>
<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import Button from 'primevue/button';
import InputText from 'primevue/inputtext';
import ToggleSwitch from 'primevue/toggleswitch';
import UiChoice from '../components/ui/UiChoice.vue';
import UiDialog from '../components/ui/UiDialog.vue';
import SharedFileBrowser from '../components/SharedFileBrowser.vue';
import { fileShareApi } from '../api/file-share-client.js';
import { shareLink } from '../utils/file-share.js';
import { toQrSvg } from '../assets/qr-share.js';
import { copyText } from '../utils/clipboard.js';
const config = ref(null), root = ref(''), writable = ref(false), hours = ref(8), origin = ref(location.origin), selectedId = ref('');
const busy = ref(false), error = ref(''), confirmCreate = ref(false), stopping = ref(null), help = ref(false), qr = ref(''), copied = ref('');
const durationOptions = [1, 8, 24].map(value => ({ label: `${value} 小时`, value }));
const selected = computed(() => config.value?.shares.find(item => item.id === selectedId.value));
const origins = computed(() => [...new Set([...(config.value?.origins || []), location.origin])]);
const url = computed(() => selected.value ? shareLink(origin.value, selected.value) : '');
const date = value => new Date(value).toLocaleString('zh-CN');
let disposed = false, readController, actionController, timer, observer, qrSequence = 0;
async function load() {
    readController?.abort(); const controller = readController = new AbortController();
    try { const result = await fileShareApi.config(controller.signal); if (disposed || controller.signal.aborted) return;
        config.value = result; if (!result.shares.some(item => item.id === selectedId.value)) selectedId.value = result.shares[0]?.id || '';
        if (!origins.value.includes(origin.value) || origin.value === location.origin && ['localhost', '127.0.0.1'].includes(location.hostname)) origin.value = result.origins[0] || location.origin;
        error.value = '';
    } catch (e) { if (!disposed && !controller.signal.aborted) error.value = e.message; }
}
async function create() {
    busy.value = true; error.value = ''; actionController = new AbortController();
    try { const created = await fileShareApi.create({ root: root.value, writable: writable.value, hours: hours.value }, actionController.signal); if (disposed) return;
        confirmCreate.value = false; await load(); selectedId.value = created.id;
    } catch (e) { if (!disposed && !actionController.signal.aborted) error.value = e.message; }
    finally { if (!disposed) { busy.value = false; confirmCreate.value = false; } }
}
async function stop() {
    busy.value = true; error.value = ''; const id = stopping.value.id; actionController = new AbortController();
    try { await fileShareApi.stop(id, actionController.signal); if (!disposed) { stopping.value = null; await load(); } }
    catch (e) { if (!disposed && !actionController.signal.aborted) error.value = e.message; }
    finally { if (!disposed) busy.value = false; }
}
async function renderQr() {
    const sequence = ++qrSequence, value = url.value; qr.value = ''; copied.value = '';
    if (!value) return;
    try { const styles = getComputedStyle(document.documentElement); const result = await toQrSvg(value, { dark: styles.getPropertyValue('--adb-qr-foreground').trim(), light: styles.getPropertyValue('--adb-qr-background').trim(), width: 220 });
        if (!disposed && sequence === qrSequence) qr.value = result;
    } catch { if (!disposed) error.value = '二维码生成失败，可复制共享链接访问'; }
}
async function copy() { try { await copyText(url.value); copied.value = '已复制'; } catch { copied.value = '复制失败，可打开访问页后复制地址'; } }
function visibility() { clearInterval(timer); if (document.hidden) { readController?.abort(); } else { load(); timer = setInterval(load, 15_000); } }
watch(url, renderQr);
onMounted(() => { load(); timer = setInterval(load, 15_000); document.addEventListener('visibilitychange', visibility); observer = new MutationObserver(renderQr); observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] }); });
onBeforeUnmount(() => { disposed = true; qrSequence++; clearInterval(timer); readController?.abort(); actionController?.abort(); observer?.disconnect(); document.removeEventListener('visibilitychange', visibility); });
</script>
