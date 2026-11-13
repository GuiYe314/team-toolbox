<template>
    <IntegrationLayout title="视频下载" subtitle="统一链接解析 · 自动尝试多个解析方案，能解析就用，不行就换下一个" tool-id="yoinks">
        <template #actions><button class="btn" data-test="video-settings" @click="settings = true">组件设置</button><button class="btn" @click="help = true">帮助</button></template>
        <p v-if="error" class="ext-notice is-error" role="alert">{{ error }}</p>
        <p v-if="notice" class="ext-notice" role="status">{{ notice }}</p>
        <div class="ext-workspace">
            <section v-if="preview" class="ext-card ext-stack preview-card" data-test="video-preview-panel">
                <div class="ext-row ext-between">
                    <h2 class="preview-heading">{{ preview.title }}<span class="task-choice"> · {{ preview.choiceLabel }}</span></h2>
                    <div class="ext-actions">
                        <button class="btn" type="button" data-test="video-preview-download" :disabled="busy === 'download'" @click="download">下载这个清晰度</button>
                        <button class="btn" type="button" data-test="video-preview-close" @click="closePreview">关闭预览</button>
                    </div>
                </div>
                <!-- 播放器直接读后端的实时转封装流：不落盘，也不占用下载队列。 -->
                <video class="preview-player" :src="preview.url" controls autoplay playsinline preload="auto" data-test="video-preview-player" @error="previewError = '浏览器无法直接播放这个视频（常见于 HEVC / AV1 编码或网络中断）。可以加入下载队列，完成后用本地播放器观看。'"></video>
                <p v-if="previewError" class="ext-hint is-error" data-test="video-preview-error">{{ previewError }}</p>
                <p class="ext-hint">预览由 ffmpeg 实时转封装，边拉边播、不写磁盘；可以边看边下载，两者互不影响。实时流不支持随意拖动进度条，想从中间看请先下载。关掉预览或离开页面会立即停止拉流。</p>
            </section>
            <section class="ext-card ext-stack">
                <div class="ext-row ext-between"><h2>视频来源</h2><span class="ext-badge" :class="{ 'is-ready': config?.ready }" data-test="video-engine-status">{{ config?.ready ? (config.ytDlpSource === 'bundled' ? '内置下载引擎已就绪' : '已找到 yt-dlp') : '组件未就绪' }}</span></div>
                <form class="ext-stack" @submit.prevent="analyze">
                    <label class="ext-field">视频链接（网页地址、直链或 m3u8）<input v-model.trim="url" data-test="video-url" type="url" maxlength="2048" placeholder="https://…" required :disabled="busy === 'analyze'" /></label>
                    <div class="ext-actions"><button class="btn btn-primary" data-test="video-analyze" :disabled="busy === 'analyze' || !url || !config?.ready">{{ busy === 'analyze' ? '正在解析…' : '解析链接' }}</button><button v-if="busy === 'analyze'" class="btn" type="button" data-test="video-stop" @click="stop">取消</button></div>
                </form>
                <p v-if="!config?.ready" class="ext-hint">下载引擎缺失，请使用完整工具箱，或在组件设置中选择已有 yt-dlp。</p>
                <p v-else-if="config.ytDlpSource === 'bundled'" class="ext-hint" data-test="video-bundled-hint">下载引擎已内置，直接粘贴视频链接即可使用。{{ config.ffmpegReady ? '支持音视频合并与 MP3 提取。' : '音视频合并与 MP3 提取组件尚未就绪。' }}</p>
                <p v-if="config" class="ext-hint" data-test="video-proxy-status">{{ proxyStatus }}</p>

                <div class="ext-stack ext-divider" data-test="video-resolvers">
                    <div class="ext-row ext-between"><h2>解析方案</h2><span class="ext-hint">按顺序自动降级</span></div>
                    <label class="ext-field">指定方案（可选）<select v-model="forcedResolver" data-test="video-resolver" :disabled="busy === 'analyze'"><option value="">自动 · 依次尝试全部方案</option><option v-for="item in resolvers" :key="item.id" :value="item.id">{{ item.name }} · 优先级 {{ item.priority }}</option></select></label>
                    <ul v-if="attempts.length" class="resolver-log" data-test="video-attempts">
                        <li v-for="(item, index) in attempts" :key="item.id + '-' + index" class="resolver-item" :class="'is-' + item.status">
                            <span class="resolver-dot"></span><span class="resolver-name">{{ item.name }}</span>
                            <span class="resolver-status">{{ statusText(item) }}</span><span class="resolver-msg">{{ item.message }}</span>
                            <span v-if="item.ms" class="resolver-ms">{{ item.ms }} ms</span>
                        </li>
                    </ul>
                    <p v-else class="ext-hint">{{ resolvers.length ? `已注册 ${resolvers.length} 个方案：${resolvers.map(item => item.name).join(' → ')}` : '正在读取解析方案…' }}</p>
                </div>

                <div v-if="info" class="ext-stack ext-divider" data-test="video-info">
                    <h3>{{ info.title }}</h3><p class="ext-hint">{{ info.uploader || '作者未提供' }}<template v-if="info.duration !== null"> · {{ Math.round(info.duration) }} 秒</template><template v-if="info.resolvedBy"> · 由「{{ info.resolvedBy.name }}」解析成功</template></p>
                    <label class="ext-field">清晰度 / 格式<select v-model="choice" data-test="video-choice" :disabled="busy === 'download'"><option v-for="item in info.choices" :key="item.id" :value="item.id">{{ item.label }}</option></select></label>
                    <p class="ext-hint" data-test="video-quality-hint">{{ qualityHint }}</p>
                    <p v-if="!info.ffmpegReady" class="ext-hint">尚未找到 ffmpeg，仅提供包含音轨的单文件格式；MP3 和高清音视频合并需配置 ffmpeg。</p>
                    <div class="ext-actions">
                        <button class="btn btn-primary" data-test="video-download" :disabled="busy === 'download' || !choice" @click="download">{{ busy === 'download' ? '正在加入…' : '加入下载队列' }}</button>
                        <button class="btn" type="button" data-test="video-preview" :disabled="!choice || previewBusy || !info.ffmpegReady" @click="startPreview">{{ previewBusy ? '正在准备播放…' : '先看看（边下边看）' }}</button>
                    </div>
                    <p v-if="!info.ffmpegReady" class="ext-hint">实时预览需要 ffmpeg：装好后重新解析即可边下边看。</p>
                </div>
            </section>
            <section class="ext-card ext-stack ext-main">
                <div class="ext-row ext-between"><h2>下载任务</h2><span class="ext-hint" data-test="video-parallel">同时下载 {{ meta?.parallel || 3 }} 个 · 排队不限</span></div>
                <p class="ext-hint ext-wrap" data-test="video-save-dir">保存到 {{ meta?.downloadDir || '系统「下载」文件夹' }}<button class="btn btn-link" type="button" data-test="video-change-dir" @click="settings = true">更改</button></p>
                <div v-if="tasks.length" class="task-list" data-test="video-tasks">
                    <article v-for="task in tasks" :key="task.id" class="task-item" :class="'is-' + task.state" :data-test="'video-task-' + task.state">
                        <div class="task-head">
                            <span class="task-badge" :class="'is-' + task.state">{{ stateText[task.state] || task.state }}</span>
                            <h3 class="task-title" :title="task.title">{{ task.title }}</h3>
                            <span class="task-choice">{{ task.choiceLabel }}</span>
                        </div>
                        <div v-if="task.state === 'running'" class="ext-stack" aria-live="polite" data-test="video-progress">
                            <progress v-if="task.progress?.total" :value="task.progress.downloaded || 0" :max="task.progress.total" aria-label="当前媒体流下载进度" /><progress v-else aria-label="正在下载或处理" />
                            <p class="ext-hint" v-if="task.progress">当前媒体流 {{ bytes(task.progress.downloaded) }}<template v-if="task.progress.total"> / {{ bytes(task.progress.total) }}</template><template v-if="task.progress.speed"> · {{ bytes(task.progress.speed) }}/秒</template><template v-if="task.progress.eta"> · 剩余 {{ seconds(task.progress.eta) }}</template></p>
                            <p class="ext-hint" v-if="task.resumed">已从断点继续，之前下载的 {{ bytes(task.resumed) }} 被复用。</p>
                            <p class="ext-hint">百分比属于当前媒体流，不能代表合并或整项任务完成。</p>
                        </div>
                        <p v-else-if="task.state === 'queued'" class="ext-hint">前面的任务下载完会自动开始。</p>
                        <div v-else-if="task.state === 'done'" class="ext-stack" data-test="video-result">
                            <p class="ext-hint" v-if="task.result?.saved">已保存到 {{ task.result.savedTo }}（{{ bytes(task.result.size) }}）</p>
                            <p class="ext-hint" v-else>下载完成，但自动保存失败：{{ task.result?.saveError }}；可先「保存到电脑」。</p>
                        </div>
                        <p v-else-if="task.error" class="ext-hint is-error">{{ task.error.message }}</p>
                        <div class="ext-actions task-actions">
                            <button v-if="task.state === 'running' || task.state === 'queued'" class="btn" type="button" data-test="video-stop" @click="act(() => api.cancelVideoTask(task.id))">取消</button>
                            <button v-if="task.state === 'failed' || task.state === 'cancelled'" class="btn" type="button" data-test="video-retry" @click="act(() => api.retryVideoTask(task.id))">继续 / 重试</button>
                            <button v-if="task.state === 'done' && task.result?.saved" class="btn" type="button" data-test="video-reveal" @click="act(() => api.revealVideoTask(task.id))">打开文件夹</button>
                            <a v-if="task.state === 'done' && task.result && !task.result.saved" class="btn btn-primary" :href="task.result.downloadUrl" data-test="video-save" download>保存到电脑</a>
                            <button class="btn" type="button" data-test="video-remove" @click="act(() => api.removeVideoTask(task.id), '任务已移除')">移除</button>
                        </div>
                    </article>
                </div>
                <div v-else class="ext-empty">解析链接并选择下载格式，任务会出现在这里。可以同时添加多个。</div>
                <p class="ext-hint ext-divider">不限制文件大小和总时长；关掉页面下载也会继续。断网或暂停后重新下载同一链接会从断点续传。缓存 {{ bytes(meta?.cache?.bytes || 0) }}<button v-if="meta?.cache?.count" class="btn btn-link" type="button" data-test="video-clear-cache" @click="act(() => api.clearVideoCache(), '未完成的缓存已清理')">清理</button></p>
            </section>
        </div>
        <template #footer>下载适配采用 <a href="https://github.com/pablostanley/yoinks" target="_blank" rel="noopener noreferrer">Yoinks</a> 的 yt-dlp 核心方案，网页界面由工具箱提供。仅下载你有权保存的内容。</template>
        <IntegrationDialog v-if="settings" title="下载组件设置" @close="closeSettings">
            <p class="ext-hint">默认使用工具箱内置下载组件，无需另外安装 Yoinks。路径留空会优先使用内置组件，再检测服务器上的 PATH 和已有 Yoinks 组件；也可指定其他已安装版本。网页不会自行下载或更新组件。</p>
            <form class="ext-stack" @submit.prevent="saveSettings">
                <label class="ext-field">yt-dlp 可执行文件<input v-model.trim="ytDlpPath" data-test="video-ytdlp" placeholder="C:\…\yt-dlp.exe" @input="formTouched = true" :disabled="busy === 'save'" /></label>
                <label class="ext-field">ffmpeg 可执行文件（可选）<input v-model.trim="ffmpegPath" data-test="video-ffmpeg" placeholder="C:\…\ffmpeg.exe" @input="formTouched = true" :disabled="busy === 'save'" /></label>
                <label class="ext-field">下载保存目录<input v-model.trim="downloadDir" data-test="video-download-dir" placeholder="留空使用系统「下载」文件夹，例如 D:\视频" @input="formTouched = true" :disabled="busy === 'save'" /></label>
                <p class="ext-hint ext-wrap">下载完成后自动放进这个目录，文件名取自视频标题；重名会自动加序号。目录不存在会自动创建。</p>
                <label class="ext-field">网络代理（可选）<input v-model.trim="proxy" data-test="video-proxy" placeholder="http://127.0.0.1:7897" list="video-proxy-options" @input="formTouched = true" :disabled="busy === 'save'" /><datalist id="video-proxy-options"><option v-if="config?.detectedProxy" :value="config.detectedProxy"></option></datalist></label>
                <p class="ext-hint ext-wrap">代理用于抓取网页和 yt-dlp 下载。留空时自动使用 Windows 系统代理（读不到或端口未监听时退回环境变量）；填 <code>http://…</code> 或 <code>socks5://…</code>。下载引擎与 ffmpeg 读取本机文件，不需要代理。</p>
                <p class="ext-hint ext-wrap">检测到 yt-dlp：{{ config?.ytDlpPath || '未找到' }}<br />检测到 ffmpeg：{{ config?.ffmpegPath || '未找到' }}<br />{{ proxyStatus }}</p>
                <p v-if="config?.staleYtDlpPath" class="ext-notice">设置里保存的 yt-dlp 路径已失效，已自动改用找到的组件。</p>
                <p v-if="config?.staleFfmpegPath" class="ext-notice">设置里保存的 ffmpeg 路径已失效，已自动改用找到的组件。</p>
                <p v-if="error" class="ext-notice is-error" role="alert">{{ error }}</p>
                <div class="ext-actions"><button class="btn btn-primary" data-test="video-settings-save" :disabled="busy === 'save'">{{ busy === 'save' ? '正在检测…' : '检测并保存' }}</button><button class="btn" type="button" data-test="video-settings-bundled" :disabled="busy === 'save'" @click="restoreComponents">使用内置组件</button></div>
            </form>
            <div class="ext-actions"><a href="https://github.com/yt-dlp/yt-dlp/releases" target="_blank" rel="noopener noreferrer">下载 yt-dlp</a><a href="https://ffmpeg.org/download.html" target="_blank" rel="noopener noreferrer">获取 ffmpeg</a></div>
        </IntegrationDialog>
        <IntegrationDialog v-if="help" title="视频下载帮助" @close="help = false"><p>粘贴一个链接即可，工具箱会按优先级依次尝试所有解析方案：某个方案解析不了就自动换下一个，成功后显示用的哪个方案。也可以指定只用某一个方案重试。</p><p>内置直链媒体、bad.news 页面、yt-dlp 通用解析、网页媒体提取、yt-dlp 通用页面五个方案。没有专用提取器的站点（例如 bad.news）会直接读取网页里的视频地址：单个 MP4 给「原始清晰度」，m3u8 主清单会展开成多个清晰度；解析出的地址下载时会自动带上页面的 Referer。还可以在 <code>data/video-resolvers.json</code> 配置自己的 HTTP 解析服务，数量不限，格式见 docs/video-resolvers.md。</p><p>解析成功后可以点「先看看（边下边看）」：由 ffmpeg 把远端流实时转封装成浏览器能边读边播的格式，几秒内出画面，不写磁盘也不占用下载队列，可以边看边下载。实时流不支持随意拖动进度条；HEVC / AV1 编码浏览器可能无法直接播放，这类请下载后用本地播放器观看。</p><p>下载任务同时跑三个，其余自动排队；关掉页面任务也会继续，回到本页能看到进度和结果。下载完成自动存进设置里的保存目录（默认系统「下载」文件夹）。中断、断网或取消后，重新下载同一链接会从断点续传；不超过五分钟没有任何进展才会暂停。缓存可以在任务区一键清理。</p><p>Windows 完整工具箱内置下载引擎。组件设置可指定其他已安装版本；点击“使用内置组件”会清除手动路径覆盖。分析结果五分钟后过期；失败时检查链接、组件版本、网络与网站限制，再重新解析。</p></IntegrationDialog>
    </IntegrationLayout>
</template>

<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue';
import IntegrationLayout from '../components/IntegrationLayout.vue';
import IntegrationDialog from '../components/IntegrationDialog.vue';
import { integrationApi as api, operationMessage } from '../api/integration-client.js';
const config = ref(null), settings = ref(false), help = ref(false), url = ref(''), info = ref(null), choice = ref('');
const resolvers = ref([]), attempts = ref([]), forcedResolver = ref('');
const tasks = ref([]), meta = ref(null);
const ytDlpPath = ref(''), ffmpegPath = ref(''), downloadDir = ref(''), proxy = ref('');
const formTouched = ref(false);
const busy = ref(''), error = ref(''), notice = ref('');
const preview = ref(null), previewBusy = ref(false), previewError = ref('');
const stateText = { queued: '排队中', running: '下载中', done: '已完成', failed: '失败', cancelled: '已暂停' };
let active = null, disposed = false, timer = null, loading = false, loadingConfig = null;
const PROXY_SOURCE = { configured: '手动设置', env: '环境变量', system: 'Windows 系统代理' };
const proxyStatus = computed(() => {
    const value = config.value;
    if (!value) return '';
    if (!value.proxy) return '网络代理：未使用。站点在浏览器能打开、这里却解析失败时，通常是代理没生效。';
    return `网络代理：${value.proxy}（${PROXY_SOURCE[value.proxySource] || '自动检测'}）`;
});
const running = computed(() => tasks.value.some(task => task.state === 'queued' || task.state === 'running'));
function bytes(value) { if (!Number.isFinite(value)) return '大小未知'; return value >= 1024 * 1024 ? `${(value / 1024 / 1024).toFixed(1)} MiB` : `${(value / 1024).toFixed(1)} KiB`; }
function seconds(value) { if (!Number.isFinite(value)) return ''; const total = Math.round(value); return total >= 3600 ? `${Math.floor(total / 3600)} 小时 ${Math.round(total % 3600 / 60)} 分` : `${Math.floor(total / 60)} 分 ${total % 60} 秒`; }
const qualityHint = computed(() => {
    const choices = info.value?.choices || [];
    const video = choices.filter(item => !/mp3|audio/i.test(item.id));
    if (!choices.length) return '';
    if (video.length > 1) return `共 ${video.length} 个清晰度可选；清晰度越高文件越大，选好后按该清晰度下载并合并为 MP4。`;
    if (!video.length) return '该来源只提供音频格式。';
    return `该来源只提供一个清晰度${choices.length > video.length ? '，也可以只保存音频 MP3' : ''}。`;
});
function statusText(item) { return item.status === 'ok' ? '成功' : item.status === 'skipped' ? '跳过' : '失败'; }
async function run(kind, work) {
    // 首屏配置还没读完就先等一下：否则用户刚填的路径会被随后到达的配置覆盖，甚至把空值存进去。
    if (loadingConfig) await loadingConfig;
    if (busy.value) { notice.value = '上一个操作还在进行，请稍候再试'; return; }
    const controller = new AbortController(); active = controller; busy.value = kind; error.value = ''; notice.value = '';
    try { await work(controller.signal); }
    catch (e) { if (!disposed) error.value = operationMessage(e, controller.signal); }
    finally { if (active === controller) { active = null; busy.value = ''; } }
}
function syncForm(value) {
    // 用户已经动过输入框时不再回填，避免把刚输入的内容冲掉。
    if (formTouched.value) return;
    ytDlpPath.value = value.configuredYtDlpPath; ffmpegPath.value = value.configuredFfmpegPath;
    downloadDir.value = value.configuredDownloadDir || ''; proxy.value = value.configuredProxy || '';
}
function loadConfig() {
    loadingConfig = (async () => {
        try { config.value = await api.videoConfig(); if (!disposed) syncForm(config.value); }
        catch (e) { if (!disposed) error.value = operationMessage(e); }
        finally { loadingConfig = null; }
    })();
    return loadingConfig;
}
async function refresh() {
    if (disposed || loading) return;
    loading = true;
    try {
        const data = await api.videoTasks();
        if (disposed) return;
        tasks.value = Array.isArray(data?.tasks) ? data.tasks : [];
        meta.value = data;
    } catch { /* 轮询失败保持上一次结果 */ }
    finally {
        loading = false;
        if (disposed) return;
        if (running.value) startPolling(); else stopPolling();
    }
}
function startPolling() { if (!timer && !disposed) timer = setInterval(refresh, 1200); }
function stopPolling() { if (timer) { clearInterval(timer); timer = null; } }
async function act(work, message = '') {
    error.value = '';
    try { await work(); if (message && !disposed) notice.value = message; }
    catch (e) { if (!disposed) error.value = operationMessage(e); }
    await refresh();
}
onMounted(async () => {
    loadConfig();
    api.videoResolvers().then(data => { if (!disposed) resolvers.value = Array.isArray(data?.resolvers) ? data.resolvers : []; }).catch(() => {});
    await refresh(); if (running.value) startPolling();
});
function stop() { active?.abort(); }
function closeSettings() { if (busy.value === 'save') stop(); settings.value = false; }
async function saveSettings() { await run('save', async signal => {
    config.value = await api.saveVideoConfig({ ytDlpPath: ytDlpPath.value, ffmpegPath: ffmpegPath.value, proxy: proxy.value, downloadDir: downloadDir.value }, signal);
    downloadDir.value = config.value.configuredDownloadDir || '';
    formTouched.value = false;
    notice.value = config.value.ready ? '组件路径、下载目录与代理已保存' : '设置已保存，尚未找到 yt-dlp';
    settings.value = false;
    await refresh();
}); }
async function restoreComponents() { await run('save', async signal => {
    config.value = await api.saveVideoConfig({ ytDlpPath: '', ffmpegPath: '', proxy: proxy.value, downloadDir: downloadDir.value }, signal);
    ytDlpPath.value = ''; ffmpegPath.value = ''; info.value = null; choice.value = '';
    notice.value = config.value.ytDlpSource === 'bundled' ? '已切换到内置下载组件' : config.value.ready ? '已恢复自动检测，正在使用找到的本机组件' : '已恢复自动检测，但下载组件缺失，请检查完整工具箱或指定已有组件';
    settings.value = false;
}); }
async function analyze() { await run('analyze', async signal => {
    info.value = null; choice.value = ''; attempts.value = [];
    closePreview();
    try {
        info.value = await api.analyzeVideo(url.value, signal, forcedResolver.value);
        attempts.value = Array.isArray(info.value.attempts) ? info.value.attempts : [];
        choice.value = info.value.choices[0]?.id || '';
    } catch (e) { if (Array.isArray(e.attempts)) attempts.value = e.attempts; throw e; }
}); }
// 预览走独立的票据请求：解析直链可能耗时几秒，不能和「加入下载队列」抢同一个 busy。
async function startPreview() {
    if (!info.value || !choice.value || previewBusy.value) return;
    previewBusy.value = true; previewError.value = '';
    try {
        const ticket = await api.prepareVideoPreview(info.value.id, choice.value);
        if (!disposed) preview.value = ticket;
    } catch (e) { if (!disposed) error.value = operationMessage(e); }
    finally { previewBusy.value = false; }
}
function closePreview() { preview.value = null; previewError.value = ''; }
// 换清晰度后旧票据对应的不是同一路流，直接关掉，避免播错版本。
watch(choice, () => { if (preview.value) closePreview(); });
async function download() {
    await run('download', async signal => {
        const task = await api.downloadVideo(info.value.id, choice.value, signal);
        notice.value = `「${task.title}」已加入下载队列`;
        await refresh(); startPolling();
    });
}
onBeforeUnmount(() => { disposed = true; stopPolling(); stop(); closePreview(); });
</script>

<style scoped>
.resolver-log { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.resolver-item { display: flex; align-items: center; gap: 9px; font-size: 12px; padding: 7px 11px; border-radius: 9px; background: rgba(127, 127, 127, .12); }
.resolver-dot { width: 7px; height: 7px; border-radius: 50%; flex: 0 0 auto; background: currentColor; opacity: .5; }
.resolver-name { font-weight: 600; min-width: 116px; }
.resolver-status { flex: 0 0 auto; opacity: .85; }
.resolver-msg { opacity: .72; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.resolver-ms { margin-left: auto; flex: 0 0 auto; opacity: .55; }
.is-ok .resolver-dot { background: #2e9e6b; opacity: 1; }
.is-failed .resolver-dot { background: #d2604f; opacity: 1; }
.is-skipped { opacity: .5; }
.task-list { display: flex; flex-direction: column; gap: 10px; }
.task-item { border: 1px solid rgba(127, 127, 127, .2); border-radius: 11px; padding: 11px 13px; display: flex; flex-direction: column; gap: 7px; }
.task-head { display: flex; align-items: center; gap: 9px; }
.task-title { font-size: 14px; font-weight: 600; margin: 0; flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.task-choice { flex: 0 0 auto; font-size: 12px; opacity: .65; }
.task-badge { flex: 0 0 auto; font-size: 11px; padding: 2px 8px; border-radius: 999px; background: rgba(127, 127, 127, .18); }
.task-badge.is-running { background: rgba(46, 158, 107, .18); }
.task-badge.is-done { background: rgba(46, 158, 107, .26); }
.task-badge.is-failed { background: rgba(210, 96, 79, .2); }
.task-actions { flex-wrap: wrap; }
.preview-card { grid-column: 1 / -1; }
.preview-heading { display: flex; align-items: baseline; gap: 6px; flex-wrap: wrap; min-width: 0; }
.preview-player { display: block; width: 100%; max-height: 66vh; border-radius: var(--radius-md); background: #000; }
.ext-hint.is-error { color: #d2604f; }
.btn-link { background: none; border: 0; padding: 0 4px; color: inherit; text-decoration: underline; cursor: pointer; font-size: inherit; }
@media (max-width: 760px) { .resolver-msg { display: none; } }
</style>
