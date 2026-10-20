<template>
    <!--
      二维码分享弹窗。

      两用：
        mode="page"    —— 扫后跳转到当前页面
        mode="asset"   —— 扫后直接下载该资源

      「对外访问地址」是核心：手机扫码必须能访问到这台服务器。
      127.0.0.1 手机是访问不到的（那指向手机自己），所以要让用户
      填内网 IP 或域名。没填时给出明确提示，而不是给一个扫了没反应的码。
    -->
        <Teleport to="body">
            <div class="overlay" @click.self="$emit('close')">
            <div class="dialog am-qr-dialog" role="dialog" aria-modal="true" aria-labelledby="am-qr-title">
            <h2 class="dialog-title" id="am-qr-title">{{ title }}</h2>

            <!-- 二维码本体 -->
            <div class="am-qr-body">
            <div class="am-qr-frame" :class="{ 'is-loading': loading }">
            <!-- v-html：内容是 qrcode 库生成的 SVG（自绘 path，无脚本） -->
            <div v-if="svg" class="am-qr-svg" v-html="svg"></div>
            <div v-else-if="loading" class="am-qr-loading">生成中…</div>
            <div v-else class="am-qr-failed">二维码生成失败</div>
            </div>

            <p class="am-qr-hint">{{ hint }}</p>

            <!-- 地址与内容 -->
            <div class="am-qr-meta">
            <label class="am-qr-label" :for="originInputId">对外访问地址</label>
            <div class="am-qr-origin-row">
            <input
            :id="originInputId"
            v-model="originInput"
            class="input am-qr-origin"
            type="text"
            placeholder="http://192.168.1.10:5205"
            spellcheck="false"
            @keyup.enter="applyOrigin"
            />
            <button class="btn btn-sm" type="button" @click="applyOrigin">应用</button>
            </div>
            <p class="am-qr-origin-hint">{{ originHint }}</p>
            </div>

            <!-- 二维码内容（可复制） -->
            <div class="am-qr-meta">
            <label class="am-qr-label">{{ contentLabel }}</label>
            <div class="am-qr-url-row">
            <code class="am-qr-url" :title="targetUrl">{{ targetUrl }}</code>
            <button class="btn btn-sm" type="button" @click="copyUrl">复制</button>
            </div>
            </div>
            </div>

            <div class="am-qr-foot">
            <span v-if="copied" class="am-qr-copied">已复制</span>
            <button class="btn" type="button" @click="$emit('close')">关闭</button>
            </div>
            </div>
            </div>
        </Teleport>
</template>

<script>
import {
    toQrSvg, getShareOrigin, setShareOrigin, buildPageUrl, buildDownloadUrl, detectLanAddress
} from '../../assets/qr-share.js';

export default {
    name: 'AssetQrDialog',
    props: {
        /** 'page' = 跳转到当前页面；'asset' = 下载资源 */
        mode: { type: String, default: 'page' },
        /** 资源 id（mode='asset' 时必填） */
        assetId: { type: Number, default: null },
        /** 资源名（用于文案） */
        assetName: { type: String, default: '' },
        /** 下载哪个版本：latest / published / 版本号 */
        pointer: { type: [String, Number], default: 'latest' }
    },
    emits: ['close'],
    data() {
        return {
            svg: '',
            loading: true,
            originInput: getShareOrigin(),
            copied: false,
            // 弹窗内可能开多个实例，用一个稳定 id 避免 label 指向错元素
            originInputId: 'am-qr-origin-' + Math.random().toString(36).slice(2, 8)
        };
    },
    computed: {
        title() {
            if (this.mode === 'asset') return '扫码下载资源';
            return '扫码在手机上打开';
        },
        hint() {
            if (this.mode === 'asset') {
                return '用手机相机或扫码 App 扫描，即可直接下载该资源文件。';
            }
            return '用手机相机或扫码 App 扫描，即可在此设备上打开当前页面。';
        },
        contentLabel() {
            return this.mode === 'asset' ? '下载地址' : '页面地址';
        },
        /** 最终编码进二维码的 URL */
        targetUrl() {
            const origin = this.originInput.trim();
            if (this.mode === 'asset' && this.assetId != null) {
                return buildDownloadUrl(this.assetId, this.pointer, origin);
            }
            return buildPageUrl(origin);
        },
        originHint() {
            if (!this.originInput.trim()) {
                return '未设置时使用当前浏览器地址。若当前是 127.0.0.1，手机扫码无法访问，请填写本机内网 IP。';
            }
            return '二维码与复制链接均使用该地址。';
        }
    },
    watch: {
        targetUrl: {
            immediate: true,
            handler() { this.render(); }
        }
    },
    mounted() {
        this.detect();
        // 主题切换时重绘：SVG 是字符串，CSS 变量变了不会自动生效
        this._themeObserver = new MutationObserver(() => this.render());
        this._themeObserver.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ['data-theme']
        });
    },
    beforeUnmount() {
        if (this._themeObserver) {
            this._themeObserver.disconnect();
            this._themeObserver = null;
        }
    },
    methods: {
        async render() {
            this.loading = true;
            this.svg = '';
            try {
                // 前景/背景色走 CSS 变量（--qr-foreground / --qr-background），
                // 随主题自动切换：深色下前景近白，否则深底深码扫不出来。
                // 不用 JS 判断主题 —— 主题一变就该重绘，用变量则天然跟随。
                const cs = getComputedStyle(document.documentElement);
                // 兜底用 currentColor / transparent，不写字面色值：
                // 变量读不到时仍能出图，且不违反「组件内禁止硬编码色值」。
                this.svg = await toQrSvg(this.targetUrl, {
                    dark: cs.getPropertyValue('--qr-foreground').trim() || 'currentColor',
                    light: cs.getPropertyValue('--qr-background').trim() || 'transparent',
                    width: 220
                });
            } catch (e) {
                this.svg = '';
            } finally {
                this.loading = false;
            }
        },
        applyOrigin() {
            setShareOrigin(this.originInput.trim());
            // 触发 watch 重绘
            this.targetUrl;
        },
        async copyUrl() {
            try {
                await navigator.clipboard.writeText(this.targetUrl);
                this.copied = true;
                setTimeout(() => { this.copied = false; }, 1600);
            } catch {
                // 剪贴板不可用时不让用户以为复制成功
                this.copied = false;
                window.alert('复制失败，请手动选中地址复制');
            }
        },
        async detect() {
            const a = await detectLanAddress();
            if (a) this.originInput = a;
        }
    }
};
</script>

<style scoped>
.am-qr-dialog {
    width: min(420px, calc(100vw - 32px));
}
.am-qr-body {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 14px;
    margin: 14px 0 4px;
}
.am-qr-frame {
    display: grid;
    place-items: center;
    width: 252px;
    height: 252px;
    padding: 12px;
    border-radius: var(--radius-lg);
    background: var(--surface-solid);
    border: 1px solid var(--panel-border);
}
.am-qr-frame.is-loading { color: var(--text-tertiary); font-size: var(--text-secondary); }
.am-qr-svg {
    width: 100%;
    height: 100%;
    display: grid;
    place-items: center;
}
.am-qr-svg :deep(svg) {
    width: 100%;
    height: 100%;
    display: block;
}
.am-qr-failed { color: var(--danger); font-size: var(--text-secondary); }
.am-qr-hint {
    margin: 0;
    text-align: center;
    font-size: var(--text-secondary);
    line-height: var(--line-normal);
    color: var(--text-secondary);
}
.am-qr-meta { width: 100%; }
.am-qr-label {
    display: block;
    margin-bottom: 5px;
    font-size: var(--text-secondary);
    color: var(--text-secondary);
}
.am-qr-origin-row {
    display: flex;
    gap: 6px;
}
.am-qr-origin { flex: 1; min-width: 0; font-size: var(--text-secondary); }
.am-qr-origin-hint {
    margin: 5px 0 0;
    font-size: var(--text-secondary);
    line-height: var(--line-tight);
    color: var(--text-tertiary);
}
.am-qr-url-row {
    display: flex;
    align-items: center;
    gap: 6px;
}
.am-qr-url {
    flex: 1;
    min-width: 0;
    padding: 6px 8px;
    border-radius: var(--radius-sm);
    background: var(--hover-background);
    border: 1px solid var(--panel-border);
    font-size: var(--text-secondary);
    color: var(--text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.am-qr-foot {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 10px;
    margin-top: 14px;
}
.am-qr-copied {
    font-size: var(--text-secondary);
    color: var(--success);
}
</style>
