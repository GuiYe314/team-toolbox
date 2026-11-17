<template>
    <section class="kw-properties" aria-label="笔记属性">
        <label>所属资料库<select class="input" :value="modelValue.databaseId || ''" :disabled="readonly" @change="selectDatabase($event.target)"><option value="">普通笔记</option><option v-for="database in databases" :key="database.id" :value="database.id">{{ database.name }}</option></select></label>
        <label v-for="field in database?.data.fields || []" :key="field.key">{{ field.label }}<small v-if="field.type === 'person'">显示名标签</small>
            <output v-if="field.type === 'rollup'">{{ displayValue(propertyValue(noteForRollup, field, database, notes, databases), field, notes) }}</output>
            <input v-else-if="['text', 'person', 'number', 'date'].includes(field.type)" class="input" :type="field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'" :value="values[field.key] ?? ''" :readonly="readonly" :step="field.type === 'number' ? 'any' : undefined" @input="set(field.key, field.type === 'number' && $event.target.value !== '' ? Number($event.target.value) : $event.target.value)" />
            <input v-else-if="field.type === 'check'" type="checkbox" :checked="values[field.key] === true" :disabled="readonly" @change="set(field.key, $event.target.checked)" />
            <select v-else-if="field.type === 'status'" class="input" :value="values[field.key] || ''" :disabled="readonly" @change="set(field.key, $event.target.value)"><option value="">未设置</option><option v-for="option in field.options" :key="option">{{ option }}</option></select>
            <select v-else-if="field.type === 'multi'" class="input" multiple :value="values[field.key] || []" :disabled="readonly" @change="set(field.key, [...$event.target.selectedOptions].map(o => o.value))"><option v-for="option in field.options" :key="option">{{ option }}</option></select>
            <select v-else-if="field.type === 'relation'" class="input" multiple :value="values[field.key] || []" :disabled="readonly" @change="set(field.key, [...$event.target.selectedOptions].map(o => Number(o.value)))"><option v-for="target in relationCandidates(field)" :key="target.id" :value="target.id">{{ target.title }}</option><option v-for="id in (values[field.key] || []).filter(id => !relationCandidates(field).some(n => n.id === id))" :key="id" :value="id">已失效笔记 #{{ id }}</option></select>
            <span v-else-if="field.type === 'range'" class="kw-row"><input class="input" type="date" aria-label="开始日期" :readonly="readonly" :value="values[field.key]?.start || ''" @input="range(field.key, 'start', $event.target.value)" /><span>至</span><input class="input" type="date" aria-label="结束日期" :readonly="readonly" :value="values[field.key]?.end || ''" @input="range(field.key, 'end', $event.target.value)" /></span>
        </label>
    </section>
</template>
<script setup>
import { computed } from 'vue';
import { propertyValue, displayValue } from '../../utils/knowledge-workbench.js';
const props = defineProps({ modelValue: { type: Object, required: true }, databases: { type: Array, default: () => [] }, notes: { type: Array, default: () => [] }, readonly: Boolean }), emit = defineEmits(['update:modelValue']);
const database = computed(() => props.databases.find(d => d.id === props.modelValue.databaseId)), values = computed(() => props.modelValue.values), noteForRollup = computed(() => ({ meta: props.modelValue }));
function set(key, value) { emit('update:modelValue', { ...props.modelValue, values: { ...values.value, [key]: value } }); }
function selectDatabase(select) { if (Object.keys(values.value).length && !confirm('切换资料库会清空此笔记的当前属性，保存后生效。继续？')) { select.value = props.modelValue.databaseId || ''; return; } emit('update:modelValue', { ...props.modelValue, databaseId: select.value || null, values: {} }); }
function range(key, part, value) { const next = { start: '', end: '', ...values.value[key], [part]: value }; set(key, !next.start && !next.end ? null : next); }
function relationCandidates(field) { return props.notes.filter(n => n.meta.databaseId === field.target); }
</script>
