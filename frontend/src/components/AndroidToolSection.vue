<template>
    <section class="adb-tool-section" :aria-labelledby="`${sectionId}-title`">
        <div class="adb-tool-section-head">
            <h2 :id="`${sectionId}-title`"><slot name="title">{{ title }}</slot></h2>
            <slot name="status"><span v-if="activity" class="adb-tool-section-activity" role="status">{{ activity }}</span></slot>
            <button :id="`${sectionId}-toggle`" class="btn btn-sm adb-tool-section-toggle" type="button"
                :aria-expanded="expanded" :aria-controls="`${sectionId}-body`" :aria-label="`${expanded ? '收起' : '展开'}${title}`" @click="expanded = !expanded">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" :class="{ collapsed: !expanded }"><path d="m6 9 6 6 6-6" /></svg>
                {{ expanded ? '收起' : '展开' }}
            </button>
        </div>
        <div v-show="expanded" :id="`${sectionId}-body`" class="adb-tool-section-body"><slot /></div>
    </section>
</template>

<script>
export default {
    name: 'AndroidToolSection',
    props: { sectionId: { type: String, required: true }, title: { type: String, required: true }, activity: { type: String, default: '' } },
    data() { return { expanded: true }; }
};
</script>

<style scoped>
.adb-tool-section { min-width: 0; padding: var(--page-padding); margin-bottom: var(--gap-column); border: var(--adb-section-border) solid var(--panel-border); border-radius: var(--radius-md); background: var(--surface-material); box-shadow: var(--surface-shadow); }
.adb-tool-section-head { display: flex; flex-wrap: wrap; align-items: center; gap: var(--gap-column); }
.adb-tool-section-head h2 { flex: 1; min-width: 0; margin: 0; font-size: var(--text-section-title); overflow-wrap: anywhere; }
.adb-tool-section-activity { color: var(--text-secondary); font-size: var(--text-body); overflow-wrap: anywhere; }
.adb-tool-section-toggle { flex: none; white-space: nowrap; }
.adb-tool-section-toggle svg { width: var(--adb-section-icon); height: var(--adb-section-icon); transition: transform var(--dur-base) var(--ease-out); }
.adb-tool-section-toggle svg.collapsed { transform: rotate(-90deg); }
.adb-tool-section-body { padding-top: var(--gap-column); min-width: 0; }
@media (prefers-reduced-motion: reduce) { .adb-tool-section-toggle svg { transition: none; } }
</style>
