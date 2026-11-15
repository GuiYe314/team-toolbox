<template>
    <main class="album-mobile">
        <div class="album-mobile-content">
            <header class="album-header"><div><h1>上传手机相册</h1><p class="album-muted">把选中的照片和视频传到电脑资源库</p></div><ThemeToggle /></header>
            <section class="album-card">
                <p v-if="loading" class="album-muted" role="status">正在连接接收端…</p>
                <p v-if="error" class="notice notice-error" role="alert">{{ error }}</p>
                <template v-if="session">
                    <h2>{{ session.folderName }}</h2>
                    <p class="album-muted">{{ session.accepting ? '电脑正在接收' : '电脑已停止接收或链接已到期' }} · 本次已收到 {{ session.count }} 项</p>
                    <label class="album-picker album-field" for="album-files">从相册选择照片或视频
                        <input id="album-files" type="file" :accept="accept" multiple :disabled="running || !session.accepting" @change="addFiles" />
                    </label>
                    <p class="album-muted">可多选，每批最多200项、单个1GiB、会话累计8GiB。请选择照片或视频后点击上传。</p>
                </template>
                <div class="album-actions">
                    <button id="album-upload" class="btn btn-primary" :disabled="running || loading || !session?.accepting || !pendingCount" @click="run">{{ hasAttempt ? '重试未完成项' : '开始上传' }}<span v-if="pendingCount">（{{ pendingCount }}）</span></button>
                    <button v-if="running" id="album-cancel" class="btn" @click="pause">停止上传</button>
                    <button v-else class="btn" :disabled="loading || !credentials" @click="load">刷新接收状态</button>
                </div>
                <p class="album-summary" aria-live="polite" role="status">已选 {{ items.length }} 项 · {{ size(selectedBytes) }} · 成功 {{ successCount }} · 未完成 {{ items.length - successCount }}<span v-if="running"> · 上传中，请保持页面在前台</span></p>
            </section>
            <section v-if="items.length" class="album-card">
                <div class="album-header"><h2>上传队列</h2><button class="btn btn-sm" :disabled="running" @click="clearFinished">清除已完成项</button></div>
                <ul class="album-list">
                    <li v-for="item in items" :key="item.id" class="album-item" :data-upload-id="item.id">
                        <div class="album-item-head"><strong>{{ item.file.name }}</strong><span :class="{ 'album-success': item.status === 'success' }">{{ label(item) }}</span></div>
                        <progress v-if="item.status === 'uploading' || item.status === 'saving'" :value="item.loaded" :max="item.file.size" :aria-label="item.file.name + ' 上传进度'"></progress>
                        <p class="album-muted">{{ size(item.file.size) }}<span v-if="item.message"> · {{ item.message }}</span></p>
                        <button v-if="item.status !== 'success'" class="btn btn-sm" :disabled="running" @click="remove(item)">移除</button>
                    </li>
                </ul>
            </section>
            <section class="album-card album-help"><h2>上传说明</h2><p>只传你主动选择的文件，不会读取其他相册内容。文件不额外压缩，按手机浏览器提供的内容保存；部分手机会将照片转换格式后交给网页。</p><p>100%表示文件已传送，显示“已入库”才是保存成功。同名文件保存为独立资源。HEIC/MOV可能不能直接预览，可在电脑下载原件。</p><p>请保持手机与电脑在同一局域网。切到后台、锁屏或离开页面会停止当前队列；回到前台后点击重试，会先核对已成功项。刷新页面会清空本页文件选择，需要重新选择；接收链接30分钟到期。</p></section>
        </div>
    </main>
</template>
<script>
import ThemeToggle from '../components/ThemeToggle.vue';
import { albumApi } from '../api/phone-album-client.js';
import { ALBUM_ACCEPT, albumFileError, albumFileId, albumSize, parseAlbumLink } from '../utils/phone-album.js';
export default {
    name: 'PhoneAlbumUpload', components: { ThemeToggle },
    data: () => ({ credentials: null, session: null, items: [], accept: ALBUM_ACCEPT, error: '', loading: false, running: false, hasAttempt: false }),
    computed: {
        pendingCount() { return this.items.filter(item => item.status !== 'success' && !item.validation).length; },
        successCount() { return this.items.filter(item => item.status === 'success').length; },
        selectedBytes() { return this.items.reduce((total, item) => total + item.file.size, 0); }
    },
    watch: { '$route.hash'() { this.pause(); this.items = []; this.session = null; this.credentials = parseAlbumLink(this.$route.hash); this.load(); } },
    mounted() {
        this.credentials = parseAlbumLink(this.$route.hash); this.load();
        this._visibility = () => { if (document.hidden) this.pause('页面进入后台，已停止；返回后可以重试未完成项'); };
        this._exit = () => this.pause();
        document.addEventListener('visibilitychange', this._visibility); window.addEventListener('pagehide', this._exit);
        this._clock = setInterval(() => { if (this.session?.accepting && this.session.expiresAt <= Date.now()) { this.session.accepting = false; this.pause('接收链接已到期，请让电脑重新生成二维码'); } }, 1000);
    },
    beforeUnmount() {
        this._disposed = true; this.pause(); this._loadController?.abort(); clearInterval(this._clock);
        document.removeEventListener('visibilitychange', this._visibility); window.removeEventListener('pagehide', this._exit);
    },
    methods: {
        size: albumSize,
        label(item) { return ({ waiting: '等待上传', uploading: `上传 ${Math.floor(item.loaded / item.file.size * 100)}%`, saving: '保存中…', success: '已入库', failed: '未完成' })[item.status]; },
        async load() {
            if (!this.credentials) { this.error = '上传链接无效，请扫描电脑生成的上传二维码'; return; }
            this._loadController?.abort(); const controller = this._loadController = new AbortController();
            const credentials = this.credentials; this.loading = true; this.error = '';
            try {
                const session = await albumApi.status(credentials, false, controller.signal);
                if (!this._disposed && !controller.signal.aborted && this.credentials === credentials) { this.session = session; this.reconcile(session); }
            } catch (error) { if (!this._disposed && this._loadController === controller && this.credentials === credentials && error.name !== 'AbortError') { this.error = error.message || '连接失败，请检查Wi-Fi后重试'; if (error.status === 410 && this.session) this.session.accepting = false; } }
            finally { if (!this._disposed && this._loadController === controller && this.credentials === credentials) this.loading = false; }
        },
        reconcile(session) {
            for (const item of this.items) {
                if (session.items.some(saved => saved.id === item.id && saved.status === 'success')) { item.status = 'success'; item.loaded = item.file.size; item.message = ''; }
            }
        },
        addFiles(event) {
            const files = [...event.target.files]; event.target.value = ''; this.error = '';
            const unique = files.filter(file => !this.items.some(item => item.file.name === file.name && item.file.size === file.size && item.file.lastModified === file.lastModified));
            if (this.items.length + unique.length > this.session.limits.files) { this.error = '每批最多选择200个文件，请分批上传'; return; }
            if (this.selectedBytes + unique.reduce((total, file) => total + file.size, 0) > this.session.limits.totalBytes) { this.error = '所选文件总计超过8GiB，请分批上传'; return; }
            for (const file of unique) {
                const validation = albumFileError(file, this.session.limits);
                this.items.push({ id: albumFileId(), file, loaded: 0, status: validation ? 'failed' : 'waiting', message: validation, validation });
            }
        },
        async run() {
            if (this.running || this.loading || !this.pendingCount || !this.session?.accepting) return;
            this._loadController?.abort();
            this.running = true; this.hasAttempt = true; this.error = ''; this._runController = new AbortController();
            const signal = this._runController.signal, credentials = this.credentials;
            try {
                const snapshot = await albumApi.status(credentials, false, signal);
                if (signal.aborted || this._disposed || this.credentials !== credentials) return;
                this.session = snapshot; this.reconcile(snapshot);
                if (!snapshot.accepting) throw new Error('电脑已停止接收，请重新扫码');
                for (const item of this.items) {
                    if (signal.aborted || this._disposed || document.hidden || this.credentials !== credentials) break;
                    if (item.status === 'success' || item.validation) continue;
                    item.status = 'uploading'; item.message = ''; item.loaded = 0;
                    try {
                        await albumApi.upload(credentials, item, signal, loaded => { if (!signal.aborted) { item.loaded = loaded; if (loaded === item.file.size) item.status = 'saving'; } });
                        if (signal.aborted || this._disposed || this.credentials !== credentials) break;
                        item.status = 'success'; item.loaded = item.file.size;
                    } catch (error) {
                        if (this._disposed || this.credentials !== credentials) break;
                        item.status = 'failed'; item.message = error.message || '文件未完成，请重试';
                        if (error.status === 410) { this.session.accepting = false; this.error = error.message; break; }
                        if (signal.aborted) break;
                    }
                }
                if (!signal.aborted && !this._disposed && this.credentials === credentials) {
                    try {
                        const updated = await albumApi.status(credentials, false, signal);
                        if (!signal.aborted && !this._disposed && this.credentials === credentials) { this.session = updated; this.reconcile(updated); }
                    } catch { /* 单项结果保留；刷新状态可重试。 */ }
                }
            } catch (error) { if (!this._disposed && !signal.aborted && this.credentials === credentials) { this.error = error.message || '无法连接接收端'; if (error.status === 410 && this.session) this.session.accepting = false; } }
            finally { if (!this._disposed) this.running = false; }
        },
        pause(message) {
            this._runController?.abort();
            for (const item of this.items) if (['uploading', 'saving'].includes(item.status)) { item.status = 'failed'; item.message = '已停止，重试时会核对是否已保存'; }
            if (message && this.running) this.error = message;
        },
        remove(item) { this.items = this.items.filter(value => value.id !== item.id); },
        clearFinished() { this.items = this.items.filter(item => item.status !== 'success'); }
    }
};
</script>
