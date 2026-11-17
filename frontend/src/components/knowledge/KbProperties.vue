<template>
    <section class="kw-properties" aria-label="笔记属性">
        <label>所属资料库<UiChoice :model-value="modelValue.databaseId || ''" :options="databaseOptions" :disabled="readonly" filter aria-label="所属资料库" @update:model-value="selectDatabase" /></label>
        <label v-for="field in database?.data.fields || []" :key="field.key">{{ field.label }}<small v-if="field.type === 'person'">显示名标签</small>
            <output v-if="field.type === 'rollup'">{{ displayValue(propertyValue(noteForRollup, field, database, notes, databases), field, notes) }}</output>
            <InputText v-else-if="['text', 'person'].includes(field.type)" :model-value="values[field.key] ?? ''" :readonly="readonly" :aria-label="field.label" @update:model-value="set(field.key, $event)" />
            <input v-else-if="['number', 'date'].includes(field.type)" class="input" :type="field.type" :value="values[field.key] ?? ''" :readonly="readonly" :step="field.type === 'number' ? 'any' : undefined" @input="set(field.key, field.type === 'number' && $event.target.value !== '' ? Number($event.target.value) : $event.target.value)" />
            <input v-else-if="field.type === 'check'" type="checkbox" :checked="values[field.key] === true" :disabled="readonly" @change="set(field.key, $event.target.checked)" />
            <UiChoice v-else-if="field.type === 'status'" :model-value="values[field.key] || ''" :options="[{ value: '', label: '未设置' }, ...field.options.map(value => ({ value, label: value }))]" :disabled="readonly" :aria-label="field.label" @update:model-value="set(field.key, $event)" />
            <UiChoice v-else-if="field.type === 'multi'" :model-value="values[field.key] || []" :options="field.options.map(value => ({ value, label: value }))" :disabled="readonly" multiple filter :aria-label="field.label" @update:model-value="set(field.key, $event)" />
            <UiChoice v-else-if="field.type === 'relation'" :model-value="values[field.key] || []" :options="relationOptions(field)" :disabled="readonly" multiple filter :aria-label="field.label" @update:model-value="set(field.key, $event)" />
            <span v-else-if="field.type === 'range'" class="kw-row"><input class="input" type="date" aria-label="开始日期" :readonly="readonly" :value="values[field.key]?.start || ''" @input="range(field.key, 'start', $event.target.value)" /><span>至</span><input class="input" type="date" aria-label="结束日期" :readonly="readonly" :value="values[field.key]?.end || ''" @input="range(field.key, 'end', $event.target.value)" /></span>
        </label>
    </section>
</template>
<script setup>
import { computed } from 'vue';
import { propertyValue, displayValue } from '../../utils/knowledge-workbench.js';
import UiChoice from '../ui/UiChoice.vue';
import InputText from 'primevue/inputtext';
const props = defineProps({ modelValue: { type: Object, required: true }, databases: { type: Array, default: () => [] }, notes: { type: Array, default: () => [] }, readonly: Boolean }), emit = defineEmits(['update:modelValue']);
const database = computed(() => props.databases.find(d => d.id === props.modelValue.databaseId)), values = computed(() => props.modelValue.values), noteForRollup = computed(() => ({ meta: props.modelValue }));
const databaseOptions = computed(() => [{ value: '', label: '普通笔记' }, ...props.databases.map(item => ({ value: item.id, label: item.name }))]);
function set(key, value) { emit('update:modelValue', { ...props.modelValue, values: { ...values.value, [key]: value } }); }
function selectDatabase(value) { if (value === (props.modelValue.databaseId || '')) return; if (Object.keys(values.value).length && !confirm('切换资料库会清空此笔记的当前属性，保存后生效。继续？')) return; emit('update:modelValue', { ...props.modelValue, databaseId: value || null, values: {} }); }
function range(key, part, value) { const next = { start: '', end: '', ...values.value[key], [part]: value }; set(key, !next.start && !next.end ? null : next); }
function relationCandidates(field) { return props.notes.filter(n => n.meta.databaseId === field.target); }
function relationOptions(field) { const candidates = relationCandidates(field); return [...candidates.map(note => ({ value: note.id, label: note.title })), ...(values.value[field.key] || []).filter(id => !candidates.some(note => note.id === id)).map(id => ({ value: id, label: `已失效笔记 #${id}` }))]; }
</script>
