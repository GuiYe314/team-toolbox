<template>
    <IntegrationLayout title="FreeLLMAPI 模型对话" subtitle="连接工具箱服务器上的模型网关，选择模型并开始对话" tool-id="freellmapi">
        <template #actions><button class="btn" data-test="free-settings" @click="settings = true">连接设置</button><button class="btn" @click="help = true">帮助</button></template>
        <p v-if="error" class="ext-notice is-error" role="alert">{{ error }}</p><p v-if="notice" class="ext-notice" role="status">{{ notice }}</p>
        <div class="ext-workspace">
            <aside class="ext-card ext-stack">
                <h2>模型与连接</h2>
                <span class="ext-badge" :class="{ 'is-ready': config?.keyConfigured }">{{ config?.keyConfigured ? '统一 Key 已设置' : '请设置统一 Key' }}</span>
                <p class="ext-hint ext-wrap">{{ config?.baseUrl || '尚未读取连接设置' }}</p>
                <button class="btn" data-test="free-refresh" :disabled="!!busy || !config?.keyConfigured" @click="refreshModels">{{ busy === 'models' ? '读取模型中…' : '刷新可用模型' }}</button>
                <label class="ext-field">文本模型<select v-model="model" data-test="free-model" :disabled="!!busy || !models.length"><option disabled value="">{{ models.length ? '选择模型' : '先刷新模型列表' }}</option><option v-for="item in models" :key="item.id" :value="item.id">{{ item.id }}</option></select></label>
                <p class="ext-hint">当前 {{ models.length }} 个可选模型。列表来自你的服务；能否调用取决于供应商 Key、模型类型和额度。</p>
                <a v-if="config && serverIsLocal" class="btn" :href="config.dashboardUrl" target="_blank" rel="noopener noreferrer" data-test="free-dashboard">打开 FreeLLMAPI 管理页</a>
                <p v-else-if="config" class="ext-hint" data-test="free-dashboard-remote">FreeLLMAPI 管理页需在工具箱服务器电脑上打开；当前网页可直接使用模型对话。</p>
                <div class="ext-divider ext-stack"><h3>当前对话</h3><p class="ext-hint">仅保存在本页面，发送时最多携带九轮完整历史。停止或失败的片段不会作为下轮上下文。</p><button class="btn" data-test="free-clear" @click="clearConversation">清空对话</button></div>
            </aside>
            <section class="ext-card ext-stack ext-main">
                <div class="ext-row ext-between"><h2>对话</h2><button v-if="busy" class="btn" data-test="free-stop" @click="stop">停止{{ busy === 'chat' ? '生成' : '请求' }}</button></div>
                <div ref="conversation" class="ext-conversation" data-test="free-conversation" :aria-busy="busy === 'chat'">
                    <div v-if="!turns.length" class="ext-empty">选择可用模型，输入你的第一个问题。</div>
                    <article v-for="turn in turns" :key="turn.id" class="ext-turn" data-test="free-turn">
                        <div class="ext-message is-user"><span>你</span><p>{{ turn.prompt }}</p></div>
                        <div class="ext-message"><span>{{ turn.model }}</span><p data-test="free-answer">{{ turn.answer || (turn.state === 'pending' ? '等待模型返回…' : '尚未收到文本') }}</p><small v-if="turn.state !== 'done'">{{ turn.state === 'pending' ? '正在生成' : turn.state === 'stopped' ? '已停止 · 片段未加入历史' : '未完成 · 片段未加入历史' }}</small><small v-else-if="turn.finishReason === 'length'">达到模型长度限制</small><button v-if="['stopped', 'error'].includes(turn.state)" class="btn btn-sm" :disabled="!!busy" @click="prompt = turn.prompt">重填问题</button></div>
                    </article>
                </div>
                <form class="ext-stack ext-divider" @submit.prevent="send">
                    <label class="ext-field">消息<textarea v-model="prompt" data-test="free-prompt" rows="3" maxlength="12000" placeholder="输入问题；Ctrl + Enter 发送" :disabled="!!busy" @keydown.ctrl.enter.prevent="send" /></label>
                    <div class="ext-row ext-between"><p class="ext-hint">发送到配置的 FreeLLMAPI 及其供应商，费用与数据规则以该服务为准。</p><button class="btn btn-primary" data-test="free-send" :disabled="!!busy || !model || !prompt.trim()">发送</button></div>
                </form>
            </section>
        </div>
        <template #footer>接入 <a href="https://github.com/tashfeenahmed/freellmapi" target="_blank" rel="noopener noreferrer">FreeLLMAPI</a> 的 OpenAI 兼容接口。服务本身免费开源，不代表供应商额度无限或所有模型免费。</template>
        <IntegrationDialog v-if="settings" title="FreeLLMAPI 连接设置" @close="closeSettings">
            <form class="ext-stack" @submit.prevent="saveSettings">
                <label class="ext-field">工具箱服务器上的 API 地址<input v-model.trim="baseUrl" data-test="free-base" placeholder="http://127.0.0.1:3001/v1" :disabled="!!busy" required /></label>
                <p class="ext-hint">FreeLLMAPI 需运行在工具箱服务器，通常为 3001 端口，桌面版可能为 31415。127.0.0.1 指服务器电脑，末尾 /v1 可省略。</p>
                <label class="ext-field">统一 API Key<input v-model="key" data-test="free-key" type="password" autocomplete="off" maxlength="512" :placeholder="config?.keyConfigured ? '留空保留当前 Key' : '从 FreeLLMAPI 的 Keys 页面复制'" :disabled="!!busy" /></label>
                <p class="ext-hint">使用统一推理 Key，不是管理页登录令牌。Key 仅保留在工具箱后端内存；重启服务后需重新填写，更换地址时需重新设置。</p>
                <p v-if="error" class="ext-notice is-error" role="alert">{{ error }}</p>
                <div class="ext-actions"><button class="btn btn-primary" data-test="free-settings-save" :disabled="!!busy">保存连接</button><button v-if="config?.keyConfigured" class="btn" type="button" data-test="free-key-clear" :disabled="!!busy" @click="clearKey">清除当前 Key</button></div>
            </form>
            <a href="https://github.com/tashfeenahmed/freellmapi/releases" target="_blank" rel="noopener noreferrer">获取 FreeLLMAPI</a>
        </IntegrationDialog>
        <IntegrationDialog v-if="help" title="模型对话帮助" @close="help = false"><p>先在工具箱服务器电脑安装并运行 FreeLLMAPI，在它的管理页添加供应商 Key 或本地模型端点，再复制统一 API Key。回到连接设置填写地址和 Key，保存后刷新模型列表。</p><p>本页接入文本聊天，不执行模型生成的命令或工具调用。需要图像、视频或完整路由配置时，打开 FreeLLMAPI 原管理页。</p><p>停止、清空或离页会取消等待；是否计费及上游任务是否立即停止，取决于供应商。Key 不进入团队备份，问题与回答不写入工具箱数据库。</p></IntegrationDialog>
    </IntegrationLayout>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount, nextTick } from 'vue';
import IntegrationLayout from '../components/IntegrationLayout.vue';
import IntegrationDialog from '../components/IntegrationDialog.vue';
import { integrationApi as api, operationMessage } from '../api/integration-client.js';
const config = ref(null), settings = ref(false), help = ref(false), baseUrl = ref('http://127.0.0.1:3001/v1'), key = ref(''), models = ref([]), model = ref(''), prompt = ref(''), turns = ref([]), conversation = ref(null);
const busy = ref(''), error = ref(''), notice = ref('');
const serverIsLocal = ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);
let active = null, disposed = false, generation = 0, sequence = 0;
async function run(kind, work) {
    if (busy.value) return;
    const controller = new AbortController(); active = controller; busy.value = kind; error.value = ''; notice.value = '';
    try { await work(controller.signal); }
    catch (e) { if (!disposed) error.value = operationMessage(e, controller.signal); }
    finally { if (active === controller) { active = null; busy.value = ''; } }
}
onMounted(() => run('load', async signal => { config.value = await api.freeConfig(signal); baseUrl.value = config.value.baseUrl; }));
function stop() { active?.abort(); }
function closeSettings() { if (busy.value === 'save') stop(); key.value = ''; settings.value = false; }
async function saveSettings() {
    await run('save', async signal => {
        config.value = await api.saveFreeConfig({ baseUrl: baseUrl.value, ...(key.value ? { key: key.value } : {}) }, signal);
        key.value = ''; models.value = []; model.value = ''; settings.value = false;
        notice.value = config.value.keyConfigured ? '连接已保存，请刷新模型列表' : '地址已保存，请设置统一 Key 后刷新模型';
    });
}
async function clearKey() { await run('save', async signal => { config.value = await api.saveFreeConfig({ baseUrl: config.value.baseUrl, clearKey: true }, signal); key.value = ''; models.value = []; model.value = ''; notice.value = '当前 Key 已从后端内存清除'; settings.value = false; }); }
async function refreshModels() { await run('models', async signal => { const result = await api.models(signal); models.value = result.items; if (!models.value.some(item => item.id === model.value)) model.value = models.value[0]?.id || ''; if (!models.value.length) notice.value = '服务未返回可用文本模型，请在原管理页检查 Key、模型与额度'; }); }
async function scrollToLatest() { await nextTick(); if (conversation.value) conversation.value.scrollTop = conversation.value.scrollHeight; }
async function send() {
    if (busy.value || !model.value || !prompt.value.trim()) return;
    const question = prompt.value.trim(), revision = generation;
    const history = turns.value.filter(turn => turn.state === 'done').slice(-9).flatMap(turn => [{ role: 'user', content: turn.prompt }, { role: 'assistant', content: turn.answer }]);
    while (history.length && history.reduce((sum, item) => sum + item.content.length, question.length) > 48000) history.splice(0, 2);
    const turn = { id: ++sequence, model: model.value, prompt: question, answer: '', state: 'pending', finishReason: '' };
    turns.value.push(turn); if (turns.value.length > 30) turns.value.shift();
    const row = turns.value.at(-1); prompt.value = ''; scrollToLatest();
    await run('chat', async signal => {
        try {
            const result = await api.chat({ model: model.value, messages: [...history, { role: 'user', content: question }] }, signal, event => {
                if (revision !== generation || disposed) return;
                if (event.type === 'delta') { row.answer += event.text; scrollToLatest(); }
            });
            if (revision === generation && !disposed) { row.state = 'done'; row.finishReason = result.finishReason; }
        } catch (e) { if (revision === generation) row.state = signal.aborted ? 'stopped' : 'error'; if (revision === generation) throw e; }
    });
}
function clearConversation() { generation++; stop(); turns.value = []; prompt.value = ''; error.value = ''; notice.value = '对话已清空'; }
onBeforeUnmount(() => { disposed = true; generation++; stop(); key.value = ''; turns.value = []; });
</script>
