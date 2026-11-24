<template>
    <section class="adb-tool-section" :aria-labelledby="`${sectionId}-title`">
        <div class="adb-tool-section-head">
            <h2 :id="`${sectionId}-title`"><slot name="title">{{ title }}</slot></h2>
            <slot name="status"><span v-if="activity" class="adb-tool-section-activity" role="status">{{ activity }}</span></slot>
        </div>
        <div :id="`${sectionId}-body`" class="adb-tool-section-body"><slot /></div>
    </section>
</template>

<script>
export default {
    name: 'AndroidToolSection',
    props: { sectionId: { type: String, required: true }, title: { type: String, required: true }, activity: { type: String, default: '' } }
};
</script>

<style scoped>
.adb-tool-section { min-width: 0; padding: var(--page-padding); margin-bottom: var(--gap-column); border: var(--adb-section-border) solid var(--panel-border); border-radius: var(--radius-md); background: var(--surface-material); box-shadow: var(--surface-shadow); }
.adb-tool-section-head { display: flex; flex-wrap: wrap; align-items: center; gap: var(--gap-column); }
.adb-tool-section-head h2 { flex: 1; min-width: 0; margin: 0; font-size: var(--text-section-title); overflow-wrap: anywhere; }
.adb-tool-section-activity { color: var(--text-secondary); font-size: var(--text-body); overflow-wrap: anywhere; }
.adb-tool-section-body { padding-top: var(--gap-column); min-width: 0; }
</style>
