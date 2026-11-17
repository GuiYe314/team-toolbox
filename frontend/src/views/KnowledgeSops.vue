<template>
    <div class="view-page ext-page sop-page">
        <header class="view-head ext-head"><div class="ext-stack"><RouterLink class="ext-back" to="/kb">返回知识库</RouterLink><h1 class="view-title">SOP 检查清单</h1><p class="view-subtitle">保存操作模板，每次独立执行，逐项核对并保留历史</p></div><div class="ext-actions"><button id="sop-refresh" class="btn" :disabled="busy || loading" @click="refresh">刷新</button><button id="sop-new" class="btn btn-primary" :disabled="busy" @click="openEditor()">新增模板</button></div></header>
        <p v-if="notice" class="workshop-success" role="status">{{ notice }}</p><p v-if="error" class="workshop-error" role="alert">{{ error }}</p>
        <div class="sop-layout">
            <aside class="workshop-panel sop-library" aria-label="SOP模板与历史">
                <div class="workshop-tabs"><button id="sop-templates-tab" class="btn" :class="{ 'is-active': view === 'templates' }" :aria-pressed="view === 'templates'" @click="view = 'templates'">模板 {{ templates.length }}/200</button><button id="sop-runs-tab" class="btn" :class="{ 'is-active': view === 'runs' }" :aria-pressed="view === 'runs'" @click="view = 'runs'">执行历史</button></div>
                <template v-if="view === 'templates'">
                    <input id="sop-search" v-model="search" class="input" type="search" placeholder="搜索模板名称" aria-label="搜索模板名称" />
                    <p v-if="!loading && !filtered.length" class="workshop-note">{{ search ? '没有匹配的模板。' : '新增一个模板，把操作拆成可核对的步骤。' }}</p>
                    <ul class="workshop-list sop-library-list"><li v-for="item in filtered" :key="item.id"><button class="sop-list-button" :class="{ 'is-active': template?.id === item.id }" :disabled="busy" :data-template-id="item.id" @click="choose('template', item.id)"><strong>{{ item.name }}</strong><span>{{ item.stepCount }}条步骤 · 版本{{ item.version }}</span><span>{{ time(item.updatedAt) }}</span></button></li></ul>
                </template>
                <template v-else>
                    <label for="sop-status">执行状态<select id="sop-status" v-model="status" class="input" :disabled="busy" @change="offset = 0; loadLists()"><option value="">全部记录</option><option value="active">未完成</option><option value="completed">已完成</option></select></label>
                    <p v-if="!loading && !runs.length" class="workshop-note">还没有符合条件的执行记录。</p>
                    <ul class="workshop-list sop-library-list"><li v-for="item in runs" :key="item.id"><button class="sop-list-button" :class="{ 'is-active': run?.id === item.id }" :disabled="busy" :data-run-id="item.id" @click="choose('run', item.id)"><strong>{{ item.templateName }}</strong><span>{{ item.status === 'completed' ? '已完成' : '进行中' }} · {{ item.doneCount }}/{{ item.stepCount }}步 · 模板v{{ item.templateVersion }}</span><span>{{ time(item.createdAt) }}</span></button></li></ul>
                    <div class="ext-row"><button id="sop-prev" class="btn btn-sm" :disabled="!offset || loading || busy" @click="offset -= 50; loadLists()">上一页</button><span class="workshop-small">共{{ total }}条 / 最多1000条</span><button id="sop-next" class="btn btn-sm" :disabled="offset + 50 >= total || loading || busy" @click="offset += 50; loadLists()">下一页</button></div>
                </template>
                <p v-if="loading" class="workshop-note" role="status">正在读取…</p><p v-if="listError" class="workshop-error" role="alert">{{ listError }}；点击刷新可重试。</p>
            </aside>
            <section class="workshop-panel sop-detail" aria-label="SOP详情">
                <p v-if="detailLoading" class="workshop-note" role="status">正在读取详情…</p>
                <template v-else-if="template">
                    <div class="ext-row"><h2 class="workshop-grow" id="sop-template-title">{{ template.name }}</h2><button id="sop-edit" class="btn btn-sm" :disabled="busy" @click="openEditor(template)">编辑模板</button><button id="sop-delete-template" class="btn btn-sm" :disabled="busy" @click="confirmDelete('templates', template)">删除模板</button></div>
                    <p class="workshop-small">版本{{ template.version }} · 修改于{{ time(template.updatedAt) }}</p><p class="sop-text workshop-note">{{ template.description || '暂无模板说明。' }}</p>
                    <ol class="sop-template-steps"><li v-for="step in template.steps" :key="step.id" class="sop-text">{{ step.text }}</li></ol>
                    <button id="sop-start" class="btn btn-primary" :disabled="busy" @click="start">{{ busy ? '操作中…' : '开始一次新执行' }}</button>
                    <p class="workshop-note">每次执行保存独立步骤快照；之后编辑或删除模板，已有记录仍保留。</p>
                </template>
                <template v-else-if="run">
                    <div class="ext-row"><h2 class="workshop-grow" id="sop-run-title">{{ run.templateName }}</h2><button id="sop-delete-run" class="btn btn-sm" :disabled="busy" @click="confirmDelete('runs', run)">删除记录</button></div>
                    <p class="workshop-small">模板v{{ run.templateVersion }} · 开始于{{ time(run.createdAt) }} · 记录{{ run.id.slice(0, 8) }}</p>
                    <p v-if="run.description" class="sop-text workshop-note">{{ run.description }}</p>
                    <p id="sop-progress" class="sop-progress-text">{{ run.status === 'completed' ? '已完成' : '进行中' }}：{{ doneCount }}/{{ run.steps.length }}步（{{ Math.round(doneCount / run.steps.length * 100) }}%）</p><progress :value="doneCount" :max="run.steps.length" aria-label="SOP执行进度" />
                    <ul class="workshop-list sop-checklist"><li v-for="(step, index) in run.steps" :key="step.id"><label :class="{ 'is-done': step.done }"><input class="sop-step-check" type="checkbox" :checked="step.done" :disabled="busy || run.status === 'completed'" :data-step-id="step.id" @change="toggle(step, $event)" /><span class="sop-text">{{ index + 1 }}. {{ step.text }}</span></label></li></ul>
                    <label for="sop-notes">本次执行备注<textarea id="sop-notes" v-model="notes" maxlength="2000" :readonly="run.status === 'completed'" :disabled="busy" placeholder="可填写异常、处理结果等（最多2000字）" /></label>
                    <div v-if="run.status === 'active'" class="ext-row"><button id="sop-save-notes" class="btn" :disabled="busy || !notesDirty" @click="change({ notes })">保存备注</button><button id="sop-complete" class="btn btn-primary" :disabled="busy || doneCount !== run.steps.length || notesDirty" @click="change({ complete: true })">完成本次执行</button></div>
                    <p v-if="run.status === 'active'" class="workshop-note">勾选会保存到工具箱。全部勾选并保存备注后，可完成本次执行；未结束的记录可从历史继续。</p><p v-else class="workshop-note">完成于{{ time(run.completedAt) }}。本记录只读，可返回模板开始下一次执行。</p>
                    <p v-if="busy" class="workshop-note" role="status">正在保存，请稍候…</p>
                </template>
                <p v-else class="workshop-note">从左侧选择模板开始执行，或在执行历史中继续未完成的清单。读取失败时可点击顶部刷新。</p>
            </section>
        </div>
        <footer class="ext-footer">模板和执行记录保存在当前工具箱，同一工具箱的访问者共享。可通过知识库导出菜单备份；删除前请核对记录。</footer>
        <IntegrationDialog v-if="editor" :title="editor.id ? '编辑SOP模板' : '新增SOP模板'" @close="!busy && (editor = null)">
            <form class="sop-editor ext-stack" @submit.prevent="saveTemplate">
                <label for="sop-name">模板名称<input id="sop-name" v-model="editor.name" class="input" maxlength="80" required :disabled="busy" /></label><label for="sop-description">操作说明<textarea id="sop-description" v-model="editor.description" maxlength="2000" :disabled="busy" /></label>
                <p class="workshop-note">按顺序填写1～50条步骤，每条最多500字，可换行补充说明。保存后不改变已有执行记录。</p>
                <div class="sop-editor-steps"><div v-for="(step, index) in editor.steps" :key="step.key" class="workshop-item sop-editor-step"><label :for="'sop-edit-step-' + index">步骤{{ index + 1 }}<textarea :id="'sop-edit-step-' + index" v-model="step.text" class="sop-edit-step-text" maxlength="500" required :disabled="busy" /></label><div class="ext-row"><button class="btn btn-sm sop-step-up" type="button" :disabled="busy || index === 0" @click="move(index, -1)">上移</button><button class="btn btn-sm sop-step-down" type="button" :disabled="busy || index === editor.steps.length - 1" @click="move(index, 1)">下移</button><button class="btn btn-sm sop-step-remove" type="button" :disabled="busy || editor.steps.length === 1" @click="editor.steps.splice(index, 1)">移除步骤</button></div></div></div>
                <button id="sop-add-step" class="btn" type="button" :disabled="busy || editor.steps.length >= 50" @click="editor.steps.push({ key: ++stepKey, text: '' })">添加步骤</button>
                <p v-if="editorError" class="workshop-error" role="alert">{{ editorError }}</p><div class="ext-actions"><button id="sop-editor-cancel" class="btn" type="button" :disabled="busy" @click="editor = null">取消</button><button id="sop-editor-save" class="btn btn-primary" type="submit" :disabled="busy">{{ busy ? '保存中…' : '保存模板' }}</button></div>
            </form>
        </IntegrationDialog>
        <IntegrationDialog v-if="pendingDelete" title="确认删除SOP内容" @close="!busy && (pendingDelete = null)"><p>确定删除{{ pendingDelete.kind === 'templates' ? '模板' : '执行记录' }}“{{ pendingDelete.item.name || pendingDelete.item.templateName }}”吗？</p><p class="workshop-note">{{ pendingDelete.kind === 'templates' ? '已有执行历史会保留。' : '这条执行记录将永久删除。' }}删除后可从先前备份恢复。</p><p v-if="deleteError" class="workshop-error" role="alert">{{ deleteError }}</p><div class="ext-actions"><button id="sop-delete-cancel" class="btn" :disabled="busy" @click="pendingDelete = null">取消</button><button id="sop-delete-confirm" class="btn btn-danger" :disabled="busy" @click="remove">{{ busy ? '删除中…' : '确认删除' }}</button></div></IntegrationDialog>
    </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter, onBeforeRouteLeave, onBeforeRouteUpdate } from 'vue-router';
import { v4 as uuid } from 'uuid';
import IntegrationDialog from '../components/IntegrationDialog.vue';
import { sopApi } from '../api/knowledge-sops-client.js';

const route = useRoute(), router = useRouter();
const templates = ref([]), runs = ref([]), template = ref(null), run = ref(null), view = ref('templates'), search = ref(''), status = ref(''), offset = ref(0), total = ref(0);
const loading = ref(false), detailLoading = ref(false), busy = ref(false), error = ref(''), listError = ref(''), notice = ref(''), notes = ref('');
const editor = ref(null), editorError = ref(''), pendingDelete = ref(null), deleteError = ref('');
const filtered = computed(() => templates.value.filter(item => item.name.toLowerCase().includes(search.value.trim().toLowerCase())));
const doneCount = computed(() => run.value?.steps.filter(step => step.done).length || 0), notesDirty = computed(() => !!run.value && notes.value !== run.value.notes);
let alive = true, listRevision = 0, detailRevision = 0, stepKey = 0, listController, detailController, writeController, requestId;
const time = value => new Date(value).toLocaleString('zh-CN', { hour12: false });
function canLeave() { return !(notesDirty.value || editor.value) || window.confirm('有未保存的编辑内容，确定离开并放弃这些编辑吗？'); }
onBeforeRouteLeave(canLeave); onBeforeRouteUpdate(canLeave);
async function loadLists() {
    const own = ++listRevision; listController?.abort(); const controller = listController = new AbortController(); loading.value = true; listError.value = '';
    const values = await Promise.allSettled([sopApi.templates(controller.signal), sopApi.runs(offset.value, status.value, controller.signal)]);
    if (!alive || own !== listRevision) return;
    if (values[0].status === 'fulfilled') templates.value = values[0].value.items;
    if (values[1].status === 'fulfilled') { runs.value = values[1].value.items; total.value = values[1].value.total; }
    const failed = values.find(value => value.status === 'rejected'); if (failed && !controller.signal.aborted) listError.value = failed.reason.message;
    loading.value = false;
}
async function detail() {
    const own = ++detailRevision; detailController?.abort(); template.value = null; run.value = null; notes.value = ''; error.value = ''; requestId = null;
    const kind = route.query.run ? 'run' : 'template', id = route.query[kind]; if (!id) { detailLoading.value = false; return; }
    const controller = detailController = new AbortController(); detailLoading.value = true; view.value = kind === 'run' ? 'runs' : 'templates';
    try { const item = await sopApi[kind](id, controller.signal); if (alive && own === detailRevision) { if (kind === 'run') { run.value = item; notes.value = item.notes; } else template.value = item; } }
    catch (failure) { if (alive && own === detailRevision && !controller.signal.aborted) error.value = failure.message; }
    finally { if (alive && own === detailRevision) detailLoading.value = false; }
}
async function choose(kind, id) { if (busy.value) return; if (route.query[kind] === id) { if (canLeave()) await detail(); } else await router.replace({ name: 'kb-sops', query: { [kind]: id } }); }
async function refresh() { if (!canLeave()) return; await Promise.all([loadLists(), detail()]); }
function openEditor(item) {
    if (notesDirty.value && !canLeave()) return;
    if (run.value) notes.value = run.value.notes;
    editorError.value = ''; editor.value = { id: item?.id, version: item?.version, name: item?.name || '', description: item?.description || '', steps: (item?.steps || [{ text: '' }]).map(step => ({ ...step, key: ++stepKey })) };
}
function move(index, distance) { const steps = editor.value.steps; [steps[index], steps[index + distance]] = [steps[index + distance], steps[index]]; }
async function saveTemplate() {
    if (busy.value) return; busy.value = true; editorError.value = ''; const controller = writeController = new AbortController(), draft = editor.value;
    const value = { name: draft.name, description: draft.description, steps: draft.steps.map(step => ({ ...(step.id ? { id: step.id } : {}), text: step.text })), ...(draft.id ? { version: draft.version } : {}) };
    try { const saved = await sopApi.saveTemplate(value, draft.id, controller.signal); if (!alive) return; editor.value = null; notice.value = 'SOP模板已保存，已有执行历史保持原样'; template.value = saved; run.value = null; notes.value = ''; await router.replace({ name: 'kb-sops', query: { template: saved.id } }); await loadLists(); }
    catch (failure) { if (alive && !controller.signal.aborted) editorError.value = failure.message; }
    finally { if (alive) busy.value = false; }
}
async function start() {
    if (!template.value || busy.value) return; busy.value = true; error.value = ''; requestId ||= uuid(); const controller = writeController = new AbortController();
    try { const saved = await sopApi.start(template.value.id, { version: template.value.version, requestId }, controller.signal); if (!alive) return; requestId = null; notice.value = '已开始新一次执行，步骤勾选会自动保存'; await router.replace({ name: 'kb-sops', query: { run: saved.item.id } }); await loadLists(); }
    catch (failure) { if (alive && !controller.signal.aborted) error.value = failure.message; }
    finally { if (alive) busy.value = false; }
}
function toggle(step, event) { const done = event.target.checked; event.target.checked = step.done; change({ stepId: step.id, done }); }
async function change(value) {
    if (!run.value || busy.value) return; busy.value = true; error.value = ''; const own = detailRevision, controller = writeController = new AbortController(), keepNotes = notesDirty.value && !Object.hasOwn(value, 'notes');
    try { const saved = await sopApi.change(run.value.id, { version: run.value.version, ...value }, controller.signal); if (!alive || own !== detailRevision) return; run.value = saved; if (!keepNotes) notes.value = saved.notes; notice.value = saved.status === 'completed' ? '本次执行已完成并保留历史' : '执行记录已保存'; await loadLists(); }
    catch (failure) { if (alive && own === detailRevision && !controller.signal.aborted) error.value = failure.message; }
    finally { if (alive) busy.value = false; }
}
function confirmDelete(kind, item) { pendingDelete.value = { kind, item }; deleteError.value = ''; }
async function remove() {
    if (!pendingDelete.value || busy.value) return; busy.value = true; deleteError.value = ''; const controller = writeController = new AbortController(), target = pendingDelete.value;
    try { await sopApi.remove(target.kind, target.item, controller.signal); if (!alive) return; pendingDelete.value = null; notes.value = run.value?.notes || ''; await router.replace({ name: 'kb-sops' }); notice.value = target.kind === 'templates' ? '模板已删除，执行历史已保留' : '执行记录已删除'; await loadLists(); }
    catch (failure) { if (alive && !controller.signal.aborted) deleteError.value = failure.message; }
    finally { if (alive) busy.value = false; }
}
watch(() => [route.query.template, route.query.run], detail);
onMounted(() => { loadLists(); detail(); });
onBeforeUnmount(() => { alive = false; listRevision++; detailRevision++; listController?.abort(); detailController?.abort(); writeController?.abort(); });
</script>
