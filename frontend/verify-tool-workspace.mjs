import { TOOLS } from './src/utils/tool-catalog.js';
const toolCount = TOOLS.length;
// 分组/标签浏览器验收：静态产物、合成只读接口、独立浏览器；不连接真实设备或团队库。
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { testBrowser, removeBrowserFixture, delay } from './verify-browser.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(new URL('../backend/package.json', import.meta.url));
const express = require('express'), app = express(), temporary = await mkdtemp(join(tmpdir(), 'tt-tool-workspace-'));
let networkReads = 0;
app.get('/api/documents/tree', (_req, res) => res.json({ items: [] }));
app.get('/api/documents', (_req, res) => res.json({ items: [], total: 0 }));
app.get('/api/network-speed/snapshot', (_req, res) => { networkReads++; res.status(503).json({ message: '隔离合成网卡暂未就绪' }); });
app.use('/api', (_req, res) => res.status(503).json({ message: '隔离验收不使用真实设备或团队数据' }));
const dist = resolve(process.env.VERIFY_DIST || join(root, 'frontend/dist'));
app.use(express.static(dist, { index: false })); app.get('/{*path}', (_req, res) => res.sendFile(join(dist, 'index.html')));
const server = await new Promise(done => { const listener = app.listen(0, '127.0.0.1', () => done(listener)); });
const base = `http://127.0.0.1:${server.address().port}`, groupKey = 'team-toolbox-tool-groups-v1', tabsKey = 'team-toolbox-open-tools-v1';
let browser, count = 0;
const check = (label, value = true) => { assert.ok(value, label); console.log(`PASS ${++count} ${label}`); };
const card = id => `.page-tools [data-tool-id="${id}"]`;
const group = id => `.page-tools [data-group-id="${id}"]`;
const tab = id => `.tool-tab[data-tab-id="${id}"]`;
async function navigate(path, ready) { await browser.send('Page.navigate', { url: base + path }); await browser.wait(ready || 'document.readyState==="complete"'); }
async function clickText(selector, text) { await browser.evaluate(`{const button=[...document.querySelectorAll(${JSON.stringify(selector)})].find(el=>el.textContent.trim()===${JSON.stringify(text)});if(!button)throw Error('missing button');button.click();}`); await delay(60); }
async function open(id, path) { await browser.click(card(id) + ' .tool-card-actions button'); await browser.wait(`location.pathname===${JSON.stringify(path)}&&!!document.querySelector('${tab(id)}')`); }
async function toolbox() { await browser.click('#tool-tab-toolbox'); await browser.wait("location.pathname==='/tools'&&!!document.querySelector('.page-tools')"); }
async function manageGroups() { await browser.evaluate("document.querySelector('#manage-tool-groups').focus()"); await browser.click('#manage-tool-groups'); }
async function reload() { await browser.send('Page.reload', { ignoreCache: true }); await browser.wait("!!document.querySelector('.page-tools')"); }
async function shot(name) { const result = await browser.send('Page.captureScreenshot', { format: 'png' }); await writeFile(join(root, 'build', name), Buffer.from(result.data, 'base64')); }
try {
    browser = await testBrowser(temporary);
    await navigate('/tools', "document.querySelectorAll('.page-tools .tool-card').length==="+toolCount+"");
    check('默认十八项工具按四组显示，仅一个固定工具箱标签', await browser.evaluate("document.querySelectorAll('.tool-group').length===4&&document.querySelectorAll('[role=tab]').length===1&&document.querySelector('[role=tab]').textContent.includes('工具箱')&&!document.querySelector('[data-tab-id=toolbox] .tool-tab-close')"));
    check('两项已移除工具没有卡片', await browser.evaluate("!document.querySelector('.page-tools').textContent.includes('ArtCraft')&&!document.querySelector('.page-tools').textContent.includes('FreeLLMAPI')"));
    await browser.click(group('media') + ' .tool-group-fold');
    check('分组可收起且仍保留数量和启用开关', await browser.evaluate(`!document.querySelector('${card('yoinks')}')&&document.querySelector('${group('media')} .tool-group-count').textContent==='6'`));
    await reload(); check('刷新保留收起状态', await browser.evaluate(`!document.querySelector('${card('yoinks')}')`));
    await browser.click(group('media') + ' .tool-group-fold');
    await browser.click(group('devices') + ' input[role=switch]');
    check('关闭分组隐藏其工具，分组开关仍在', await browser.evaluate(`!document.querySelector('${card('android-wireless')}')&&!document.querySelector('${group('devices')} input').checked`));
    await browser.evaluate('localStorage.setItem(\'team-toolbox-home-layout-v1\', JSON.stringify({"version": 1, "shortcuts": ["tool:android-wireless", "tool:yoinks", "tool:qrcode"], "showRecent": false}))');
    await navigate('/', "!!document.querySelector('.page-home')");
    check('关闭工具分组后仍显示首页固定项', await browser.evaluate("document.querySelectorAll('[data-home-shortcut]').length===3 && !!document.querySelector('[data-home-shortcut=\"tool:android-wireless\"]')"));
    await navigate('/tools', "!!document.querySelector('.page-tools')"); await browser.click(group('devices') + ' input[role=switch]');
    check('重新启用恢复设备工具', await browser.evaluate(`!!document.querySelector('${card('android-wireless')}')`));
    await manageGroups();
    check('管理弹窗Teleport到body且获得焦点', await browser.evaluate("document.querySelector('.ext-overlay').parentElement===document.body&&document.activeElement.getAttribute('role')==='dialog'"));
    await browser.fill('#new-tool-group', '媒体与相册'); await clickText('.tool-group-add button', '添加分组');
    check('拒绝重复分组名称且保留输入', await browser.evaluate("document.querySelector('.ext-dialog [role=alert]').textContent.includes('同名')&&document.querySelector('#new-tool-group').value==='媒体与相册'"));
    await browser.fill('#new-tool-group', '我的工具'); await clickText('.tool-group-add button', '添加分组');
    const custom = await browser.evaluate("[...document.querySelectorAll('[data-edit-group]')].find(el=>el.querySelector('input').value==='我的工具').dataset.editGroup"); assert.ok(custom);
    await browser.fill(`[data-edit-group="${custom}"] input`, '项目工具');
    await browser.click(`[aria-label="上移项目工具分组"]`); await browser.click('#save-tool-groups');
    await browser.wait("!document.querySelector('.ext-overlay')");
    check('创建、改名及移动分组保存成功', await browser.evaluate(`document.querySelector('${group(custom)}').textContent.includes('项目工具')&&JSON.parse(localStorage.getItem('${groupKey}')).groups.at(-2).id===${JSON.stringify(custom)}`));
    await browser.select(card('ratio-lock') + ' .ui-choice', custom); await delay(80);
    check('卡片选择可移入新分组', await browser.evaluate(`!!document.querySelector('${group(custom)} [data-tool-id="ratio-lock"]')`));
    await reload(); check('刷新保留自定义分组与归属', await browser.evaluate(`!!document.querySelector('${group(custom)} [data-tool-id="ratio-lock"]')`));
    await manageGroups(); await browser.fill(`[data-edit-group="${custom}"] input`, '不会保存'); await clickText('.ext-dialog button', '取消');
    check('取消编辑不改变分组且恢复管理按钮焦点', await browser.evaluate(`document.querySelector('${group(custom)}').textContent.includes('项目工具')&&document.activeElement.id==='manage-tool-groups'`));
    await manageGroups(); await browser.click('[aria-label="删除项目工具分组"]'); await browser.click('#save-tool-groups'); await browser.wait("!document.querySelector('.ext-overlay')");
    check('删除分组将工具放到未分组且不丢工具', await browser.evaluate("!!document.querySelector('[data-group-id=ungrouped] [data-tool-id=ratio-lock]')&&document.querySelectorAll('.page-tools .tool-card').length==="+toolCount+""));
    await browser.evaluate("window.__storageSet=Storage.prototype.setItem;Storage.prototype.setItem=function(){throw new DOMException('full','QuotaExceededError')}");
    await browser.click(group('media') + ' .tool-group-fold');
    check('偏好保存失败明确提示，当前折叠仍生效', await browser.evaluate(`document.querySelector('.page-tools [role=alert]').textContent.includes('未能保存')&&!document.querySelector('${card('yoinks')}')`));
    await browser.evaluate('Storage.prototype.setItem=window.__storageSet'); await browser.click('.page-tools [role=alert] button');
    check('重试保存后清除错误', await browser.evaluate("!document.querySelector('.page-tools [role=alert]')"));
    await browser.click(group('media') + ' .tool-group-fold');
    await open('ratio-lock', '/tools/ratio-lock');
    check('打开工具新增标签且默认工具箱标签保留', await browser.evaluate("document.querySelectorAll('[role=tab]').length===2&&document.querySelector('#tool-tab-ratio-lock').getAttribute('aria-selected')==='true'"));
    await toolbox(); await open('ratio-lock', '/tools/ratio-lock');
    check('重复打开复用已有标签', await browser.evaluate("document.querySelectorAll('[role=tab]').length===2"));
    await browser.evaluate('history.back()'); await browser.wait("location.pathname==='/tools'");
    await browser.evaluate('history.forward()'); await browser.wait("location.pathname==='/tools/ratio-lock'");
    check('浏览器前进后退同步当前标签且不重复', await browser.evaluate("document.querySelectorAll('[role=tab]').length===2&&document.querySelector('#tool-tab-ratio-lock').getAttribute('aria-selected')==='true'"));
    await toolbox(); await browser.click(group('ungrouped') + ' input[role=switch]');
    await browser.click('#tool-tab-ratio-lock'); await browser.wait("location.pathname==='/tools/ratio-lock'");
    check('关闭分组后已打开的工具标签继续可用', await browser.evaluate("!!document.querySelector('#tool-tab-ratio-lock[aria-selected=true]')&&document.querySelector('.page-tool .view-title')?.textContent==='比例锁定'"));
    await toolbox(); await browser.click(group('ungrouped') + ' input[role=switch]');
    await browser.send('Runtime.evaluate', { expression: "window.__workspacePeer=window.open('/tools','_blank')", userGesture: true });
    await browser.wait("!!window.__workspacePeer?.document.querySelector('.page-tools [data-tool-id=qrcode]')");
    await browser.evaluate("window.__workspacePeer.document.querySelector('[data-tool-id=qrcode] .tool-card-actions button').click()");
    await browser.wait("!!window.__workspacePeer.document.querySelector('#tool-tab-qrcode[aria-selected=true]')");
    check('浏览器标签页各自保存工具标签列表', await browser.evaluate("!document.querySelector('#tool-tab-qrcode')&&document.querySelectorAll('[role=tab]').length===2"));
    await browser.evaluate("window.__workspacePeer.document.querySelector('#tool-tab-toolbox').click()");
    await browser.wait("!!window.__workspacePeer.document.querySelector('[data-group-id=devices] input')");
    await browser.evaluate("window.__workspacePeer.document.querySelector('[data-group-id=devices] input').click()");
    await browser.wait(`!document.querySelector('${card('android-wireless')}')`);
    check('同源浏览器标签页同步分组开关', await browser.evaluate(`!document.querySelector('${group('devices')} input').checked`));
    await browser.evaluate("window.__workspacePeer.document.querySelector('[data-group-id=devices] input').click()");
    await browser.wait(`!!document.querySelector('${card('android-wireless')}')`);
    await browser.evaluate('window.__workspacePeer.close()');
    await toolbox(); await open('qrcode', '/tools/qrcode'); await toolbox(); await open('json-fmt', '/tools/json-fmt');
    await browser.click(tab('qrcode') + ' .tool-tab-close');
    check('关闭非当前标签保持当前页面', await browser.evaluate("location.pathname==='/tools/json-fmt'&&!document.querySelector('[data-tab-id=qrcode]')"));
    await browser.evaluate("document.querySelector('#tool-tab-json-fmt').dispatchEvent(new KeyboardEvent('keydown',{key:'Delete',bubbles:true}))");
    await browser.wait("location.pathname==='/tools/ratio-lock'");
    check('Delete关闭当前标签后切换到相邻工具', await browser.evaluate("!document.querySelector('[data-tab-id=json-fmt]')&&document.activeElement.id==='tool-tab-ratio-lock'"));
    await browser.evaluate("document.querySelector('#tool-tab-ratio-lock').dispatchEvent(new KeyboardEvent('keydown',{key:'Home',bubbles:true}))"); await browser.wait("location.pathname==='/tools'");
    check('键盘Home回到工具箱并移动焦点', await browser.evaluate("document.activeElement.id==='tool-tab-toolbox'"));
    await browser.evaluate("document.querySelector('#tool-tab-toolbox').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}))"); await browser.wait("location.pathname==='/tools/ratio-lock'");
    check('左右键切换工具标签', await browser.evaluate("document.activeElement.id==='tool-tab-ratio-lock'"));
    await browser.click(tab('ratio-lock') + ' .tool-tab-close'); await browser.wait("location.pathname==='/tools'");
    check('关闭最后工具回到固定工具箱', await browser.evaluate("document.querySelectorAll('[role=tab]').length===1"));
    await open('qrcode', '/tools/qrcode'); await toolbox(); await open('ratio-lock', '/tools/ratio-lock'); await toolbox();
    await navigate('/', "!!document.querySelector('.page-home')");
    await browser.evaluate("[...document.querySelectorAll('.page-home .tool-card')].find(el=>el.textContent.includes('二维码生成')).querySelector('button').click()"); await browser.wait("location.pathname==='/tools/qrcode'");
    check('从首页打开工具也复用已有标签', await browser.evaluate("document.querySelectorAll('[data-tab-id=qrcode]').length===1&&document.querySelectorAll('[role=tab]').length===3"));
    await browser.send('Page.reload', { ignoreCache: true }); await browser.wait("!!document.querySelector('#tool-tab-qrcode')");
    check('刷新保留工具列表和当前标签', await browser.evaluate(`document.querySelectorAll('[role=tab]').length===3&&document.querySelector('#tool-tab-qrcode').getAttribute('aria-selected')==='true'&&JSON.parse(sessionStorage.getItem('${tabsKey}')).length===2`));
    await toolbox(); await open('network-speed', '/tools/network-speed');
    for (let i=0;i<50&&networkReads===0;i++) await delay(100); assert.ok(networkReads);
    await browser.click(tab('network-speed') + ' .tool-tab-close'); await browser.wait("location.pathname==='/tools/ratio-lock'");
    const before = networkReads; await delay(3000);
    check('关闭实时工具正常卸载并停止轮询', networkReads === before);
    await toolbox();
    await browser.evaluate("window.__storageSet=Storage.prototype.setItem;Storage.prototype.setItem=function(){throw new DOMException('full','QuotaExceededError')}");
    await open('json-fmt', '/tools/json-fmt');
    check('标签保存失败仍可打开且明确提示', await browser.evaluate("document.querySelector('.tool-tabs-message').textContent.includes('未能保存')"));
    await browser.evaluate('Storage.prototype.setItem=window.__storageSet'); await browser.click('.tool-tabs-message button');
    check('标签保存支持重试', await browser.evaluate("!document.querySelector('.tool-tabs-message')"));
    await toolbox();
    const ids = await browser.evaluate("[...document.querySelectorAll('.page-tools [data-tool-id]')].map(el=>el.dataset.toolId)");
    await browser.evaluate(`sessionStorage.setItem('${tabsKey}',JSON.stringify([...${JSON.stringify(ids)},'artcraft','freellmapi','ratio-lock','unknown']))`); await reload();
    check('旧标签过滤退休/未知及重复ID', await browser.evaluate("document.querySelectorAll('[role=tab]').length==="+(toolCount+1)+"&&!document.querySelector('[data-tab-id=artcraft]')&&!document.querySelector('[data-tab-id=freellmapi]')"));
    for (const theme of ['dark', 'light']) {
        await browser.evaluate(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`); await delay(300);
        for (const width of [1280, 1600]) {
            await browser.send('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: false });
            await browser.click('#tool-tab-qrcode'); await browser.wait("location.pathname==='/tools/qrcode'");
            check(`${theme} ${width}px 多标签横向滚动且当前关闭按钮可见`, await browser.evaluate("(()=>{const bar=document.querySelector('.tool-tabs').getBoundingClientRect(),current=document.querySelector('[data-tab-id=qrcode]').getBoundingClientRect();return current.left>=bar.left-1&&current.right<=bar.right+1&&document.querySelector('.main-content').scrollWidth<=document.querySelector('.main-content').clientWidth+1})()"));
            await toolbox();
            check(`${theme} ${width}px 分组和卡片无横向溢出`, await browser.evaluate("[...document.querySelectorAll('.page-tools,.tool-group,.tool-card')].every(el=>el.scrollWidth<=el.clientWidth+1)"));
        }
        await shot(`tool-workspace-${theme}.png`); await manageGroups();
        check(`${theme} 管理弹窗居中且文字与菜单可见`, await browser.evaluate("(()=>{const r=document.querySelector('.ext-dialog').getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight&&Math.abs((r.left+r.right)/2-innerWidth/2)<3})()"));
        await shot(`tool-groups-${theme}.png`);
        await browser.evaluate("document.querySelector('.ext-dialog').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))"); await browser.wait("!document.querySelector('.ext-overlay')");
    }
    for (const old of ['freellmapi', 'artcraft']) { await navigate('/tools/' + old, "location.pathname==='/tools'&&!!document.querySelector('.page-tools')"); check(`旧${old}地址回工具箱`, await browser.evaluate("!!document.querySelector('#tool-tab-toolbox[aria-selected=true]')")); }
    await browser.evaluate(`localStorage.setItem('${groupKey}','bad');sessionStorage.setItem('${tabsKey}','bad')`); await reload();
    check('损坏分组和标签偏好回到默认', await browser.evaluate("document.querySelectorAll('.page-tools .tool-card').length==="+toolCount+"&&document.querySelectorAll('[role=tab]').length===1"));
    const injected = await browser.send('Page.addScriptToEvaluateOnNewDocument', { source: "Object.defineProperty(window,'localStorage',{get(){throw new DOMException('blocked','SecurityError')}});Object.defineProperty(window,'sessionStorage',{get(){throw new DOMException('blocked','SecurityError')}});" });
    await reload(); await open('ratio-lock', '/tools/ratio-lock');
    check('存储完全禁用仍可打开工具和标签', await browser.evaluate("!!document.querySelector('#tool-tab-ratio-lock')&&document.querySelector('.page-tool .view-title')?.textContent==='比例锁定'"));
    await browser.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: injected.identifier });
    check('没有浏览器脚本异常', browser.errors.length === 0);
    check('不访问真实外站或已移除工具API', browser.requests.filter(url => /^https?:/.test(url)).every(url => url.startsWith(base) && !/\/api\/integrations\/(freellmapi|artcraft)/.test(url)));
    console.log(`RESULT ${count}/${count} tool workspace browser checks passed; isolated UI only.`);
} catch (error) { if (browser) await shot('tool-workspace-failure.png').catch(() => {}); throw error; }
finally { await browser?.close(); server.closeAllConnections(); await new Promise(done => server.close(done)); await removeBrowserFixture(temporary); }
