<template>
    <div class="set-page">
        <header class="set-head">
            <h1 class="set-title">设置</h1>
            <p class="set-desc">
                版本信息与自动更新。更新源指向一个放着
                <code>manifest.json</code> 与发布包的位置，可以是内网共享目录，
                也可以是任意静态文件服务。
            </p>
        </header>

        <div v-if="loading" class="state-loading">加载中…</div>

        <template v-else>
            <!-- 回滚提示：优先级最高，必须让用户知道「上次没装成功」 -->
            <div v-if="status && status.rollback" class="set-alert set-alert-danger">
                <div class="set-alert-body">
                    <strong>上次更新没有成功，已自动回滚到原版本</strong>
                    <p>{{ status.rollback }}</p>
                    <p class="set-alert-hint">可查看 <code>data/updates/apply.log</code> 了解失败原因。</p>
                </div>
                <button class="btn btn-sm" type="button" @click="dismissRollback">知道了</button>
            </div>

            <!-- 版本信息 -->
            <section class="set-card">
                <h2 class="set-card-title">当前版本</h2>
                <dl class="set-kv">
                    <dt>程序版本</dt>
                    <dd><code class="set-code">{{ currentVersion }}</code></dd>

                    <dt>更新源</dt>
                    <dd>
                        <span v-if="!status || !status.configured" class="set-tag set-tag-muted">未配置</span>
                        <span v-else-if="status.sourceOrigin === 'env'" class="set-tag">由环境变量指定</span>
                        <code v-if="status && status.source" class="set-code">{{ status.source }}</code>
                    </dd>

                    <dt>上次检查</dt>
                    <dd class="set-muted">{{ lastCheckText }}</dd>
                </dl>
            </section>

            <!-- 更新源配置 -->
            <section class="set-card">
                <h2 class="set-card-title">更新源地址</h2>
                <p class="set-hint">
                    可以填目录，也可以直接填 <code>manifest.json</code> 的地址。支持内网共享目录
                    （形如 <code>\\fileserver\share\team-toolbox</code>）与
                    <code>http(s)://</code> 地址。
                </p>
                <div class="set-row">
                    <input
                        v-model="sourceInput"
                        class="set-input"
                        type="text"
                        spellcheck="false"
                        :disabled="saving || !editable"
                        placeholder="\\fileserver\share\team-toolbox"
                        @keyup.enter="saveSource"
                    />
                    <button class="btn" type="button" :disabled="saving || !editable || sourceInput === (status && status.source)" @click="saveSource">
                        {{ saving ? '保存中…' : '保存' }}
                    </button>
                </div>
                <p v-if="!editable" class="set-note">
                    更新源由环境变量 <code>UPDATE_SOURCE</code> 指定，界面上的修改不会生效。
                </p>
                <p v-else-if="savedOk" class="set-note set-note-ok">已保存。</p>
            </section>

            <!-- 检查与安装 -->
            <section class="set-card">
                <div class="set-card-head">
                    <h2 class="set-card-title">更新</h2>
                    <button
                        class="btn"
                        type="button"
                        :disabled="!!busy || !(status && status.configured)"
                        @click="check"
                    >{{ busy === 'check' ? '检查中…' : '检查更新' }}</button>
                </div>

                <p v-if="!(status && status.configured)" class="set-note">
                    先在上面填写更新源地址，才能检查更新。
                </p>

                <template v-else>
                    <p v-if="busyText" class="set-busy">{{ busyText }}</p>

                    <div v-if="errorText" class="set-alert set-alert-danger">
                        <div class="set-alert-body"><strong>检查失败</strong><p>{{ errorText }}</p></div>
                    </div>

                    <div v-else-if="result && result.hasUpdate" class="set-update">
                        <div class="set-update-head">
                            <span class="set-update-ver">{{ currentVersion }} → {{ result.latest }}</span>
                            <span v-if="result.mandatory" class="set-tag set-tag-warn">建议立即更新</span>
                        </div>
                        <p v-if="result.notes" class="set-update-notes">{{ result.notes }}</p>
                        <dl class="set-kv set-kv-tight">
                            <dt>包体积</dt><dd class="set-muted">{{ formatSize(result.size) }}</dd>
                            <dt>发布时间</dt><dd class="set-muted">{{ formatDate(result.releasedAt) }}</dd>
                        </dl>
                        <p class="set-warn">
                            安装会替换程序文件并重启服务。<strong>更新前会自动备份全部数据</strong>
                            （文档、图片、资源文件），存放在 <code>data/updates/{{ result.latest }}/</code>。
                            若新版本启动失败，会自动回滚到当前版本。
                        </p>
                        <button
                            class="btn btn-primary"
                            type="button"
                            :disabled="!!busy"
                            @click="install"
                        >下载并安装</button>
                    </div>

                    <p v-else-if="result" class="set-note set-note-ok">
                        已是最新版本（{{ result.current }}）。
                    </p>
                </template>
            </section>
        </template>
    </div>
</template>

<script>
import { api } from '../api/client.js';

const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 180000;

export default {
    name: 'SettingsView',
    data() {
        return {
            loading: true,
            status: null,
            sourceInput: '',
            saving: false,
            savedOk: false,
            busy: '',
            busyText: '',
            result: null,
            errorText: '',
            _pollTimer: null,
            _pollStart: 0
        };
    },
    computed: {
        currentVersion() {
            return (this.status && this.status.current) || '—';
        },
        editable() {
            return !(this.status && this.status.sourceOrigin === 'env');
        },
        lastCheckText() {
            const lc = this.status && this.status.lastCheck;
            if (!lc || !lc.checkedAt) return '尚未检查';
            const base = this.formatDate(lc.checkedAt);
            if (lc.error) return `${base}（上次检查失败）`;
            return lc.hasUpdate ? `${base}（发现新版本 ${lc.latest}）` : `${base}（已是最新）`;
        }
    },
    async mounted() {
        await this.load();
    },
    beforeUnmount() {
        if (this._pollTimer) clearInterval(this._pollTimer);
    },
    methods: {
        async load() {
            try {
                const { res, body } = await api.getUpdateStatus();
                if (!res.ok) throw new Error((body && body.message) || '读取更新状态失败');
                this.status = body;
                this.sourceInput = body.source || '';
                // 有缓存结果就直接展示，避免进页面还要再点一次「检查」
                if (body.lastCheck && !body.lastCheck.error) {
                    this.result = body.lastCheck;
                }
            } catch (e) {
                this.errorText = e.message || '读取更新状态失败';
            } finally {
                this.loading = false;
            }
        },

        formatSize(bytes) {
            const n = Number(bytes) || 0;
            if (n <= 0) return '未知';
            return `${(n / 1024 / 1024).toFixed(1)} MB`;
        },

        formatDate(iso) {
            if (!iso) return '—';
            const d = new Date(iso);
            if (Number.isNaN(d.getTime())) return String(iso);
            const pad = (x) => String(x).padStart(2, '0');
            return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
        },

        async saveSource() {
            if (this.saving) return;
            this.saving = true;
            this.savedOk = false;
            this.errorText = '';
            try {
                const { res, body } = await api.setUpdateSource(this.sourceInput);
                if (!res.ok) throw new Error((body && body.message) || '保存失败');
                this.savedOk = true;
                this.result = null;
                await this.load();
            } catch (e) {
                this.errorText = e.message || '保存失败';
            } finally {
                this.saving = false;
            }
        },

        async check() {
            if (this.busy) return;
            this.busy = 'check';
            this.busyText = '正在读取更新源…';
            this.errorText = '';
            try {
                const { res, body } = await api.checkUpdate();
                if (!res.ok) throw new Error((body && body.message) || '检查失败');
                if (body.error) {
                    // 检查失败不是「请求错误」，而是「结果不可用」，按错误展示
                    this.errorText = body.message || '检查失败';
                    this.result = null;
                } else {
                    this.result = body;
                    this.status = { ...this.status, current: body.current, lastCheck: body };
                }
            } catch (e) {
                this.errorText = e.message || '检查失败';
            } finally {
                this.busy = '';
                this.busyText = '';
            }
        },

        async install() {
            if (this.busy || !this.result || !this.result.latest) return;
            const v = this.result.latest;
            const ok = window.confirm(
                `即将安装 ${v} 并重启服务。\n\n` +
                `更新前会自动备份全部数据到 data/updates/${v}/。\n` +
                `若新版本启动失败，会自动回滚到 ${this.currentVersion}。\n\n` +
                '重启期间页面会短暂断开，之后会自动刷新。'
            );
            if (!ok) return;

            this.errorText = '';
            try {
                this.busy = 'download';
                this.busyText = `正在下载 ${v}…（包较大，可能需要一会儿）`;
                let r = await api.downloadUpdate(v);
                if (!r.res.ok) throw new Error((r.body && r.body.message) || '下载失败');

                this.busy = 'stage';
                this.busyText = '正在校验并解压…';
                r = await api.stageUpdate(v);
                if (!r.res.ok) throw new Error((r.body && r.body.message) || '解压自检失败');

                this.busy = 'apply';
                this.busyText = '正在备份数据并安装…';
                r = await api.applyUpdate(v);
                if (!r.res.ok) throw new Error((r.body && r.body.message) || '安装失败');

                // 到这里服务端已经准备退出，接下来就是等它换个版本回来
                this.busy = 'restart';
                this.busyText = `正在重启到 ${v}…`;
                this.pollRestart(v);
            } catch (e) {
                this.busy = '';
                this.busyText = '';
                this.errorText = e.message || '更新失败';
            }
        },

        /**
         * 轮询等待服务以新版本回来。
         *
         * 不能用固定延时后直接刷新页面：备份 + 换文件 + 迁移的耗时
         * 取决于数据量和磁盘，固定值要么太短（刷新到连接被拒）要么太长。
         */
        pollRestart(target) {
            this._pollStart = Date.now();
            if (this._pollTimer) clearInterval(this._pollTimer);
            this._pollTimer = setInterval(async () => {
                if (Date.now() - this._pollStart > POLL_TIMEOUT_MS) {
                    clearInterval(this._pollTimer);
                    this._pollTimer = null;
                    this.busy = '';
                    this.busyText = '';
                    this.errorText = '等待服务重启超时。请手动重新打开应用确认版本。';
                    return;
                }
                try {
                    const res = await fetch('/api/health', { cache: 'no-store' });
                    if (!res.ok) return;
                    const j = await res.json();
                    if (j && j.version === target) {
                        clearInterval(this._pollTimer);
                        this._pollTimer = null;
                        this.busyText = `已更新到 ${target}，即将刷新页面…`;
                        setTimeout(() => window.location.reload(), 1200);
                    }
                } catch {
                    // 服务还没起来，继续等
                }
            }, POLL_INTERVAL_MS);
        },

        async dismissRollback() {
            try {
                await api.dismissRollback();
            } catch { /* 清不掉也不影响使用 */ }
            this.status = { ...this.status, rollback: null };
        }
    }
};
</script>

<style scoped>
.set-page { padding: 8px 0 40px; max-width: 820px; }

.set-head { margin-bottom: 20px; }
.set-title { margin: 0 0 6px; font-size: var(--font-size-xl); color: var(--text-primary); }
.set-desc {
    margin: 0;
    font-size: var(--font-size-sm);
    line-height: 1.65;
    color: var(--text-secondary);
}
.set-desc code, .set-hint code, .set-note code, .set-warn code,
.set-alert-hint code {
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: 0.92em;
    padding: 1px 5px;
    border-radius: 4px;
    background: var(--surface-sunken);
    color: var(--text-primary);
}

.set-card {
    margin-bottom: 14px;
    padding: 18px 20px;
    border: 1px solid var(--panel-border);
    border-radius: 12px;
    background: var(--panel-background);
}
.set-card-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
}
.set-card-title {
    margin: 0 0 12px;
    font-size: 15px;
    font-weight: 600;
    color: var(--text-primary);
}
.set-card-head .set-card-title { margin-bottom: 0; }

.set-kv {
    display: grid;
    grid-template-columns: 88px 1fr;
    gap: 8px 16px;
    margin: 0;
    font-size: var(--font-size-sm);
}
.set-kv dt { color: var(--text-tertiary); }
.set-kv dd { margin: 0; color: var(--text-primary); word-break: break-all; }
.set-kv-tight { margin-top: 10px; }

.set-code {
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: var(--font-size-sm);
}
.set-muted { color: var(--text-secondary); }

.set-hint {
    margin: 0 0 12px;
    font-size: var(--font-size-sm);
    line-height: 1.7;
    color: var(--text-secondary);
}

.set-row { display: flex; gap: 10px; }
.set-input {
    flex: 1;
    min-width: 0;
    padding: 8px 11px;
    border: 1px solid var(--panel-border);
    border-radius: 8px;
    background: var(--surface-sunken);
    color: var(--text-primary);
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: var(--font-size-sm);
}
.set-input:focus {
    outline: none;
    border-color: var(--accent-border);
    box-shadow: 0 0 0 3px var(--accent-soft);
}

.set-note { margin: 10px 0 0; font-size: var(--font-size-sm); color: var(--text-secondary); }
.set-note-ok { color: var(--success); }

.set-tag {
    display: inline-block;
    margin-right: 8px;
    padding: 1px 8px;
    border-radius: 999px;
    font-size: 12px;
    background: var(--accent-soft);
    color: var(--accent);
}
.set-tag-muted { background: var(--surface-sunken); color: var(--text-tertiary); }
.set-tag-warn { background: var(--warning-soft); color: var(--warning); }

.set-alert {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 14px;
    padding: 14px 16px;
    border-radius: 10px;
    border: 1px solid var(--panel-border);
}
.set-alert-danger {
    border-color: var(--danger);
    background: var(--danger-soft);
}
.set-alert-body { font-size: var(--font-size-sm); line-height: 1.65; color: var(--text-primary); }
.set-alert-body strong { display: block; margin-bottom: 4px; }
.set-alert-body p { margin: 0; color: var(--text-secondary); word-break: break-all; }
.set-alert-hint { margin-top: 6px !important; font-size: 12px; }

.set-busy {
    margin: 12px 0 0;
    padding: 10px 12px;
    border-radius: 8px;
    background: var(--accent-soft);
    color: var(--accent);
    font-size: var(--font-size-sm);
}

.set-update { margin-top: 14px; }
.set-update-head { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
.set-update-ver {
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: 14px;
    font-weight: 600;
    color: var(--text-primary);
}
.set-update-notes {
    margin: 0;
    font-size: var(--font-size-sm);
    line-height: 1.65;
    color: var(--text-secondary);
    white-space: pre-wrap;
}
.set-warn {
    margin: 12px 0 14px;
    padding: 10px 12px;
    border-left: 3px solid var(--warning);
    border-radius: 6px;
    background: var(--warning-soft);
    font-size: var(--font-size-sm);
    line-height: 1.65;
    color: var(--text-secondary);
}
.set-warn strong { color: var(--text-primary); }

.state-loading { padding: 24px 0; color: var(--text-tertiary); font-size: var(--font-size-sm); }
</style>
