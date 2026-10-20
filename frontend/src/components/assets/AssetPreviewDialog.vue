<template>
    <!--
      大型预览弹窗（占页面 88%）。
      右侧详情只做快速预览；双击资源或点「预览」进入这里。

      Teleport 到 body —— 这是**必须的**，不是 DOM 扁平化：
      资源页的 .main-content 上有 backdrop-filter（玻璃拟态），
      按 CSS 规范它会创建包含块，使后代的 position: fixed
      改为相对该元素定位而非相对视口。弹窗本该占视口 88%，
      留在原地会变成「主内容区的 88%」，且整体右移 250px。
    -->
    <Teleport to="body">
    <div class="am-modal" role="dialog" aria-modal="true" :aria-label="'预览 ' + (asset ? asset.name : '')" @click.self="close">
        <header class="am-modal-head">
            <div class="am-modal-titles">
                <h2 class="am-modal-title" :title="asset && asset.name">{{ asset && asset.name }}</h2>
                <div class="am-modal-meta">
                    <!-- 版本切换：预览历史版本时不改 latest/published 指针 -->
                    <label class="am-modal-ver">
                        <span class="am-hint">版本</span>
                        <select class="am-select" :value="currentVersion && currentVersion.versionNumber" @change="onVersionChange">
                            <option v-for="v in versions" :key="v.id" :value="v.versionNumber">
                                v{{ v.versionNumber }}{{ v.isLatest ? ' (最新)' : '' }}{{ v.isPublished ? ' (已发布)' : '' }}
                            </option>
                        </select>
                    </label>
                    <span v-if="currentVersion" class="am-hint">{{ formatSize(currentVersion.fileSize) }}</span>
                </div>
            </div>
            <div class="am-modal-tools">
                <button
                    v-hint
                    class="am-mbtn"
                    type="button"
                    title="上一个资源"
                    aria-label="上一个资源"
                    :disabled="!hasPrev"
                    @click="step(-1)"
                >
                    <svg class="icon icon-sm" viewBox="0 0 24 24" aria-hidden="true">
                        <polyline points="14 6 8 12 14 18" />
                    </svg>
                </button>
                <button
                    v-hint
                    class="am-mbtn"
                    type="button"
                    title="下一个资源"
                    aria-label="下一个资源"
                    :disabled="!hasNext"
                    @click="step(1)"
                >
                    <svg class="icon icon-sm" viewBox="0 0 24 24" aria-hidden="true">
                        <polyline points="10 6 16 12 10 18" />
                    </svg>
                </button>
                <button
                    v-hint
                    class="am-mbtn"
                    type="button"
                    title="下载此版本"
                    aria-label="下载此版本"
                    @click="download"
                >
                    <svg class="icon icon-sm" viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M12 4v10" /><polyline points="8 11 12 15 16 11" /><path d="M5 19h14" />
                    </svg>
                </button>
                <button
                    v-hint
                    class="am-mbtn"
                    type="button"
                    title="全屏预览区域"
                    aria-label="全屏预览区域"
                    @click="toggleFull"
                >
                    <svg class="icon icon-sm" viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
                    </svg>
                </button>
                <button
                    v-hint
                    class="am-mbtn"
                    type="button"
                    title="关闭预览"
                    aria-label="关闭预览"
                    @click="close"
                >
                    <svg class="icon icon-sm" viewBox="0 0 24 24" aria-hidden="true">
                        <line x1="6" y1="6" x2="18" y2="18" />
                        <line x1="18" y1="6" x2="6" y2="18" />
                    </svg>
                </button>
            </div>
        </header>

        <!-- 预览容器：Provider 由 PreviewManager 挂到这里 -->
        <div ref="stage" class="am-modal-stage" :class="{ 'is-full': full }"></div>

        <footer class="am-modal-foot">
            <span class="am-hint">{{ positionHint }}</span>
            <span class="am-hint">{{ asset ? `${typeLabel(asset.type)} · ${asset.mimeType}` : '' }}</span>
        </footer>
    </div>
    </Teleport>
</template>

<script>
import previewManager from '../../assets/preview-manager.js';
import assetApi from '../../api/asset-client.js';
import { typeLabel, formatSize, hasPreviewProvider } from '../../assets/asset-meta.js';

export default {
    name: 'AssetPreviewDialog',
    props: {
        asset: { type: Object, default: null },
        versions: { type: Array, default: () => [] },
        /** 当前列表，用于「上一个/下一个」导航 */
        siblings: { type: Array, default: () => [] }
    },
    emits: ['close', 'navigate', 'versions-loaded'],
    data() {
        return { full: false };
    },
    computed: {
        /** 当前预览的版本；默认取 latest。 */
        currentVersion() {
            if (!this.asset) return null;
            const latest = this.versions.find((v) => v.isLatest);
            return latest || this.versions[0] || null;
        },
        siblingIndex() {
            if (!this.asset || this.siblings.length === 0) return -1;
            return this.siblings.findIndex((a) => a.id === this.asset.id);
        },
        hasPrev() { return this.siblingIndex > 0; },
        hasNext() {
            return this.siblingIndex >= 0 && this.siblingIndex < this.siblings.length - 1;
        },
        positionHint() {
            if (this.siblingIndex < 0) return '';
            return `${this.siblingIndex + 1} / ${this.siblings.length}`;
        }
    },
    watch: {
        asset: {
            immediate: true,
            handler() { this.render(); }
        },
        currentVersion() { this.render(); }
    },
    mounted() {
        document.addEventListener('keydown', this.onKey);
        if (this.asset) this.loadVersions();
    },
    beforeUnmount() {
        document.removeEventListener('keydown', this.onKey);
        // 关键：离开时必须释放 Provider（Video 停止、Monaco dispose、
        // model-viewer 摘除），否则资源会一直占用直到页面刷新
        previewManager.close();
    },
    methods: {
        typeLabel,
        formatSize,
        async loadVersions() {
            if (!this.asset || this.versions.length) return;
            try {
                const { res, body } = await assetApi.versions(this.asset.id);
                if (res.ok) this.$emit('versions-loaded', (body && body.items) || []);
            } catch {
                // 版本拉不到不阻断预览，只是版本下拉会是空的
            }
        },
        onKey(e) {
            if (e.key === 'Escape') { this.close(); return; }
            if (e.key === 'ArrowLeft' && this.hasPrev) { this.step(-1); return; }
            if (e.key === 'ArrowRight' && this.hasNext) { this.step(1); }
        },
async render() {
        await this.$nextTick();
        const stage = this.$refs.stage;
        if (!stage || !this.asset) return;

        const version = this.currentVersion;
        // 幂等保护：asset 与 currentVersion 两个 watch 都可能触发 render
        //（immediate + 依赖变化时序不确定），不去重会出现两份预览并排。
        // 同一资源+同一版本只渲染一次，切换时才真正重渲。
        const key = `${this.asset.id}:${version ? version.versionNumber : 'latest'}`;
        if (this._renderedKey === key) return;
        this._renderedKey = key;

        const previewUrl = version && version.previewStorageKey
            ? assetApi.fileUrl(this.asset.id, 'preview', version.versionNumber)
            : null;

        previewManager.open(stage, this.asset, version, {
            fileUrl: assetApi.fileUrl,
            previewUrl,
            kind: previewUrl ? 'preview' : 'original'
        });
    },
        onVersionChange(e) {
            const n = Number(e.target.value);
            const v = this.versions.find((x) => x.versionNumber === n);
            if (!v) return;
            // 主动切换版本：清掉渲染 key 强制重渲
            this._renderedKey = null;
            this.$emit('navigate', { asset: this.asset, version: v });
        },
        step(delta) {
            const next = this.siblingIndex + delta;
            if (next < 0 || next >= this.siblings.length) return;
            // 换资源：清 key，否则会因资源 id 不同而天然重渲，但显式清更稳妥
            this._renderedKey = null;
            this.$emit('navigate', { asset: this.siblings[next] });
        },
        download() {
            if (!this.asset || !this.currentVersion) return;
            window.open(
                assetApi.fileUrl(this.asset.id, 'original', this.currentVersion.versionNumber, true),
                '_blank'
            );
        },
        toggleFull() {
            this.full = !this.full;
            // 尺寸变化后 Provider 需要重排（Monaco 的 automaticLayout、
            // model-viewer 的 resize 都依赖尺寸）。清 key 强制重渲。
            this._renderedKey = null;
            this.$nextTick(() => this.render());
        },
        close() { this.$emit('close'); }
    }
};
</script>

<style scoped>
.am-modal {
    position: fixed;
    inset: 6%;
    z-index: var(--z-modal);
    display: flex;
    flex-direction: column;
    border-radius: var(--radius-xl);
    border: 1px solid var(--panel-border);
    background: var(--surface-solid);
    box-shadow: var(--shadow-overlay);
    overflow: hidden;
}
.am-modal-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    flex: none;
    padding: 12px 14px;
    border-bottom: 1px solid var(--panel-border);
}
.am-modal-titles { min-width: 0; }
.am-modal-title {
    margin: 0 0 4px;
    font-size: var(--text-section-title);
    font-weight: var(--weight-semibold);
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.am-modal-meta { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.am-modal-ver { display: inline-flex; align-items: center; gap: 5px; }
.am-modal-tools { display: flex; align-items: center; gap: 2px; flex: none; }
.am-mbtn {
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
    transition: background var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);
}
.am-mbtn:hover:not(:disabled) { background: var(--hover-background); color: var(--text-primary); }
.am-mbtn:disabled { opacity: 0.35; cursor: not-allowed; }

.am-modal-stage {
    flex: 1;
    min-height: 0;
    overflow: auto;
    background: var(--surface-sunken);
    /* Provider 内容在此居中 */
    display: flex;
    align-items: center;
    justify-content: center;
}
.am-modal-stage.is-full {
    position: fixed;
    inset: 0;
    z-index: var(--z-modal);
    border-radius: 0;
}
.am-modal-foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex: none;
    padding: 8px 14px;
    border-top: 1px solid var(--panel-border);
}
</style>