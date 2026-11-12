// 独立产品真实浏览器 + 合成Unity HTTP设备，固定发现/票据/预览/下载协议。
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createDeviceDebuggerApp } from '../backend/src/server.js';
import { createUnityLogService } from '../backend/src/unity-logs.js';
import { probeLogDevice } from '../backend/src/unity-log-discovery.js';
import { readLogJson, openLogResponse } from '../backend/src/unity-log-http.js';
import { testBrowser, removeBrowserFixture, delay } from './verify-browser.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..'), temporary = await mkdtemp(join(tmpdir(), 'device-debugger-ui-'));
const sourceVersion = JSON.parse(await readFile(join(root, 'frontend/package.json'), 'utf8')).version;
const require = createRequire(new URL('../backend/package.json', import.meta.url)), archive = require('archiver')('zip', { zlib: { level: 0 } }), chunks = [];
const log = '2026-11-12T09:00:00Z [Log] [thread:1] 启动成功\n2026-11-12T09:00:01Z [Warning] 温度提醒\n2026-11-12T09:00:02Z [Exception] 合成异常\nUnityEngine.TestMethod()\n<script>window.__unityInjected=true</script>\n';
const old = '2026-11-11T09:00:00Z [Log] 历史记录\n';
const names = ['hhh_startup_20261112_a1.log', 'hhh_startup_20261111_b1.log'];
archive.on('data', data => chunks.push(data)); const finished = new Promise((resolveEnd, reject) => { archive.on('end', resolveEnd); archive.on('error', reject); }); archive.append(log, { name: names[0] }); archive.append(old, { name: names[1] }); await archive.finalize(); await finished; const zip = Buffer.concat(chunks);
const id = 'a'.repeat(32), ticket = 'b'.repeat(64); let failing = false, holding = false, active = 0, cancelled = 0, probes = 0, previews = 0;
const device = createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/api/discovery') { probes++; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ protocol: 'hhh-startup-log', protocolVersion: 1, requestId: url.searchParams.get('requestId'), httpPort: device.address().port, deviceId: id, deviceName: 'Unity 合成手机', deviceModel: 'Offline Fixture', platform: 'Android', appId: 'com.fixture.unity', appVersion: '1.0', sessionTicket: ticket, expiresInSeconds: 120 })); return; }
    if (req.headers['x-hhh-log-session'] !== ticket) { res.writeHead(401).end(); return; }
    if (failing && url.pathname === '/api/file') { res.writeHead(503).end(); return; }
    if (holding && url.pathname === '/api/file') { active++; res.once('close', () => { active--; cancelled++; }); return; }
    if (url.pathname === '/api/files') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ files: names.map((name, index) => ({ name, bytes: Buffer.byteLength(index ? old : log), modifiedUtc: `2026-11-${index ? '11' : '12'}T09:00:00Z` })) })); }
    else if (url.pathname === '/api/file') { previews++; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ text: url.searchParams.get('name') === names[1] ? old : log, truncated: false })); }
    else if (url.pathname === '/download') { res.setHeader('Content-Type', 'text/plain'); res.end(url.searchParams.get('name') === names[1] ? old : log); }
    else if (url.pathname === '/archive') { res.setHeader('Content-Type', 'application/zip'); res.end(zip); }
    else res.writeHead(404).end();
});
await new Promise(resolveListen => device.listen(0, '127.0.0.1', resolveListen));
const probe = (_address, _port, signal) => probeLogDevice('127.0.0.1', device.address().port, signal, 2500, options => readLogJson({ ...options, allowLoopback: true }));
const unity = createUnityLogService({ probe, scan: async ({ signal }) => ({ devices: [await probe('', 0, signal)], port: device.address().port, checked: 1, planned: 1, networks: [{ name: '临时协议联调', cidr: '127.0.0.1/32', checked: 1, planned: 1 }], timedOut: false }), readJson: options => readLogJson({ ...options, allowLoopback: true }), openResponse: options => openLogResponse({ ...options, allowLoopback: true }) });
const runtime = createDeviceDebuggerApp({ unityService: unity, androidService: { getConfig: () => ({ configured: false }), dispose() {} } });
const server = await new Promise(resolveListen => { const s = runtime.app.listen(0, '127.0.0.1', () => resolveListen(s)); });
let browser, checks = 0; const check = (name, condition = true) => { assert.ok(condition, name); console.log(`PASS ${++checks} - ${name}`); };
try {
    browser = await testBrowser(temporary); const { send, evaluate, wait, click, fill, select } = browser, base = `http://127.0.0.1:${server.address().port}`;
    await send('Page.navigate', { url: base + '/tools' }); await wait("document.querySelectorAll('.tool-card').length===2");
    check('独立首页仅安卓与Unity双入口，标题/版本正确', await evaluate(`document.title.includes('Device Debugger') && document.querySelector('.version-tag').textContent.includes(${JSON.stringify(sourceVersion)}) && document.querySelectorAll('.debugger-nav a').length===4`));
    check('页面未请求其他业务API', !browser.requests.some(url => /\/api\/(documents|assets|update|integrations|network-speed)/.test(url)));
    await click('a[href="/settings"]'); await wait("document.querySelector('.set-page #adb-open-settings')"); await click('#adb-open-settings'); await wait("document.querySelector('#adb-folder')");
    check('设置发布链接指向当前独立产品标签', await evaluate(`document.querySelector('.set-page a[target="_blank"]').href === ${JSON.stringify('https://github.com/GuiYe314/team-toolbox/releases/tag/device-debugger-v' + sourceVersion)}`));
    check('设置弹窗挂body且支持焦点', await evaluate("document.querySelector('.adb-settings-dialog').parentElement.parentElement===document.body"));
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await wait("!document.querySelector('#adb-folder')"); check('Escape关闭并恢复焦点', await evaluate("document.activeElement.id==='adb-open-settings'"));
    await click('a[href="/tools/unity-logs"]'); await wait("document.querySelector('.page-unity-logs')");
    await click('.ulog-devices .ulog-actions button'); await wait("document.querySelector('.ulog-device')"); check('通过真实HTTP发现合成Unity设备', probes > 0 && await evaluate("document.querySelector('.ulog-device').textContent.includes('Unity 合成手机')"));
    await click('.ulog-device'); await wait("document.querySelectorAll('.ulog-log-entry').length===3");
    check('连接并读取历史列表和完整多行日志', previews > 0 && await evaluate("document.querySelectorAll('.ulog-file-picker option').length===2"));
    check('票据不在页面或浏览器请求中，HTML按文本展示', !await evaluate(`document.body.textContent.includes('${ticket}') || !!window.__unityInjected`));
    await select('.ulog-filters select', 'error'); await wait("document.querySelectorAll('.ulog-log-entry').length===1"); await fill('.ulog-keyword input', 'TestMethod'); await wait("document.querySelectorAll('.ulog-log-entry').length===1"); check('错误等级与堆栈关键词按整条记录过滤', await evaluate("document.querySelector('.ulog-log-entry').textContent.includes('合成异常')"));
    await evaluate("window.__copied='';navigator.clipboard.writeText=async text=>{window.__copied=text}");
    await evaluate("[...document.querySelectorAll('.ulog-actions button')].find(x=>x.textContent.includes('复制匹配')).click()"); await wait("window.__copied.includes('TestMethod')"); check('复制包含完整匹配堆栈', await evaluate("!window.__copied.includes('启动成功')"));
    await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: join(temporary, 'downloads') });
    await evaluate("[...document.querySelectorAll('.ulog-actions button')].find(x=>x.textContent.includes('下载当前')).click()");
    for (let i=0;i<100 && !(await readdir(join(temporary,'downloads')).catch(()=>[])).includes(names[0]);i++) await delay(40);
    check('全文下载包含被界面筛掉的普通记录', (await readFile(join(temporary,'downloads',names[0]),'utf8')) === log);
    await evaluate("[...document.querySelectorAll('.ulog-actions button')].find(x=>x.textContent.includes('下载全部')).click()");
    let zipName; for (let i=0;i<100;i++) { zipName=(await readdir(join(temporary,'downloads')).catch(()=>[])).find(name=>name.endsWith('.zip')); if(zipName)break; await delay(40); }
    check('ZIP下载字节完整', !!zipName && (await readFile(join(temporary,'downloads',zipName))).equals(zip));
    await select('.ulog-file-picker select', names[1]); await fill('.ulog-keyword input', ''); await select('.ulog-filters select', 'all'); await wait("document.querySelector('.ulog-log-list').textContent.includes('历史记录')"); check('可切换历史文件', true);
    // 关闭自动跟随，失败保留上次成功内容，并可手动恢复。
    await evaluate("{const e=[...document.querySelectorAll('.ulog-options label')].find(x=>x.textContent.includes('每 3 秒')).querySelector('input');if(e.checked)e.click();}");
    failing=true; await click('.ulog-file-toolbar button'); await wait("document.querySelector('.ulog-reader .ulog-error')"); check('读取错误保留内容并标记异常', await evaluate("document.querySelector('.ulog-reader').textContent.includes('保留上次成功') && document.querySelector('.ulog-badge').textContent.includes('读取异常')"));
    failing=false; await click('.ulog-file-toolbar button'); await wait("!document.querySelector('.ulog-reader .ulog-error')"); check('错误后恢复读取', true);
    for (const theme of ['light','dark']) { await evaluate(`document.documentElement.dataset.theme='${theme}'`); await send('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false}); await delay(300); check(`${theme}主题与1280布局`,await evaluate("{const p=document.querySelector('.page-unity-logs'),s=getComputedStyle(document.querySelector('.ulog-filters select'));p.scrollWidth<=p.clientWidth+1&&s.color!==s.backgroundColor;}")); await mkdir(join(root,'build'),{recursive:true});await writeFile(join(root,`build/device-unity-${theme}.png`),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64')); }
    holding=true; await click('.ulog-file-toolbar button'); for(let i=0;i<50&&!active;i++)await delay(20); assert.ok(active); const before=cancelled;
    await click('a[href="/tools"]'); await wait("document.querySelectorAll('.tool-card').length===2"); for(let i=0;i<100&&active;i++)await delay(30); check('离页取消实际HTTP读取并关闭会话',active===0&&cancelled>before);
    check('无页面异常及无其他业务调用',browser.errors.length===0&&!browser.requests.some(url=>/\/api\/(documents|assets|update|integrations)/.test(url)));
    console.log(`RESULT: ${checks} checks passed; synthetic Unity HTTP only; no physical device was accessed.`);
} catch(error) { if(browser)console.error(await browser.evaluate('document.body.innerText').catch(()=>''));throw error; }
finally { runtime.dispose(); await browser?.close(); for(const listener of [server,device]) { listener.closeAllConnections();await new Promise(resolveClose=>listener.close(resolveClose)); } await removeBrowserFixture(temporary); }
