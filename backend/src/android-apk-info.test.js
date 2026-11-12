import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, PassThrough } from 'node:stream';
import express from 'express';
import { createAndroidAdbService } from './android-adb.js';
import { registerAndroidApi } from './android-api.js';
import { parseApkPackageName, APK_MANIFEST_MAX_BYTES } from './android-apk-manifest.js';
import { createAndroidApkInfo, readApkPackageName } from './android-apk-info.js';
import { binaryManifest, zipFixture, apkFixture } from '../test-support/apk-fixture.js';

const apk = apkFixture(), meta = bytes => ({ fileName: '中文测试 (debug).APK', size: bytes.length });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function fixture(t, options = {}) {
    const directory = await mkdtemp(join(tmpdir(), 'tt-apk-info-'));
    const logs = [], service = createAndroidApkInfo({ temporaryBase: directory, log: record => logs.push(record), ...options });
    t.after(async () => { service.dispose(); await rm(directory, { recursive: true, force: true }); });
    return { directory, service, logs, clean: async () => assert.deepEqual(await readdir(directory), []) };
}
test('编译清单UTF8/UTF16、长字符串、无raw值及嵌套应用读取真实package属性', () => {
    for (const utf8 of [true, false]) for (const raw of [true, false]) {
        const packageName = 'com.' + 'long'.repeat(40) + '.app';
        assert.equal(parseApkPackageName(binaryManifest({ packageName, utf8, raw, namespace: utf8 ? '命名空间😀' : 'x'.repeat(33000) })), packageName);
    }
});
test('清单截断、块/字符串偏移、缺失/重复包名、资源引用及非法包名拒绝', () => {
    const valid = binaryManifest();
    for (const bytes of [valid.subarray(0, valid.length - 4), Buffer.from('<manifest package="com.fake"/>'), Buffer.alloc(APK_MANIFEST_MAX_BYTES + 4), binaryManifest({ duplicate: true }), binaryManifest({ packageType: 1 }), binaryManifest({ packageName: 'com.app;reboot' })]) assert.throws(() => parseApkPackageName(bytes));
    for (const [offset, value] of [[4, 0xffffffff], [8 + 4, 0], [8 + 28, 0xffffffff], [8 + 20, 0xffffffff]]) {
        const changed = Buffer.from(valid); changed.writeUInt32LE(value, offset); assert.throws(() => parseApkPackageName(changed));
    }
});
test('ZIP读取支持deflate与stored，只返回清单包名，不提取其他内容', async t => {
    const f = await fixture(t);
    for (const compressed of [true, false]) {
        const file = join(f.directory, 'fixture.apk'); await writeFile(file, zipFixture([['assets/unrelated', 'private fixture'], ['AndroidManifest.xml', binaryManifest({ utf8: compressed })]], { compressed }));
        assert.equal(await readApkPackageName(file), 'com.example.unity');
    }
    assert.deepEqual(await readdir(f.directory), ['fixture.apk']);
});
test('ZIP缺失/重复/加密/超大清单与CRC损坏明确失败', async t => {
    const f = await fixture(t), file = join(f.directory, 'bad.apk');
    const stored = zipFixture([['AndroidManifest.xml', binaryManifest()]], { compressed: false });
    const corrupted = Buffer.from(stored); corrupted[30 + Buffer.byteLength('AndroidManifest.xml') + 20] ^= 1;
    const encrypted = Buffer.from(stored); encrypted.writeUInt16LE(0x801, encrypted.indexOf(Buffer.from([0x50,0x4b,0x01,0x02])) + 8);
    for (const bytes of [Buffer.from('bad zip'), zipFixture([['base/manifest/AndroidManifest.xml','aab']]), zipFixture([['AndroidManifest.xml',binaryManifest()],['AndroidManifest.xml',binaryManifest()]]), corrupted, encrypted, zipFixture([['AndroidManifest.xml',Buffer.alloc(APK_MANIFEST_MAX_BYTES + 1)]])]) {
        await writeFile(file, bytes); await assert.rejects(readApkPackageName(file), error => ['invalid_apk','invalid_manifest'].includes(error.code));
    }
});
test('无ADB配置/设备也能流式读取包名，结果与日志不含本机路径，结束清理', async t => {
    const f = await fixture(t); let calls = 0;
    const service = createAndroidAdbService({ env: {}, configFile: join(f.directory,'unused.json'), runner: async () => { calls++; throw new Error('Must not execute ADB'); }, apkInfoOptions: { temporaryBase: f.directory }, log: item => f.logs.push(item) });
    t.after(() => service.dispose());
    assert.equal(service.getConfig().configured,false);
    const result = await service.inspectApkPackage(meta(apk), Readable.from([apk.subarray(0,20),apk.subarray(20)]));
    assert.deepEqual(result,{ ...meta(apk), packageName:'com.example.unity' }); assert.equal(calls,0);
    assert.deepEqual(f.logs,[{action:'apk_inspect',ok:true}]); await f.clean();
});
test('请求只接受APK文件名和非空有界大小，不能传路径/设备/命令', async t => {
    const f=await fixture(t,{maximumBytes:1024});
    for(const change of [{fileName:'../app.apk'},{fileName:'C:\\app.apk'},{fileName:'app.aab'},{fileName:'x\n.apk'},{size:0},{size:1.5},{size:1025},{serial:'PHONE'},{path:'C:/secret.apk'},{args:['shell']}]) await assert.rejects(f.service.inspect({...meta(apk),...change},Readable.from([apk])));
    await f.clean();
});
test('上传过量/不足和坏清单清理临时内容，失败后可以重试', async t => {
    const f=await fixture(t);
    for(const bytes of [apk.subarray(0,20),Buffer.concat([apk,Buffer.from('extra')]),Buffer.alloc(apk.length)]) {
        await assert.rejects(f.service.inspect(meta(apk),Readable.from([bytes]))); await f.clean();
    }
    assert.equal((await f.service.inspect(meta(apk),Readable.from([apk]))).packageName,'com.example.unity'); await f.clean();
});
test('并发拒绝、取消/退出/超时均清理并释放单任务锁', async t => {
    for(const mode of ['cancel','dispose','timeout']) {
        const f=await fixture(t,{timeoutMs:mode==='timeout'?60:5000}), input=new PassThrough(), controller=new AbortController();
        const pending=f.service.inspect(meta(apk),input,controller.signal); const rejected=assert.rejects(pending,{code:mode==='timeout'?'timeout':'cancelled'});
        for(let i=0;i<100 && !(await readdir(f.directory)).length;i++)await delay(5);
        await assert.rejects(f.service.inspect(meta(apk),Readable.from([apk])),{code:'busy'});
        if(mode==='cancel')controller.abort(); if(mode==='dispose')f.service.dispose();
        await rejected; input.destroy(); await f.clean();
        assert.equal((await f.service.inspect(meta(apk),Readable.from([apk]))).packageName,'com.example.unity'); await f.clean();
    }
});
test('HTTP无ADB读取、二进制精确许可、参数/来源保护与错误响应', async t => {
    const f=await fixture(t), service=createAndroidAdbService({env:{},configFile:join(f.directory,'config.json'),apkInfoOptions:{temporaryBase:f.directory},log:()=>{}});
    const app=express(); app.use(express.json()); registerAndroidApi(app,{service});
    const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));}); const base='http://127.0.0.1:'+server.address().port;
    t.after(async()=>{service.dispose();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
    const headers={'Content-Type':'application/octet-stream','X-Toolbox-Adb':'1','X-Toolbox-Apk-Name':encodeURIComponent(meta(apk).fileName),'X-Toolbox-Apk-Size':String(apk.length),Origin:base};
    let response=await fetch(base+'/api/android/apk/inspect',{method:'POST',headers,body:apk});assert.equal(response.status,200);assert.equal((await response.json()).packageName,'com.example.unity');
    for(const [url,changes,body,status] of [['/apk/inspect',{Origin:'https://evil.invalid'},apk,403],['/apk/inspect',{'X-Toolbox-Adb':''},apk,403],['/apk/inspect?path=x',{},apk,400],['/apk/inspect',{'Content-Type':'application/json'},'{}',400],['/apps',{},apk,403],['/apk/inspect',{'X-Toolbox-Apk-Name':'%invalid'},apk,400],['/apk/inspect',{'X-Toolbox-Apk-Size':'10'},apk,400]]) {
        response=await fetch(base+'/api/android'+url,{method:'POST',headers:{...headers,...changes},body});assert.equal(response.status,status,url);
    }
    await f.clean();
});
