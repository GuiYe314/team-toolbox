<template>
    <div class="view-page project-todos-page">
        <header class="view-head ext-head">
            <div class="ext-stack">
                <h1 class="view-title">项目管理</h1>
                <p class="view-subtitle">按“项目 → 待办”跟踪进度和截止日期。</p>
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
            <div class="project-layout-switch" role="group" aria-label="显示方式">
                <button id="project-layout-list" type="button" class="btn btn-sm" :class="{ 'is-active': layout === 'list' }" :aria-pressed="layout === 'list'" :disabled="busy" @click="changeLayout('list')">列表</button>
                <button id="project-layout-board" type="button" class="btn btn-sm" :class="{ 'is-active': layout === 'board' }" :aria-pressed="layout === 'board'" :disabled="busy" @click="changeLayout('board')">看板</button>
            </div>
        </div>

        <section v-if="loading && !loaded" class="workshop-panel project-todos-empty" role="status">正在读取项目待办…</section>
        <section v-else-if="error && !loaded" class="workshop-panel project-todos-empty">
            <strong>暂时无法读取项目待办</strong>
            <button class="btn" :disabled="loading || busy" @click="load()">重新读取</button>
        </section>
        <section v-else-if="!projects.length" class="workshop-panel project-todos-empty">
            <strong>还没有项目</strong>
            <p>创建项目后，就可以在项目下添加待办。</p>
            <button id="project-empty-new" class="btn btn-primary" :disabled="busy || loading" @click="openProjectEditor()">新增第一个项目</button>
        </section>

        <div v-else class="project-workspace">
            <aside class="workshop-panel project-workspace-sidebar" aria-label="项目选择">
                <h2>项目</h2>
                <label class="project-filter-label" for="project-status-filter">项目状态
                    <select id="project-status-filter" v-model="statusFilter" class="input" :disabled="busy">
                        <option value="">全部状态</option>
                        <option v-for="(label, status) in projectStatuses" :key="status" :value="status">{{ label }}</option>
                    </select>
                </label>
                <button class="btn project-picker" type="button" :aria-pressed="!selectedId" :disabled="busy" @click="selectProject()">全部项目</button>
                <button v-for="project in filteredProjects" :key="project.id" type="button" class="btn project-picker"
                    :data-pick-project="project.id" :aria-pressed="selectedId === project.id" :disabled="busy" @click="selectProject(project.id)">
                    <span>{{ project.name }}</span>
                    <small>{{ projectStatuses[project.status] }} · {{ project.archivedCount }}/{{ project.todoCount }} 已完成</small>
                </button>
            </aside>

            <section class="project-todos-groups" aria-label="项目待办">
                <div class="workshop-panel project-todo-filters">
                    <label class="project-filter-label">优先级
                        <select id="todo-filter-priority" v-model="priorityFilter" class="input">
                            <option value="">全部优先级</option>
                            <option v-for="(label, priority) in todoPriorities" :key="priority" :value="priority">{{ label }}</option>
                        </select>
                    </label>
                    <label class="project-filter-label">截止日期
                        <select id="todo-filter-due" v-model="deadlineFilter" class="input">
                            <option value="">全部日期</option>
                            <option value="overdue">逾期</option><option value="today">今天</option><option value="week">本周</option>
                        </select>
                    </label>
                    <label class="project-filter-label">负责人
                        <input id="todo-filter-assignee" v-model.trim="assigneeFilter" type="search" class="input" maxlength="60" placeholder="全部负责人" />
                    </label>
                    <label class="project-filter-label">标签
                        <input id="todo-filter-tag" v-model.trim="tagFilter" type="search" class="input" maxlength="30" placeholder="全部标签" />
                    </label>
                    <button v-if="hasTodoFilters" id="todo-filters-clear" type="button" class="btn btn-sm" @click="clearTodoFilters">清除筛选</button>
                </div>

                <section v-if="!visibleProjects.length" class="workshop-panel project-todos-empty">
                    <strong>{{ view === 'archived' && scopedProjects.length && !hasTodoFilters ? '还没有归档待办' : '没有符合条件的项目或待办' }}</strong>
                </section>

            <article v-for="project in visibleProjects" :key="project.id" class="workshop-panel project-group" :data-project-id="project.id">
                <header class="project-group-head">
                    <div class="project-group-title">
                        <span class="project-mark" aria-hidden="true">
                            <svg class="icon" viewBox="0 0 24 24"><path d="M4 6.5h6l2 2h8v9.5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18z" /><path d="M4 8.5h16" /></svg>
                        </span>
                        <div>
                            <h2>{{ project.name }}</h2>
                            <p v-if="project.description" class="workshop-small">{{ project.description }}</p>
                            <p class="project-progress">{{ projectStatuses[project.status] }} · {{ project.activeCount }} 项未完成 · {{ project.archivedCount }} 项已归档</p>
                            <p v-if="project.dueDate" class="project-progress">项目截止 {{ project.dueDate }}</p>
                        </div>
                    </div>
                    <div class="ext-actions">
                        <button class="btn btn-sm" type="button" :disabled="busy || loading" @click="openProjectEditor(project)">编辑项目</button>
                        <button class="btn btn-sm" type="button" :disabled="busy || loading" @click="openTodoEditor(project)">新增待办</button>
                        <button v-if="!project.todoCount" class="btn btn-sm btn-danger project-delete" type="button" :disabled="busy || loading" @click="askDelete('project', project)">删除项目</button>
                    </div>
                </header>

                <div class="project-task-lanes" :class="{ 'is-board': layout === 'board' }">
                    <section v-for="lane in project.lanes" :key="lane.id" class="project-task-lane" :data-lane="lane.id" :aria-label="lane.label">
                        <h3 v-if="layout === 'board'">{{ lane.label }} <span>{{ lane.todos.length }}</span></h3>
                        <p v-if="!lane.todos.length" class="project-group-empty">当前没有待办</p>
                        <ul v-else class="project-todo-list">
                            <ProjectTodoItem v-for="todo in lane.todos" :key="todo.id" :todo="todo" :disabled="busy || loading"
                                :overdue="isOverdue(todo, calendar.today)" @archive="toggleTodo(todo, project, $event)"
                                @stage="changeTodoStage(todo, $event)" @edit="openTodoEditor(project, todo)" @remove="askDelete('todo', todo)" />
                        </ul>
                    </section>
                </div>
            </article>
            </section>

            <aside class="workshop-panel project-overview" aria-label="项目概览">
                <h2>项目概览</h2>
                <p class="project-overview-name">{{ scopedProjects.length === 1 ? scopedProjects[0].name : `${scopedProjects.length} 个项目` }}</p>
                <progress :value="overview.percent" max="100" :aria-label="`完成率 ${overview.percent}%`"></progress>
                <p>{{ overview.percent }}% 已完成</p>
                <dl>
                    <dt>待办总数</dt><dd>{{ overview.total }}</dd>
                    <dt>已完成</dt><dd>{{ overview.done }}</dd>
                    <dt>逾期</dt><dd :class="{ 'project-overdue': overview.overdue }">{{ overview.overdue }}</dd>
                </dl>
                <p class="project-overview-time">最近更新 <time :datetime="overview.updated || undefined">{{ formatTime(overview.updated) }}</time></p>
            </aside>
        </div>

        <footer class="ext-footer">项目及待办随<RouterLink to="/kb">知识库备份</RouterLink>一并保存。</footer>

        <IntegrationDialog v-if="projectEditor" :title="projectEditor.id ? '编辑项目' : '新增项目'" @close="closeEditor">
            <form class="project-todo-form ext-stack" @submit.prevent="saveProject">
                <label for="project-name">项目名称<input id="project-name" v-model="projectEditor.name" class="input" maxlength="80" required :disabled="busy" placeholder="例如：Unity 工具箱" /></label>
                <label for="project-description">项目说明<textarea id="project-description" v-model="projectEditor.description" maxlength="1000" :disabled="busy" placeholder="可填写项目目标或背景" /></label>
                <div class="project-form-fields">
                    <label for="project-status">项目状态
                        <select id="project-status" v-model="projectEditor.status" class="input" :disabled="busy">
                            <option v-for="(label, status) in projectStatuses" :key="status" :value="status">{{ label }}</option>
                        </select>
                    </label>
                    <label for="project-due">项目截止日期<input id="project-due" v-model="projectEditor.dueDate" class="input" type="date" min="0001-01-01" max="9999-12-31" :disabled="busy" /></label>
                </div>
                <p v-if="editorError" class="workshop-error" role="alert">{{ editorError }}</p>
                <div class="ext-actions"><button id="project-editor-cancel" class="btn" type="button" :disabled="busy" @click="closeEditor">取消</button><button id="project-editor-save" class="btn btn-primary" type="submit" :disabled="busy">{{ busy ? '保存中…' : '保存项目' }}</button></div>
            </form>
        </IntegrationDialog>

        <IntegrationDialog v-if="todoEditor" :title="todoEditor.id ? '编辑项目待办' : '新增项目待办'" @close="closeEditor">
            <form class="project-todo-form ext-stack" @submit.prevent="saveTodo">
                <p class="project-todo-form-project">项目：<strong>{{ todoEditor.projectName }}</strong></p>
                <label for="todo-issue">问题 / 待办<input id="todo-issue" v-model="todoEditor.issue" class="input" maxlength="200" required :disabled="busy" placeholder="例如：下载全部日志" /></label>
                <label for="todo-details">处理说明<textarea id="todo-details" v-model="todoEditor.details" maxlength="2000" :disabled="busy" placeholder="可填写处理步骤、验收条件或备注" /></label>
                <div class="project-form-fields">
                    <label for="todo-priority">优先级
                        <select id="todo-priority" v-model="todoEditor.priority" class="input" :disabled="busy">
                            <option v-for="(label, priority) in todoPriorities" :key="priority" :value="priority">{{ label }}</option>
                        </select>
                    </label>
                    <label for="todo-stage">处理阶段
                        <select id="todo-stage" v-model="todoEditor.stage" class="input" :disabled="busy">
                            <option value="pending">待处理</option><option value="doing">处理中</option>
                        </select>
                    </label>
                    <label for="todo-due">截止日期<input id="todo-due" v-model="todoEditor.dueDate" class="input" type="date" min="0001-01-01" max="9999-12-31" :disabled="busy" /></label>
                    <label for="todo-assignee">负责人<input id="todo-assignee" v-model="todoEditor.assignee" class="input" maxlength="60" :disabled="busy" /></label>
                </div>
                <label for="todo-tags">标签<input id="todo-tags" v-model="todoEditor.tagsText" class="input" maxlength="330" placeholder="用逗号分隔，最多 10 个" :disabled="busy" /></label>
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
import ProjectTodoItem from '../components/ProjectTodoItem.vue';
import { projectTodosApi } from '../api/project-todos-client.js';
import { isOverdue, matchesDeadline, projectCalendar, projectStatuses, todoPriorities, todoStages } from '../utils/project-management.js';

const route = useRoute(), router = useRouter();
const layout = computed(() => route.query.layout === 'board' ? 'board' : 'list');
const defaultView = computed(() => layout.value === 'board' ? 'all' : 'active');
const view = computed(() => ['active', 'archived', 'all'].includes(route.query.view) ? route.query.view : defaultView.value);
const selectedId = computed(() => typeof route.query.project === 'string' ? route.query.project : '');
const projects = ref([]), loading = ref(false), busy = ref(false), error = ref(''), notice = ref('');
const projectEditor = ref(null), todoEditor = ref(null), editorError = ref('');
const loaded = ref(false), pendingDelete = ref(null), deleteError = ref('');
const statusFilter = ref(''), priorityFilter = ref(''), deadlineFilter = ref(''), assigneeFilter = ref(''), tagFilter = ref('');
const calendar = ref(projectCalendar());
const originalEditor = ref('');
const draftDirty = computed(() => !!(projectEditor.value || todoEditor.value)
    && JSON.stringify(projectEditor.value || todoEditor.value) !== originalEditor.value);
let alive = true, revision = 0, readController, writeController, calendarTimer;

const filteredProjects = computed(() => projects.value.filter(project => !statusFilter.value || project.status === statusFilter.value));
const scopedProjects = computed(() => filteredProjects.value.filter(project => !selectedId.value || project.id === selectedId.value));
const hasTodoFilters = computed(() => Boolean(priorityFilter.value || deadlineFilter.value || assigneeFilter.value || tagFilter.value));
const overview = computed(() => {
    const summary = { total: 0, done: 0, overdue: 0, updated: '' };
    for (const project of scopedProjects.value) {
        summary.total += project.todoCount;
        summary.done += project.archivedCount;
        summary.overdue += project.todos.filter(todo => isOverdue(todo, calendar.value.today)).length;
        if (project.updatedAt > summary.updated) summary.updated = project.updatedAt;
    }
    return { ...summary, percent: summary.total ? Math.round(summary.done / summary.total * 100) : 0 };
});
const visibleProjects = computed(() => scopedProjects.value.flatMap(project => {
    const todos = project.todos.filter(todo => (
        (view.value === 'all' || todo.status === view.value)
        && (!priorityFilter.value || todo.priority === priorityFilter.value)
        && matchesDeadline(todo, deadlineFilter.value, calendar.value)
        && todo.assignee.toLowerCase().includes(assigneeFilter.value.toLowerCase())
        && (!tagFilter.value || todo.tags.some(tag => tag.toLowerCase().includes(tagFilter.value.toLowerCase())))
    ));
    if (!todos.length && (view.value === 'archived' || hasTodoFilters.value)) return [];
    const lanes = layout.value === 'list'
        ? [{ id: 'list', label: '待办列表', todos }]
        : Object.entries(todoStages).map(([id, label]) => ({
            id, label, todos: todos.filter(todo => (todo.isArchived ? 'done' : todo.stage) === id)
        }));
    return [{ ...project, lanes }];
}));
function replaceQuery(changes) {
    return router.replace({ name: 'project-management', query: { ...route.query, ...changes } });
}
function selectProject(id) {
    if (!id) statusFilter.value = '';
    return replaceQuery({ project: id });
}
watch(statusFilter, () => {
    if (selectedId.value && !filteredProjects.value.some(project => project.id === selectedId.value)) {
        replaceQuery({ project: undefined });
    }
});
function clearTodoFilters() {
    priorityFilter.value = deadlineFilter.value = assigneeFilter.value = tagFilter.value = '';
}
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
    const own = ++revision;
    readController?.abort();
    const controller = readController = new AbortController();
    loading.value = true;
    if (!keepError) error.value = '';
    try {
        const result = await projectTodosApi.state('all', controller.signal);
        if (alive && own === revision) { projects.value = result.projects; loaded.value = true; }
    }
    catch (failure) { if (alive && own === revision && !controller.signal.aborted) error.value = failure.message; }
    finally { if (alive && own === revision) loading.value = false; }
}
function changeView(next) {
    if (busy.value || view.value === next) return;
    return replaceQuery({ view: next === defaultView.value ? undefined : next });
}
function changeLayout(next) {
    if (busy.value || layout.value === next) return;
    return replaceQuery({ layout: next === 'board' ? 'board' : undefined });
}
function openProjectEditor(item) {
    if (busy.value || loading.value) return;
    editorError.value = '';
    projectEditor.value = {
        id: item?.id, version: item?.version, name: item?.name ?? '', description: item?.description ?? '',
        status: item?.status ?? 'planning', dueDate: item?.dueDate ?? ''
    };
    originalEditor.value = JSON.stringify(projectEditor.value);
}
function openTodoEditor(project, item) {
    if (busy.value || loading.value) return;
    editorError.value = '';
    todoEditor.value = {
        projectId: project.id, projectName: project.name, id: item?.id, version: item?.version,
        issue: item?.issue ?? '', details: item?.details ?? '', priority: item?.priority ?? 'normal',
        stage: item?.stage ?? 'pending', dueDate: item?.dueDate ?? '', assignee: item?.assignee ?? '',
        tagsText: item?.tags.join('，') ?? ''
    };
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
    const value = { name: draft.name, description: draft.description, status: draft.status, dueDate: draft.dueDate || null, version: draft.version };
    return write(signal => projectTodosApi.saveProject(value, draft.id, signal),
        saved => { projectEditor.value = null; notice.value = `项目“${saved.name}”已保存`; },
        failure => { editorError.value = failure.message; });
}
function saveTodo() {
    const draft = todoEditor.value;
    if (!draft) return;
    editorError.value = '';
    const { issue, details, priority, stage, assignee, version } = draft;
    const tags = draft.tagsText.split(/[,，]/).map(tag => tag.trim()).filter(Boolean);
    const value = { issue, details, priority, stage, assignee, version, tags, dueDate: draft.dueDate || null };
    return write(signal => projectTodosApi.saveTodo(value, draft.projectId, draft.id, signal),
        () => { todoEditor.value = null; notice.value = '项目待办已保存'; },
        failure => { editorError.value = failure.message; });
}
function changeTodoStage(item, stage) {
    const { issue, details, version } = item;
    return write(signal => projectTodosApi.saveTodo({ issue, details, version, stage }, item.projectId, item.id, signal),
        () => { notice.value = `已移至${todoStages[stage]}`; },
        async failure => { error.value = failure.message; await load({ keepError: true }); });
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
onMounted(() => {
    window.addEventListener('beforeunload', beforeUnload);
    calendarTimer = window.setInterval(() => { calendar.value = projectCalendar(); }, 60000);
    load();
});
onBeforeUnmount(() => {
    alive = false;
    revision++;
    readController?.abort();
    writeController?.abort();
    window.clearInterval(calendarTimer);
    window.removeEventListener('beforeunload', beforeUnload);
});
</script>
