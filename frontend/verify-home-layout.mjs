
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HOME_LAYOUT_KEY } from './src/utils/home-layout.js';
import { testBrowser, removeBrowserFixture } from './verify-browser.mjs';

const require = createRequire(new URL('../backend/package.json', import.meta.url));
const express = require('express');
const app = express();
const dist = process.env.VERIFY_DIST ? resolve(process.env.VERIFY_DIST) : fileURLToPath(new URL('./dist', import.meta.url));
const documents = Array.from({ length: 21 }, (_, index) => ({
    id: index + 1,
    title: index === 4 ? '验收流程' : '文档 ' + (index + 1),
    snippet: '最近更新的文档摘要',
    updated_at: '2026-11-21T00:00:00Z'
}));
let missing = false;
let treeFailed = false;
let recentFailed = false;
let recentReads = 0;
app.get('/api/documents/tree', (_req, res) => {
    if (treeFailed) return res.status(503).json({ message: '暂时无法读取文档' });
    res.json({ items: documents.filter(doc => !missing || doc.id !== 5) });
});
app.get('/api/documents', (req, res) => {
    recentReads++;
    if (recentFailed) return res.status(503).json({ message: '暂时无法读取最近更新' });
    const offset = Number(req.query.offset);
    res.json({ items: documents.slice(offset, offset + Number(req.query.limit)), total: documents.length });
});
app.use('/api', (_req, res) => res.status(404).json({ message: '隔离验收接口' }));
app.use(express.static(dist));
app.get('/{*path}', (_req, res) => res.sendFile(join(dist, 'index.html')));

const temporary = await mkdtemp(join(tmpdir(), 'tt-home-layout-'));
const server = await new Promise(done => {
    const listener = app.listen(0, '127.0.0.1', () => done(listener));
});
const base = 'http://127.0.0.1:' + server.address().port;
const editor = '[role="dialog"][aria-label="编辑首页"]';
const search = editor + ' input[type=search]';
const homeReady = '!!document.querySelector("#edit-home-layout")';
const noRecent = '!document.querySelector(".recent-item,.page-home .state-loading,.page-home .state-error")';
const card = id => '[data-home-shortcut="' + id + '"]';
const add = id => '[data-home-add="' + id + '"]';
let browser;
let passed = 0;

function check(label, condition = true) {
    assert.ok(condition, label);
    console.log('PASS ' + ++passed + ' ' + label);
}

async function reloadHome() {
    await browser.send('Page.reload', { ignoreCache: true });
    await browser.wait(homeReady);
}

async function openEditor() {
    await browser.evaluate("document.querySelector('#edit-home-layout').focus()");
    await browser.click('#edit-home-layout');
}

async function cardOrder() {
    return browser.evaluate("[...document.querySelectorAll('[data-home-shortcut]')].map(card => card.dataset.homeShortcut).join('|')");
}

try {
    browser = await testBrowser(temporary);
    const { send, evaluate, click, wait, fill } = browser;
    await send('Page.navigate', { url: base });
    await wait(homeReady);
    check('首次打开为空，最近更新默认关闭', await evaluate("document.querySelector('.page-home .empty-state').textContent.includes('首页还没有内容') && !document.querySelector('[data-home-shortcut]') && !document.querySelector('.recent-list')"));
    check('默认首页没有请求最近更新接口', recentReads === 0);

    await openEditor();
    check('编辑弹窗挂到 body 并获得焦点', await evaluate("document.querySelector('.ext-overlay').parentElement === document.body && document.activeElement.getAttribute('role') === 'dialog'"));
    await click(add('module:projects'));
    await fill(search, '二维码');
    check('工具列表可搜索', await evaluate("document.querySelectorAll('[data-home-add]').length === 1"));
    await click(add('tool:qrcode'));
    check('已添加项目不可重复添加', await evaluate("document.querySelector('[data-home-add=\"tool:qrcode\"]').disabled"));
    treeFailed = true;
    await click('#home-pick-documents');
    await wait("document.querySelector('.home-editor [role=alert]')?.textContent.includes('暂时无法读取文档')");
    treeFailed = false;
    await click('.home-editor [role=alert] + button');
    await fill(search, '验收');
    await click(add('doc:5'));
    check('文档读取失败后可重试并按标题添加', await evaluate("document.querySelector('[data-home-selected=\"doc:5\"]').textContent.includes('验收流程')"));
    await click('button[aria-label="上移 二维码生成"]');
    await click('#home-layout-save');
    check('保存后按手动顺序显示工具、模块和文档', await cardOrder() === 'tool:qrcode|module:projects|doc:5');
    check('关闭弹窗后焦点回到编辑按钮', await evaluate("document.activeElement.id === 'edit-home-layout'"));
    check('只保存所选入口 ID 和最近更新开关', await evaluate('localStorage.getItem(' + JSON.stringify(HOME_LAYOUT_KEY) + ') === ' + JSON.stringify(JSON.stringify({
        version: 1, shortcuts: ['tool:qrcode', 'module:projects', 'doc:5'], showRecent: false
    }))));
    await reloadHome();
    await wait("document.querySelector('[data-home-shortcut=\"doc:5\"] .tool-name')?.textContent === '验收流程'");
    check('刷新保留顺序并重新读取文档标题', await cardOrder() === 'tool:qrcode|module:projects|doc:5');

    await openEditor();
    await click('button[aria-label="移除 项目管理"]');
    await evaluate("document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");
    check('取消编辑时首页保持原有布局', await cardOrder() === 'tool:qrcode|module:projects|doc:5');
    await openEditor();
    await click('button[aria-label="移除 项目管理"]');
    await evaluate("window.originalSetItem = Storage.prototype.setItem; Storage.prototype.setItem = () => { throw new Error('blocked'); }");
    await click('#home-layout-save');
    check('写入失败保留当前首页和编辑草稿', await cardOrder() === 'tool:qrcode|module:projects|doc:5' &&
        await evaluate("document.querySelector('.home-editor-footer').previousElementSibling?.textContent.includes('无法保存首页') && !document.querySelector('[data-home-selected=\"module:projects\"]')"));
    await evaluate('Storage.prototype.setItem = window.originalSetItem');
    await click('#home-layout-save');
    check('重试保存后移除快捷入口', await cardOrder() === 'tool:qrcode|doc:5');

    recentFailed = true;
    await openEditor();
    await click('#home-show-recent');
    await click('#home-layout-save');
    await wait("document.querySelector('.page-home .state-error')?.textContent.includes('暂时无法读取最近更新')");
    recentFailed = false;
    await click('.page-home .retry-btn');
    await wait("document.querySelectorAll('.recent-item').length === 20");
    await click('.more-btn');
    await wait("document.querySelectorAll('.recent-item').length === 21");
    check('开启最近更新后支持错误重试和分页', recentReads === 3 && await evaluate("!!document.querySelector('.recent-snippet') && !document.querySelector('.more-btn')"));
    const count = recentReads;
    await openEditor();
    await click('#home-show-recent');
    await click('#home-layout-save');
    await reloadHome();
    check('关闭最近更新后刷新不再请求或显示', recentReads === count && await evaluate(noRecent));

    await click(card('tool:qrcode') + ' button');
    await wait("location.pathname === '/tools/qrcode'");
    check('固定工具可打开并进入顶部工具标签', await evaluate("!!document.querySelector('[data-tab-id=qrcode]')"));
    await click('.nav-item[href="/"]');
    await wait(homeReady);
    await click(card('doc:5') + ' button');
    await wait("location.pathname === '/kb/5'");
    check('固定文档打开对应路由');
    await click('.nav-item[href="/"]');
    await wait(homeReady);
    missing = true;
    await evaluate("window.dispatchEvent(new Event('kb-changed'))");
    await wait("document.querySelector('[data-home-shortcut=\"doc:5\"] button')?.disabled");
    check('已移除文档的固定卡片明确提示不可用', await evaluate("document.querySelector('[data-home-shortcut=\"doc:5\"]').textContent.includes('文档已移除或不可用')"));

    for (const theme of ['light', 'dark']) {
        await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
        await evaluate('localStorage.setItem("tt-theme", ' + JSON.stringify(theme) + ')');
        await reloadHome();
        await openEditor();
        check(theme + ' 主题下列表和弹窗可见且无横向溢出', await evaluate("document.documentElement.dataset.theme === " + JSON.stringify(theme) +
            " && [...document.querySelectorAll('.home-editor-list,.ext-dialog')].every(el => el.clientWidth > 0 && el.scrollWidth <= el.clientWidth + 1)"));
        await click(editor + ' [aria-label="关闭弹窗"]');
    }

    await evaluate('localStorage.setItem(' + JSON.stringify(HOME_LAYOUT_KEY) + ', "{broken")');
    await reloadHome();
    check('损坏的偏好恢复为空首页', await cardOrder() === '' && await evaluate(noRecent));
    const old = { version: 1, shortcuts: ['tool:removed', 'doc:-1', 'tool:qrcode', 'tool:qrcode'], showRecent: 'true' };
    await evaluate('localStorage.setItem(' + JSON.stringify(HOME_LAYOUT_KEY) + ', ' + JSON.stringify(JSON.stringify(old)) + ')');
    await reloadHome();
    check('忽略失效工具、无效文档 ID 和重复入口', await cardOrder() === 'tool:qrcode' && await evaluate(noRecent));
    check('浏览器无未捕获异常', browser.errors.length === 0);
    console.log('全部通过，共 ' + passed + ' 项');
} finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
    await removeBrowserFixture(temporary);
}
