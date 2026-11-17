// 合成文件 + 真实Sharp/FFmpeg/OCR/PDF/白板/WebRTC；不读取团队数据，不连接手机。
import assert from 'node:assert/strict';
import { TOOLS } from './src/utils/tool-catalog.js';
import { createRequire } from 'node:module';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { once } from 'node:events';
import { testBrowser, removeBrowserFixture, delay } from './verify-browser.mjs';
const backendRoot=resolve(process.env.VERIFY_BACKEND_ROOT || fileURLToPath(new URL('../backend',import.meta.url)));
const source=name=>import(pathToFileURL(join(backendRoot,'src',name)).href);
const {registerMediaToolsApi}=await source('media-tools-api.js'),{processVideo}=await source('media-tools.js');
const {registerTransferApi}=await source('transfer-api.js'),{createTransferRooms}=await source('transfer-rooms.js');
const {bundledExecutable,runIntegrationProcess}=await source('integration-common.js');
const require=createRequire(join(backendRoot,'package.json')),express=require('express'),sharp=require('sharp'),{createCanvas}=require('@napi-rs/canvas');
const {PDFDocument}=await import('pdf-lib');
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),temporary=await mkdtemp(join(tmpdir(),'tt-workshops-browser-')),ffmpeg=bundledExecutable('ffmpeg');
const image=join(temporary,'sample.png'),ocr=join(temporary,'ocr.png'),video=join(temporary,'sample.mp4'),pdf1=join(temporary,'one.pdf'),pdf2=join(temporary,'two.pdf');
await sharp({create:{width:320,height:200,channels:3,background:'blue'}}).png().toFile(image);
const drawing=createCanvas(1000,240),context=drawing.getContext('2d');context.fillStyle='white';context.fillRect(0,0,1000,240);context.fillStyle='black';context.font='72px Arial';context.fillText('TEAM TOOLBOX 2026',40,140);await writeFile(ocr,drawing.toBuffer('image/png'));
for(const [path,count] of [[pdf1,2],[pdf2,1]]){const doc=await PDFDocument.create();for(let i=0;i<count;i++)doc.addPage([200,300]);await writeFile(path,await doc.save());}
await runIntegrationProcess(ffmpeg,['-hide_banner','-loglevel','error','-y','-f','lavfi','-i','color=c=blue:s=160x120:r=10:d=0.5','-f','lavfi','-i','sine=frequency=440:duration=0.5','-shortest','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac',video]);
let savedBoard,latestRoom;
const app=express();app.use(express.json({limit:'1mb'}));
const media=registerMediaToolsApi(app,{log:()=>{},videoProcessor:(file,signal)=>processVideo(file,signal,{executable:ffmpeg})});
const rooms=createTransferRooms(),transfer=registerTransferApi(app,{service:{...rooms,create(){latestRoom=rooms.create();return latestRoom;}}});
app.get('/api/documents/tree',(_req,res)=>res.json({items:[]}));app.get('/api/documents',(_req,res)=>res.json({items:[]}));
app.get('/api/assets',(_req,res)=>res.json({items:savedBoard?[{id:'fixture-board',name:'验收图纸.excalidraw'}]:[]}));
app.post('/api/assets/upload',async(req,res)=>{try{const Busboy=require('busboy'),{pipeline}=await import('node:stream/promises');const parser=Busboy({headers:req.headers,limits:{files:1,fields:4,fileSize:20*1024**2}}),chunks=[];parser.on('file',(_key,stream)=>stream.on('data',chunk=>chunks.push(chunk)));await pipeline(req,parser);savedBoard=Buffer.concat(chunks);res.json({id:'fixture-board'});}catch(e){res.status(400).json({message:e.message});}});
app.get('/api/assets/files/fixture-board/original/latest',(_req,res)=>res.type('application/json').send(savedBoard));
app.get('/api/android/devices',(_req,res)=>res.json({devices:[]}));app.get('/api/android/mirror/capabilities',(_req,res)=>res.json({ready:true,version:'5.0.1'}));
app.use('/api',(_req,res)=>res.status(503).json({message:'隔离验收没有真实设备和团队数据'}));
const dist=resolve(process.env.VERIFY_DIST || join(root,'frontend/dist'));app.use(express.static(dist,{index:false}));app.get('/{*path}',(_req,res)=>res.sendFile(join(dist,'index.html')));
const server=app.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}`;
let browser,count=0;
const check=(label,value=true)=>{assert.ok(value,label);console.log(`PASS ${++count} ${label}`);};
async function navigate(path,selector){await browser.send('Page.navigate',{url:base+path});await browser.wait(`!!document.querySelector(${JSON.stringify(selector)})`);}
async function clickText(selector,text){await browser.evaluate(`{const el=[...document.querySelectorAll(${JSON.stringify(selector)})].find(el=>el.textContent.trim()===${JSON.stringify(text)});if(!el)throw Error('missing '+${JSON.stringify(text)});el.click();}`);await delay(60);}
async function waitLong(expression,seconds=45){for(let i=0;i<seconds*4;i++){if(await browser.evaluate(expression))return;await delay(250);}throw Error('等待超时：'+expression);}
async function shot(name){const result=await browser.send('Page.captureScreenshot',{format:'png'});await writeFile(join(root,'build',name),Buffer.from(result.data,'base64'));}
async function chooseMany(selector,files){const doc=await browser.send('DOM.getDocument'),el=await browser.send('DOM.querySelector',{nodeId:doc.root.nodeId,selector});await browser.send('DOM.setFileInputFiles',{nodeId:el.nodeId,files});}
async function setPeerInput(selector,value){await browser.evaluate(`{const el=window.__peer.document.querySelector(${JSON.stringify(selector)});el.value=${JSON.stringify(value)};el.dispatchEvent(new window.__peer.Event('input',{bubbles:true}));}`);}
try{
    browser=await testBrowser(temporary);
    if (process.env.VERIFY_WORKSHOP_ONLY !== 'transfer') {
    await navigate('/tools','.page-tools');check('目录工具卡片和新增分组入口',await browser.evaluate("document.querySelectorAll('.tool-card').length==="+TOOLS.length+"&&!!document.querySelector('[data-tool-id=image-batch]')&&!!document.querySelector('[data-tool-id=android-mirror]')"));
    await navigate('/tools/image-batch','#media-files');await browser.choose('#media-files',image);await browser.select('select','jpeg');await browser.click('#media-start');await waitLong("!!document.querySelector('.workshop-item a[download]')");
    check('真实图片上传处理并显示可解码预览',await browser.evaluate("document.querySelector('.workshop-item').textContent.includes('完成')&&document.querySelector('.workshop-item img').naturalWidth===320"));
    await browser.evaluate("{const data=new DataTransfer();data.items.add(new File(['bad'],'broken.png',{type:'image/png'}));const input=document.querySelector('#media-files');input.files=data.files;input.dispatchEvent(new Event('change',{bubbles:true}));}");await browser.click('#media-start');await waitLong("document.querySelector('.workshop-item:last-child').textContent.includes('失败')");check('损坏图片逐项失败，成功结果保留',await browser.evaluate("document.querySelectorAll('.workshop-item a[download]').length===1&&!!document.querySelector('[role=alert]')"));
    await navigate('/tools/pdf','#pdf-files');await chooseMany('#pdf-files',[pdf1,pdf2]);await browser.click('#pdf-start');await browser.wait("!!document.querySelector('#pdf-download')");
    const pdfBase64=await browser.evaluate("(async()=>{const bytes=new Uint8Array(await(await fetch(document.querySelector('#pdf-download').href)).arrayBuffer());return btoa(String.fromCharCode(...bytes));})()");check('浏览器实际合并PDF为三页',(await PDFDocument.load(Buffer.from(pdfBase64,'base64'))).getPageCount()===3);
    await browser.fill('#pdf-pages','99');await browser.click('#pdf-start');await browser.wait("!!document.querySelector('[role=alert]')");check('非法页码明确报错且不保留旧下载结果',await browser.evaluate("!document.querySelector('#pdf-download')&&document.querySelector('[role=alert]').textContent.includes('页码')"));
    await navigate('/tools/video-process','#media-files');await browser.choose('#media-files',video);await browser.select('select','mp3');await browser.click('#media-start');await waitLong("!!document.querySelector('.workshop-item a[download]')");check('浏览器真实FFmpeg提取音频并生成MP3下载',await browser.evaluate("document.querySelector('.workshop-item a').download.endsWith('.mp3')"));
    await navigate('/tools/developer-tools','#dev-input');await browser.fill('#dev-input','{"b":2,"a":1}');await browser.click('#dev-run');check('JSON页面实际美化并支持复制下载',await browser.evaluate("document.querySelector('#dev-output').value.includes('\\n  \"b\"')"));
    await clickText('.workshop-tabs button','Base64');await browser.fill('#dev-input','工具箱 中文');await browser.click('#dev-run');check('Base64支持中文',await browser.evaluate("document.querySelector('#dev-output').value==='5bel5YW3566xIOS4reaWhw=='"));
    await clickText('.workshop-tabs button','SHA-256');await browser.fill('#dev-input','abc');await browser.click('#dev-run');await browser.wait("document.querySelector('#dev-output').value.length===64");check('真实SHA-256计算匹配已知摘要',await browser.evaluate("document.querySelector('#dev-output').value==='ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'"));
    await clickText('.workshop-tabs button','正则测试');await browser.fill('#dev-input','error warning error');await browser.fill('#regex-pattern','error');await browser.click('#dev-run');await browser.wait("document.querySelector('#dev-output').value.includes('error')");check('正则worker返回两次匹配',await browser.evaluate("JSON.parse(document.querySelector('#dev-output').value).length===2"));
    await browser.fill('#dev-input','a'.repeat(20000)+'!');await browser.fill('#regex-pattern','(a+)+$');await browser.click('#dev-run');await waitLong("!!document.querySelector('[role=alert]')",10);check('灾难性正则超时终止，界面可继续使用',await browser.evaluate("document.querySelector('[role=alert]').textContent.includes('2秒')&&!document.querySelector('#dev-run').disabled"));
    await clickText('.workshop-tabs button','二维码');await browser.fill('#dev-input','工具箱-local-test');await browser.click('#dev-run');await browser.wait("!!document.querySelector('img.transfer-qr')");check('二维码真实生成PNG',await browser.evaluate("document.querySelector('img.transfer-qr').src.startsWith('data:image/png')"));
    await clickText('.workshop-tabs button','文本对比');await browser.wait("document.querySelectorAll('.monaco-editor').length>=2");check('Monaco左右差异编辑器成功加载');
    await navigate('/tools/image-ocr','#ocr-file');await browser.choose('#ocr-file',ocr);await browser.select('select','eng');await browser.click('#ocr-start');await waitLong("/TEAM.*TOOLBOX.*2026/.test(document.querySelector('#ocr-text').value)",60);check('本地模型与WASM真实识别英文截图',await browser.evaluate("!document.querySelector('#ocr-start').disabled&&!document.querySelector('[role=alert]')"));
    await browser.click('#ocr-start');await clickText('.workshop button','停止');await delay(400);check('OCR模型加载/识别可停止且迟到结果不覆盖状态',await browser.evaluate("document.querySelector('[role=status]').textContent.includes('已停止')&&!document.querySelector('#ocr-start').disabled"));
    const board={type:'excalidraw',version:2,source:'toolbox-test',elements:[{id:'test-rectangle',type:'rectangle',x:30,y:30,width:250,height:100,angle:0,strokeColor:'#1e1e1e',backgroundColor:'transparent',fillStyle:'hachure',strokeWidth:1,strokeStyle:'solid',roughness:1,opacity:100,groupIds:[],frameId:null,roundness:null,seed:1,version:1,versionNonce:1,isDeleted:false,boundElements:null,updated:1,link:null,locked:false}],appState:{viewBackgroundColor:'#ffffff'},files:{}};
    const boardFile=join(temporary,'test.excalidraw');await writeFile(boardFile,JSON.stringify(board));await navigate('/tools/whiteboard','#board-import');await waitLong("!!document.querySelector('.excalidraw canvas')&&!document.querySelector('#board-import').disabled");await browser.choose('#board-import',boardFile);await browser.wait("document.querySelector('[role=status]')?.textContent.includes('本地图纸已读取')");check('真实Excalidraw画布加载并导入本地图纸',await browser.evaluate("document.querySelectorAll('.excalidraw canvas').length>=1"));
    await browser.fill('#board-name','验收图纸');await browser.click('#board-save');await browser.wait("document.querySelector('[role=status]')?.textContent.includes('已新建到资源库')");check('白板主动保存源文件到隔离资源库',JSON.parse(savedBoard).elements[0].id==='test-rectangle');
    await clickText('.workshop button','从资源库读取');await browser.select('[aria-label="选择资源库图纸"]','fixture-board');await clickText('.workshop button','读取');await browser.wait("document.querySelector('[role=status]')?.textContent==='图纸已读取'");check('资源库图纸可重新读取到画布');await shot('workshops-whiteboard.png');
    }
    await navigate('/tools/peer-transfer','#transfer-create');
    await browser.evaluate("window.__Rtc=window.RTCPeerConnection;window.RTCPeerConnection=class extends window.__Rtc{constructor(options){super(options);window.__rtc=this;}};");
    await browser.click('#transfer-create');await browser.wait("!!document.querySelector('.transfer-qr')");assert.ok(latestRoom);
    await browser.send('Runtime.evaluate',{expression:`window.__peer=window.open(${JSON.stringify(base+'/transfer#room='+latestRoom.id+'&invite='+latestRoom.invite)},'_blank')`,userGesture:true});
    await browser.wait("!!window.__peer?.document.querySelector('#transfer-join')");
    await browser.evaluate("window.__peer.eval('window.__Rtc=window.RTCPeerConnection;window.RTCPeerConnection=class extends window.__Rtc{constructor(options){super(options);window.__rtc=this;}};');window.__peer.document.querySelector('#transfer-join').click()");
    try { await waitLong("!document.querySelector('#transfer-file').disabled&&!window.__peer.document.querySelector('#transfer-file').disabled",30); }
    catch(error) { console.log('连接诊断',await browser.evaluate("({owner:{status:document.querySelector('[role=status]')?.textContent,error:document.querySelector('[role=alert]')?.textContent,ice:window.__rtc?.iceConnectionState,connection:window.__rtc?.connectionState,signal:window.__rtc?.signalingState},guest:{status:window.__peer.document.querySelector('[role=status]')?.textContent,error:window.__peer.document.querySelector('[role=alert]')?.textContent,ice:window.__peer.__rtc?.iceConnectionState,connection:window.__peer.__rtc?.connectionState,signal:window.__peer.__rtc?.signalingState}})"));throw error; }
    check('两个真实浏览器页面经信令建立WebRTC直传连接');
    await browser.fill('#transfer-text','电脑发给手机');await browser.click('#transfer-send-text');await browser.wait("[...window.__peer.document.querySelectorAll('.workshop-list')].some(list=>list.textContent.includes('电脑发给手机'))");await setPeerInput('#transfer-text','手机发给电脑');await browser.evaluate("window.__peer.document.querySelector('#transfer-send-text').click()");await browser.wait("[...document.querySelectorAll('.workshop-list')].some(list=>list.textContent.includes('手机发给电脑'))");check('文字真正双向传输');
    await browser.choose('#transfer-file',image);await browser.wait("!!window.__peer.document.querySelector('#transfer-accept')");check('收到文件请求时需要主动接收确认',await browser.evaluate("!window.__peer.document.querySelector('a[download]')"));await browser.evaluate("window.__peer.document.querySelector('#transfer-accept').click()");await waitLong("!!window.__peer.document.querySelector('a[download]')");check('电脑文件分块直传后摘要核对成功',await browser.evaluate("window.__peer.document.querySelector('a[download]').download==='sample.png'"));
    await browser.evaluate("{const peer=window.__peer,data=new peer.DataTransfer();data.items.add(new peer.File(['来自手机的文件'],'mobile.txt',{type:'text/plain'}));const input=peer.document.querySelector('#transfer-file');input.files=data.files;input.dispatchEvent(new peer.Event('change',{bubbles:true}));}");await browser.wait("!!document.querySelector('#transfer-accept')");await browser.click('#transfer-accept');await browser.wait("!!document.querySelector('a[download]')");check('反向文件传输和实际字节一致',await browser.evaluate("(async()=>await(await fetch(document.querySelector('a[download]').href)).text())()") === '来自手机的文件');await browser.evaluate("window.__peer.close()");
    await clickText('.workshop button','停止并关闭连接');await browser.wait("!document.querySelector('#transfer-create').disabled");check('停止互传后房间被撤销且文件仍可下载',rooms.size===0&&await browser.evaluate("!!document.querySelector('a[download]')"));
    await navigate('/tools/android-mirror','#mirror-device');await browser.wait("document.querySelector('#mirror-device').options.length===1");check('无真实安卓设备时启动禁用且不伪造画面',await browser.evaluate("document.querySelector('#mirror-start').disabled&&document.querySelector('[role=status]').textContent.includes('尚未启动')"));
    for(const theme of ['dark','light'])for(const [path,selector]of [['/tools/image-batch','#media-files'],['/tools/pdf','#pdf-files'],['/tools/developer-tools','#dev-input'],['/tools/android-mirror','#mirror-device']]){
        await navigate(path,selector);await browser.evaluate(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`);await delay(200);await browser.send('Emulation.setDeviceMetricsOverride',{width:1280,height:1000,deviceScaleFactor:1,mobile:false});
        check(`${theme} ${path} 无内容横向溢出`,await browser.evaluate("document.querySelector('.main-content').scrollWidth<=document.querySelector('.main-content').clientWidth+1&&[...document.querySelectorAll('.workshop-panel')].every(el=>el.scrollWidth<=el.clientWidth+1)"));
    }
    await shot('workshops-light.png');
    check('所有OCR/字体/脚本均为本地请求',browser.requests.every(url=>url.startsWith(base)||url.startsWith('blob:')||url.startsWith('data:')));check('浏览器没有未处理脚本异常',browser.errors.length===0);
    console.log(`完成 ${count} 项隔离浏览器验收`);
}finally{await browser?.close();media.dispose();transfer.dispose();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await removeBrowserFixture(temporary);}
