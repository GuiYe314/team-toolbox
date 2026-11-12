// 隔离生产页面 + 临时浏览器 + 合成端点。另以真实Windows只读冒烟验证系统调用。
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { registerPortViewerApi } from '../backend/src/port-viewer-api.js';
import { PortViewerError } from '../backend/src/port-viewer.js';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..'), require = createRequire(new URL('../backend/package.json', import.meta.url));
const express = require('express'), app = express(), temporary = mkdtempSync(join(tmpdir(), 'tt-ports-ui-'));
assert.ok(resolve(temporary).startsWith(resolve(tmpdir()) + sep) && temporary.includes('tt-ports-ui-'));
const profile = join(temporary, 'browser'); mkdirSync(profile);
let mode = 'ready', latency = 0, requests = 0, active = 0, maxActive = 0, aborts = 0;
const rows = Array.from({ length: 201 }, (_, i) => ({ protocol: 'TCP', localAddress: '127.0.0.1', localPort: 3000 + i, remoteAddress: '0.0.0.0', remotePort: 0, state: 'Listen', pid: 1000 + i, processName: i ? i === 1 ? '<img src=x onerror=alert(1)>' : 'process-' + i : 'node' }));
rows.push({ protocol: 'UDP', localAddress: '0.0.0.0', localPort: 53, remoteAddress: '', remotePort: 0, state: 'Bound', pid: 4, processName: 'dns' },
    { protocol: 'TCP', localAddress: '::1', localPort: 9222, remoteAddress: '::', remotePort: 0, state: 'Listen', pid: 700, processName: '调试程序' },
    { protocol: 'TCP', localAddress: '127.0.0.1', localPort: 48000, remoteAddress: '192.168.1.1', remotePort: 3000, state: 'Established', pid: 500, processName: 'browser' },
    { protocol: 'TCP', localAddress: '::', localPort: 80, remoteAddress: '::', remotePort: 0, state: 'Listen', pid: 7, processName: '' });
app.get('/api/documents/tree', (_req, res) => res.json({ items: [] }));
app.get('/api/documents', (_req, res) => res.json({ items: [], total: 0 }));
registerPortViewerApi(app, { service: { async read(signal) {
    requests++; active++; maxActive = Math.max(maxActive, active); const selected = mode;
    try {
        if (latency) await new Promise((resolvePromise, reject) => {
            const abort = () => { clearTimeout(timer); aborts++; reject(new PortViewerError('cancelled', 'cancelled', 499)); };
            const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolvePromise(); }, latency);
            signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort();
        });
        if (selected === 'error') throw new PortViewerError('read_failed', '合成端口读取故障');
        if (selected === 'unsupported') return { state: 'unsupported', rows: [], truncated: false, sampledAt: null, message: '当前仅支持 Windows 本机端口读取' };
        return { state: 'ready', rows: selected === 'empty' || selected === 'late' ? [] : rows, sampledAt: new Date().toISOString(), truncated: selected === 'truncated' };
    } finally { active--; }
} } });
app.use('/api', (_req, res) => res.status(501).json({ message: '隔离服务不读取真实业务数据' }));
const dist = join(root, 'frontend/dist'); assert.ok(existsSync(join(dist, 'index.html')));
app.use(express.static(dist, { index: false })); app.get('/{*path}', (_req, res) => res.sendFile(join(dist, 'index.html')));
const server = await new Promise(resolvePromise => { const s = app.listen(0, '127.0.0.1', () => resolvePromise(s)); });
const base = 'http://127.0.0.1:' + server.address().port;
const executable = [process.env.VERIFY_BROWSER, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].filter(Boolean).find(existsSync); assert.ok(executable);
const browser = spawn(executable, ['--headless=new', '--disable-gpu', '--disable-background-networking', '--no-first-run', '--disable-extensions', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', '--user-data-dir=' + profile, '--window-size=1600,1000', 'about:blank'], { windowsHide: true, stdio: 'ignore' });
let browserError, ws, messageId = 0, passed = 0; browser.on('error', error => { browserError = error; });
const pending = new Map(), errors = [], outside = [], delay = ms => new Promise(resolvePromise => setTimeout(resolvePromise, ms));
function send(method, params = {}) { const id = ++messageId; return new Promise((resolvePromise, reject) => { const timer = setTimeout(() => { pending.delete(id); reject(new Error('CDP timeout: ' + method)); }, 30000); pending.set(id, { resolve: resolvePromise, reject, timer }); ws.send(JSON.stringify({ id, method, params })); }); }
async function evaluate(expression) { const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails)); return r.result?.value; }
async function wait(expression) { for (let i = 0; i < 150; i++) { if (await evaluate(expression)) return; await delay(80); } throw new Error('Page wait failed: ' + expression); }
async function click(selector) { await evaluate('document.querySelector(' + JSON.stringify(selector) + ').click()'); await delay(60); }
async function input(selector, value, event = 'input') { await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event(${JSON.stringify(event)},{bubbles:true}))})()`); await delay(60); }
function check(name, condition) { assert.ok(condition, name); console.log('PASS ' + (++passed) + ' ' + name); }
async function screenshot(name) { mkdirSync(join(root, 'build'), { recursive: true }); writeFileSync(join(root, 'build', name), Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64')); }
try {
    const portFile = join(profile, 'DevToolsActivePort'); for (let i = 0; i < 100 && !existsSync(portFile); i++) { if (browserError) throw browserError; await delay(100); } assert.ok(existsSync(portFile));
    const port = Number(readFileSync(portFile, 'utf8').split(/\r?\n/)[0]), tabs = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
    ws = new WebSocket(tabs.find(tab => tab.type === 'page').webSocketDebuggerUrl);
    ws.addEventListener('message', event => { const data = JSON.parse(event.data); if (data.id && pending.has(data.id)) { const item = pending.get(data.id); pending.delete(data.id); clearTimeout(item.timer); if (data.error) item.reject(new Error(JSON.stringify(data.error))); else item.resolve(data.result); } if (data.method === 'Runtime.exceptionThrown') errors.push(data.params.exceptionDetails); if (data.method === 'Network.requestWillBeSent' && !data.params.request.url.startsWith(base) && !data.params.request.url.startsWith('data:')) outside.push(data.params.request.url); });
    await new Promise(resolvePromise => ws.addEventListener('open', resolvePromise, { once: true }));
    await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
    await send('Browser.grantPermissions', { origin: base, permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] });
    await send('Emulation.setFocusEmulationEnabled', { enabled: true });
    await send('Page.navigate', { url: base + '/tools' }); await wait("document.querySelector('.page-tools')");
    check('工具箱包含端口查看入口', await evaluate("document.querySelector('.page-tools').textContent.includes('端口查看')"));
    await send('Page.navigate', { url: base + '/tools/ports' }); await wait("document.querySelector('#ports-total')?.textContent==='205'");
    check('TCP监听、UDP和总数分开统计', await evaluate("document.querySelector('#ports-listen-count').textContent==='203'&&document.querySelector('#ports-udp-count').textContent==='1'&&document.querySelector('#ports-match-count').textContent.includes('204')"));
    check('首次最多渲染100条且有分页', await evaluate("document.querySelectorAll('#ports-table tbody tr').length===100&&!document.querySelector('#ports-next').disabled"));
    check('进程文本按字面展示，没有HTML注入', await evaluate("document.querySelector('#ports-table').textContent.includes('<img src=x')&&!document.querySelector('#ports-table img')"));
    await click('#ports-auto'); const stopped = requests; await delay(5200); check('关闭自动刷新后不再轮询', requests === stopped);
    await click('#ports-next'); check('下一页生效', await evaluate("document.querySelector('.ports-pagination').textContent.includes('第 2 / 3 页')"));
    await input('#ports-port', '3000'); check('精确端口过滤且重置分页', await evaluate("document.querySelector('#ports-match-count').textContent.includes('匹配 1 条')&&document.querySelector('#ports-table tbody').textContent.includes('node')"));
    await input('#ports-scope', 'all', 'change'); check('精确本地端口不误匹配远端3000', await evaluate("document.querySelector('#ports-match-count').textContent.includes('匹配 1 条')"));
    await click('#ports-clear'); await input('#ports-query', 'NODE'); check('进程关键词忽略大小写', await evaluate("document.querySelector('#ports-match-count').textContent.includes('匹配 1 条')"));
    await click('.ports-copy'); await wait("document.querySelector('.ports-results-head').textContent.includes('已复制')"); check('主动复制端口和PID', (await evaluate('navigator.clipboard.readText()')).includes('PID 1000'));
    await click('#ports-clear'); await input('#ports-query', '700'); check('支持PID及IPv6格式展示', await evaluate("document.querySelector('#ports-table tbody').textContent.includes('[::1]:9222')"));
    await click('#ports-clear'); await input('#ports-protocol', 'UDP', 'change'); check('UDP绑定不冒充远端连接', await evaluate("document.querySelector('#ports-match-count').textContent.includes('匹配 1 条')&&document.querySelector('#ports-table tbody').textContent.includes('已绑定')"));
    await click('#ports-clear'); await input('#ports-port', '80'); check('进程名称不可用有明确说明', await evaluate("document.querySelector('#ports-table tbody').textContent.includes('名称不可用')")); await click('#ports-clear');
    mode = 'error'; await click('#ports-refresh'); await wait("document.querySelector('#ports-error')"); check('失败保留旧快照且标注', await evaluate("document.querySelector('#ports-total').textContent==='205'&&document.querySelector('#ports-error').textContent.includes('上次成功快照')"));
    mode = 'ready'; await click('#ports-refresh'); await wait("!document.querySelector('#ports-error')"); check('手动重试可恢复', true);
    mode = 'truncated'; await click('#ports-refresh'); await wait("document.querySelector('#ports-truncated')"); check('截断明确提示数据不完整', true);
    mode = 'empty'; await click('#ports-refresh'); await wait("document.querySelector('#ports-total').textContent==='0'"); check('真实空结果与失败区分', await evaluate("document.querySelector('#ports-empty').textContent.includes('没有符合')&&!document.querySelector('#ports-error')"));
    mode = 'ready'; await click('#ports-refresh'); await wait("document.querySelector('#ports-total').textContent==='205'");
    mode = 'late'; latency = 1200; await click('#ports-refresh');
    await evaluate("Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'))"); await wait("document.querySelector('#ports-status').textContent==='后台已暂停'"); await delay(1300);
    check('后台取消并阻止迟到空快照覆盖', aborts > 0 && await evaluate("document.querySelector('#ports-total').textContent==='205'"));
    latency = 0; mode = 'ready'; await evaluate("Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'))"); await click('#ports-auto'); await wait("!document.querySelector('#ports-refresh').disabled"); const beforeAuto = requests; await delay(5300); check('自动刷新可恢复且请求不重叠', requests > beforeAuto && maxActive === 1); await click('#ports-auto');
    for (const theme of ['light', 'dark']) {
        await evaluate("document.documentElement.dataset.theme=" + JSON.stringify(theme)); await delay(320);
        for (const width of [1280, 1600]) { await send('Emulation.setDeviceMetricsOverride', { width, height: 1050, deviceScaleFactor: 1, mobile: false }); await delay(100);
            check(theme + ' ' + width + ' 端口页无外层溢出', await evaluate("(()=>{const p=document.querySelector('.ports-page');return p.scrollWidth<=p.clientWidth+1&&[...document.querySelectorAll('.ports-panel')].every(e=>e.scrollWidth<=e.clientWidth+1)})()")); }
        const contrast = await evaluate("(()=>{const s=getComputedStyle(document.querySelector('#ports-scope'));const l=c=>{const a=c.match(/[0-9.]+/g).slice(0,3).map(n=>{const v=+n/255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4});return a[0]*.2126+a[1]*.7152+a[2]*.0722};const a=l(s.color),b=l(s.backgroundColor);return(Math.max(a,b)+.05)/(Math.min(a,b)+.05)})()"); check(theme + ' 下拉对比度达到4.5', contrast >= 4.5); await screenshot('ports-' + theme + '.png');
    }
    mode = 'late'; latency = 1000; await click('#ports-refresh'); await click('.ports-header a'); await wait("document.querySelector('.page-tools')"); const leftCount = requests; await delay(1100); check('离页取消在途读取且停止轮询', requests === leftCount && active === 0);
    mode = 'unsupported'; latency = 0; await send('Page.navigate', { url: base + '/tools/ports' }); await wait("document.querySelector('#ports-status')?.textContent==='当前系统不支持'"); const unsupportedCount = requests; await delay(5200); check('不支持平台不再轮询', requests === unsupportedCount);
    check('无浏览器异常和外部网络请求', errors.length === 0 && outside.length === 0);
    console.log('RESULT ' + passed + ' port viewer browser checks passed.');
} catch (error) { await screenshot('ports-failure.png').catch(() => {}); throw error; }
finally {
    if (ws?.readyState === WebSocket.OPEN) await send('Browser.close').catch(() => {}); ws?.close(); for (const item of pending.values()) clearTimeout(item.timer);
    for (let i = 0; i < 30 && browser.exitCode === null; i++) await delay(100); if (browser.exitCode === null) browser.kill();
    server.closeAllConnections(); await new Promise(resolvePromise => server.close(resolvePromise));
    rmSync(temporary, { recursive: true, force: true, maxRetries: 8, retryDelay: 150 });
}
