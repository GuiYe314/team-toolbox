<template>
    <IntegrationLayout title="ArtCraft 创作台" subtitle="整理创作提示词，在工具箱服务器的 ArtCraft 中继续制作" tool-id="artcraft">
        <template #actions><button class="btn" data-test="art-settings" @click="settings = true">应用设置</button><button class="btn" @click="help = true">帮助</button></template>
        <p v-if="error" class="ext-notice is-error" role="alert">{{ error }}</p><p v-if="notice" class="ext-notice" role="status">{{ notice }}</p>
        <div class="ext-workspace">
            <section class="ext-card ext-stack">
                <h2>创作要求</h2>
                <form class="ext-stack" @submit.prevent="buildPrompt">
                    <label class="ext-field">创作类型<select v-model="kind" data-test="art-kind"><option>文生图</option><option>图生视频</option><option>3D 场景</option></select></label>
                    <label class="ext-field">主体与画面<textarea v-model="subject" data-test="art-subject" rows="4" maxlength="3000" placeholder="描述主体、场景、构图和希望保留的细节" required /></label>
                    <label class="ext-field">画面比例<select v-model="ratio"><option>16:9</option><option>9:16</option><option>1:1</option><option>4:3</option><option>3:4</option></select></label>
                    <label class="ext-field">风格与光线<input v-model="style" maxlength="500" placeholder="例如：写实、柔和自然光、电影质感" /></label>
                    <label v-if="kind !== '文生图'" class="ext-field">运动 / 相机要求<input v-model="camera" maxlength="500" placeholder="描述镜头、人物动作或空间关系" /></label>
                    <label class="ext-field">避免内容<input v-model="negative" maxlength="500" placeholder="可选，写下不希望出现的元素" /></label>
                    <button class="btn btn-primary" data-test="art-build">整理提示词</button>
                </form>
            </section>
            <section class="ext-card ext-stack ext-main">
                <div class="ext-row ext-between"><h2>创作提示词</h2><span class="ext-badge" :class="{ 'is-ready': config?.available }">{{ config?.available ? '服务器应用可启动' : '需要配置 ArtCraft' }}</span></div>
                <label class="ext-field">可继续编辑<textarea v-model="draft" data-test="art-draft" class="ext-prompt-editor" maxlength="8000" placeholder="整理后的提示词会显示在这里；这里不执行模型生成" /></label>
                <div class="ext-actions"><button class="btn btn-primary" data-test="art-copy" :disabled="!draft.trim()" @click="copy">复制提示词</button><button class="btn" data-test="art-open" :disabled="!!busy || !config?.available" @click="confirmLaunch = true">打开 ArtCraft</button></div>
                <p class="ext-hint">应用窗口会在运行工具箱的服务器电脑上打开。在该电脑的 ArtCraft 输入区粘贴提示词，选择模型与素材再生成。</p>
                <div class="ext-divider ext-stack"><h3>原生创作工作台</h3><p>ArtCraft 提供图像图层、局部编辑、视频和 3D 场景等功能。编辑画布在它自己的桌面窗口中打开，模型权限和费用由 ArtCraft 及供应商决定。</p><div class="ext-actions"><a class="btn" href="https://getartcraft.com/" target="_blank" rel="noopener noreferrer">ArtCraft 官网</a><a class="btn" href="https://github.com/storytold/artcraft/releases" target="_blank" rel="noopener noreferrer">获取安装包</a></div></div>
            </section>
        </div>
        <template #footer>上游 <a href="https://github.com/storytold/artcraft" target="_blank" rel="noopener noreferrer">ArtCraft</a> 使用 MIT / Apache-2.0 双许可。本页提供服务器应用启动与创作准备，未移植原生编辑器。</template>
        <IntegrationDialog v-if="settings" title="ArtCraft 应用设置" @close="settings = false">
            <form class="ext-stack" @submit.prevent="saveSettings"><label class="ext-field">ArtCraft.exe 完整路径<input v-model.trim="path" data-test="art-path" placeholder="C:\…\ArtCraft.exe" :disabled="!!busy" /></label><p class="ext-hint">先安装官方 Windows 版本，再填写应用文件路径。留空可清除设置；不会自动下载安装包或修改系统关联。</p><p v-if="error" class="ext-notice is-error" role="alert">{{ error }}</p><button class="btn btn-primary" data-test="art-settings-save" :disabled="!!busy">检测并保存</button></form>
        </IntegrationDialog>
        <IntegrationDialog v-if="confirmLaunch" title="打开服务器上的 ArtCraft" @close="confirmLaunch = false"><p>将在工具箱服务器电脑启动以下应用：</p><code class="ext-wrap">{{ config?.path }}</code><p>使用 ArtCraft 自己的账号和模型设置，在新窗口中粘贴提示词。</p><p v-if="error" class="ext-notice is-error" role="alert">{{ error }}</p><button class="btn btn-primary" data-test="art-confirm" :disabled="!!busy" @click="launch">确认打开</button></IntegrationDialog>
        <IntegrationDialog v-if="help" title="ArtCraft 使用帮助" @close="help = false"><p>先安装 ArtCraft，在应用设置中填写 ArtCraft.exe 路径。填写创作要求并整理、编辑和复制提示词，点击“打开 ArtCraft”，核对路径后确认。</p><p>ArtCraft 的原生窗口依赖 Rust/Tauri 能力，不能直接把网页开发预览当作完整编辑器嵌入。本页不读取 ArtCraft 的账号、素材或密钥，也不结束应用进程。</p><p>模型和素材操作在 ArtCraft 中完成；本页提示词只保留在当前页面，离页后清空。</p></IntegrationDialog>
    </IntegrationLayout>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue';
import IntegrationLayout from '../components/IntegrationLayout.vue';
import IntegrationDialog from '../components/IntegrationDialog.vue';
import { integrationApi as api, operationMessage } from '../api/integration-client.js';
import { copyText } from '../utils/clipboard.js';
const config = ref(null), settings = ref(false), help = ref(false), confirmLaunch = ref(false), path = ref(''), busy = ref(''), error = ref(''), notice = ref('');
const kind = ref('文生图'), subject = ref(''), ratio = ref('16:9'), style = ref(''), camera = ref(''), negative = ref(''), draft = ref('');
let active = null, disposed = false;
async function run(kind, work) {
    if (busy.value) return;
    const controller = new AbortController(); active = controller; busy.value = kind; error.value = ''; notice.value = '';
    try { await work(controller.signal); }
    catch (e) { if (!disposed) error.value = operationMessage(e, controller.signal); }
    finally { if (active === controller) { active = null; busy.value = ''; } }
}
onMounted(() => run('load', async signal => { config.value = await api.artcraftConfig(signal); path.value = config.value.path; }));
async function saveSettings() { await run('save', async signal => { config.value = await api.saveArtcraftConfig(path.value, signal); path.value = config.value.path; settings.value = false; notice.value = config.value.available ? 'ArtCraft 路径已检测并保存' : '应用路径已清除'; }); }
async function launch() { await run('launch', async signal => { const result = await api.launchArtcraft(signal); notice.value = result.message; confirmLaunch.value = false; }); }
function buildPrompt() { if (!subject.value.trim()) return; draft.value = [`创作类型：${kind.value}`, `画面比例：${ratio.value}`, `主体与画面：${subject.value.trim()}`, style.value.trim() && `风格与光线：${style.value.trim()}`, kind.value !== '文生图' && camera.value.trim() && `运动与相机：${camera.value.trim()}`, negative.value.trim() && `避免内容：${negative.value.trim()}`].filter(Boolean).join('\n'); notice.value = '提示词已整理，可继续编辑后复制'; }
async function copy() { try { await copyText(draft.value); notice.value = '提示词已复制，请在 ArtCraft 中粘贴'; error.value = ''; } catch { error.value = '浏览器未允许复制，请在提示词框中全选并手动复制'; } }
onBeforeUnmount(() => { disposed = true; active?.abort(); draft.value = ''; });
</script>
