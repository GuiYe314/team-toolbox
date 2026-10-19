<template>
    <div class="page-tree">
        <div v-for="node in nodes" :key="node.id" class="tree-node">
            <div
                class="tree-row"
                :class="{ active: node.id === activeId }"
                :style="{ paddingLeft: (8 + depth * 16) + 'px' }"
                role="button"
                tabindex="0"
                @click="$emit('open', node)"
                @keydown.enter.prevent="$emit('open', node)"
                @keydown.space.prevent="$emit('open', node)"
            >
                <button
                    v-if="node.children.length"
                    class="tree-caret"
                    :class="{ open: !!expanded[node.id] }"
                    :aria-label="expanded[node.id] ? '收起子页面' : '展开子页面'"
                    :aria-expanded="!!expanded[node.id]"
                    @click.stop="$emit('toggle', node.id)"
                >›</button>
                <span v-else class="tree-caret is-placeholder" aria-hidden="true"></span>

                <DocIcon class="tree-icon" :size="14" />

                <input
                    v-if="renamingId === node.id"
                    ref="renameInput"
                    v-focus
                    class="tree-rename"
                    type="text"
                    maxlength="100"
                    :value="node.title"
                    aria-label="重命名页面"
                    @click.stop
                    @keydown.enter.stop.prevent="commit(node, $event)"
                    @keydown.esc.stop.prevent="$emit('rename-cancel')"
                    @blur="commit(node, $event)"
                />
                <span v-else class="tree-label">{{ node.title || '无标题' }}</span>

                <span v-if="renamingId !== node.id" class="tree-actions">
                    <button
                        class="tree-act"
                        type="button"
                        title="新建子页面"
                        aria-label="新建子页面"
                        @click.stop="$emit('create-child', node)"
                    >＋</button>
                    <button
                        class="tree-act"
                        type="button"
                        title="更多操作"
                        aria-label="更多操作"
                        @click.stop="$emit('menu', node, $event)"
                    >···</button>
                </span>
            </div>

            <PageTree
                v-if="node.children.length && expanded[node.id]"
                :nodes="node.children"
                :depth="depth + 1"
                :active-id="activeId"
                :expanded="expanded"
                :renaming-id="renamingId"
                @open="$emit('open', $event)"
                @toggle="$emit('toggle', $event)"
                @create-child="$emit('create-child', $event)"
                @menu="(n, e) => $emit('menu', n, e)"
                @rename-submit="(n, t) => $emit('rename-submit', n, t)"
                @rename-cancel="$emit('rename-cancel')"
            />
        </div>
    </div>
</template>

<script>
// 递归页面树：二级菜单内按父子层级展示页面——子页面缩进显示在其父页面下方，
// 通过 › 箭头展开/收起；展开状态记忆与菜单/删除确认由 App.vue 统一持有。
import DocIcon from './DocIcon.vue';

export default {
    name: 'PageTree',
    components: { DocIcon },
    props: {
        nodes: { type: Array, default: () => [] },
        depth: { type: Number, default: 0 },
        activeId: { type: Number, default: null },
        expanded: { type: Object, default: () => ({}) },
        renamingId: { type: Number, default: null }
    },
    emits: ['open', 'toggle', 'create-child', 'menu', 'rename-submit', 'rename-cancel'],
    directives: {
        focus: {
            mounted(el) {
                el.focus();
                el.select();
            }
        }
    },
    methods: {
        commit(node, ev) {
            this.$emit('rename-submit', node, ev.target.value);
        }
    }
};
</script>

<style scoped>
.page-tree {
    display: flex;
    flex-direction: column;
    gap: 1px;
}

.tree-row {
    display: flex;
    align-items: center;
    gap: 4px;
    min-height: 28px;
    padding-right: 6px;
    border-radius: 6px;
    color: var(--color-sidebar-text);
    font-size: 14px;
    cursor: pointer;
    user-select: none;
    transition: background 0.1s;
}
.tree-row:hover {
    background: var(--color-sidebar-hover);
}
.tree-row:focus-visible {
    outline: 2px solid var(--color-focus);
    outline-offset: -2px;
}
.tree-row.active {
    background: var(--color-sidebar-active);
    color: var(--color-text);
    font-weight: 500;
}

.tree-caret {
    flex-shrink: 0;
    width: 18px;
    height: 18px;
    padding: 0;
    border: none;
    background: none;
    color: var(--color-text-faint);
    font-size: 14px;
    line-height: 1;
    border-radius: 4px;
    cursor: pointer;
    transition: transform 0.12s, background 0.12s, color 0.12s;
}
.tree-caret:hover {
    background: var(--color-sidebar-active);
    color: var(--color-text);
}
.tree-caret.open {
    transform: rotate(90deg);
}
.tree-caret.is-placeholder {
    cursor: default;
    pointer-events: none;
}

.tree-icon {
    flex-shrink: 0;
    width: 16px;
    margin: 0 1px;
    color: var(--color-text-faint);
}

.tree-label {
    flex: 1;
    min-width: 0;
    padding: 4px 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.tree-rename {
    flex: 1;
    min-width: 0;
    border: 1px solid var(--color-focus);
    border-radius: 4px;
    padding: 1px 4px;
    font-size: 13px;
    font-family: inherit;
    color: var(--color-text);
    background: var(--color-surface);
    outline: none;
}

.tree-actions {
    display: flex;
    align-items: center;
    gap: 1px;
    opacity: 0;
    transition: opacity 0.1s;
}
.tree-row:hover .tree-actions,
.tree-row:focus-within .tree-actions {
    opacity: 1;
}
.tree-act {
    width: 22px;
    height: 22px;
    padding: 0;
    border: none;
    background: none;
    border-radius: 4px;
    color: var(--color-text-muted);
    font-size: 13px;
    line-height: 1;
    cursor: pointer;
}
.tree-act:hover {
    background: var(--color-sidebar-active);
    color: var(--color-text);
}
.tree-act:focus-visible {
    outline: 2px solid var(--color-focus);
    outline-offset: 1px;
}

@media (max-width: 768px) {
    .tree-actions {
        opacity: 1;
    }
}
</style>
