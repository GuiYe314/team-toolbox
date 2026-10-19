<template>
    <div class="page-home">
        <header class="page-header">
            <h1>团队工具箱</h1>
            <p class="subtitle">首页</p>
        </header>

        <!-- 最近更新 -->
        <section class="section">
            <h2 class="section-title">最近更新</h2>

            <p v-if="loading && recent.length === 0" class="state-loading">加载中…</p>

            <div v-else-if="error && recent.length === 0" class="state-error">
                <p>加载失败：{{ error }}</p>
                <button class="retry-btn" @click="retry">重试</button>
            </div>

            <div v-else-if="recent.length === 0" class="empty-state">
                <p class="empty-icon">📋</p>
                <p>知识库还没有文档</p>
                <p class="empty-hint">点击下方按钮创建第一篇文档，开始沉淀团队知识。</p>
                <button class="empty-action" @click="goNew">新建文档</button>
            </div>

            <template v-else>
                <p v-if="error" class="state-error-inline">
                    加载失败：{{ error }}
                    <button class="retry-link" @click="retry">重试</button>
                </p>
                <ul class="recent-list">
                    <li
                        v-for="doc in recent"
                        :key="doc.id"
                        class="recent-item"
                        @click="goDoc(doc.id)"
                    >
                        <div class="recent-main">
                            <span class="recent-title">{{ doc.title }}</span>
                            <span class="recent-sub">
                                <span v-if="doc.category_name" class="doc-pill">{{ doc.category_name }}</span>
                                <span
                                    v-for="t in (doc.tags || [])"
                                    :key="t"
                                    class="doc-pill doc-pill-tag"
                                >#{{ t }}</span>
                            </span>
                        </div>
                        <span class="recent-time">{{ formatTime(doc.updated_at) }}</span>
                    </li>
                </ul>
                <button
                    v-if="hasMore"
                    class="more-btn"
                    :disabled="loading"
                    @click="loadMore"
                >{{ loading ? '加载中…' : '查看更多' }}</button>
            </template>
        </section>

        <!-- 工具卡片 -->
        <section class="section">
            <h2 class="section-title">小工具</h2>
            <div class="tools-grid">
                <div v-for="tool in tools" :key="tool.id" class="tool-card" :class="{ 'planned': tool.status === 'planned' }">
                    <div class="tool-card-header">
                        <span class="tool-icon">{{ tool.icon }}</span>
                        <span class="tool-status" v-if="tool.status === 'planned'">规划中</span>
                    </div>
                    <h3 class="tool-name">{{ tool.name }}</h3>
                    <p class="tool-desc">{{ tool.desc }}</p>
                    <button v-if="tool.status === 'planned'" class="tool-action" @click="$router.push({ name: tool.routeName })">
                        查看详情
                    </button>
                </div>
            </div>
        </section>
    </div>
</template>

<script>
import { api } from '../api/client.js';

export default {
    name: 'Home',
    data() {
        return {
            tools: [
                {
                    id: 'json-fmt',
                    name: 'JSON 格式化',
                    desc: 'JSON 数据的美化与压缩',
                    icon: '{ }',
                    status: 'planned',
                    routeName: 'tool-json-fmt'
                },
                {
                    id: 'qrcode',
                    name: '二维码生成',
                    desc: '文本或链接快速生成二维码',
                    icon: '⬡',
                    status: 'planned',
                    routeName: 'tool-qrcode'
                }
            ],
            // F-KB-008：首页最近更新
            recent: [],
            recentTotal: 0,
            offset: 0,
            limit: 20,
            loading: false,
            error: null
        };
    },
    computed: {
        hasMore() {
            return this.recent.length < this.recentTotal;
        }
    },
    mounted() {
        this.loadRecent();
    },
    methods: {
        async loadRecent() {
            this.offset = 0;
            this.error = null;
            this.loading = true;
            try {
                const { body } = await api.listDocuments(`?limit=${this.limit}&offset=0`);
                this.recent = (body && body.items) || [];
                this.recentTotal = (body && body.total) || 0;
                this.offset = this.recent.length;
            } catch (e) {
                this.error = (e && e.message) ? e.message : '网络错误';
                this.recent = [];
            } finally {
                this.loading = false;
            }
        },
        async loadMore() {
            if (this.loading || !this.hasMore) return;
            this.loading = true;
            this.error = null;
            try {
                const { body } = await api.listDocuments(`?limit=${this.limit}&offset=${this.offset}`);
                const items = (body && body.items) || [];
                this.recent = this.recent.concat(items);
                this.recentTotal = (body && body.total) || 0;
                this.offset = this.offset + items.length;
            } catch (e) {
                this.error = (e && e.message) ? e.message : '网络错误';
            } finally {
                this.loading = false;
            }
        },
        retry() {
            if (this.recent.length === 0) this.loadRecent();
            else this.loadMore();
        },
        goDoc(id) {
            this.$router.push({ name: 'kb-detail', params: { id } });
        },
        goNew() {
            this.$router.push({ name: 'kb-new' });
        },
        formatTime(iso) {
            if (!iso) return '';
            const d = new Date(iso);
            if (Number.isNaN(d.getTime())) return iso;
            return d.toLocaleString('zh-CN', {
                year: 'numeric', month: '2-digit', day: '2-digit',
                hour: '2-digit', minute: '2-digit'
            });
        }
    }
};
</script>

<style scoped>
.page-home {
    max-width: 1080px;
    margin: 0 auto;
    padding: 52px 48px 72px;
}
.page-header {
    margin-bottom: 32px;
}
.page-header h1 {
    font-size: 36px;
    font-weight: 700;
    margin: 0 0 4px;
    letter-spacing: -0.01em;
}
.subtitle {
    color: var(--color-text-muted);
    margin: 0;
    font-size: 14px;
}
.section {
    margin-bottom: 32px;
}
.section-title {
    font-size: 18px;
    margin: 0 0 16px;
    padding-bottom: 8px;
    border-bottom: 1px solid var(--color-border);
}
.empty-state {
    text-align: center;
    padding: 40px 20px;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: 8px;
}
.empty-icon {
    font-size: 36px;
    margin: 0 0 8px;
}
.empty-hint {
    font-size: 13px;
    color: var(--color-text-muted);
    margin: 4px 0 16px;
}
.empty-action {
    font-size: 14px;
    color: #fff;
    background: var(--color-focus);
    border: none;
    border-radius: 6px;
    padding: 8px 18px;
    cursor: pointer;
}
.empty-action:hover {
    filter: brightness(1.05);
}
.empty-action:focus-visible {
    outline: 2px solid var(--color-focus);
    outline-offset: 2px;
}
.state-loading {
    padding: 40px 20px;
    text-align: center;
    color: var(--color-text-muted);
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: 8px;
}
.state-error {
    text-align: center;
    padding: 32px 20px;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: 8px;
}
.state-error p {
    margin: 0 0 12px;
    color: var(--color-text-muted);
}
.retry-btn {
    font-size: 14px;
    color: #fff;
    background: var(--color-focus);
    border: none;
    border-radius: 6px;
    padding: 8px 18px;
    cursor: pointer;
}
.retry-btn:focus-visible {
    outline: 2px solid var(--color-focus);
    outline-offset: 2px;
}
.state-error-inline {
    font-size: 13px;
    color: #b42318;
    margin: 0 0 12px;
}
.retry-link {
    font-size: 13px;
    color: var(--color-focus);
    background: none;
    border: none;
    cursor: pointer;
    padding: 0;
    margin-left: 6px;
    text-decoration: underline;
}
.retry-link:focus-visible {
    outline: 2px solid var(--color-focus);
    outline-offset: 2px;
    border-radius: 2px;
}
.recent-list {
    list-style: none;
    margin: 0;
    padding: 0;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: 8px;
    overflow: hidden;
}
.recent-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 14px 18px;
    border-bottom: 1px solid var(--color-border);
    cursor: pointer;
}
.recent-item:last-child {
    border-bottom: none;
}
.recent-item:hover {
    background: var(--color-bg);
}
.recent-main {
    min-width: 0;
}
.recent-title {
    display: block;
    font-size: 15px;
    font-weight: 600;
    color: var(--color-text);
    margin-bottom: 6px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.recent-sub {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
}
.doc-pill {
    font-size: 11px;
    line-height: 1;
    padding: 4px 8px;
    border-radius: 999px;
    background: #eef2ff;
    color: #4338ca;
    white-space: nowrap;
}
.doc-pill-tag {
    background: #ecfdf5;
    color: #047857;
}
.recent-time {
    flex: none;
    font-size: 12px;
    color: var(--color-text-muted);
    white-space: nowrap;
}
.more-btn {
    display: block;
    margin: 16px auto 0;
    font-size: 14px;
    color: var(--color-focus);
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: 6px;
    padding: 9px 22px;
    cursor: pointer;
}
.more-btn:hover:not(:disabled) {
    border-color: var(--color-focus);
}
.more-btn:disabled {
    opacity: 0.6;
    cursor: default;
}
.more-btn:focus-visible {
    outline: 2px solid var(--color-focus);
    outline-offset: 2px;
}
.tools-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 16px;
}
.tool-card {
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: 8px;
    padding: 16px;
}
.tool-card.planned {
    border-style: dashed;
}
.tool-card-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 8px;
}
.tool-icon {
    font-size: 24px;
}
.tool-status {
    font-size: 11px;
    background: #f3f4f6;
    color: var(--color-text-muted);
    padding: 2px 6px;
    border-radius: 4px;
}
.tool-name {
    margin: 0 0 4px;
    font-size: 15px;
}
.tool-desc {
    margin: 0 0 12px;
    font-size: 13px;
    color: var(--color-text-muted);
}
.tool-action {
    font-size: 13px;
    color: var(--color-focus);
    background: none;
    border: none;
    cursor: pointer;
    padding: 0;
}
.tool-action:focus-visible {
    outline: 2px solid var(--color-focus);
    outline-offset: 2px;
    border-radius: 2px;
}
</style>
