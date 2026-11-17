<template>
    <div class="kw-blocks" aria-label="块编辑器">
        <p class="kw-muted">块内输入 / 可插入内容。拖动手柄或用上下按钮排序；Markdown 源码随时可切换。</p>
        <div v-for="(block, index) in blocks" :key="block.id" class="kw-block" @dragover.prevent @drop.prevent="drop(index)">
            <div class="kw-block-controls"><button class="btn btn-sm" draggable="true" aria-label="拖动此块" @dragstart="drag = index; $event.dataTransfer.setData('text/plain', String(index))" @dragend="drag = null"><svg class="icon icon-sm" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5h.01M16 5h.01M8 12h.01M16 12h.01M8 19h.01M16 19h.01" stroke-linecap="round" /></svg></button><button class="btn btn-sm" :disabled="index === 0" aria-label="上移块" @click="move(index, index - 1)"><svg class="icon icon-sm" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 12 6-6 6 6M12 6v12" /></svg></button><button class="btn btn-sm" :disabled="index === blocks.length - 1" aria-label="下移块" @click="move(index, index + 1)"><svg class="icon icon-sm" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 12 6 6 6-6M12 6v12" /></svg></button><button class="btn btn-sm" aria-label="删除块" @click="remove(index)">删除</button></div>
            <textarea v-model="block.text" class="input kw-block-input" :aria-label="`内容块${index + 1}`" @input="change" @keydown.esc="menu = null" @keyup="menu = block.text === '/' ? index : menu === index ? null : menu" />
            <div v-if="menu === index" class="kw-insert" aria-label="快捷插入"><button v-for="[name, snippet] in blockSnippets" :key="name" class="btn btn-sm" @click="block.text = snippet; menu = null; change()">{{ name }}</button></div>
        </div>
        <div class="kw-row"><select v-model="snippet" class="input" aria-label="新增块类型"><option v-for="[name, value] in blockSnippets" :key="name" :value="value">{{ name }}</option></select><button class="btn" @click="blocks.push({id: ++counter, text: snippet}); change()">添加块</button></div>
    </div>
</template>
<script setup>
import { ref, watch } from 'vue';
import { splitMarkdownBlocks, blockSnippets } from '../../utils/knowledge-workbench.js';
const props = defineProps({ modelValue: { type: String, default: '' } }), emit = defineEmits(['update:modelValue']);
let counter = 0; const blocks = ref([]), menu = ref(null), snippet = ref(''), drag = ref(null);
const joined = () => blocks.value.map(b => b.text).join('\n\n');
watch(() => props.modelValue, value => { if (value !== joined()) blocks.value = splitMarkdownBlocks(value).map(text => ({ id: ++counter, text })); }, { immediate: true });
if (!blocks.value.length) blocks.value = [{ id: ++counter, text: '' }];
function change() { emit('update:modelValue', joined()); }
function move(from, to) { const [block] = blocks.value.splice(from, 1); blocks.value.splice(to, 0, block); change(); }
function drop(index) { if (drag.value !== null && drag.value !== index) move(drag.value, index); drag.value = null; }
function remove(index) { if (blocks.value[index].text && !confirm('删除这个内容块？未保存前可切回当前笔记重新加载。')) return; blocks.value.splice(index, 1); if (!blocks.value.length) blocks.value.push({ id: ++counter, text: '' }); change(); }
</script>
