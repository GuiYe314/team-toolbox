<template>
    <div class="view-page page-tool">
        <header class="tool-header">
            <button class="btn-back" @click="$router.push({ name: 'tools' })">
                <svg class="icon icon-sm" viewBox="0 0 24 24" aria-hidden="true">
                    <polyline points="14.5 6 8.5 12 14.5 18" />
                </svg>
                返回工具箱
            </button>
            <h1 class="view-title">比例锁定</h1>
            <p class="view-subtitle">锁定宽高比后，输入任一侧尺寸，自动换算另一侧</p>
        </header>

        <!-- ① 原始尺寸 -->
        <section class="card">
            <h2 class="card-title">① 原始尺寸</h2>
            <input
                v-model="sourceText"
                class="text-input"
                type="text"
                placeholder="1920*1080（分隔符支持 * x × , 空格）"
                aria-label="原始尺寸"
                @input="onSourceText"
            />
            <div class="wh-row">
                <label class="wh-item">
                    <span>宽</span>
                    <input v-model="sourceW" type="number" min="0" step="any" class="num-input" @input="onSourceWH" />
                </label>
                <label class="wh-item">
                    <span>高</span>
                    <input v-model="sourceH" type="number" min="0" step="any" class="num-input" @input="onSourceWH" />
                </label>
            </div>
            <div class="presets">
                <button v-for="p in presets" :key="p.label" type="button" class="preset" @click="applyPreset(p)">
                    {{ p.label }}
                </button>
            </div>
            <p v-if="err" class="err">{{ err }}</p>
        </section>

        <!-- ② 锁定比例 -->
        <section class="card">
            <button type="button" class="lock-btn" :class="{ locked: isLocked }" @click="toggleLock">
                <svg v-if="isLocked" class="icon icon-sm" viewBox="0 0 24 24" aria-hidden="true">
                    <rect x="4.5" y="10.5" width="15" height="10" rx="2" />
                    <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
                </svg>
                <svg v-else class="icon icon-sm" viewBox="0 0 24 24" aria-hidden="true">
                    <rect x="4.5" y="10.5" width="15" height="10" rx="2" />
                    <path d="M8 10.5V7.5a4 4 0 0 1 7.5-2" />
                </svg>
                {{ isLocked ? '已锁定比例' : '锁定当前比例' }}
            </button>
            <p class="hint" :class="{ ready: isLocked }">
                <template v-if="isLocked">
                    基准 <strong>{{ baseW }} × {{ baseH }}</strong>，比例 {{ ratioLabel }}（1 : {{ ratioValue }}）
                </template>
                <template v-else>锁定后即可在下方按比例换算；随时可再次点击解除</template>
            </p>
        </section>

        <!-- ③ 换算 -->
        <section class="card">
            <h2 class="card-title">③ 按比例换算</h2>
            <template v-if="isLocked">
                <div class="wh-row">
                    <label class="wh-item">
                        <span>目标宽度</span>
                        <input v-model="targetW" type="number" min="0" step="any" class="num-input" placeholder="如 520" @input="onTargetW" />
                    </label>
                    <label class="wh-item">
                        <span>目标高度</span>
                        <input v-model="targetH" type="number" min="0" step="any" class="num-input" placeholder="自动换算" @input="onTargetH" />
                    </label>
                </div>
                <div class="result">
                    <span class="result-num">{{ resultW }} × {{ resultH }}</span>
                    <span class="result-unit">px</span>
                    <button type="button" class="btn-copy" @click="copyResult">{{ copied ? '已复制' : '复制' }}</button>
                </div>
                <p v-if="ratioNotice" class="hint">{{ ratioNotice }}</p>
            </template>
            <p v-else class="placeholder">请先在上方「锁定当前比例」。</p>
        </section>
    </div>
</template>

<script>
// 比例锁定换算：输入原始尺寸（如 1920*1080）→ 锁定比例 → 输入目标宽度即得对应高度（反之亦然）。
// 纯前端计算，不涉及后端与数据存储。
export default {
    name: 'RatioLock',
    data() {
        return {
            sourceText: '',
            sourceW: '',
            sourceH: '',
            baseW: 0,
            baseH: 0,
            targetW: '',
            targetH: '',
            err: '',
            copied: false,
            copyTimer: null,
            presets: [
                { label: '16:9', w: 1920, h: 1080 },
                { label: '9:16', w: 1080, h: 1920 },
                { label: '4:3', w: 1440, h: 1080 },
                { label: '3:4', w: 1080, h: 1440 },
                { label: '1:1', w: 1080, h: 1080 },
                { label: '21:9', w: 2560, h: 1080 }
            ]
        };
    },
    computed: {
        isLocked() {
            return this.baseW > 0 && this.baseH > 0;
        },
        /** 基准比例 高/宽 */
        ratio() {
            return this.isLocked ? this.baseH / this.baseW : 0;
        },
        /** 简化比例（最大公约数约分），如 1920×1080 → 16:9 */
        ratioLabel() {
            if (!this.isLocked) return '';
            const g = gcd(Math.round(this.baseW), Math.round(this.baseH));
            if (g > 1) return `${Math.round(this.baseW) / g}:${Math.round(this.baseH) / g}`;
            return `${fmt(this.baseW)}:${fmt(this.baseH)}`;
        },
        ratioValue() {
            return this.isLocked ? fmt(this.ratio, 4) : '';
        },
        resultW() {
            return this.isLocked && this.targetW !== '' ? fmt(round2(Number(this.targetW))) : '—';
        },
        resultH() {
            return this.isLocked && this.targetH !== '' ? fmt(round2(Number(this.targetH))) : '—';
        },
        ratioNotice() {
            if (!this.isLocked || this.targetW === '') return '';
            const raw = Number(this.targetW) * this.ratio;
            if (!Number.isFinite(raw)) return '';
            const shown = round2(raw);
            return Math.abs(shown - raw) > 1e-9 ? `精确值为 ${fmt(round(raw, 6))}，已按两位小数显示` : '';
        }
    },
    beforeUnmount() {
        if (this.copyTimer) clearTimeout(this.copyTimer);
    },
    methods: {
        /** 支持 1920*1080 / 1920x1080 / 1920×1080 / 1920,1080 / 1920 1080 */
        onSourceText() {
            const raw = String(this.sourceText).trim();
            if (!raw) {
                this.err = '';
                return;
            }
            const parts = raw.split(/[*x×,，\s]+/).filter(Boolean);
            if (parts.length !== 2) {
                this.err = '请输入两个数字，例如 1920*1080';
                return;
            }
            const w = Number(parts[0]);
            const h = Number(parts[1]);
            if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
                this.err = '尺寸需为大于 0 的数字';
                return;
            }
            this.err = '';
            this.sourceW = w;
            this.sourceH = h;
            this.refreshBase();
        },
        onSourceWH() {
            const w = Number(this.sourceW);
            const h = Number(this.sourceH);
            if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
                this.err = '';
                this.sourceText = `${fmt(w)}*${fmt(h)}`;
                this.refreshBase();
            }
        },
        applyPreset(p) {
            this.sourceW = p.w;
            this.sourceH = p.h;
            this.sourceText = `${p.w}*${p.h}`;
            this.err = '';
            this.refreshBase();
        },
        /** 已锁定时修改原始尺寸同步更新基准比例 */
        refreshBase() {
            const w = Number(this.sourceW);
            const h = Number(this.sourceH);
            if (this.isLocked && Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
                this.baseW = w;
                this.baseH = h;
                // 基准变化后按新比例重算已填的目标宽度
                if (this.targetW !== '') this.onTargetW();
            }
        },
        toggleLock() {
            if (this.isLocked) {
                this.baseW = 0;
                this.baseH = 0;
                this.targetW = '';
                this.targetH = '';
                return;
            }
            const w = Number(this.sourceW);
            const h = Number(this.sourceH);
            if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
                this.err = '请先填写有效的原始尺寸（例如 1920*1080）';
                return;
            }
            this.err = '';
            this.baseW = w;
            this.baseH = h;
        },
        onTargetW() {
            if (!this.isLocked || this.targetW === '') return;
            const w = Number(this.targetW);
            if (!Number.isFinite(w)) {
                this.targetH = '';
                return;
            }
            // 写回两位小数，避免 292.50000000000006 / 924.4444444 之类的浮点噪声
            this.targetH = round2(w * this.ratio);
        },
        onTargetH() {
            if (!this.isLocked || this.targetH === '') return;
            const h = Number(this.targetH);
            if (!Number.isFinite(h)) {
                this.targetW = '';
                return;
            }
            this.targetW = round2(h / this.ratio);
        },
        async copyResult() {
            const text = `${this.resultW} × ${this.resultH}`;
            try {
                await navigator.clipboard.writeText(text);
            } catch {
                window.prompt('复制结果', text);
                return;
            }
            this.copied = true;
            if (this.copyTimer) clearTimeout(this.copyTimer);
            this.copyTimer = setTimeout(() => { this.copied = false; }, 1500);
        }
    }
};

/** 最大公约数（用于把 1920×1080 约分为 16:9） */
function gcd(a, b) {
    let x = Math.abs(a);
    let y = Math.abs(b);
    while (y) {
        const t = x % y;
        x = y;
        y = t;
    }
    return x;
}
function round(n, digits) {
    const f = Math.pow(10, digits);
    return Math.round(n * f) / f;
}
function round2(n) {
    return round(n, 2);
}
/** 去掉多余的 0（292.50 → 292.5），避免 0.30000000000000004 之类的浮点噪声 */
function fmt(n, digits = 2) {
    if (!Number.isFinite(n)) return '—';
    const v = round(n, digits);
    return String(v);
}
</script>

<style scoped>
/* 根容器走全局 .view-page；工具页内容不铺满，用 max-width 收窄成
   「阅读宽度」，避免表单元素在宽屏上被拉得过长。*/
.page-tool { max-width: 720px; }

.tool-header {
    flex: none;
    margin-bottom: 22px;
}
.btn-back {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    background: none;
    border: none;
    color: var(--text-secondary);
    cursor: pointer;
    font-size: var(--text-secondary);
    padding: 4px 8px 4px 4px;
    margin-bottom: 10px;
    border-radius: var(--radius-sm);
    transition: background var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);
}
.btn-back:hover { background: var(--hover-background); color: var(--text-primary); }
.btn-back:focus-visible {
    outline: none;
    box-shadow: 0 0 0 3px var(--focus-ring);
}

.card {
    background: var(--panel-background);
    border: 1px solid var(--panel-border);
    border-radius: var(--radius-lg);
    padding: 18px;
    margin-bottom: 12px;
}
.card-title {
    font-size: 15px;
    font-weight: 600;
    margin: 0 0 12px;
}

.text-input,
.num-input {
    width: 100%;
    height: 38px;
    padding: 0 12px;
    font-size: var(--text-body);
    font-family: inherit;
    color: var(--text-primary);
    background: var(--panel-background);
    border: 1px solid var(--panel-border);
    border-radius: var(--radius-sm);
    outline: none;
    transition: border-color var(--dur-base) var(--ease-out),
                box-shadow var(--dur-base) var(--ease-out);
}
.text-input:focus,
.num-input:focus {
    border-color: var(--accent-border);
    box-shadow: 0 0 0 3px var(--focus-ring);
}

.wh-row {
    display: flex;
    gap: 12px;
    margin-top: 12px;
}
.wh-item {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    color: var(--text-secondary);
}
.wh-item > span {
    flex-shrink: 0;
}

.presets {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 12px;
}
.preset {
    display: inline-flex;
    align-items: center;
    height: 26px;
    padding: 0 10px;
    font-size: var(--text-secondary);
    font-family: inherit;
    border: 1px solid var(--panel-border);
    background: var(--panel-background);
    color: var(--text-secondary);
    border-radius: var(--radius-pill);
    cursor: pointer;
    transition: background var(--dur-fast) var(--ease-out),
                border-color var(--dur-fast) var(--ease-out),
                color var(--dur-fast) var(--ease-out);
}
.preset:hover {
    border-color: var(--accent-border);
    color: var(--text-primary);
    background: var(--panel-background-hover);
}

.err {
    margin: 10px 0 0;
    font-size: 13px;
    color: var(--danger);
}

.lock-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    width: 100%;
    height: 42px;
    font-size: var(--text-body);
    font-family: inherit;
    font-weight: var(--weight-medium);
    color: var(--text-primary);
    background: var(--panel-background);
    border: 1px solid var(--panel-border);
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition: background var(--dur-base) var(--ease-out),
                border-color var(--dur-base) var(--ease-out),
                color var(--dur-base) var(--ease-out);
}
.lock-btn:hover {
    background: var(--panel-background-hover);
    border-color: var(--accent-border);
}
.lock-btn.locked {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--accent-contrast);
}
.hint {
    margin: 10px 0 0;
    font-size: 13px;
    color: var(--text-secondary);
    line-height: 1.6;
}
.hint.ready strong {
    color: var(--text-primary);
}

.result {
    display: flex;
    align-items: baseline;
    gap: 8px;
    margin-top: 16px;
    padding: 16px 18px;
    background: var(--surface-sunken);
    border-radius: 10px;
}
.result-num {
    font-size: 28px;
    font-weight: 600;
    letter-spacing: -0.01em;
    color: var(--text-primary);
}
.result-unit {
    font-size: 13px;
    color: var(--text-secondary);
}
.btn-copy {
    margin-left: auto;
    padding: 5px 12px;
    font-size: 13px;
    font-family: inherit;
    color: var(--accent);
    background: var(--panel-background);
    border: 1px solid var(--panel-border);
    border-radius: 6px;
    cursor: pointer;
}
.btn-copy:hover {
    background: var(--panel-background);
    border-color: var(--panel-border);
}

.placeholder {
    margin: 0;
    font-size: 14px;
    color: var(--text-secondary);
}

@media (max-width: 1340px) {
    /* 主内容区变窄时上下两组输入改为纵向排列 */
    .wh-row {
        flex-direction: column;
        gap: 10px;
    }
}
</style>