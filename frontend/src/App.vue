<template>
<div class="app-layout col-single debugger-layout">
    <div class="app-backdrop" aria-hidden="true"></div>
    <nav class="sidebar glass-panel debugger-sidebar" aria-label="主导航">
        <router-link to="/tools" class="debugger-brand"><img class="brand-mark" src="/icons/brand.svg" alt="" aria-hidden="true" /><span>设备调试工具<small>Device Debugger</small></span></router-link>
        <div class="debugger-nav">
            <router-link v-for="item in navigation" :key="item.route" :to="item.route" class="nav-item" :class="{'is-active':$route.path===item.route}"><ToolIcon :tool-id="item.icon" /><span>{{item.label}}</span></router-link>
        </div>
        <footer class="debugger-footer"><ThemeToggle /><span class="version-tag">v{{ version }}</span></footer>
    </nav>
    <main class="main-content glass-panel" role="main"><router-view /></main>
</div>
</template>
<script setup>
import ThemeToggle from './components/ThemeToggle.vue';
import ToolIcon from './components/ToolIcon.vue';
const version=__APP_VERSION__;
const navigation=[{route:'/tools',label:'调试首页',icon:'home'},{route:'/tools/android-wireless',label:'安卓调试',icon:'android-wireless'},{route:'/tools/unity-logs',label:'Unity 日志',icon:'unity-logs'},{route:'/settings',label:'设置',icon:'settings'}];
</script>
