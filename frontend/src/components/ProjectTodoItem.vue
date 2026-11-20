<template>
    <li class="project-todo-row" :class="{ 'is-archived': todo.isArchived }" :data-todo-id="todo.id">
        <input class="project-todo-check" type="checkbox" :checked="todo.isArchived" :disabled="disabled"
            :aria-label="`${todo.isArchived ? '恢复' : '完成并归档'}：${todo.projectName} — ${todo.issue}`"
            @change="$emit('archive', $event)" />
        <div class="project-todo-body">
            <div class="project-todo-key"><span>{{ todo.projectName }}</span><b>—</b><strong>{{ todo.issue }}</strong></div>
            <p v-if="todo.details" class="project-todo-details">{{ todo.details }}</p>
            <ul class="project-todo-facts" aria-label="待办属性">
                <li :class="{ 'project-overdue': ['urgent', 'high'].includes(todo.priority) }">{{ todoPriorities[todo.priority] }}优先级</li>
                <li v-if="todo.assignee">负责人 {{ todo.assignee }}</li>
                <li v-if="todo.dueDate" :class="{ 'project-overdue': overdue }">{{ overdue ? '逾期' : '截止' }} {{ todo.dueDate }}</li>
                <li v-for="tag in todo.tags" :key="tag">#{{ tag }}</li>
            </ul>
            <p class="project-todo-meta">{{ todo.isArchived ? `归档于 ${formatTime(todo.archivedAt)}` : todoStages[todo.stage] }}</p>
        </div>
        <div class="project-todo-actions">
            <button v-if="!todo.isArchived" class="btn btn-sm project-todo-stage" type="button" :disabled="disabled"
                @click="$emit('stage', todo.stage === 'pending' ? 'doing' : 'pending')">{{ todo.stage === 'pending' ? '开始处理' : '退回待处理' }}</button>
            <button class="btn btn-sm" type="button" :disabled="disabled" @click="$emit('edit')">{{ todo.isArchived ? '查看 / 编辑' : '编辑' }}</button>
            <button class="btn btn-sm btn-danger project-todo-delete" type="button" :disabled="disabled" @click="$emit('remove')">删除</button>
        </div>
    </li>
</template>

<script setup>
import { todoPriorities, todoStages } from '../utils/project-management.js';

defineProps({ todo: { type: Object, required: true }, disabled: Boolean, overdue: Boolean });
defineEmits(['archive', 'stage', 'edit', 'remove']);

function formatTime(value) {
    return new Date(value).toLocaleString('zh-CN', { hour12: false });
}
</script>
