<template>
    <div class="page-tree">
        <div v-for="node in nodes" :key="node.id" class="tree-node">
            <div
                class="tree-row"
                :class="{ active: node.id === activeId }"
                :style="{ paddingLeft: (6 + depth * 14) + 'px' }"
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
                >
                    <svg class="icon icon-sm" viewBox="0 0 24 24" aria-hidden="true">
                        <polyline points="9 18 15 12 9 6" />
                    </svg>
                </button>
                <span v-else class="tree-caret is-placeholder" aria-hidden="true"></span>

                <svg class="icon icon-sm tree-icon" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 3 14 8 19 8" />
                </svg>

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
                    >
                        <svg class="icon icon-sm" viewBox="0 0 24 24" aria-hidden="true">
                            <line x1="12" y1="5" x2="12" y2="19" />
                            <line x1="5" y1="12" x2="19" y2="12" />
                        </svg>
                    </button>
                    <button
                        class="tree-act"
                        type="button"
                        title="更多操作"
                        aria-label="更多操作"
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
// 递归页面树：按父子层级展示页面——子页面缩进显示在其父页面下方，
// 通过箭头展开/收起；展开状态记忆与菜单/删除确认由 App.vue 统一持有。
export default {
    name: 'PageTree',
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
    gap: 7px;
    min-height: 38px;
    padding-right: 8px;
    border-radius: var(--radius-sm);
    color: var(--text-secondary);
    font-size: var(--text-doc-title);
    cursor: pointer;
    user-select: none;
    border: 1px solid transparent;
    transition: background var(--dur-base) var(--ease-out),
                color var(--dur-base) var(--ease-out),
                border-color var(--dur-base) var(--ease-out);
}
.tree-row:hover {
    background: var(--hover-background);
    color: var(--text-primary);
}
.tree-row:focus-visible {
    outline: none;
    border-color: var(--accent-border);
    box-shadow: 0 0 0 3px var(--focus-ring);
}
.tree-row.active {
    background: var(--selected-background);
    border-color: var(--selected-border);
    color: var(--text-primary);
    font-weight: var(--weight-medium);
}

.tree-caret {
    flex: none;
    display: grid;
    place-items: center;
    width: 20px;
    height: 20px;
    padding: 0;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--text-tertiary);
    cursor: pointer;
    transition: transform var(--dur-base) var(--ease-out),
                background var(--dur-fast) var(--ease-out),
                color var(--dur-fast) var(--ease-out);
}
.tree-caret:hover { background: var(--hover-background); color: var(--text-primary); }
.tree-caret.open { transform: rotate(90deg); }
.tree-caret.is-placeholder { cursor: default; pointer-events: none; }

.tree-icon { color: var(--text-tertiary); }
.tree-row.active .tree-icon { color: var(--accent); }

.tree-label {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.tree-rename {
    flex: 1;
    min-width: 0;
    height: 28px;
    padding: 0 8px;
    border-radius: 7px;
    border: 1px solid var(--accent-border);
    background: var(--surface-solid);
    color: var(--text-primary);
    font-family: inherit;
    font-size: var(--text-doc-title);
    outline: none;
}

.tree-actions {
    display: flex;
    align-items: center;
    gap: 1px;
    opacity: 0;
    transition: opacity var(--dur-base) var(--ease-out);
}
.tree-row:hover .tree-actions,
.tree-row:focus-within .tree-actions { opacity: 1; }

.tree-act {
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    padding: 0;
    border: none;
    border-radius: 7px;
    background: transparent;
    color: var(--text-tertiary);
    cursor: pointer;
    transition: background var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);
}
.tree-act:hover { background: var(--hover-background); color: var(--text-primary); }
.tree-act:focus-visible { outline: none; box-shadow: 0 0 0 3px var(--focus-ring); }
</style>