import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { once } from 'node:events';
import { createTransferRooms } from './transfer-rooms.js';
import { registerTransferApi } from './transfer-api.js';
test('房间只能加入一次，票据隔离并拒绝无效或Unicode票据',()=>{
    const service=createTransferRooms(),owner=service.create();assert.notEqual(owner.ticket,owner.invite);assert.throws(()=>service.join(owner.id,'wrong'));const guest=service.join(owner.id,owner.invite);assert.notEqual(guest.ticket,owner.ticket);assert.throws(()=>service.join(owner.id,owner.invite));assert.throws(()=>service.poll(owner.id,owner.invite));assert.throws(()=>service.poll(owner.id,'中'.repeat(43)));assert.equal(service.poll(owner.id,guest.ticket).joined,true);service.dispose();assert.equal(service.size,0);
});
test('信令按接收方交付，方向校验与游标确认回收',()=>{
    const service=createTransferRooms(),owner=service.create(),guest=service.join(owner.id,owner.invite);const ownerEvents=service.poll(owner.id,owner.ticket);assert.equal(ownerEvents.events[0].kind,'joined');assert.throws(()=>service.signal(owner.id,guest.ticket,'offer',{type:'offer',sdp:'v=0\n'}));service.signal(owner.id,owner.ticket,'offer',{type:'offer',sdp:'v=0\n'});const result=service.poll(owner.id,guest.ticket);assert.equal(result.events[0].kind,'offer');assert.equal(service.poll(owner.id,guest.ticket,result.sequence).events.length,0);assert.throws(()=>service.poll(owner.id,guest.ticket,999));assert.throws(()=>service.signal(owner.id,guest.ticket,'ice',{candidate:'http://bad'}));assert.throws(()=>service.signal(owner.id,guest.ticket,'answer',{type:'answer',sdp:'x'.repeat(40000)}));
});
test('关闭、离开、超时及容量边界均可恢复',()=>{
    let now=0;const service=createTransferRooms({now:()=>now,ttl:100000});const owner=service.create(),guest=service.join(owner.id,owner.invite);service.close(owner.id,guest.ticket);assert.equal(service.poll(owner.id,owner.ticket).events.at(-1).kind,'left');assert.throws(()=>service.poll(owner.id,guest.ticket));service.close(owner.id,owner.ticket);assert.throws(()=>service.poll(owner.id,owner.ticket));for(let i=0;i<16;i++)service.create();assert.throws(()=>service.create());now=60001;assert.equal(service.size,0);const room=service.create();now+=100001;assert.throws(()=>service.poll(room.id,room.ticket));
});
test('HTTP 互传拒绝跨源/无专用头，支持两端信令及关闭',async()=>{
    const app=express();app.use(express.json());const service=registerTransferApi(app);const server=app.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}/api/transfer`;
    const call=async(path,method='GET',body,ticket,extra={})=>fetch(base+path,{method,headers:{'X-Toolbox-Transfer':'1','Content-Type':'application/json',...(ticket?{'X-Toolbox-Transfer-Token':ticket}:{}),...extra},body:method==='GET'?undefined:JSON.stringify(body||{})});
    try{assert.equal((await fetch(base+'/config')).status,403);assert.equal((await call('/rooms','POST',{},undefined,{Origin:'https://evil.invalid'})).status,403);const owner=await(await call('/rooms','POST',{})).json(),guest=await(await call(`/rooms/${owner.id}/join`,'POST',{invite:owner.invite})).json();assert.ok(guest.ticket);assert.equal((await call(`/rooms/${owner.id}`,'GET',undefined,'wrong')).status,403);const events=await(await call(`/rooms/${owner.id}`,'GET',undefined,owner.ticket)).json();assert.equal(events.events[0].kind,'joined');assert.equal((await call(`/rooms/${owner.id}`,'DELETE',{},owner.ticket)).status,200);assert.equal((await call(`/rooms/${owner.id}`,'GET',undefined,guest.ticket)).status,410);}finally{service.dispose();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
