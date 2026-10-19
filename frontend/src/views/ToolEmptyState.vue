<template>
    <div class="page-tool-empty">
        <header class="page-header">
            <div class="header-top">
                <button class="btn-back" @click="$router.push({ name: 'tools' })">← 返回工具箱</button>
            </div>
            <h1>{{ toolName }}</h1>
            <p class="subtitle">工具尚未实现</p>
        </header>

        <div class="empty-state">
            <p class="empty-icon">{{ toolIcon }}</p>
            <p>该工具尚在规划中，暂未实现。</p>
            <p class="empty-hint">具体工具功能将在用户选定技术方案后另拆任务开发。</p>
            <button class="btn btn-default" @click="$router.push({ name: 'tools' })">返回工具箱</button>
        </div>
    </div>
</template>

<script>
export default {
    name: 'ToolEmptyState',
    computed: {
        toolId() {
            return this.$route.name.replace('tool-', '');
        },
        toolMeta() {
            const meta = {
                'json-fmt': { name: 'JSON 格式化', icon: '{ }' },
                'qrcode': { name: '二维码生成', icon: '⬡' }
            };
            return meta[this.toolId] || { name: '未知工具', icon: '❓' };
        },
        toolName() {
            return this.toolMeta.name;
        },
        toolIcon() {
            return this.toolMeta.icon;
        }
    }
};
</script>

<style scoped>
.page-header {
    margin-bottom: 24px;
}
.header-top {
    margin-bottom: 12px;
}
.btn-back {
    background: none;
    border: none;
    color: var(--color-focus);
    cursor: pointer;
    font-size: 14px;
    padding: 0;
}
.btn-back:focus-visible {
    outline: 2px solid var(--color-focus);
    outline-offset: 2px;
    border-radius: 2px;
}
.page-header h1 {
    font-size: 28px;
    margin: 0 0 4px;
}
.subtitle {
    color: var(--color-text-muted);
    margin: 0;
    font-size: 14px;
}
.empty-state {
    text-align: center;
    padding: 48px 20px;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: 8px;
}
.empty-icon {
    font-size: 48px;
    margin: 0 0 12px;
}
.empty-hint {
    font-size: 13px;
    color: var(--color-text-muted);
    margin: 4px 0 16px;
}
.btn {
    padding: 8px 16px;
    border-radius: 6px;
    font-size: 14px;
    cursor: pointer;
    border: 1px solid var(--color-border);
    background: var(--color-surface);
    color: var(--color-text);
}
.btn-default {
    background: var(--color-surface);
}
</style>
