// 生产网页 + 私网TCP + 合成原片/真实FFmpeg。不是手机相册或原生相机真机验收。
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { testBrowser, removeBrowserFixture, delay } from './verify-browser.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..'), temporary = await mkdtemp(join(tmpdir(), 'tt-live-browser-'));
process.env.ASSET_DIR = join(temporary, 'assets'); process.env.DB_PATH = join(temporary, 'unused.sqlite3');
const backendRoot = resolve(process.env.VERIFY_BACKEND_ROOT || join(root, 'backend'));
const require = createRequire(pathToFileURL(join(backendRoot, 'package.json')));
const express = require('express'), Database = require('better-sqlite3'), sharp = require('sharp');
const source = name => import(pathToFileURL(join(backendRoot, 'src', name)).href);
const { runMigrations } = await source('migrate.js');
const { registerAssetApi } = await source('asset-api.js');
const { createPhoneAlbumService } = await source('phone-album.js');
const { registerPhoneAlbumApi } = await source('phone-album-api.js');
const { createToolAccess } = await source('tool-access.js');
const { detectExecutable } = await source('integration-common.js');
const db = new Database(':memory:'); await runMigrations({ connection: db });
const access = createToolAccess({ allowLan: true }), address = access.addresses()[0]; assert.ok(address);
const album = createPhoneAlbumService({ getDb: () => db, log() {} });
const app = express(); app.use(access.middleware); registerPhoneAlbumApi(app, { getDb: () => db, access, service: album });
app.use(express.json()); registerAssetApi(app, { getDb: () => db });
app.get('/api/documents/tree', (_req, res) => res.json({ items: [] }));
const dist = resolve(process.env.VERIFY_DIST || join(root, 'frontend/dist'));
app.use(express.static(dist, { index: false })); app.get('/{*path}', (_req, res) => res.sendFile(join(dist, 'index.html')));
const server = app.listen(0, '0.0.0.0'); await new Promise(done => server.once('listening', done));
const base = `http://${address}:${server.address().port}`; let browser, count = 0;
const check = (label, value = true) => { assert.ok(value, label); console.log('PASS ' + (++count) + ' ' + label); };
async function choose(files) { const doc = await browser.send('DOM.getDocument'); const el = await browser.send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '#album-files' }); await browser.send('DOM.setFileInputFiles', { nodeId: el.nodeId, files }); }
async function until(task) { for (let i = 0; i < 200; i++) { const value = await task(); if (value) return value; await delay(100); } throw new Error('data timeout'); }
async function navigate(path, ready) { await browser.send('Page.navigate', { url: base + path }); await browser.wait(`location.href===${JSON.stringify(base + path)}&&document.readyState==='complete'&&(${ready})`); }
async function openAsset(name) { await browser.evaluate(`{const el=[...document.querySelectorAll('.am-card,tbody tr')].find(el=>el.textContent.includes(${JSON.stringify(name)}));if(!el)throw Error('missing asset');el.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));}`); await browser.wait("!!document.querySelector('.pv-live')"); }
try {
    const ffmpeg = await detectExecutable('ffmpeg', ''); assert.ok(ffmpeg, '实媒体验收需要FFmpeg');
    const videoPath = join(temporary, 'IMG_9001.MOV'), photoPath = join(temporary, 'IMG_9001.JPG');
    await promisify(execFile)(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=128x96:d=3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-threads', '1', videoPath], { windowsHide: true, timeout: 15000 });
    const photo = await sharp({ create: { width: 120, height: 90, channels: 3, background: 'blue' } }).jpeg().toBuffer(); await writeFile(photoPath, photo);
    const session = album.create({ folderId: null });
    await mkdir(join(temporary, 'client')); browser = await testBrowser(join(temporary, 'client'));
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await navigate(`/phone-album#${session.id}.${session.uploadToken}`, "!!document.querySelector('#album-pair-live')");
    check('手机页实况配对默认关闭，明确说明浏览器限制', await browser.evaluate("!document.querySelector('#album-pair-live').checked&&document.body.textContent.includes('无法恢复实况')"));
    await browser.click('#album-pair-live'); await choose([photoPath, videoPath]); await browser.wait("document.querySelectorAll('.album-item').length===1&&!document.querySelector('#album-cancel')");
    check('同名原片经明确选择配为一个LIVP并显示标记', await browser.evaluate("document.querySelector('.album-item').textContent.includes('IMG_9001.livp')&&!!document.querySelector('.album-live-badge')"));
    check('手机实况开关与队列在390px内无横向溢出', await browser.evaluate('document.documentElement.scrollWidth<=innerWidth'));
    await browser.click('#album-upload'); await browser.wait("document.querySelector('.album-item')?.textContent.includes('已入库')&&!document.querySelector('#album-cancel')");
    const saved = album.status(session.id, session.manageToken, 'manage').items[0]; check('手机实际LIVP上传进入资源库', !!saved.assetId);
    const detail = await until(async () => { const value = await (await fetch(base + '/api/assets/' + saved.assetId)).json(); return value.versions[0].previewStatus === 'ready' && value; });
    check('资源实况派生视频就绪且原文件仍为LIVP', detail.versions[0].metadata.livePhoto.status === 'ready' && detail.ext === '.livp');
    const original = await fetch(base + `/api/assets/files/${saved.assetId}/original/latest`); check('打包原件可完整下载', original.ok && (await original.arrayBuffer()).byteLength === saved.size);
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
    await navigate('/assets', "!!document.querySelector('.am-card,tbody tr')"); await openAsset('IMG_9001.livp');
    check('实况预览浮层挂载body，默认显示照片和播放入口', await browser.evaluate("document.querySelector('.am-modal').parentElement===document.body&&!document.querySelector('.pv-live img').hidden&&document.querySelector('[data-test=live-play]').textContent==='播放实况'"));
    check('实况播放默认不预载完整视频', await browser.evaluate("!document.querySelector('.pv-live video').getAttribute('src')"));
    await browser.click('[data-test=live-play]'); await browser.wait("!document.querySelector('.pv-live video').paused&&!document.querySelector('.pv-live video').hidden&&document.querySelector('.pv-live video').currentTime>0");
    check('浏览器实际解码播放MP4且默认静音', await browser.evaluate("document.querySelector('.pv-live video').muted&&document.querySelector('.pv-live video').videoWidth===128"));
    const motionRequests = browser.requests.filter(url => /\/motion\//.test(url)); check('播放使用本资源版本motion接口', motionRequests.some(url => url.includes(`/api/assets/files/${saved.assetId}/motion/1`)));
    await browser.click('[data-test=live-play]'); check('主动停止回到静态照片', await browser.evaluate("document.querySelector('.pv-live video').paused&&!document.querySelector('.pv-live img').hidden"));
    await browser.click('[data-test=live-play]'); await browser.wait("!document.querySelector('.pv-live video').paused");
    await browser.evaluate("Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'))");
    check('进入后台停止解码，不自动恢复', await browser.evaluate("document.querySelector('.pv-live video').paused&&!document.querySelector('.pv-live img').hidden"));
    await browser.evaluate("Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'));window.__oldLiveVideo=document.querySelector('.pv-live video')");
    for (const theme of ['dark', 'light']) {
        await browser.evaluate(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`);
        const shot = await browser.send('Page.captureScreenshot', { format: 'png' }); await writeFile(join(root, `build/live-photo-${theme}.png`), Buffer.from(shot.data, 'base64'));
        check(`${theme}主题播放/下载入口处于视口内`, await browser.evaluate("[...document.querySelectorAll('.pv-live-controls button,.pv-live-controls a')].every(el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight})"));
    }
    await browser.evaluate("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))"); await browser.wait("!document.querySelector('.am-modal')");
    check('关闭预览释放视频源和元素', await browser.evaluate("window.__oldLiveVideo.paused&&!window.__oldLiveVideo.getAttribute('src')&&!window.__oldLiveVideo.isConnected"));
    await openAsset('IMG_9001.livp'); await browser.evaluate("window.__oldLiveVideo=document.querySelector('.pv-live video')");
    await browser.evaluate("document.querySelector('.pv-live video').dispatchEvent(new Event('error'))");
    check('解码错误明确提示并保留封面和原件下载', await browser.evaluate("document.querySelector('.pv-live p').textContent.includes('无法解码')&&!document.querySelector('.pv-live img').hidden"));
    await browser.click('[data-test=live-play]'); await browser.wait("!document.querySelector('.pv-live video').paused");
    await browser.evaluate("document.querySelector('a[href=\"/tools\"]').click()"); await browser.wait("location.pathname==='/tools'&&!!document.querySelector('.page-tools')");
    check('离开资源页释放实况播放资源', await browser.evaluate("window.__oldLiveVideo.paused&&!window.__oldLiveVideo.isConnected&&!window.__oldLiveVideo.getAttribute('src')"));

    // 旧资源只有静态预览元数据；通过真实界面重建，不用重新上传或改动版本。
    const clip = await readFile(videoPath), xmp = Buffer.from('http://ns.adobe.com/xap/1.0/\0' + `<x:xmpmeta GCamera:MicroVideoOffset="${clip.length}"/>`);
    const marker = Buffer.from([255, 225, 0, 0]); marker.writeUInt16BE(xmp.length + 2, 2);
    const legacyOriginal = Buffer.concat([photo.subarray(0, 2), marker, xmp, photo.subarray(2), clip]);
    const form = new FormData(); form.append('file', new File([legacyOriginal], '旧版实况.JPG'));
    const legacyUpload = await fetch(base + '/api/assets/upload', { method: 'POST', body: form }); assert.equal(legacyUpload.status, 201); const legacy = await legacyUpload.json();
    const legacyVersion = await until(async () => { const d = await (await fetch(base + '/api/assets/' + legacy.id)).json(); return d.versions[0].metadata?.livePhoto?.status === 'ready' && d.versions[0]; });
    db.prepare('UPDATE asset_versions SET metadata = ? WHERE id = ?').run('{}', legacyVersion.id);
    await navigate('/assets', "!!document.querySelector('.am-card,tbody tr')");
    await browser.evaluate("[...document.querySelectorAll('.am-card,tbody tr')].find(el=>el.textContent.includes('旧版实况.JPG')).dispatchEvent(new MouseEvent('click',{bubbles:true}))");
    await browser.wait("!!document.querySelector('#am-regenerate-preview')&&!document.querySelector('#am-regenerate-preview').disabled");
    check('已就绪的旧图片提供重新生成预览入口', await browser.evaluate("document.querySelector('#am-regenerate-preview').textContent==='重新生成预览'&&!document.querySelector('.am-detail-badges').textContent.includes('实况照片')"));
    for (const theme of ['dark', 'light']) {
        await browser.evaluate(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`);
        check(`${theme}主题旧资源重建按钮与详情操作区无裁切`, await browser.evaluate("[...document.querySelectorAll('.am-detail-actions button')].every(el=>{const r=el.getBoundingClientRect(),p=el.parentElement.getBoundingClientRect();return r.left>=p.left&&r.right<=p.right+1&&r.top>=p.top&&r.bottom<=p.bottom+1})"));
        const shot = await browser.send('Page.captureScreenshot', { format: 'png' }); await writeFile(join(root, `build/live-photo-legacy-${theme}.png`), Buffer.from(shot.data, 'base64'));
    }
    await browser.click('#am-regenerate-preview'); await browser.wait("document.querySelector('.am-detail-badges').textContent.includes('实况照片')&&!document.querySelector('#am-regenerate-preview').disabled");
    const rebuilt = await (await fetch(base + '/api/assets/' + legacy.id)).json(), rebuiltOriginal = Buffer.from(await (await fetch(base + `/api/assets/files/${legacy.id}/original/latest`)).arrayBuffer());
    check('旧图片重建识别实况，原件与版本保持不变', rebuilt.versions.length === 1 && rebuilt.versions[0].id === legacyVersion.id && rebuiltOriginal.equals(legacyOriginal));
    await openAsset('旧版实况.JPG'); await browser.click('[data-test=live-play]'); await browser.wait("!document.querySelector('.pv-live video').paused&&document.querySelector('.pv-live video').currentTime>0");
    check('旧动态JPEG重建后能实际解码播放', await browser.evaluate("document.querySelector('.pv-live video').videoWidth===128"));
    await browser.evaluate("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))"); await browser.wait("!document.querySelector('.am-modal')");
    check('无未捕获浏览器脚本异常', browser.errors.length === 0);
    check('浏览器未向外站传送媒体或票据', browser.requests.filter(url => /^https?:/.test(url)).every(url => url.startsWith(base)));
    console.log(`RESULT ${count} live photo browser checks passed; no phone hardware was accessed.`);
} finally { await browser?.close(); await album.dispose(); server.closeAllConnections(); await new Promise(done => server.close(done)); db.close(); await removeBrowserFixture(temporary); }
