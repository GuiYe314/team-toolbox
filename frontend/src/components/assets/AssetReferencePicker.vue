<template>
    <!--
      资源引用选择器。

      用途：在知识库文档正文里引用资源库的资源（图片、模型、纹理等）。

      插入的语法是**标准 Markdown 图片语法**：
        ![资源名](/api/assets/files/<资产id>/preview/auto)
      选它而不是自定义语法的三个理由：
        1. 服务端渲染零改动 —— 现有 sanitize-html 白名单已放行 img，
           不需要为引用引入任何解析逻辑或新的渲染路径；
        2. 编辑器（Vditor）能直接显示成图片，所见即所得；
        3. 纯文本形态可读、可手改、可粘贴到别处，语义不依赖本工具。

      pointer 用 auto：有发布版就用发布版，没有则退回最新版。
      这样资源一旦发布，文档里的引用自动跟进到正式版。
    -->
    <Teleport to="body">
        <div class="overlay" @click.self="$emit('close')">
            <div class="dialog asset-picker" role="dialog" aria-modal="true" aria-label="插入资源引用">
                <header class="asset-picker-head">
                    <h3 class="asset-picker-title">插入资源引用</h3>
                    <button
                        class="am-vbtn"
                        type="button"
                        aria-label="关闭"
                        @click="$emit('close')"
                    >
                        <svg class="icon icon-sm" viewBox="0 0 24 24" aria-hidden="true">
                            <path d="M6 6l12 12M18 6L6 18" />
                        </svg>
                    </button>
                </header>

                <div class="asset-picker-search">
                    <svg class="icon icon-sm" viewBox="0 0 24 24" aria-hidden="true">
                        <circle cx="10.5" cy="10.5" r="6.5" />
                        <path d="M15.5 15.5L20 20" />
                    </svg>
                    <input
                        v-model="keyword"
                        class="asset-picker-input"
                        type="search"
                        placeholder="搜索资源名称…"
                        @input="onSearch"
                    />
                </div>

                <p v-if="loading" class="asset-picker-hint">加载中…</p>
                <p v-else-if="error" class="asset-picker-hint asset-picker-hint-error">{{ error }}</p>
                <p v-else-if="!items.length" class="asset-picker-hint">
                    没有匹配的资源。{{ keyword ? '换个关键词试试。' : '资源库还是空的。' }}
                </p>

                <ul v-else class="asset-picker-list">
                    <li v-for="a in items" :key="a.id">
                        <button
                            class="asset-picker-item"
                            type="button"
                            @click="pick(a)"
                        >
                            <span class="asset-picker-thumb">
                                <img
                                    v-if="a.type === 'image' && thumbUrl(a)"
                                    :src="thumbUrl(a)"
                                    :alt="a.name"
                                    @error="onThumbError(a.id)"
                                />
                                <svg v-else class="icon" viewBox="0 0 24 24" aria-hidden="true">
                                    <path v-for="(d, i) in typeIcon(a.type)" :key="i" :d="d" />
                                </svg>
                            </span>
                            <span class="asset-picker-meta">
                                <span class="asset-picker-name" :title="a.name">{{ a.name }}</span>
                                <span class="asset-picker-sub">
                                    {{ typeLabel(a.type) }}
                                    <template v-if="a.publishedVersionNumber">· 已发布 v{{ a.publishedVersionNumber }}</template>
                                    <template v-else>· 未发布</template>
                                </span>
                            </span>
                        </button>
                    </li>
                </ul>

                <footer class="asset-picker-foot">
                    <p class="asset-picker-hint">
                        图片按预览图插入；其他类型插入原文件链接。
                    </p>
                    <button class="btn btn-sm" type="button" @click="$emit('close')">取消</button>
                </footer>
            </div>
        </div>
    </Teleport>
</template>

<script>
import { assetApi } from '../../api/asset-client.js';

/** 与资源管理页一致的类型图标路径（简版：只用少数几种）。 */
const TYPE_ICONS = {
    image: ['M4 5.5h16v13H4z', 'M4 15l4.5-4.5 3.5 3.5 3-3 5 5'],
    video: ['M3.5 6h11v12h-11z', 'M14.5 10l6-3v10l-6-3z'],
    audio: ['M9 17.5V6l10-2v11.5', 'M9 17.5a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z', 'M19 15.5a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z'],
    model: ['M12 3l8 4.5v9L12 21l-8-4.5v-9z', 'M12 12l8-4.5M12 12v9M12 12L4 7.5'],
    archive: ['M3.5 6.5h17v4h-17z', 'M5 10.5v9h14v-9'],
    text: ['M6 3.5h9l4 4v13H6z', 'M15 3.5v4h4', 'M9 12h7M9 16h7'],
    other: ['M6 3.5h12v17H6z', 'M9 8h6M9 12h6M9 16h4']
};

const TYPE_LABELS = {
    image: '图片', video: '视频', audio: '音频', model: '模型',
    archive: '压缩包', text: '文本', other: '其他'
};

export default {
    name: 'AssetReferencePicker',
    emits: ['close', 'pick'],
    data() {
        return {
            keyword: '',
            items: [],
            loading: false,
            error: '',
            thumbFailed: {},
            timer: null
        };
    },
    mounted() {
        this.load();
    },
    beforeUnmount() {
        if (this.timer) clearTimeout(this.timer);
    },
    methods: {
        async load() {
            this.loading = true;
            this.error = '';
            try {
                const { res, body } = await assetApi.list({
                    search: this.keyword || undefined,
                    pageSize: 60
                });
                if (!res.ok) throw new Error((body && body.message) || '加载失败');
                this.items = (body && body.items) || [];
            } catch (e) {
                this.error = e.network ? e.message : (e.message || '加载失败');
                this.items = [];
            } finally {
                this.loading = false;
            }
        },
        /** 输入防抖 —— 每敲一个字就发请求会打满后端。 */
        onSearch() {
            if (this.timer) clearTimeout(this.timer);
            this.timer = setTimeout(() => this.load(), 300);
        },
        typeIcon(type) {
            return TYPE_ICONS[type] || TYPE_ICONS.other;
        },
        typeLabel(type) {
            return TYPE_LABELS[type] || TYPE_LABELS.other;
        },
        thumbUrl(a) {
            if (this.thumbFailed[a.id]) return '';
            // 用 thumbnail（小）做列表缩略图；没有缩略图时浏览器会触发 error，
            // 由 onThumbError 标记失败并退回类型图标。
            return `/api/assets/files/${a.id}/thumbnail/auto`;
        },
        onThumbError(id) {
            this.$set(this.thumbFailed, id, true);
        },
        pick(a) {
            this.$emit('pick', a);
        }
    }
};
</script>

<style scoped>
.asset-picker {
    display: flex;
    flex-direction: column;
    width: min(560px, calc(100vw - 48px));
    max-height: min(70vh, 640px);
    padding: 0;
}

.asset-picker-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 14px 16px 10px;
}

.asset-picker-title {
    margin: 0;
    font-size: 14px;
    font-weight: 500;
}

.asset-picker-search {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 16px 10px;
    color: var(--text-tertiary);
}

.asset-picker-input {
    flex: 1;
    height: 30px;
    padding: 0 10px;
    border: 1px solid var(--panel-border);
    border-radius: var(--radius-sm, 6px);
    background: var(--panel-background);
    color: var(--text-primary);
    font-size: 13px;
}

.asset-picker-input:focus {
    outline: none;
    border-color: var(--accent);
}

.asset-picker-list {
    flex: 1;
    min-height: 120px;
    margin: 0;
    padding: 0 8px;
    overflow-y: auto;
    list-style: none;
}

.asset-picker-item {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 7px 8px;
    border: 0;
    border-radius: var(--radius-sm, 6px);
    background: transparent;
    color: inherit;
    text-align: left;
    cursor: pointer;
}

.asset-picker-item:hover {
    background: var(--panel-background-hover);
}

.asset-picker-thumb {
    flex: none;
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    border: 1px solid var(--panel-border);
    border-radius: 6px;
    background: var(--panel-background-hover);
    color: var(--text-tertiary);
    overflow: hidden;
}

.asset-picker-thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
}

.asset-picker-meta {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
}

.asset-picker-name {
    font-size: 13px;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.asset-picker-sub {
    font-size: 12px;
    color: var(--text-tertiary);
}

.asset-picker-hint {
    margin: 0;
    padding: 8px 16px;
    font-size: 12px;
    color: var(--text-tertiary);
}

.asset-picker-hint-error {
    color: var(--danger);
}

.asset-picker-foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 16px 12px;
    border-top: 1px solid var(--panel-border);
}

.asset-picker-foot .asset-picker-hint {
    padding: 0;
}
</style>
