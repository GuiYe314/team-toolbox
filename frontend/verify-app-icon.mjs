// 图标选择验收：只使用隔离静态服务、合成配置与临时无头浏览器。
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_ICONS, APP_ICON_STORAGE_KEY, DEFAULT_APP_ICON_ID } from './src/utils/app-icon.js';
import { testBrowser, removeBrowserFixture, delay } from './verify-browser.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(new URL('../backend/package.json', import.meta.url));
const express = require('express'), app = express();
const temporary = await mkdtemp(join(tmpdir(), 'tt-app-icon-'));
const dist = resolve(process.env.VERIFY_DIST || join(root, 'frontend/dist'));
assert.ok(existsSync(join(dist, 'index.html')), '先构建前端');
let updateFailure = false, imageFailure = false;
const updateStatus = { current: '0.6.0', configured: true, sourceOrigin: 'default', source: 'https://github.com/GuiYe314/team-toolbox/releases/latest/download', defaultSource: 'https://github.com/GuiYe314/team-toolbox/releases/latest/download', lastCheck: null };
const writes = [];
app.use((req, _res, next) => { if (req.method !== 'GET') writes.push(req.method + ' ' + req.path); next(); });
app.get('/api/documents/tree', (_req, res) => res.json({ items: [] }));
app.get('/api/documents', (_req, res) => res.json({ items: [], total: 0 }));
app.get('/api/update/status', (_req, res) => updateFailure ? res.status(503).json({ message: '隔离更新状态失败' }) : res.json(updateStatus));
app.get('/api/android/config', (_req, res) => res.json({ configured: false, origin: 'none', path: '', directory: '' }));
app.use('/api', (_req, res) => res.status(503).json({ message: '隔离服务不使用真实团队数据' }));
app.use('/icons', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (imageFailure && req.path === '/ink-cat/04-cat-window-256.png') return res.status(503).end();
    next();
});
app.use(express.static(dist, { index: false }));
app.get('/{*path}', (_req, res) => res.sendFile(join(dist, 'index.html')));
const server = await new Promise(done => { const listener = app.listen(0, '127.0.0.1', () => done(listener)); });
const base = 'http://127.0.0.1:' + server.address().port;
const quotedKey = JSON.stringify(APP_ICON_STORAGE_KEY);
let browser, passed = 0;
const check = (name, condition = true) => { assert.ok(condition, name); console.log('PASS ' + (++passed) + ' ' + name); };
const checkedId = () => browser.evaluate("document.querySelector('[name=app-icon]:checked')?.value");
async function ready() {
    await browser.wait("document.querySelectorAll('[name=app-icon]').length===5 && !document.querySelector('.state-loading')");
    await browser.wait("document.querySelector('.brand-mark')?.complete&&document.querySelector('.brand-mark').naturalWidth>0");
}
async function reload() {
    await browser.send('Page.reload', { ignoreCache: true });
    await ready();
}
async function choose(id) {
    await browser.click(`[data-icon-option="${id}"] input`);
    await browser.wait(`document.querySelector('.brand-mark')?.dataset.appIconId===${JSON.stringify(id)}&&document.querySelector('.brand-mark').complete&&document.querySelector('.brand-mark').naturalWidth>0`);
}
async function synced(icon) {
    return browser.evaluate(`(()=>{
        const icon=${JSON.stringify(icon)}, mark=document.querySelector('.brand-mark');
        const links=[...document.querySelectorAll('link[rel="icon"]')];
        return mark.dataset.appIconId===icon.id && mark.getAttribute('src')===icon.image && mark.complete && mark.naturalWidth>0 &&
            links.length===3 && links.every(e=>[icon.ico,icon.favicon,icon.vector].includes(e.getAttribute('href'))) &&
            document.querySelector('link[data-app-icon="vector"]').type===(icon.vector?'image/svg+xml':'image/png') &&
            document.querySelector('link[rel="apple-touch-icon"]').getAttribute('href')===icon.touch;
    })()`);
}
async function screenshot(name) {
    await mkdir(join(root, 'build'), { recursive: true });
    const result = await browser.send('Page.captureScreenshot', { format: 'png' });
    await writeFile(join(root, 'build', name), Buffer.from(result.data, 'base64'));
}
try {
    browser = await testBrowser(temporary);
    await browser.send('Network.setCacheDisabled', { cacheDisabled: true });
    await browser.send('Page.navigate', { url: base + '/settings' });
    await ready();
    await browser.wait("[...document.querySelectorAll('.app-icon-preview,.brand-mark')].every(e=>e.complete&&e.naturalWidth>0)");
    check('设置含默认项和四款已解码的小猫预览', await checkedId() === DEFAULT_APP_ICON_ID);
    check('首次访问使用默认侧栏和全部浏览器图标', await synced(APP_ICONS[0]));
    for (const icon of APP_ICONS.slice(1)) {
        await choose(icon.id);
        await browser.wait("document.querySelector('.brand-mark').complete&&document.querySelector('.brand-mark').naturalWidth>0");
        check(icon.name + ' 同步侧栏、全部 favicon 和触摸图标', await synced(icon));
        check(icon.name + ' 保存 ID 并提供当前 ICO 下载', await browser.evaluate(`localStorage.getItem(${quotedKey})===${JSON.stringify(icon.id)}&&document.querySelector('.app-icon-download').getAttribute('href')===${JSON.stringify(icon.ico)}&&!!document.querySelector('.app-icon-download').download`));
        const urls = [icon.image, icon.favicon, icon.touch, icon.ico, icon.image.replace('-256.png', '.png')];
        for (const url of urls) {
            const response = await fetch(base + url);
            assert.ok(response.ok && response.headers.get('content-type').startsWith('image/'), url);
            const remote = Buffer.from(await response.arrayBuffer());
            const source = await readFile(join(root, 'frontend/public', url));
            assert.equal(createHash('sha256').update(remote).digest('hex'), createHash('sha256').update(source).digest('hex'));
            if (url.endsWith('.ico')) assert.equal(remote.readUInt32LE(0), 0x00010000);
        }
        check(icon.name + ' 原图/预览/32px/180px/ICO 构建资源与源码一致');
    }
    await reload();
    check('刷新恢复已选的第四款', await checkedId() === 'cat-window' && await synced(APP_ICONS[4]));
    await browser.click('a[href="/tools"]');
    await browser.wait("!!document.querySelector('.page-tools')");
    check('切换路由保持所选侧栏与标签图标', await synced(APP_ICONS[4]));
    await browser.click('a[href="/settings"]');
    await ready();
    check('返回设置仍显示所选项', await checkedId() === 'cat-window');
    await browser.click('.app-icon-reset');
    check('恢复默认同时更新所有浏览器图标', await checkedId() === DEFAULT_APP_ICON_ID && await synced(APP_ICONS[0]));
    await reload();
    check('恢复默认在刷新后保留', await checkedId() === DEFAULT_APP_ICON_ID);
    await browser.evaluate("document.querySelector('[name=app-icon]').focus()");
    for (const type of ['keyDown', 'keyUp']) await browser.send('Input.dispatchKeyEvent', { type, key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 });
    await browser.wait("document.querySelector('[name=app-icon]:checked').value==='ink-cat-silhouette'");
    check('原生单选支持键盘方向键并同步保存', await synced(APP_ICONS[1]) && await browser.evaluate("document.activeElement.value==='ink-cat-silhouette'"));

    // 第二个真实同源窗口，操作来自其自己的 Storage 对象。
    await browser.evaluate(`void(window.__iconPeer=window.open(${JSON.stringify(base + '/settings')},'tt-icon-peer'))`);
    await browser.wait("window.__iconPeer?.document.querySelectorAll('[name=app-icon]').length===5");
    await browser.evaluate("window.__iconPeer.document.querySelector('[value=white-cat-smoke]').click()");
    await browser.wait("document.querySelector('[name=app-icon]:checked').value==='white-cat-smoke'");
    await browser.wait("document.querySelector('.brand-mark').complete&&document.querySelector('.brand-mark').naturalWidth>0");
    check('另一同源标签选择同步本页与 favicon', await synced(APP_ICONS[2]));
    await browser.evaluate('window.__iconPeer.localStorage.clear()');
    await browser.wait(`document.querySelector('[name=app-icon]:checked').value===${JSON.stringify(DEFAULT_APP_ICON_ID)}`);
    await browser.wait("document.querySelector('.brand-mark').complete&&document.querySelector('.brand-mark').naturalWidth>0");
    check('另一同源标签清空偏好恢复默认', await synced(APP_ICONS[0]));
    await browser.evaluate('window.__iconPeer.close()');

    for (const bad of ['obsolete-id', 'https://example.com/untrusted.svg', '{broken']) {
        await browser.evaluate(`localStorage.setItem(${quotedKey},${JSON.stringify(bad)})`);
        await reload();
        check('无效偏好回退默认：' + bad, await checkedId() === DEFAULT_APP_ICON_ID && await synced(APP_ICONS[0]));
    }
    await browser.evaluate("localStorage.setItem('tt-theme','light');document.documentElement.dataset.theme='light';window.__iconSet=Storage.prototype.setItem;Storage.prototype.setItem=function(){throw new DOMException('full','QuotaExceededError')}");
    await choose('cat-ink-circle');
    check('保存失败提示且当前选择仍生效', await browser.evaluate("document.querySelector('.app-icon-settings [role=alert]').textContent.includes('未能保存')&&document.querySelector('.app-icon-current').textContent.includes('仅本次生效')"));
    await browser.click('.theme-toggle');
    const quotaTheme = await browser.evaluate('document.documentElement.dataset.theme');
    await browser.click('.theme-toggle');
    check('存在旧主题偏好且写满时仍可双向切换', quotaTheme === 'dark' && await browser.evaluate('document.documentElement.dataset.theme') === 'light');
    await browser.evaluate('Storage.prototype.setItem=window.__iconSet');
    await browser.click('.app-icon-settings [role=alert] button');
    check('重试保存成功清除失败提示', await browser.evaluate("!document.querySelector('.app-icon-settings [role=alert]')"));
    await reload();
    check('重试成功后刷新保留', await checkedId() === 'cat-ink-circle');

    await choose('cat-window');
    imageFailure = true;
    await reload();
    await browser.wait("document.querySelector('.app-icon-settings [role=alert]')?.textContent.includes('加载失败')");
    check('图标资源失败临时回退并保留所选 ID', await checkedId() === 'cat-window' && await synced(APP_ICONS[0]) && await browser.evaluate(`localStorage.getItem(${quotedKey})==='cat-window'`));
    imageFailure = false;
    await browser.click('.app-icon-settings [role=alert] button');
    await browser.wait("[...document.querySelectorAll('.app-icon-preview,.brand-mark')].every(e=>e.complete&&e.naturalWidth>0)");
    check('资源恢复可重试，预览和当前图标恢复', await synced(APP_ICONS[4]) && await browser.evaluate("!document.querySelector('.app-icon-settings [role=alert]')"));

    updateFailure = true;
    await reload();
    await choose('white-cat-smoke');
    check('更新状态读取失败不阻断图标选择', await browser.evaluate("document.querySelector('.set-alert').textContent.includes('隔离更新状态失败')") && await synced(APP_ICONS[2]));
    updateFailure = false;
    await reload();
    check('原更新源与程序版本显示保留', await browser.evaluate("document.querySelector('.set-page').textContent.includes('0.6.0')&&document.querySelector('.set-input').value.includes('GuiYe314/team-toolbox')&&[...document.querySelectorAll('button')].some(e=>e.textContent==='检查更新'&&!e.disabled)"));
    await browser.click('#adb-open-settings');
    await browser.wait("!!document.querySelector('#adb-folder')");
    check('原 ADB 设置仍可打开且 Teleport 至 body', await browser.evaluate("document.querySelector('.overlay').parentElement===document.body&&document.querySelector('#adb-settings-title').textContent==='ADB 设置'"));
    await browser.click('#adb-settings-close');
    check('关闭 ADB 设置后恢复焦点', await browser.evaluate("!document.querySelector('.overlay')&&document.activeElement.id==='adb-open-settings'"));

    const storageBlock = await browser.send('Page.addScriptToEvaluateOnNewDocument', { source: "Object.defineProperty(window,'localStorage',{get(){throw new DOMException('blocked','SecurityError')}})" });
    await reload();
    await choose('ink-cat-silhouette');
    check('浏览器完全禁用存储仍可打开设置并临时选择', await synced(APP_ICONS[1]) && await browser.evaluate("document.querySelector('.app-icon-settings [role=alert]').textContent.includes('未能保存')"));
    const beforeTheme = await browser.evaluate('document.documentElement.dataset.theme');
    await browser.click('.theme-toggle');
    const afterTheme = await browser.evaluate('document.documentElement.dataset.theme');
    await browser.click('.theme-toggle');
    check('存储被禁用时主题仍可双向切换', beforeTheme !== afterTheme && await browser.evaluate('document.documentElement.dataset.theme') === beforeTheme);
    await browser.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: storageBlock.identifier });
    await reload();
    check('恢复存储后仍使用上次真正保存的选择', await checkedId() === 'white-cat-smoke');

    for (const theme of ['light', 'dark']) {
        await browser.evaluate(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`);
        await delay(350);
        for (const width of [1280, 1600]) {
            await browser.send('Emulation.setDeviceMetricsOverride', { width, height: 1100, deviceScaleFactor: 1, mobile: false });
            check(theme + ' ' + width + ' 图标卡片、文字与设置无内部溢出', await browser.evaluate("[document.querySelector('.set-page'),...document.querySelectorAll('.app-icon-option')].every(e=>e.scrollWidth<=e.clientWidth+1)"));
        }
        await browser.wait("[...document.querySelectorAll('.app-icon-preview')].every(e=>e.complete&&e.naturalWidth>0)");
        await screenshot('app-icons-settings-' + theme + '.png');
    }
    check('没有执行更新、ADB 或团队数据写入', writes.length === 0);
    check('无浏览器脚本异常', browser.errors.length === 0);
    check('页面只访问同源资源', browser.requests.every(url => url.startsWith(base) || url.startsWith('data:') || url.startsWith('blob:')));
    console.log('RESULT ' + passed + ' app icon browser checks passed.');
} catch (error) {
    if (browser) await screenshot('app-icons-failure.png').catch(() => {});
    throw error;
} finally {
    await browser?.evaluate('window.__iconPeer?.close()').catch(() => {});
    await browser?.close();
    server.closeAllConnections();
    await new Promise(done => server.close(done));
    assert.ok(resolve(temporary).startsWith(resolve(tmpdir()) + sep) && temporary.includes('tt-app-icon-'));
    await removeBrowserFixture(temporary);
}
