<template>
    <div class="view-page page-tools">
        <header class="view-head">
            <h1 class="view-title">工具箱</h1>
            <p class="view-subtitle">小工具集合</p>
        </header>

        <div class="tools-grid">
            <div v-for="tool in tools" :key="tool.id" class="tool-card" :class="{ planned: tool.status !== '可用' }">
                <div class="tool-card-header">
                    <ToolIcon :tool-id="tool.id" />
                    <span class="tool-status" :class="{ ready: tool.status === '可用' }">{{ tool.status }}</span>
                </div>
                <h3 class="tool-name">{{ tool.name }}</h3>
                <p class="tool-desc">{{ tool.desc }}</p>
                <button class="btn btn-sm" @click="$router.push({ name: tool.routeName })">
                    {{ tool.status === '可用' ? '打开工具' : '查看详情' }}
                </button>
            </div>
        </div>
    </div>
</template>

<script>
import ToolIcon from '../components/ToolIcon.vue';

export default {
    name: 'Tools',
    components: { ToolIcon },
    data() {
        return {
            tools: [
                {
                    id: 'ratio-lock',
                    name: '比例锁定',
                    desc: '锁定宽高比，输入任一侧自动换算另一侧',
                    routeName: 'tool-ratio-lock',
                    status: '可用'
                },
                {
                    id: 'json-fmt',
                    name: 'JSON 格式化',
                    desc: 'JSON 数据的美化与压缩',
                    routeName: 'tool-json-fmt',
                    status: '规划中'
                },
                {
                    id: 'qrcode',
                    name: '二维码生成',
                    desc: '文本或链接快速生成二维码',
                    routeName: 'tool-qrcode',
                    status: '规划中'
                }
            ]
        };
    }
};
</script>

<style scoped>
/* 卡片外观与首页「小工具」区块保持一致，同一组件两处呈现不割裂 */
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
/* 状态标签：可用为成功色软底，规划中为中性灰 */
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
.tool-status.ready {
    background: var(--success-soft);
    color: var(--success);
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
</style>