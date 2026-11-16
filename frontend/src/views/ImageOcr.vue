<template>
    <IntegrationLayout class="workshop" tool-id="image-ocr" title="图片文字识别" subtitle="在当前浏览器中识别中英文，不上传图片或识别内容。">
        <div class="workshop-grid">
            <section class="workshop-panel"><h2>选择图片</h2><label>JPG / PNG / WebP（最多20MiB）<input id="ocr-file" type="file" accept="image/jpeg,image/png,image/webp,image/bmp" :disabled="busy" @change="selectFile($event.target.files?.[0]); $event.target.value = ''" /></label><label>识别语言<select v-model="language" :disabled="busy"><option value="chi_sim+eng">简体中文 + 英文</option><option value="eng">英文</option><option value="chi_sim">简体中文</option></select></label><img v-if="preview" class="workshop-preview" :src="preview" alt="待识别图片"/><div class="ext-row"><button id="ocr-start" class="btn btn-primary" :disabled="busy || !file" @click="recognize">开始识别</button><button class="btn" :disabled="!busy" @click="stop">停止</button><button class="btn" :disabled="busy" @click="clear">清空</button></div><p v-if="status" class="workshop-note" role="status">{{ status }}</p><progress v-if="busy" :value="progress" max="100" aria-label="文字识别进度"/><p v-if="error" class="workshop-error" role="alert">{{ error }}</p><p class="workshop-note">中英文模型、WASM 和识别程序随工具箱本地提供。首次加载需要一些时间；识别效果受清晰度、字号和排版影响。仅识别图片，扫描 PDF 请先转成图片。</p></section>
            <section class="workshop-panel"><h2>识别文字</h2><textarea id="ocr-text" v-model="text" aria-label="识别文字，可编辑" placeholder="识别结果会显示在这里"/><div class="ext-row"><button class="btn" :disabled="!text" @click="copy">复制文字</button><button class="btn" :disabled="!text" @click="downloadBlob(new Blob([text], { type: 'text/plain;charset=utf-8' }), '识别文字.txt')">下载 TXT</button></div></section>
        </div><template #footer>基于 Tesseract.js · 停止、后台或离页会结束识别，不保存图片及文字。</template>
    </IntegrationLayout>
</template>
<script setup>
import { ref, shallowRef, onBeforeUnmount } from 'vue';
import IntegrationLayout from '../components/IntegrationLayout.vue';
import { downloadBlob } from '../utils/tool-files.js';
import { copyText } from '../utils/clipboard.js';
const file = shallowRef(null), preview = ref(''), language = ref('chi_sim+eng'), text = ref(''), error = ref(''), status = ref(''), progress = ref(0), busy = ref(false);
let worker, generation = 0, disposed = false;
function stop() { generation++; busy.value = false; worker?.terminate(); worker = null; status.value = '已停止，可重新识别'; }
function clear() { void stop(); file.value = null; text.value = ''; error.value = ''; status.value = ''; if (preview.value) URL.revokeObjectURL(preview.value); preview.value = ''; }
function selectFile(selected) {
    clear(); if (!selected) return;
    if (!/^image\/(jpeg|png|webp|bmp)$/.test(selected.type) || selected.size > 20 * 1024 ** 2 || !selected.size) { error.value = '请选择20MiB以内的 JPG、PNG、WebP 或 BMP 图片'; return; }
    file.value = selected; preview.value = URL.createObjectURL(selected);
}
async function copy() { try { await copyText(text.value); status.value = '文字已复制'; } catch { error.value = '复制失败，请选中文字手动复制'; } }
async function recognize() {
    if (busy.value || !file.value) return;
    const current = ++generation; busy.value = true; error.value = ''; progress.value = 0; status.value = '正在加载本地识别组件…';
    try {
        const bitmap = await createImageBitmap(file.value);
        const tooLarge = bitmap.width * bitmap.height > 24 * 1024 ** 2; bitmap.close();
        if (tooLarge) throw new Error('图片超过2400万像素，请先缩小后识别');
        if (current !== generation || disposed) return;
        worker = new Worker(new URL('../workers/ocr-worker.js', import.meta.url), { type: 'module' });
        worker.onerror = () => { if (current === generation) { worker?.terminate(); worker = null; busy.value = false; error.value = '本地识别组件加载失败，请重试'; } };
        worker.onmessage = ({ data }) => {
            if (current !== generation || disposed) return;
            if (data.type === 'progress') { progress.value = Math.round(data.progress * 100); status.value = data.status === 'recognizing text' ? `正在识别 ${progress.value}%` : '正在加载本地模型…'; }
            else { worker?.terminate(); worker = null; busy.value = false; if (data.type === 'result') { text.value = data.text; status.value = text.value.trim() ? '识别完成，可编辑后复制或下载' : '未识别到文字，请尝试更清晰的图片'; } else error.value = data.message; }
        };
        worker.postMessage({ language: language.value, file: file.value });
    } catch (e) { if (current === generation) error.value = e.message || '识别失败，请重新选择图片或重试'; }
    finally { if (current === generation && !worker) busy.value = false; }
}
const hidden = () => { if (document.hidden && busy.value) void stop(); }; document.addEventListener('visibilitychange', hidden);
onBeforeUnmount(() => { disposed = true; clear(); document.removeEventListener('visibilitychange', hidden); });
</script>
