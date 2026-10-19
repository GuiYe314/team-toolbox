<template>
    <div class="page-tools">
        <header class="page-header">
            <h1>工具箱</h1>
            <p class="subtitle">小工具集合</p>
        </header>

        <div class="tools-grid">
            <div v-for="tool in tools" :key="tool.id" class="tool-card">
                <div class="tool-card-header">
                    <span class="tool-icon">{{ tool.icon }}</span>
                    <span class="tool-status" :class="{ ready: tool.status === '可用' }">{{ tool.status }}</span>
                </div>
                <h3 class="tool-name">{{ tool.name }}</h3>
                <p class="tool-desc">{{ tool.desc }}</p>
                <button class="tool-action" @click="$router.push({ name: tool.routeName })">
                    {{ tool.status === '可用' ? '打开工具' : '查看详情' }}
                </button>
            </div>
        </div>
    </div>
</template>

<script>
export default {
    name: 'Tools',
    data() {
        return {
            tools: [
                {
                    id: 'ratio-lock',
                    name: '比例锁定',
                    desc: '锁定宽高比，输入任一侧自动换算另一侧',
                    icon: '📐',
                    routeName: 'tool-ratio-lock',
                    status: '可用'
                },
                {
                    id: 'json-fmt',
                    name: 'JSON 格式化',
                    desc: 'JSON 数据的美化与压缩',
                    icon: '{ }',
                    routeName: 'tool-json-fmt',
                    status: '规划中'
                },
                {
                    id: 'qrcode',
                    name: '二维码生成',
                    desc: '文本或链接快速生成二维码',
                    icon: '⬡',
                    routeName: 'tool-qrcode',
                    status: '规划中'
                }
            ]
        };
    }
};
</script>

<style scoped>
.page-tools {
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
    color: var(--text-secondary);
    margin: 0;
    font-size: 14px;
}
.tools-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 16px;
}
.tool-card {
    background: var(--panel-background);
    border: 1px dashed var(--panel-border);
    border-radius: 8px;
    padding: 20px;
}
.tool-card-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 12px;
}
.tool-icon {
    font-size: 28px;
}
.tool-status {
    font-size: 11px;
    background: #f3f4f6;
    color: var(--text-secondary);
    padding: 2px 8px;
    border-radius: 4px;
}
.tool-status.ready {
    background: #e7f3ea;
    color: #1d7a3c;
}
.tool-name {
    margin: 0 0 6px;
    font-size: 16px;
}
.tool-desc {
    margin: 0 0 16px;
    font-size: 13px;
    color: var(--text-secondary);
}
.tool-action {
    font-size: 13px;
    color: var(--accent);
    background: none;
    border: none;
    cursor: pointer;
    padding: 0;
}
.tool-action:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
    border-radius: 2px;
}
</style>
