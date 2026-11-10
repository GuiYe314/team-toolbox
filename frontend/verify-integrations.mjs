// TASK-034 隔离真实浏览器验收：临时设置/组件/媒体、模拟本机 FreeLLMAPI，绝不接触团队数据库。
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createIntegrationServices, registerIntegrationApi } from '../backend/src/integration-api.js';
import { createIntegrationConfig, executablePath, problem } from '../backend/src/integration-common.js';
import { createToolAccess } from '../backend/src/tool-access.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const lan = process.env.TT_VERIFY_LAN === '1', access = createToolAccess({ allowLan: lan });
const pageHost = lan ? access.addresses()[0] : '127.0.0.1';
assert.ok(pageHost, '局域网验收需要实际私网 IPv4 网卡');
const require = createRequire(new URL('../backend/package.json', import.meta.url));
const express = require('express');
const temporary = await mkdtemp(join(tmpdir(), 'tt-integrations-ui-'));
assert.ok(resolve(temporary).startsWith(resolve(tmpdir()) + sep) && temporary.includes('tt-integrations-ui-'));
const dist = join(root, 'frontend', 'dist'); assert.ok(existsSync(join(dist, 'index.html')), '先执行 npm run build');
const browserProfile = join(temporary, 'browser'); await mkdir(browserProfile);
const componentDir = join(temporary, 'components'); await mkdir(componentDir);
const paths = { ytDlp: join(componentDir, 'yt-dlp.exe'), ffmpeg: join(componentDir, 'ffmpeg.exe'), artcraft: join(componentDir, 'ArtCraft.exe') };
for (const path of Object.values(paths)) await writeFile(path, 'isolated test component, never executed');
const settingsFile = join(temporary, 'open-source-tools.json');
const config = createIntegrationConfig(settingsFile);
const state = { videoMode: 'success', videosCancelled: 0, videoActive: false, freeMode: 'success', freeCancelled: 0, chatRequests: [], launchRequests: [], apiLogs: [] };
const delay = ms => new Promise(resolvePromise => setTimeout(resolvePromise, ms));
const gateway = express(); gateway.use(express.json());
const testKey = 'freellmapi-isolated-ui-key';
gateway.use((req, res, next) => req.get('authorization') === 'Bearer ' + testKey ? next() : res.status(401).json({ error: 'invalid_key' }));
gateway.get('/v1/models', (_req, res) => state.freeMode === 'model-error' ? res.status(429).json({ error: 'rate_limited' }) : res.json({ data: [{ id: 'text-test', execution_status: 'ready' }, { id: 'auto', execution_status: 'ready' }, { id: 'disabled', execution_status: 'needsKey' }] }));
gateway.post('/v1/chat/completions', async (req, res) => {
    state.chatRequests.push(req.body);
    if (state.freeMode === 'request-error') return res.status(429).json({ error: 'rate_limited' });
    res.type('text/event-stream'); let completed = false, closed = false;
    res.on('close', () => { closed = true; if (!completed) state.freeCancelled++; });
    const pieces = state.freeMode === 'slow' ? Array(100).fill('等待片段。') : ['这是', '隔离测试', '的回答。', '<script>window.__injected=1</script>'];
    for (const text of pieces) {
        if (closed) return;
        res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: text } }] }) + '\n\n');
        await delay(state.freeMode === 'slow' ? 100 : 35);
    }
    if (closed) return;
    if (state.freeMode === 'incomplete') { completed = true; res.end(); return; }
    res.write('data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { total_tokens: 10 } }) + '\n\n');
    res.write('data: [DONE]\n\n'); completed = true; res.end();
});
const listen = (app, host = '127.0.0.1') => new Promise(resolvePromise => { const server = app.listen(0, host, () => resolvePromise(server)); });
const gatewayServer = await listen(gateway);
const gatewayBase = `http://127.0.0.1:${gatewayServer.address().port}/v1`;
const service = createIntegrationServices({ config,
    yoinksOptions: { temporaryRoot: temporary, detector: async (kind, path) => path ? executablePath(path, kind) : '', runner: async (file, args, options) => {
        if (args.includes('--version')) return { code: 0, stdout: '2026.10.22\n' };
        if (args.includes('-version')) return { code: 0, stdout: 'ffmpeg version isolated-test\n' };
        if (args.includes('--dump-single-json')) return { code: 0, stdout: JSON.stringify({ title: '隔离验收视频', uploader: '合成测试', duration: 60, formats: [{ vcodec: 'avc1', acodec: 'aac', height: 720 }] }) };
        state.videoActive = true;
        try {
            for (let i = 1; i <= (state.videoMode === 'slow' ? 100 : 5); i++) {
                if (options.signal.aborted) { state.videosCancelled++; throw problem('cancelled', '已取消', 499); }
                options.onLine(`TOOLBOX_PROGRESS|${i * 20}|100|20|1`); await delay(80);
            }
            if (state.videoMode === 'error') return { code: 1, stderr: 'isolated failure' };
            const output = args[args.indexOf('-o') + 1].replace('%(ext)s', args.includes('mp3') ? 'mp3' : 'mp4');
            await writeFile(output, Buffer.alloc(256, 1)); options.onLine('TOOLBOX_FILE|' + output);
            return { code: 0 };
        } finally { state.videoActive = false; }
    } },
    artcraftOptions: { launcher: async file => state.launchRequests.push(file) }
});
const app = express(); app.use(access.middleware); app.use(express.json()); registerIntegrationApi(app, { service, access, log: entry => state.apiLogs.push(entry) });
app.get('/api/documents/tree', (_req, res) => res.json({ items: [] }));
app.get('/api/documents', (_req, res) => res.json({ items: [], total: 0 }));
app.use('/api', (_req, res) => res.status(501).json({ message: '隔离验收不提供其他接口' }));
app.use(express.static(dist, { index: false })); app.get('/{*path}', (_req, res) => res.sendFile(join(dist, 'index.html')));
const server = await listen(app, lan ? '0.0.0.0' : '127.0.0.1'), base = `http://${pageHost}:${server.address().port}`;
const browserExe = [process.env.VERIFY_BROWSER, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].filter(Boolean).find(existsSync); assert.ok(browserExe, '未找到浏览器');
const browser = spawn(browserExe, ['--headless=new', '--no-first-run', '--disable-extensions', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', `--user-data-dir=${browserProfile}`, '--window-size=1600,1000', 'about:blank'], { windowsHide: true, stdio: 'ignore' });
let browserError; browser.on('error', error => { browserError = error; });
let ws, sequence = 0;
const pending = new Map(), errors = [], outsideRequests = [], checks = [];
function send(method, params = {}) {
    const id = ++sequence;
    return new Promise((resolvePromise, reject) => {
        const timeout = setTimeout(() => { pending.delete(id); reject(new Error('CDP 超时：' + method)); }, 10000);
        pending.set(id, { resolve: resolvePromise, reject, timeout }); ws.send(JSON.stringify({ id, method, params }));
    });
}
async function evaluate(expression) {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails)); return result.result?.value;
}
async function wait(expression) {
    for (let index = 0; index < 120; index++) { if (await evaluate(expression)) return; await delay(100); }
    console.log('页面诊断', await evaluate("({path:location.pathname,text:document.querySelector('.ext-page')?.innerText})"));
    await screenshot('integrations-failure.png'); throw new Error('页面等待超时：' + expression);
}
const selector = name => `[data-test="${name}"]`;
async function click(name) { await evaluate(`(()=>{const element=document.querySelector(${JSON.stringify(selector(name))});element.focus();element.click();})()`); await delay(60); }
async function input(name, value) { await evaluate(`(()=>{const element=document.querySelector(${JSON.stringify(selector(name))});element.value=${JSON.stringify(value)};element.dispatchEvent(new Event('input',{bubbles:true}));element.dispatchEvent(new Event('change',{bubbles:true}));})()`); }
async function navigate(path) { await send('Page.navigate', { url: base + path }); await wait(`location.pathname===${JSON.stringify(path)} && !!document.querySelector('.view-page')`); await delay(100); }
function check(name, value) { checks.push({ name, pass: !!value }); console.log(`${value ? 'PASS' : 'FAIL'} ${name}`); assert.ok(value, name); }
async function screenshot(name) { await mkdir(join(root, 'build'), { recursive: true }); await writeFile(join(root, 'build', name), Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64')); }
async function backToTools() { await evaluate("document.querySelector('.ext-back').click()"); await wait("location.pathname==='/tools'"); }
async function tool(name) { await evaluate(`Array.from(document.querySelectorAll('.tool-card')).find(card=>card.textContent.includes(${JSON.stringify(name)})).querySelector('button').click()`); await delay(120); }
async function waitForVideoStart() { for (let index = 0; index < 30 && !state.videoActive; index++) await delay(50); assert.ok(state.videoActive, '测试下载组件应已开始'); }
async function waitForVideoCleanup() { for (let index = 0; index < 30; index++) { if (!state.videoActive && !(await readdir(temporary)).some(name => name.startsWith('toolbox-yoinks-'))) return; await delay(50); } }

try {
    const portFile = join(browserProfile, 'DevToolsActivePort');
    for (let index = 0; index < 100 && !existsSync(portFile); index++) { if (browserError) throw browserError; await delay(100); }
    assert.ok(existsSync(portFile), '浏览器调试端口未就绪');
    const port = Number((await readFile(portFile, 'utf8')).split(/\r?\n/)[0]);
    const tabs = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    ws = new WebSocket(tabs.find(tab => tab.type === 'page').webSocketDebuggerUrl);
    ws.addEventListener('message', event => {
        const message = JSON.parse(event.data);
        if (message.id && pending.has(message.id)) { const item = pending.get(message.id); pending.delete(message.id); clearTimeout(item.timeout); message.error ? item.reject(new Error(JSON.stringify(message.error))) : item.resolve(message.result); }
        if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails);
        if (message.method === 'Network.requestWillBeSent' && !message.params.request.url.startsWith(base) && !message.params.request.url.startsWith('data:')) outsideRequests.push(message.params.request.url);
    });
    await new Promise(resolvePromise => ws.addEventListener('open', resolvePromise, { once: true }));
    await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
    await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: join(temporary, 'browser-downloads') });
    await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
    await send('Page.addScriptToEvaluateOnNewDocument', { source: lan
        ? "const original=document.execCommand;document.execCommand=function(command,...args){const result=original.call(this,command,...args);if(command==='copy' && result)window.__copied=document.activeElement?.value;return result;};"
        : "Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>{window.__copied=text}},configurable:true});" });
    await navigate('/');
    check('首页存在三项集成工具', await evaluate("['Yoinks','FreeLLMAPI','ArtCraft'].every(text=>Array.from(document.querySelectorAll('.tool-card')).some(card=>card.textContent.includes(text)))"));
    await navigate('/tools'); check('工具箱存在三项可进入卡片', await evaluate("document.querySelectorAll('.tool-card').length>=9"));
    await tool('Yoinks'); await wait("location.pathname==='/tools/yoinks'");
    check('未配置组件时提示真实未就绪', await evaluate("document.querySelector('.ext-badge').textContent.includes('未就绪') && document.querySelector('[data-test=video-analyze]').disabled"));
    await click('video-settings');
    check('设置弹窗 Teleport 到 body 且获得焦点', await evaluate("document.querySelector('.ext-overlay').parentElement===document.body && document.activeElement.getAttribute('role')==='dialog'"));
    check('设置弹窗居中并在视口内', await evaluate("(()=>{const r=document.querySelector('.ext-dialog').getBoundingClientRect();return Math.abs((r.left+r.right)/2-innerWidth/2)<3 && r.top>=0 && r.bottom<=innerHeight})()"));
    await input('video-ytdlp', paths.ytDlp); await input('video-ffmpeg', paths.ffmpeg); await click('video-settings-save'); await wait("!document.querySelector('.ext-overlay')");
    check('组件检测成功后解除分析按钮依赖限制', await evaluate("document.querySelector('.ext-badge').textContent.includes('已找到')"));
    await input('video-url', 'https://example.com/watch?v=isolated'); await click('video-analyze'); await wait("!!document.querySelector('[data-test=video-info]')");
    check('视频分析提供清晰度与 MP3', await evaluate("document.querySelector('[data-test=video-info]').textContent.includes('隔离验收视频') && document.querySelector('[data-test=video-choice]').options.length===2"));
    await input('video-choice', 'audio-mp3'); await click('video-download'); await wait("!!document.querySelector('[data-test=video-progress]')");
    check('下载中显示当前媒体流而非伪造总进度', await evaluate("document.querySelector('[data-test=video-progress]').textContent.includes('不能代表')"));
    await wait("!!document.querySelector('[data-test=video-result]')");
    check('完成结果提供 MP3 与明确保存链接', await evaluate("document.querySelector('[data-test=video-result]').textContent.includes('.mp3') && document.querySelector('[data-test=video-save]').getAttribute('href').startsWith('/api/integrations/yoinks/results/')"));
    await click('video-save');
    for (let index = 0; index < 50 && !existsSync(join(temporary, 'browser-downloads', '隔离验收视频.mp3')); index++) await delay(100);
    check('浏览器可领取真实生成的测试文件', existsSync(join(temporary, 'browser-downloads', '隔离验收视频.mp3')));
    await click('video-remove'); await wait("!document.querySelector('[data-test=video-result]')");
    state.videoMode = 'error'; await click('video-download'); await wait("document.querySelector('.ext-notice.is-error')?.textContent.includes('失败')");
    check('下载失败明确反馈并释放临时文件', !(await readdir(temporary)).some(name => name.startsWith('toolbox-yoinks-')));
    state.videoMode = 'slow'; await click('video-download'); await wait("!!document.querySelector('[data-test=video-progress]')"); await waitForVideoStart(); await click('video-stop'); await wait("!document.querySelector('[data-test=video-stop]')");
    await waitForVideoCleanup();
    check('取消下载传到组件并释放文件', state.videosCancelled >= 1 && !state.videoActive && !(await readdir(temporary)).some(name => name.startsWith('toolbox-yoinks-')));
    await click('video-download'); await wait("!!document.querySelector('[data-test=video-progress]')"); await waitForVideoStart(); await backToTools();
    await waitForVideoCleanup();
    check('离开下载页终止在途任务', state.videosCancelled >= 2 && !state.videoActive);
    state.videoMode = 'success';
    await tool('FreeLLMAPI'); await wait("location.pathname==='/tools/freellmapi'");
    check('首次进入无虚构模型且需要 Key', await evaluate("document.querySelector('[data-test=free-model]').options.length===1 && document.querySelector('[data-test=free-refresh]').disabled"));
    if (lan) {
        await wait("!!document.querySelector('[data-test=free-dashboard-remote]')");
        check('远程页面隐藏回环管理链接并说明服务器位置', await evaluate("!document.querySelector('[data-test=free-dashboard]') && document.querySelector('[data-test=free-dashboard-remote]')?.textContent.includes('服务器电脑')"));
    }
    await click('free-settings'); await input('free-base', gatewayBase); await input('free-key', testKey); await click('free-settings-save'); await wait("!document.querySelector('.ext-overlay')");
    check('Key 没有落盘', !(await readFile(settingsFile, 'utf8')).includes(testKey));
    await click('free-refresh'); await wait("document.querySelector('[data-test=free-model]').options.length===3");
    check('实际 HTTP 模型列表过滤不可用模型', await evaluate("document.querySelector('[data-test=free-model]').textContent.includes('text-test') && !document.querySelector('[data-test=free-model]').textContent.includes('disabled')"));
    await input('free-prompt', '第一次测试'); await click('free-send'); await wait("document.querySelector('[data-test=free-answer]')?.textContent.includes('隔离测试') && !document.querySelector('[data-test=free-stop]')");
    check('流式回答展示文本且脚本不执行', await evaluate("!window.__injected && document.querySelector('[data-test=free-answer]').textContent.includes('<script>') && !document.querySelector('[data-test=free-answer] script')"));
    await input('free-prompt', '第二次追问'); await click('free-send'); await wait("document.querySelectorAll('[data-test=free-turn]').length===2 && !document.querySelector('[data-test=free-stop]')");
    check('第二轮携带完整第一轮历史', state.chatRequests[1].messages.length === 3 && state.chatRequests[1].messages[0].content === '第一次测试');
    state.freeMode = 'slow'; await input('free-prompt', '停止测试'); await click('free-send'); await wait("Array.from(document.querySelectorAll('[data-test=free-answer]')).at(-1)?.textContent.includes('等待片段')"); await click('free-stop'); await wait("!document.querySelector('[data-test=free-stop]')"); await delay(150);
    check('停止生成传递到上游并保留不完整标记', state.freeCancelled >= 1 && await evaluate("document.querySelector('[data-test=free-conversation]').textContent.includes('片段未加入历史')"));
    state.freeMode = 'success'; await input('free-prompt', '停止后重试'); await click('free-send'); await wait("!document.querySelector('[data-test=free-stop]')");
    check('失败或停止的片段不进入后续上下文', state.chatRequests.at(-1).messages.length === 5 && !state.chatRequests.at(-1).messages.some(item => item.content === '停止测试'));
    state.freeMode = 'slow'; await input('free-prompt', '清空测试'); await click('free-send'); await wait("!!document.querySelector('[data-test=free-stop]')"); await click('free-clear'); await delay(300);
    check('清空取消在途生成并阻止迟到回填', await evaluate("document.querySelectorAll('[data-test=free-turn]').length===0"));
    state.freeMode = 'request-error'; await wait("!document.querySelector('[data-test=free-stop]')"); await input('free-prompt', '额度错误'); await click('free-send'); await wait("document.querySelector('.ext-notice.is-error')?.textContent.includes('频率')");
    check('上游额度错误明确显示且可重填问题', await evaluate("document.querySelector('[data-test=free-conversation]').textContent.includes('重填问题')"));
    state.freeMode = 'success';
    await click('free-settings');
    check('已保存 Key 不回显到输入框或 localStorage', await evaluate(`document.querySelector('[data-test=free-key]').value==='' && !JSON.stringify(localStorage).includes(${JSON.stringify(testKey)})`));
    await evaluate("document.querySelector('.ext-dialog').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))"); await wait("!document.querySelector('.ext-overlay')");
    check('Escape 关闭并恢复焦点', await evaluate("document.activeElement===document.querySelector('[data-test=free-settings]')"));
    state.freeMode = 'slow'; await input('free-prompt', '离页测试'); await click('free-send'); await wait("!!document.querySelector('[data-test=free-stop]')"); const beforeLeaving = state.freeCancelled; await backToTools(); await delay(300);
    check('离开聊天页取消上游', state.freeCancelled > beforeLeaving);
    state.freeMode = 'success';
    await tool('ArtCraft'); await wait("location.pathname==='/tools/artcraft'");
    check('ArtCraft 未安装不会启用启动或伪造画布', await evaluate("document.querySelector('[data-test=art-open]').disabled && document.querySelector('.ext-page').textContent.includes('自己的桌面窗口')"));
    await input('art-subject', '一座海边灯塔，前景有岩石'); await click('art-build');
    check('提示词由用户要求整理且可编辑', await evaluate("document.querySelector('[data-test=art-draft]').value.includes('海边灯塔')"));
    if (lan) {
        check('私网 HTTP 使用真实非安全上下文', await evaluate('!isSecureContext && !navigator.clipboard'));
        const point = await evaluate("(()=>{const r=document.querySelector('[data-test=art-copy]').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()");
        await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
        await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
        await delay(100);
        check('HTTP 复制后回收临时元素并恢复按钮焦点', await evaluate("!document.querySelector('.clipboard-source') && document.activeElement===document.querySelector('[data-test=art-copy]')"));
    } else await click('art-copy');
    check('提示词复制内容正确', await evaluate("window.__copied===document.querySelector('[data-test=art-draft]').value"));
    await click('art-settings'); await input('art-path', paths.artcraft); await click('art-settings-save'); await wait("!document.querySelector('.ext-overlay')");
    await click('art-open'); check('启动前需确认且显示明确路径', state.launchRequests.length === 0 && await evaluate("document.querySelector('.ext-dialog code').textContent.includes('ArtCraft.exe')"));
    await click('art-confirm'); await wait("!document.querySelector('.ext-overlay')");
    check('只启动已保存应用，不把提示词当进程参数', state.launchRequests.length === 1 && state.launchRequests[0].toLowerCase() === paths.artcraft.toLowerCase());
    check('启动请求不冒称原生编辑器已就绪', await evaluate("document.querySelector('.ext-notice').textContent.includes('尚未检测')"));
    await click('art-open'); await click('art-confirm'); await wait("document.querySelector('.ext-dialog .is-error')?.textContent.includes('已发送')");
    check('重复启动有冷却且失败不关闭确认框', state.launchRequests.length === 1);
    await evaluate("document.querySelector('.ext-dialog').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");
    for (const theme of ['light', 'dark']) {
        await evaluate(`document.documentElement.setAttribute('data-theme',${JSON.stringify(theme)});localStorage.setItem('tt-theme',${JSON.stringify(theme)})`); await delay(300);
        await screenshot(`integrations-artcraft-${theme}.png`);
        check(`ArtCraft ${theme} 布局无区域溢出`, await evaluate("Array.from(document.querySelectorAll('.ext-card')).every(el=>el.scrollWidth<=el.clientWidth+2)"));
        await navigate('/tools/freellmapi'); await click('free-refresh'); await wait("document.querySelector('[data-test=free-model]').options.length===3");
        check(`模型下拉 ${theme} 有不透明主题底色`, await evaluate("(()=>{const s=getComputedStyle(document.querySelector('[data-test=free-model]'));return !['transparent','rgba(0, 0, 0, 0)'].includes(s.backgroundColor) && s.color!==s.backgroundColor})()"));
        await screenshot(`integrations-chat-${theme}.png`);
        await navigate('/tools/yoinks'); await input('video-url', 'https://example.com/test'); await click('video-analyze'); await wait("!!document.querySelector('[data-test=video-info]')");
        await screenshot(`integrations-yoinks-${theme}.png`);
        check(`下载页 ${theme} 内容无横向溢出`, await evaluate("Array.from(document.querySelectorAll('.ext-card')).every(el=>el.scrollWidth<=el.clientWidth+2)"));
        await navigate('/tools/artcraft');
    }
    await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    for (const path of ['/tools/yoinks', '/tools/freellmapi', '/tools/artcraft']) {
        await navigate(path);
        check(`1280 宽度 ${path} 页面边界与输入可见`, await evaluate("(()=>{const r=document.querySelector('.ext-workspace').getBoundingClientRect();return r.left>=0 && r.right<=innerWidth+1 && Array.from(document.querySelectorAll('.ext-card')).every(el=>el.scrollWidth<=el.clientWidth+2)})()"));
    }
    check('未向浏览器泄露 Key、URL、问题或回答的操作日志', !JSON.stringify(state.apiLogs).includes(testKey) && !JSON.stringify(state.apiLogs).includes('第一次测试') && !JSON.stringify(state.apiLogs).includes('example.com'));
    check('浏览器没有直接访问外部服务或 CDN', outsideRequests.length === 0);
    check('浏览器运行异常为零', errors.length === 0);
    console.log(`开源工具浏览器验收：${checks.length}/${checks.length} 通过`);
} catch (error) {
    if (ws?.readyState === WebSocket.OPEN) { console.log('界面诊断', await evaluate("({width:innerWidth,page:document.querySelector('.ext-page')?.getBoundingClientRect().toJSON(),workspace:document.querySelector('.ext-workspace')?.getBoundingClientRect().toJSON(),cards:Array.from(document.querySelectorAll('.ext-card')).map(el=>({client:el.clientWidth,scroll:el.scrollWidth}))})")); await screenshot('integrations-failure.png'); }
    throw error;
} finally {
    if (ws?.readyState === WebSocket.OPEN) { try { await send('Browser.close'); } catch { /* 关闭可能先于响应 */ } ws.close(); }
    if (browser.exitCode === null) browser.kill();
    for (const item of pending.values()) { clearTimeout(item.timeout); item.reject(new Error('验收结束')); } pending.clear();
    await service.dispose(); server.closeAllConnections(); gatewayServer.closeAllConnections();
    await Promise.all([new Promise(resolvePromise => server.close(resolvePromise)), new Promise(resolvePromise => gatewayServer.close(resolvePromise))]);
    for (let index = 0; index < 20; index++) { try { await rm(temporary, { recursive: true, force: true }); break; } catch { await delay(150); } }
}
