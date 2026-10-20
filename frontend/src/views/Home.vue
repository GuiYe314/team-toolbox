<template>
    <div class="view-page page-home">
        <header class="view-head">
            <h1 class="view-title">团队工具箱</h1>
            <p class="view-subtitle">首页</p>
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
                <svg class="icon icon-lg empty-icon" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M4 4.5h6.5a2 2 0 0 1 2 2V20a1.6 1.6 0 0 0-1.6-1.5H4z" />
                    <path d="M20 4.5h-6.5a2 2 0 0 0-2 2V20a1.6 1.6 0 0 1 1.6-1.5H20z" />
                </svg>
                <p>知识库还没有文档</p>
                <p class="empty-hint">点击下方按钮创建第一篇文档，开始沉淀团队知识。</p>
                <button class="btn btn-primary" @click="goNew">新建文档</button>
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
                        <div class="recent-head">
                            <span class="recent-title">{{ doc.title }}</span>
                            <span class="recent-time">{{ formatTime(doc.updated_at) }}</span>
                        </div>
                        <p v-if="doc.snippet" class="recent-snippet">{{ doc.snippet }}</p>
                        <p v-else class="recent-snippet recent-snippet-empty">暂无内容</p>
                        <div v-if="doc.category_name || (doc.tags || []).length" class="recent-sub">
                            <span v-if="doc.category_name" class="doc-pill">{{ doc.category_name }}</span>
                            <span
                                v-for="t in (doc.tags || [])"
                                :key="t"
                                class="doc-pill doc-pill-tag"
                            >#{{ t }}</span>
                        </div>
                    </li>
                </ul>
                <button
                    v-if="hasMore"
                    class="btn more-btn"
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
                        <ToolIcon :tool-id="tool.id" />
                        <span class="tool-status" v-if="tool.status === 'planned'">规划中</span>
                    </div>
                    <h3 class="tool-name">{{ tool.name }}</h3>
                    <p class="tool-desc">{{ tool.desc }}</p>
                    <button v-if="tool.status === 'planned'" class="btn btn-sm" @click="$router.push({ name: tool.routeName })">
                        查看详情
                    </button>
                </div>
            </div>
        </section>
    </div>
</template>

<script>
import { api } from '../api/client.js';
import ToolIcon from '../components/ToolIcon.vue';

export default {
    name: 'Home',
    components: { ToolIcon },
    data() {
        return {
            tools: [
                {
                    id: 'json-fmt',
                    name: 'JSON 格式化',
                    desc: 'JSON 数据的美化与压缩',
                    status: 'planned',
                    routeName: 'tool-json-fmt'
                },
                {
                    id: 'qrcode',
                    name: '二维码生成',
                    desc: '文本或链接快速生成二维码',
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
</script><style scoped>
/* 根容器统一用全局 .view-page（自带纵向滚动 + token 内边距），
   这里只做栅格与卡片外观，不再重复写 max-width / padding。*/

.section {
    flex: none;
    margin-bottom: 26px;
}
.section:last-child { margin-bottom: 0; }
.section-title {
    margin: 0 0 12px;
    font-size: var(--text-section-title);
    font-weight: var(--weight-semibold);
    color: var(--text-primary);
}

/* ── 状态 ────────────────────────────────────────────────────────── */
.state-loading,
.state-error {
    padding: 22px;
    border-radius: var(--radius-md);
    background: var(--panel-background);
    border: 1px solid var(--panel-border);
    font-size: var(--text-body);
    color: var(--text-secondary);
}
.state-error { border-color: var(--danger); color: var(--danger); }
.state-error p { margin: 0 0 10px; }
.state-error-inline {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 0 0 10px;
    padding: 8px 12px;
    border-radius: var(--radius-sm);
    background: var(--danger-soft);
    color: var(--danger);
    font-size: var(--text-secondary);
}
.retry-btn,
.retry-link {
    border: none;
    background: none;
    color: var(--accent);
    font-size: inherit;
    cursor: pointer;
    padding: 0;
    text-decoration: underline;
}
.retry-link { font-size: var(--text-secondary); }

/* ── 空状态 ──────────────────────────────────────────────────────── */
.empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 44px 24px;
    text-align: center;
    border-radius: var(--radius-lg);
    background: var(--panel-background);
    border: 1px solid var(--panel-border);
    color: var(--text-secondary);
    font-size: var(--text-body);
}
.empty-state p { margin: 0; }
.empty-icon { color: var(--text-tertiary); opacity: 0.7; margin-bottom: 4px; }
.empty-hint {
    font-size: var(--text-secondary);
    color: var(--text-tertiary);
    margin-bottom: 8px !important;
}

/* ── 最近更新：与知识库同一套卡片语言 ──────────────────────────── */
/* 文档标题普遍很短，单行列表会浪费横向空间；改为自适应卡片网格，
   一屏能看到的内容量约为原来 3~4 倍。 */
.recent-list {
    display: grid;
    /* auto-fit：折叠空轨道并拉伸现有列，避免 3 张卡片在 2 列容器里
       第 3 张单独占一行、右侧留大片空白 */
    grid-template-columns: repeat(auto-fit, minmax(min(300px, 100%), 1fr));
    gap: 10px;
}
.recent-item {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
    padding: 12px 14px;
    border-radius: var(--radius-md);
    border: 1px solid var(--panel-border);
    background: var(--panel-background);
    cursor: pointer;
    transition: background var(--dur-base) var(--ease-out),
                border-color var(--dur-base) var(--ease-out);
}
.recent-item:hover {
    background: var(--panel-background-hover);
    border-color: var(--accent-border);
}
/* 标题行：标题吃掉剩余宽度，时间固定在右上角 */
.recent-head {
    display: flex;
    align-items: baseline;
    gap: 10px;
    min-width: 0;
}
.recent-title {
    flex: 1;
    min-width: 0;
    font-size: var(--text-doc-title);
    font-weight: var(--weight-semibold);
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.recent-time {
    flex: none;
    font-size: var(--text-tag);
    color: var(--text-tertiary);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
}
/* 摘要固定 2 行：卡片高度一致，整排底部才齐。
   flex:1 让它吃掉多余高度，无摘要时也保留同样空间。 */
.recent-snippet {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    flex: 1;
    margin: 0;
    font-size: var(--text-secondary);
    color: var(--text-tertiary);
    line-height: var(--line-relaxed);
    overflow: hidden;
}
.recent-snippet-empty { font-style: italic; opacity: 0.7; }
.recent-sub {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: auto;
}
.recent-sub:empty { display: none; }
.doc-pill {
    display: inline-flex;
    align-items: center;
    height: 20px;
    padding: 0 8px;
    border-radius: var(--radius-pill);
    background: var(--panel-background-hover);
    border: 1px solid var(--panel-border);
    color: var(--text-secondary);
    font-size: var(--text-tag);
    font-weight: var(--weight-medium);
    white-space: nowrap;
}
.doc-pill-tag { color: var(--accent); background: var(--accent-soft); border-color: var(--accent-border); }

/* ── 工具卡片网格：自适应列，窄屏自动降列 ──────────────────────── */
.tools-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(228px, 100%), 1fr));
    gap: 12px;
}
.tool-card {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 16px;
    border-radius: var(--radius-lg);
    background: var(--panel-background);
    border: 1px solid var(--panel-border);
    transition: background var(--dur-base) var(--ease-out),
                border-color var(--dur-base) var(--ease-out),
                transform var(--dur-base) var(--ease-out);
}
.tool-card:hover {
    background: var(--panel-background-hover);
    border-color: var(--accent-border);
    transform: translateY(-1px);
}
.tool-card.planned { opacity: 0.82; }
.tool-card-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
}
.tool-status {
    display: inline-flex;
    align-items: center;
    height: 20px;
    padding: 0 8px;
    border-radius: var(--radius-pill);
    background: var(--panel-background-hover);
    color: var(--text-tertiary);
    font-size: var(--text-tag);
    font-weight: var(--weight-medium);
}
.tool-name {
    margin: 2px 0 0;
    font-size: var(--text-doc-title);
    font-weight: var(--weight-semibold);
    color: var(--text-primary);
}
.tool-desc {
    margin: 0;
    flex: 1;
    font-size: var(--text-secondary);
    line-height: var(--line-relaxed);
    color: var(--text-tertiary);
}
.tool-card .btn { align-self: flex-start; }

.more-btn {
    align-self: center;
    margin-top: 14px;
}

/* 卡片网格靠 auto-fill 自动降列，无需额外断点 */
</style>
