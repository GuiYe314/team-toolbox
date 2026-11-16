<template><div class="workshop-editor" ref="container" aria-label="左右文本差异编辑器"/></template>
<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue';
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api';
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
const container = ref(null); let editor, original, modified, observer;
globalThis.MonacoEnvironment ||= { getWorker: () => new EditorWorker() };
const theme = () => document.documentElement.dataset.theme === 'dark' ? 'vs-dark' : 'vs';
onMounted(() => {
    original = monaco.editor.createModel('', 'plaintext'); modified = monaco.editor.createModel('', 'plaintext');
    editor = monaco.editor.createDiffEditor(container.value, { automaticLayout: true, theme: theme(), originalEditable: true, minimap: { enabled: false }, scrollBeyondLastLine: false, renderSideBySide: true });
    editor.setModel({ original, modified });
    observer = new MutationObserver(() => monaco.editor.setTheme(theme())); observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
});
onBeforeUnmount(() => { observer?.disconnect(); editor?.dispose(); original?.dispose(); modified?.dispose(); });
</script>
