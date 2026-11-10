// 隔离验收：只托管构建产物和空只读列表，不启动真实后端或读取团队数据。
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(new URL('../backend/package.json', import.meta.url));
const express = require('express');
const dist = join(root, 'frontend', 'dist');
assert.ok(existsSync(join(dist, 'index.html')), '先执行前端 npm run build');
const temporary = mkdtempSync(join(tmpdir(), 'tt-solar-ui-'));
assert.ok(resolve(temporary).startsWith(resolve(tmpdir()) + sep) && temporary.includes('tt-solar-ui-'));
const browserProfile = join(temporary, 'browser');
mkdirSync(browserProfile);
const app = express();
let failTextures = false, textureDelay = 0;
const requestedTextures = new Set();
app.use((req, res, next) => {
    if (!/\/(?:day|night|clouds)-[^/]+\.jpg$/.test(req.path)) return next();
    requestedTextures.add(req.path);
    if (failTextures) return res.status(503).end();
    if (!textureDelay) return next();
    const timeout = setTimeout(next, textureDelay);
    res.on('close', () => clearTimeout(timeout));
});
app.get('/api/documents/tree', (_req, res) => res.json({ items: [] }));
app.get('/api/documents', (_req, res) => res.json({ items: [], total: 0 }));
app.use('/api', (_req, res) => res.status(501).json({ message: '隔离验收不提供其他接口' }));
app.use(express.static(dist, { index: false }));
app.get('/{*path}', (_req, res) => res.sendFile(join(dist, 'index.html')));
const server = await new Promise(resolvePromise => { const s = app.listen(0, '127.0.0.1', () => resolvePromise(s)); });
const base = `http://127.0.0.1:${server.address().port}`;
const browserExe = [process.env.VERIFY_BROWSER, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].filter(Boolean).find(existsSync);
assert.ok(browserExe, '未找到浏览器');
const browser = spawn(browserExe, ['--headless=new', '--enable-unsafe-swiftshader', '--no-first-run', '--disable-extensions', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', `--user-data-dir=${browserProfile}`, '--window-size=1600,1000', 'about:blank'], { windowsHide: true, stdio: 'ignore' });
let browserError;
browser.on('error', error => { browserError = error; });
let ws, sequence = 0;
const pending = new Map(), errors = [], browserLogs = [], outsideRequests = [], checks = [];
const delay = ms => new Promise(resolvePromise => setTimeout(resolvePromise, ms));
function send(method, params = {}) {
    const id = ++sequence;
    return new Promise((resolvePromise, reject) => {
        const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`CDP 超时：${method}`)); }, 10000);
        pending.set(id, { resolve: resolvePromise, reject, timeout });
        ws.send(JSON.stringify({ id, method, params }));
    });
}
async function evaluate(expression) {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result?.value;
}
async function wait(expression) {
    for (let i = 0; i < 150; i++) { if (await evaluate(expression)) return; await delay(100); }
    console.log('页面诊断', await evaluate("({mode:document.querySelector('.solar-globe-viewport')?.dataset.mode, notice:document.querySelector('.solar-fallback-note')?.textContent, contexts:window.__solarContexts?.length})"));
    console.log('浏览器日志', JSON.stringify(browserLogs));
    console.log('浏览器异常', JSON.stringify(errors));
    mkdirSync(join(root, 'build'), { recursive: true }); await screenshot('earth-sunlight-failure.png');
    throw new Error(`页面等待超时：${expression}`);
}
async function click(selector) { await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`); await delay(120); }
function check(name, condition) { checks.push({ name, pass: !!condition }); console.log(`${condition ? 'PASS' : 'FAIL'} ${name}`); assert.ok(condition, name); }
async function screenshot(name) { writeFileSync(join(root, 'build', name), Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64')); }

try {
    const portFile = join(browserProfile, 'DevToolsActivePort');
    for (let i = 0; i < 100 && !existsSync(portFile); i++) { if (browserError) throw browserError; await delay(100); }
    assert.ok(existsSync(portFile), '浏览器调试端口未就绪');
    const port = Number(readFileSync(portFile, 'utf8').split(/\r?\n/)[0]);
    const tabs = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    ws = new WebSocket(tabs.find(tab => tab.type === 'page').webSocketDebuggerUrl);
    ws.addEventListener('message', event => {
        const message = JSON.parse(event.data);
        if (message.id && pending.has(message.id)) {
            const item = pending.get(message.id); pending.delete(message.id); clearTimeout(item.timeout);
            if (message.error) item.reject(new Error(JSON.stringify(message.error))); else item.resolve(message.result);
        }
        if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails);
        if (message.method === 'Runtime.consoleAPICalled') browserLogs.push(message.params.args.map(arg=>arg.value ?? arg.description).join(' '));
        if (message.method === 'Network.requestWillBeSent' && !message.params.request.url.startsWith(base) && !message.params.request.url.startsWith('data:')) outsideRequests.push(message.params.request.url);
    });
    await new Promise(resolvePromise => ws.addEventListener('open', resolvePromise, { once: true }));
    await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
    await send('Network.setCacheDisabled', { cacheDisabled: true });
    await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
    await send('Page.addScriptToEvaluateOnNewDocument', { source: `
        window.__testHidden = false;
        Object.defineProperty(document, 'hidden', { get: () => window.__testHidden, configurable: true });
        const ActualDate = Date;
        window.__clockOffset = 0;
        window.Date = class extends ActualDate { constructor(...args) { super(...(args.length ? args : [ActualDate.now() + window.__clockOffset])); } static now() { return ActualDate.now() + window.__clockOffset; } };
        const nativeSetInterval = window.setInterval.bind(window), nativeClearInterval = window.clearInterval.bind(window);
        window.__solarTimers = new Map();
        window.setInterval = (callback, milliseconds, ...args) => { const id = nativeSetInterval(callback, milliseconds, ...args); if (milliseconds === 30000) window.__solarTimers.set(id, callback); return id; };
        window.clearInterval = id => { window.__solarTimers.delete(id); nativeClearInterval(id); };
        const nativeRaf = window.requestAnimationFrame.bind(window), nativeCancel = window.cancelAnimationFrame.bind(window);
        window.__solarFrames = new Set();
        window.requestAnimationFrame = callback => { const id = nativeRaf(time => { window.__solarFrames.delete(id); callback(time); }); window.__solarFrames.add(id); return id; };
        window.cancelAnimationFrame = id => { window.__solarFrames.delete(id); nativeCancel(id); };
        const nativeContext = HTMLCanvasElement.prototype.getContext;
        window.__solarContexts = []; window.__noWebGL = false;
        HTMLCanvasElement.prototype.getContext = function(kind, ...args) {
            if (kind === 'webgl2' && window.__noWebGL) return null;
            const context = nativeContext.call(this, kind, ...args);
            if (kind === 'webgl2' && context && !window.__solarContexts.includes(context)) window.__solarContexts.push(context);
            return context;
        };
        const nativeBitmap = window.createImageBitmap.bind(window);
        window.__solarBitmaps = new Set();
        window.createImageBitmap = async (...args) => { const bitmap = await nativeBitmap(...args), close = bitmap.close.bind(bitmap); window.__solarBitmaps.add(bitmap); bitmap.close = () => { window.__solarBitmaps.delete(bitmap); close(); }; return bitmap; };
        localStorage.setItem('tt-theme', 'light');
    ` });
    await send('Page.navigate', { url: `${base}/tools` });
    await wait("[...document.querySelectorAll('.tool-name')].some(e => e.textContent==='地球光照')");
    check('工具箱展示可用的地球光照入口', await evaluate("[...document.querySelectorAll('.tool-card')].find(e=>e.textContent.includes('地球光照')).textContent.includes('可用')"));
    await evaluate("[...document.querySelectorAll('.tool-card')].find(e=>e.textContent.includes('地球光照')).querySelector('button').click()");
    await wait("document.querySelector('.solar-globe-viewport')?.dataset.mode==='webgl'");
    check('卡片进入独立地球光照页面', await evaluate("location.pathname==='/tools/earth-sunlight' && !!document.querySelector('#solar-utc-time')"));
    await delay(250);
    check('WebGL 球面绘制出纹理及明暗像素', await evaluate("{const c=document.querySelector('.solar-webgl canvas'),g=c.getContext('webgl2'),d=new Uint8Array(c.width*c.height*4);g.readPixels(0,0,c.width,c.height,g.RGBA,g.UNSIGNED_BYTE,d);const tones=new Set();for(let i=0;i<d.length;i+=16)if(d[i+3]>200)tones.add(d[i]+','+d[i+1]+','+d[i+2]);tones.size>500;}"));
    check('三张贴图随本地构建加载', requestedTextures.size === 3);
    await wait("document.querySelectorAll('.solar-map-label[data-latitude]').length===3");
    check('赤道和南北回归线标出正确的中文与纬度', await evaluate("[...document.querySelectorAll('.solar-map-label[data-latitude]')].map(e=>e.textContent).join('|')==='北回归线23.44°N|赤道0°|南回归线23.44°S' && [...document.querySelectorAll('.solar-map-label[data-latitude]')].every(e=>e.dataset.visible==='true')"));
    check('球面上实际绘制了青色赤道与紫色回归线', await evaluate("{const c=document.querySelector('.solar-webgl canvas'),g=c.getContext('webgl2'),d=new Uint8Array(c.width*c.height*4);g.readPixels(0,0,c.width,c.height,g.RGBA,g.UNSIGNED_BYTE,d);let cyan=0,purple=0;for(let i=0;i<d.length;i+=4){const [r,v,b]=d.slice(i,i+3);if(v>135&&b>135&&r<v*.82&&Math.abs(v-b)<45)cyan++;if(r>125&&b>155&&v<r*.96&&b>r*1.05)purple++;}cyan>150&&purple>150;}"));
    check('太阳具备可见标注且说明包含日冕示意', await evaluate("document.querySelector('.solar-label-sun')?.dataset.visible==='true' && document.querySelector('.solar-explanation').textContent.includes('日冕')"));
    check('素材来源和静态云层/灯光说明可见', await evaluate("document.querySelector('.solar-credits').textContent.includes('Solar System Scope') && document.querySelector('.solar-explanation').textContent.includes('静态示意')"));
    check('直射点包含经纬度和当前时间', await evaluate("/[NS].*[EW]/.test(document.querySelector('.solar-coordinate').textContent) && Date.now()-Date.parse(document.querySelector('#solar-utc-time').dataset.updatedAt)<5000"));
    const longitude = await evaluate("document.querySelector('.solar-globe').dataset.viewLongitude");
    const imageBefore = await evaluate("document.querySelector('.solar-webgl canvas').toDataURL()");
    await click('#solar-rotate-right');
    check('旋转按钮改变视角与地球画面', await evaluate(`document.querySelector('.solar-globe').dataset.viewLongitude!==${JSON.stringify(longitude)} && document.querySelector('.solar-webgl canvas').toDataURL()!==${JSON.stringify(imageBefore)}`));
    await click('#solar-reset');
    check('复位回到光照视角', await evaluate(`Math.abs(Number(document.querySelector('.solar-globe').dataset.viewLongitude)-Number(${JSON.stringify(longitude)}))<0.1`));
    await click('#solar-zoom-in');
    check('放大按钮拉近三维地球', await evaluate("Number(document.querySelector('.solar-globe').dataset.altitude)<2.25"));
    await click('#solar-reset');
    check('复位同时恢复缩放', await evaluate("document.querySelector('.solar-globe').dataset.altitude==='2.25'"));
    const zoomBox = await evaluate("{const r=document.querySelector('.solar-webgl').getBoundingClientRect();({x:r.x+r.width/2,y:r.y+r.height/2});}");
    await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: zoomBox.x, y: zoomBox.y, deltaX: 0, deltaY: -120 }); await delay(180);
    check('真实滚轮可以拉近地球', await evaluate("Number(document.querySelector('.solar-globe').dataset.altitude)<2.25"));
    for (let i=0;i<5;i++) await click('#solar-zoom-in');
    check('放大有边界且按钮显示禁用', await evaluate("document.querySelector('#solar-zoom-in').disabled && Number(document.querySelector('.solar-globe').dataset.altitude)>=1.35"));
    await click('#solar-reset');
    const box = await evaluate("{const r=document.querySelector('.solar-globe').getBoundingClientRect();({x:r.x+r.width/2,y:r.y+r.height/2});}");
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x + 95, y: box.y + 35, button: 'left', buttons: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x + 95, y: box.y + 35, button: 'left', clickCount: 1 });
    await delay(150);
    check('鼠标拖动可以旋转经纬方向', await evaluate(`document.querySelector('.solar-globe').dataset.viewLongitude!==${JSON.stringify(longitude)} && document.querySelector('.solar-globe').dataset.viewLatitude!=='15.00'`));
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Home', code: 'Home' });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Home', code: 'Home' });
    await delay(100);
    check('键盘 Home 复位', await evaluate("document.querySelector('.solar-globe').dataset.viewLatitude==='15.00'"));
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowLeft', code: 'ArrowLeft' });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowLeft', code: 'ArrowLeft' });
    await delay(100);
    check('键盘方向键旋转', await evaluate(`document.querySelector('.solar-globe').dataset.viewLongitude!==${JSON.stringify(longitude)}`));
    const equatorTop = await evaluate("document.querySelector('[data-guide=equator]').style.top");
    for (let i=0;i<6;i++) {
        await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowUp', code: 'ArrowUp' });
        await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowUp', code: 'ArrowUp' });
        await delay(40);
    }
    check('纬线标注随纬度旋转并隐藏被地球挡住的南回归线', await evaluate(`document.querySelector('[data-guide=equator]').style.top!==${JSON.stringify(equatorTop)} && document.querySelector('[data-guide=tropic-south]').dataset.visible==='false' && getComputedStyle(document.querySelector('[data-guide=tropic-south]')).display==='none'`));
    await click('#solar-reset');
    check('复位后三条纬线标注重新可见', await evaluate("[...document.querySelectorAll('.solar-map-label[data-latitude]')].every(e=>e.dataset.visible==='true')"));
    await evaluate("document.querySelector('.solar-webgl').focus()");
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: '+', code: 'Equal' });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: '+', code: 'Equal' });
    await delay(150);
    check('键盘加号可以缩放', await evaluate("Number(document.querySelector('.solar-globe').dataset.altitude)<2.25"));
    await click('#solar-reset');
    const solarLongitude = await evaluate("Number(document.querySelector('.solar-globe').dataset.solarLongitude)");
    assert.ok(Number.isFinite(solarLongitude), '太阳经度必须是有限数值');
    await evaluate("window.__clockOffset=3600000"); await click('#solar-refresh');
    check('手动刷新更新时钟及太阳经度', await evaluate(`Math.abs(Date.now()-Date.parse(document.querySelector('#solar-utc-time').dataset.updatedAt))<3000 && Math.abs(((Number(document.querySelector('.solar-globe').dataset.solarLongitude)-(${solarLongitude})+540)%360)-180+15)<0.1`));
    const updated = await evaluate("document.querySelector('#solar-utc-time').dataset.updatedAt");
    await evaluate("window.__clockOffset+=30000; [...window.__solarTimers.values()].forEach(callback=>callback())"); await delay(150);
    check('30 秒定时回调刷新真实数据', await evaluate(`document.querySelector('#solar-utc-time').dataset.updatedAt!==${JSON.stringify(updated)}`));
    await evaluate("window.__testHidden=true; document.dispatchEvent(new Event('visibilitychange'))");
    check('后台暂停刷新', await evaluate("window.__solarTimers.size===0"));
    await delay(150);
    check('后台没有地球渲染动画', await evaluate("window.__solarFrames.size===0"));
    await evaluate("window.__clockOffset+=60000; window.__testHidden=false; document.dispatchEvent(new Event('visibilitychange'))"); await delay(150);
    check('回到页面立即刷新且只保留一个定时器', await evaluate("window.__solarTimers.size===1 && Math.abs(Date.now()-Date.parse(document.querySelector('#solar-utc-time').dataset.updatedAt))<3000"));
    for (let i=0;i<6;i++) await click('#solar-rotate-right');
    check('背面的直射点明确提示', await evaluate("document.querySelector('.solar-caption').textContent.includes('背面')"));
    check('太阳在背面时不会透过地球显示标注', await evaluate("document.querySelector('[data-guide=sun]').dataset.visible==='false' && getComputedStyle(document.querySelector('[data-guide=sun]')).display==='none'"));
    await click('#solar-reset');
    mkdirSync(join(root, 'build'), { recursive: true });
    for (const theme of ['light', 'dark']) {
        await evaluate(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`); await delay(350);
        check(`${theme} 主题无绘制错误`, await evaluate("!document.querySelector('.solar-page .notice-error')"));
        for (const width of [1280, 1440, 1920]) {
            await send('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: false }); await delay(150);
            check(`${theme} ${width}px 没有内容横向溢出`, await evaluate("{const page=document.querySelector('.solar-page'),info=document.querySelector('.solar-info'),canvas=document.querySelector('.solar-globe');page.scrollWidth<=page.clientWidth+1 && info.scrollWidth<=info.clientWidth+1 && canvas.getBoundingClientRect().right<=page.getBoundingClientRect().right;}"));
            check(`${theme} ${width}px 调整尺寸后球面仍有画面`, await evaluate("{const c=document.querySelector('.solar-webgl canvas'),g=c.getContext('webgl2'),d=new Uint8Array(4);g.readPixels(Math.floor(c.width/2),Math.floor(c.height/2),1,1,g.RGBA,g.UNSIGNED_BYTE,d);d[3]===255;}"));
            check(`${theme} ${width}px 太阳与纬线标注在画布内`, await evaluate("{const stage=document.querySelector('.solar-globe-viewport').getBoundingClientRect();[...document.querySelectorAll('.solar-map-label')].filter(e=>e.dataset.visible==='true').every(e=>{const r=e.getBoundingClientRect();return r.left>=stage.left&&r.right<=stage.right&&r.top>=stage.top&&r.bottom<=stage.bottom;});}"));
        }
        await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false }); await delay(150);
        await screenshot(`earth-sunlight-${theme}.png`);
    }
    await click('.solar-back'); await wait("location.pathname==='/tools'");
    check('离页回收刷新定时器', await evaluate("window.__solarTimers.size===0"));
    await delay(250);
    check('离页释放 WebGL 上下文、位图及绘制帧', await evaluate("window.__solarContexts.every(g=>g.isContextLost()) && window.__solarBitmaps.size===0 && window.__solarFrames.size===0"));
    await evaluate("document.querySelector('.nav-item[href=\"/\"]').click()"); await wait("!!document.querySelector('.page-home')");
    check('首页也展示地球光照卡片', await evaluate("[...document.querySelectorAll('.tool-name')].some(e=>e.textContent==='地球光照')"));
    // 在同一页面中演练失败、重试与离页，仍不接触真实后端。
    failTextures = true;
    await evaluate("[...document.querySelectorAll('.tool-card')].find(e=>e.textContent.includes('地球光照')).querySelector('button').click()");
    await wait("document.querySelector('.solar-globe-viewport')?.dataset.mode==='fallback'");
    check('贴图失败降级到原本的可旋转示意', await evaluate("!!document.querySelector('canvas.solar-globe') && document.querySelector('.solar-fallback-note').textContent.includes('已切换')"));
    check('降级画面仍绘制赤道、回归线且保留图例', await evaluate("{const c=document.querySelector('canvas.solar-globe'),d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let cyan=0,purple=0;for(let i=0;i<d.length;i+=4){const r=d[i],g=d[i+1],b=d[i+2];if(g>145&&b>145&&r<g*.8&&Math.abs(g-b)<45)cyan++;if(r>140&&b>175&&g<r*.96&&b>r*1.05)purple++;}cyan>100&&purple>100&&document.querySelector('.solar-reference-legend').textContent.includes('23.44°N');}"));
    await screenshot('earth-sunlight-fallback.png');
    const fallbackLongitude = await evaluate("document.querySelector('canvas.solar-globe').dataset.viewLongitude");
    await click('#solar-rotate-right');
    check('降级后仍能旋转并读取太阳坐标', await evaluate(`document.querySelector('canvas.solar-globe').dataset.viewLongitude!==${JSON.stringify(fallbackLongitude)} && /[NS].*[EW]/.test(document.querySelector('.solar-coordinate').textContent)`));
    failTextures = false;
    await click('#solar-retry');
    await wait("document.querySelector('.solar-globe-viewport')?.dataset.mode==='webgl'");
    await delay(200);
    check('重试恢复三维并只保留一个上下文和三张位图', await evaluate("window.__solarContexts.filter(g=>!g.isContextLost()).length===1 && window.__solarBitmaps.size===3 && !document.querySelector('.solar-fallback-note')"));
    await evaluate("document.querySelector('.solar-webgl canvas').getContext('webgl2').getExtension('WEBGL_lose_context').loseContext()");
    await wait("document.querySelector('.solar-globe-viewport')?.dataset.mode==='fallback'");
    check('三维上下文中断后明确提示并降级', await evaluate("document.querySelector('.solar-fallback-note').textContent.includes('中断')"));
    await evaluate("window.__noWebGL=true");
    await click('#solar-retry');
    await wait("document.querySelector('.solar-globe-viewport')?.dataset.mode==='fallback'");
    check('WebGL 不可用时保留示意和重试入口', await evaluate("document.querySelector('.solar-fallback-note').textContent.includes('未能启用') && !!document.querySelector('#solar-retry')"));
    await evaluate("window.__noWebGL=false");
    await click('#solar-retry');
    await wait("document.querySelector('.solar-globe-viewport')?.dataset.mode==='webgl'");
    await delay(250);
    check('静置时无需常驻动画帧', await evaluate("window.__solarFrames.size===0"));
    await click('.solar-back'); await wait("location.pathname==='/tools'");
    textureDelay = 1500;
    await evaluate("[...document.querySelectorAll('.tool-card')].find(e=>e.textContent.includes('地球光照')).querySelector('button').click()");
    await wait("document.querySelector('.solar-globe-viewport')?.dataset.mode==='loading' && window.__solarContexts.some(g=>!g.isContextLost())");
    await click('.solar-back'); await wait("location.pathname==='/tools'");
    await delay(1700);
    check('贴图加载中离页可取消并释放，迟到结果不回填', await evaluate("window.__solarContexts.every(g=>g.isContextLost()) && window.__solarBitmaps.size===0 && window.__solarFrames.size===0 && !document.querySelector('.solar-globe-viewport')"));
    check('未请求外部地图或其他网络服务', outsideRequests.length === 0);
    check('浏览器运行错误为零', errors.length === 0);
    console.log(`地球光照浏览器验收：${checks.length}/${checks.length} 通过`);
} finally {
    if (ws?.readyState === WebSocket.OPEN) { try { await send('Browser.close'); } catch { /* 关闭连接可能先于响应 */ } ws.close(); }
    if (browser.exitCode === null) browser.kill();
    for (const item of pending.values()) { clearTimeout(item.timeout); item.reject(new Error('验收结束')); } pending.clear();
    server.closeAllConnections(); await new Promise(resolvePromise => server.close(resolvePromise));
    for (let i=0;i<20;i++) { try { rmSync(temporary, { recursive: true, force: true }); break; } catch { await delay(150); } }
}
