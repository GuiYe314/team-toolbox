<template>
    <IntegrationLayout class="workshop video-workshop" tool-id="video-process" title="视频处理" subtitle="设置压制参数，保存常用模板，批量处理视频。">
        <section class="workshop-panel video-template-panel" aria-label="转码模板">
            <div class="ext-row"><div class="workshop-grow"><h2>转码模板</h2><p class="workshop-note">选好模板直接使用，也可以调整后保存为自己的设置。</p></div><button class="btn btn-sm" :disabled="presetBusy || busy" @click="loadPresets">刷新模板</button><button class="btn btn-sm" @click="help = true">帮助</button></div>
            <div class="video-template-row"><label class="workshop-grow">选择模板<UiChoice :model-value="selectedId" :options="presetChoices" input-id="video-template" aria-label="选择转码模板" :disabled="busy || presetBusy" filter @update:model-value="usePreset" /></label><button id="video-save-new" class="btn" :disabled="busy || presetBusy" @click="openSave(false)">另存为模板</button><button id="video-update-preset" class="btn" :disabled="busy || presetBusy || !selected || selected.builtin" @click="openSave(true)">改名 / 更新模板</button><button id="video-delete-preset" class="btn" :disabled="busy || presetBusy || !selected || selected.builtin" @click="dialogError = ''; dialog = 'delete'">删除模板</button></div>
            <p class="workshop-note" role="status">{{ selected?.description || (selected ? '自定义模板 · 保存在工具箱电脑' : '当前为手动参数') }}<span v-if="modified"> · 参数已调整，可更新或另存</span></p>
            <p v-if="presetError" class="workshop-error" role="alert">{{ presetError }}</p><p v-if="notice" class="workshop-success" role="status">{{ notice }}</p>
        </section>
        <div class="workshop-grid video-main-grid">
            <section class="workshop-panel" aria-label="压制参数">
                <div class="ext-row"><h2 class="workshop-grow">压制参数</h2><span class="workshop-small">H.264 / FFmpeg</span></div>
                <label>处理方式<UiChoice v-model="options.mode" input-id="video-mode" aria-label="处理方式" :options="modeChoices" :disabled="busy" /></label>
                <div class="workshop-tabs" role="tablist" aria-label="压制参数分类"><button v-for="entry in tabs" :id="'video-tab-' + entry.id" :key="entry.id" class="btn btn-sm" :class="{ 'is-active': tab === entry.id }" role="tab" :aria-selected="tab === entry.id" :aria-controls="'video-panel-' + entry.id" @click="tab = entry.id">{{ entry.label }}</button></div>
                <div v-if="tab === 'video'" id="video-panel-video" class="workshop-fields" role="tabpanel" aria-labelledby="video-tab-video">
                    <template v-if="!audioOnly">
                        <label>最大宽度（0为不限制）<input id="video-width" v-model.number="options.width" class="input" type="number" min="0" max="3840" :disabled="busy" /></label><label>最大高度（0为不限制）<input id="video-height" v-model.number="options.height" class="input" type="number" min="0" max="2160" :disabled="busy" /></label>
                        <label>输出帧率<UiChoice v-model="options.fps" input-id="video-fps" aria-label="输出帧率" :options="fpsChoices" :disabled="busy" /></label>
                        <template v-if="options.mode !== 'gif'"><label>画质控制<UiChoice v-model="options.rateControl" input-id="video-rate" aria-label="画质控制" :options="rateChoices" :disabled="busy" /></label><label v-if="options.rateControl === 'quality'">CRF（越小越清晰）<input id="video-crf" v-model.number="options.crf" class="input" type="number" min="18" max="38" :disabled="busy" /></label><label v-else>平均码率（kbps）<input id="video-bitrate" v-model.number="options.bitrate" class="input" type="number" min="100" max="50000" :disabled="busy" /></label>
                        <label>编码速度<UiChoice v-model="options.preset" input-id="video-speed" aria-label="编码速度" :options="speedChoices" :disabled="busy" /></label><label>H.264 Profile<UiChoice v-model="options.profile" input-id="video-profile" aria-label="H.264 Profile" :options="profileChoices" :disabled="busy" /></label><label>H.264 Level<UiChoice v-model="options.level" input-id="video-level" aria-label="H.264 Level" :options="levelChoices" :disabled="busy" /></label></template>
                    </template><p v-else class="workshop-note video-wide">提取 MP3 只使用音频参数，可在“音频”页选择码率、采样率和声道。</p>
                    <p class="workshop-note video-wide">保持宽高比、不放大，输出偶数尺寸。0表示按原尺寸，上限3840×2160。指定帧率可能补帧或丢帧；GIF默认10秒、最多30秒。</p>
                </div>
                <div v-if="tab === 'audio'" id="video-panel-audio" class="workshop-fields" role="tabpanel" aria-labelledby="video-tab-audio">
                    <template v-if="options.mode !== 'gif'"><label v-if="!audioOnly">音频处理<UiChoice v-model="options.audio" input-id="video-audio" aria-label="音频处理" :options="audioChoices" :disabled="busy" /></label><template v-if="audioOnly || options.audio !== 'none'"><label>音频码率<UiChoice v-model="options.audioBitrate" input-id="video-audio-bitrate" aria-label="音频码率" :options="audioRateChoices" :disabled="busy" /></label><label>采样率<UiChoice v-model="options.sampleRate" input-id="video-sample-rate" aria-label="采样率" :options="sampleChoices" :disabled="busy" /></label><label>声道<UiChoice v-model="options.channels" input-id="video-channels" aria-label="声道" :options="channelChoices" :disabled="busy" /></label></template><p class="workshop-note video-wide">MP4 使用 AAC，MP3 使用 MP3 编码；只处理第一条音轨。无音轨的视频仍可输出静音 MP4。</p></template><p v-else class="workshop-note">GIF不包含音频。</p>
                </div>
                <div v-if="tab === 'subtitle'" id="video-panel-subtitle" class="ext-stack" role="tabpanel" aria-labelledby="video-tab-subtitle">
                    <template v-if="!audioOnly && options.mode !== 'gif'"><label>字幕处理<UiChoice v-model="options.subtitleMode" input-id="video-subtitle-mode" aria-label="字幕处理" :options="subtitleChoices" :disabled="busy" /></label><template v-if="options.subtitleMode === 'burn'"><label>本次字幕文件<input id="video-subtitle-file" type="file" accept=".srt,.ass" :disabled="busy" @change="chooseSubtitle" /></label><div v-if="subtitle" class="ext-row"><span class="workshop-grow">{{ subtitle.name }} · {{ formatSize(subtitle.size) }}</span><button class="btn btn-sm" :disabled="busy" @click="subtitle = null">移除字幕</button></div><p class="workshop-note">UTF-8 的 SRT / ASS，最多2MiB；同一字幕应用到整批视频，时间轴按原视频。烧录后无法关闭字幕，建议先处理一个短片段检查效果。字体使用工具箱电脑现有字体。</p></template></template><p v-else class="workshop-note">字幕烧录用于MP4视频，MP3与GIF不添加字幕。</p>
                </div>
                <div v-if="tab === 'trim'" id="video-panel-trim" class="workshop-fields" role="tabpanel" aria-labelledby="video-tab-trim"><label>开始时间（秒）<input id="video-start" v-model.number="options.start" class="input" type="number" min="0" max="86400" :disabled="busy" /></label><label>时长（秒，留空到结尾）<input id="video-duration" v-model="options.duration" class="input" type="number" min="0.1" max="7200" step="0.1" :disabled="busy" /></label><p class="workshop-note video-wide">裁剪会重新编码。时间应用到整批视频，但不会写入模板。</p></div>
                <p class="video-summary">{{ summary }}</p>
            </section>
            <section class="workshop-panel" aria-label="批量处理队列">
                <div class="ext-row"><h2 class="workshop-grow">批量队列</h2><span class="workshop-small">{{ completed }} / {{ items.length }} 完成</span></div>
                <div class="workshop-drop" @dragover.prevent @drop.prevent="add($event.dataTransfer.files)"><label>多选或拖入视频<input id="media-files" type="file" multiple accept="video/*,.mkv,.ts,.m2ts" :disabled="busy" @change="add($event.target.files); $event.target.value = ''" /></label><p class="workshop-note">最多8个视频，每个1GiB。按列表顺序使用本次参数逐项处理，原文件保留。</p></div>
                <div class="ext-row"><button id="media-start" class="btn btn-primary" :disabled="busy || presetBusy || !items.some(item => item.status !== 'completed')" @click="run">{{ completed ? '处理未完成项' : '开始批量处理' }}</button><button id="media-stop" class="btn" :disabled="!busy" @click="stop">停止队列</button><button class="btn" :disabled="busy || !items.length" @click="clear">清空列表</button><button id="media-reset" class="btn" :disabled="busy || !completed" @click="resetResults">重新处理全部</button></div>
                <p v-if="error" class="workshop-error" role="alert">{{ error }}</p><p v-if="queueNotice" class="workshop-note" role="status">{{ queueNotice }}</p>
                <p v-if="!items.length" class="workshop-note">先选择模板或调整参数，再添加需要处理的视频。</p>
                <ol class="workshop-list video-queue"><li v-for="(item, index) in items" :key="item.id" class="workshop-item"><div class="ext-row"><div class="workshop-grow"><strong>{{ index + 1 }}. {{ item.file.name }}</strong><p class="workshop-small">{{ formatSize(item.file.size) }} · {{ statusText(item) }}<template v-if="item.size"> · 输出 {{ formatSize(item.size) }}</template></p></div><a v-if="item.url" class="btn btn-sm" :href="item.url" :download="item.name">下载结果</a><button class="btn btn-sm" :disabled="busy" @click="remove(item)">移除</button></div><p v-if="item.settings" class="workshop-small">{{ item.settings }}</p><progress v-if="item.status === 'uploading'" :value="item.progress" max="100" aria-label="视频上传进度"/><p v-if="item.status === 'processing'" class="workshop-note" role="status">正在编码，请稍候…</p><p v-if="item.error" class="workshop-error" role="alert">{{ item.error }}</p></li></ol>
                <p class="workshop-note">输出每项最多256MiB，本页结果合计最多512MiB；请及时下载。切到后台或离开本工具会停止在途任务；离开后结果释放。</p>
            </section>
        </div>
        <UiDialog v-if="dialog" :title="dialog === 'delete' ? '删除转码模板' : updating ? '改名 / 更新转码模板' : '保存转码模板'" @close="!presetBusy && (dialog = '')">
            <template v-if="dialog === 'delete'"><p>确认删除“{{ selected?.name }}”？当前压制参数和已选视频会保留。</p><p v-if="dialogError" class="workshop-error" role="alert">{{ dialogError }}</p><div class="ext-row"><button class="btn" :disabled="presetBusy" @click="dialog = ''">取消</button><button id="video-confirm-delete" class="btn btn-danger" :disabled="presetBusy" @click="deletePreset">确认删除</button></div></template>
            <template v-else><label class="ext-field">模板名称<input id="video-preset-name" v-model="templateName" class="input" maxlength="40" :disabled="presetBusy" /></label><p class="workshop-note">{{ summary }}。保存压制参数；不保存裁剪时间、视频或字幕文件。{{ updating ? '保存会替换此模板的参数。' : '' }}</p><p v-if="dialogError" class="workshop-error" role="alert">{{ dialogError }}</p><div class="ext-row"><button class="btn" :disabled="presetBusy" @click="dialog = ''">取消</button><button id="video-confirm-save" class="btn btn-primary" :disabled="presetBusy || !templateName.trim()" @click="savePreset">{{ presetBusy ? '正在保存…' : '保存模板' }}</button></div></template>
        </UiDialog>
        <UiDialog v-if="help" title="视频压制与模板帮助" @close="help = false"><p>选模板后直接载入参数，按需调整视频、音频、字幕与裁剪选项，添加文件并开始批量处理。失败项可重试，成功项保留；重新处理全部会释放当前结果。</p><p>Unity模板使用MP4、H.264 Main 4.1、YUV420P、AAC双声道48kHz、faststart及1080p/720p与30fps上限。不同平台解码能力不同，请先在目标Unity项目试播；不支持透明通道。</p><p>CRF越小画质越高且文件通常越大；平均码率影响体积，但不是精确文件大小。较慢的编码预设可改善压缩效率。上传显示字节百分比，编码阶段仅显示等待，不代表卡住。</p><p>模板保存在工具箱电脑的data/video-presets.json，可由同一工具箱的其他浏览器读取，重启后保留；不包含在知识库内容备份中。字幕模板仅记住烧录选项，每次需重新选择字幕文件。MP4不保留原有字幕、附件及多条音轨。</p><p>基于FFmpeg；布局参考小丸工具箱的参数分类。每项最多10分钟，取消会清理临时文件；原文件保留。</p></UiDialog>
        <template #footer>基于 FFmpeg · 文件临时处理；常用参数可保存为服务器模板。</template>
    </IntegrationLayout>
</template>
<script setup>
import { ref, reactive, computed, onMounted, onBeforeUnmount, watch } from 'vue';
import IntegrationLayout from '../components/IntegrationLayout.vue';
import UiChoice from '../components/ui/UiChoice.vue';
import UiDialog from '../components/ui/UiDialog.vue';
import { uploadMedia, formatSize } from '../utils/tool-files.js';
import { VIDEO_DEFAULTS, templateOptions, applyVideoPreset, videoSummary, videoPresetRequest } from '../utils/video-workshop.js';
const options = reactive({ ...VIDEO_DEFAULTS, start: 0, duration: '' });
const items = ref([]), presets = ref([]), selectedId = ref(''), tab = ref('video'), subtitle = ref(null);
const error = ref(''), presetError = ref(''), notice = ref(''), queueNotice = ref(''), busy = ref(false), presetBusy = ref(false), help = ref(false);
const dialog = ref(''), updating = ref(false), templateName = ref(''), dialogError = ref('');
const lifetime = new AbortController(); let controller, sequence = 0, disposed = false, dialogRecord;
const selected = computed(() => presets.value.find(item => item.id === selectedId.value));
const presetChoices = computed(() => presets.value.map(item => ({ label: `${item.builtin ? '内置' : '自定义'} · ${item.name}`, value: item.id })));
const modified = computed(() => selected.value && JSON.stringify(templateOptions(options)) !== JSON.stringify(templateOptions(selected.value.options)));
const summary = computed(() => videoSummary(options)), completed = computed(() => items.value.filter(item => item.status === 'completed').length), audioOnly = computed(() => options.mode === 'mp3');
const choices = pairs => pairs.map(([value, label]) => ({ value, label }));
const tabs = [{ id: 'video', label: '视频' }, { id: 'audio', label: '音频' }, { id: 'subtitle', label: '字幕' }, { id: 'trim', label: '裁剪' }];
const modeChoices = choices([['compress', '视频压制 · MP4'], ['trim', '截取视频 · MP4'], ['mp4', '转为 MP4'], ['mp3', '提取 MP3 音频'], ['gif', '转为 GIF']]);
const fpsChoices = choices([[0, '保持原帧率'], ...[10, 15, 24, 25, 30, 50, 60].map(n => [n, `${n} fps`])]);
const rateChoices = choices([['quality', '恒定画质 · CRF'], ['bitrate', '平均码率 · kbps']]);
const speedChoices = choices([['ultrafast', '极快 · ultrafast'], ['superfast', '超快 · superfast'], ['veryfast', '很快 · veryfast'], ['faster', '较快 · faster'], ['fast', '快速 · fast'], ['medium', '均衡 · medium'], ['slow', '慢速 · slow'], ['slower', '更慢 · slower'], ['veryslow', '很慢 · veryslow']]);
const profileChoices = choices([['auto', '自动选择'], ['baseline', 'Baseline'], ['main', 'Main · Unity预设'], ['high', 'High']]);
const levelChoices = choices([['auto', '自动选择'], ...['3.1', '4.0', '4.1', '5.1'].map(n => [n, n])]);
const audioChoices = choices([['aac', 'AAC 重新编码'], ['none', '静音 · 移除音轨']]);
const audioRateChoices = choices([64, 96, 128, 160, 192, 256, 320].map(n => [n, `${n} kbps`]));
const sampleChoices = choices([[0, '保持原采样率'], [44100, '44.1 kHz'], [48000, '48 kHz']]);
const channelChoices = choices([[0, '保持原声道'], [1, '单声道'], [2, '双声道']]);
const subtitleChoices = choices([['none', '不添加字幕'], ['burn', '烧录外置字幕 · SRT / ASS']]);
watch(() => options.mode, mode => { if (['mp3', 'gif'].includes(mode)) options.subtitleMode = 'none'; });
watch(() => options.subtitleMode, mode => { if (mode !== 'burn') subtitle.value = null; });
async function loadPresets() {
    if (presetBusy.value || busy.value) return;
    presetBusy.value = true; presetError.value = '';
    try {
        const result = await videoPresetRequest('', { signal: lifetime.signal });
        if (disposed) return;
        presets.value = result.items;
        if (!selectedId.value && !items.value.length && !notice.value) usePreset('balanced');
    } catch (e) { if (!disposed) presetError.value = e.message; }
    finally { if (!disposed) presetBusy.value = false; }
}
function usePreset(id) {
    const item = presets.value.find(item => item.id === id); if (!item || busy.value) return;
    selectedId.value = id; Object.assign(options, applyVideoPreset(item.options)); subtitle.value = null; error.value = ''; notice.value = `已应用“${item.name}”`;
}
function openSave(update) { updating.value = update; dialogRecord = selected.value; templateName.value = update ? selected.value.name : ''; dialogError.value = ''; dialog.value = 'save'; }
async function savePreset() {
    if (presetBusy.value) return; presetBusy.value = true; dialogError.value = '';
    try {
        const body = { name: templateName.value, options: templateOptions(options), ...(updating.value ? { revision: dialogRecord.revision } : {}) };
        const result = await videoPresetRequest(updating.value ? '/' + dialogRecord.id : '', { method: updating.value ? 'PUT' : 'POST', body, signal: lifetime.signal });
        if (disposed) return;
        presets.value = [...presets.value.filter(item => item.id !== result.item.id), result.item]; selectedId.value = result.item.id;
        dialog.value = ''; notice.value = `模板“${result.item.name}”已保存`;
    } catch (e) { if (!disposed) dialogError.value = e.message; }
    finally { if (!disposed) presetBusy.value = false; }
}
async function deletePreset() {
    if (presetBusy.value || !selected.value || selected.value.builtin) return;
    const record = selected.value; presetBusy.value = true; dialogError.value = '';
    try {
        await videoPresetRequest('/' + record.id, { method: 'DELETE', body: { confirm: true, revision: record.revision }, signal: lifetime.signal });
        if (disposed) return; presets.value = presets.value.filter(item => item.id !== record.id); selectedId.value = ''; dialog.value = ''; notice.value = '模板已删除，当前参数保留';
    } catch (e) { if (!disposed) dialogError.value = e.message; }
    finally { if (!disposed) presetBusy.value = false; }
}
function chooseSubtitle(event) {
    const file = event.target.files[0]; event.target.value = '';
    if (!file) return;
    if (!/\.(srt|ass)$/i.test(file.name) || !file.size || file.size > 2 * 1024 ** 2) { error.value = '请选择非空的SRT/ASS字幕，最多2MiB'; return; }
    subtitle.value = file; error.value = '';
}
function add(files) {
    if (busy.value) return; error.value = ''; queueNotice.value = '';
    for (const file of files || []) {
        if (!/\.(mp4|mov|m4v|mkv|webm|avi|mpeg|mpg|ts|m2ts)$/i.test(file.name) || !file.size || file.size > 1024 ** 3) { error.value = `${file.name}：请选择非空视频，最多1GiB`; continue; }
        if (items.value.length >= 8) { error.value = '一批最多8个视频'; break; }
        items.value.push({ id: ++sequence, file, status: 'waiting', progress: 0, error: '', url: '', size: 0 });
    }
}
function release(item) { if (item.url) URL.revokeObjectURL(item.url); item.url = ''; item.size = 0; }
function remove(item) { release(item); items.value = items.value.filter(other => other.id !== item.id); }
function stop() { controller?.abort(); }
function clear() { stop(); items.value.forEach(release); items.value = []; error.value = ''; queueNotice.value = ''; }
function resetResults() { items.value.forEach(item => { release(item); item.status = 'waiting'; item.error = ''; item.settings = ''; }); queueNotice.value = '结果已释放，将按当前参数重新处理全部视频'; }
function statusText(item) { return ({ waiting: '等待处理', uploading: `上传 ${item.progress}%`, processing: '正在编码', completed: '完成', failed: '失败，可重新处理', cancelled: '已停止' })[item.status]; }
async function run() {
    if (busy.value) return;
    if (options.subtitleMode === 'burn' && !subtitle.value) { error.value = '此设置需要字幕，请在“字幕”中选择本次使用的SRT/ASS文件'; tab.value = 'subtitle'; return; }
    const snapshot = { ...options }; if (!snapshot.duration) delete snapshot.duration;
    const caption = options.subtitleMode === 'burn' ? subtitle.value : null;
    controller = new AbortController(); const signal = controller.signal; busy.value = true; error.value = ''; queueNotice.value = '';
    try {
        for (const item of items.value) {
            if (signal.aborted || disposed) break;
            if (item.status === 'completed') continue;
            item.error = ''; item.status = 'uploading'; item.progress = 0; item.settings = videoSummary(snapshot);
            try {
                const result = await uploadMedia(item.file, 'video', snapshot, signal, progress => { if (!signal.aborted && !disposed) { item.progress = progress; item.status = progress >= 100 ? 'processing' : 'uploading'; } }, caption);
                if (signal.aborted || disposed) { item.status = 'cancelled'; break; }
                if (items.value.reduce((sum, row) => sum + row.size, 0) + result.blob.size > 512 * 1024 ** 2) throw new Error('本页结果达到512MiB，请下载并移除已完成项后继续');
                item.url = URL.createObjectURL(result.blob); item.name = result.name; item.size = result.blob.size; item.status = 'completed';
            } catch (e) { item.status = signal.aborted ? 'cancelled' : 'failed'; if (!signal.aborted) item.error = e.message; }
        }
        if (!disposed) queueNotice.value = signal.aborted ? '队列已停止，已完成结果保留，其余项目可继续处理' : `本轮结束：${completed.value}/${items.value.length}完成；失败项可重新处理`;
    } finally { if (!disposed) busy.value = false; controller = null; }
}
const hidden = () => { if (document.hidden) { stop(); } };
onMounted(loadPresets); document.addEventListener('visibilitychange', hidden);
onBeforeUnmount(() => { disposed = true; lifetime.abort(); clear(); document.removeEventListener('visibilitychange', hidden); });
</script>
