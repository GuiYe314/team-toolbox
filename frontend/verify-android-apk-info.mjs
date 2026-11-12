// 真实Vue/HTTP/ZIP/编译清单；合成APK，不访问手机或团队数据库。
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createAndroidAdbService, AdbError } from '../backend/src/android-adb.js';
import { registerAndroidApi } from '../backend/src/android-api.js';
import { createToolAccess } from '../backend/src/tool-access.js';
import { readApkPackageName } from '../backend/src/android-apk-info.js';
import { apkFixture } from '../backend/test-support/apk-fixture.js';
import { testBrowser, removeBrowserFixture, delay } from './verify-browser.mjs';
const require=createRequire(new URL('../backend/package.json',import.meta.url)),express=require('express');
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),temporary=await mkdtemp(join(tmpdir(),'tt-apk-info-ui-'));
const good=join(temporary,'中文 应用.apk'),second=join(temporary,'第二个.apk'),bad=join(temporary,'损坏.apk'),wrong=join(temporary,'bundle.aab');
await writeFile(good,apkFixture());await writeFile(second,apkFixture({packageName:'com.example.second',utf8:false}));await writeFile(bad,'not an APK');await writeFile(wrong,'aab fixture');
let hold=false,waiting=0,cancelled=0,adbCalls=0,reads=0;
const service=createAndroidAdbService({env:{},configFile:join(temporary,'adb.json'),log:()=>{},runner:async()=>{adbCalls++;throw new Error('ADB must not run');},apkInfoOptions:{temporaryBase:temporary,reader:async(file,signal)=>{
    reads++;
    if(hold){waiting++;try{await new Promise((_,reject)=>{const abort=()=>{cancelled++;reject(new AdbError('cancelled','读取已取消',499));};signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();});}finally{waiting--;}}
    return readApkPackageName(file,signal);
}}});
const app=express(),lan=process.env.TT_VERIFY_LAN==='1',access=createToolAccess({allowLan:lan}),host=lan?access.addresses()[0]:'127.0.0.1';assert.ok(host);
app.use(access.middleware);app.use(express.json());registerAndroidApi(app,{service,access});
app.get('/api/documents/tree',(_req,res)=>res.json({items:[]}));app.get('/api/documents',(_req,res)=>res.json({items:[],total:0}));app.get('/api/update/status',(_req,res)=>res.json({current:'0.3.1',configured:false}));
app.use(express.static(join(root,'frontend/dist'),{index:false}));app.get(/^(?!\/api\/).*/,(_req,res)=>res.sendFile(join(root,'frontend/dist/index.html')));
const server=await new Promise(resolve=>{const s=app.listen(0,lan?'0.0.0.0':'127.0.0.1',()=>resolve(s));}),base=`http://${host}:${server.address().port}`;
let browser,checks=0;
const check=(name,value)=>{assert.ok(value,name);console.log(`PASS ${++checks} - ${name}`);};
async function untilWaiting(){for(let i=0;i<100&&!waiting;i++)await delay(20);assert.ok(waiting,'服务端已开始等待');}
async function untilIdle(){for(let i=0;i<100&&(waiting||(await readdir(temporary)).some(name=>name.startsWith('toolbox-apk-info-')));i++)await delay(30);assert.equal(waiting,0);}
try{
    browser=await testBrowser(temporary);const {send,evaluate,wait,click,choose}=browser;
    await send('Page.navigate',{url:base+'/tools/android-wireless'});await wait("document.querySelector('#adb-apk-info-file') && !document.querySelector('#adb-apk-info-file').disabled");
    check('无ADB配置/设备时可选择APK，默认不上传或读取',adbCalls===0&&reads===0&&await evaluate("document.querySelector('#adb-apk-info-read').disabled"));
    await choose('#adb-apk-info-file',good);check('选择文件后主动读取，不自动上传',reads===0&&await evaluate("!document.querySelector('#adb-apk-info-read').disabled"));
    await click('#adb-apk-info-read');await wait("document.querySelector('#adb-apk-info-package')?.value==='com.example.unity'");check('真实二进制清单读取并显示包名',reads===1&&adbCalls===0);
    await evaluate("Object.defineProperty(navigator,'clipboard',{configurable:true,value:undefined});document.execCommand=command=>{window.__apkCopied=document.activeElement.value;return command==='copy'}");
    await click('#adb-apk-info-copy');await wait("document.querySelector('#adb-apk-info-notice')?.textContent.includes('已复制')");check('局域网HTTP复制降级得到完整包名',await evaluate("window.__apkCopied==='com.example.unity'"));
    await evaluate("document.execCommand=()=>false");await click('#adb-apk-info-copy');await wait("document.querySelector('#adb-apk-info-error')?.textContent.includes('复制')");check('复制失败明确反馈且包名可手动选择',await evaluate("document.querySelector('#adb-apk-info-package').readOnly"));
    await evaluate("document.execCommand=()=>true");await click('#adb-apk-info-copy');await wait("!document.querySelector('#adb-apk-info-error')");check('复制重试清除旧错误',true);
    await choose('#adb-apk-info-file',second);check('换文件立即清除旧包名',!await evaluate("!!document.querySelector('#adb-apk-info-package')"));
    await click('#adb-apk-info-read');await wait("document.querySelector('#adb-apk-info-package')?.value==='com.example.second'");check('UTF16清单及第二个文件独立读取',true);
    await choose('#adb-apk-info-file',bad);await click('#adb-apk-info-read');await wait("document.querySelector('#adb-apk-info-error')");check('坏APK明确报错，不保留前一个包名',!await evaluate("!!document.querySelector('#adb-apk-info-package')"));
    await choose('#adb-apk-info-file',wrong);await wait("document.querySelector('#adb-apk-info-error')?.textContent.includes('.apk')");check('AAB不被伪装成APK读取',await evaluate("document.querySelector('#adb-apk-info-read').disabled"));
    await choose('#adb-apk-info-file',good);await click('#adb-apk-info-read');await wait("document.querySelector('#adb-apk-info-package')");check('错误后重新选择可恢复读取',true);
    await click('#adb-apk-info-clear');check('清空释放文件和结果，不执行任何手机操作',await evaluate("document.querySelector('#adb-apk-info-file').value==='' && !document.querySelector('#adb-apk-info-package')"));
    hold=true;await choose('#adb-apk-info-file',good);await click('#adb-apk-info-read');await untilWaiting();await click('#adb-apk-info-cancel');await untilIdle();check('取消读取终止服务端任务并清理临时APK',cancelled===1&&!await evaluate("document.querySelector('#adb-apk-info-read').disabled"));
    await click('#adb-apk-info-read');await untilWaiting();await evaluate("Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'))");await untilIdle();check('后台停止读取并阻止迟到回填',cancelled===2&&!await evaluate("!!document.querySelector('#adb-apk-info-package')"));
    await evaluate("Object.defineProperty(document,'hidden',{configurable:true,value:false})");hold=false;await click('#adb-apk-info-read');await wait("document.querySelector('#adb-apk-info-package')");
    for(const theme of ['light','dark']){
        await evaluate(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`);await send('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});await evaluate("document.querySelector('.apk-info-panel').scrollIntoView()");await delay(300);
        check(theme+'面板/包名输入清晰、无内部横向溢出',await evaluate("{const p=document.querySelector('.apk-info-panel'),s=getComputedStyle(document.querySelector('#adb-apk-info-package'));p.scrollWidth<=p.clientWidth+1 && s.color!==s.backgroundColor;}"));
        await mkdir(join(root,'build'),{recursive:true});await writeFile(join(root,`build/apk-info-${theme}.png`),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));
    }
    hold=true;await click('#adb-apk-info-read');await untilWaiting();await click('a[href="/tools"]');await wait("document.querySelector('.tools-grid')");await untilIdle();check('离页取消并清理临时文件，所有过程未调用ADB',cancelled===3&&adbCalls===0&&!(await readdir(temporary)).some(name=>name.startsWith('toolbox-apk-info-')));
    check('无浏览器运行异常或真实数据库访问',browser.errors.length===0);
    console.log(`RESULT: ${checks} APK info checks passed; synthetic APKs only, no device was accessed.`);
}finally{service.dispose();await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await removeBrowserFixture(temporary);}
