// 真实指针/键盘与隔离合成文档；不连接手机、不读取或修改用户数据库。
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { testBrowser, removeBrowserFixture, delay } from './verify-browser.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(new URL('../backend/package.json', import.meta.url));
const app = require('express')(), temporary = await mkdtemp(join(tmpdir(), 'tt-click-feedback-'));
const dist = resolve(process.env.VERIFY_DIST || join(root, 'frontend/dist'));
const docs = [{ id: 1, title: '反馈验收目录', parent_id: null, version: 1, tags: ['unity'], content_md: '仅供隔离验收', updated_at: '2026-11-17T00:00:00Z' }, { id: 2, title: '反馈验收子页', parent_id: 1, version: 1, tags: ['unity'], content_md: '合成子页', updated_at: '2026-11-17T00:00:00Z' }];
let mutations = 0;
app.get('/api/documents/tree', (_req, res) => res.json({ items: docs }));
app.get('/api/documents', (_req, res) => res.json({ items: docs, total: docs.length }));
app.get('/api/documents/:id/children', (req, res) => res.json({ items: docs.filter(doc => doc.parent_id === Number(req.params.id)) }));
app.get('/api/documents/:id', (req, res) => res.json(docs.find(doc => doc.id === Number(req.params.id))));
app.get('/api/tags', (_req, res) => res.json([{ id: 1, name: 'unity' }]));
app.get('/api/categories', (_req, res) => res.json([]));
app.post('/api/markdown/render', (_req, res) => res.json({ html: '<p>合成文档正文</p>' }));
app.get('/api/android/config', (_req, res) => res.json({ configured: false, available: true }));
app.get('/api/android/commands', (_req, res) => res.json({ commands: [] }));
app.use('/api', (req, res) => { if (!['GET', 'HEAD'].includes(req.method)) mutations++; res.status(503).json({ message: '隔离反馈验收不执行业务写操作' }); });
app.use(require('express').static(dist, { index: false }));
app.get('/{*path}', (_req, res) => res.sendFile(join(dist, 'index.html')));
const server = await new Promise(done => { const listener = app.listen(0, '127.0.0.1', () => done(listener)); });
const base = `http://127.0.0.1:${server.address().port}`;
let browser, count = 0;
function check(label, value) { assert.ok(value, label); console.log(`PASS ${++count} ${label}`); }
const feedbackInfo = `(() => { const frame = document.querySelector('.click-feedback'), wave = frame?.firstElementChild; if (!frame) return null; const style = getComputedStyle(wave); return { body: frame.parentElement === document.body, hidden: frame.getAttribute('aria-hidden'), pointer: getComputedStyle(frame).pointerEvents, count: document.querySelectorAll('.click-feedback').length, left: parseFloat(wave.style.left), top: parseFloat(wave.style.top), width: frame.getBoundingClientRect().width, height: frame.getBoundingClientRect().height, animation: style.animationName, duration: style.animationDuration, fill: style.backgroundImage, opacity: style.opacity, transform: style.transform }; })()`;
async function navigate(path, selector) { await browser.send('Page.navigate', { url: base + path }); await browser.wait(`!!document.querySelector(${JSON.stringify(selector)})`); await delay(220); }
async function pointer(selector, ratio = .22, pointerType = 'mouse') {
    await browser.evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'nearest',inline:'nearest'})`);
    await delay(40);
    const rect = await browser.evaluate(`{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();({x:r.left+r.width*${ratio},y:r.top+r.height/2});}`);
    if (pointerType === 'touch') {
        await browser.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: rect.x, y: rect.y }] });
        await browser.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else {
        await browser.send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...rect });
        await browser.send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...rect });
    }
    return browser.evaluate(`new Promise(resolve => requestAnimationFrame(() => resolve(${feedbackInfo})))`);
}
async function key(selector, keyName, code, virtualCode, text) {
    await delay(220);
    await browser.evaluate(`document.querySelector(${JSON.stringify(selector)}).focus()`);
    await browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: keyName, code, windowsVirtualKeyCode: virtualCode, text, unmodifiedText: text });
    await browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: keyName, code, windowsVirtualKeyCode: virtualCode });
    return browser.evaluate(feedbackInfo);
}
async function screenshot(name) {
    const shot = await browser.send('Page.captureScreenshot', { format: 'png' });
    await writeFile(join(root, 'build', `click-feedback-${name}.png`), Buffer.from(shot.data, 'base64'));
}
try {
    await mkdir(join(root, 'build'), { recursive: true });
    browser = await testBrowser(temporary);
    await navigate('/tools', '#manage-tool-groups');
    for (const theme of ['light', 'dark']) {
        if (await browser.evaluate('document.documentElement.dataset.theme') !== theme) await browser.click('.theme-toggle');
        await delay(300);
        const before = await browser.evaluate("document.querySelector('.tool-group-fold').getAttribute('aria-expanded')");
        const mouse = await pointer('.tool-group-fold');
        check(`${theme} 真实鼠标点击从落点绘制一次水波纹`, mouse?.count === 1 && Math.abs(mouse.left / mouse.width - .22) < .03 && mouse.animation === 'click-feedback-wave' && Number.parseFloat(mouse.duration) <= .18);
        check(`${theme} 绘制层在body下且不拦截事件、不进入读屏`, mouse.body && mouse.pointer === 'none' && mouse.hidden === 'true');
        check(`${theme} 原分组收放只改变一次状态`, await browser.evaluate(`document.querySelector('.tool-group-fold').getAttribute('aria-expanded')!==${JSON.stringify(before)}`));
        await delay(230);
        check(`${theme} 动画结束清理节点`, await browser.evaluate("document.querySelectorAll('.click-feedback').length===0"));
        const enter = await key('.tool-group-fold', 'Enter', 'Enter', 13, '\r');
        check(`${theme} Enter激活从控件中心扩散`, enter && Math.abs(enter.left / enter.width - .5) < .01 && Math.abs(enter.top / enter.height - .5) < .01);
        const space = await key('.tool-group-fold', ' ', 'Space', 32, ' ');
        check(`${theme} 空格激活保留原按钮功能`, !!space && await browser.evaluate(`document.querySelector('.tool-group-fold').getAttribute('aria-expanded')!==${JSON.stringify(before)}`));
        // 仅冻结验收截图中的绘制时间；正式效果仍是180ms且自动释放。
        await delay(230);
        await browser.evaluate(`(async () => { document.querySelector('.tool-group-fold').click(); await Promise.resolve(); const a=document.querySelector('.click-feedback-wave').getAnimations()[0];a.pause();a.currentTime=65; })()`);
        await screenshot(theme);
        await delay(220);
        await pointer('#manage-tool-groups'); await browser.wait("!!document.querySelector('[role=dialog]')"); await delay(220);
        const primary = await pointer('#save-tool-groups');
        const saved = await browser.evaluate("({closed:!document.querySelector('[role=dialog]'),focus:document.activeElement.id})");
        check(`${theme} 弹窗保存一次并及时移除消失目标的效果 ${JSON.stringify({ primary, saved })}`, primary === null && saved.closed && saved.focus === 'manage-tool-groups');
        check(`${theme} 保存后原控件未被附加布局或子节点`, await browser.evaluate("!document.querySelector('#manage-tool-groups .click-feedback')&&getComputedStyle(document.querySelector('#manage-tool-groups')).overflow==='visible'"));
    }
    await navigate('/kb', '.kb-page');
    const tag = await pointer('.kb-tag-filter .tag');
    check('标签选择有反馈且仍保留明确选中状态', tag && await browser.evaluate("document.querySelector('.kb-tag-filter .tag').classList.contains('is-active')"));
    await delay(220);
    const nav = await pointer('.nav-item[href="/tools"]');
    check('侧栏导航切换保留选中底色与点击反馈', nav && await browser.evaluate("location.pathname==='/tools'&&document.querySelector('.nav-item[href=\"/tools\"]').classList.contains('is-active')"));
    await browser.click('[data-tool-id="android-wireless"] .btn'); await browser.wait("!!document.querySelector('#adb-commands-toggle')"); await delay(220);
    const touch = await pointer('#adb-commands-toggle', .3, 'touch');
    check('原生触摸激活有反馈并只收放一次', touch && await browser.evaluate("document.querySelector('#adb-commands-toggle').getAttribute('aria-expanded')==='false'"));
    const tab = await pointer('#tool-tab-toolbox');
    check('工具标签切换有反馈且选中状态保留', tab && await browser.evaluate("location.pathname==='/tools'&&document.querySelector('#tool-tab-toolbox').getAttribute('aria-selected')==='true'"));
    await navigate('/kb/1', '.doc-title');
    const role = await key('.tree-row', 'Enter', 'Enter', 13, '\r');
    check('页面树自定义role按钮键盘激活一次中心波纹', role && Math.abs(role.left / role.width - .5) < .01);
    await delay(220);
    const stopped = await pointer('.tree-caret[aria-expanded]');
    check('使用stop的子按钮只生成一个自己的反馈', stopped?.count === 1 && stopped.width < 40);
    await navigate('/tools', '.page-tools');
    await browser.click('#manage-tool-groups'); await browser.wait("!!document.querySelector('#new-tool-group')"); await delay(220);
    const disabled = await browser.evaluate("(async()=>{document.querySelector('[role=dialog] button:disabled').dispatchEvent(new MouseEvent('click',{bubbles:true}));await Promise.resolve();return !document.querySelector('.click-feedback')})()");
    check('禁用按钮即使收到合成click也不绘制', disabled);
    const input = await pointer('#new-tool-group');
    check('输入框不绘制且正常得到焦点', input === null && await browser.evaluate("document.activeElement.id==='new-tool-group'"));
    await browser.evaluate("document.querySelector('[role=dialog]').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))"); await delay(220);
    await browser.evaluate(`{
        const fixture=document.createElement('section');fixture.id='feedback-fixture';fixture.style.cssText='position:fixed;left:600px;top:120px;z-index:55;';
        for(let i=0;i<6;i++){const b=document.createElement('button');b.id='feedback-test-'+i;b.textContent='隔离测试 '+i;b.className='btn';b.addEventListener('click',()=>window.feedbackExecutions=(window.feedbackExecutions||0)+1);fixture.append(b);}
        document.body.append(fixture);
    }`);
    const primaryColor = await browser.evaluate(`(async()=>{const b=document.querySelector('#feedback-test-0');b.classList.add('btn-primary');b.click();await Promise.resolve();const wave=document.querySelector('.click-feedback-wave'),frame=wave.parentElement;const result=frame.classList.contains('click-feedback--primary')&&getComputedStyle(wave).backgroundImage.includes('255, 255, 255');b.classList.remove('btn-primary');return result;})()`);
    check('主按钮使用明亮波纹保持文字可读', primaryColor);
    await delay(220);
    await browser.evaluate(`{
        const box=document.createElement('div');box.id='feedback-clip';box.style.cssText='position:fixed;left:500px;top:200px;width:50px;height:40px;overflow:hidden';
        const b=document.createElement('button');b.className='btn';b.style.width='100px';b.textContent='裁切验证';box.append(b);document.body.append(box);
    }`);
    check('绘制遵守原滚动/裁切容器边界', await browser.evaluate("(async()=>{document.querySelector('#feedback-clip button').click();await Promise.resolve();const frame=document.querySelector('.click-feedback');return frame&&getComputedStyle(frame).clipPath.includes('50px');})()"));
    await delay(220); await browser.evaluate("document.querySelector('#feedback-clip').remove();window.feedbackExecutions=0");
    const rapid = await browser.evaluate(`(async()=>{for(let i=0;i<60;i++)document.querySelector('#feedback-test-'+i%6).click();await Promise.resolve();return {count:document.querySelectorAll('.click-feedback').length,executions:window.feedbackExecutions};})()`);
    check('60次快速点击最多保留4个效果且不重复执行操作', rapid.count === 4 && rapid.executions === 60);
    await delay(230);
    check('快速点击后全部节点自动回收', await browser.evaluate("!document.querySelector('.click-feedback')"));
    for (const attribute of ['aria-disabled', 'data-click-feedback']) {
        const value = attribute === 'aria-disabled' ? 'true' : 'off';
        check(`${attribute} 显式禁用反馈`, await browser.evaluate(`(async()=>{const b=document.querySelector('#feedback-test-0');b.setAttribute('${attribute}','${value}');b.click();await Promise.resolve();b.removeAttribute('${attribute}');return !document.querySelector('.click-feedback');})()`));
    }
    check('第三方编辑器和画布按钮不叠加反馈', await browser.evaluate("(async()=>{const f=document.querySelector('#feedback-fixture');for(const name of ['vditor','excalidraw','monaco-editor']){f.className=name;f.firstChild.click();await Promise.resolve();if(document.querySelector('.click-feedback'))return false;}f.className='';return true;})()"));
    for (const event of ['scroll', 'resize', 'pagehide', 'dragstart']) {
        check(`${event} 及时清理活动绘制`, await browser.evaluate(`(async()=>{document.querySelector('#feedback-test-0').click();await Promise.resolve();const visible=!!document.querySelector('.click-feedback');${event === 'dragstart' ? 'document' : 'window'}.dispatchEvent(new Event('${event}'));await Promise.resolve();return visible&&!document.querySelector('.click-feedback');})()`));
    }
    check('进入后台清理且后台新点击不绘制', await browser.evaluate("(async()=>{document.querySelector('#feedback-test-0').click();await Promise.resolve();Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));document.querySelector('#feedback-test-0').click();await Promise.resolve();const empty=!document.querySelector('.click-feedback');delete document.hidden;return empty;})()"));
    for (const feature of ['prefers-reduced-motion', 'prefers-reduced-transparency']) {
        await browser.click('#feedback-test-0');
        await browser.send('Emulation.setEmulatedMedia', { features: [{ name: feature, value: 'reduce' }] });
        await browser.wait(`matchMedia('(${feature}: reduce)').matches&&!document.querySelector('.click-feedback')`);
        await browser.click('#feedback-test-0');
        check(`${feature} 清理已有并阻止新动画`, await browser.evaluate("!document.querySelector('.click-feedback')"));
        await browser.send('Emulation.setEmulatedMedia', { features: [] });
        await browser.wait(`!matchMedia('(${feature}: reduce)').matches`);
    }
    const restored = await pointer('#feedback-test-0');
    check('辅助偏好关闭后真实指针点击正常恢复', !!restored);
    await delay(220); await browser.evaluate("document.querySelector('#feedback-fixture').remove()");
    await browser.click('.tool-group-fold'); await browser.click('.nav-item[href="/kb"]'); await browser.wait("!!document.querySelector('.kb-page')");
    await delay(230);
    check('原页面卸载后没有遗留绘制', await browser.evaluate("!document.querySelector('.click-feedback')"));
    check('没有业务写请求或脚本异常', mutations === 0 && browser.errors.length === 0);
    check('所有请求均访问隔离本地服务', browser.requests.filter(url => /^https?:/.test(url)).every(url => url.startsWith(base)));
    console.log(`RESULT ${count}/${count} click feedback checks passed; isolated UI only.`);
} catch (error) { if (browser) await screenshot('failure').catch(() => {}); throw error; }
finally { await browser?.close(); server.closeAllConnections(); await new Promise(done => server.close(done)); await removeBrowserFixture(temporary); }
