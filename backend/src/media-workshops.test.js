import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import express from 'express';
import sharp from 'sharp';
import { imageOptions, videoOptions, videoArguments, processImage, processVideo } from './media-tools.js';
import { registerMediaToolsApi } from './media-tools-api.js';
import { bundledExecutable, runIntegrationProcess } from './integration-common.js';

test('图片选项拒绝未知字段、非法范围和过长水印', () => {
    assert.equal(imageOptions().format, 'webp');
    for (const options of [null, { format:'svg' },{quality:0},{width:-1},{height:100000},{rotate:45},{watermark:'a'.repeat(81)},{path:'C:/x'}]) assert.throws(()=>imageOptions(options));
});
test('视频参数只从结构化选项生成，并限制本地协议和输出大小', () => {
    for(const options of [{mode:'shell'},{start:-1},{duration:0},{width:9999},{crf:99},{url:'http://x'}]) assert.throws(()=>videoOptions(options));
    const args=videoArguments('C:/private/input','C:/private/output.mp4',{mode:'trim',start:1,duration:2,width:640,crf:24});
    assert.equal(args[args.indexOf('-protocol_whitelist')+1],'file,pipe');assert.ok(args.includes('libx264'));assert.equal(args[args.indexOf('-t')+1],'2');assert.equal(args.at(-1),'C:/private/output.mp4');
    assert.ok(videoArguments('x','y',{mode:'mp3'}).includes('libmp3lame'));assert.ok(videoArguments('x','y',{mode:'gif',duration:60}).includes('30'));
});
test('Sharp 真实转码、旋转、尺寸和水印保留原件', async () => {
    const directory=await mkdtemp(join(tmpdir(),'tt-image-test-'));
    try{
        const input=join(directory,'input'),original=await sharp({create:{width:160,height:100,channels:3,background:'navy'}}).png().toBuffer();await writeFile(input,original);
        const result=await processImage({directory,input,name:'original.png',options:{format:'jpeg',width:80,rotate:90,watermark:'TEST'}},new AbortController().signal);
        const metadata=await sharp(result.output).metadata();assert.equal(metadata.format,'jpeg');assert.equal(metadata.width,80);assert.equal(metadata.height,128);assert.deepEqual(await readFile(input),original);
    }finally{await rm(directory,{recursive:true,force:true});}
});
test('Sharp 拒绝 SVG 和取消，不伪造成功文件', async()=>{
    const directory=await mkdtemp(join(tmpdir(),'tt-image-test-'));try{const input=join(directory,'input');await writeFile(input,'<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>');await assert.rejects(processImage({directory,input,name:'x.svg',options:{}},new AbortController().signal));const cancelled=new AbortController();cancelled.abort();await assert.rejects(processImage({directory,input,name:'x.png',options:{}},cancelled.signal));}finally{await rm(directory,{recursive:true,force:true});}
});

async function fixture(fn, options={}){
    const app=express();const service=registerMediaToolsApi(app,{...options,log:()=>{}});const listener=app.listen(0,'127.0.0.1');await once(listener,'listening');try{return await fn(`http://127.0.0.1:${listener.address().port}`,service);}finally{await service.dispose();listener.closeAllConnections();await new Promise(resolve=>listener.close(resolve));}
}
test('真实 HTTP 图片上传/下载、专用头、同源和错误恢复',async()=>fixture(async base=>{
    const original=await sharp({create:{width:32,height:24,channels:3,background:'blue'}}).png().toBuffer();
    const form=()=>{const data=new FormData();data.append('options',JSON.stringify({format:'webp',width:16}));data.append('file',new Blob([original]),'sample.png');return data;};
    assert.equal((await fetch(base+'/api/media-tools/image',{method:'POST',body:form()})).status,403);
    assert.equal((await fetch(base+'/api/media-tools/image',{method:'POST',headers:{'X-Toolbox-Media':'1',Origin:'https://foreign.invalid'},body:form()})).status,403);
    const response=await fetch(base+'/api/media-tools/image',{method:'POST',headers:{'X-Toolbox-Media':'1'},body:form()});assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(decodeURIComponent(response.headers.get('x-toolbox-result-name')),'sample-处理.webp');const metadata=await sharp(Buffer.from(await response.arrayBuffer())).metadata();assert.equal(metadata.width,16);assert.equal(metadata.height,12);
    const bad=new FormData();bad.append('file',new Blob(['invalid']),'x.png');assert.equal((await fetch(base+'/api/media-tools/image',{method:'POST',headers:{'X-Toolbox-Media':'1'},body:bad})).status,422);
}));
test('取消 HTTP 视频处理会触发取消并清理私有暂存目录',async()=>{
    let directory,ready,cleaned;const started=new Promise(resolve=>{ready=resolve;});
    await fixture(async base=>{const controller=new AbortController();const form=new FormData();form.append('file',new Blob(['local video test']),'test.mp4');const pending=fetch(base+'/api/media-tools/video',{method:'POST',headers:{'X-Toolbox-Media':'1'},body:form,signal:controller.signal}).catch(()=>{});await started;controller.abort();await pending;for(let i=0;i<60;i++){if(!existsSync(directory)){cleaned=true;break;}await new Promise(resolve=>setTimeout(resolve,20));}assert.ok(cleaned);},{videoProcessor:async(file,signal)=>{directory=file.directory;ready();await new Promise((resolve,reject)=>{signal.addEventListener('abort',()=>reject(new Error('cancelled')),{once:true});});}});
});
test('处理超时返回明确错误并清理暂存，连接不会一直等待', async () => {
    let directory;
    await fixture(async base => {
        const form = new FormData();
        form.append('file', new Blob(['local video test']), 'test.mp4');
        const response = await fetch(base + '/api/media-tools/video', {
            method: 'POST', headers: { 'X-Toolbox-Media': '1' }, body: form, signal: AbortSignal.timeout(5000)
        });
        assert.equal(response.status, 408);
        assert.match((await response.json()).message, /超时/);
        for (let i = 0; i < 60 && existsSync(directory); i++) await new Promise(resolve => setTimeout(resolve, 20));
        assert.ok(directory && !existsSync(directory));
    }, {
        timeoutMs: 250,
        videoProcessor: async (file, signal) => {
            directory = file.directory;
            signal.throwIfAborted();
            await new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
        }
    });
});
test('服务关闭等待处理停止和暂存清理后才完成', async () => {
    let directory, ready;
    const started = new Promise(resolve => { ready = resolve; });
    await fixture(async (base, service) => {
        const form = new FormData(); form.append('file', new Blob(['local video test']), 'test.mp4');
        const pending = fetch(base + '/api/media-tools/video', { method: 'POST', headers: { 'X-Toolbox-Media': '1' }, body: form, signal: AbortSignal.timeout(5000) });
        await started;
        await service.dispose();
        assert.ok(directory && !existsSync(directory));
        assert.equal((await pending).status, 503);
    }, { videoProcessor: async (file, signal) => {
        directory = file.directory; ready();
        await new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
    } });
});
const ffmpeg=bundledExecutable('ffmpeg');
test('FFmpeg 真实本地视频压缩、提取音频及 GIF', {skip:!existsSync(ffmpeg)},async()=>{
    const directory=await mkdtemp(join(tmpdir(),'tt-video-test-'));try{
        const input=join(directory,'input.mp4');await runIntegrationProcess(ffmpeg,['-hide_banner','-loglevel','error','-y','-f','lavfi','-i','color=c=blue:s=160x120:r=10:d=0.5','-f','lavfi','-i','sine=frequency=440:duration=0.5','-shortest','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac',input]);
        for(const mode of ['compress','mp3','gif']){const result=await processVideo({directory,input,name:'fixture.mp4',options:{mode,width:160,duration:0.3}},new AbortController().signal,{executable:ffmpeg});const bytes=await readFile(result.output);assert.ok(bytes.length>100);if(mode==='compress')assert.equal(bytes.toString('ascii',4,8),'ftyp');if(mode==='gif')assert.equal(bytes.toString('ascii',0,3),'GIF');}
        assert.deepEqual((await readdir(directory)).filter(name=>name.startsWith('input')),['input.mp4']);
    }finally{await rm(directory,{recursive:true,force:true});}
});
