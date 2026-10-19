<template>
    <button
        class="theme-toggle"
        type="button"
        :title="theme === 'dark' ? '切换到浅色模式' : '切换到深色模式'"
        :aria-label="theme === 'dark' ? '切换到浅色模式' : '切换到深色模式'"
        @click="onToggle"
    >
        <!-- 两个图标用 opacity + 轻微缩放交叉淡入，不做旋转或弹跳 -->
        <svg class="ico ico-sun" viewBox="0 0 24 24" :class="{ active: theme === 'light' }" aria-hidden="true">
            <circle cx="12" cy="12" r="4.2" />
            <line x1="12" y1="2.4" x2="12" y2="4.4" />
            <line x1="12" y1="19.6" x2="12" y2="21.6" />
            <line x1="2.4" y1="12" x2="4.4" y2="12" />
            <line x1="19.6" y1="12" x2="21.6" y2="12" />
            <line x1="5.2" y1="5.2" x2="6.6" y2="6.6" />
            <line x1="17.4" y1="17.4" x2="18.8" y2="18.8" />
            <line x1="5.2" y1="18.8" x2="6.6" y2="17.4" />
            <line x1="17.4" y1="6.6" x2="18.8" y2="5.2" />
        </svg>
        <svg class="ico ico-moon" viewBox="0 0 24 24" :class="{ active: theme === 'dark' }" aria-hidden="true">
            <path d="M20.5 14.2A8.6 8.6 0 1 1 9.8 3.5a7 7 0 0 0 10.7 10.7z" />
        </svg>
    </button>
</template>

<script>
import { currentTheme, toggleTheme } from '../styles/theme.js';

export default {
    name: 'ThemeToggle',
    data() {
        return { theme: currentTheme() };
    },
    methods: {
        onToggle() {
            this.theme = toggleTheme();
        }
    }
};
</script>

<style scoped>
.theme-toggle {
    display: grid;
    place-items: center;
    width: 34px;
    height: 34px;
    padding: 0;
    border: 1px solid var(--panel-border);
    border-radius: var(--radius-sm);
    background: var(--panel-background);
    color: var(--text-secondary);
    cursor: pointer;
    position: relative;
    transition: background var(--dur-base) var(--ease-out),
                color var(--dur-base) var(--ease-out),
                border-color var(--dur-base) var(--ease-out);
}
.theme-toggle:hover {
    background: var(--panel-background-hover);
    color: var(--text-primary);
}
.theme-toggle:focus-visible {
    outline: none;
    border-color: var(--accent-border);
    box-shadow: 0 0 0 3px var(--focus-ring);
}

.ico {
    grid-area: 1 / 1;
    width: 17px;
    height: 17px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.8;
    stroke-linecap: round;
    stroke-linejoin: round;
    opacity: 0;
    transform: scale(0.88);
    transition: opacity var(--dur-base) var(--ease-out),
                transform var(--dur-base) var(--ease-out);
}
.ico.active { opacity: 1; transform: scale(1); }
/* 月亮为实心 + 描边混合，描边与全局一致仅靠 fill 区分重量 */
.ico-moon { fill: currentColor; stroke-width: 1.8; }
</style>