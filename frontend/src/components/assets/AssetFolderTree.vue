<template>
    <!--
      文件夹树。
      刻意自己实现而不引树组件库（用户要求「第一版可以自己轻量实现」）：
      现有 PageTree.vue 已是成熟的递归 + 展开态 + 行内重命名范式，
      照它写一份能保持两处交互完全一致，也省掉一个依赖。
    -->
    <div class="am-tree">
        <div v-for="node in nodes" :key="node.id" class="am-tree-node">
            <div
                class="am-tree-row"
                :class="{ 'is-active': node.id === activeId }"
                :style="{ paddingLeft: (4 + depth * 14) + 'px' }"
                role="treeitem"
                :aria-expanded="node.children.length ? String(!!expanded[node.id]) : undefined"
                tabindex="0"
                @click="$emit('open', node)"
                @keydown.enter.prevent="$emit('open', node)"
                @keydown.space.prevent="$emit('open', node)"
                @dragover.prevent="onDragOver(node, $event)"
                @drop.prevent="onDrop(node, $event)"
            >
                <button
                    v-if="node.children.length"
                    class="am-tree-caret"
                    :class="{ open: !!expanded[node.id] }"
                    :aria-label="expanded[node.id] ? '收起' : '展开'"
                    @click.stop="$emit('toggle', node.id)"
                >
                    <svg class="icon icon-sm" viewBox="0 0 24 24" aria-hidden="true">
                        <polyline points="9 18 15 12 9 6" />
                    </svg>
                </button>
                <span v-else class="am-tree-caret is-placeholder" aria-hidden="true"></span>

                <svg class="icon icon-sm am-tree-icon" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M3 6.5h18v4H3z" />
                    <path d="M5 10.5v8.5a1.5 1.5 0 0 0 1.5 1.5h11a1.5 1.5 0 0 0 1.5-1.5v-8.5" />
                </svg>

                <input
                    v-if="renamingId === node.id"
                    ref="renameInput"
                    class="am-tree-rename"
                    type="text"
                    maxlength="100"
                    :value="node.name"
                    aria-label="重命名文件夹"
                    @click.stop
                    @keydown.enter.stop.prevent="$emit('rename-submit', node, $event.target.value)"
                    @keydown.esc.stop.prevent="$emit('rename-cancel')"
                    @blur="$emit('rename-submit', node, $event.target.value)"
                />
                <span v-else class="am-tree-label">{{ node.name }}</span>

                <span v-if="renamingId !== node.id" class="am-tree-count">{{ node.assetCount }}</span>

                <span v-if="renamingId !== node.id" class="am-tree-actions">
                    <button
                        v-hint
                        class="am-tree-act"
                        type="button"
                        title="新建子文件夹"
                        aria-label="新建子文件夹"
                        @click.stop="$emit('create-child', node)"
                    >
                        <svg class="icon icon-sm" viewBox="0 0 24 24" aria-hidden="true">
                            <line x1="12" y1="5" x2="12" y2="19" />
                            <line x1="5" y1="12" x2="19" y2="12" />
                        </svg>
                    </button>
                    <button
                        v-hint
                        class="am-tree-act"
                        type="button"
                        title="更多操作"
                        aria-label="文件夹更多操作"
                        @click.stop="$emit('menu', node, $event)"
                    >
                        <svg class="icon icon-sm" viewBox="0 0 24 24" aria-hidden="true">
                            <circle cx="12" cy="5" r="1.4" />
                            <circle cx="12" cy="12" r="1.4" />
                            <circle cx="12" cy="19" r="1.4" />
                        </svg>
                    </button>
                </span>
            </div>

            <!-- 递归子级 -->
            <AssetFolderTree
                v-if="node.children.length && expanded[node.id]"
                :nodes="node.children"
                :depth="depth + 1"
                :active-id="activeId"
                :expanded="expanded"
                :renaming-id="renamingId"
                :drop-target-id="dropTargetId"
                @open="$emit('open', $event)"
                @toggle="$emit('toggle', $event)"
                @create-child="$emit('create-child', $event)"
                @menu="(n, e) => $emit('menu', n, e)"
                @rename-submit="(node, val) => $emit('rename-submit', node, val)"
                @rename-cancel="$emit('rename-cancel')"
                @drag-over="(n) => $emit('drag-over', n)"
                @drop="(n, e) => $emit('drop', n, e)"
            />
        </div>
    </div>
</template>

<script>
export default {
    name: 'AssetFolderTree',
    props: {
        nodes: { type: Array, default: () => [] },
        depth: { type: Number, default: 0 },
        activeId: { type: Number, default: null },
        expanded: { type: Object, default: () => ({}) },
        renamingId: { type: Number, default: null },
        dropTargetId: { type: Number, default: null }
    },
    emits: ['open', 'toggle', 'create-child', 'menu', 'rename-submit', 'rename-cancel', 'drag-over', 'drop'],
    methods: {
        /**
         * 拖拽悬停：允许把资源拖进文件夹（用户要求「支持将资源拖入文件夹」）。
         * 只向上抛事件，真正的数据移动由父组件在 drop 时调批量移动接口。
         */
        onDragOver(node) {
            this.$emit('drag-over', node);
        },
        onDrop(node, ev) {
            this.$emit('drop', node, ev);
        }
    }
};
</script>

<style scoped>
.am-tree-row {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 32px;
    padding-right: 4px;
    border-radius: var(--radius-sm);
    border: 1px solid transparent;
    cursor: pointer;
    color: var(--text-secondary);
    transition: background var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);
}
.am-tree-row:hover { background: var(--hover-background); color: var(--text-primary); }
.am-tree-row.is-active {
    background: var(--selected-background);
    border-color: var(--selected-border);
    color: var(--text-primary);
    font-weight: var(--weight-medium);
}
.am-tree-row:focus-visible {
    outline: none;
    border-color: var(--accent-border);
    box-shadow: 0 0 0 3px var(--focus-ring);
}
.am-tree-caret {
    display: grid;
    place-items: center;
    width: 18px;
    height: 18px;
    flex: none;
    border: none;
    background: none;
    color: var(--text-tertiary);
    cursor: pointer;
    transition: transform var(--dur-fast) var(--ease-out);
}
.am-tree-caret.open { transform: rotate(90deg); }
.am-tree-caret.is-placeholder { pointer-events: none; }
.am-tree-icon { color: var(--text-tertiary); flex: none; }
.am-tree-label {
    flex: 1;
    min-width: 0;
    font-size: var(--text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.am-tree-count {
    flex: none;
    font-size: var(--text-tag);
    color: var(--text-tertiary);
    font-variant-numeric: tabular-nums;
    padding: 0 5px;
}
.am-tree-actions {
    display: flex;
    gap: 1px;
    flex: none;
    /* 默认隐藏，hover / focus 时出现 —— 保持列表干净 */
    opacity: 0;
    transition: opacity var(--dur-fast) var(--ease-out);
}
.am-tree-row:hover .am-tree-actions,
.am-tree-row:focus-within .am-tree-actions { opacity: 1; }
.am-tree-act {
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--text-tertiary);
    cursor: pointer;
    transition: background var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);
}
.am-tree-act:hover { background: var(--hover-background); color: var(--text-primary); }
.am-tree-rename {
    flex: 1;
    min-width: 0;
    height: 24px;
    padding: 0 6px;
    border-radius: 6px;
    border: 1px solid var(--accent-border);
    background: var(--panel-background);
    color: var(--text-primary);
    font-family: inherit;
    font-size: var(--text-secondary);
}
</style>