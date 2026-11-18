// 独立临时目录、真实文件API和临时浏览器，不读写团队数据库或用户目录。
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { testBrowser, removeBrowserFixture, delay } from './verify-browser.mjs';
import { TOOLS } from './src/utils/tool-catalog.js';
const root = fileURLToPath(new URL('..', import.meta.url)), backend = resolve(process.env.VERIFY_BACKEND_ROOT || join(root, 'backend'));
const require = createRequire(join(backend, 'package.json')), express = require('express');
const source = name => import(pathToFileURL(join(backend, 'src', name)).href);
const { registerFileShareApi } = await source('file-share-api.js'), { createFileShareService } = await source('file-share.js'), { createToolAccess } = await source('tool-access.js');
const temporary = await mkdtemp(join(tmpdir(), 'tt-share-browser-')), folder = join(temporary, '共享示例'), uploads = join(temporary, 'fixtures');
await mkdir(folder); await mkdir(uploads); await mkdir(join(temporary, 'downloads')); await mkdir(join(folder, '资料目录')); await mkdir(join(root, 'build'), { recursive: true });
await writeFile(join(folder, '说明.txt'), '电脑原件，不应覆盖'); await writeFile(join(folder, '资料目录', 'nested.txt'), 'child file');
await writeFile(join(uploads, '说明.txt'), '手机上传的中文文本'); await writeFile(join(uploads, '另一个.bin'), Buffer.from([0, 1, 2, 254, 255]));
const app = express(), access = createToolAccess({ allowLan: true }), errors = [];
app.use(access.middleware);
const service = createFileShareService({ log: (action, code) => errors.push([action, code]) });
registerFileShareApi(app, { service, access });
app.get('/api/documents/tree', (_req, res) => res.json({ items: [] })); app.get('/api/documents', (_req, res) => res.json({ items: [] }));
app.use('/api', (_req, res) => res.status(503).json({ message: '隔离服务没有设备或团队资料' }));
const dist = resolve(process.env.VERIFY_DIST || join(root, 'frontend/dist')); app.use(express.static(dist, { index: false })); app.get('/{*path}', (_req, res) => res.sendFile(join(dist, 'index.html')));
const server = await new Promise(done => { const s = app.listen(0, '0.0.0.0', () => done(s)); });
const base = `http://127.0.0.1:${server.address().port}`;
let browser, count = 0;
const check = (message, result = true) => { assert.ok(result, message); console.log(`PASS ${++count} ${message}`); };
async function navigate(path, selector) { await browser.send('Page.navigate', { url: path.startsWith('http') ? path : base + path }); await browser.wait(`!!document.querySelector(${JSON.stringify(selector)})`); }
async function clickText(selector, text) { await browser.evaluate(`{const el=[...document.querySelectorAll(${JSON.stringify(selector)})].find(el=>el.textContent.trim()===${JSON.stringify(text)});if(!el)throw Error('找不到 '+${JSON.stringify(text)});el.click();}`); }
async function files(paths) { const doc = await browser.send('DOM.getDocument'), el = await browser.send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '#share-files' }); await browser.send('DOM.setFileInputFiles', { nodeId: el.nodeId, files: paths }); }
const visible = selector => browser.wait(`!!document.querySelector(${JSON.stringify(selector)})`);
async function shot(name) { const result = await browser.send('Page.captureScreenshot', { format: 'png' }); await writeFile(join(root, 'build', `task069-${name}.png`), Buffer.from(result.data, 'base64')); }
const management = { 'X-Toolbox-Share': '1', 'X-Toolbox-Share-Manage': '1', 'Content-Type': 'application/json' };
const config = async () => (await fetch(base + '/api/file-share/config', { headers: management })).json();
async function openManagement() { await navigate('/tools/file-share', '#share-create'); await browser.wait('!document.querySelector("#share-create").disabled || !!document.querySelector("#share-root")'); }
try {
    browser = await testBrowser(temporary);
    await browser.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: join(temporary, 'downloads') });
    await navigate('/tools', '.page-tools');
    check('工具箱、分组和标签目录包含文件共享', await browser.evaluate(`document.querySelectorAll('.tool-card').length===${TOOLS.length}&&!!document.querySelector('[data-tool-id="file-share"]')`));
    await openManagement(); await browser.fill('#share-root', folder); await browser.select('#share-hours', 1); await browser.click('#share-create'); await browser.wait('!!document.querySelector("#share-confirm-create")');
    check('默认只读，开启前明确确认真实目录和权限', await browser.evaluate(`document.querySelector('.ui-dialog').textContent.includes('只读')&&document.querySelector('.ui-dialog').textContent.includes(${JSON.stringify(folder)})`));
    check('PrimeVue确认弹窗挂在body内', await browser.evaluate("document.querySelector('.ui-dialog')?.parentElement===document.body||document.querySelector('.ui-dialog')?.parentElement?.parentElement===document.body"));
    await browser.click('#share-confirm-create'); await visible('[data-file-name="说明.txt"]');
    let shared = (await config()).shares[0];
    check('PrimeVue期限选择保留数值类型并实际设置一小时', shared.expiresAt - Date.now() > 3500_000 && shared.expiresAt - Date.now() <= 3600_000);
    check('创建后真实读取目录，生成二维码', await browser.evaluate("!!document.querySelector('.share-qr svg')&&!document.querySelector('#share-pick')&&document.querySelector('.share-badge').textContent==='只读'"));
    const readLink = await browser.evaluate("document.querySelector('#share-open').href");
    check('访问票据只放fragment，不出现在查询串', !new URL(readLink).search && new URL(readLink).hash.includes(shared.token));
    await navigate('/tools', '.page-tools'); check('离开管理页仍保持共享', (await config()).shares.length === 1);
    await openManagement(); await browser.wait('!!document.querySelector("#share-open")');
    check('重新进入管理页恢复共享、链接和只读权限', await browser.evaluate(`document.querySelector('#share-open').href===${JSON.stringify(readLink)}&&!document.querySelector('#share-pick')`));
    await browser.send('Page.reload'); await browser.wait('!!document.querySelector("#share-open")'); check('整页刷新不丢失已开启共享', (await config()).shares[0].id === shared.id);
    await browser.fill('#share-search', '不存在'); check('当前目录搜索和空结果', await browser.evaluate("document.querySelectorAll('.share-file-row').length===0&&document.querySelector('.share-browser').textContent.includes('没有匹配')"));
    await browser.fill('#share-search', ''); await clickText('.share-file-name', '资料目录'); await visible('[data-file-name="nested.txt"]');
    check('进入子目录并显示面包屑', await browser.evaluate("document.querySelector('.share-crumbs').textContent.includes('资料目录')"));
    await browser.click('.share-crumbs button'); await visible('[data-file-name="说明.txt"]');
    await clickText('.share-session .btn', '停止共享'); await browser.wait('!!document.querySelector("#share-confirm-stop")'); await browser.click('#share-confirm-stop'); await browser.wait('!document.querySelector("#share-open")');
    check('停止确认后撤销共享', (await config()).shares.length === 0);
    await navigate(readLink, '.share-mobile'); await browser.wait('!!document.querySelector("[role=alert]")'); check('旧扫码链接立即失效', await browser.evaluate("document.querySelector('[role=alert]').textContent.includes('共享链接')"));
    await openManagement(); await browser.fill('#share-root', folder); await browser.click('#share-writable'); await browser.click('#share-create'); await browser.click('#share-confirm-create');
    await browser.wait('!!document.querySelector("#share-pick")'); shared = (await config()).shares[0];
    const writeLink = await browser.evaluate("document.querySelector('#share-open').href");
    check('可上传权限明确显示且保留只读原件', await browser.evaluate("document.querySelector('.share-badge').textContent==='可上传'"));
    await files([join(uploads, '说明.txt'), join(uploads, '另一个.bin')]); await browser.wait("[...document.querySelectorAll('.share-upload-item')].length===2&&[...document.querySelectorAll('.share-upload-item')].every(el=>el.textContent.includes('已保存'))");
    check('多文件真实上传并逐项显示保存回执', await readFile(join(folder, '说明 (1).txt'), 'utf8') === '手机上传的中文文本' && (await readFile(join(folder, '另一个.bin'))).equals(Buffer.from([0, 1, 2, 254, 255])));
    check('同名另存且原件字节保持', await readFile(join(folder, '说明.txt'), 'utf8') === '电脑原件，不应覆盖');
    check('网页回执包含真实SHA256和另存名称', await browser.evaluate("document.querySelector('.share-upload-panel').textContent.includes('SHA-256')&&document.querySelector('.share-upload-panel').textContent.includes('说明 (1).txt')"));
    await browser.click('#share-mkdir'); await browser.fill('#share-folder-name', '手机新建'); await browser.click('#share-folder-create'); await visible('[data-file-name="手机新建"]');
    check('新建目录实际落盘', (await readdir(folder)).includes('手机新建'));
    // 真实票据端点与下载字节，浏览器原生下载不使用Blob整块缓存。
    const receipt = await browser.evaluate(`(async()=>{const response=await fetch('/api/file-share/shares/${shared.id}/downloads',{method:'POST',headers:{'Content-Type':'application/json','X-Toolbox-Share':'1','X-Toolbox-Share-Token':'${shared.token}'},body:JSON.stringify({path:'另一个.bin'})});return response.json();})()`);
    const downloaded = await fetch(base + '/api/file-share/downloads/' + receipt.ticket);
    check('下载端点实际流式返回附件和原始二进制', downloaded.headers.get('content-disposition').startsWith('attachment;') && Buffer.from(await downloaded.arrayBuffer()).equals(Buffer.from([0, 1, 2, 254, 255])));
    await browser.click('[aria-label="下载 说明.txt"]'); await browser.wait("!!document.querySelector('[role=status]')&&document.querySelector('.share-browser').textContent.includes('交给浏览器')");
    for (let i = 0; i < 100 && !(await readdir(join(temporary, 'downloads'))).includes('说明.txt'); i++) await delay(30);
    check('网页原生下载实际保存到隔离目录，字节与原件一致', await readFile(join(temporary, 'downloads', '说明.txt'), 'utf8') === '电脑原件，不应覆盖');
    await browser.evaluate("document.querySelector('#share-help').focus()"); await browser.click('#share-help'); await browser.wait('!!document.querySelector(".ui-dialog")');
    check('帮助点击打开、无持久化凭据', await browser.evaluate("document.querySelector('.ui-dialog').textContent.includes('重启需重新开启')&&![...Object.values(localStorage),...Object.values(sessionStorage)].some(value=>value.includes('" + shared.token + "'))"));
    await browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' }); await browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape' }); await browser.wait('!document.querySelector(".ui-dialog")');
    check('帮助支持Escape并恢复焦点', await browser.evaluate("document.activeElement.id==='share-help'"));
    for (const [theme, width] of [['light', 1280], ['dark', 1700]]) {
        await browser.evaluate(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`); await browser.send('Emulation.setDeviceMetricsOverride', { width, height: 1100, deviceScaleFactor: 1, mobile: false }); await delay(180);
        check(`${theme}桌面布局不挤出共享面板`, await browser.evaluate("document.querySelector('.share-layout').scrollWidth<=document.querySelector('.share-layout').clientWidth+2")); await shot(`share-${theme}-${width}`);
    }
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }); await navigate(writeLink, '.share-mobile'); await browser.wait('!!document.querySelector("#share-pick")');
    check('实际私网IPv4访问及独立手机布局，无桌面侧栏', !new URL(writeLink).hostname.includes('127.0.0.1') && await browser.evaluate("!document.querySelector('.sidebar')&&!!document.querySelector('.share-mobile')"));
    for (const width of [360, 390, 768]) for (const theme of ['light', 'dark']) {
        await browser.send('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: true }); await browser.evaluate(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`); await delay(80);
        check(`${width}px ${theme}手机页面不横向溢出且可滚动`, await browser.evaluate("document.documentElement.scrollWidth<=innerWidth+1&&document.querySelector('.share-mobile').scrollWidth<=document.querySelector('.share-mobile').clientWidth+1&&getComputedStyle(document.querySelector('.share-mobile')).overflowY==='auto'"));
    }
    await shot('share-mobile-dark-768'); await clickText('.share-file-name', '手机新建'); await browser.wait("document.querySelector('.share-crumbs').textContent.includes('手机新建')");
    await files([join(uploads, '另一个.bin')]); await browser.wait("document.querySelector('.share-upload-item')?.textContent.includes('已保存')");
    check('手机页在选定子目录上传而非根目录', (await readFile(join(folder, '手机新建', '另一个.bin'))).equals(Buffer.from([0, 1, 2, 254, 255])));
    // 实际网络限速使上传可取消，避免仅测UI伪成功。
    await browser.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: 1024 });
    await browser.evaluate("{const transfer=new DataTransfer();transfer.items.add(new File([new Uint8Array(256*1024)],'中断文件.bin'));const input=document.querySelector('#share-files');input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));}");
    await browser.wait('!!document.querySelector("#share-cancel")'); await browser.click('#share-cancel'); await browser.wait('!document.querySelector("#share-cancel")');
    await browser.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }); await delay(200);
    check('真实网络上传取消不产生残缺目标文件', !(await readdir(join(folder, '手机新建'))).includes('中断文件.bin'));
    await browser.click('#share-retry'); await browser.wait("document.querySelector('.share-upload-item')?.textContent.includes('已保存')");
    check('取消后可重试并真实保存完整文件', (await readFile(join(folder, '手机新建', '中断文件.bin'))).length === 256 * 1024);
    await service.stop(shared.id); await browser.click('#share-refresh'); await browser.wait('!!document.querySelector("[role=alert]")');
    check('服务停止后刷新明确显示失效，不冒称旧目录仍有效', await browser.evaluate("document.querySelector('[role=alert]').textContent.includes('已停止')"));
    await navigate('/file-share#id=invalid&token=bad', '[role=alert]'); check('损坏链接明确失败，无目录请求');
    check('浏览器无未处理异常', browser.errors.length === 0);
    check('网页只使用同源和本轮本机地址', browser.requests.every(value => /^(?:data:|blob:|about:)/.test(value) || [new URL(base).host, new URL(writeLink).host].includes(new URL(value).host)));
    console.log(`\n${count}/${count} PASS；文件、共享、浏览器及临时服务均回收。`);
} finally {
    await browser?.close(); await service.dispose(); server.closeAllConnections(); await new Promise(done => server.close(done)); await removeBrowserFixture(temporary);
}
