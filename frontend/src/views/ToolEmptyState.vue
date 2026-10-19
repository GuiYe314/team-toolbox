<template>
    <div class="view-page page-tool-empty">
        <header class="view-head">
            <div class="header-top">
                <button class="btn-back" @click="$router.push({ name: 'tools' })">
                    <svg class="icon icon-sm" viewBox="0 0 24 24" aria-hidden="true">
                        <polyline points="14.5 6 8.5 12 14.5 18" />
                    </svg>
                    返回工具箱
                </button>
            </div>
            <h1 class="view-title">{{ toolName }}</h1>
            <p class="view-subtitle">工具尚未实现</p>
        </header>

        <div class="empty-state">
            <ToolIcon :tool-id="toolId" class="empty-icon" />
            <p>该工具尚在规划中，暂未实现。</p>
            <p class="empty-hint">具体工具功能将在用户选定技术方案后另拆任务开发。</p>
            <button class="btn btn-primary" @click="$router.push({ name: 'tools' })">返回工具箱</button>
        </div>
    </div>
</template>

<script>
import ToolIcon from '../components/ToolIcon.vue';

export default {
    name: 'ToolEmptyState',
    components: { ToolIcon },
    computed: {
        toolId() {
            return this.$route.name.replace('tool-', '');
        },
        toolName() {
            const meta = {
                'json-fmt': 'JSON 格式化',
                qrcode: '二维码生成'
            };
            return meta[this.toolId] || '未知工具';
        }
    }
};
</script>

<style scoped>
.header-top { margin-bottom: 12px; }
.btn-back {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    border: none;
    background: none;
    color: var(--text-secondary);
    cursor: pointer;
    font-size: var(--text-secondary);
    padding: 4px 8px 4px 4px;
    border-radius: var(--radius-sm);
    transition: background var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);
}
.btn-back:hover { background: var(--hover-background); color: var(--text-primary); }
.btn-back:focus-visible {
    outline: none;
    box-shadow: 0 0 0 3px var(--focus-ring);
}

.empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 52px 24px;
    text-align: center;
    border-radius: var(--radius-lg);
    background: var(--panel-background);
    border: 1px solid var(--panel-border);
    font-size: var(--text-body);
    color: var(--text-secondary);
}
.empty-state p { margin: 0; }
/* ToolIcon 自带 34px 方形底，此处仅放大一档作为空状态主视觉 */
.empty-icon { width: 48px; height: 48px; margin-bottom: 4px; }
.empty-hint {
    font-size: var(--text-secondary);
    color: var(--text-tertiary);
    margin-bottom: 8px !important;
}
</style>