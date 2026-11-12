// 生产构建 + 临时浏览器 + 合成网卡；不读取真实数据库或启动计数进程。
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { registerNetworkSpeedApi } from '../backend/src/network-speed-api.js';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(new URL('../backend/package.json', import.meta.url));
const express = require('express');
const dist = join(root, 'frontend/dist');
assert.ok(existsSync(join(dist, 'index.html')), '先构建前端');
const temporary = mkdtempSync(join(tmpdir(), 'tt-network-ui-'));
assert.ok(resolve(temporary).startsWith(resolve(tmpdir()) + sep) && temporary.includes('tt-network-ui-'));
const profile = join(temporary, 'browser'); mkdirSync(profile);
const app = express();
let mode = 'live', delayMs = 0, sequence = 0, requestCount = 0, active = 0, maxActive = 0, aborts = 0;
const delayed = new Set();
app.get('/api/documents/tree', (_req, res) => res.json({ items: [] }));
app.get('/api/documents', (_req, res) => res.json({ items: [], total: 0 }));
app.use('/api/network-speed', (req, res, next) => {
    requestCount++; active++; maxActive = Math.max(maxActive, active);
    res.once('close', () => { active--; if (!res.writableEnded) aborts++; });
    if (mode === 'http-error') return res.status(503).json({ message: '合成网络故障' });
    if (delayMs) { const timer = setTimeout(() => { delayed.delete(timer); next(); }, delayMs); delayed.add(timer); } else next();
});
function adapter(id, virtual, down, up) {
    return { id, name: virtual ? 'VPN 虚拟网卡' : '以太网 合成网卡', description: virtual ? 'Isolated VPN' : 'Isolated physical adapter', connected: mode !== 'disconnected', virtual, linkSpeedBps: 1e9,
        counterTimeMs: sequence * 1000, counterEpoch: 1, receivedBytes: String(BigInt(sequence) * BigInt(down) + 10000n), sentBytes: String(BigInt(sequence) * BigInt(up) + 2000n),
        downloadBps: mode === 'disconnected' || mode === 'error' ? null : down, uploadBps: mode === 'disconnected' || mode === 'error' ? null : up,
        downloadBytes: down, uploadBytes: up, intervalMs: 1000 };
}
registerNetworkSpeedApi(app, { monitor: { snapshot() {
    sequence++; const adapters = mode === 'unsupported' ? [] : [adapter('vpn', true, 4096, 1024), ...(mode === 'removed' ? [] : [adapter('ethernet', false, 1048576, 131072)])];
    return { state: mode === 'unsupported' ? 'unsupported' : mode === 'error' ? 'error' : 'ready', message: mode === 'unsupported' ? '实时网速目前支持 Windows 服务器电脑' : mode === 'error' ? '合成采样错误，将自动重试' : '', sampleId: sequence, sampledAt: new Date().toISOString(), adapters, ageMs: 0, pollAfterMs: 1000 };
} } });
app.use('/api', (_req, res) => res.status(501).json({ message: '隔离服务不提供其他接口' }));
app.use(express.static(dist, { index: false }));
app.get('/{*path}', (_req, res) => res.sendFile(join(dist, 'index.html')));
const server = await new Promise(resolvePromise => { const s = app.listen(0, '127.0.0.1', () => resolvePromise(s)); });
const base = 'http://127.0.0.1:' + server.address().port;
const browserExe = [process.env.VERIFY_BROWSER, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].filter(Boolean).find(existsSync);
assert.ok(browserExe);
const browser = spawn(browserExe, ['--headless=new', '--disable-gpu', '--disable-background-networking', '--no-first-run', '--disable-extensions', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', '--user-data-dir=' + profile, '--window-size=1600,1000', 'about:blank'], { windowsHide: true, stdio: 'ignore' });
let browserError, ws, messageId = 0, passed = 0;
browser.on('error', error => { browserError = error; });
const pending = new Map(), errors = [], outside = [];
const delay = ms => new Promise(resolvePromise => setTimeout(resolvePromise, ms));
function send(method, params = {}) { const id = ++messageId; return new Promise((resolvePromise, reject) => { const timer = setTimeout(() => { pending.delete(id); reject(new Error('CDP timeout: ' + method)); }, 30000); pending.set(id, { resolve: resolvePromise, reject, timer }); ws.send(JSON.stringify({ id, method, params })); }); }
async function evaluate(expression) { const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails)); return result.result?.value; }
async function wait(expression) { for (let i = 0; i < 150; i++) { if (await evaluate(expression)) return; await delay(80); } throw new Error('Page wait failed: ' + expression + ' | ' + await evaluate('document.body.innerText.slice(-3000)')); }
async function click(selector) { await evaluate('document.querySelector(' + JSON.stringify(selector) + ').click()'); await delay(60); }
async function check(name, condition) { if(!condition) console.log('UI diagnostics', await evaluate(`JSON.stringify({doc:document.documentElement.scrollWidth,win:innerWidth,items:[...document.querySelectorAll('.app-layout,.main-content,.net-page,.net-panel,.net-rate-card')].map(e=>({name:e.className,client:e.clientWidth,scroll:e.scrollWidth,width:e.getBoundingClientRect().width,left:e.getBoundingClientRect().left,right:e.getBoundingClientRect().right}))})`)); assert.ok(condition, name); passed++; console.log('PASS ' + passed + ' ' + name); }
async function screenshot(name) { mkdirSync(join(root, 'build'), { recursive: true }); writeFileSync(join(root, 'build', name), Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64')); }
try {
    const portFile = join(profile, 'DevToolsActivePort');
    for (let i = 0; i < 100 && !existsSync(portFile); i++) { if (browserError) throw browserError; await delay(100); }
    assert.ok(existsSync(portFile));
    const port = Number(readFileSync(portFile, 'utf8').split(/\r?\n/)[0]);
    const tabs = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
    ws = new WebSocket(tabs.find(tab => tab.type === 'page').webSocketDebuggerUrl);
    ws.addEventListener('message', event => { const data = JSON.parse(event.data); if (data.id && pending.has(data.id)) { const item = pending.get(data.id); pending.delete(data.id); clearTimeout(item.timer); if (data.error) item.reject(new Error(JSON.stringify(data.error))); else item.resolve(data.result); } if (data.method === 'Runtime.exceptionThrown') errors.push(data.params.exceptionDetails); if (data.method === 'Network.requestWillBeSent' && !data.params.request.url.startsWith(base) && !data.params.request.url.startsWith('data:')) outside.push(data.params.request.url); });
    await new Promise(resolvePromise => ws.addEventListener('open', resolvePromise, { once: true }));
    await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
    await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
    // 受控加快一秒轮询，覆盖生命周期；生产代码的采样间隔保持不变。
    await send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__netHidden=false;Object.defineProperty(document,'hidden',{get:()=>window.__netHidden,configurable:true});const originalSetTimeout=window.setTimeout.bind(window);window.setTimeout=(fn,ms,...args)=>originalSetTimeout(fn,ms===1000?80:ms,...args);localStorage.setItem('tt-theme','light');` });
    await send('Page.navigate', { url: base + '/' }); await wait("[...document.querySelectorAll('.tool-name')].some(e=>e.textContent==='实时网速')");
    await check('首页提供实时网速入口', await evaluate("[...document.querySelectorAll('.tool-card')].find(e=>e.textContent.includes('实时网速')).textContent.includes('服务器电脑')"));
    await send('Page.navigate', { url: base + '/tools' }); await wait("[...document.querySelectorAll('.tool-name')].some(e=>e.textContent==='实时网速')");
    await check('工具箱卡片标明可用', await evaluate("[...document.querySelectorAll('.tool-card')].find(e=>e.textContent.includes('实时网速')).textContent.includes('可用')"));
    await evaluate("[...document.querySelectorAll('.tool-card')].find(e=>e.textContent.includes('实时网速')).querySelector('button').click()");
    await wait("document.querySelector('#net-chart')?.dataset.points>=3");
    await check('默认优先选择在线物理网卡', await evaluate("document.querySelector('#net-adapter').value==='ethernet'"));
    await check('上下行读数及字节/比特换算正确', await evaluate("document.querySelector('#net-download-rate').textContent.includes('1.00MB/s')&&document.querySelector('#net-upload-rate').textContent.includes('128.0KB/s')&&document.body.textContent.includes('8.39 Mbps')"));
    await check('趋势有两种方向的真实折线点', await evaluate("document.querySelector('.net-download-line').getAttribute('points').includes(' ')&&document.querySelector('.net-upload-line').getAttribute('points').includes(' ')"));
    await check('累计、平均及最后采样时间更新', await evaluate("document.querySelector('#net-download-average').textContent==='1.00 MB/s'&&!document.querySelector('#net-download-total').textContent.startsWith('0 B')&&!document.querySelector('#net-sampled-at').textContent.endsWith('—')"));
    await check('普通轮询没有重叠请求', maxActive === 1);
    await click('#net-pause'); const pausedCount = requestCount; await delay(400);
    await check('暂停停止轮询并保留读数', requestCount === pausedCount && await evaluate("document.querySelector('#net-status').textContent==='已暂停'&&document.querySelector('#net-download-rate').textContent.includes('1.00')"));
    await click('#net-clear'); await check('暂停时清空仅清本页记录', await evaluate("document.querySelector('#net-chart').dataset.points==='0'&&document.querySelector('#net-download-total').textContent==='0 B'&&document.querySelector('#net-download-rate').textContent==='—'"));
    await click('#net-pause'); await wait("document.querySelector('#net-chart')?.dataset.points>=2");
    await evaluate("document.querySelector('#net-adapter').value='vpn';document.querySelector('#net-adapter').dispatchEvent(new Event('change',{bubbles:true}))"); await wait("document.querySelector('#net-download-rate').textContent.includes('4.00KB/s') && document.querySelector('#net-download-average').textContent==='4.00 KB/s'");
    await check('切换网卡重建独立统计', await evaluate("document.querySelector('#net-download-average').textContent==='4.00 KB/s'&&document.querySelector('#net-status').textContent==='实时采样中'"));
    await evaluate("window.__netHidden=true;document.dispatchEvent(new Event('visibilitychange'))"); await delay(100); const hiddenCount = requestCount; await delay(350);
    await check('页面后台暂停轮询', requestCount === hiddenCount && await evaluate("document.querySelector('#net-status').textContent==='后台已暂停'"));
    await evaluate("window.__netHidden=false;document.dispatchEvent(new Event('visibilitychange'))"); await wait("document.querySelector('#net-status').textContent==='实时采样中'");
    await check('返回前台恢复采样', requestCount > hiddenCount);
    mode = 'http-error'; await wait("document.querySelector('#net-notice')?.textContent.includes('合成网络故障')");
    await check('请求失败时不冒充实时旧速度', await evaluate("document.querySelector('#net-download-rate').textContent==='—'&&document.querySelector('#net-status').textContent==='连接失败'"));
    const errorLineX = await evaluate("+document.querySelector('.net-download-line').getAttribute('points').split(' ').at(-1).split(',')[0]"); await delay(300);
    await check('错误空档中曲线按实际时间向左移动', await evaluate("+document.querySelector('.net-download-line').getAttribute('points').split(' ').at(-1).split(',')[0]") < errorLineX - 0.5);
    mode = 'live'; await click('#net-retry'); await wait("document.querySelector('#net-status').textContent==='实时采样中'");
    await check('错误后可重试恢复', await evaluate("!document.querySelector('#net-notice')"));
    mode = 'error'; await wait("document.querySelector('#net-status').textContent==='等待恢复'"); await check('采集失败也隐藏实时速度', await evaluate("document.querySelector('#net-download-rate').textContent==='—'"));
    mode = 'live'; await wait("document.querySelector('#net-status').textContent==='实时采样中'");
    await evaluate("document.querySelector('#net-adapter').value='ethernet';document.querySelector('#net-adapter').dispatchEvent(new Event('change',{bubbles:true}))"); await wait("document.querySelector('#net-download-rate').textContent.includes('1.00')");
    mode = 'removed'; await wait("document.querySelector('#net-status').textContent==='网卡已移除'"); await check('网卡移除提示重选，不自动混入其他网卡', await evaluate("document.querySelector('#net-adapter').value==='ethernet'&&document.querySelector('#net-download-rate').textContent==='—'"));
    mode = 'disconnected'; await wait("document.querySelector('#net-status').textContent==='网卡未连接'"); await check('离线网卡显示待连接而非零速', await evaluate("document.querySelector('#net-download-rate').textContent==='—'"));
    mode = 'live'; await wait("document.querySelector('#net-status').textContent==='实时采样中'");
    delayMs = 1000; for (let i=0;i<40 && active===0;i++) await delay(30); assert.ok(active > 0); await click('#net-pause'); await click('#net-clear'); await delay(1100); delayMs = 0;
    await check('取消在途请求，迟到结果不回填清空记录', aborts > 0 && await evaluate("document.querySelector('#net-chart').dataset.points==='0'&&document.querySelector('#net-status').textContent==='已暂停'"));
    await click('#net-pause'); await wait("document.querySelector('#net-chart')?.dataset.points>=3");
    for (const theme of ['light', 'dark']) {
        await evaluate("document.documentElement.dataset.theme=" + JSON.stringify(theme)); await delay(320);
        for (const width of [1280,1600]) {
            await send('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: false }); await delay(100);
            // 全局桌面布局最小内容宽 1280px，外加原有 padding；验证工具不增加额外溢出。
            await check(theme + ' ' + width + ' 桌面最小布局内工具没有横向溢出', await evaluate(`(()=>{const app=document.querySelector('.app-layout'),page=document.querySelector('.net-page'),main=document.querySelector('.main-content'),s=getComputedStyle(app),limit=Math.max(innerWidth,parseFloat(s.minWidth)+(s.boxSizing==='border-box'?0:parseFloat(s.paddingLeft)+parseFloat(s.paddingRight)));return document.documentElement.scrollWidth<=limit+1&&app.scrollWidth<=limit+1&&page.scrollWidth<=page.clientWidth+1&&[...document.querySelectorAll('.net-panel,.net-rate-card,.net-chart')].every(e=>{const r=e.getBoundingClientRect(),p=page.getBoundingClientRect(),m=main.getBoundingClientRect();return e.scrollWidth<=e.clientWidth+1&&r.left>=Math.max(p.left,m.left)-1&&r.right<=Math.min(p.right,m.right)+1})})()`));
        }
        const contrast = await evaluate(`(()=>{const s=getComputedStyle(document.querySelector('#net-adapter'));const lum=c=>{const rgb=c.match(/[0-9.]+/g).slice(0,3).map(n=>{const v=+n/255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4});return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722};const a=lum(s.color),b=lum(s.backgroundColor);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05)})()`);
        await check(theme + ' 下拉文字对比度达标', contrast >= 4.5);
        await screenshot('network-speed-' + theme + '.png');
    }
    await click('.net-help summary'); await check('说明明确服务器统计和非宽带测速', await evaluate("document.querySelector('.net-help').open&&document.querySelector('.net-help').textContent.includes('不是宽带测速')"));
    await click('.net-header a'); await wait("document.querySelector('.page-tools')"); const leftCount = requestCount; await delay(350);
    await check('离页停止轮询', requestCount === leftCount);
    mode = 'unsupported'; await send('Page.navigate', { url: base + '/tools/network-speed' }); await wait("document.querySelector('#net-status')?.textContent==='当前系统不支持'"); const unsupportedCount = requestCount; await delay(350);
    await check('不支持平台明确反馈并停止轮询', requestCount === unsupportedCount && await evaluate("document.querySelector('#net-download-rate').textContent==='—'"));
    await check('浏览器无未处理异常', errors.length === 0); await check('不访问外部站点或真实数据服务', outside.length === 0);
    console.log('RESULT ' + passed + ' network speed browser checks passed.');
} catch (error) { await screenshot('network-speed-failure.png').catch(()=>{}); throw error; }
finally {
    for (const timer of delayed) clearTimeout(timer);
    if (ws?.readyState === WebSocket.OPEN) await send('Browser.close').catch(()=>{});
    ws?.close(); for (const item of pending.values()) clearTimeout(item.timer);
    for(let i=0;i<30&&browser.exitCode===null;i++) await delay(100); if(browser.exitCode===null) browser.kill();
    server.closeAllConnections(); await new Promise(resolvePromise=>server.close(resolvePromise));
    rmSync(temporary,{recursive:true,force:true,maxRetries:8,retryDelay:150});
}
