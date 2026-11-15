<template>
    <div class="view-page album-page">
        <header class="album-header">
            <div><h1 class="view-title">手机相册上传</h1><p class="album-muted">手机扫码，多选照片或视频，保存到电脑的工具箱资源库。</p></div>
            <a class="btn" href="/assets" target="_blank" rel="noopener">打开资源库</a>
        </header>
        <p v-if="error" class="notice notice-error" role="alert">{{ error }}<button class="btn btn-sm" :disabled="busy" @click="load">重试读取</button></p>
        <div class="album-columns">
            <section class="album-card">
                <h2>扫码接收</h2>
                <p v-if="!config" class="album-muted">正在读取接收配置…</p>
                <template v-else>
                    <p v-if="!config.allowLan" class="notice" role="status">当前为仅本机模式。请以 Lan 模式重新启动工具箱，手机与电脑连接同一局域网。</p>
                    <p v-else-if="!config.origins.length" class="notice">没有找到可用的私网 IPv4 网卡，请检查电脑网络后重试。</p>
                    <label class="album-field">保存到资源文件夹
                        <select v-model="folderId" class="input adb-select" :disabled="busy || !!session?.accepting"><option :value="null">未分类</option><option v-for="folder in folders" :key="folder.id" :value="folder.id">{{ folderLabel(folder) }}</option></select>
                    </label>
                    <label class="album-field">手机可访问的电脑地址
                        <select v-model="origin" class="input adb-select" :disabled="busy"><option v-for="address in config.origins" :key="address" :value="address">{{ address }}</option></select>
                    </label>
                    <div class="album-actions">
                        <button id="album-create" class="btn btn-primary" :disabled="busy || !origin || !!session?.accepting" @click="create">{{ busy ? '处理中…' : '生成上传二维码' }}</button>
                        <button v-if="session?.accepting" id="album-stop" class="btn" :disabled="busy" @click="stop">停止接收</button>
                    </div>
                    <template v-if="session?.accepting">
                        <div class="album-qr" v-html="qrSvg"></div>
                        <p class="album-muted">使用手机相机或扫码工具打开。剩余 {{ remaining }}，请保持此接收页打开。</p>
                        <div class="album-actions"><button class="btn btn-sm" :disabled="!uploadUrl" @click="copy">复制上传链接</button><span role="status">{{ copyStatus }}</span></div>
                    </template>
                    <p v-else-if="session" class="notice" role="status">接收已停止，二维码已失效。已成功上传的文件仍保留在资源库。</p>
                </template>
                <details class="album-help"><summary>使用帮助</summary><p>每批最多200个文件，每个不超过1GiB，每个接收会话累计8GiB。支持常见照片、HEIC/HEIF和视频；同名创建新资源，不覆盖旧文件。HEIC/MOV可能无法直接预览，可下载原件。</p><p>二维码30分钟有效，可主动停止；离开接收页会停止接收。手机后台或锁屏可能中断传送，返回后重试会核对已成功项。手机和电脑须同网段；无法打开时检查Wi-Fi隔离和工具箱端口，勿填写手机的localhost。</p></details>
            </section>
            <section class="album-card" aria-labelledby="album-received-title">
                <h2 id="album-received-title">接收结果</h2>
                <p v-if="session" class="album-muted">{{ session.folderName }} · 成功 {{ session.count }} 项 · {{ size(session.bytes) }}</p>
                <p v-if="pollError" class="notice notice-error" role="alert">{{ pollError }}（显示上次结果）<button class="btn btn-sm" @click="refresh">重试刷新</button></p>
                <p v-if="!session?.items?.length" class="album-muted">手机选择文件并上传后，结果会显示在这里。</p>
                <ul v-else class="album-list">
                    <li v-for="item in session.items" :key="item.id" class="album-item" :data-received-id="item.id">
                        <div class="album-item-head"><strong>{{ item.name }}</strong><span :class="{ 'album-success': item.status === 'success' }">{{ labels[item.status] }}</span></div>
                        <p class="album-muted">{{ size(item.size) }}<span v-if="item.status === 'receiving'"> · {{ Math.floor(item.received / item.size * 100) }}%</span><span v-if="item.message"> · {{ item.message }}</span></p>
                    </li>
                </ul>
            </section>
        </div>
    </div>
</template>
<script>
import { albumApi } from '../api/phone-album-client.js';
import { assetApi } from '../api/asset-client.js';
import { albumSize, albumUploadUrl } from '../utils/phone-album.js';
import { toQrSvg } from '../assets/qr-share.js';
import { copyText } from '../utils/clipboard.js';
export default {
    name: 'PhoneAlbum',
    data: () => ({ config: null, folders: [], folderId: null, origin: '', session: null, credentials: null, qrSvg: '', busy: false, error: '', pollError: '', copyStatus: '', tick: Date.now(), labels: { receiving: '接收中', saving: '保存中', success: '已入库', failed: '未完成' } }),
    computed: {
        uploadUrl() { return this.credentials && this.origin ? albumUploadUrl(this.origin, this.credentials) : ''; },
        remaining() { const seconds = Math.max(0, Math.ceil(((this.session?.expiresAt || 0) - this.tick) / 1000)); return `${Math.floor(seconds / 60)}分${seconds % 60}秒`; }
    },
    watch: { origin() { this.renderQr(); } },
    mounted() {
        this._controller = new AbortController(); this.load();
        this._visibility = () => { clearTimeout(this._poll); if (document.hidden) this._pollController?.abort(); else this.refresh(); };
        this._exit = () => this.revoke();
        document.addEventListener('visibilitychange', this._visibility); window.addEventListener('pagehide', this._exit);
        this._clock = setInterval(() => { this.tick = Date.now(); if (this.session?.accepting && this.tick >= this.session.expiresAt) { this.session.accepting = false; this.qrSvg = ''; } }, 1000);
    },
    beforeUnmount() {
        this._disposed = true; clearTimeout(this._poll); clearInterval(this._clock); this._controller.abort(); this._pollController?.abort(); this.revoke();
        document.removeEventListener('visibilitychange', this._visibility); window.removeEventListener('pagehide', this._exit);
    },
    methods: {
        size: albumSize,
        folderLabel(folder) {
            const parts = [], visited = new Set();
            while (folder && !visited.has(folder.id)) { visited.add(folder.id); parts.unshift(folder.name); folder = this.folders.find(parent => parent.id === folder.parent_id); }
            return parts.join(' / ');
        },
        async load() {
            this.error = '';
            try {
                const [config, folders] = await Promise.all([albumApi.config(this._controller.signal), assetApi.listFolders()]);
                if (this._disposed) return;
                if (!folders.res.ok) throw new Error(folders.body?.message || '读取资源文件夹失败');
                this.config = config; this.folders = folders.body.items; this.origin = config.origins.includes(window.location.origin) ? window.location.origin : config.origins[0] || '';
                const selected = Number(this.$route.query.folderId); this.folderId = this.folders.some(folder => folder.id === selected) ? selected : null;
            } catch (error) { if (!this._disposed) this.error = error.message || '读取接收配置失败'; }
        },
        async create() {
            this.busy = true; this.error = ''; this.copyStatus = '';
            try {
                const created = await albumApi.create(this.folderId, this._controller.signal);
                if (this._disposed) { albumApi.stop(created, true).catch(() => {}); return; }
                this.credentials = created; this.session = created; await this.renderQr(); this.refresh();
            } catch (error) { if (!this._disposed) this.error = error.message; }
            finally { if (!this._disposed) this.busy = false; }
        },
        async renderQr() {
            const url = this.uploadUrl;
            if (!url || !this.session?.accepting) { this.qrSvg = ''; return; }
            try {
                const colors = getComputedStyle(document.documentElement);
                const svg = await toQrSvg(url, { dark: colors.getPropertyValue('--adb-qr-foreground').trim(), light: colors.getPropertyValue('--adb-qr-background').trim(), width: 280 });
                if (!this._disposed && this.uploadUrl === url && this.session?.accepting) this.qrSvg = svg;
            } catch { if (!this._disposed) this.error = '二维码生成失败，请复制上传链接或重试'; }
        },
        async refresh() {
            clearTimeout(this._poll);
            if (!this.credentials || !this.session?.accepting || document.hidden || this._refreshing || this._disposed) return;
            this._refreshing = true; const id = this.credentials.id; const controller = this._pollController = new AbortController();
            try {
                const snapshot = await albumApi.status(this.credentials, true, controller.signal);
                if (!this._disposed && !controller.signal.aborted && this.credentials?.id === id) { this.session = snapshot; this.pollError = ''; }
            } catch (error) { if (!this._disposed && error.name !== 'AbortError') { this.pollError = error.message; if (error.status === 410) this.session.accepting = false; } }
            finally { this._refreshing = false; if (!this._disposed && this.session?.accepting && !document.hidden) this._poll = setTimeout(() => this.refresh(), 2000); }
        },
        async stop() {
            this.busy = true; this.error = ''; clearTimeout(this._poll); this._pollController?.abort();
            try { this.session = await albumApi.stop(this.credentials); this.qrSvg = ''; }
            catch (error) { this.error = error.message; this.refresh(); }
            finally { this.busy = false; }
        },
        revoke() { if (this.credentials && this.session?.accepting) { albumApi.stop(this.credentials, true).catch(() => {}); this.session.accepting = false; this.qrSvg = ''; } },
        async copy() { try { await copyText(this.uploadUrl); this.copyStatus = '链接已复制'; } catch { this.copyStatus = '复制失败，请直接扫描二维码'; } }
    }
};
</script>
