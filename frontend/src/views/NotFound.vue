<template>
    <div class="view-page page-404">
        <header class="view-head">
            <h1 class="view-title">404</h1>
            <p class="view-subtitle">页面未找到</p>
        </header>

        <div class="empty-state">
            <svg class="icon icon-lg empty-icon" viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="11" cy="11" r="6.5" />
                <line x1="16" y1="16" x2="20.5" y2="20.5" />
                <line x1="8.5" y1="11" x2="13.5" y2="11" />
            </svg>
            <p>您访问的页面不存在</p>
            <p class="empty-hint">请检查 URL 是否正确，或使用导航返回首页</p>
            <button class="btn btn-primary" @click="$router.push({ name: 'home' })">返回首页</button>
        </div>
    </div>
</template>

<script>
export default {
    name: 'NotFound'
};
</script>

<style scoped>
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
.empty-icon {
    color: var(--text-tertiary);
    opacity: 0.7;
    margin-bottom: 4px;
}
.empty-hint {
    font-size: var(--text-secondary);
    color: var(--text-tertiary);
    margin-bottom: 8px !important;
}
</style>