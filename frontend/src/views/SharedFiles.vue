<template>
    <main class="share-mobile"><header class="share-mobile-header"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7h7l2 2h9v11H3zM3 7V4h7l2 3"/></svg><div><h1>共享文件</h1><p class="share-muted">电脑文件夹 · 局域网传输</p></div></header><section class="share-panel"><SharedFileBrowser v-if="share" :key="share.id + share.token" :share="share" /><p v-else class="notice notice-error" role="alert">共享链接无效，请扫描电脑端的二维码或使用完整共享链接。</p></section><p class="share-muted">上传的文件直接保存到电脑当前目录。切到后台或离开页面会停止上传，已保存文件保留。</p></main>
</template>
<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue';
import SharedFileBrowser from '../components/SharedFileBrowser.vue';
import { readShareLink } from '../utils/file-share.js';
const share = ref(readShareLink(location.hash));
const changed = () => { share.value = readShareLink(location.hash); };
onMounted(() => window.addEventListener('hashchange', changed));
onBeforeUnmount(() => window.removeEventListener('hashchange', changed));
</script>
