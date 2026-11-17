<template>
    <section class="kw-note-pane" :aria-label="secondary ? '右侧笔记' : '当前笔记'" @keydown.ctrl.s.prevent="save" @click="noteClick">
        <p v-if="error" class="workshop-error" role="alert">{{ error }} <button v-if="!dirty" class="btn btn-sm" @click="load">重新读取</button></p><p v-if="notice" role="status" class="workshop-success">{{ notice }}</p><p v-if="loading">正在读取笔记…</p>
        <template v-if="note">
            <div class="kw-row kw-note-toolbar"><button class="btn btn-sm" :class="{'is-active': !editing}" @click="leaveEdit">阅读</button><button class="btn btn-sm" :class="{'is-active': editing}" @click="editing = true">编辑</button><button class="btn btn-primary btn-sm kw-save-note" :disabled="busy || !dirty" @click="save">{{ busy ? '保存中…' : '保存' }}</button><button class="btn btn-sm" @click="$emit('bookmark', note.id)">书签</button><button class="btn btn-sm" @click="$emit('template', note)">存为模板</button><RouterLink class="btn btn-sm" :to="`/kb/${note.id}`">原阅读页</RouterLink></div>
            <input v-if="editing" v-model="title" class="input kw-note-title" maxlength="100" aria-label="笔记标题" /><h2 v-else class="kw-note-title">{{ title }}</h2>
            <p class="kw-muted">#{{ note.id }} · v{{ note.version }}{{ dirty ? ' · 有未保存修改' : '' }}</p>
            <details class="kw-details"><summary>属性 {{ meta.databaseId ? '· ' + (databases.find(d => d.id === meta.databaseId)?.name || '已失效资料库') : '' }}</summary><KbProperties v-model="meta" :databases="databases" :notes="notes" :readonly="!editing" /></details>
            <template v-if="editing"><div class="kw-row"><label>编辑方式<select v-model="mode" class="input"><option value="blocks">块编辑</option><option value="markdown">Markdown</option></select></label><label v-if="blocks.length">插入同步块<select class="input" @change="insertSync($event)"><option value="">请选择…</option><option v-for="item in blocks" :key="item.id" :value="item.id">{{ item.name }}</option></select></label></div><KbBlockEditor v-if="mode === 'blocks'" v-model="content" /><textarea v-else v-model="content" class="input kw-markdown" aria-label="Markdown正文" spellcheck="false" /><p class="kw-muted">链接 [[笔记名称]]，标题引用 ![[笔记名称#标题]]，段落末尾 ^块ID，再用 ![[笔记名称#^块ID]] 嵌入。重名请用完整路径或 id:编号。</p></template>
            <template v-else><details class="kw-details" open><summary>大纲</summary><nav class="kw-outline" aria-label="笔记大纲"><button v-for="heading in note.outline" :key="heading.id" class="kw-link" :style="{paddingInlineStart: `${(heading.depth - 1) * 12}px`}" @click="jump(heading.id)">{{ heading.text }}</button><span v-if="!note.outline.length" class="kw-muted">正文还没有标题。</span></nav></details><div ref="reader" class="kw-reader"><MarkdownBody :html="note.html" /></div></template>
            <details class="kw-details"><summary>双向链接与未链接提及</summary><h3>反向链接</h3><button v-for="item in note.backlinks" :key="item.id" class="kw-link" @click="$emit('open', item.id)">{{ item.path }}</button><p v-if="!note.backlinks.length" class="kw-muted">暂无笔记链接到这里。</p><h3>当前笔记链接</h3><div v-for="(item, index) in note.outgoing" :key="index"><span>{{ item.reference }} · {{ item.status === 'resolved' ? '已关联' : item.status === 'ambiguous' ? '重名，请指定路径' : '缺失' }}</span><button v-for="target in item.candidates" :key="target.id" class="kw-link" @click="$emit('open', target.id)">{{ target.path }}</button></div><h3>未链接提及</h3><button v-for="item in note.mentions" :key="item.id" class="kw-link" @click="$emit('open', item.id)">{{ item.path }}</button><p v-if="!note.mentions.length" class="kw-muted">暂无其他笔记提及本标题。</p><p v-if="note.truncated" class="workshop-note">关系扫描达到上限，结果可能不完整。</p></details>
            <details class="kw-details" @toggle="historyToggle"><summary>修改历史（最多20版）</summary><p class="kw-muted">保存前的标题与正文；恢复会生成新版本，当前分类、标签与属性保留。</p><div class="kw-row"><select v-model="revisionId" class="input" aria-label="选择历史版本"><option value="">选择历史版本</option><option v-for="revision in history" :key="revision.id" :value="revision.id">v{{ revision.version }} · {{ revision.saved_at }} · {{ revision.title }}</option></select><button class="btn btn-sm" :disabled="!revisionId || busy" @click="restore">恢复这版</button></div><textarea v-if="revision" class="input kw-history-preview" readonly :value="revision.content_md" aria-label="历史正文预览" /></details>
            <details class="kw-details"><summary>评论 {{ comments.length }}</summary><p class="kw-muted">显示名由填写者提供，当前没有账号身份验证。</p><article v-for="comment in comments" :key="comment.id" class="kw-comment"><strong>{{ comment.data.author }}</strong><time>{{ new Date(comment.createdAt).toLocaleString() }}</time><p>{{ comment.data.content }}</p><button class="btn btn-sm" :disabled="busy" @click="removeComment(comment)">删除评论</button></article><label>显示名<input v-model="author" class="input" maxlength="40" /></label><label>评论内容<textarea v-model="commentText" class="input" maxlength="4000" /></label><button class="btn btn-sm" :disabled="busy || !author.trim() || !commentText.trim()" @click="addComment">发布评论</button></details>
        </template><p v-else-if="!loading" class="kw-empty">从左侧选择一篇笔记，或新建笔记。</p>
    </section>
</template>
<script setup>
import { ref, computed, watch, onBeforeUnmount, nextTick } from 'vue';
import { kbApi } from '../../api/knowledge-workbench-client.js';
import KbBlockEditor from './KbBlockEditor.vue';
import KbProperties from './KbProperties.vue';
import MarkdownBody from '../MarkdownBody.vue';
const props = defineProps({ id: Number, secondary: Boolean, anchor: String, notes: {type: Array, default: () => []}, entries: {type: Array, default: () => []} }), emit = defineEmits(['open', 'changed', 'bookmark', 'template']);
const note = ref(null), title = ref(''), content = ref(''), meta = ref({databaseId: null, values: {}, version: 0}), editing = ref(false), mode = ref('blocks'), busy = ref(false), loading = ref(false), error = ref(''), notice = ref(''), history = ref([]), revisionId = ref(''), reader = ref(null), author = ref(''), commentText = ref('');
const baseline = ref(''), snapshot = () => JSON.stringify([title.value, content.value, meta.value]), dirty = computed(() => !!note.value && baseline.value !== snapshot()), databases = computed(() => props.entries.filter(e => e.kind === 'database')), blocks = computed(() => props.entries.filter(e => e.kind === 'block')), comments = computed(() => props.entries.filter(e => e.kind === 'comment' && e.data.docId === props.id)), revision = computed(() => history.value.find(item => item.id === Number(revisionId.value)));
let controller, generation = 0, alive = true;
async function load() {
    controller?.abort(); const own = ++generation; controller = new AbortController(); note.value = null; error.value = ''; history.value = []; revisionId.value = ''; if (!props.id) return; loading.value = true;
    try { const value = await kbApi.note(props.id, controller.signal); if (!alive || own !== generation) return; note.value = value; title.value = value.title; content.value = value.content_md; meta.value = value.meta; baseline.value = snapshot(); if (props.anchor) { await nextTick(); jump(props.anchor); } }
    catch (failure) { if (alive && own === generation && !controller.signal.aborted) error.value = failure.message; }
    finally { if (alive && own === generation) loading.value = false; }
}
watch(() => props.id, () => { editing.value = false; commentText.value = ''; load(); }, {immediate: true});
watch(() => props.anchor, async value => { await nextTick(); if (value) jump(value); });
function hasUnsaved() { return busy.value || dirty.value || !!commentText.value.trim(); }
function canLeave() { return !busy.value && (!hasUnsaved() || confirm('当前笔记有未保存修改，离开会丢弃这些修改。继续？')); }
async function operation(callback) { if (busy.value) return; busy.value = true; error.value = ''; notice.value = ''; const own = generation; try { const result = await callback(controller?.signal); if (alive && own === generation) return result; } catch (failure) { if (alive && own === generation) error.value = failure.message + (failure.status === 409 ? '；当前草稿保留，可复制后重新读取。' : ''); } finally { if (alive && own === generation) busy.value = false; } }
async function save() {
    if (!note.value || !dirty.value) return;
    const result = await operation(signal => kbApi.saveNote(note.value.id, { version: note.value.version, title: title.value, content_md: content.value, meta: meta.value }, signal));
    if (result) { const actionText = result.actions?.map(a => a.name).join('、'); await load(); emit('changed'); notice.value = actionText ? `已保存，已执行：${actionText}` : '已保存'; }
}
function leaveEdit() { if (dirty.value && !confirm('阅读当前保存版本？未保存草稿仍保留，可切回编辑继续。')) return; editing.value = false; }
function jump(id) { const element = reader.value && [...reader.value.querySelectorAll('[id]')].find(el => el.id === id); element?.scrollIntoView({ block: 'start', behavior: 'auto' }); }
function noteClick(event) { const link = event.target.closest('a[data-note-id]'); if (!link) return; event.preventDefault(); emit('open', Number(link.dataset.noteId), link.dataset.anchor || ''); }
function insertSync(event) { if (!event.target.value) return; content.value += `\n\n![[block:${event.target.value}]]`; event.target.value = ''; }
async function historyToggle(event) { if (!event.target.open || !note.value) return; const own = generation, signal = controller.signal; try { const result = await kbApi.history(note.value.id, signal); if (alive && own === generation) history.value = result.items; } catch (failure) { if (alive && own === generation && !signal.aborted) error.value = failure.message; } }
async function restore() { if (!canLeave() || !confirm('确认用所选历史版本恢复标题与正文？当前版本会保留到历史中。')) return; const result = await operation(signal => kbApi.restore(note.value.id, Number(revisionId.value), note.value.version, signal)); if (result) { await load(); emit('changed'); notice.value = '已恢复为新版本'; } }
async function addComment() { const result = await operation(signal => kbApi.saveEntry({kind: 'comment', name: '笔记评论', data: {docId: props.id, author: author.value, content: commentText.value}}, signal)); if (result) { commentText.value = ''; emit('changed'); notice.value = '评论已保存'; } }
async function removeComment(item) { if (!confirm('永久删除此评论？')) return; const result = await operation(signal => kbApi.remove(item, signal)); if (result) emit('changed'); }
onBeforeUnmount(() => { alive = false; controller?.abort(); generation++; });
defineExpose({ canLeave, dirty, hasUnsaved, reload: load });
</script>
