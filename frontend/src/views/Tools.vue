<template>
    <div class="view-page page-tools">
        <header class="view-head tools-head">
            <div><h1 class="view-title">工具箱</h1><p class="view-subtitle">按分组整理，打开工具后可在顶部标签间切换</p></div>
            <div class="tool-order-actions">
                <span class="tool-order-hint">拖动卡片排序或移入其他分组</span>
                <button id="manage-tool-groups" class="btn btn-sm" type="button" @click="showGroups = true">管理分组</button>
                <button class="btn btn-sm tool-order-reset" type="button" @click="resetOrder">恢复默认顺序</button>
            </div>
        </header>
        <p v-if="state.saveError" class="notice notice-error" role="alert">调整已生效，但浏览器未能保存；刷新后可能恢复。<button class="btn btn-sm" type="button" @click="saveToolPreferences">重试保存</button></p>
        <div class="tool-groups">
            <section v-for="group in groups" :key="group.id" class="tool-group" :class="{ 'is-disabled': !group.enabled, 'is-group-target': dropGroupId === group.id }" :data-group-id="group.id" @dragover="overGroup(group, $event)" @drop="dropOnGroup(group, $event)" @dragleave="leaveGroup(group, $event)">
                <header class="tool-group-head">
                    <button class="tool-group-fold" type="button" :aria-expanded="group.enabled && !group.collapsed" :aria-controls="`tools-in-${group.id}`" :disabled="!group.enabled" @click="setToolGroupFlag(group.id, 'collapsed', !group.collapsed)">
                        <svg class="icon icon-sm" :class="{ 'is-folded': group.collapsed || !group.enabled }" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
                        <span>{{ group.name }}</span><span class="tool-group-count">{{ group.tools.length }}</span>
                    </button>
                    <label class="tool-group-enable"><input type="checkbox" role="switch" :checked="group.enabled" :aria-label="`启用${group.name}分组`" @change="setToolGroupFlag(group.id, 'enabled', $event.target.checked)" /><span>{{ group.enabled ? '已启用' : '已关闭' }}</span></label>
                </header>
                <div v-if="group.enabled && !group.collapsed" :id="`tools-in-${group.id}`" class="tools-grid">
                    <div v-for="tool in group.tools" :key="tool.id" class="tool-card" :class="{ planned: tool.status !== '可用', 'is-dragging': draggingId === tool.id, 'is-drop-target': dropTargetId === tool.id, 'drop-after': dropTargetId === tool.id && dropPosition === 'after' }" :data-tool-id="tool.id" draggable="true" @dragstart="startDrag(tool, $event)" @dragover.stop="dragOver(tool, $event)" @dragleave="leaveTarget(tool, $event)" @drop.stop="dropTool(tool, $event)" @dragend="finishDrag">
                        <div class="tool-card-header"><ToolIcon :tool-id="tool.id" /><div class="tool-card-meta"><span class="tool-status" :class="{ ready: tool.status === '可用' }">{{ tool.status }}</span><span class="tool-drag-handle" title="拖动排序或移动分组" aria-label="拖动排序或移动分组"><svg class="icon icon-sm" viewBox="0 0 24 24" aria-hidden="true"><circle cx="8" cy="6" r="1"/><circle cx="16" cy="6" r="1"/><circle cx="8" cy="12" r="1"/><circle cx="16" cy="12" r="1"/><circle cx="8" cy="18" r="1"/><circle cx="16" cy="18" r="1"/></svg></span></div></div>
                        <h3 class="tool-name">{{ tool.name }}</h3><p class="tool-desc">{{ tool.desc }}</p>
                        <div class="tool-card-actions"><button class="btn btn-sm" type="button" @click="$router.push({ name: tool.routeName })">{{ tool.status === '可用' ? '打开工具' : '查看详情' }}</button>
                            <select class="tool-group-select" :aria-label="`${tool.name}所属分组`" :value="group.id" @change="setToolGroup(tool.id, $event.target.value)"><option v-for="option in state.layout.groups" :key="option.id" :value="option.id">{{ option.name }}{{ option.enabled ? '' : '（已关闭）' }}</option></select>
                        </div>
                    </div>
                    <p v-if="!group.tools.length" class="tool-group-empty">暂无工具，可从其他分组拖入，或用卡片上的分组选择移动。</p>
                </div>
                <p v-else class="tool-group-summary">{{ group.enabled ? '已收起，点击分组名称展开' : '分组已关闭，启用后显示工具入口' }}</p>
            </section>
        </div>
        <p class="tool-groups-footer">分组、开关与顺序在此浏览器保存。</p>
        <ToolGroupManager v-if="showGroups" :layout="state.layout" @close="showGroups = false" @save="saveGroups" />
    </div>
</template>
<script>
import ToolIcon from '../components/ToolIcon.vue';
import ToolGroupManager from '../components/ToolGroupManager.vue';
import { groupForTool, UNGROUPED_ID } from '../utils/tool-groups.js';
import { toolWorkspace, saveToolPreferences, applyToolGroups, setToolGroup, setToolGroupFlag, moveWorkspaceTool, resetToolOrder } from '../stores/tool-workspace.js';
export default {
    name: 'Tools', components: { ToolIcon, ToolGroupManager },
    data: () => ({ state: toolWorkspace, showGroups: false, draggingId: '', dropTargetId: '', dropPosition: 'before', dropGroupId: '' }),
    computed: {
        tools() { return this.state.tools; },
        groups() { return this.state.layout.groups.map(group => ({ ...group, tools: this.tools.filter(tool => groupForTool(this.state.layout, tool.id) === group.id) })).filter(group => group.id !== UNGROUPED_ID || group.tools.length || this.draggingId); },
    },
    methods: {
        saveToolPreferences, setToolGroup, setToolGroupFlag,
        saveGroups(layout) { applyToolGroups(layout); this.showGroups = false; },
        resetOrder() { resetToolOrder(); this.finishDrag(); },
        startDrag(tool, event) {
            if (event.target.closest('button,select,input,a')) { event.preventDefault(); return; }
            this.draggingId = tool.id; this.dropTargetId = ''; this.dropGroupId = '';
            if (event.dataTransfer) { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', tool.id); }
        },
        dragOver(tool, event) {
            if (!this.draggingId || this.draggingId === tool.id) return;
            event.preventDefault(); this.dropTargetId = tool.id; this.dropGroupId = '';
            this.dropPosition = event.clientX < event.currentTarget.getBoundingClientRect().left + event.currentTarget.clientWidth / 2 ? 'before' : 'after';
            if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
        },
        dropTool(tool, event) {
            event.preventDefault();
            if (this.draggingId && this.draggingId !== tool.id) moveWorkspaceTool(this.draggingId, tool.id, this.dropPosition);
            this.finishDrag();
        },
        overGroup(group, event) {
            if (!this.draggingId || !group.enabled || event.target.closest('.tool-card')) return;
            event.preventDefault(); this.dropGroupId = group.id; this.dropTargetId = '';
        },
        dropOnGroup(group, event) {
            if (!this.draggingId || !group.enabled) return;
            event.preventDefault();
            const target = group.tools.filter(tool => tool.id !== this.draggingId).at(-1);
            if (target) moveWorkspaceTool(this.draggingId, target.id, 'after');
            else setToolGroup(this.draggingId, group.id);
            this.finishDrag();
        },
        leaveTarget(tool, event) { if (this.dropTargetId === tool.id && !event.currentTarget.contains(event.relatedTarget)) this.dropTargetId = ''; },
        leaveGroup(group, event) { if (this.dropGroupId === group.id && !event.currentTarget.contains(event.relatedTarget)) this.dropGroupId = ''; },
        finishDrag() { this.draggingId = ''; this.dropTargetId = ''; this.dropGroupId = ''; },
    },
};
</script>
<style scoped>
/* 卡片外观与首页「小工具」区块保持一致，同一组件两处呈现不割裂 */
.tools-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(228px, 100%), 1fr));
    gap: 12px;
}
.tools-head { display: flex; align-items: flex-end; justify-content: space-between; gap: var(--gap-column); flex-wrap: wrap; }
.tool-order-actions { display: flex; align-items: center; gap: var(--gap-column); flex-wrap: wrap; justify-content: flex-end; }
.tool-order-hint { color: var(--text-secondary); font-size: var(--text-secondary); }
.tool-card {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 16px;
    border-radius: var(--radius-lg);
    background: var(--panel-background);
    border: 1px solid var(--panel-border);
    transition: background var(--dur-base) var(--ease-out),
                border-color var(--dur-base) var(--ease-out),
                transform var(--dur-base) var(--ease-out);
}
.tool-card[draggable="true"] { cursor: grab; }
.tool-card[draggable="true"]:active { cursor: grabbing; }
.tool-card.is-dragging { opacity: var(--tools-drag-opacity); }
.tool-card.is-drop-target { border-color: var(--accent); box-shadow: inset var(--tools-drop-marker) 0 0 var(--accent); }
.tool-card.is-drop-target.drop-after { box-shadow: inset calc(0px - var(--tools-drop-marker)) 0 0 var(--accent); }
.tool-card.is-drop-target:hover { border-color: var(--accent); }
.tool-card:hover {
    background: var(--panel-background-hover);
    border-color: var(--accent-border);
    transform: translateY(-1px);
}
.tool-card.planned { opacity: 0.82; }
.tool-card-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
}
.tool-card-meta { display: inline-flex; align-items: center; gap: var(--adb-small-gap); }
.tool-drag-handle { display: inline-flex; align-items: center; color: var(--text-secondary); opacity: 0.85; }
/* 状态标签：可用为成功色软底，规划中为中性灰 */
.tool-status {
    display: inline-flex;
    align-items: center;
    height: 20px;
    padding: 0 8px;
    border-radius: var(--radius-pill);
    background: var(--panel-background-hover);
    color: var(--text-tertiary);
    font-size: var(--text-tag);
    font-weight: var(--weight-medium);
}
.tool-status.ready {
    background: var(--success-soft);
    color: var(--success);
}
.tool-name {
    margin: 2px 0 0;
    font-size: var(--text-doc-title);
    font-weight: var(--weight-semibold);
    color: var(--text-primary);
}
.tool-desc {
    margin: 0;
    flex: 1;
    font-size: var(--text-secondary);
    line-height: var(--line-relaxed);
    color: var(--text-tertiary);
}
.tool-card .btn { align-self: flex-start; }
</style>
