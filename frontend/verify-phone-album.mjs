// 真实私网 TCP + 临时数据库/资源 + 两个独立浏览器。不是手机硬件验收。
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { testBrowser, removeBrowserFixture, delay } from './verify-browser.mjs';
import { toQrSvg } from './src/assets/qr-share.js';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const temporary = await mkdtemp(join(tmpdir(), 'tt-phone-album-browser-'));
process.env.ASSET_DIR = join(temporary, 'assets'); process.env.DB_PATH = join(temporary, 'unused.sqlite3');
const require = createRequire(new URL('../backend/package.json', import.meta.url));
const express = require('express'), Database = require('better-sqlite3'), sharp = require('sharp');
const { runMigrations } = await import('../backend/src/migrate.js');
const { registerAssetApi } = await import('../backend/src/asset-api.js');
const { createPhoneAlbumService } = await import('../backend/src/phone-album.js');
const { registerPhoneAlbumApi } = await import('../backend/src/phone-album-api.js');
const { createToolAccess } = await import('../backend/src/tool-access.js');
const { createFolder } = await import('../backend/src/asset-store.js');
const db = new Database(':memory:'); db.pragma('foreign_keys = ON'); await runMigrations({ connection: db });
const parent = createFolder({ connection: db, name: '相册归档' });
const folder = createFolder({ connection: db, name: '手机相册验收', parentId: parent.id });
const access = createToolAccess({ allowLan: true }), address = access.addresses()[0];
assert.ok(address, '需要本机真实私网 IPv4 网卡');
let offset = 0, passed = 0, desktop, mobile, created = [], failedOnce = false, lostOnce = false;
const check = (name, condition = true) => { assert.ok(condition, name); console.log('PASS ' + (++passed) + ' ' + name); };
const service = createPhoneAlbumService({ getDb: () => db, now: () => Date.now() + offset, log() {} });
const tracked = { ...service, create(input) { const result = service.create(input); created.push(result); return result; } };
const app = express(); app.use(access.middleware);
app.use('/api/phone-album', (req, res, next) => {
    let name = ''; try { name = JSON.parse(decodeURIComponent(req.get('x-toolbox-album-file') || '')).name; } catch { /* 非文件 */ }
    if (name === '重试.png' && !failedOnce) { failedOnce = true; req.resume(); return res.status(503).json({ error: 'synthetic', message: '隔离服务暂时忙碌，请重试' }); }
    if (name === '回执丢失.png' && !lostOnce) { lostOnce = true; const json = res.json.bind(res); res.json = body => { if (res.statusCode === 201) { res.destroy(); return res; } return json(body); }; }
    next();
});
registerPhoneAlbumApi(app, { getDb: () => db, access, service: tracked });
app.use(express.json()); registerAssetApi(app, { getDb: () => db });
app.get('/api/documents/tree', (_req, res) => res.json({ items: [] }));
app.get('/api/documents', (_req, res) => res.json({ items: [], total: 0 }));
app.use('/api', (_req, res) => res.status(503).json({ message: '隔离服务未启用其他工具' }));
const dist = resolve(process.env.VERIFY_DIST || join(root, 'frontend/dist'));
app.use(express.static(dist, { index: false })); app.get('/{*path}', (_req, res) => res.sendFile(join(dist, 'index.html')));
const server = await new Promise(done => { const listener = app.listen(0, '0.0.0.0', () => done(listener)); });
const base = `http://${address}:${server.address().port}`;
const count = () => db.prepare('SELECT COUNT(*) AS n FROM assets').get().n;
const title = "document.querySelector('.album-mobile h1')?.textContent==='上传手机相册'";
async function navigate(browser, path, ready) { await browser.send('Page.navigate', { url: base + path }); await browser.wait(`location.href===${JSON.stringify(base + path)}&&document.readyState==='complete'&&(${ready})`); }
async function choose(browser, files) { const doc = await browser.send('DOM.getDocument'); const element = await browser.send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '#album-files' }); await browser.send('DOM.setFileInputFiles', { nodeId: element.nodeId, files }); }
const done = "!document.querySelector('#album-cancel') && document.querySelectorAll('.album-item').length>0";
async function run() { await mobile.click('#album-upload'); await mobile.wait(done); }
async function screenshot(browser, name) { await mkdir(join(root, 'build'), { recursive: true }); const shot = await browser.send('Page.captureScreenshot', { format: 'png' }); await writeFile(join(root, 'build', name), Buffer.from(shot.data, 'base64')); }
async function file(name, bytes) { const path = join(temporary, name); await writeFile(path, bytes); return path; }
async function clearQueue() { await mobile.evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent==='清除已完成项')?.click()"); }
async function createSession() { await desktop.click('#album-create'); await desktop.wait("!!document.querySelector('.album-qr svg')"); return created.at(-1); }
const link = s => `/phone-album#${s.id}.${s.uploadToken}`;
const png = await sharp({ create: { width: 20, height: 12, channels: 4, background: { r: 50, g: 120, b: 200, alpha: 1 } } }).png().toBuffer();
const mp4 = Buffer.alloc(32); mp4.writeUInt32BE(32); mp4.write('ftypisom', 4);
const heic = Buffer.alloc(24); heic.writeUInt32BE(24); heic.write('ftypheic', 4);
const photos = [await file('相片.png', png), await file('短片.MOV', mp4), await file('照片.HEIC', heic)];
try {
    await mkdir(join(temporary, 'desktop')); await mkdir(join(temporary, 'mobile'));
    desktop = await testBrowser(join(temporary, 'desktop')); mobile = await testBrowser(join(temporary, 'mobile'));
    await desktop.send('Network.setCacheDisabled', { cacheDisabled: true }); await mobile.send('Network.setCacheDisabled', { cacheDisabled: true });
    await navigate(desktop, '/tools', "document.querySelectorAll('.page-tools .tool-card').length===12");
    check('工具箱有手机相册入口', await desktop.evaluate("document.querySelector('[data-tool-id=phone-album]').textContent.includes('手机相册上传')"));
    await navigate(desktop, `/tools/phone-album?folderId=${folder.id}`, "!!document.querySelector('#album-create')&&!document.querySelector('#album-create').disabled");
    check('从资源文件夹进入可预选目标和真实私网地址', await desktop.evaluate(`document.querySelector('select').value==='${folder.id}'&&document.querySelectorAll('select')[1].value===${JSON.stringify(base)}`));
    check('子文件夹显示完整层级，避免同名目标混淆', await desktop.evaluate("document.querySelector('select').selectedOptions[0].textContent==='相册归档 / 手机相册验收'"));
    let session = await createSession();
    const colors = await desktop.evaluate("({dark:getComputedStyle(document.documentElement).getPropertyValue('--adb-qr-foreground').trim(),light:getComputedStyle(document.documentElement).getPropertyValue('--adb-qr-background').trim()})");
    const expected = await toQrSvg(base + link(session), { ...colors, width: 280 });
    check('实际二维码路径对应私网上传链接和上传票据', JSON.stringify(await desktop.evaluate("[...document.querySelectorAll('.album-qr path')].map(path=>path.getAttribute('d'))")) === JSON.stringify([...expected.matchAll(/\bd="([^"]+)"/g)].map(match => match[1])));
    await mobile.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await navigate(mobile, link(session), title); await mobile.wait("!!document.querySelector('#album-files')");
    check('独立手机页不加载桌面导航或团队数据', await mobile.evaluate("!document.querySelector('.main-sidebar,.app-layout')") && !mobile.requests.some(url => /\/api\/(documents|assets|asset-folders)/.test(url)));
    check('输入支持照片视频多选', await mobile.evaluate("document.querySelector('#album-files').multiple&&document.querySelector('#album-files').accept.includes('video/*')"));
    await choose(mobile, photos); await mobile.wait("document.querySelectorAll('.album-item').length===3"); await run();
    await mobile.wait("document.querySelectorAll('.album-item .album-success').length===3");
    check('中文照片、MOV和HEIC一批真实上传入库', count() === 3);
    await desktop.wait("document.querySelectorAll('.album-item .album-success').length===3");
    check('电脑接收结果同步实际保存数量');
    for (const asset of db.prepare('SELECT id,name,folder_id,status,published_version_id FROM assets').all()) {
        assert.equal(asset.folder_id, folder.id); assert.equal(asset.status, 'draft'); assert.equal(asset.published_version_id, null);
        const response = await fetch(base + `/api/assets/files/${asset.id}/original/latest?download=1`);
        const original = Buffer.from(await response.arrayBuffer()), source = await readFile(join(temporary, asset.name));
        assert.deepEqual(original, source); assert.ok(response.headers.get('content-disposition').startsWith('attachment'));
    }
    check('资源库原件可下载且字节一致，均保存在所选文件夹的草稿');
    for (let n = 0; n < 100 && db.prepare("SELECT preview_status FROM asset_versions WHERE id=1").get().preview_status !== 'ready'; n++) await delay(30);
    check('手机照片复用原资源库预览生成', db.prepare('SELECT preview_status FROM asset_versions WHERE id=1').get().preview_status === 'ready');
    for (const theme of ['dark', 'light']) {
        await mobile.evaluate(`document.documentElement.dataset.theme='${theme}'`); await screenshot(mobile, `phone-album-mobile-${theme}.png`);
        await desktop.evaluate(`document.documentElement.dataset.theme='${theme}'`); await screenshot(desktop, `phone-album-desktop-${theme}.png`);
    }
    await clearQueue(); await choose(mobile, [photos[0]]); await run();
    check('同名再上传创建独立资源，保留旧件', count() === 4);
    await clearQueue(); const retry = await file('重试.png', png), next = await file('后续.png', png);
    await choose(mobile, [retry, next]); await run();
    check('单项失败仍继续后续文件，给出可重试原因', count() === 5 && await mobile.evaluate("document.querySelector('.album-list').textContent.includes('暂时忙碌')&&document.querySelectorAll('.album-success').length===1"));
    await run(); check('只重试未完成项，成功项不重复入库', count() === 6 && await mobile.evaluate("document.querySelectorAll('.album-success').length===2"));
    await clearQueue(); const lost = await file('回执丢失.png', png); await choose(mobile, [lost]); await run();
    await mobile.wait("document.querySelector('.album-success')?.textContent==='已入库'");
    check('回执丢失后核对成功记录，无重复资源', count() === 7);
    check('票据未写入浏览器存储、请求URL或数据库日志', await mobile.evaluate(`![...Object.values(localStorage),...Object.values(sessionStorage)].some(v=>v.includes(${JSON.stringify(session.uploadToken)}))`) && ![...mobile.requests, ...desktop.requests].some(url => url.includes(session.uploadToken) && url.includes('/api/')) && !db.prepare('SELECT detail FROM asset_operation_logs').all().some(row => row.detail.includes(session.uploadToken)));

    await clearQueue(); const cancel = await file('取消.png', Buffer.concat([png, Buffer.alloc(1024 * 1024)]));
    await mobile.send('Network.emulateNetworkConditions', { offline: false, latency: 20, downloadThroughput: 1024 * 1024, uploadThroughput: 64 * 1024 });
    await choose(mobile, [cancel]); await mobile.click('#album-upload'); await mobile.wait("!!document.querySelector('#album-cancel')&&!!document.querySelector('progress')");
    await mobile.click('#album-cancel'); await mobile.wait("!document.querySelector('#album-cancel')"); await delay(150);
    check('手机停止中止在途大文件，保留此前成功资源', count() === 7 && await mobile.evaluate("document.querySelector('.album-list').textContent.includes('停止')"));
    await mobile.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    await mobile.click('.album-item button');

    const background = await file('后台停止.png', Buffer.concat([png, Buffer.alloc(1024 * 1024)])); await choose(mobile, [background]);
    await mobile.send('Network.emulateNetworkConditions', { offline: false, latency: 20, downloadThroughput: 1024 * 1024, uploadThroughput: 64 * 1024 });
    await mobile.click('#album-upload'); await mobile.wait("!!document.querySelector('progress')");
    await mobile.evaluate("Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'))");
    await mobile.wait("!document.querySelector('#album-cancel')");
    check('手机后台停止队列并提示返回后重试', count() === 7 && await mobile.evaluate("document.querySelector('[role=alert]').textContent.includes('后台')"));
    await mobile.evaluate("delete document.hidden;document.dispatchEvent(new Event('visibilitychange'))");
    await mobile.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    await mobile.click('.album-item button');

    for (const theme of ['dark', 'light']) {
        for (const width of [360, 390, 768]) {
            await mobile.send('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: true });
            await mobile.evaluate(`document.documentElement.dataset.theme='${theme}'`);
            check(`手机${width}px ${theme}无横向溢出、文件选择和上传按钮可触`, await mobile.evaluate("document.documentElement.scrollWidth<=innerWidth+1&&document.querySelector('#album-upload').getBoundingClientRect().height>=44&&document.querySelector('#album-files').getBoundingClientRect().width<=innerWidth"));
        }
        await mobile.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    }
    await desktop.click('#album-stop'); await desktop.wait("!document.querySelector('.album-qr svg')");
    const stopped = service.status(session.id, session.uploadToken);
    check('电脑停止立即移除二维码，成功资源保留', !stopped.accepting && count() === 7);
    await mobile.evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent==='刷新接收状态').click()");
    await mobile.wait("document.querySelector('#album-files')?.disabled");
    check('手机刷新后明确停止接收，无法继续选择');

    session = await createSession(); await navigate(mobile, link(session), title); await mobile.wait("!!document.querySelector('#album-files')&&!document.querySelector('#album-files').disabled");
    offset = 31 * 60_000;
    await mobile.evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent==='刷新接收状态').click()");
    await mobile.wait("document.querySelector('[role=alert]')?.textContent.includes('到期')");
    check('链接到期提示重新扫码，按钮禁用', await mobile.evaluate("document.querySelector('#album-files').disabled&&document.querySelector('#album-upload').disabled"));
    offset = 0;
    await desktop.send('Page.reload', { ignoreCache: true }); await desktop.wait("!!document.querySelector('#album-create')&&!document.querySelector('#album-create').disabled");
    session = await createSession(); await desktop.click('a[href="/tools"]'); await desktop.wait("!!document.querySelector('.page-tools')");
    for (let n = 0; n < 100 && service.status(session.id, session.uploadToken).accepting; n++) await delay(20);
    check('电脑离开接收页撤销会话', !service.status(session.id, session.uploadToken).accepting);
    await navigate(mobile, '/phone-album#invalid', title); await mobile.wait("document.querySelector('[role=alert]')?.textContent.includes('无效')");
    check('无效链接没有相册选择入口');
    await navigate(desktop, '/assets', "!!document.querySelector('.am-page')&&document.querySelector('.am-desc').textContent.includes('7')");
    check('资源库列表显示实际入库资源及扫码上传入口', await desktop.evaluate("!![...document.querySelectorAll('.am-head-actions a')].find(a=>a.textContent==='手机扫码上传')"));
    check('手机刷新会清空所选文件而不改变已保存资源', count() === 7);
    await service.dispose();
    check('所有暂存传输已清理', !(await readdir(process.env.ASSET_DIR)).some(name => name.startsWith('.phone-upload-')));
    check('两个真实浏览器无未捕获脚本异常', desktop.errors.length === 0 && mobile.errors.length === 0);
    console.log(`手机相册浏览器验收 ${passed}/${passed}；真实私网 TCP，未连接手机硬件。`);
} catch (error) {
    if (mobile) await screenshot(mobile, 'phone-album-mobile-failure.png').catch(() => {});
    if (desktop) await screenshot(desktop, 'phone-album-desktop-failure.png').catch(() => {});
    throw error;
} finally {
    await desktop?.close(); await mobile?.close(); await service.dispose();
    server.closeAllConnections(); await new Promise(done => server.close(done)); db.close();
    assert.ok(resolve(temporary).startsWith(resolve(tmpdir()) + sep) && temporary.includes('tt-phone-album-browser-'));
    await removeBrowserFixture(temporary);
}
