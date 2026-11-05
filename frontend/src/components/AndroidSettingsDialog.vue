<template>
    <button ref="trigger" id="adb-open-settings" class="btn btn-sm" type="button" aria-haspopup="dialog" :aria-expanded="show" :disabled="disabled" @click="open">ADB 设置</button>
    <Teleport to="body">
        <div v-if="show" class="overlay" @click.self="close" @keydown="onKeydown">
            <section ref="dialog" class="dialog adb-settings-dialog" role="dialog" aria-modal="true" aria-labelledby="adb-settings-title">
                <header class="adb-settings-head"><h2 id="adb-settings-title" class="dialog-title">ADB 设置</h2><button ref="closeButton" id="adb-settings-close" class="btn btn-sm" @click="close">关闭</button></header>
                <div class="adb-settings-body"><AndroidAdbSettings @saved="$emit('saved', $event)" /></div>
            </section>
        </div>
    </Teleport>
</template>
<script>
import AndroidAdbSettings from './AndroidAdbSettings.vue';
export default {
    name: 'AndroidSettingsDialog', components: { AndroidAdbSettings }, props: { disabled: Boolean }, emits: ['saved', 'open-change'],
    data() { return { show: false }; },
    methods: {
        async open() { this.show = true; this.$emit('open-change', true); await this.$nextTick(); this.$refs.closeButton?.focus(); },
        close() { this.show = false; this.$emit('open-change', false); this.$refs.trigger?.focus(); },
        onKeydown(event) {
            if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); this.close(); }
            if (event.key === 'Tab') {
                const items = [...this.$refs.dialog.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href]')];
                const first = items[0], last = items.at(-1);
                if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
                if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
            }
        }
    }
};
</script>
<style scoped>
.adb-settings-dialog { width: min(var(--adb-help-width), calc(100vw - var(--page-padding) * 2)); max-width: none; max-height: calc(100vh - var(--page-padding) * 2); display: flex; flex-direction: column; box-sizing: border-box; }
.adb-settings-head { display: flex; align-items: center; justify-content: space-between; gap: var(--gap-column); }
.adb-settings-head h2 { margin: 0; }
.adb-settings-body { min-height: 0; overflow-y: auto; margin-top: var(--gap-column); }
.adb-settings-body :deep(.adb-settings) { margin: 0; padding: 0; background: none; border: none; }
</style>
