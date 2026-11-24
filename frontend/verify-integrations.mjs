import { TOOLS } from './src/utils/tool-catalog.js';
// 视频下载隔离浏览器验收：临时设置/组件/媒体，不访问真实网站、设备或团队数据库。
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve, join, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { Readable } from 'node:stream';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const backendRoot = resolve(process.env.VERIFY_BACKEND_ROOT || join(root, 'backend'));
const source = name => import(pathToFileURL(join(backendRoot, 'src', name)).href);
const { createIntegrationServices, registerIntegrationApi } = await source('integration-api.js');
const { createIntegrationConfig, executablePath, problem } = await source('integration-common.js');
const { createToolAccess } = await source('tool-access.js');
const lan = process.env.TT_VERIFY_LAN === '1', access = createToolAccess({ allowLan: lan });
const pageHost = lan ? access.addresses()[0] : '127.0.0.1';
assert.ok(pageHost, '局域网验收需要实际私网 IPv4 网卡');
const require = createRequire(new URL('../backend/package.json', import.meta.url));
const express = require('express');
const temporary = await mkdtemp(join(tmpdir(), 'tt-integrations-ui-'));
assert.ok(resolve(temporary).startsWith(resolve(tmpdir()) + sep) && temporary.includes('tt-integrations-ui-'));
const dist = resolve(process.env.VERIFY_DIST || join(root, 'frontend', 'dist')); assert.ok(existsSync(join(dist, 'index.html')), '先执行 npm run build');
const browserProfile = join(temporary, 'browser'); await mkdir(browserProfile);
const componentDir = join(temporary, 'vendor', 'media', 'win32-x64'); await mkdir(componentDir, { recursive: true });
const paths = { ytDlp: join(componentDir, 'yt-dlp.exe'), ffmpeg: join(componentDir, 'ffmpeg.exe') };
for (const path of Object.values(paths)) await writeFile(path, 'isolated test component, never executed');
const settingsFile = join(temporary, 'open-source-tools.json');
const config = createIntegrationConfig(settingsFile);
const state = { bundleReady: false, videoMode: 'success', videosCancelled: 0, videoRunning: 0, previewsStopped: 0, apiLogs: [] };
const delay = ms => new Promise(resolvePromise => setTimeout(resolvePromise, ms));
const listen = (app, host = '127.0.0.1') => new Promise(resolvePromise => { const server = app.listen(0, host, () => resolvePromise(server)); });
const service = createIntegrationServices({ config,
    yoinksOptions: { componentRoot: temporary, temporaryRoot: temporary, defaultDownloadDir: join(temporary, 'auto-downloads'), detector: async (kind, path) => path ? executablePath(path, kind) : state.bundleReady ? paths[kind] : '', runner: async (file, args, options) => {
        if (args.includes('--version')) return { code: 0, stdout: '2026.10.22\n' };
        if (args.includes('-version')) return { code: 0, stdout: 'ffmpeg version isolated-test\n' };
        if (args.includes('--dump-single-json')) return { code: 0, stdout: JSON.stringify({ title: '隔离验收视频', uploader: '合成测试', duration: 60, formats: [{ vcodec: 'avc1', acodec: 'aac', height: 720 }] }) };
        // 预览会先问 yt-dlp 要直链，这里直接给一条合成地址，不真的联网。
        if (args.includes('-j')) return { code: 0, stdout: JSON.stringify({ requested_downloads: [{ url: 'https://media.example.com/isolated.mp4', vcodec: 'avc1', acodec: 'aac', http_headers: { Referer: 'https://example.com/' } }] }) };
        state.videoRunning += 1;
        try {
            for (let i = 1; i <= (state.videoMode === 'slow' ? 100 : 5); i++) {
                if (options.signal.aborted) { state.videosCancelled++; throw problem('cancelled', '已取消', 499); }
                options.onLine(`TOOLBOX_PROGRESS|${i * 20}|100|20|1`); await delay(80);
            }
            if (state.videoMode === 'error') return { code: 1, stderr: 'isolated failure' };
            const output = args[args.indexOf('-o') + 1].replace('%(ext)s', args.includes('mp3') ? 'mp3' : 'mp4');
            await writeFile(output, Buffer.alloc(256, 1)); options.onLine('TOOLBOX_FILE|' + output);
            return { code: 0 };
        } finally { state.videoRunning -= 1; }
    },
    // 预览的 ffmpeg 进程换成固定的 mp4 片段，验收只关心票据与播放器接线，不依赖真实组件。
    previewSpawn: () => ({ stream: Readable.from([Buffer.from('00000020ftypisom')]), stop: () => { state.previewsStopped += 1; }, errorText: () => '' }) }
});
const apiRequests = [];
const app = express(); app.use((req, _res, next) => { if (req.path.startsWith('/api/')) apiRequests.push(req.path); next(); }); app.use(access.middleware); app.use(express.json()); registerIntegrationApi(app, { service, access, log: entry => state.apiLogs.push(entry) });
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
    console.log('页面诊断', await evaluate("({path:location.pathname,text:document.querySelector('.ext-page')?.innerText, url:document.querySelector('[data-test=video-url]')?.value, analyzeDisabled:document.querySelector('[data-test=video-analyze]')?.disabled, notices:Array.from(document.querySelectorAll('.ext-notice')).map(el=>el.textContent)})"));
    console.log('接口日志', state.apiLogs.slice(-6));
    await screenshot('integrations-failure.png'); throw new Error('页面等待超时：' + expression);
}
const selector = name => `[data-test="${name}"]`;
async function click(name) { await evaluate(`(()=>{const element=document.querySelector(${JSON.stringify(selector(name))});element.focus();element.click();})()`); await delay(60); }
async function input(name, value) { await evaluate(`(()=>{const element=document.querySelector(${JSON.stringify(selector(name))});element.value=${JSON.stringify(value)};element.dispatchEvent(new Event('input',{bubbles:true}));element.dispatchEvent(new Event('change',{bubbles:true}));})()`); }
async function navigate(path, expected = path) { await send('Page.navigate', { url: base + path }); await wait(`location.pathname===${JSON.stringify(expected)} && !!document.querySelector('.view-page')`); await delay(100); }
function check(name, value) { checks.push({ name, pass: !!value }); console.log(`${value ? 'PASS' : 'FAIL'} ${name}`); assert.ok(value, name); }
async function screenshot(name) { await mkdir(join(root, 'build'), { recursive: true }); await writeFile(join(root, 'build', name), Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64')); }
async function backToTools() { await evaluate("document.querySelector('.ext-back').click()"); await wait("location.pathname==='/tools'"); }
async function tool(name) { await evaluate(`Array.from(document.querySelectorAll('.tool-card')).find(card=>card.textContent.includes(${JSON.stringify(name)})).querySelector('button').click()`); await delay(120); }
async function waitForVideoStart() { for (let index = 0; index < 40 && state.videoRunning < 1; index++) await delay(50); assert.ok(state.videoRunning >= 1, '测试下载组件应已开始'); }
async function waitForVideoStop() { for (let index = 0; index < 60 && state.videoRunning > 0; index++) await delay(50); }
const cacheEntries = async () => readdir(join(temporary, 'toolbox-video-cache')).catch(() => []);

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
    await send('Page.addScriptToEvaluateOnNewDocument', { source: 'localStorage.setItem(\'team-toolbox-home-layout-v1\', JSON.stringify({"version": 1, "shortcuts": ["tool:yoinks", "tool:freellmapi", "tool:artcraft"], "showRecent": false}))' });
    await navigate('/');
    check('首页展示已固定的视频下载并忽略无效工具', await evaluate("[...document.querySelectorAll('.page-home .tool-card')].some(el=>el.textContent.includes('视频下载'))&&!document.querySelector('.page-home').textContent.includes('FreeLLMAPI')&&!document.querySelector('.page-home').textContent.includes('ArtCraft')"));
    await navigate('/tools'); check('工具箱全部卡片包含视频下载', await evaluate("document.querySelectorAll('.tool-card').length===" + TOOLS.length + "&&!!document.querySelector('[data-tool-id=yoinks]')"));
    await tool('Yoinks'); await wait("location.pathname==='/tools/yoinks'");
    check('未配置组件时提示真实未就绪', await evaluate("document.querySelector('.ext-badge').textContent.includes('未就绪') && document.querySelector('[data-test=video-analyze]').disabled"));
    await wait("document.querySelector('[data-test=video-resolver]')?.options.length===5");
    check('指定方案下拉仅四项通用解析及自动，不再显示两个专用站点', await evaluate("JSON.stringify([...document.querySelector('[data-test=video-resolver]').options].map(item=>item.value))===JSON.stringify(['','direct-media','ytdlp','page-media','ytdlp-generic'])&&!/91porna|bad\\.news/.test(document.querySelector('[data-test=video-resolvers]').textContent)"));
    await evaluate("[...document.querySelectorAll('.ext-page button')].find(el=>el.textContent.trim()==='帮助').click()");
    await wait("!!document.querySelector('.ext-overlay')");
    check('帮助说明同步四种方案且无已移除的站点教程', await evaluate("document.querySelector('.ext-dialog').textContent.includes('四个方案')&&!/91porna|bad\\.news/.test(document.querySelector('.ext-dialog').textContent)"));
    await evaluate("document.querySelector('.ext-dialog button[aria-label=关闭弹窗]').click()");
    await wait("!document.querySelector('.ext-overlay')");
    await click('video-settings');
    check('设置弹窗 Teleport 到 body 且获得焦点', await evaluate("document.querySelector('.ext-overlay').parentElement===document.body && document.activeElement.getAttribute('role')==='dialog'"));
    check('设置弹窗居中并在视口内', await evaluate("(()=>{const r=document.querySelector('.ext-dialog').getBoundingClientRect();return Math.abs((r.left+r.right)/2-innerWidth/2)<3 && r.top>=0 && r.bottom<=innerHeight})()"));
    await input('video-ytdlp', paths.ytDlp); await input('video-ffmpeg', paths.ffmpeg); await click('video-settings-save'); await wait("!document.querySelector('.ext-overlay')");
    check('组件检测成功后解除分析按钮依赖限制', await evaluate("document.querySelector('.ext-badge').textContent.includes('已找到')"));
    state.bundleReady = true;
    await click('video-settings'); await click('video-settings-bundled'); await wait("!document.querySelector('.ext-overlay')");
    check('一键恢复内置组件后显示就绪状态和直接使用说明', await evaluate("document.querySelector('[data-test=video-engine-status]').textContent.includes('内置') && document.querySelector('[data-test=video-bundled-hint]').textContent.includes('MP3')"));
    const restored = await config.read(); check('恢复内置清空手动路径覆盖且不保存下载结果', restored.ytDlpPath === '' && restored.ffmpegPath === '' && Object.keys(restored).length === 6);
    await input('video-url', 'https://example.com/watch?v=isolated'); await click('video-analyze'); await wait("!!document.querySelector('[data-test=video-info]')");
    check('视频分析提供清晰度与 MP3', await evaluate("document.querySelector('[data-test=video-info]').textContent.includes('隔离验收视频') && document.querySelector('[data-test=video-choice]').options.length===2"));
    check('下载区显示保存目录与并发上限', await evaluate("document.querySelector('[data-test=video-save-dir]').textContent.includes('auto-downloads') && document.querySelector('[data-test=video-parallel]').textContent.includes('3')"));
    await click('video-preview'); await wait("!!document.querySelector('[data-test=video-preview-panel]')");
    check('先看看：解析完直接可播，播放器读实时转封装流', await evaluate("document.querySelector('[data-test=video-preview-player]').getAttribute('src')?.includes('/api/integrations/yoinks/preview/')"));
    check('预览面板不占用下载队列', (await evaluate("document.querySelectorAll('.task-item').length")) === 0);
    await click('video-preview-close'); await wait("!document.querySelector('[data-test=video-preview-panel]')");
    check('关闭预览后播放器被移除并停止拉流', (await evaluate("!document.querySelector('[data-test=video-preview-player]')")) && state.previewsStopped >= 1);
    await input('video-choice', 'audio-mp3'); await click('video-download'); await wait("!!document.querySelector('[data-test=video-progress]')");
    check('下载中显示当前媒体流而非伪造总进度', await evaluate("document.querySelector('[data-test=video-progress]').textContent.includes('不能代表')"));
    await wait("!!document.querySelector('[data-test=video-result]')");
    check('完成后自动保存并显示落地路径', await evaluate("document.querySelector('[data-test=video-result]').textContent.includes('已保存到') && document.querySelector('[data-test=video-result]').textContent.includes('隔离验收视频.mp3')"));
    for (let index = 0; index < 50 && !existsSync(join(temporary, 'auto-downloads', '隔离验收视频.mp3')); index++) await delay(100);
    check('文件已自动放进下载目录', existsSync(join(temporary, 'auto-downloads', '隔离验收视频.mp3')));
    check('自动保存后不再需要手动另存', await evaluate("!document.querySelector('[data-test=video-save]')"));
    await click('video-remove'); await wait("!document.querySelector('[data-test=video-result]')");
    check('移除任务不删除已保存的成品', existsSync(join(temporary, 'auto-downloads', '隔离验收视频.mp3')));
    state.videoMode = 'error'; await click('video-download'); await wait("!!document.querySelector('[data-test=video-task-failed]')");
    check('下载失败在任务行内明确反馈', await evaluate("document.querySelector('[data-test=video-task-failed]').textContent.includes('失败')"));
    await click('video-remove'); await wait("!document.querySelector('[data-test=video-task-failed]')");
    state.videoMode = 'slow';
    await click('video-download'); await wait("document.querySelectorAll('.task-item').length>=1");
    await click('video-download'); await wait("document.querySelectorAll('.task-item').length>=2");
    for (let index = 0; index < 80 && state.videoRunning < 2; index++) await delay(50);
    check('可以同时下载多个任务', state.videoRunning >= 2 && (await evaluate("document.querySelectorAll('[data-test=video-task-running]').length")) >= 2);
    await click('video-stop'); await wait("!!document.querySelector('[data-test=video-task-cancelled]')");
    await click('video-stop'); await waitForVideoStop();
    check('取消后保留分片以便续传', (await cacheEntries()).length === 1);
    await click('video-retry'); await wait("!!document.querySelector('[data-test=video-task-running]')");
    await waitForVideoStart();
    check('重试可直接再次开始', state.videoRunning >= 1);
    await click('video-stop'); await waitForVideoStop();
    await wait("!!document.querySelector('[data-test=video-clear-cache]')"); await click('video-clear-cache');
    for (let index = 0; index < 40 && (await cacheEntries()).length; index++) await delay(50);
    check('缓存可一键清理', (await cacheEntries()).length === 0);
    await click('video-download'); await wait("!!document.querySelector('[data-test=video-task-running]')"); await waitForVideoStart();
    await backToTools(); await delay(600);
    check('离开下载页后后台继续下载', state.videoRunning >= 1);
    await tool('Yoinks'); await wait("location.pathname==='/tools/yoinks'");
    await wait("!!document.querySelector('[data-test=video-task-running]')");
    check('回到页面仍能看到在途任务', await evaluate("!!document.querySelector('[data-test=video-task-running]')"));
    await click('video-stop'); await waitForVideoStop(); await backToTools();
    state.videoMode = 'success';
    for (const old of ['freellmapi', 'artcraft']) {
        await navigate('/tools/' + old, '/tools');
        check('旧工具地址 ' + old + ' 返回工具箱', await evaluate("document.querySelector('#tool-tab-toolbox').getAttribute('aria-selected')==='true'&&!document.querySelector('.ext-page')"));
    }
    for (const theme of ['light', 'dark']) {
        await evaluate(`document.documentElement.setAttribute('data-theme',${JSON.stringify(theme)});localStorage.setItem('tt-theme',${JSON.stringify(theme)})`); await delay(300);
        await navigate('/tools/yoinks'); await wait("document.querySelector('[data-test=video-engine-status]')?.textContent.includes('就绪')"); await delay(300);
        await input('video-url', 'https://example.com/test');
        for (let attempt = 0; attempt < 3 && !(await evaluate("!!document.querySelector('[data-test=video-info]')")); attempt++) { await click('video-analyze'); await delay(600); }
        await wait("!!document.querySelector('[data-test=video-info]')");
        await screenshot(`integrations-yoinks-${theme}.png`);
        check(`下载页 ${theme} 内容无横向溢出`, await evaluate("Array.from(document.querySelectorAll('.ext-card')).every(el=>el.scrollWidth<=el.clientWidth+2)"));
    }
    await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    for (const path of ['/tools/yoinks']) {
        await navigate(path);
        check(`1280 宽度 ${path} 页面边界与输入可见`, await evaluate("(()=>{const r=document.querySelector('.ext-workspace').getBoundingClientRect();return r.left>=0 && r.right<=innerWidth+1 && Array.from(document.querySelectorAll('.ext-card')).every(el=>el.scrollWidth<=el.clientWidth+2)})()"));
    }
    check('页面不请求已移除工具接口', apiRequests.every(path => !/^\/api\/integrations\/(freellmapi|artcraft)/.test(path)));
    check('操作日志不记录视频URL', !JSON.stringify(state.apiLogs).includes('example.com'));
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
    await service.dispose(); server.closeAllConnections();
    await new Promise(resolvePromise => server.close(resolvePromise));
    for (let index = 0; index < 20; index++) { try { await rm(temporary, { recursive: true, force: true }); break; } catch { await delay(150); } }
}
