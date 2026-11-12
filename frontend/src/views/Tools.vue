<template>
<div class="view-page page-tools"><header class="view-head"><p class="debugger-eyebrow">DEVICE DEBUGGER</p><h1 class="view-title">设备调试工具</h1><p class="view-subtitle">连接手机，查看画面与运行日志</p></header>
<div class="tools-grid"><article v-for="tool in tools" :key="tool.id" class="tool-card debugger-tool"><ToolIcon :tool-id="tool.id" /><span class="tool-status">可用</span><h2 class="tool-name">{{tool.name}}</h2><p>{{tool.description}}</p><div class="debugger-features"><span v-for="feature in tool.features" :key="feature">{{feature}}</span></div><button class="btn btn-primary" @click="$router.push({name:tool.route})">打开工具<svg class="icon icon-sm" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h16m-6-6 6 6-6 6"/></svg></button></article></div>
<aside class="debugger-note"><h2>在同一个局域网中使用</h2><p>安卓调试需要电脑上的 ADB；Unity 日志需要设备应用已启用 Assets/Test/Log 日志服务。ADB 操作、路径配置和设备搜索都在运行本工具的电脑上进行。</p><p>首次连接可打开工具页的帮助。应用仅面向可信本机或局域网。</p></aside>
</div>
</template>
<script setup>
import ToolIcon from '../components/ToolIcon.vue';
const tools=[{id:'android-wireless',name:'安卓无线调试',description:'扫码配对、连接管理、传送安装包，实时查看手机屏幕和应用日志。',features:['扫码连接','多机安装','屏幕预览','应用 Logcat'],route:'tool-android-wireless'},{id:'unity-logs',name:'Unity 设备日志',description:'搜索同网段的手机和平板，读取启动日志、历史记录和完整异常堆栈。',features:['局域网搜索','历史文件','堆栈筛选','日志下载'],route:'tool-unity-logs'}];
</script>
