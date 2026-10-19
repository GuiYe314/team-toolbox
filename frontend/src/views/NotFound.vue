<template>
    <div class="page-404">
        <header class="page-header">
            <h1>404</h1>
            <p class="subtitle">页面未找到</p>
        </header>

        <div class="empty-state">
            <p class="empty-icon">🔍</p>
            <p>您访问的页面不存在</p>
            <p class="empty-hint">请检查 URL 是否正确，或使用导航返回首页</p>
            <button class="btn btn-default" @click="$router.push({ name: 'home' })">返回首页</button>
        </div>
    </div>
</template>

<script>
export default {
    name: 'NotFound'
};
</script>

<style scoped>
.page-header {
    margin-bottom: 24px;
}
.page-header h1 {
    font-size: 64px;
    margin: 0 0 8px;
    font-weight: 700;
    color: var(--color-text-muted);
}
.subtitle {
    color: var(--color-text-muted);
    margin: 0;
    font-size: 18px;
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
