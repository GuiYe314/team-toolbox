<template>
    <IntegrationLayout title="Yoinks 视频下载" subtitle="粘贴视频链接，选择画质或提取 MP3" tool-id="yoinks">
        <template #actions><button class="btn" data-test="video-settings" @click="settings = true">组件设置</button><button class="btn" @click="help = true">帮助</button></template>
        <p v-if="error" class="ext-notice is-error" role="alert">{{ error }}</p>
        <p v-if="notice" class="ext-notice" role="status">{{ notice }}</p>
        <div class="ext-workspace">
            <section class="ext-card ext-stack">
                <div class="ext-row ext-between"><h2>视频来源</h2><span class="ext-badge" :class="{ 'is-ready': config?.ready }" data-test="video-engine-status">{{ config?.ready ? (config.ytDlpSource === 'bundled' ? '内置下载引擎已就绪' : '已找到 yt-dlp') : '组件未就绪' }}</span></div>
                <form class="ext-stack" @submit.prevent="analyze">
                    <label class="ext-field">视频网页链接<input v-model.trim="url" data-test="video-url" type="url" maxlength="2048" placeholder="https://…" required :disabled="!!busy" /></label>
                    <div class="ext-actions"><button class="btn btn-primary" data-test="video-analyze" :disabled="!!busy || !url || !config?.ready">{{ busy === 'analyze' ? '正在分析…' : '分析视频' }}</button><button v-if="busy" class="btn" type="button" data-test="video-stop" @click="stop">取消</button></div>
                </form>
                <p v-if="!config?.ready" class="ext-hint">下载引擎缺失，请使用完整工具箱，或在组件设置中选择已有 yt-dlp。</p>
                <p v-else-if="config.ytDlpSource === 'bundled'" class="ext-hint" data-test="video-bundled-hint">下载引擎已内置，直接粘贴视频链接即可使用。{{ config.ffmpegReady ? '支持音视频合并与 MP3 提取。' : '音视频合并与 MP3 提取组件尚未就绪。' }}</p>
                <div v-if="info" class="ext-stack ext-divider" data-test="video-info">
                    <h3>{{ info.title }}</h3><p class="ext-hint">{{ info.uploader || '作者未提供' }}<template v-if="info.duration !== null"> · {{ Math.round(info.duration) }} 秒</template></p>
                    <label class="ext-field">下载格式<select v-model="choice" data-test="video-choice" :disabled="!!busy"><option v-for="item in info.choices" :key="item.id" :value="item.id">{{ item.label }}</option></select></label>
                    <p v-if="!info.ffmpegReady" class="ext-hint">尚未找到 ffmpeg，仅提供包含音轨的单文件格式；MP3 和高清音视频合并需配置 ffmpeg。</p>
                    <button class="btn btn-primary" data-test="video-download" :disabled="!!busy || !choice" @click="download">{{ busy === 'download' ? '正在下载 / 处理…' : '开始下载' }}</button>
                </div>
            </section>
            <section class="ext-card ext-stack ext-main">
                <h2>下载状态</h2>
                <div v-if="busy === 'download'" class="ext-stack" aria-live="polite" data-test="video-progress">
                    <p>正在下载，完成后可能需要合并或转换。</p>
                    <progress v-if="progress?.total" :value="progress.downloaded || 0" :max="progress.total" aria-label="当前媒体流下载进度" /><progress v-else aria-label="正在下载或处理" />
                    <p class="ext-hint" v-if="progress">当前媒体流 {{ bytes(progress.downloaded) }}<template v-if="progress.total"> / {{ bytes(progress.total) }}</template><template v-if="progress.speed"> · {{ bytes(progress.speed) }}/秒</template></p>
                    <p class="ext-hint">百分比属于当前媒体流，不能代表合并或整项任务完成。</p>
                </div>
                <div v-else-if="result" class="ext-stack ext-result" data-test="video-result">
                    <span class="ext-badge is-ready">下载完成</span><h3>{{ result.name }}</h3><p>{{ bytes(result.size) }}</p>
                    <div class="ext-actions"><a class="btn btn-primary" :href="result.downloadUrl" data-test="video-save" download>保存到电脑</a><button class="btn" data-test="video-remove" :disabled="!!busy" @click="remove">清理临时结果</button></div>
                    <p class="ext-hint">临时文件保留十分钟，离开本页时清理。请及时保存到电脑。</p>
                </div>
                <div v-else class="ext-empty">分析视频并选择下载格式，结果会显示在这里。</div>
                <p class="ext-hint ext-divider">单项最多 1 GiB / 15 分钟，不读取浏览器 Cookie；网站登录、地区限制或组件版本可能影响下载。</p>
            </section>
        </div>
        <template #footer>下载适配采用 <a href="https://github.com/pablostanley/yoinks" target="_blank" rel="noopener noreferrer">Yoinks</a> 的 yt-dlp 核心方案，网页界面由工具箱提供。仅下载你有权保存的内容。</template>
        <IntegrationDialog v-if="settings" title="Yoinks 组件设置" @close="closeSettings">
            <p class="ext-hint">默认使用工具箱内置下载组件，无需另外安装 Yoinks。路径留空会优先使用内置组件，再检测服务器上的 PATH 和已有 Yoinks 组件；也可指定其他已安装版本。网页不会自行下载或更新组件。</p>
            <form class="ext-stack" @submit.prevent="saveSettings">
                <label class="ext-field">yt-dlp 可执行文件<input v-model.trim="ytDlpPath" data-test="video-ytdlp" placeholder="C:\…\yt-dlp.exe" :disabled="!!busy" /></label>
                <label class="ext-field">ffmpeg 可执行文件（可选）<input v-model.trim="ffmpegPath" data-test="video-ffmpeg" placeholder="C:\…\ffmpeg.exe" :disabled="!!busy" /></label>
                <p class="ext-hint ext-wrap">检测到 yt-dlp：{{ config?.ytDlpPath || '未找到' }}<br />检测到 ffmpeg：{{ config?.ffmpegPath || '未找到' }}</p>
                <p v-if="error" class="ext-notice is-error" role="alert">{{ error }}</p>
                <div class="ext-actions"><button class="btn btn-primary" data-test="video-settings-save" :disabled="!!busy">{{ busy === 'save' ? '正在检测…' : '检测并保存' }}</button><button class="btn" type="button" data-test="video-settings-bundled" :disabled="!!busy" @click="restoreComponents">使用内置组件</button></div>
            </form>
            <div class="ext-actions"><a href="https://github.com/yt-dlp/yt-dlp/releases" target="_blank" rel="noopener noreferrer">下载 yt-dlp</a><a href="https://ffmpeg.org/download.html" target="_blank" rel="noopener noreferrer">获取 ffmpeg</a></div>
        </IntegrationDialog>
        <IntegrationDialog v-if="help" title="视频下载帮助" @close="help = false"><p>Windows 完整工具箱内置下载引擎。粘贴单个公开视频网页链接并分析，选择清晰度或 MP3，下载完成后点击“保存到电脑”。</p><p>组件设置可以指定其他已安装版本；点击“使用内置组件”会清除手动路径覆盖并重新检测。网页不会启动 Yoinks 的终端界面。高清格式可能需要合并，进度重新开始通常表示切换了媒体流。</p><p>取消或离页会停止当前下载并清理临时文件。分析结果五分钟后过期；失败时检查链接、组件版本、网络与网站限制，再重新分析。</p></IntegrationDialog>
    </IntegrationLayout>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue';
import IntegrationLayout from '../components/IntegrationLayout.vue';
import IntegrationDialog from '../components/IntegrationDialog.vue';
import { integrationApi as api, operationMessage } from '../api/integration-client.js';
const config = ref(null), settings = ref(false), help = ref(false), url = ref(''), info = ref(null), choice = ref(''), progress = ref(null), result = ref(null);
const ytDlpPath = ref(''), ffmpegPath = ref(''), busy = ref(''), error = ref(''), notice = ref('');
let active = null, disposed = false;
function bytes(value) { if (!Number.isFinite(value)) return '大小未知'; return value >= 1024 * 1024 ? `${(value / 1024 / 1024).toFixed(1)} MiB` : `${(value / 1024).toFixed(1)} KiB`; }
async function run(kind, work) {
    if (busy.value) return;
    const controller = new AbortController(); active = controller; busy.value = kind; error.value = ''; notice.value = '';
    try { await work(controller.signal); }
    catch (e) { if (!disposed) error.value = operationMessage(e, controller.signal); }
    finally { if (active === controller) { active = null; busy.value = ''; } }
}
onMounted(() => run('load', async signal => { config.value = await api.videoConfig(signal); ytDlpPath.value = config.value.configuredYtDlpPath; ffmpegPath.value = config.value.configuredFfmpegPath; }));
function stop() { active?.abort(); }
function closeSettings() { if (busy.value === 'save') stop(); settings.value = false; }
async function saveSettings() { await run('save', async signal => { config.value = await api.saveVideoConfig({ ytDlpPath: ytDlpPath.value, ffmpegPath: ffmpegPath.value }, signal); info.value = null; notice.value = config.value.ready ? '组件路径已检测并保存' : '设置已保存，尚未找到 yt-dlp'; settings.value = false; }); }
async function restoreComponents() { await run('save', async signal => { config.value = await api.saveVideoConfig({ ytDlpPath: '', ffmpegPath: '' }, signal); ytDlpPath.value = ''; ffmpegPath.value = ''; info.value = null; choice.value = ''; notice.value = config.value.ytDlpSource === 'bundled' ? '已切换到内置下载组件' : config.value.ready ? '已恢复自动检测，正在使用找到的本机组件' : '已恢复自动检测，但下载组件缺失，请检查完整工具箱或指定已有组件'; settings.value = false; }); }
async function analyze() { await run('analyze', async signal => { info.value = null; choice.value = ''; info.value = await api.analyzeVideo(url.value, signal); choice.value = info.value.choices[0]?.id || ''; }); }
async function download() {
    await run('download', async signal => {
        if (result.value) { await api.removeVideo(result.value.id); result.value = null; }
        progress.value = null;
        result.value = await api.downloadVideo(info.value.id, choice.value, signal, event => { if (event.type === 'progress') progress.value = event; });
    });
}
async function remove() { await run('remove', async () => { await api.removeVideo(result.value.id); result.value = null; notice.value = '临时结果已清理'; }); }
onBeforeUnmount(() => { disposed = true; stop(); if (result.value) api.removeVideo(result.value.id, true).catch(() => {}); });
</script>
