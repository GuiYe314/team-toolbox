<template>
    <section class="set-card app-icon-settings" aria-labelledby="app-icon-title">
        <div class="app-icon-heading">
            <h2 id="app-icon-title" class="set-card-title">应用图标</h2>
            <button class="btn btn-sm app-icon-reset" type="button" :disabled="state.selectedId === defaultId && !state.saveError" @click="selectAppIcon(defaultId)">恢复默认图标</button>
        </div>
        <p class="app-icon-hint">选择喜欢的图标，立即应用到左上角和浏览器标签页。刷新后保留，跟随当前浏览器保存。</p>
        <fieldset class="app-icon-options">
            <legend>选择图标</legend>
            <label v-for="icon in icons" :key="icon.id" class="app-icon-option" :class="{ 'is-selected': state.selectedId === icon.id }" :data-icon-option="icon.id">
                <span class="app-icon-option-title">
                    <input type="radio" name="app-icon" :value="icon.id" :checked="state.selectedId === icon.id" @change="selectAppIcon(icon.id)" />
                    <span>{{ icon.name }}</span>
                </span>
                <img :key="state.imageRevision" class="app-icon-preview" :src="icon.image" alt="" aria-hidden="true" />
                <span class="app-icon-caption">{{ icon.description }}</span>
            </label>
        </fieldset>
        <div class="app-icon-footer">
            <p class="app-icon-current" role="status" aria-live="polite">当前：{{ selected.name }} · {{ state.saveError ? '仅本次生效' : '刷新后保留' }}</p>
            <a class="btn btn-sm app-icon-download" :href="selected.ico" :download="`${selected.id}.ico`">下载当前 ICO</a>
        </div>
        <div v-if="state.saveError" class="app-icon-message notice notice-warning" role="alert">
            <span>未能保存图标选择，刷新后可能恢复原图标。允许此网站保存数据后可以重试。</span>
            <button class="btn btn-sm" type="button" @click="retryAppIconSave">重试保存</button>
        </div>
        <div v-if="state.imageError" class="app-icon-message notice notice-warning" role="alert">
            <span>所选图标加载失败，已临时显示默认图标，选择仍保留。</span>
            <button class="btn btn-sm" type="button" @click="retryAppIconImage">重新加载图标</button>
        </div>
        <p class="app-icon-hint">Windows 快捷方式：下载 ICO 后，在快捷方式“属性 → 更改图标”中选择。网页选择仅在当前浏览器和访问地址生效。</p>
    </section>
</template>

<script>
import { APP_ICONS, DEFAULT_APP_ICON_ID, getAppIcon } from '../utils/app-icon.js';
import { appIconState, selectAppIcon, retryAppIconSave, retryAppIconImage } from '../stores/app-icon.js';

export default {
    name: 'AppIconSettings',
    data: () => ({ icons: APP_ICONS, defaultId: DEFAULT_APP_ICON_ID, state: appIconState }),
    computed: { selected() { return getAppIcon(this.state.selectedId); } },
    methods: { selectAppIcon, retryAppIconSave, retryAppIconImage }
};
</script>

<style scoped>
.app-icon-heading, .app-icon-footer, .app-icon-message {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: var(--app-icon-gap);
}
.app-icon-heading .set-card-title { margin: 0; font-size: var(--text-nav); font-weight: var(--weight-semibold); color: var(--text-primary); }
.app-icon-hint, .app-icon-current {
    margin: var(--app-icon-gap) 0 0;
    color: var(--text-secondary);
    font-size: var(--app-icon-caption-size);
    line-height: var(--line-normal);
}
.app-icon-options {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(var(--app-icon-card-min), 1fr));
    gap: var(--app-icon-gap);
    margin: var(--app-icon-gap) 0;
    padding: 0;
    border: 0;
    min-width: 0;
}
.app-icon-options legend {
    margin-bottom: var(--app-icon-gap);
    color: var(--text-secondary);
    font-size: var(--app-icon-caption-size);
}
.app-icon-option {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--app-icon-gap);
    min-width: 0;
    padding: var(--app-icon-gap);
    border: var(--app-icon-border) solid var(--panel-border);
    border-radius: var(--radius-md);
    color: var(--text-primary);
    background: var(--panel-background);
    cursor: pointer;
}
.app-icon-option:hover { background: var(--panel-background-hover); }
.app-icon-option.is-selected { background: var(--selected-background); border-color: var(--accent); }
.app-icon-option:focus-within { outline: var(--app-icon-focus) solid var(--focus-ring); outline-offset: var(--app-icon-focus); }
.app-icon-option-title { display: flex; align-items: center; gap: var(--app-icon-small-gap); font-size: var(--text-body); font-weight: var(--weight-medium); }
.app-icon-option input { margin: 0; accent-color: var(--accent); }
.app-icon-preview { display: block; width: var(--app-icon-preview-size); height: var(--app-icon-preview-size); object-fit: contain; }
.app-icon-caption { color: var(--text-secondary); font-size: var(--app-icon-caption-size); line-height: var(--line-normal); text-align: center; }
.app-icon-current { margin: 0; color: var(--text-primary); }
.app-icon-message { margin-top: var(--app-icon-gap); font-size: var(--app-icon-caption-size); background: var(--warning-soft); border-color: var(--warning); color: var(--text-primary); }
.app-icon-download { text-decoration: none; }
</style>
