<template>
    <Teleport to="body">
        <div class="overlay" @click.self="close" @keydown="onKeydown">
            <section ref="dialog" class="dialog adb-command-editor" role="dialog" aria-modal="true" aria-labelledby="adb-command-editor-title">
                <header class="adb-editor-head"><h2 id="adb-command-editor-title" class="dialog-title">{{ record ? '编辑自定义命令' : '添加自定义命令' }}</h2><button id="adb-editor-close" class="btn btn-sm" :disabled="busy" @click="close">关闭</button></header>
                <form id="adb-command-editor-form" class="adb-editor-form" @submit.prevent="save">
                    <label for="adb-custom-title">名称<input id="adb-custom-title" ref="nameInput" v-model="draft.title" class="input" required maxlength="60" :disabled="busy" placeholder="例如：查看应用内存" /></label>
                    <label for="adb-custom-category">分类<input id="adb-custom-category" v-model="draft.category" class="input" maxlength="30" :disabled="busy" placeholder="自定义" /></label>
                    <label for="adb-custom-arguments">命令参数<textarea id="adb-custom-arguments" v-model="draft.arguments" class="input adb-editor-arguments" required maxlength="2048" :disabled="busy" placeholder="shell dumpsys meminfo com.example.app" /></label>
                    <p class="adb-editor-muted">填写 adb 后的参数，设备在命令区选择。含空格的参数可用引号包裹。</p>
                    <label for="adb-custom-description">说明（可选）<input id="adb-custom-description" v-model="draft.description" class="input" maxlength="400" :disabled="busy" /></label>
                    <code class="adb-editor-preview">adb -s &lt;设备&gt; {{ draft.arguments }}</code>
                    <p v-if="error" id="adb-editor-error" class="adb-editor-error" role="alert">{{ error }}</p>
                    <footer class="adb-editor-actions"><button id="adb-custom-save" type="submit" class="btn btn-primary" :disabled="busy || !draft.title.trim() || !draft.arguments.trim()">{{ busy ? '保存中…' : '保存命令' }}</button><button id="adb-custom-cancel" type="button" class="btn" :disabled="busy" @click="close">取消</button></footer>
                </form>
            </section>
        </div>
    </Teleport>
</template>

<script>
import { androidApi } from '../api/android-client.js';
export default {
    name: 'AndroidCommandEditor',
    props: { record: { type: Object, default: null } },
    emits: ['close', 'saved', 'busy-change'],
    data() { return { draft: { title: this.record?.title || '', category: this.record?.category || '自定义', description: this.record?.description || '', arguments: this.record?.arguments || '' }, busy: false, error: '' }; },
    mounted() { this._controller = new AbortController(); this.$refs.nameInput.focus(); },
    beforeUnmount() { this._disposed = true; this._controller.abort(); },
    methods: {
        close() { if (!this.busy) this.$emit('close'); },
        async save() {
            if (this.busy) return;
            this.busy = true; this.error = ''; this.$emit('busy-change', true);
            try {
                const input = { ...this.draft, ...(this.record ? { revision: this.record.revision } : {}) };
                const result = await androidApi.saveCommand(input, this.record?.id, this._controller.signal);
                if (!this._disposed) this.$emit('saved', result.command);
            } catch (error) { if (!this._disposed) this.error = error.message; }
            finally { if (!this._disposed) { this.busy = false; this.$emit('busy-change', false); } }
        },
        onKeydown(event) {
            if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); this.close(); }
            if (event.key === 'Tab') {
                const elements = [...this.$refs.dialog.querySelectorAll('button:not(:disabled), input:not(:disabled), textarea:not(:disabled)')];
                const first = elements[0], last = elements.at(-1);
                if (!first) { event.preventDefault(); return; }
                if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
                if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
            }
        }
    }
};
</script>

<style scoped>
.adb-command-editor { width: min(var(--adb-command-editor-width), calc(100vw - var(--page-padding) * 2)); max-width: none; max-height: calc(100vh - var(--page-padding) * 2); box-sizing: border-box; display: flex; flex-direction: column; }
.adb-editor-head, .adb-editor-actions { display: flex; justify-content: space-between; align-items: center; gap: var(--gap-column); }
.adb-editor-head h2 { margin: 0; }
.adb-editor-form { overflow-y: auto; min-height: 0; margin-top: var(--gap-column); }
.adb-editor-form label { display: block; margin-bottom: var(--gap-column); color: var(--text-secondary); }
.adb-editor-form .input { display: block; width: 100%; box-sizing: border-box; margin-top: var(--adb-small-gap); }
.adb-editor-arguments { min-height: var(--adb-command-editor-input-height); resize: vertical; font-family: var(--font-mono); }
.adb-editor-muted { font-size: var(--text-body); line-height: var(--line-relaxed); color: var(--text-secondary); }
.adb-editor-preview { display: block; overflow-wrap: anywhere; white-space: pre-wrap; margin-bottom: var(--gap-column); }
.adb-editor-error { color: var(--danger); overflow-wrap: anywhere; }
.adb-editor-actions { justify-content: flex-end; margin-top: var(--gap-column); }
</style>
