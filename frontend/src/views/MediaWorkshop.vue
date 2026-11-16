<template>
    <IntegrationLayout :key="kind" class="workshop" :tool-id="kind === 'image' ? 'image-batch' : 'video-process'" :title="kind === 'image' ? '图片批处理' : '视频处理'" subtitle="选择本地文件，处理后下载结果；保留原文件。">
        <div class="workshop-grid">
            <section class="workshop-panel">
                <h2>处理选项</h2>
                <div v-if="kind === 'image'" class="workshop-fields">
                    <label>输出格式<select v-model="image.format" :disabled="busy"><option value="webp">WebP</option><option value="jpeg">JPG</option><option value="png">PNG</option><option value="avif">AVIF</option></select></label>
                    <label>质量（1～100）<input v-model.number="image.quality" class="input" type="number" min="1" max="100" :disabled="busy" /></label>
                    <label>宽度（留空保持）<input v-model="image.width" class="input" type="number" min="1" max="8192" :disabled="busy" /></label>
                    <label>高度（留空保持）<input v-model="image.height" class="input" type="number" min="1" max="8192" :disabled="busy" /></label>
                    <label>缩放方式<select v-model="image.fit" :disabled="busy"><option value="inside">完整保留，不放大小图</option><option value="cover">填满并裁剪</option><option value="contain">完整保留并补边</option></select></label>
                    <label>旋转<select v-model.number="image.rotate" :disabled="busy"><option :value="0">保持方向</option><option :value="90">90°</option><option :value="180">180°</option><option :value="270">270°</option></select></label>
                    <label>右下角文字水印<input v-model="image.watermark" class="input" maxlength="80" placeholder="留空不添加" :disabled="busy" /></label>
                </div>
                <div v-else class="workshop-fields">
                    <label>处理方式<select v-model="video.mode" :disabled="busy"><option value="compress">压缩视频</option><option value="trim">截取视频</option><option value="mp4">转 MP4</option><option value="mp3">提取 MP3 音频</option><option value="gif">转 GIF（最多30秒）</option></select></label>
                    <label>最大宽度<input v-model.number="video.width" class="input" type="number" min="160" max="3840" :disabled="busy" /></label>
                    <label>开始时间（秒）<input v-model.number="video.start" class="input" type="number" min="0" max="86400" :disabled="busy" /></label>
                    <label>截取时长（秒，留空到结尾）<input v-model="video.duration" class="input" type="number" min="0.1" max="7200" step="0.1" :disabled="busy" /></label>
                    <label>压缩程度（越高体积越小）<input v-model.number="video.crf" class="input" type="number" min="18" max="38" :disabled="busy" /></label>
                </div>
                <p class="workshop-note">{{ kind === 'image' ? '支持 JPG、PNG、WebP、AVIF 等位图，每张最多32MiB/3200万像素，一批最多30张。动图输出为静态图片；质量选项主要影响有损格式。' : '使用工具箱电脑的 FFmpeg，每个视频最多1GiB，一批最多8个。输出最多256MiB；GIF默认10秒、最多30秒。处理进度与上传进度分开显示。' }}</p>
                <div class="workshop-drop" @dragover.prevent @drop.prevent="add($event.dataTransfer.files)"><label>多选或拖入文件<input id="media-files" :key="kind" type="file" multiple :accept="kind === 'image' ? 'image/jpeg,image/png,image/webp,image/avif,image/heic,image/heif,image/tiff,image/gif' : 'video/*,.mkv,.ts'" :disabled="busy" @change="add($event.target.files); $event.target.value = ''" /></label></div>
                <p v-if="error" class="workshop-error" role="alert">{{ error }}</p>
                <div class="ext-row"><button id="media-start" class="btn btn-primary" :disabled="busy || !items.some(item => item.status !== '完成')" @click="run">开始处理</button><button class="btn" :disabled="!busy" @click="stop">停止</button><button class="btn" :disabled="busy || !items.length" @click="clear">清空列表</button></div>
            </section>
            <section class="workshop-panel"><h2>文件与结果（{{ items.length }}）</h2><p v-if="!items.length" class="workshop-note">选择文件后，可逐项查看结果并下载。</p><ul class="workshop-list"><li v-for="item in items" :key="item.id" class="workshop-item"><div class="ext-row"><div class="workshop-grow"><strong>{{ item.file.name }}</strong><p class="workshop-small">{{ formatSize(item.file.size) }} · {{ item.status }}<template v-if="item.size"> · 输出 {{ formatSize(item.size) }}</template></p></div><a v-if="item.url" class="btn btn-sm" :href="item.url" :download="item.name">下载</a><button class="btn btn-sm" :disabled="busy" @click="remove(item)">移除</button></div><progress v-if="item.status.startsWith('上传')" :value="item.progress" max="100" :aria-label="item.status"/><p v-if="item.error" class="workshop-error" role="alert">{{ item.error }}</p><img v-if="kind === 'image' && item.url" class="workshop-preview" :src="item.url" alt="处理结果预览" /></li></ul></section>
        </div>
        <template #footer>{{ kind === 'image' ? '基于 Sharp' : '基于 FFmpeg' }} · 文件只在工具箱电脑临时处理，结束后清理；结果保留在当前页面，离开前请下载。</template>
    </IntegrationLayout>
</template>
<script setup>
import { ref, reactive, onBeforeUnmount, watch } from 'vue';
import IntegrationLayout from '../components/IntegrationLayout.vue';
import { uploadMedia, formatSize } from '../utils/tool-files.js';
const props = defineProps({ kind: { type: String, default: 'image' } });
const image = reactive({ format: 'webp', quality: 82, width: '', height: '', fit: 'inside', rotate: 0, watermark: '' });
const video = reactive({ mode: 'compress', start: 0, duration: '', width: 1280, crf: 26 });
const items = ref([]), error = ref(''), busy = ref(false); let controller, generation = 0;
function add(files) {
    if (busy.value) return;
    const max = props.kind === 'image' ? 30 : 8, limit = props.kind === 'image' ? 32 * 1024 ** 2 : 1024 ** 3;
    error.value = '';
    for (const file of files || []) {
        if (!file.size || file.size > limit) { error.value = `${file.name}：文件为空或超过${formatSize(limit)}限制`; continue; }
        if (items.value.length >= max) { error.value = `一批最多${max}个文件`; break; }
        items.value.push({ id: ++generation, file, status: '等待处理', error: '', url: '', progress: 0 });
    }
}
function remove(item) { if (item.url) URL.revokeObjectURL(item.url); items.value = items.value.filter(other => other.id !== item.id); }
function clear() { stop(); for (const item of items.value) if (item.url) URL.revokeObjectURL(item.url); items.value = []; error.value = ''; }
function stop() { controller?.abort(); }
async function run() {
    if (busy.value) return; busy.value = true; error.value = ''; controller = new AbortController();
    const signal = controller.signal, kind = props.kind, options = { ...(kind === 'image' ? image : video) };
    if (kind === 'video' && !options.duration) delete options.duration;
    try {
        for (const item of items.value) {
            if (signal.aborted) break;
            if (item.status === '完成') continue;
            item.error = ''; item.status = '上传 0%';
            try {
                const result = await uploadMedia(item.file, kind, options, signal, progress => { item.progress = progress; item.status = progress >= 100 ? '正在处理，请稍候…' : `上传 ${progress}%`; });
                if (signal.aborted) { item.status = '已停止'; break; }
                if (items.value.reduce((sum, other) => sum + (other.size || 0), 0) + result.blob.size > 512 * 1024 ** 2) throw new Error('本页结果已达512MiB，请下载并清空后继续');
                item.url = URL.createObjectURL(result.blob); item.name = result.name; item.size = result.blob.size; item.status = '完成';
            } catch (e) { item.status = signal.aborted ? '已停止' : '失败，可重新处理'; if (!signal.aborted) item.error = e.message; }
        }
    } finally { busy.value = false; controller = null; }
}
const hidden = () => { if (document.hidden) stop(); };
document.addEventListener('visibilitychange', hidden);
watch(() => props.kind, clear);
onBeforeUnmount(() => { clear(); document.removeEventListener('visibilitychange', hidden); });
</script>
