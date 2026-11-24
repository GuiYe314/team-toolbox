<template>
    <IntegrationDialog title="编辑首页" @close="$emit('close')">
        <div class="home-editor">
            <section class="ext-stack" aria-label="可添加内容">
                <div class="ext-actions" role="group" aria-label="内容类型">
                    <button class="btn btn-sm" type="button" :aria-pressed="!chooseDocs" @click="chooseDocs = false">功能与工具</button>
                    <button id="home-pick-documents" class="btn btn-sm" type="button" :aria-pressed="chooseDocs" @click="openDocuments">知识库文档</button>
                </div>
                <input v-model.trim="keyword" class="input" type="search" aria-label="搜索可添加内容" placeholder="搜索名称…" maxlength="100" />
                <p v-if="chooseDocs && documentsLoading" class="ext-hint" role="status">正在加载文档…</p>
                <div v-else-if="chooseDocs && documentsError" class="ext-actions">
                    <p class="ext-hint" role="alert">{{ documentsError }}</p>
                    <button class="btn btn-sm" type="button" @click="$emit('load-documents')">重试</button>
                </div>
                <p v-else-if="!choices.length" class="ext-hint">没有匹配的内容</p>
                <ul v-else class="home-editor-list">
                    <li v-for="item in choices" :key="item.id" class="home-editor-row">
                        <span>{{ item.name }}</span>
                        <button class="btn btn-sm" type="button" :data-home-add="item.id"
                            :aria-label="'添加 ' + item.name"
                            :disabled="draft.shortcuts.includes(item.id) || draft.shortcuts.length >= HOME_SHORTCUT_LIMIT"
                            @click="draft.shortcuts.push(item.id)">
                            {{ draft.shortcuts.includes(item.id) ? '已添加' : '添加' }}
                        </button>
                    </li>
                </ul>
                <p v-if="chooseDocs && choices.length < matchingCount" class="ext-hint">只显示前 80 条，请搜索文档标题。</p>
            </section>
            <section class="ext-stack" aria-label="首页显示顺序">
                <h2>已添加</h2>
                <p v-if="!selected.length" class="ext-hint">选择你想显示的内容。</p>
                <ol v-else class="home-editor-list">
                    <li v-for="(item, index) in selected" :key="item.id" :data-home-selected="item.id" class="home-editor-row">
                        <span>{{ item.name }}</span>
                        <div class="ext-actions home-editor-controls">
                            <button class="btn btn-sm" type="button" :aria-label="'上移 ' + item.name" :disabled="index === 0" @click="move(index, -1)">↑</button>
                            <button class="btn btn-sm" type="button" :aria-label="'下移 ' + item.name" :disabled="index === selected.length - 1" @click="move(index, 1)">↓</button>
                            <button class="btn btn-sm" type="button" :aria-label="'移除 ' + item.name" @click="draft.shortcuts.splice(index, 1)">移除</button>
                        </div>
                    </li>
                </ol>
                <p v-if="draft.shortcuts.length >= HOME_SHORTCUT_LIMIT" class="ext-hint">首页最多显示 {{ HOME_SHORTCUT_LIMIT }} 个快捷入口。</p>
            </section>
        </div>
        <label class="home-recent-toggle">
            <input id="home-show-recent" v-model="draft.showRecent" type="checkbox" /> 显示最近更新
        </label>
        <p v-if="saveError" class="ext-notice is-error" role="alert">{{ saveError }}</p>
        <div class="ext-actions home-editor-footer">
            <button class="btn" type="button" @click="$emit('close')">取消</button>
            <button id="home-layout-save" class="btn btn-primary" type="button" @click="$emit('save', draft)">保存首页</button>
        </div>
    </IntegrationDialog>
</template>

<script setup>
import { computed, reactive, ref } from 'vue';
import IntegrationDialog from './IntegrationDialog.vue';
import { HOME_SHORTCUT_LIMIT, homeShortcuts, normalizeHomeLayout, resolveHomeShortcut } from '../utils/home-layout.js';

const props = defineProps({
    layout: { type: Object, required: true },
    documents: { type: Map, required: true },
    documentsLoading: Boolean,
    documentsError: String,
    saveError: String
});
const emit = defineEmits(['close', 'save', 'load-documents']);
const draft = reactive(normalizeHomeLayout(props.layout));
const chooseDocs = ref(false);
const keyword = ref('');
const matching = computed(() => {
    const items = chooseDocs.value
        ? Array.from(props.documents, ([id, doc]) => ({ id: 'doc:' + id, name: doc.title }))
        : homeShortcuts;
    const search = keyword.value.toLocaleLowerCase();
    return items.filter(item => item.name.toLocaleLowerCase().includes(search));
});
const matchingCount = computed(() => matching.value.length);
const choices = computed(() => matching.value.slice(0, 80));
const selected = computed(() => draft.shortcuts.map(key => resolveHomeShortcut(key, props.documents)));

function openDocuments() {
    chooseDocs.value = true;
    emit('load-documents');
}

function move(index, direction) {
    const target = index + direction;
    if (target < 0 || target >= draft.shortcuts.length) return;
    const [item] = draft.shortcuts.splice(index, 1);
    draft.shortcuts.splice(target, 0, item);
}
</script>

<style scoped>
.home-editor {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--ext-gap-lg);
}
.home-editor-list {
    display: grid;
    align-content: start;
    gap: var(--ext-gap-xs);
    max-height: var(--ext-conversation-height);
    overflow-y: auto;
    padding: 0 var(--ext-gap-xs) 0 0;
    margin: 0;
    list-style: none;
}
.home-editor-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--ext-gap-xs);
    padding: var(--ext-gap-xs) var(--ext-gap-sm);
    border: var(--ext-border-width) solid var(--panel-border);
    border-radius: var(--radius-sm);
    background: var(--surface-solid);
}
.home-editor-row span { min-width: 0; overflow-wrap: anywhere; }
.home-editor-controls { gap: var(--ext-gap-xs); }
.home-editor [aria-pressed="true"] { color: var(--accent); border-color: var(--accent-border); background: var(--selected-material); }
.home-editor-footer { justify-content: flex-end; }
.home-recent-toggle { display: flex; align-items: center; gap: var(--ext-gap-xs); }
.home-recent-toggle input { accent-color: var(--accent); }
@media (max-width: 520px) {
    .home-editor { grid-template-columns: minmax(0, 1fr); }
}
</style>
