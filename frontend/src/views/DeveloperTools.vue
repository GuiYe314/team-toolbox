<template>
    <IntegrationLayout class="workshop" tool-id="developer-tools" title="开发工具合集" subtitle="编码、时间、校验、JSON 和文本对比，输入仅在当前页面处理。">
        <div class="workshop-panel"><nav class="workshop-tabs" aria-label="开发工具选择"><button v-for="tool in DEV_TOOLS" :key="tool.id" class="btn btn-sm" :class="{ 'is-active': selected === tool.id }" :aria-pressed="selected === tool.id" @click="select(tool.id)">{{ tool.name }}</button></nav>
        <p v-if="selected === 'diff'" class="workshop-note">左侧填写原始文本，右侧填写修改文本，可直接编辑并比较差异。</p><TextDiffEditor v-if="selected === 'diff'"/>
        <template v-else><div class="workshop-grid"><div><label>输入<textarea id="dev-input" v-model="input" :placeholder="placeholder" maxlength="1048576"/></label><div v-if="selected === 'regex'" class="workshop-fields"><label>正则表达式<input id="regex-pattern" v-model="pattern" class="input" maxlength="2000" placeholder="例如 error|warning"/></label><label>标志<input v-model="flags" class="input" maxlength="5" placeholder="gim"/></label></div><label v-if="selected === 'uuid'">生成数量（1～100）<input v-model.number="uuidCount" class="input" type="number" min="1" max="100"/></label><div class="ext-row"><button id="dev-run" class="btn btn-primary" :disabled="busy" @click="run(false)">{{ primaryLabel }}</button><button v-if="['json','base64','url','timestamp'].includes(selected)" class="btn" :disabled="busy" @click="run(true)">{{ secondaryLabel }}</button><button v-if="selected === 'timestamp'" class="btn" @click="input=String(Date.now())">当前时间</button><button class="btn" @click="clear">清空</button></div></div><div><label>结果<textarea id="dev-output" v-model="output" placeholder="处理结果"/></label><img v-if="qr" class="transfer-qr" :src="qr" alt="生成的二维码"/><div class="ext-row"><button class="btn" :disabled="!output" @click="copy">复制结果</button><button class="btn" :disabled="!output" @click="downloadBlob(new Blob([output], {type:'text/plain;charset=utf-8'}), selected === 'json' ? '格式化.json' : '转换结果.txt')">下载结果</button><a v-if="qr" class="btn" :href="qr" download="二维码.png">下载二维码</a></div></div></div></template><p v-if="error" class="workshop-error" role="alert">{{ error }}</p><p v-if="notice" class="workshop-note" role="status">{{ notice }}</p></div><template #footer>文本不上传、不自动保存。正则测试在独立 Worker 中执行，超过2秒停止；二维码包含你输入的完整内容。</template>
    </IntegrationLayout>
</template>
<script setup>
import { ref, computed, watch, onBeforeUnmount, defineAsyncComponent } from 'vue';
import { useRoute } from 'vue-router';
import IntegrationLayout from '../components/IntegrationLayout.vue';
import { DEV_TOOLS, utf8Base64, timestampConvert, convertColor, normalizeRegexFlags } from '../utils/developer-tools.js';
import { copyText } from '../utils/clipboard.js';
import { downloadBlob } from '../utils/tool-files.js';
const TextDiffEditor = defineAsyncComponent(() => import('../components/TextDiffEditor.vue'));
const route = useRoute(), selected = ref(route.name === 'tool-json-fmt' ? 'json' : route.name === 'tool-qrcode' ? 'qrcode' : 'json');
const input = ref(''), output = ref(''), error = ref(''), notice = ref(''), qr = ref(''), busy = ref(false), pattern = ref(''), flags = ref('g'), uuidCount = ref(1);
let regexWorker, regexTimer, generation = 0;
const primaryLabel = computed(() => ({ json:'美化 JSON', base64:'编码 Base64', url:'编码 URL', timestamp:'时间戳转日期', uuid:'生成 UUID', hash:'计算 SHA-256', regex:'测试正则', color:'转换颜色', qrcode:'生成二维码' }[selected.value]));
const secondaryLabel = computed(() => ({json:'压缩 JSON',base64:'解码 Base64',url:'解码 URL',timestamp:'日期转时间戳'}[selected.value]));
const placeholder = computed(() => ({ json:'粘贴 JSON',timestamp:'秒/毫秒时间戳，或带时区的日期',color:'#4C6EF5 或 rgb(76, 110, 245)',qrcode:'文本或链接，不会自动打开',uuid:'无需输入，点击生成',regex:'待匹配的文本' }[selected.value] || '输入文本'));
function cancelRegex() { regexWorker?.terminate(); regexWorker = null; clearTimeout(regexTimer); }
function clear() { generation++; cancelRegex(); busy.value = false; input.value = ''; output.value = ''; qr.value = ''; error.value = ''; notice.value = ''; }
function select(id) { clear(); selected.value = id; }
async function copy() { try { await copyText(output.value); notice.value = '已复制'; } catch { error.value = '复制失败，请手动复制'; } }
async function run(reverse) {
    error.value = ''; notice.value = ''; qr.value = ''; const current = ++generation, type = selected.value; busy.value = true;
    try {
        if (input.value.length > 1024 ** 2) throw new Error('输入最多1MiB');
        if (type === 'json') output.value = JSON.stringify(JSON.parse(input.value), null, reverse ? 0 : 2);
        else if (type === 'base64') output.value = utf8Base64(input.value, reverse);
        else if (type === 'url') output.value = reverse ? decodeURIComponent(input.value) : encodeURIComponent(input.value);
        else if (type === 'timestamp') output.value = timestampConvert(input.value, reverse);
        else if (type === 'uuid') {
            if (!Number.isInteger(uuidCount.value) || uuidCount.value < 1 || uuidCount.value > 100) throw new Error('数量应为1～100');
            const { v4 } = await import('uuid'); if (current === generation) output.value = Array.from({length:uuidCount.value},()=>v4()).join('\n');
        } else if (type === 'hash') { const { sha256 } = await import('@noble/hashes/sha256'); if (current === generation) output.value = Array.from(sha256(new TextEncoder().encode(input.value)),byte=>byte.toString(16).padStart(2,'0')).join(''); }
        else if (type === 'color') output.value = convertColor(input.value);
        else if (type === 'qrcode') {
            if (!input.value || new TextEncoder().encode(input.value).length > 2000) throw new Error('二维码内容请输入1～2000字节');
            const { default: QRCode } = await import('qrcode'), style = getComputedStyle(document.documentElement);
            const url = await QRCode.toDataURL(input.value,{ width:320, margin:3, errorCorrectionLevel:'M', color:{dark:style.getPropertyValue('--adb-qr-foreground').trim(), light:style.getPropertyValue('--adb-qr-background').trim()} });
            if (current === generation) { qr.value = url; output.value = input.value; }
        } else if (type === 'regex') {
            if (input.value.length > 200_000 || !pattern.value) throw new Error('请输入正则表达式，待匹配文字最多20万字');
            const normalized = normalizeRegexFlags(flags.value); cancelRegex();
            await new Promise((resolve,reject)=>{ regexWorker = new Worker(new URL('../workers/regex-worker.js',import.meta.url),{type:'module'}); regexTimer = setTimeout(()=>{cancelRegex();reject(new Error('正则执行超过2秒，已停止，请简化表达式'));},2000); regexWorker.onerror=()=>{cancelRegex();reject(new Error('正则执行失败'));};regexWorker.onmessage=({data})=>{cancelRegex();if(data.error)reject(new Error(data.error));else {if(current===generation)output.value=JSON.stringify(data.matches,null,2);resolve();}};regexWorker.postMessage({text:input.value,pattern:pattern.value,flags:normalized}); });
        }
    } catch(e) { if (current === generation) { output.value=''; error.value=e.message || '转换失败，请检查输入'; } }
    finally { if(current===generation)busy.value=false; }
}
watch(()=>route.name,()=>select(route.name==='tool-qrcode'?'qrcode':'json'));
onBeforeUnmount(clear);
</script>
