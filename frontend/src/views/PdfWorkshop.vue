<template>
    <IntegrationLayout class="workshop" tool-id="pdf-tools" title="PDF 工具" subtitle="合并、提取页面、旋转、水印和图片转 PDF，文件仅在浏览器处理。">
        <div class="workshop-grid"><section class="workshop-panel"><h2>处理方式</h2><label>操作<select v-model="mode" :disabled="busy" @change="resetFiles"><option value="merge">合并 PDF</option><option value="extract">拆分 / 提取页面</option><option value="images">图片转 PDF</option></select></label><label>{{ mode === 'images' ? '多选 JPG / PNG，按列表顺序合成' : '选择 PDF，按列表顺序合并；提取时每次选择一个' }}<input id="pdf-files" type="file" :accept="mode === 'images' ? 'image/jpeg,image/png' : 'application/pdf'" :multiple="mode !== 'extract'" :disabled="busy" @change="add($event.target.files); $event.target.value = ''"/></label><div class="workshop-fields"><label v-if="mode !== 'images'">页码（留空为全部）<input id="pdf-pages" v-model="pages" class="input" placeholder="1-3,5,8" :disabled="busy"/></label><label>顺时针旋转<select v-model.number="rotation" :disabled="busy"><option :value="0">不旋转</option><option :value="90">90°</option><option :value="180">180°</option><option :value="270">270°</option></select></label></div><label>文字水印（英文 / 数字，可留空）<input v-model="watermark" class="input" maxlength="80" placeholder="例如 INTERNAL" :disabled="busy"/></label><p class="workshop-note">每文件最多64MiB、合计128MiB，最多30个文件/2000页。页码应用于每份 PDF；提取指定范围生成一个新 PDF。加密文件不支持，不编辑原正文或转换为 Word。</p><div class="ext-row"><button id="pdf-start" class="btn btn-primary" :disabled="busy || !files.length" @click="run">生成 PDF</button><button class="btn" :disabled="!busy" @click="controller?.abort()">停止</button><button class="btn" :disabled="busy" @click="resetFiles">清空</button></div><p v-if="status" role="status" class="workshop-note">{{ status }}</p><p v-if="error" role="alert" class="workshop-error">{{ error }}</p></section>
        <section class="workshop-panel"><h2>文件顺序</h2><ul class="workshop-list"><li v-for="(file, index) in files" :key="index" class="workshop-item"><div class="ext-row"><span class="workshop-grow">{{ index + 1 }}. {{ file.name }} · {{ formatSize(file.size) }}</span><button class="btn btn-sm" :disabled="busy || index === 0" :aria-label="`上移${file.name}`" @click="move(index,-1)">上移</button><button class="btn btn-sm" :disabled="busy || index === files.length - 1" :aria-label="`下移${file.name}`" @click="move(index,1)">下移</button><button class="btn btn-sm" :disabled="busy" @click="files.splice(index,1)">移除</button></div></li></ul><p v-if="!files.length" class="workshop-note">尚未选择文件</p><a v-if="result" id="pdf-download" class="btn btn-primary" :href="result" download="工具箱-处理结果.pdf">下载生成的 PDF</a></section></div><template #footer>基于 pdf-lib · 原文件保持不变，离开页面释放生成结果。</template>
    </IntegrationLayout>
</template>
<script setup>
import { ref, onBeforeUnmount } from 'vue';
import IntegrationLayout from '../components/IntegrationLayout.vue';
import { buildPdf } from '../utils/pdf-tools.js';
import { formatSize } from '../utils/tool-files.js';
const mode = ref('merge'), files = ref([]), pages = ref(''), rotation = ref(0), watermark = ref(''), error = ref(''), status = ref(''), busy = ref(false), result = ref('');
let controller;
function resetFiles() { files.value = []; error.value = ''; status.value = ''; if (result.value) URL.revokeObjectURL(result.value); result.value = ''; }
function add(selected) { error.value = ''; for (const file of selected || []) { if (files.value.length >= 30) { error.value = '最多选择30个文件'; break; } if (mode.value === 'extract') files.value = []; files.value.push(file); } }
function move(index, offset) { const list = [...files.value]; [list[index], list[index + offset]] = [list[index + offset], list[index]]; files.value = list; }
async function run() {
    if (busy.value) return; busy.value = true; error.value = ''; controller = new AbortController(); const signal = controller.signal;
    if (result.value) URL.revokeObjectURL(result.value); result.value = '';
    try { const blob = await buildPdf(files.value, { mode: mode.value, pages: pages.value, rotation: rotation.value, watermark: watermark.value }, { signal, onProgress: (done, total) => { status.value = `正在处理 ${done}/${total}`; } }); if (!signal.aborted) { result.value = URL.createObjectURL(blob); status.value = `PDF 已生成 · ${formatSize(blob.size)}`; } }
    catch (e) { if (signal.aborted) status.value = '已停止'; else error.value = e.message; }
    finally { busy.value = false; }
}
const hidden = () => { if (document.hidden) controller?.abort(); }; document.addEventListener('visibilitychange', hidden);
onBeforeUnmount(() => { controller?.abort(); resetFiles(); document.removeEventListener('visibilitychange', hidden); });
</script>
