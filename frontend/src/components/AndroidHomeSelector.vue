<template>
    <div class="adb-home-selector">
        <div class="adb-home-row"><label for="adb-home-search">搜索程序或桌面<input id="adb-home-search" v-model="search" class="input" :disabled="loading || disabled" placeholder="按包名或组件搜索" /></label><button id="adb-home-refresh" class="btn btn-sm" :disabled="loading || disabled" @click="load">{{ loading ? '读取中…' : '重新读取应用' }}</button></div>
        <p v-if="error" id="adb-home-error" class="adb-home-error" role="alert">{{ error }}</p>
        <label for="adb-home-select">{{ mode === 'lock-home' ? '目标程序（支持 HOME 入口）' : '恢复到桌面程序' }}<select id="adb-home-select" v-model="component" class="input adb-select" :disabled="loading || disabled || !filtered.length"><option value="" disabled>请选择程序</option><option v-for="home in filtered" :key="home.component" :value="home.component">{{ home.packageName }} · {{ home.component.split('/')[1] }}</option></select></label>
        <p v-if="snapshot" id="adb-home-current" class="adb-home-muted">当前用户：{{ snapshot.userId }} · 当前默认：{{ snapshot.currentHome || '尚未选择默认桌面' }}</p>
        <p v-if="!loading && snapshot && !filtered.length" class="adb-home-muted">{{ search ? '没有匹配的程序，请修改搜索。' : '设备未提供可用的 HOME 程序。' }}</p>
        <p class="adb-home-muted">仅显示手机提供的 HOME 应用。普通应用需要先声明 HOME 入口；设置默认桌面后按主页键进入。</p>
    </div>
</template>
<script>
import { androidApi } from '../api/android-client.js';
export default {
    name: 'AndroidHomeSelector',
    props: { serial: { type: String, required: true }, mode: { type: String, required: true }, disabled: Boolean },
    emits: ['change', 'busy-change'],
    data() { return { snapshot: null, component: '', search: '', loading: false, error: '' }; },
    computed: { filtered() { const term = this.search.toLowerCase().trim(); return (this.snapshot?.homes || []).filter(home => home.component.toLowerCase().includes(term)); } },
    watch: {
        component() { this.publish(); },
        filtered() { if (this.component && !this.filtered.some(home => home.component === this.component)) this.component = ''; }
    },
    mounted() { this._controller = new AbortController(); this.load(); },
    beforeUnmount() { this._disposed = true; this._controller.abort(); if (this.loading) this.$emit('busy-change', false); },
    methods: {
        applied(result) { if (this.snapshot) this.snapshot.currentHome = result.currentHome; },
        publish() { this.$emit('change', this.component && this.snapshot ? { component: this.component, userId: this.snapshot.userId } : null); },
        async load() {
            if (this.loading) return;
            this.component = ''; this.snapshot = null; this.publish(); this.error = ''; this.loading = true; this.$emit('busy-change', true);
            try { const result = await androidApi.homeApps(this.serial, this._controller.signal); if (!this._disposed) this.snapshot = result; }
            catch (error) { if (!this._disposed) this.error = error.message; }
            finally { if (!this._disposed) { this.loading = false; this.$emit('busy-change', false); } }
        }
    }
};
</script>
<style scoped>
.adb-home-selector { margin-top: var(--gap-column); padding: var(--gap-column); border-radius: var(--radius-sm); background: var(--surface-sunken); }
.adb-home-row { display: flex; align-items: flex-end; flex-wrap: wrap; gap: var(--gap-column); margin-bottom: var(--gap-column); }
.adb-home-row label { flex: 1; min-width: 0; }
.adb-home-selector label { display: block; color: var(--text-secondary); }
.adb-home-selector .input { display: block; width: 100%; box-sizing: border-box; margin-top: var(--adb-small-gap); }
.adb-home-muted { color: var(--text-secondary); font-size: var(--text-body); overflow-wrap: anywhere; line-height: var(--line-relaxed); }
.adb-home-error { color: var(--danger); overflow-wrap: anywhere; }
</style>
