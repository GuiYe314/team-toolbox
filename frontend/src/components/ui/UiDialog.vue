<template>
    <Dialog ref="dialog" :visible="true" modal append-to="body" :draggable="false" :closable="false" :close-on-escape="false" dismissable-mask
        class="ext-dialog glass-panel ui-dialog" :aria-label="title" tabindex="-1" :pt="{ mask: { class: 'ext-overlay ui-dialog-mask' } }"
        @show="focusPanel" @update:visible="!$event && $emit('close')" @keydown="keydown">
        <template #container>
            <header class="ext-dialog-head"><h2>{{ title }}</h2><Button class="btn-sm" type="button" aria-label="关闭弹窗" @click="$emit('close')">关闭</Button></header>
            <div class="ext-stack"><slot /></div>
        </template>
    </Dialog>
</template>
<script setup>
import { nextTick, onBeforeUnmount, ref } from 'vue';
import Dialog from 'primevue/dialog';
import Button from 'primevue/button';
defineProps({ title: { type: String, required: true } });
const emit = defineEmits(['close']), dialog = ref(null);
const previousFocus = document.activeElement;
async function focusPanel() { await nextTick(); dialog.value?.container?.focus({ preventScroll: true }); }
function keydown(event) { if (event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); event.stopPropagation(); emit('close'); } }
onBeforeUnmount(() => { if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true }); });
</script>
