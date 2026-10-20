<template>
    <!--
      存储路径设置面板（镜像目录）。

      语义要说清楚，避免误解：
        - 主存储（服务端权威副本）位置固定不变，UI 上明确标出
        - 这里设置的是**镜像目录**：资源会**自动拷贝**一份过去
        - 设置后立即全量同步已有资源，之后每次上传自动增量同步
    -->
    <div class="overlay" @click.self="$emit('close')">
        <div class="dialog am-storage-dialog" role="dialog" aria-modal="true" aria-labelledby="am-storage-title">
            <h2 class="dialog-title" id="am-storage-title">资源保存路径</h2>

            <!-- 主存储位置（只读，说明性） -->
            <div class="am-primary">
                <span class="am-primary-label">主存储（服务端权威副本）</span>
                <code class="am-primary-path" :title="settings.primaryPath">{{ settings.primaryPath || '加载中…' }}</code>
            </div>

            <p class="am-storage-hint">
                设置后，资源会<strong>自动拷贝</strong>到指定目录 —— 适合把素材同步到 Unity 项目目录、
                NAS 或同步盘。主存储始终保留，外部磁盘不可用时不影响正常使用。
            </p>

            <!-- 路径输入 -->
            <div class="am-path-row">
                <input
                    ref="pathInput"
                    v-model="pathInput"
                    class="input am-path-input"
                    type="text"
                    placeholder="例如 D:\UnityProjects\Museum\Assets 或 /mnt/nas/assets"
                    spellcheck="false"
                    @keyup.enter="apply"
                />
                <button class="btn btn-sm" type="button" :disabled="checking" @click="checkPath">
                    {{ checking ? '校验中…' : '校验' }}
                </button>
            </div>

            <p v-if="pathMessage" class="am-path-msg" :class="pathOk ? 'is-ok' : 'is-err'">
                {{ pathMessage }}
            </p>

            <!-- 当前镜像状态 -->
            <div v-if="settings.configured" class="am-mirror-state">
                <div class="am-mirror-row">
                    <span class="am-mirror-label">已同步文件</span>
                    <span class="am-mirror-value">{{ settings.files }} 个</span>
                </div>
                <div class="am-mirror-row">
                    <span class="am-mirror-label">占用空间</span>
                    <span class="am-mirror-value">{{ formatSize(settings.bytes) }}</span>
                </div>
                <div class="am-mirror-row" v-if="settings.available === false">
                    <span class="am-mirror-label">目录状态</span>
                    <span class="am-mirror-value is-err">路径不存在（外部盘可能已断开）</span>
                </div>
            </div>

            <p v-if="error" class="notice notice-error am-storage-error">{{ error }}</p>

            <div class="dialog-actions am-storage-actions">
                <button
                    v-if="settings.configured"
                    class="btn btn-sm btn-ghost"
                    type="button"
                    :disabled="busy"
                    @click="syncNow"
                >立即同步</button>
                <button
                    v-if="settings.configured"
                    class="btn btn-sm btn-ghost"
                    type="button"
                    :disabled="busy"
                    @click="clearMirror"
                >清空镜像</button>
                <span class="am-sel-spacer"></span>
                <button class="btn" type="button" @click="$emit('close')">关闭</button>
                <button
                    v-if="settings.configured"
                    class="btn btn-danger"
                    type="button"
                    :disabled="busy"
                    @click="clearConfig"
                >停止同步</button>
                <button class="btn btn-primary" type="button" :disabled="busy" @click="apply">
                    {{ busy ? '处理中…' : '保存并同步' }}
                </button>
            </div>
        </div>
    </div>
</template>

<script>
import assetApi from '../../api/asset-client.js';
import { formatSize } from '../../assets/asset-meta.js';

export default {
    name: 'AssetStorageSettings',
    emits: ['close', 'changed'],
    data() {
        return {
            settings: { configured: false, path: null, files: 0, bytes: 0, primaryPath: '', available: null },
            pathInput: '',
            pathMessage: '',
            pathOk: false,
            checking: false,
            busy: false,
            error: ''
        };
    },
    async mounted() {
        await this.load();
    },
    methods: {
        formatSize,
        async load() {
            try {
                const { res, body } = await assetApi.getStorageSettings();
                if (res.ok && body) {
                    this.settings = body;
                    this.pathInput = body.path || '';
                }
            } catch (e) {
                this.error = e.network ? e.message : (e.message || '读取设置失败');
            }
        },
        async checkPath() {
            this.pathMessage = '';
            this.pathOk = false;
            // 读 DOM 里的当前值，而不是 this.pathInput ——
            // v-model 同步有微小的时序差（输入后立刻点校验可能还没同步），
            // 而用户看到的就是输入框里的内容。
            const el = this.$refs.pathInput;
            const p = (el ? el.value : this.pathInput).trim();
            if (!p) {
                this.pathMessage = '请输入路径';
                return;
            }
            this.checking = true;
            try {
                const { res, body } = await assetApi.validateStoragePath(p);
                if (res.ok) {
                    this.pathOk = true;
                    this.pathMessage = `路径可用：${body.path}`;
                } else {
                    this.pathMessage = (body && body.message) || '路径不可用';
                }
            } catch (e) {
                this.pathMessage = e.message || '校验失败';
            } finally {
                this.checking = false;
            }
        },
        async apply() {
            this.error = '';
            this.busy = true;
            // 同样读输入框当前值（见 checkPath 的说明）
            const el = this.$refs.pathInput;
            const raw = (el ? el.value : this.pathInput).trim();
            try {
                const { res, body } = await assetApi.setStoragePath(raw);
                if (!res.ok) {
                    this.error = (body && body.message) || '设置失败';
                    return;
                }
                this.settings = body;
                this.pathInput = body.path || '';
                this.pathMessage = body.synced
                    ? `已同步 ${body.synced.copied} 个文件${body.synced.failed ? `，${body.synced.failed} 个失败` : ''}`
                    : '保存成功';
                this.pathOk = true;
                this.$emit('changed');
            } catch (e) {
                this.error = e.network ? e.message : (e.message || '设置失败');
            } finally {
                this.busy = false;
            }
        },
        async syncNow() {
            this.error = '';
            this.busy = true;
            try {
                const { res, body } = await assetApi.syncStorage();
                if (!res.ok) {
                    this.error = (body && body.message) || '同步失败';
                    return;
                }
                this.settings = body;
                this.pathMessage = `已同步 ${body.synced.copied} 个文件`;
                this.$emit('changed');
            } catch (e) {
                this.error = e.message || '同步失败';
            } finally {
                this.busy = false;
            }
        },
        async clearMirror() {
            if (!window.confirm('确定清空镜像目录中的所有文件吗？此操作不可撤销。\n（主存储不受影响）')) return;
            this.error = '';
            this.busy = true;
            try {
                const { res, body } = await assetApi.clearStorage();
                if (!res.ok) {
                    this.error = (body && body.message) || '清空失败';
                    return;
                }
                this.settings = body;
                this.pathMessage = `已清空 ${body.removed} 个文件`;
            } catch (e) {
                this.error = e.message || '清空失败';
            } finally {
                this.busy = false;
            }
        },
        async clearConfig() {
            if (!window.confirm('停止同步到该目录吗？\n已拷贝的文件会保留在目录中。')) return;
            this.error = '';
            this.busy = true;
            try {
                const { res, body } = await assetApi.setStoragePath('');
                if (!res.ok) {
                    this.error = (body && body.message) || '操作失败';
                    return;
                }
                this.settings = body;
                this.pathInput = '';
                this.pathMessage = '已停止同步';
                this.$emit('changed');
            } catch (e) {
                this.error = e.message || '操作失败';
            } finally {
                this.busy = false;
            }
        }
    }
};
</script>

<style scoped>
.am-storage-dialog { max-width: 560px; }
.am-primary {
    display: flex;
    flex-direction: column;
    gap: 3px;
    padding: 9px 11px;
    margin-bottom: 10px;
    border-radius: var(--radius-sm);
    background: var(--panel-background-hover);
    border: 1px solid var(--panel-border);
}
.am-primary-label { font-size: var(--text-tag); color: var(--text-tertiary); }
.am-primary-path {
    font-family: var(--font-mono);
    font-size: var(--text-secondary);
    color: var(--text-primary);
    word-break: break-all;
}
.am-storage-hint {
    margin: 0 0 12px;
    font-size: var(--text-secondary);
    line-height: var(--line-normal);
    color: var(--text-secondary);
}
.am-storage-hint strong { color: var(--text-primary); font-weight: var(--weight-semibold); }
.am-path-row { display: flex; gap: 7px; align-items: center; }
.am-path-input { flex: 1; min-width: 0; font-family: var(--font-mono); font-size: var(--text-secondary); }
.am-path-msg {
    margin: 7px 0 0;
    font-size: var(--text-tag);
    line-height: var(--line-normal);
}
.am-path-msg.is-ok { color: var(--success); }
.am-path-msg.is-err { color: var(--danger); }

.am-mirror-state {
    display: flex;
    flex-direction: column;
    gap: 5px;
    margin-top: 12px;
    padding: 9px 11px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--panel-border);
    background: var(--panel-background-hover);
}
.am-mirror-row { display: flex; justify-content: space-between; gap: 10px; }
.am-mirror-label { font-size: var(--text-secondary); color: var(--text-tertiary); }
.am-mirror-value { font-size: var(--text-secondary); color: var(--text-primary); font-variant-numeric: tabular-nums; }
.am-mirror-value.is-err { color: var(--danger); }

.am-storage-error { margin-top: 10px; }
.am-storage-actions { flex-wrap: wrap; gap: 6px; }
</style>
