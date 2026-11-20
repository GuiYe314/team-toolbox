<template>
    <div class="view-page project-todos-page">
        <header class="view-head ext-head">
            <div class="ext-stack">
                <RouterLink class="ext-back" to="/kb">返回知识库</RouterLink>
                <h1 class="view-title">项目待办</h1>
                <p class="view-subtitle">按“项目 → 待办”整理问题，完成后自动归档，随时可以恢复。</p>
            </div>
            <div class="ext-actions">
                <button id="project-todos-refresh" class="btn" :disabled="loading || busy" @click="load()">刷新</button>
                <button id="project-new" class="btn btn-primary" :disabled="loading || busy" @click="openProjectEditor()">新增项目</button>
            </div>
        </header>

        <p v-if="notice" class="workshop-success" role="status">{{ notice }}</p>
        <p v-if="error" class="workshop-error" role="alert">{{ error }}</p>

        <div class="project-todos-toolbar" role="group" aria-label="项目待办视图">
            <button id="project-todos-active" class="btn btn-sm" :class="{ 'is-active': view === 'active' }" :aria-pressed="view === 'active'" :disabled="busy" @click="changeView('active')">进行中</button>
            <button id="project-todos-archived" class="btn btn-sm" :class="{ 'is-active': view === 'archived' }" :aria-pressed="view === 'archived'" :disabled="busy" @click="changeView('archived')">已归档</button>
            <button id="project-todos-all" class="btn btn-sm" :class="{ 'is-active': view === 'all' }" :aria-pressed="view === 'all'" :disabled="busy" @click="changeView('all')">全部</button>
            <span class="project-todos-toolbar-note">{{ view === 'active' ? '完成后自动归档' : view === 'archived' ? '已完成的问题' : '全部项目与待办' }}</span>
        </div>

        <section v-if="loading && loadedView !== view" class="workshop-panel project-todos-empty" role="status">正在读取项目待办…</section>
        <section v-else-if="error && loadedView !== view" class="workshop-panel project-todos-empty">
            <strong>暂时无法读取项目待办</strong>
            <button class="btn" :disabled="loading || busy" @click="load()">重新读取</button>
        </section>
        <section v-else-if="!visibleProjects.length" class="workshop-panel project-todos-empty">
            <strong>{{ view === 'archived' ? '还没有归档待办' : '还没有项目' }}</strong>
            <p>{{ view === 'archived' ? '完成项目中的待办后，它们会自动出现在这里。' : '先建立一个项目，再把要处理的问题放到项目下面。' }}</p>
            <button v-if="view !== 'archived'" id="project-empty-new" class="btn btn-primary" @click="openProjectEditor()">新增第一个项目</button>
        </section>

        <section v-else class="project-todos-groups" aria-label="项目列表">
            <article v-for="project in visibleProjects" :key="project.id" class="workshop-panel project-group" :data-project-id="project.id">
                <header class="project-group-head">
                    <div class="project-group-title">
                        <span class="project-mark" aria-hidden="true">
                            <svg class="icon" viewBox="0 0 24 24"><path d="M4 6.5h6l2 2h8v9.5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18z" /><path d="M4 8.5h16" /></svg>
                        </span>
                        <div>
                            <h2>{{ project.name }}</h2>
                            <p v-if="project.description" class="workshop-small">{{ project.description }}</p>
                            <p class="project-progress">{{ project.activeCount }} 项进行中 · {{ project.archivedCount }} 项已归档</p>
                        </div>
                    </div>
                    <div class="ext-actions">
                        <button class="btn btn-sm" type="button" :disabled="busy" @click="openProjectEditor(project)">编辑项目</button>
                        <button class="btn btn-sm" type="button" :disabled="busy" @click="openTodoEditor(project)">新增待办</button>
                        <button v-if="!project.todoCount" class="btn btn-sm btn-danger project-delete" type="button" :disabled="busy || loading" @click="askDelete('project', project)">删除项目</button>
                    </div>
                </header>

                <div v-if="!project.todos.length" class="project-group-empty">当前视图没有待办。</div>
                <ul v-else class="project-todo-list">
                    <li v-for="todo in project.todos" :key="todo.id" class="project-todo-row" :class="{ 'is-archived': todo.isArchived }" :data-todo-id="todo.id">
                        <input class="project-todo-check" type="checkbox" :checked="todo.isArchived" :disabled="busy || loading" :aria-label="`${todo.isArchived ? '恢复' : '完成并归档'}：${project.name} — ${todo.issue}`" @change="toggleTodo(todo, project, $event)" />
                        <div class="project-todo-body">
                            <div class="project-todo-key"><span>{{ project.name }}</span><b>—</b><strong>{{ todo.issue }}</strong></div>
                            <p v-if="todo.details" class="project-todo-details">{{ todo.details }}</p>
                            <p class="project-todo-meta">{{ todo.isArchived ? `归档于 ${formatTime(todo.archivedAt)}` : `创建于 ${formatTime(todo.createdAt)}` }}</p>
                        </div>
                        <div class="project-todo-actions">
                            <button class="btn btn-sm" type="button" :disabled="busy" @click="openTodoEditor(project, todo)">{{ todo.isArchived ? '查看 / 编辑' : '编辑' }}</button>
                            <button class="btn btn-sm btn-danger project-todo-delete" type="button" :disabled="busy" @click="askDelete('todo', todo)">删除</button>
                        </div>
                    </li>
                </ul>
            </article>
        </section>

        <footer class="ext-footer">项目和待办保存在当前工具箱，同一工具箱的访问者共享；可通过知识库备份一并保存。</footer>

        <IntegrationDialog v-if="projectEditor" :title="projectEditor.id ? '编辑项目' : '新增项目'" @close="closeEditor">
            <form class="project-todo-form ext-stack" @submit.prevent="saveProject">
                <label for="project-name">项目名称<input id="project-name" v-model="projectEditor.name" class="input" maxlength="80" required :disabled="busy" placeholder="例如：Unity 工具箱" /></label>
                <label for="project-description">项目说明<textarea id="project-description" v-model="projectEditor.description" maxlength="1000" :disabled="busy" placeholder="可填写项目目标或背景" /></label>
                <p v-if="editorError" class="workshop-error" role="alert">{{ editorError }}</p>
                <div class="ext-actions"><button id="project-editor-cancel" class="btn" type="button" :disabled="busy" @click="closeEditor">取消</button><button id="project-editor-save" class="btn btn-primary" type="submit" :disabled="busy">{{ busy ? '保存中…' : '保存项目' }}</button></div>
            </form>
        </IntegrationDialog>

        <IntegrationDialog v-if="todoEditor" :title="todoEditor.id ? '编辑项目待办' : '新增项目待办'" @close="closeEditor">
            <form class="project-todo-form ext-stack" @submit.prevent="saveTodo">
                <p class="project-todo-form-project">项目：<strong>{{ todoEditor.projectName }}</strong></p>
                <label for="todo-issue">问题 / 待办<input id="todo-issue" v-model="todoEditor.issue" class="input" maxlength="200" required :disabled="busy" placeholder="例如：下载全部日志" /></label>
                <label for="todo-details">处理说明<textarea id="todo-details" v-model="todoEditor.details" maxlength="2000" :disabled="busy" placeholder="可填写处理步骤、验收条件或备注" /></label>
                <p class="workshop-note">勾选列表中的复选框后，该问题会立即进入“已归档”。</p>
                <p v-if="editorError" class="workshop-error" role="alert">{{ editorError }}</p>
                <div class="ext-actions"><button id="todo-editor-cancel" class="btn" type="button" :disabled="busy" @click="closeEditor">取消</button><button id="todo-editor-save" class="btn btn-primary" type="submit" :disabled="busy">{{ busy ? '保存中…' : '保存待办' }}</button></div>
            </form>
        </IntegrationDialog>
        <IntegrationDialog v-if="pendingDelete" :title="pendingDelete.kind === 'project' ? '删除空项目' : '删除项目待办'" @close="!busy && (pendingDelete = null)">
            <p class="project-todo-delete-copy">确定永久删除“{{ pendingDelete.label }}”吗？删除后无法撤销。</p>
            <p v-if="deleteError" class="workshop-error" role="alert">{{ deleteError }}</p>
            <div class="ext-actions">
                <button id="project-delete-cancel" class="btn" :disabled="busy" @click="pendingDelete = null">取消</button>
                <button id="project-delete-confirm" class="btn btn-danger" :disabled="busy" @click="confirmDelete">{{ busy ? '删除中…' : '确认删除' }}</button>
            </div>
        </IntegrationDialog>
    </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter, onBeforeRouteLeave, onBeforeRouteUpdate } from 'vue-router';
import IntegrationDialog from '../components/IntegrationDialog.vue';
import { projectTodosApi } from '../api/project-todos-client.js';

const route = useRoute(), router = useRouter();
const view = computed(() => ['active', 'archived', 'all'].includes(route.query.view) ? route.query.view : 'active');
const projects = ref([]), loading = ref(false), busy = ref(false), error = ref(''), notice = ref('');
const projectEditor = ref(null), todoEditor = ref(null), editorError = ref('');
const loadedView = ref(null), pendingDelete = ref(null), deleteError = ref('');
const originalEditor = ref('');
const draftDirty = computed(() => !!(projectEditor.value || todoEditor.value)
    && JSON.stringify(projectEditor.value || todoEditor.value) !== originalEditor.value);
let alive = true, revision = 0, readController, writeController;

const visibleProjects = computed(() => view.value === 'archived'
    ? projects.value.filter(project => project.todos?.length)
    : projects.value);
function formatTime(value) { return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '—'; }
function closeEditor() {
    if (busy.value || draftDirty.value && !window.confirm('编辑内容尚未保存，确定放弃吗？')) return false;
    projectEditor.value = null; todoEditor.value = null;
    return true;
}
function canLeave() {
    if (!closeEditor()) return false;
    pendingDelete.value = null;
    return true;
}
onBeforeRouteLeave(canLeave); onBeforeRouteUpdate(canLeave);
function beforeUnload(event) {
    if (draftDirty.value || busy.value) { event.preventDefault(); event.returnValue = ''; }
}

async function load({ keepError = false } = {}) {
    const own = ++revision, nextView = view.value;
    readController?.abort();
    const controller = readController = new AbortController();
    loading.value = true;
    if (!keepError) error.value = '';
    try {
        const result = await projectTodosApi.state(nextView, controller.signal);
        if (alive && own === revision) { projects.value = result.projects; loadedView.value = nextView; }
    }
    catch (failure) { if (alive && own === revision && !controller.signal.aborted) error.value = failure.message; }
    finally { if (alive && own === revision) loading.value = false; }
}
function changeView(next) {
    if (busy.value || view.value === next) return;
    router.replace({ name: 'kb-project-todos', query: next === 'active' ? {} : { view: next } });
}
function openProjectEditor(item) {
    if (busy.value || loading.value) return;
    editorError.value = '';
    projectEditor.value = item ? { id: item.id, version: item.version, name: item.name, description: item.description } : { name: '', description: '' };
    originalEditor.value = JSON.stringify(projectEditor.value);
}
function openTodoEditor(project, item) {
    if (busy.value || loading.value) return;
    editorError.value = '';
    todoEditor.value = { projectId: project.id, projectName: project.name, ...(item ? { id: item.id, version: item.version, issue: item.issue, details: item.details } : { issue: '', details: '' }) };
    originalEditor.value = JSON.stringify(todoEditor.value);
}
async function write(action, success, failure) {
    if (busy.value) return;
    readController?.abort(); revision++; loading.value = false;
    busy.value = true; notice.value = ''; error.value = '';
    const controller = writeController = new AbortController();
    try {
        const saved = await action(controller.signal);
        if (!alive || controller.signal.aborted) return;
        success(saved);
        await load();
    }
    catch (reason) { if (alive && !controller.signal.aborted) await failure(reason); }
    finally { if (alive) busy.value = false; }
}
function saveProject() {
    const draft = projectEditor.value;
    if (!draft) return;
    editorError.value = '';
    return write(signal => projectTodosApi.saveProject({ name: draft.name, description: draft.description, ...(draft.id ? { version: draft.version } : {}) }, draft.id, signal),
        saved => { projectEditor.value = null; notice.value = `项目“${saved.name}”已保存`; },
        failure => { editorError.value = failure.message; });
}
function saveTodo() {
    const draft = todoEditor.value;
    if (!draft) return;
    editorError.value = '';
    return write(signal => projectTodosApi.saveTodo({ issue: draft.issue, details: draft.details, ...(draft.id ? { version: draft.version } : {}) }, draft.projectId, draft.id, signal),
        () => { todoEditor.value = null; notice.value = '项目待办已保存'; },
        failure => { editorError.value = failure.message; });
}
function toggleTodo(item, project, event) {
    // 以服务器保存结果为准；失败时复选框保持原状态。
    event.target.checked = item.isArchived;
    return write(signal => projectTodosApi.archiveTodo(item, !item.isArchived, signal),
        () => { notice.value = item.isArchived ? `已恢复“${project.name} — ${item.issue}”` : `已完成并归档“${project.name} — ${item.issue}”`; },
        async failure => { error.value = failure.message; await load({ keepError: true }); });
}
function askDelete(kind, item) {
    if (busy.value || loading.value) return;
    deleteError.value = '';
    pendingDelete.value = { kind, item, label: kind === 'project' ? item.name : `${item.projectName} — ${item.issue}` };
}
function confirmDelete() {
    const pending = pendingDelete.value;
    if (!pending) return;
    deleteError.value = '';
    return write(signal => pending.kind === 'project' ? projectTodosApi.removeProject(pending.item, signal) : projectTodosApi.removeTodo(pending.item, signal),
        () => { pendingDelete.value = null; notice.value = pending.kind === 'project' ? '项目已删除' : '待办已删除'; },
        failure => { deleteError.value = failure.message; });
}
watch(view, () => load());
onMounted(() => { window.addEventListener('beforeunload', beforeUnload); load(); });
onBeforeUnmount(() => { alive = false; revision++; readController?.abort(); writeController?.abort(); window.removeEventListener('beforeunload', beforeUnload); });
</script>
