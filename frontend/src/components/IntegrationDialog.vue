<template>
    <Teleport to="body">
        <div class="ext-overlay" @click.self="$emit('close')">
            <section ref="panel" class="ext-dialog glass-panel" role="dialog" aria-modal="true" :aria-label="title" tabindex="-1" @keydown="keydown">
                <header class="ext-dialog-head"><h2>{{ title }}</h2><button class="btn btn-sm" aria-label="关闭弹窗" @click="$emit('close')">关闭</button></header>
                <div class="ext-stack"><slot /></div>
            </section>
        </div>
    </Teleport>
</template>

<script setup>
import { onMounted, onBeforeUnmount, ref } from 'vue';
defineProps({ title: { type: String, required: true } });
const emit = defineEmits(['close']);
const panel = ref(null);
let previousFocus;
onMounted(() => { previousFocus = document.activeElement; panel.value?.focus(); });
onBeforeUnmount(() => { if (previousFocus?.isConnected) previousFocus.focus(); });
function keydown(event) {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); emit('close'); }
    if (event.key !== 'Tab') return;
    const nodes = [...panel.value.querySelectorAll('button, a[href], input, select, textarea, [tabindex="0"]')].filter(node => !node.disabled && node.getClientRects().length);
    const first = nodes[0], last = nodes.at(-1);
    if (!first) { event.preventDefault(); return; }
    if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.value)) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && (document.activeElement === last || document.activeElement === panel.value)) { event.preventDefault(); first.focus(); }
}
</script>
