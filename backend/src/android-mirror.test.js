import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { PassThrough } from 'node:stream';
import { createServer } from 'node:net';
import express from 'express';
import { controlMessage, mirrorArguments, createAndroidMirror, SCRCPY } from './android-mirror.js';
import { registerAndroidApi } from './android-api.js';
test('scrcpy固定启动参数与结构化按键/触控/文字序列化',()=>{
    const args=mirrorArguments('USB123','000012ab','/data/local/tmp/toolbox-scrcpy-000012ab.jar');assert.deepEqual(args.slice(0,3),['-s','USB123','shell']);assert.ok(args.includes('audio=false'));assert.ok(args.includes('clipboard_autosync=false'));assert.ok(args.includes(SCRCPY.version));
    const key=controlMessage({type:'key',keycode:3,action:0},{});assert.equal(key.length,14);assert.equal(key.readUInt32BE(2),3);
    const touch=controlMessage({type:'touch',action:0,x:10,y:20},{width:720,height:1280});assert.equal(touch.length,32);assert.equal(touch.readBigInt64BE(2),-1n);assert.equal(touch.readUInt16BE(18),720);assert.equal(touch.readUInt16BE(22),65535);
    assert.throws(()=>controlMessage({type:'touch',action:0,x:720,y:0},{width:720,height:1280}));assert.throws(()=>controlMessage({type:'key',keycode:999,action:0},{}));assert.throws(()=>controlMessage({type:'text',text:'中文'},{}));assert.equal(controlMessage({type:'text',text:'Unity'},{}).toString('utf8',5),'Unity');
});
test('投屏拒绝未授权设备和无效组件，不启动外部程序',async()=>{
    let spawned=0;const service=createAndroidMirror({run:async()=>({stdout:''}),readDevices:async()=>[{serial:'USB123',state:'unauthorized'}],spawnProcess:()=>{spawned++;}});await assert.rejects(service.start('USB123'),/未在线或未授权/);await assert.rejects(service.start('-s bad'),/明确/);assert.equal(spawned,0);
    const missing=createAndroidMirror({jar:'not-a-real-component',readDevices:async()=>[{serial:'USB123',state:'device'}],run:async()=>({stdout:''})});assert.equal((await missing.capabilities()).ready,false);await assert.rejects(missing.start('USB123'),/组件/);
});
test('真实本机双通道模拟scrcpy：启动、二进制视频、控制、互斥和清理',async()=>{
    const sockets=[],calls=[],controls=[];const tcp=createServer(socket=>{sockets.push(socket);if(sockets.length===1)socket.write(Buffer.from([0]));else socket.on('data',bytes=>controls.push(bytes));});tcp.listen(0,'127.0.0.1');await once(tcp,'listening');
    let childKilled=false;const service=createAndroidMirror({executable:()=>'/fake/adb',verifyComponent:async()=>({ready:true}),readDevices:async()=>[{serial:'USB123',state:'device'}],run:async(args)=>{calls.push(args);return{stdout:args.includes('tcp:0')?String(tcp.address().port):''};},spawnProcess:()=>{const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>{childKilled=true;};return child;}});
    const app=express();app.get('/video/:id',(req,res)=>service.attach(req.params.id,res));const http=app.listen(0,'127.0.0.1');await once(http,'listening');let reader;
    try{
        const started=await service.start('USB123');assert.equal(started.version,SCRCPY.version);await assert.rejects(service.start('USB123'),/已有投屏/);assert.equal(service.heartbeat(started.id).active,true);
        const response=await fetch(`http://127.0.0.1:${http.address().port}/video/${started.id}`);reader=response.body.getReader();sockets[0].write(Buffer.from('h264-test-video'));const first=await reader.read();assert.equal(Buffer.from(first.value).toString(),'h264-test-video');
        service.control(started.id,{type:'dimensions',width:720,height:1280});service.control(started.id,{type:'touch',action:0,x:40,y:50});service.control(started.id,{type:'key',action:0,keycode:3});for(let i=0;i<20&&!controls.length;i++)await new Promise(resolve=>setTimeout(resolve,10));assert.ok(controls.length);assert.equal(Buffer.concat(controls)[0],2);
        await reader.cancel();await service.dispose();assert.ok(childKilled);assert.ok(calls.some(args=>args.includes('--remove')));assert.ok(calls.some(args=>args.includes('rm')&&args.at(-1).startsWith('/data/local/tmp/toolbox-scrcpy-')));assert.throws(()=>service.heartbeat(started.id));
    }finally{await service.dispose();for(const socket of sockets)socket.destroy();http.closeAllConnections();await new Promise(resolve=>http.close(resolve));await new Promise(resolve=>tcp.close(resolve));}
});
test('新增投屏HTTP端点要求专用头和主动确认',async()=>{
    const app=express();app.use(express.json());let started=0;registerAndroidApi(app,{service:{mirrorCapabilities:()=>({ready:true}),startMirror:()=>{started++;return{id:'test'};},dispose(){}}});const server=app.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}/api/android/mirror`;
    try{assert.equal((await fetch(base+'/capabilities')).status,403);assert.equal((await fetch(base,{method:'POST',headers:{'X-Toolbox-Adb':'1','Content-Type':'application/json'},body:JSON.stringify({serial:'USB123'})})).status,400);assert.equal(started,0);assert.equal((await fetch(base,{method:'POST',headers:{'X-Toolbox-Adb':'1','Content-Type':'application/json'},body:JSON.stringify({serial:'USB123',confirmed:true})})).status,200);assert.equal(started,1);}finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
