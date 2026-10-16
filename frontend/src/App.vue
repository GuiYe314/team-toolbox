<template>
    <main class="scaffold">
        <header class="hero">
            <h1>team-toolbox</h1>
            <p class="muted">
                团队工具箱 · 阶段一脚手架。当前页面仅用于前后端联通冒烟，
                <strong>未实现任何业务功能</strong>，详见
                <a href="/docs/PROJECT_STATUS.md" rel="noopener">PROJECT_STATUS</a>。
            </p>
        </header>

        <section class="card">
            <h2>后端健康检查</h2>
            <p v-if="healthError" class="error">{{ healthError }}</p>
            <pre v-else-if="health">{{ JSON.stringify(health, null, 2) }}</pre>
            <p v-else class="muted">正在请求…</p>
        </section>

        <section class="card">
            <h2>Markdown 渲染冒烟</h2>
            <p class="muted">下方输入框会通过 <code>POST /api/_dev/render-markdown</code> 走 marked + sanitize-html，验证 XSS 输入会被剥离。</p>
            <textarea v-model="mdInput" rows="6" placeholder="Markdown input"></textarea>
            <div class="preview" v-html="renderedHtml"></div>
        </section>
    </main>
</template>

<script>
const API_BASE = (import.meta.env.VITE_API_BASE || '/api');

export default {
    name: 'App',
    data() {
        return {
            health: null,
            healthError: '',
            mdInput: '# 标题\n\n这是一段 **Markdown** 测试，包含 ' + '<script>alert(1)</' + 'script> 与 [外链](https://example.com)。',
            renderedHtml: ''
        };
    },
    async mounted() {
        try {
            const resp = await fetch(API_BASE + '/health');
            if (!resp.ok) throw new Error('HTTP ' + resp.status);
            this.health = await resp.json();
        } catch (err) {
            this.healthError = String((err && err.message) || err);
        }
    },
    methods: {
        async renderMarkdown() {
            try {
                const resp = await fetch(API_BASE + '/_dev/render-markdown', {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ md: this.mdInput })
                });
                if (!resp.ok) throw new Error('HTTP ' + resp.status);
                const data = await resp.json();
                this.renderedHtml = data.html || '';
            } catch (err) {
                this.renderedHtml = '<p class="error">' + String((err && err.message) || err) + '</p>';
            }
        }
    },
    watch: {
        mdInput() {
            this.renderMarkdown();
        }
    }
};
</script>

<style>
:root {
    color-scheme: light dark;
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
}
body { margin: 0; }
.scaffold { max-width: 880px; margin: 0 auto; padding: 24px; }
.hero h1 { margin: 0 0 8px; font-size: 28px; }
.muted { color: #666; }
.card { border: 1px solid #ccc; border-radius: 8px; padding: 16px; margin: 16px 0; }
.card h2 { margin-top: 0; }
textarea { width: 100%; box-sizing: border-box; font-family: ui-monospace, Menlo, Consolas, monospace; }
.preview { background: #f7f7f7; padding: 12px; border-radius: 6px; margin-top: 8px; }
.preview pre { background: #222; color: #eee; padding: 8px; border-radius: 4px; overflow-x: auto; }
.error { color: #b00020; }
pre { background: #f3f3f3; padding: 8px; border-radius: 4px; overflow-x: auto; }
@media (prefers-color-scheme: dark) {
    body { background: #1c1c1c; color: #eee; }
    .card { background: #2a2a2a; border-color: #444; }
    .preview { background: #333; }
    pre { background: #333; }
    .muted { color: #aaa; }
}
</style>