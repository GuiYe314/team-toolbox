import { fields, problem, localBaseUrl } from './integration-common.js';

export function validateChat(body) {
    fields(body, ['model', 'messages']);
    if (typeof body.model !== 'string' || !body.model.trim() || body.model.length > 200 || /[\x00-\x1f]/.test(body.model)) throw problem('invalid_model', '请选择可用的文本模型');
    if (!Array.isArray(body.messages) || body.messages.length < 1 || body.messages.length > 19 || body.messages.length % 2 !== 1) throw problem('invalid_messages', '对话最多携带九轮历史和当前问题');
    let total = 0;
    const messages = body.messages.map((message, index) => {
        fields(message, ['role', 'content']);
        if (message.role !== (index % 2 === 0 ? 'user' : 'assistant') || typeof message.content !== 'string' || !message.content.trim() || message.content.length > 12000) throw problem('invalid_messages', '仅支持交替的文本问答，每条最多 12000 字');
        total += message.content.length;
        return { role: message.role, content: message.content };
    });
    if (total > 48000) throw problem('history_limit', '对话上下文超过 48000 字，请清空后重试');
    return { model: body.model, messages };
}

export function createFreeLlmService({ config, fetchImpl = fetch, timeoutMs = 120000, maxResponseBytes = 2 * 1024 * 1024 } = {}) {
    let apiKey = '', knownModels = new Set(), chatting = false, configuring = false, disposed = false;
    const operations = new Set();
    async function getConfig() {
        const value = await config.read();
        const baseUrl = localBaseUrl(value.freeBaseUrl);
        return { baseUrl, dashboardUrl: new URL(baseUrl).origin, keyConfigured: !!apiKey };
    }
    async function configure(body) {
        fields(body, ['baseUrl', 'key', 'clearKey']);
        if (chatting || configuring || operations.size) throw problem('busy', '请先停止或等待模型请求，再修改设置', 409);
        const baseUrl = localBaseUrl(body.baseUrl);
        if (body.key !== undefined && (typeof body.key !== 'string' || !/^[\x21-\x7e]{8,512}$/.test(body.key))) throw problem('invalid_key', '统一 Key 应为 8～512 个可见英文字符，不能包含空白');
        if (body.clearKey !== undefined && typeof body.clearKey !== 'boolean' || body.clearKey && body.key) throw problem('invalid_key', '清除 Key 时不能同时提交新 Key');
        configuring = true;
        try {
            const previous = await getConfig();
            await config.update({ freeBaseUrl: baseUrl });
            if (body.clearKey || previous.baseUrl !== baseUrl) apiKey = '';
            if (body.key !== undefined) apiKey = body.key;
            knownModels = new Set();
            return await getConfig();
        } finally { configuring = false; }
    }
    async function request(path, options, signal, consume) {
        if (disposed) throw problem('closed', '服务正在关闭', 503);
        if (configuring) throw problem('busy', '连接设置正在保存，请稍后重试', 409);
        if (!apiKey) throw problem('missing_key', '请在连接设置中填写 FreeLLMAPI 的统一 API Key');
        const controller = new AbortController(); operations.add(controller);
        const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
        let timedOut = false, response;
        const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
        try {
            const { baseUrl } = await getConfig();
            response = await fetchImpl(baseUrl + path, { ...options, headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json', ...(options.headers || {}) }, signal: combined, redirect: 'error' });
            if (!response.ok) {
                const messages = { 401: '统一 Key 无效或已被撤销', 403: 'FreeLLMAPI 拒绝了此模型请求', 404: '接口不存在，请检查 FreeLLMAPI 端口和版本', 429: '模型额度或请求频率受限，请稍后重试' };
                throw problem('upstream_error', messages[response.status] || `FreeLLMAPI 请求失败（HTTP ${response.status}），请查看其管理页`, response.status === 429 ? 429 : 502);
            }
            if (!response.body) throw problem('invalid_response', '模型接口没有返回响应内容', 502);
            return await consume(response, combined);
        } catch (error) {
            if (timedOut) throw problem('timeout', '模型请求超时，已停止等待', 504);
            if (combined.aborted) throw problem('cancelled', '模型请求已取消', 499);
            if (error?.code && error?.status) throw error;
            throw problem('connection_failed', '无法连接 FreeLLMAPI，请检查本机服务、端口或返回格式', 502);
        } finally {
            clearTimeout(timer); operations.delete(controller);
            // cancel 也覆盖读取器已释放但上游尚未关闭的连接。
            if (response?.body && !response.body.locked) await response.body.cancel().catch(() => {});
        }
    }
    async function models(signal) {
        return request('/models?available=true', { method: 'GET' }, signal, async response => {
            const reader = response.body.getReader(), chunks = [];
            let bytes = 0;
            try {
                while (true) {
                    const { done, value } = await reader.read(); if (done) break;
                    bytes += value.byteLength;
                    if (bytes > maxResponseBytes) throw problem('response_limit', '模型列表超过大小上限', 502);
                    chunks.push(Buffer.from(value));
                }
            } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
            let parsed;
            try { parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw problem('invalid_response', '模型列表格式无效', 502); }
            if (!Array.isArray(parsed.data)) throw problem('invalid_response', '接口没有返回 OpenAI 格式的模型列表', 502);
            const unique = new Map();
            for (const item of parsed.data.slice(0, 2000)) {
                if (typeof item?.id !== 'string' || !item.id.trim() || item.id.length > 200 || /[\x00-\x1f]/.test(item.id) || ['needsKey', 'exhausted'].includes(item.execution_status)) continue;
                if (item.type && ['image', 'video', 'audio', 'embedding'].includes(item.type)) continue;
                unique.set(item.id, { id: item.id, owner: typeof item.owned_by === 'string' ? item.owned_by.slice(0, 100) : '' });
            }
            const items = [...unique.values()].slice(0, 1000);
            knownModels = new Set(items.map(item => item.id));
            return { items };
        });
    }
    async function chat(body, signal, emit = () => {}) {
        const { model, messages } = validateChat(body);
        if (chatting) throw problem('busy', '另一个模型对话正在进行，请先停止或等待', 409);
        if (!knownModels.has(model)) throw problem('unknown_model', '请先刷新模型列表，再选择本次返回的模型');
        chatting = true;
        try {
            return await request('/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' }, body: JSON.stringify({ model, messages, stream: true }) }, signal, async (response, combined) => {
                if (!/^text\/event-stream\b/i.test(response.headers.get('content-type') || '')) throw problem('invalid_response', '此接口没有返回流式文本，请检查模型是否支持聊天', 502);
                emit({ type: 'start', model });
                const reader = response.body.getReader(), decoder = new TextDecoder();
                let buffer = '', text = '', bytes = 0, complete = false, finishReason = '', usage = null;
                function event(block) {
                    const data = block.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
                    if (!data) return;
                    if (data.trim() === '[DONE]') { complete = true; return; }
                    let value;
                    try { value = JSON.parse(data); } catch { throw problem('invalid_response', '模型流数据损坏，当前回答未完成', 502); }
                    if (value.error) throw problem('upstream_error', '模型生成中断，请检查 FreeLLMAPI 状态与供应商额度', 502);
                    const choice = value.choices?.[0], delta = choice?.delta?.content;
                    if (choice?.finish_reason === 'content_filter') throw problem('content_filtered', '供应商中断了当前回答，收到的片段未作为完整回答保存', 502);
                    if (typeof delta === 'string' && delta) {
                        text += delta;
                        if (text.length > 12000) throw problem('response_limit', '回答超过 12000 字上限，已停止；可另起问题继续', 502);
                        emit({ type: 'delta', text: delta });
                    }
                    if (choice?.finish_reason) finishReason = String(choice.finish_reason).slice(0, 40);
                    if (value.usage) usage = Object.fromEntries(['prompt_tokens', 'completion_tokens', 'total_tokens'].filter(key => Number.isSafeInteger(value.usage[key]) && value.usage[key] >= 0).map(key => [key, value.usage[key]]));
                }
                try {
                    while (!complete) {
                        const { done, value } = await reader.read();
                        if (done) break;
                        if (combined.aborted) throw problem('cancelled', '模型请求已取消', 499);
                        bytes += value.byteLength;
                        if (bytes > maxResponseBytes) throw problem('response_limit', '模型响应超过大小上限，已停止', 502);
                        buffer += decoder.decode(value, { stream: true }).replace(/\r/g, '');
                        let boundary;
                        while ((boundary = buffer.indexOf('\n\n')) >= 0) {
                            const block = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
                            if (block.length > 65536) throw problem('response_limit', '模型单条流事件超过上限', 502);
                            event(block); if (complete) break;
                        }
                        if (buffer.length > 65536) throw problem('response_limit', '模型单条流事件超过上限', 502);
                    }
                    buffer += decoder.decode();
                    if (!complete && buffer.trim()) event(buffer);
                    if (!complete || !text.trim()) throw problem('incomplete_response', '模型未返回完整文本，已保留收到的片段；可重试', 502);
                    const result = { type: 'done', model, finishReason, usage };
                    emit(result); return result;
                } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
            });
        } finally { chatting = false; }
    }
    function dispose() { disposed = true; for (const controller of operations) controller.abort(); apiKey = ''; knownModels.clear(); }
    return { getConfig, configure, models, chat, dispose };
}
