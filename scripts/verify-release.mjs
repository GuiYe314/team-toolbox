// ZIP全新目录与安装器隔离验收；只检查受保护API参数，不执行ADB或真实设备搜索。
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, open, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createToolAccess } from '../backend/src/tool-access.js';
import { apkFixture } from '../backend/test-support/apk-fixture.js';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..'), release = join(root, 'release');
const manifest = JSON.parse((await readFile(join(release, 'device-debugger-manifest.json'), 'utf8')).replace(/^\uFEFF/, ''));
const sourceVersion = JSON.parse(await readFile(join(root, 'backend/package.json'), 'utf8')).version;
const temporary = await mkdtemp(join(root, 'build/release-verify-')), output = join(temporary, 'unpacked'), installed = join(temporary, 'installed');
await mkdir(output); let invocation = 0, checks = 0;
const delay = ms => new Promise(resolveDelay => setTimeout(resolveDelay, ms));
const check = (name, value = true) => { assert.ok(value, name); console.log(`PASS ${++checks} - ${name}`); };
async function run(executable, args, cwd = root, env = {}) {
    const file = join(temporary, `command-${invocation++}.log`), handle = await open(file, 'w');
    return new Promise((resolveRun, reject) => {
        const child = spawn(executable, args, { cwd, env: { ...process.env, TT_SKIP_BROWSER: '1', ...env }, windowsHide: true, windowsVerbatimArguments: executable === 'cmd.exe', stdio: ['ignore', handle.fd, handle.fd] });
        const timer = setTimeout(() => child.kill(), 120000);
        child.once('error', async error => { clearTimeout(timer); await handle.close(); reject(error); });
        child.once('exit', async code => { clearTimeout(timer); await handle.close(); resolveRun({ code, output: await readFile(file, 'utf8') }); });
    });
}
async function ps(code, env = {}) { const result = await run('powershell.exe', ['-NoLogo','-NoProfile','-ExecutionPolicy','Bypass','-EncodedCommand',Buffer.from(code,'utf16le').toString('base64')], root, env); assert.equal(result.code, 0, result.output); return result; }
async function freePort() { const s=createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const port=s.address().port;await new Promise(r=>s.close(r));if(port < 1024 || [1719,1720,1723,2049,3659,4045,4190,5060,5061,6000,6566,6665,6666,6667,6668,6669,6697,10080].includes(port))return freePort();return port; }
async function stop(directory) { const result=await run('cmd.exe',['/d','/s','/c',`""${join(directory,'关闭.cmd')}" /nopause"`],directory);assert.equal(result.code,0,result.output); }
async function start(directory, mode) { const port=await freePort(),result=await run('cmd.exe',['/d','/s','/c',`""${join(directory,'启动.cmd')}" ${mode==='Local'?'/local':'/nopause'}"`],directory,{PORT:String(port),TT_ACCESS_MODE:mode,ADB_PATH:''});assert.equal(result.code,0,result.output);return port; }
const paths=[]; let originalHealth;
try {
    originalHealth=await fetch('http://127.0.0.1:3000/api/health').then(r=>r.json()).catch(()=>null);
    check('独立清单身份与精确标签URL',manifest.product==='device-debugger'&&manifest.version===sourceVersion&&manifest.releaseTag===`device-debugger-v${sourceVersion}`&&[manifest.portable.url,manifest.installer.url].every(url=>url.includes(`/download/device-debugger-v${sourceVersion}/`)));
    for(const asset of [manifest.portable,manifest.installer]) { const bytes=await readFile(join(release,asset.name));check(asset.name+'大小与SHA256',bytes.length===asset.size&&createHash('sha256').update(bytes).digest('hex')===asset.sha256); }
    const extraction=await run('tar.exe',['-xf',join(release,manifest.portable.name),'-C',output]);assert.equal(extraction.code,0,extraction.output);
    const app=join(output,`device-debugger-${sourceVersion}`);paths.push(app);
    const product=JSON.parse((await readFile(join(app,'product.json'),'utf8')).replace(/^\uFEFF/,''));check('ZIP产品身份、版本和独立端口',product.product==='device-debugger'&&product.version===manifest.version&&product.defaultPort===3100);
    const entries=await readdir(join(app,'backend/src'));check('仅双模块生产源码且不含测试/SQLite/更新器',entries.includes('android-persistent.js')&&entries.includes('android-apk-info.js')&&entries.includes('android-apk-manifest.js')&&entries.includes('unity-logs.js')&&!entries.some(x=>/test|^db\.|updater|integrations|network-speed/.test(x)));
    check('发布包无真实data或环境文件',(await readdir(join(app,'data'))).length===0&&!(await readdir(app)).some(x=>x.startsWith('.env')));
    const audit=JSON.parse((await readFile(join(root,'build/release-audit.json'),'utf8')).replace(/^\uFEFF/,''));
    for(const source of audit.sources)assert.equal(createHash('sha256').update(await readFile(join(app,source.path))).digest('hex'),source.sha256);
    check('全部后端生产源码与当前来源逐项哈希一致');
    for(const node of [join(app,'runtime/node.exe'),process.execPath]) { const result=await run(node,[join(app,'runtime/check.js')],app);check('Node '+node+'实际依赖加载',result.code===0); }
    for(const mode of ['Local','Lan']) {
        const port=await start(app,mode),base=`http://127.0.0.1:${port}`;const health=await(await fetch(base+'/api/health')).json();check(mode+'实际CMD生产启动',health.service==='device-debugger-backend'&&health.product==='device-debugger'&&health.accessMode===mode);
        for(const route of ['/','/tools','/tools/android-wireless','/tools/unity-logs','/settings']){const response=await fetch(base+route);assert.equal(response.status,200);assert.match(await response.text(),/Device Debugger/);}check(mode+'生产深链可刷新');
        assert.equal((await(await fetch(base+'/api/android/config')).json()).configured,false);check(mode+'ADB默认独立且未复制旧配置');
        const apk=apkFixture(), apkHeaders={'Content-Type':'application/octet-stream','X-Toolbox-Adb':'1','X-Toolbox-Apk-Name':'fixture.apk','X-Toolbox-Apk-Size':String(apk.length)};
        const inspected=await fetch(base+'/api/android/apk/inspect',{method:'POST',headers:apkHeaders,body:apk});check(mode+'包内APK清单读取无需ADB',(await inspected.json()).packageName==='com.example.unity'&&inspected.status===200);
        const queueMeta=Buffer.from(JSON.stringify({confirm:true,serials:['PHONE_A'],files:[{fileName:'fixture.apk',size:apk.length}]})),prefix=Buffer.alloc(8);prefix.write('TTAP');prefix.writeUInt32BE(queueMeta.length,4);const queueBody=Buffer.concat([prefix,queueMeta,apk]),queueHeaders={'Content-Type':'application/octet-stream','X-Toolbox-Adb':'1','X-Toolbox-Adb-Confirm':'1'};
        const queued=await fetch(base+'/api/android/apk/install-many',{method:'POST',headers:queueHeaders,body:queueBody});check(mode+'多APK端点已注册且未配置ADB不执行安装',queued.status===409&&(await queued.json()).error==='not_configured');
        assert.equal((await fetch(base+'/api/android/apk/install-many',{method:'POST',headers:{...queueHeaders,Origin:'https://evil.invalid'},body:queueBody})).status,403);check(mode+'多APK端点保留跨站保护');
        const headers={'Content-Type':'application/json','X-Toolbox-Adb':'1',Origin:base};
        assert.equal((await fetch(base+'/api/android/persistent/list',{method:'POST',headers,body:'{}'})).status,400);check(mode+'文件管理API已注册且无效请求不执行ADB');
        assert.equal((await fetch(base+'/api/android/persistent/list',{method:'POST',headers:{...headers,Origin:'https://evil.invalid'},body:'{}'})).status,403);check(mode+'跨站操作被拒绝');
        assert.equal((await fetch(base+'/api/unity-logs/sessions',{method:'POST',headers:{'Content-Type':'application/json','X-Toolbox-Unity-Log':'1',Origin:base},body:'{"deviceId":"missing"}'})).status,404);check(mode+'Unity接口为业务错误且未搜索真实设备');
        for(const route of ['/api/documents','/api/update/status','/tools/earth-sunlight'])assert.equal((await fetch(base+route)).status,404);check(mode+'无主工具箱业务和更新接口');
        if(mode==='Lan'){const address=createToolAccess({allowLan:true}).addresses()[0];assert.ok(address);const remote=await(await fetch(`http://${address}:${port}/api/health`)).json();check('实际私网IP生产访问',remote.product==='device-debugger');}
        await writeFile(join(app,'data/preserve.txt'),'user data fixture');await stop(app);await assert.rejects(fetch(base+'/api/health'));check(mode+'停止后端口释放且保留data',await readFile(join(app,'data/preserve.txt'),'utf8')==='user data fixture');
    }
    // Silent install into this task's random sandbox. No user-selected directory or browser is opened.
    let result=await run(join(release,manifest.installer.name),['/CURRENTUSER','/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART','/NOICONS',`/DIR=${installed}`,`/LOG=${join(temporary,'install.log')}`]);assert.equal(result.code,0,result.output);paths.push(installed);
    check('安装器随机隔离目录安装成功',JSON.parse((await readFile(join(installed,'backend/package.json'),'utf8'))).name==='device-debugger-backend');
    const port=await start(installed,'Local');check('安装器产物真实启动',(await(await fetch(`http://127.0.0.1:${port}/api/health`)).json()).product==='device-debugger');await stop(installed);
    await writeFile(join(installed,'data/preserve.txt'),'keep after uninstall');
    result=await run(join(installed,'unins000.exe'),['/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART']);assert.equal(result.code,0,result.output);
    for(let i=0;i<100;i++){try{await readFile(join(installed,'backend/src/index.js'));await delay(50);}catch{break;}}
    check('卸载保留用户data',await readFile(join(installed,'data/preserve.txt'),'utf8')==='keep after uninstall');
    if(originalHealth){const after=await(await fetch('http://127.0.0.1:3000/api/health')).json();check('原工具箱3000实例保持原身份与健康',after.service===originalHealth.service&&after.version===originalHealth.version);}
    console.log(`RESULT: ${checks} release checks passed; no real ADB/Unity device was accessed.`);
} finally {
    for(const directory of paths)await stop(directory).catch(()=>{});
    assert.ok(resolve(temporary).startsWith(resolve(root,'build')+'\\')||resolve(temporary).startsWith(resolve(root,'build')+'/'));
    await rm(temporary,{recursive:true,force:true,maxRetries:5,retryDelay:150});
}
