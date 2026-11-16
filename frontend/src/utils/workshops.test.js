import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import { utf8Base64, timestampConvert, convertColor, normalizeRegexFlags } from './developer-tools.js';
import { parsePageSelection, buildPdf } from './pdf-tools.js';
import { validateBoard } from './whiteboard.js';
import { createScrcpyParser, avcCodec } from './scrcpy-video.js';
import { validOffer, safeFileName } from './peer-transfer.js';
test('中英文 Base64 往返和非法内容拒绝',()=>{const text='工具箱 🚀\nUnity配置';assert.equal(utf8Base64(utf8Base64(text),true),text);for(const input of ['@@@','a===','/w=='])assert.throws(()=>utf8Base64(input,true));});
test('时间戳、RGB/HSL和正则标志校验',()=>{assert.match(timestampConvert('0'),/1970-01-01/);assert.match(timestampConvert('2026-11-16T00:00:00Z',true),/2026-11-16T00:00:00.000Z/);assert.throws(()=>timestampConvert('abc'));assert.match(convertColor('#f00'),/hsl\(0, 100%, 50%\)/);assert.match(convertColor('rgb(0, 255, 0)'),/#00FF00/);assert.throws(()=>convertColor('rgb(256,0,0)'));assert.equal(normalizeRegexFlags('im'),'img');assert.throws(()=>normalizeRegexFlags('gg'));});
test('PDF 页码范围、去重和边界',()=>{assert.deepEqual(parsePageSelection('1-3,2,5',5),[0,1,2,4]);assert.deepEqual(parsePageSelection('',2),[0,1]);for(const value of ['0','3-1','6','1,,2','a'])assert.throws(()=>parsePageSelection(value,5));});
test('真实 PDF 合并、提取和旋转及取消',async()=>{
    const source=await PDFDocument.create();source.addPage([200,300]);source.addPage([300,400]);const bytes=await source.save(),file=new File([bytes],'test.pdf',{type:'application/pdf'});
    const result=await buildPdf([file,file],{pages:'2',rotation:90,watermark:'TEST'});const pdf=await PDFDocument.load(await result.arrayBuffer());assert.equal(pdf.getPageCount(),2);assert.equal(pdf.getPage(0).getWidth(),300);assert.equal(pdf.getPage(0).getRotation().angle,90);
    await assert.rejects(buildPdf([file],{pages:'3'}));await assert.rejects(buildPdf([file],{watermark:'中文'}));const controller=new AbortController();controller.abort();await assert.rejects(buildPdf([file],{}, {signal:controller.signal}));
});
test('白板拒绝远程图片、脚本链接和嵌入，允许内嵌位图',()=>{const valid={type:'excalidraw',elements:[{id:'shape',type:'rectangle'}],files:{}};assert.equal(validateBoard(valid).elements.length,1);assert.throws(()=>validateBoard({...valid,elements:[{id:'x',type:'embeddable'}]}));assert.throws(()=>validateBoard({...valid,elements:[{id:'x',link:'javascript:alert(1)'}]}));assert.throws(()=>validateBoard({...valid,files:{x:{dataURL:'https://evil.invalid/x.png'}}}));});
test('scrcpy5 真实协议按任意分块解析会话/配置/关键帧',()=>{
    const codec=Buffer.from('h264'),size=Buffer.alloc(12);size.writeUInt32BE(0x80000000);size.writeUInt32BE(720,4);size.writeUInt32BE(1280,8);const sps=Buffer.from([0,0,0,1,0x67,0x42,0xc0,0x1e,1]),packet=(flags,data)=>{const header=Buffer.alloc(12);header.writeBigUInt64BE(flags);header.writeUInt32BE(data.length,8);return Buffer.concat([header,data]);};
    const bytes=Buffer.concat([codec,size,packet(1n<<62n,sps),packet((1n<<61n)|12345n,Buffer.from([0,0,1,0x65,9]))]),parser=createScrcpyParser(),events=[];for(let offset=0;offset<bytes.length;offset+=3)events.push(...parser.push(bytes.subarray(offset,offset+3)));parser.finish();assert.deepEqual(events.map(event=>event.type),['size','config','frame']);assert.equal(events[0].width,720);assert.equal(events[2].timestamp,12345);assert.equal(events[2].key,true);assert.equal(avcCodec(events[1].data),'avc1.42c01e');
});
test('投屏拒绝未知编码、超大帧和截断；文件传输限制与名称清理',()=>{assert.throws(()=>createScrcpyParser().push(Buffer.from('h265')));const parser=createScrcpyParser();parser.push(Buffer.from('h264x'));assert.throws(()=>parser.finish());const header=Buffer.alloc(16);header.write('h264');header.writeUInt32BE(99999999,12);assert.throws(()=>createScrcpyParser().push(header));assert.equal(safeFileName('../x\u0000.png'),'.._x_.png');assert.equal(validOffer({type:'file',id:'a'.repeat(24),name:'x',size:100}),true);assert.equal(validOffer({type:'file',id:'a'.repeat(24),name:'x',size:101*1024**2}),false);});
