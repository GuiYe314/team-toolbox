<template>
    <IntegrationLayout class="workshop" tool-id="android-mirror" title="安卓流畅投屏" subtitle="通过 scrcpy 连续查看手机画面，支持触控、常用按键与英文输入。">
        <template #actions><RouterLink class="btn" to="/tools/android-wireless">连接设备 / ADB 设置</RouterLink></template>
        <div class="workshop-grid"><section class="workshop-panel"><h2>目标设备</h2><label>在线授权设备<select id="mirror-device" v-model="serial" :disabled="!!session || busy"><option value="">请选择设备</option><option v-for="device in devices.filter(item=>item.state==='device')" :key="device.serial" :value="device.serial">{{ device.model || device.product || device.serial }} · {{ device.serial }}</option></select></label><div class="ext-row"><button class="btn" :disabled="busy || !!session" @click="refresh">刷新设备</button><button id="mirror-start" class="btn btn-primary" :disabled="busy || !!session || !serial || !supported || !capabilities.ready" @click="start">启动投屏并允许控制</button><button class="btn" :disabled="!session && !busy" @click="stop">停止投屏</button></div><p role="status" class="workshop-note">{{ status }}</p><p v-if="!supported" class="workshop-error">当前浏览器缺少 WebCodecs。请在电脑用 localhost 打开工具箱，或使用支持 WebCodecs 的 HTTPS 地址；局域网 HTTP 可继续使用安卓调试中的截图预览。</p><p v-if="!capabilities.ready" class="workshop-note">scrcpy 组件未就绪。源码使用请在工具箱目录运行 node scripts/prepare-scrcpy.mjs，准备后刷新；完整发布包会包含组件。</p><p v-if="error" class="workshop-error" role="alert">{{ error }}</p><div class="ext-row"><button v-for="key in keys" :key="key.code" class="btn btn-sm" :disabled="!session" @click="press(key.code)">{{ key.name }}</button></div><label>发送英文 / 数字<input v-model="text" class="input" maxlength="200" :disabled="!session" placeholder="输入后点击发送，不同步剪贴板" @keydown.enter="sendText"/></label><button class="btn" :disabled="!session || !text" @click="sendText">发送文字</button><p class="workshop-note">手机需解锁、授权调试。点击画面操作，拖动滑动；画面获得焦点后可使用方向、Enter、Backspace、Esc。系统权限和受保护画面可能限制显示或触控。只投视频，不录制、不采集音频或剪贴板。</p></section>
        <section class="workshop-panel"><h2>实时画面 <span class="workshop-small">{{ dimensions.width ? `${dimensions.width} × ${dimensions.height}` : '' }}</span></h2><div class="mirror-stage"><canvas ref="canvas" tabindex="0" aria-label="手机投屏，点击和拖动控制" @pointerdown="pointer($event,0)" @pointermove="pointer($event,2)" @pointerup="pointer($event,1)" @pointercancel="pointer($event,3)" @keydown="keyboard"/></div><p class="workshop-note">30fps上限、最长边1280；实际流畅程度取决于手机编码、无线连接和浏览器解码能力。停止保留最后一帧，后台或离页会停止投屏。</p></section></div>
        <template #footer>基于 scrcpy {{ capabilities.version || '' }} · 当前仅安卓。iPhone / iPad 需要独立的 AirPlay 接收方案。</template>
    </IntegrationLayout>
</template>
<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue';
import IntegrationLayout from '../components/IntegrationLayout.vue';
import { createScrcpyParser, avcCodec } from '../utils/scrcpy-video.js';
const devices=ref([]),serial=ref(''),session=ref(null),busy=ref(false),status=ref('尚未启动'),error=ref(''),text=ref(''),canvas=ref(null),dimensions=ref({width:0,height:0}),capabilities=ref({ready:true}),supported=!!globalThis.VideoDecoder&&!!globalThis.EncodedVideoChunk;
const keys=[{name:'主页',code:3},{name:'返回',code:4},{name:'最近应用',code:187},{name:'音量＋',code:24},{name:'音量－',code:25}];
let controller,decoder,heartbeat,disposed=false,generation=0,controlChain=Promise.resolve(),touching=false,lastMove=0;
async function request(path,method='GET',body,signal=controller?.signal){const timeout=AbortSignal.timeout(path==='/mirror'&&method==='POST'?35000:15000);const response=await fetch('/api/android'+path,{method,headers:{'X-Toolbox-Adb':'1',...(method!=='GET'?{'Content-Type':'application/json'}:{})},body:method==='GET'?undefined:JSON.stringify(body||{}),signal:signal?AbortSignal.any([signal,timeout]):timeout});if(!response.ok){let message='投屏请求失败';try{message=(await response.json()).message||message;}catch{}throw new Error(message);}return response.json();}
async function refresh(){error.value='';try{const [list,caps]=await Promise.all([request('/devices','GET',undefined,AbortSignal.timeout(15000)),request('/mirror/capabilities','GET',undefined,AbortSignal.timeout(10000))]);if(disposed)return;devices.value=list.devices;capabilities.value=caps;if(!list.devices.some(item=>item.serial===serial.value&&item.state==='device'))serial.value=list.devices.find(item=>item.state==='device')?.serial||'';}catch(e){if(!disposed)error.value=e.message;}}
function control(value){
    const id=session.value?.id,current=generation,signal=controller?.signal;if(!id)return Promise.resolve();
    controlChain=controlChain.catch(()=>{}).then(async()=>{
        if(disposed||current!==generation||signal?.aborted)return;
        const result=await request(`/mirror/${id}/control`,'POST',value,signal);
        if(!disposed&&current===generation)error.value='';return result;
    });
    controlChain.catch(e=>{if(!disposed&&current===generation&&!signal?.aborted)error.value=e.message;});return controlChain;
}
async function press(keycode){try{await control({type:'key',keycode,action:0});await control({type:'key',keycode,action:1});}catch{ /* 统一控制错误 */ }}
function pointer(event,action){if(!session.value||!dimensions.value.width)return;if(action===0){touching=true;canvas.value.focus();canvas.value.setPointerCapture(event.pointerId);}if(action===2){if(!touching)return;if(performance.now()-lastMove<40)return;lastMove=performance.now();}if([1,3].includes(action)){if(!touching)return;touching=false;}event.preventDefault();const rect=canvas.value.getBoundingClientRect();const x=Math.max(0,Math.min(dimensions.value.width-1,Math.round((event.clientX-rect.left)/rect.width*dimensions.value.width))),y=Math.max(0,Math.min(dimensions.value.height-1,Math.round((event.clientY-rect.top)/rect.height*dimensions.value.height)));void control({type:'touch',action,x,y});}
function keyboard(event){const code={ArrowUp:19,ArrowDown:20,ArrowLeft:21,ArrowRight:22,Enter:66,Backspace:67,Escape:4,Tab:61,Delete:112,Home:122,End:123,PageUp:92,PageDown:93}[event.key];if(code){event.preventDefault();void press(code);}else if(event.key.length===1&&!event.ctrlKey&&!event.metaKey&&/^[\x20-\x7e]$/.test(event.key)){event.preventDefault();void control({type:'text',text:event.key});}}
async function sendText(){if(!text.value)return;try{await control({type:'text',text:text.value});text.value='';}catch{ /* 统一控制错误 */ }}
async function start(){
    if(busy.value||session.value)return;busy.value=true;error.value='';status.value='正在手机上启动投屏服务…';const current=++generation;controller=new AbortController();const signal=controller.signal;controlChain=Promise.resolve();let pendingConfig,waitingKey=true;
    try{
        const created=await request('/mirror','POST',{serial:serial.value,confirmed:true},signal);if(current!==generation||disposed){await request(`/mirror/${created.id}`,'DELETE',{},AbortSignal.timeout(3000));return;}session.value=created;
        decoder=new VideoDecoder({output:frame=>{try{if(disposed||current!==generation)return;canvas.value.width=frame.displayWidth;canvas.value.height=frame.displayHeight;canvas.value.getContext('2d').drawImage(frame,0,0);status.value='正在投屏，可以点击或拖动画面';}finally{frame.close();}},error:()=>{if(current===generation){error.value='视频解码失败，手机编码可能不受当前浏览器支持';void stop();}}});
        heartbeat=setInterval(()=>{if(session.value)void request(`/mirror/${session.value.id}`,'GET',undefined,signal).catch(e=>{if(!signal.aborted){error.value=e.message;void stop();}});},5000);
        const response=await fetch(`/api/android/mirror/${created.id}/video`,{headers:{'X-Toolbox-Adb':'1'},signal});if(!response.ok)throw new Error((await response.json()).message||'视频读取失败');
        const reader=response.body.getReader(),parser=createScrcpyParser();
        while(true){const {done,value}=await reader.read();if(done){parser.finish();break;}for(const event of parser.push(value)){
            if(current!==generation||signal.aborted)return;
            if(event.type==='size'){dimensions.value={width:event.width,height:event.height};pendingConfig=null;waitingKey=true;if(decoder.state==='configured')decoder.reset();await control({type:'dimensions',width:event.width,height:event.height});}
            else if(event.type==='config'){
                let configuration={codec:avcCodec(event.data),optimizeForLatency:true,hardwareAcceleration:'prefer-hardware'};
                let support=await VideoDecoder.isConfigSupported(configuration);
                if(!support.supported){configuration={codec:configuration.codec,optimizeForLatency:true,hardwareAcceleration:'no-preference'};support=await VideoDecoder.isConfigSupported(configuration);}
                if(!support.supported)throw new Error('当前浏览器不支持手机的 H.264 编码');if(current!==generation)return;decoder.configure(configuration);pendingConfig=event.data;waitingKey=true;
            }else{
                if(!pendingConfig||decoder.state!=='configured')continue;
                if(decoder.decodeQueueSize>5){waitingKey=true;continue;}if(waitingKey&&!event.key)continue;
                let data=event.data;if(event.key){data=new Uint8Array(pendingConfig.length+event.data.length);data.set(pendingConfig);data.set(event.data,pendingConfig.length);waitingKey=false;}
                decoder.decode(new EncodedVideoChunk({type:event.key?'key':'delta',timestamp:event.timestamp,data}));
            }
        }}
        if(!signal.aborted){status.value='投屏流已结束，请重新启动';await stop();}
    }catch(e){if(!signal.aborted&&current===generation){error.value=e.message;await stop();}}
    finally{if(current===generation)busy.value=false;}
}
async function stop(){generation++;controller?.abort();clearInterval(heartbeat);touching=false;if(decoder&&decoder.state!=='closed')decoder.close();decoder=null;const previous=session.value;session.value=null;busy.value=false;status.value='投屏已停止';if(previous)try{await request(`/mirror/${previous.id}`,'DELETE',{},AbortSignal.timeout(5000));}catch{ /* 服务器心跳超时回收 */ }}
const hidden=()=>{if(document.hidden)void stop();};
onMounted(()=>{void refresh();document.addEventListener('visibilitychange',hidden);});
onBeforeUnmount(()=>{disposed=true;void stop();document.removeEventListener('visibilitychange',hidden);});
</script>
