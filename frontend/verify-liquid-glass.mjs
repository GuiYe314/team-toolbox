import { TOOLS } from './src/utils/tool-catalog.js';
const toolCount = TOOLS.length;
// 液态玻璃：隔离静态页面、只读空数据、临时浏览器，不运行真实设备或更新。
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { testBrowser, removeBrowserFixture, delay } from './verify-browser.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(new URL('../backend/package.json', import.meta.url));
const app = require('express')(), temporary = await mkdtemp(join(tmpdir(), 'tt-liquid-glass-'));
const dist = resolve(process.env.VERIFY_DIST || join(root, 'frontend/dist'));
assert.ok(existsSync(join(dist, 'index.html')), '请先构建前端');
app.get('/api/documents/tree', (_req, res) => res.json({ items: [] }));
app.get('/api/documents', (_req, res) => res.json({ items: [], total: 0 }));
app.get('/api/android/config', (_req, res) => res.json({ configured: false, available: true }));
app.get('/api/android/commands', (_req, res) => res.json({ commands: [] }));
app.use('/api', (_req, res) => res.status(503).json({ message: '隔离视觉检查不访问实际数据或设备' }));
app.use(require('express').static(dist, { index: false }));
app.get('/{*path}', (_req, res) => res.sendFile(join(dist, 'index.html')));
const server = await new Promise(done => { const listener = app.listen(0, '127.0.0.1', () => done(listener)); });
const base = `http://127.0.0.1:${server.address().port}`;
let browser, count = 0;
function check(label, condition) { assert.ok(condition, label); console.log(`PASS ${++count} ${label}`); }
const colorChannels = value => value.match(/[\d.]+/g)?.map(Number);
async function screenshot(name) { const image = await browser.send('Page.captureScreenshot', { format: 'png' }); await writeFile(join(root, 'build', `liquid-glass-${name}.png`), Buffer.from(image.data, 'base64')); }
async function navigate(path, selector) { await browser.send('Page.navigate', { url: base + path }); await browser.wait(`!!document.querySelector(${JSON.stringify(selector)})`); }
const contrastScript = `(() => {
    const rgb = value => value.match(/[\\d.]+/g).map(Number).slice(0, 3).map(channel => channel / 255);
    const luminance = value => rgb(value).map(channel => channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4).reduce((sum, channel, index) => sum + channel * [.2126, .7152, .0722][index], 0);
    return [...document.querySelectorAll('select')].every(select => [select, ...select.querySelectorAll('option')].every(el => {
        const style = getComputedStyle(el), a = luminance(style.color), b = luminance(style.backgroundColor);
        return (Math.max(a, b) + .05) / (Math.min(a, b) + .05) >= 4.5;
    }));
})()`;

try {
    await mkdir(join(root, 'build'), { recursive: true });
    browser = await testBrowser(temporary);
    await navigate('/tools', '.page-tools');
    if (!await browser.evaluate("localStorage.getItem('tt-theme')")) await browser.click('.theme-toggle');
    for (const theme of ['light', 'dark']) {
        if (await browser.evaluate('document.documentElement.dataset.theme') !== theme) await browser.click('.theme-toggle');
        await browser.wait(`document.documentElement.dataset.theme==='${theme}'`);
        await delay(300);
        check(`${theme} 主题通过原有入口切换并保存`, await browser.evaluate(`localStorage.getItem('tt-theme')==='${theme}'`));
        for (const width of [1700, 1280]) {
            await browser.send('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: false });
            await navigate('/tools', '.page-tools');
            const frame = await browser.evaluate("({cards:document.querySelectorAll('.tool-card').length,panes:['.main-sidebar','.main-content','.page-tools'].map(selector=>{const el=document.querySelector(selector);return {selector,visible:el.checkVisibility(),scroll:el.scrollWidth,width:el.clientWidth};})})");
            check(`${theme}/${width} 工具卡片、标签与导航可见且正文无横向溢出 ${JSON.stringify(frame)}`, frame.cards === toolCount && frame.panes.every(pane => pane.visible && pane.scroll <= pane.width + 1));
            check(`${theme}/${width} 框架底部留在视口内，导航选中项不裁边`, await browser.evaluate("{const layout=document.querySelector('.app-layout').getBoundingClientRect(),sidebar=document.querySelector('.main-sidebar').getBoundingClientRect(),nav=document.querySelector('.nav-item.is-active').getBoundingClientRect();layout.bottom<=innerHeight+1&&nav.left>sidebar.left&&nav.right<sidebar.right;}"));
            check(`${theme}/${width} 内层卡片、按钮及标签不叠加背景模糊`, await browser.evaluate("[...document.querySelectorAll('.tool-card,.tool-glyph,.btn,.tool-tab,.tool-group')].every(el=>getComputedStyle(el).backdropFilter==='none')"));
            check(`${theme}/${width} 工具归属原生菜单达到4.5文字对比度`, await browser.evaluate(contrastScript));
            await screenshot(`tools-${theme}-${width}`);
            await browser.click('#manage-tool-groups'); await browser.wait("!!document.querySelector('[role=dialog]')");
            check(`${theme}/${width} 分组弹窗仍在body下并完整居中`, await browser.evaluate("{const d=document.querySelector('[role=dialog]'),o=d.parentElement,r=d.getBoundingClientRect(),b=o.getBoundingClientRect();o.parentElement===document.body&&b.x===0&&b.y===0&&Math.abs(b.width-innerWidth)<1&&Math.abs(b.height-innerHeight)<1&&Math.abs((r.left+r.right)/2-innerWidth/2)<2&&r.top>=0&&r.bottom<=innerHeight;}"));
            await browser.evaluate("document.querySelector('[role=dialog]').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))"); await browser.wait("!document.querySelector('[role=dialog]')");
        }
        await navigate('/tools/android-wireless', '.adb-page');
        await browser.wait("document.querySelectorAll('.adb-tool-section-toggle').length===6&&!!document.querySelector('#adb-command-reload')");
        await browser.evaluate("document.querySelectorAll('.adb-tool-section-toggle').forEach(button=>button.click())");
        await browser.wait("document.querySelectorAll('.adb-tool-section-toggle[aria-expanded=false]').length===6");
        const sections = await browser.evaluate("[...document.querySelectorAll('.adb-tool-section')].map(el=>({title:el.querySelector('h2').textContent,visible:el.querySelector('h2').checkVisibility(),scroll:el.scrollWidth,width:el.clientWidth}))");
        check(`${theme} 六个收放开关保留原行为和清晰标题 ${JSON.stringify(sections)}`, sections.length === 6 && sections.every(section => section.visible && section.scroll <= section.width + 1));
        await screenshot(`android-${theme}`);
        await browser.evaluate("document.querySelector('#adb-commands-toggle').focus()");
        const focusNode = await browser.send('DOM.getDocument');
        const focusButton = await browser.send('DOM.querySelector', { nodeId: focusNode.root.nodeId, selector: '#adb-commands-toggle' });
        await browser.send('DOM.enable'); await browser.send('CSS.enable');
        await browser.send('CSS.forcePseudoState', { nodeId: focusButton.nodeId, forcedPseudoClasses: ['focus-visible'] });
        await delay(200);
        const focus = await browser.evaluate("({id:document.activeElement.id,shadow:getComputedStyle(document.activeElement).boxShadow,border:getComputedStyle(document.activeElement).borderColor,accent:getComputedStyle(document.documentElement).getPropertyValue('--accent-border').trim()})");
        check(`${theme} 键盘焦点仍有明确描边 ${JSON.stringify(focus)}`, focus.id === 'adb-commands-toggle' && focus.shadow !== 'none' && JSON.stringify(colorChannels(focus.border)) === JSON.stringify(colorChannels(focus.accent)));
        await browser.send('CSS.forcePseudoState', { nodeId: focusButton.nodeId, forcedPseudoClasses: [] });
        await browser.click('#adb-help'); await browser.wait("!!document.querySelector('.adb-help-dialog')");
        check(`${theme} 帮助弹窗保持视口定位与可滚动正文`, await browser.evaluate("{const d=document.querySelector('.adb-help-dialog'),r=d.getBoundingClientRect();d.parentElement.parentElement===document.body&&r.top>=0&&r.bottom<=innerHeight&&d.querySelector('.adb-help-body').scrollHeight>d.querySelector('.adb-help-body').clientHeight;}"));
        await screenshot(`help-${theme}`);
        await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-transparency', value: 'reduce' }, { name: 'prefers-reduced-motion', value: 'reduce' }] });
        check(`${theme} 减少透明度改为实底并关闭背景模糊`, await browser.evaluate("matchMedia('(prefers-reduced-transparency: reduce)').matches&&[...document.querySelectorAll('.glass-panel,.dialog,.overlay')].every(el=>getComputedStyle(el).backdropFilter==='none')&&getComputedStyle(document.querySelector('.app-backdrop')).display==='none'&&[...document.querySelectorAll('.glass-panel,.dialog')].every(el=>!getComputedStyle(el).backgroundColor.startsWith('rgba'))"));
        check(`${theme} 减少动态效果关闭过渡与动画`, await browser.evaluate("[document.body,document.querySelector('.btn'),document.querySelector('.theme-toggle')].every(el=>getComputedStyle(el).transitionDuration==='0s'&&getComputedStyle(el).animationName==='none')"));
        await screenshot(`accessible-${theme}`);
        await browser.send('Emulation.setEmulatedMedia', { features: [] });
        await browser.click('#adb-help-close');
        await navigate('/tools', '.page-tools');
    }
    check('无浏览器脚本异常', browser.errors.length === 0);
    check('全部HTTP请求仅访问隔离服务，无外部视觉依赖', browser.requests.filter(url=>/^https?:/.test(url)).every(url=>url.startsWith(base)));
    console.log(`RESULT ${count}/${count} liquid glass checks passed; isolated UI only.`);
} catch (error) { if (browser) await screenshot('failure').catch(() => {}); throw error; }
finally { await browser?.close(); server.closeAllConnections(); await new Promise(done => server.close(done)); await removeBrowserFixture(temporary); }
