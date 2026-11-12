<template><div class="view-page set-page"><header class="view-head"><h1 class="view-title">设置</h1><p class="view-subtitle">ADB 配置与独立版信息</p></header><section class="debugger-setting"><div><h2>ADB 设置</h2><p>选择运行本工具的电脑上的 Platform-Tools 文件夹，搜索并保存 ADB。</p></div><AndroidSettingsDialog /></section><section class="debugger-setting"><div><h2>关于设备调试工具</h2><p>版本 {{version}} · 独立版只包含安卓调试和 Unity 日志。</p><p>配置保存在本程序的 data 目录，主题只保存在浏览器。更新请下载本产品的新发布包。</p></div><a class="btn" :href="`https://github.com/GuiYe314/team-toolbox/releases/tag/device-debugger-v${version}`" target="_blank" rel="noopener noreferrer">查看发布</a></section></div></template>
<script setup>
import AndroidSettingsDialog from '../components/AndroidSettingsDialog.vue';
const version=__APP_VERSION__;
</script>
