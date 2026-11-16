<template>
    <IntegrationLayout class="workshop" tool-id="whiteboard" title="白板与流程图" subtitle="手绘图形、箭头、文字和流程图，主动保存到本地或工具箱资源库。">
        <template #actions><button class="btn" :disabled="!api || busy" @click="exportSource">下载图纸</button><button class="btn" :disabled="!api || busy" @click="exportPng">导出 PNG</button></template>
        <div class="workshop-panel"><div class="workshop-fields"><label>图纸名称<input id="board-name" v-model="name" class="input" maxlength="60" placeholder="我的流程图"/></label><label>导入图纸（最多20MiB）<input id="board-import" type="file" accept=".excalidraw,.json" :disabled="!api || busy" @change="importLocal($event.target.files?.[0]); $event.target.value=''"/></label></div><div class="ext-row"><button id="board-save" class="btn btn-primary" :disabled="!api || busy" @click="saveAsset">保存到资源库</button><button class="btn" :disabled="!api || busy" @click="listBoards">从资源库读取</button><span class="workshop-note">{{ dirty ? '有未保存改动，离开前请下载或保存' : '当前画布' }}</span></div><div v-if="showAssets" class="ext-row"><select v-model="selectedAsset" aria-label="选择资源库图纸"><option value="">选择一份图纸</option><option v-for="asset in assets" :key="asset.id" :value="asset.id">{{ asset.name }}</option></select><button class="btn" :disabled="!selectedAsset || busy" @click="loadAsset">读取</button><button class="btn" @click="showAssets=false">关闭列表</button></div><p v-if="error" class="workshop-error" role="alert">{{ error }}</p><p v-if="notice" class="workshop-note" role="status">{{ notice }}</p></div>
        <p v-if="loading" class="workshop-note">正在加载本地白板组件…</p><button v-if="loadFailed" class="btn" @click="mountBoard">重新加载白板</button><div id="whiteboard-stage" ref="container" class="whiteboard-stage" aria-label="白板画布"/>
        <template #footer>基于 Excalidraw · 字体随工具箱本地提供。保存时新建资源，不覆盖同名图纸；未保存内容离开页面后释放。不提供多人同步或在线 AI 功能。</template>
    </IntegrationLayout>
</template>
<script setup>
import { ref, shallowRef, onMounted, onBeforeUnmount } from 'vue';
import IntegrationLayout from '../components/IntegrationLayout.vue';
import { downloadBlob } from '../utils/tool-files.js';
import { validateBoard } from '../utils/whiteboard.js';
import { assetApi } from '../api/asset-client.js';
const container=ref(null), api=shallowRef(null), name=ref('我的流程图'), dirty=ref(false), busy=ref(false), error=ref(''), notice=ref(''), loading=ref(true), loadFailed=ref(false), showAssets=ref(false), assets=ref([]), selectedAsset=ref('');
let reactRoot, library, React, themeObserver, disposed=false, generation=0, controller;
const theme=()=>document.documentElement.dataset.theme==='dark'?'dark':'light';
async function mountBoard(){
    if(disposed)return; const current=++generation; loading.value=true;loadFailed.value=false;error.value='';
    try {
        window.EXCALIDRAW_ASSET_PATH='/vendor/tools/whiteboard/';
        const [react,dom,excalidraw]=await Promise.all([import('react'),import('react-dom/client'),import('@excalidraw/excalidraw'),import('@excalidraw/excalidraw/index.css')]);
        if(disposed||current!==generation)return; React=react;library=excalidraw; reactRoot?.unmount();reactRoot=dom.createRoot(container.value);
        reactRoot.render(React.createElement(library.Excalidraw,{langCode:'zh-CN',theme:theme(),excalidrawAPI:value=>{api.value=value;loading.value=false;},onChange:elements=>{if(elements.length)dirty.value=true;},validateEmbeddable:()=>false,UIOptions:{canvasActions:{loadScene:false,saveToActiveFile:false,export:false,saveAsImage:false,toggleTheme:false}},renderTopRightUI:()=>null},React.createElement(library.MainMenu,null,React.createElement(library.MainMenu.DefaultItems.ChangeCanvasBackground))));
    }catch(e){if(!disposed){loadFailed.value=true;loading.value=false;error.value='白板加载失败，请重试：'+e.message;}}
}
function source(){const text=library.serializeAsJSON(api.value.getSceneElements(),api.value.getAppState(),api.value.getFiles(),'local');if(text.length>20*1024**2)throw new Error('图纸超过20MiB，请减少内嵌图片');return new Blob([text],{type:'application/json'});}
function filename(){return (name.value.trim().replace(/[\\/:*?"<>|\u0000-\u001f]/g,'_')||'我的流程图')+'.excalidraw';}
function exportSource(){try{downloadBlob(source(),filename());dirty.value=false;notice.value='已请求下载图纸';}catch(e){error.value=e.message;}}
async function exportPng(){busy.value=true;error.value='';try{const blob=await library.exportToBlob({elements:api.value.getSceneElements(),appState:{...api.value.getAppState(),exportWithDarkMode:theme()==='dark'},files:api.value.getFiles(),mimeType:'image/png',maxWidthOrHeight:4096});if(!disposed)downloadBlob(blob,filename().replace(/\.excalidraw$/,'.png'));}catch(e){error.value='导出图片失败：'+e.message;}finally{busy.value=false;}}
async function applyBlob(blob){if(blob.size>20*1024**2)throw new Error('图纸不能超过20MiB');const board=validateBoard(JSON.parse(await blob.text()));if(disposed)return;api.value.updateScene({elements:library.restoreElements(board.elements,null),appState:board.appState});api.value.addFiles(Object.values(board.files));api.value.scrollToContent();dirty.value=false;}
async function importLocal(file){if(!file)return;error.value='';try{await applyBlob(file);name.value=file.name.replace(/\.(excalidraw|json)$/i,'');notice.value='本地图纸已读取';}catch(e){error.value=e.message;}}
async function saveAsset(){busy.value=true;error.value='';try{const form=new FormData();form.append('file',new File([source()],filename(),{type:'application/json'}));form.append('tags','工具箱白板');controller=new AbortController();const response=await fetch('/api/assets/upload?force=1',{method:'POST',body:form,signal:controller.signal});const body=await response.json();if(!response.ok)throw new Error(body.message||'资源库保存失败');if(!disposed){dirty.value=false;notice.value='图纸已新建到资源库';}}catch(e){if(!disposed)error.value=e.name==='AbortError'?'保存已停止，请核对资源库':e.message;}finally{busy.value=false;}}
async function listBoards(){error.value='';try{const {res,body}=await assetApi.list({search:'.excalidraw',pageSize:100});if(!res.ok)throw new Error(body?.message||'读取资源库失败');if(disposed)return;assets.value=(body.items||[]).filter(asset=>/\.excalidraw$/i.test(asset.name));showAssets.value=true;if(!assets.value.length)notice.value='资源库中没有 Excalidraw 图纸';}catch(e){if(!disposed)error.value=e.message;}}
async function loadAsset(){busy.value=true;error.value='';controller=new AbortController();try{const response=await fetch(`/api/assets/files/${encodeURIComponent(selectedAsset.value)}/original/latest`,{signal:controller.signal});if(!response.ok)throw new Error('图纸读取失败');if(Number(response.headers.get('Content-Length'))>20*1024**2)throw new Error('图纸不能超过20MiB');await applyBlob(await response.blob());if(!disposed){name.value=assets.value.find(item=>item.id===selectedAsset.value)?.name.replace(/\.excalidraw$/i,'')||'资源库图纸';notice.value='图纸已读取';}}catch(e){if(!disposed)error.value=e.message;}finally{busy.value=false;}}
onMounted(()=>{void mountBoard();themeObserver=new MutationObserver(()=>api.value?.updateScene({appState:{theme:theme()}}));themeObserver.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});});
onBeforeUnmount(()=>{disposed=true;generation++;controller?.abort();themeObserver?.disconnect();reactRoot?.unmount();api.value=null;});
</script>
