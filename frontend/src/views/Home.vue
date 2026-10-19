<template>
    <div class="page-home">
        <header class="page-header">
            <h1>团队工具箱</h1>
            <p class="subtitle">首页</p>
        </header>

        <!-- 最近更新 -->
        <section class="section">
            <h2 class="section-title">最近更新</h2>
            <div class="empty-state">
                <p class="empty-icon">📋</p>
                <p>暂无文档</p>
                <p class="empty-hint">知识库功能正在准备中，稍后将开放使用</p>
            </div>
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
            ]
        };
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
    margin: 4px 0 0;
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
