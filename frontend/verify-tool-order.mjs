// 工具排序/下拉主题验收：隔离静态服务、只读合成页面树和临时浏览器。
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { testBrowser, removeBrowserFixture, delay } from './verify-browser.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(new URL('../backend/package.json', import.meta.url));
const express = require('express'), app = express();
const temporary = await mkdtemp(join(tmpdir(), 'tt-tool-order-'));
assert.ok(resolve(temporary).startsWith(resolve(tmpdir()) + sep) && temporary.includes('tt-tool-order-'));
const dist = resolve(process.env.VERIFY_DIST || join(root, 'frontend/dist'));
assert.ok(existsSync(join(dist, 'index.html')), '先构建前端');
app.use(express.json());
app.get('/api/documents/tree', (_req, res) => res.json({ items: [{ id: 10, title: '十月', parent_id: null }, { id: 11, title: '十一月', parent_id: null }] }));
app.get('/api/documents', (_req, res) => res.json({ items: [], total: 0 }));
app.get('/api/categories', (_req, res) => res.json([{ id: 1, name: '工作记录' }]));
app.post('/api/markdown/render', (_req, res) => res.json({ html: '' }));
app.use('/api', (_req, res) => res.status(503).json({ message: '隔离服务不使用真实团队数据' }));
app.use(express.static(dist, { index: false }));
app.get('/{*path}', (_req, res) => res.sendFile(join(dist, 'index.html')));
const server = await new Promise(done => { const listener = app.listen(0, '127.0.0.1', () => done(listener)); });
const base = 'http://127.0.0.1:' + server.address().port;
const key = 'team-toolbox-tool-order-v1';
let browser, passed = 0;
const check = (name, condition = true) => { assert.ok(condition, name); console.log('PASS ' + (++passed) + ' ' + name); };
const orderedIds = () => browser.evaluate("[...document.querySelectorAll('.page-tools .tool-card')].map(e=>e.dataset.toolId)");
async function navigate(path, selector) {
    await browser.send('Page.navigate', { url: base + path });
    await browser.wait('!!document.querySelector(' + JSON.stringify(selector) + ')');
}
async function reloadTools() {
    await browser.send('Page.reload', { ignoreCache: true });
    await browser.wait("document.querySelectorAll('.page-tools .tool-card').length===11");
}
async function drag(source, target, after = false, cancel = false) {
    const point = async (id, part) => browser.evaluate(`(()=>{const e=document.querySelector('[data-tool-id="${id}"]');const r=e.getBoundingClientRect();return {x:r.left+r.width*${part},y:r.top+32}})()`);
    const start = await point(source, 0.5), end = await point(target, after ? 0.8 : 0.2);
    await browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...start });
    await browser.send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...start });
    for (let i = 1; i <= 16; i++) {
        await browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', button: 'left', buttons: 1, x: start.x + (end.x - start.x) * i / 16, y: start.y + (end.y - start.y) * i / 16 });
        await delay(20);
    }
    // 最后一步可能刚进入子元素；继续移动，让原生 dragover 有机会取消默认行为。
    await browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', button: 'left', buttons: 1, x: end.x + 2, y: end.y + 1 });
    await browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', button: 'left', buttons: 1, ...end });
    await delay(80);
    if (cancel) await browser.send('Input.cancelDragging');
    await browser.send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...end });
    await delay(120);
}
async function screenshot(name) {
    await mkdir(join(root, 'build'), { recursive: true });
    const result = await browser.send('Page.captureScreenshot', { format: 'png' });
    await writeFile(join(root, 'build', name), Buffer.from(result.data, 'base64'));
}
try {
    browser = await testBrowser(temporary);
    await navigate('/tools', '.page-tools');
    await browser.evaluate("window.__dragEvents=[];for(const type of ['dragstart','dragenter','dragover','drop','dragend'])document.addEventListener(type,e=>{window.__dragEvents.push([type,e.target.closest?.('[data-tool-id]')?.dataset.toolId,e.clientX,e.clientY])},true)");
    const defaults = await orderedIds();
    check('全部11张工具卡片及可见拖动提示', defaults.length === 11 && await browser.evaluate("document.querySelector('.tool-order-hint').textContent.includes('拖动')"));
    await drag('qrcode', 'yoinks');
    check('实际鼠标拖放可移到第一位', (await orderedIds())[0] === 'qrcode');
    await drag('qrcode', 'json-fmt', true);
    check('实际鼠标拖放可直接移到最后', (await orderedIds()).at(-1) === 'qrcode');
    await drag('android-wireless', 'yoinks');
    const moved = await orderedIds();
    check('目标左半区放前面', moved[0] === 'android-wireless' && moved[1] === 'yoinks');
    check('只保存工具id顺序', await browser.evaluate(`JSON.stringify(JSON.parse(localStorage.getItem('${key}')))===${JSON.stringify(JSON.stringify(moved))}`));
    await reloadTools();
    check('刷新保留顺序', JSON.stringify(await orderedIds()) === JSON.stringify(moved));
    await navigate('/', '.page-home');
    const homeNames = await browser.evaluate("[...document.querySelectorAll('.tool-name')].map(e=>e.textContent)");
    check('首页已有工具跟随相对顺序', homeNames[0] === '安卓无线调试' && homeNames[1].includes('Yoinks') && homeNames.at(-1) === '二维码生成');
    await navigate('/tools', '.page-tools');
    check('路由切回工具箱保留排序', JSON.stringify(await orderedIds()) === JSON.stringify(moved));
    await browser.click('.tool-order-actions button');
    check('恢复默认顺序', JSON.stringify(await orderedIds()) === JSON.stringify(defaults));
    await reloadTools();
    check('默认顺序在刷新后保留', JSON.stringify(await orderedIds()) === JSON.stringify(defaults));
    await drag('qrcode', 'yoinks', false, true);
    check('原生取消拖放不改变顺序和保存值', JSON.stringify(await orderedIds()) === JSON.stringify(defaults) && await browser.evaluate(`localStorage.getItem('${key}')===${JSON.stringify(JSON.stringify(defaults))}`));
    check('取消后清除拖动与目标高亮', await browser.evaluate("!document.querySelector('.is-dragging,.is-drop-target')"));
    await browser.evaluate(`localStorage.setItem('${key}',JSON.stringify(['android-wireless','missing','android-wireless',5]))`);
    await reloadTools();
    const migrated = await orderedIds();
    check('过滤未知及重复id，新工具追加且不丢卡片', migrated[0] === 'android-wireless' && new Set(migrated).size === 11);
    await browser.evaluate(`localStorage.setItem('${key}','{bad')`);
    await reloadTools();
    check('损坏偏好自动回到默认顺序', JSON.stringify(await orderedIds()) === JSON.stringify(defaults));
    await browser.evaluate("window.__storageSet=Storage.prototype.setItem;Storage.prototype.setItem=function(){throw new DOMException('full','QuotaExceededError')}");
    await drag('qrcode', 'yoinks');
    check('保存失败明确提示，当前调整仍可用', (await orderedIds())[0] === 'qrcode' && await browser.evaluate("document.querySelector('[role=alert]').textContent.includes('未能保存')"));
    await browser.evaluate('Storage.prototype.setItem=window.__storageSet');
    await browser.click('[role=alert] button');
    check('保存可重试并清除错误', await browser.evaluate("!document.querySelector('[role=alert]')"));
    await reloadTools();
    check('重试成功后刷新仍保留', (await orderedIds())[0] === 'qrcode');
    // 外部文本/文件拖入不允许改变工具定义或顺序。
    await browser.evaluate("(()=>{const target=document.querySelector('.tool-card'),data=new DataTransfer();data.setData('text/plain','yoinks');target.dispatchEvent(new DragEvent('drop',{bubbles:true,dataTransfer:data}))})()");
    check('忽略外部拖入', (await orderedIds())[0] === 'qrcode');
    await browser.click('.tool-order-actions button');
    for (const theme of ['light', 'dark']) {
        await browser.evaluate(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`); await delay(350);
        for (const width of [1280, 1600]) {
            await browser.send('Emulation.setDeviceMetricsOverride', { width, height: 1100, deviceScaleFactor: 1, mobile: false });
            check(theme + ' ' + width + ' 卡片与工具栏无溢出', await browser.evaluate("(()=>{const p=document.querySelector('.page-tools');return p.scrollWidth<=p.clientWidth+1&&[...document.querySelectorAll('.tool-card')].every(e=>e.scrollWidth<=e.clientWidth+1)})()"));
        }
        await screenshot('v060-tools-' + theme + '.png');
    }
    await navigate('/kb/new', '#parent');
    await browser.wait("document.querySelector('#parent').options.length===3");
    check('复现截图中的顶层页面/十月下拉内容', await browser.evaluate("document.querySelector('#parent').textContent.includes('顶层页面')&&document.querySelector('#parent').textContent.includes('十月')"));
    await browser.evaluate("document.querySelector('#parent').focus()");
    await browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 });
    await browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 });
    check('可选择父页面，原生键盘选择继续可用', await browser.evaluate("document.querySelector('#parent').value==='10'"));
    for (const theme of ['light', 'dark']) {
        await browser.evaluate(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`); await delay(350);
        const contrast = await browser.evaluate(`(()=>{
            const l=c=>{const a=c.match(/[0-9.]+/g).slice(0,3).map(n=>{const v=+n/255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4});return a[0]*.2126+a[1]*.7152+a[2]*.0722};
            const ratio=s=>{const a=l(s.color),b=l(s.backgroundColor);return(Math.max(a,b)+.05)/(Math.min(a,b)+.05)};
            const select=document.querySelector('#parent'),options=[...select.options].map(e=>getComputedStyle(e));
            return {ratios:options.map(ratio),opaque:options.every(s=>!s.backgroundColor.startsWith('rgba')||s.backgroundColor.endsWith(', 1)')),scheme:getComputedStyle(select).colorScheme};
        })()`);
        check(theme + ' 选中和未选菜单文字对比度均达到4.5', contrast.ratios.every(n => n >= 4.5));
        check(theme + ' 原生菜单实底并跟随主题', contrast.opaque && contrast.scheme === theme);
        // size仅用于把真实option样式展示在截图中，不改变产品代码。
        await browser.evaluate("document.querySelector('#parent').size=3");
        await screenshot('v060-select-' + theme + '.png');
        await browser.evaluate("document.querySelector('#parent').size=0");
    }
    check('无浏览器异常', browser.errors.length === 0);
    check('页面只使用同源资源', browser.requests.every(url => url.startsWith(base) || url.startsWith('data:') || url.startsWith('blob:')));
    console.log('RESULT ' + passed + ' tool order and select browser checks passed.');
} catch (error) {
    if (browser) console.error('拖放事件：', await browser.evaluate('window.__dragEvents').catch(() => null));
    if (browser) await screenshot('v060-ui-failure.png').catch(() => {});
    throw error;
} finally {
    await browser?.close(); server.closeAllConnections(); await new Promise(done => server.close(done));
    assert.ok(resolve(temporary).startsWith(resolve(tmpdir()) + sep) && temporary.includes('tt-tool-order-'));
    await removeBrowserFixture(temporary);
}
