<template>
    <IntegrationDialog title="管理工具分组" @close="$emit('close')">
        <p class="ext-hint">关闭分组会隐藏工具入口，已打开的标签仍可使用。删除分组后，工具移入“未分组”。</p>
        <div class="tool-group-editor-list">
            <div v-for="(group, index) in draft.groups" :key="group.id" class="tool-group-editor" :data-edit-group="group.id">
                <label class="tool-group-name-field"><span class="ext-label">分组名称 · {{ count(group.id) }} 个工具</span><input v-model="group.name" :aria-label="`第${index + 1}个分组名称`" maxlength="24" :readonly="group.id === UNGROUPED_ID" /></label>
                <label class="tool-group-enable"><input v-model="group.enabled" type="checkbox" role="switch" :aria-label="`启用${group.name}分组`" /><span>{{ group.enabled ? '已启用' : '已关闭' }}</span></label>
                <div class="tool-group-editor-actions">
                    <button class="btn btn-sm" type="button" :disabled="index === 0" :aria-label="`上移${group.name}分组`" @click="moveGroup(index, -1)">上移</button>
                    <button class="btn btn-sm" type="button" :disabled="index === draft.groups.length - 1" :aria-label="`下移${group.name}分组`" @click="moveGroup(index, 1)">下移</button>
                    <button class="btn btn-sm" type="button" :disabled="group.id === UNGROUPED_ID" :aria-label="`删除${group.name}分组`" @click="removeGroup(group.id)">删除</button>
                </div>
            </div>
        </div>
        <form class="tool-group-add" @submit.prevent="addGroup">
            <label class="tool-group-name-field"><span class="ext-label">新分组名称</span><input id="new-tool-group" v-model="newName" maxlength="24" placeholder="例如：项目常用" /></label>
            <button class="btn" type="submit" :disabled="draft.groups.length >= MAX_GROUPS">添加分组</button>
        </form>
        <p v-if="error" class="notice notice-error" role="alert">{{ error }}</p>
        <div class="tool-group-dialog-footer">
            <button class="btn btn-sm" type="button" @click="draft = defaultToolGroups(); error = ''">恢复默认分组</button>
            <span class="ext-hint">在此浏览器保存 · 最多{{ MAX_GROUPS }}组</span>
            <button class="btn" type="button" @click="$emit('close')">取消</button>
            <button id="save-tool-groups" class="btn btn-primary" type="button" @click="save">保存分组</button>
        </div>
    </IntegrationDialog>
</template>

<script setup>
import { ref } from 'vue';
import IntegrationDialog from './IntegrationDialog.vue';
import { defaultToolGroups, normalizeToolGroups, deleteToolGroup, groupNameError, MAX_GROUPS, UNGROUPED_ID } from '../utils/tool-groups.js';
const props = defineProps({ layout: { type: Object, required: true } }), emit = defineEmits(['close', 'save']);
const draft = ref(normalizeToolGroups(props.layout)), newName = ref(''), error = ref('');
const count = id => Object.values(draft.value.assignments).filter(groupId => groupId === id).length;
function addGroup() {
    error.value = groupNameError(newName.value, draft.value.groups);
    if (error.value || draft.value.groups.length >= MAX_GROUPS) return;
    const id = `group-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    draft.value.groups.push({ id, name: newName.value.trim(), enabled: true, collapsed: false }); newName.value = '';
}
function moveGroup(index, offset) {
    const target = index + offset;
    if (target < 0 || target >= draft.value.groups.length) return;
    const [item] = draft.value.groups.splice(index, 1); draft.value.groups.splice(target, 0, item);
}
function removeGroup(id) { draft.value = deleteToolGroup(draft.value, id); error.value = ''; }
function save() {
    for (const group of draft.value.groups) { error.value = groupNameError(group.name, draft.value.groups, group.id); if (error.value) return; }
    emit('save', normalizeToolGroups(draft.value));
}
</script>
