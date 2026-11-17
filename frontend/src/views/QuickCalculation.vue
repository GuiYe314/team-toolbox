<template>
    <IntegrationLayout class="quick-calculation" title="快速计算" tool-id="quick-calculation" subtitle="按上下浮动比例确定区间，均匀列出两组数值，支持保存计算方案">
        <div class="calc-layout">
            <div class="calc-stack">
                <form class="workshop-panel" @submit.prevent="calculate">
                    <h2>计算参数</h2>
                    <label for="calc-base">基准值<input id="calc-base" v-model="form.base" class="input" type="text" inputmode="decimal" maxlength="48" autocomplete="off" /></label>
                    <div class="workshop-fields">
                        <label for="calc-rate">浮动比例<input id="calc-rate" v-model="form.rate" class="input" type="text" inputmode="decimal" maxlength="48" autocomplete="off" /></label>
                        <label for="calc-rate-mode">输入单位<select id="calc-rate-mode" v-model="form.rateMode" class="input"><option value="ratio">倍率（0.02 = 2%）</option><option value="percent">百分比（2 = 2%）</option></select></label>
                        <label for="calc-count">上下每组数量<input id="calc-count" v-model.number="form.count" class="input" type="number" min="2" max="500" step="1" required /></label>
                        <label for="calc-precision">保留小数位<select id="calc-precision" v-model.number="form.precision" class="input"><option v-for="n in 13" :key="n" :value="n - 1">{{ n - 1 }} 位</option></select></label>
                    </div>
                    <p class="workshop-note">每组2～500个数，包含区间两端点。{{ form.rateMode === 'ratio' ? '例如输入0.02，表示上下浮动2%。' : '例如输入2，表示上下浮动2%。' }}</p>
                    <div class="ext-row"><button id="calc-run" class="btn btn-primary" type="submit" :disabled="calculating">{{ calculating ? '计算中…' : '计算结果' }}</button><button id="calc-example" class="btn" type="button" :disabled="saving || deleting" @click="example">载入示例</button></div>
                    <p v-if="calcError" class="workshop-error" role="alert">{{ calcError }}</p>
                </form>
                <section class="workshop-panel">
                    <h2>保存计算方案</h2>
                    <label for="calc-name">方案名称<input id="calc-name" v-model="name" class="input" maxlength="60" placeholder="例如：27.75 上下2%" /></label>
                    <button id="calc-save" class="btn" type="button" :disabled="!result || dirty || calculating || saving || deleting" @click="save">{{ saving ? '保存中…' : '保存方案' }}</button>
                    <p class="workshop-note">保存后可重新载入计算。同名不同参数请换一个名称保存。</p>
                    <p v-if="operationError" class="workshop-error" role="alert">{{ operationError }}</p>
                    <p v-if="message" class="workshop-success" role="status">{{ message }}</p>
                </section>
                <section class="workshop-panel calc-saved">
                    <div class="ext-row"><h2 class="workshop-grow">已保存方案 <span class="workshop-small">{{ items.length }}/500</span></h2><button id="calc-reload" class="btn btn-sm" :disabled="loading || saving || deleting" @click="load">{{ loading ? '读取中…' : '刷新' }}</button></div>
                    <input id="calc-search" v-model="search" class="input" type="search" placeholder="搜索方案名称" aria-label="搜索已保存方案" />
                    <p v-if="listError" class="workshop-error" role="alert">{{ listError }}；可点击刷新重试。</p>
                    <p v-else-if="!loading && !filtered.length" class="workshop-note">{{ search ? '没有匹配的方案。' : '还没有保存方案。' }}</p>
                    <ul class="workshop-list calc-saved-list">
                        <li v-for="item in filtered" :key="item.id" class="workshop-item" :data-calculation-id="item.id">
                            <strong class="calc-saved-name">{{ item.name }}</strong><p class="workshop-small">基准 {{ item.base }} · {{ item.rateMode === 'ratio' ? '倍率 ' : '百分比 ' }}{{ item.rate }} · 每组{{ item.count }}个 · {{ item.precision }}位小数</p>
                            <div class="ext-row"><button class="btn btn-sm calc-use" :disabled="saving || deleting" @click="use(item)">载入计算</button><button class="btn btn-sm calc-delete" :disabled="saving || deleting" @click="pendingDelete = item; operationError = ''">删除</button></div>
                        </li>
                    </ul>
                </section>
            </div>
            <section class="workshop-panel calc-results" aria-label="计算结果">
                <div class="ext-row"><h2 class="workshop-grow">计算结果</h2><button id="calc-copy-all" class="btn btn-sm" :disabled="!result || dirty || calculating" @click="copy('all')">复制全部</button></div>
                <p v-if="dirty" id="calc-stale" class="notice">参数已修改，请点击“计算结果”更新；下方保留上次结果。</p>
                <template v-if="result">
                    <p class="calc-summary">基准 <strong>{{ result.parameters.base }}</strong> · 上下浮动 <strong>{{ result.percentage }}%</strong> · 每组 <strong>{{ result.parameters.count }}</strong> 个</p>
                    <div class="calc-bounds"><div><span>下限</span><strong id="calc-lower">{{ result.lower }}</strong></div><div class="calc-base-bound"><span>基准</span><strong id="calc-center">{{ result.base }}</strong></div><div><span>上限</span><strong id="calc-upper">{{ result.upper }}</strong></div></div>
                    <p v-if="result.roundedDuplicates" id="calc-rounding" class="notice">当前小数位下部分数值相同，可提高小数位数查看；浮动为0时两组均为基准值。</p>
                    <div class="calc-directions"><div><h3>向下区间</h3><p>{{ result.lower }} ～ {{ result.base }}</p><button id="calc-copy-down" class="btn btn-sm" :disabled="dirty || calculating" @click="copy('down')">复制向下结果</button></div><div><h3>向上区间</h3><p>{{ result.base }} ～ {{ result.upper }}</p><button id="calc-copy-up" class="btn btn-sm" :disabled="dirty || calculating" @click="copy('up')">复制向上结果</button></div></div>
                    <div class="calc-table-wrap" tabindex="0" aria-label="上下区间数值列表，可滚动">
                        <table class="calc-table"><thead><tr><th scope="col">序号</th><th scope="col">向下（下限 → 基准）</th><th scope="col">向上（基准 → 上限）</th></tr></thead><tbody><tr v-for="row in result.rows" :key="row.index"><th scope="row">{{ row.index }}</th><td class="calc-down" :class="{ 'calc-center-value': row.index === result.parameters.count }">{{ row.down }}</td><td class="calc-up" :class="{ 'calc-center-value': row.index === 1 }">{{ row.up }}</td></tr></tbody></table>
                    </div>
                    <p class="workshop-note">每组包含基准值；数值均匀分布，显示时四舍五入。负基准按绝对值计算浮动幅度。</p>
                </template>
                <p v-else class="workshop-note">填写左侧参数，点击“计算结果”生成上下两组数值。</p>
                <p v-if="copyMessage" id="calc-copy-status" class="workshop-note" role="status">{{ copyMessage }}</p>
            </section>
        </div>
        <template #footer>方案保存在当前工具箱，访问同一工具箱的设备共享使用；整理和删除前请核对方案名称。</template>
        <IntegrationDialog v-if="pendingDelete" title="删除计算方案" @close="!deleting && (pendingDelete = null)">
            <p>确定删除“{{ pendingDelete.name }}”吗？删除后可从先前备份恢复。</p>
            <p v-if="operationError" class="workshop-error" role="alert">{{ operationError }}</p>
            <div class="ext-actions"><button id="calc-delete-cancel" class="btn" :disabled="deleting" @click="pendingDelete = null">取消</button><button id="calc-delete-confirm" class="btn btn-danger" :disabled="deleting" @click="remove">{{ deleting ? '删除中…' : '确认删除' }}</button></div>
        </IntegrationDialog>
    </IntegrationLayout>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import IntegrationLayout from '../components/IntegrationLayout.vue';
import IntegrationDialog from '../components/IntegrationDialog.vue';
import { calculationApi } from '../api/quick-calculation-client.js';
import { copyText } from '../utils/clipboard.js';

const defaults = () => ({ base: '27.75', rate: '0.02', rateMode: 'ratio', count: 10, precision: 6 });
const form = reactive(defaults()), result = ref(null), source = ref(''), name = ref(''), items = ref([]), search = ref('');
const calculating = ref(false), loading = ref(false), saving = ref(false), deleting = ref(false), pendingDelete = ref(null);
const calcError = ref(''), listError = ref(''), operationError = ref(''), message = ref(''), copyMessage = ref('');
const signature = computed(() => JSON.stringify(form)), dirty = computed(() => !!result.value && signature.value !== source.value);
const filtered = computed(() => items.value.filter(item => item.name.toLowerCase().includes(search.value.trim().toLowerCase())));
let alive = true, revision = 0, listRevision = 0, previewController, listController, writeController, copyTimer;
watch(signature, () => { revision++; previewController?.abort(); calculating.value = false; calcError.value = ''; message.value = ''; copyMessage.value = ''; }, { flush: 'sync' });
async function calculate() {
    const own = ++revision, snapshot = { ...form }, input = signature.value;
    previewController?.abort(); const controller = previewController = new AbortController(); calculating.value = true; calcError.value = ''; copyMessage.value = '';
    try { const value = await calculationApi.preview(snapshot, controller.signal); if (alive && own === revision) { result.value = value; source.value = input; } }
    catch (error) { if (alive && own === revision && !controller.signal.aborted) calcError.value = error.message; }
    finally { if (alive && own === revision) calculating.value = false; }
}
async function load() {
    const own = ++listRevision; listController?.abort(); const controller = listController = new AbortController(); loading.value = true; listError.value = '';
    try { const value = await calculationApi.list(controller.signal); if (alive && own === listRevision) items.value = value.items; }
    catch (error) { if (alive && own === listRevision && !controller.signal.aborted) listError.value = error.message; }
    finally { if (alive && own === listRevision) loading.value = false; }
}
function example() { Object.assign(form, defaults()); name.value = ''; message.value = ''; calculate(); }
function use(item) { Object.assign(form, { base: item.base, rate: item.rate, rateMode: item.rateMode, count: item.count, precision: item.precision }); name.value = item.name; operationError.value = ''; calculate(); }
async function save() {
    if (!result.value || dirty.value || saving.value || deleting.value || calculating.value) return;
    operationError.value = ''; message.value = '';
    if (!name.value.trim()) { operationError.value = '请填写方案名称'; return; }
    saving.value = true; const controller = writeController = new AbortController();
    try {
        const value = await calculationApi.save({ name: name.value, ...result.value.parameters }, controller.signal);
        if (!alive) return;
        // 使正在读取的旧列表失效，避免保存成功后被迟到的列表抹掉。
        listRevision++; listController?.abort(); loading.value = false;
        items.value = [value.item, ...items.value.filter(item => item.id !== value.item.id)];
        message.value = value.created ? '计算方案已保存' : '该计算方案已保存，无需重复创建';
    } catch (error) { if (alive && !controller.signal.aborted) operationError.value = error.message; }
    finally { if (alive) saving.value = false; }
}
async function remove() {
    if (!pendingDelete.value || deleting.value || saving.value) return;
    const id = pendingDelete.value.id; deleting.value = true; operationError.value = ''; const controller = writeController = new AbortController();
    try {
        await calculationApi.remove(id, controller.signal); if (!alive) return;
        listRevision++; listController?.abort(); loading.value = false; items.value = items.value.filter(item => item.id !== id); pendingDelete.value = null; message.value = '计算方案已删除';
    } catch (error) { if (alive && !controller.signal.aborted) operationError.value = error.message; }
    finally { if (alive) deleting.value = false; }
}
async function copy(direction) {
    if (!result.value || dirty.value || calculating.value) return;
    const value = result.value, own = revision;
    const group = key => value.rows.map(row => row[key]).join('\n');
    const text = direction === 'all' ? `基准 ${value.parameters.base}，上下浮动 ${value.percentage}%\n\n向下（${value.lower} ～ ${value.base}）\n${group('down')}\n\n向上（${value.base} ～ ${value.upper}）\n${group('up')}` : group(direction);
    try { await copyText(text); if (alive && own === revision) copyMessage.value = '计算结果已复制'; }
    catch { if (alive && own === revision) copyMessage.value = '复制失败，请在表格中选择数值后手动复制'; }
    if (!alive || own !== revision) return;
    clearTimeout(copyTimer); copyTimer = setTimeout(() => { if (alive) copyMessage.value = ''; }, 2200);
}
onMounted(() => { load(); calculate(); });
onBeforeUnmount(() => { alive = false; revision++; listRevision++; previewController?.abort(); listController?.abort(); writeController?.abort(); clearTimeout(copyTimer); });
</script>
