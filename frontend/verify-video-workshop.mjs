// 只用合成视频、临时模板及隔离浏览器；不读写真实团队库或手机。
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, writeFile, readFile, cp } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { once } from 'node:events';
import { testBrowser, removeBrowserFixture, delay } from './verify-browser.mjs';
const root = resolve(import.meta.dirname, '..'), backend = resolve(process.env.VERIFY_BACKEND_ROOT || join(root, 'backend'));
const source = name => import(pathToFileURL(join(backend, 'src', name)).href);
const { registerMediaToolsApi } = await source('media-tools-api.js');
const { processVideo, MediaToolError } = await source('media-tools.js');
const { registerVideoPresetsApi } = await source('video-presets-api.js');
const { createVideoPresets } = await source('video-presets.js');
const { bundledExecutable, runIntegrationProcess } = await source('integration-common.js');
const require = createRequire(join(backend, 'package.json')), express = require('express');
const temporary = await mkdtemp(join(tmpdir(), 'tt-video-workshop-ui-')), config = join(temporary, 'video-presets.json');
const ffmpeg = bundledExecutable('ffmpeg'), first = join(temporary, 'one.mp4'), second = join(temporary, 'two.mp4'), srt = join(temporary, 'captions.srt');
await runIntegrationProcess(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=black:s=320x240:r=15:d=1', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', first]);
await cp(first, second); await writeFile(srt, '1\n00:00:00,000 --> 00:00:02,000\nVISIBLE SUBTITLE\n');
let store = createVideoPresets({ file: config }), failSave = false, failSecond = false, slow = false;
const directories = [], invocations = [];
const app = express();
registerVideoPresetsApi(app, { service: { list: () => store.list(), save(...args) { if (failSave) { failSave = false; throw new MediaToolError('合成保存失败，请重试', 503); } return store.save(...args); }, remove: (...args) => store.remove(...args) } });
const media = registerMediaToolsApi(app, { log: () => {}, videoProcessor: async (file, signal) => {
    directories.push(file.directory); invocations.push({ name: file.name, options: file.options, subtitle: file.subtitle });
    if (slow) { await new Promise((_, reject) => { signal.addEventListener('abort', () => reject(signal.reason), { once: true }); if (signal.aborted) reject(signal.reason); }); }
    if (failSecond && file.name === 'two.mp4') { failSecond = false; throw new MediaToolError('合成第二项失败，可重试', 422); }
    return processVideo(file, signal, { executable: ffmpeg });
} });
app.get('/api/documents/tree', (_req, res) => res.json({ items: [] })); app.get('/api/documents', (_req, res) => res.json({ items: [] })); app.get('/api/assets', (_req, res) => res.json({ items: [] }));
app.use('/api', (_req, res) => res.status(503).json({ message: '隔离验收没有真实资料' }));
const dist = resolve(process.env.VERIFY_DIST || join(root, 'frontend/dist'));
app.use(express.static(dist, { index: false })); app.get('/{*path}', (_req, res) => res.sendFile(join(dist, 'index.html')));
const server = app.listen(0, '127.0.0.1'); await once(server, 'listening'); const base = `http://127.0.0.1:${server.address().port}`;
let browser, count = 0;
const check = (name, value = true) => { assert.ok(value, name); console.log(`PASS ${++count} ${name}`); };
async function waitLong(expression) { for (let i = 0; i < 200; i++) { if (await browser.evaluate(expression)) return; await delay(100); } throw Error('等待超时：' + expression); }
async function navigate(path = '/tools/video-process') { await browser.send('Page.navigate', { url: base + path }); await browser.wait("!!document.querySelector('#media-files')"); await browser.wait("document.querySelector('#video-template')?.textContent.includes('均衡')"); }
async function clickText(text) { await browser.evaluate(`{const button=[...document.querySelectorAll('.video-workshop button')].find(el=>el.textContent.trim()===${JSON.stringify(text)});if(!button)throw Error('missing button');button.click();}`); await delay(30); }
async function many(files) { const doc = await browser.send('DOM.getDocument'), input = await browser.send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '#media-files' }); await browser.send('DOM.setFileInputFiles', { nodeId: input.nodeId, files }); }
async function shot(name) { const result = await browser.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); await writeFile(join(root, 'build', name), Buffer.from(result.data, 'base64')); }
try {
    browser = await testBrowser(temporary); await navigate();
    check('五个内置模板从真实受限API读取', store.list().length === 5);
    await browser.select('#video-template', 'unity-1080');
    check('Unity模板选择后直接应用分辨率与帧率', await browser.evaluate("document.querySelector('#video-width').value==='1920'&&document.querySelector('#video-height').value==='1080'&&document.querySelector('#video-fps').textContent.includes('30')&&document.querySelector('#video-profile').textContent.includes('Main')"));
    await browser.click('#video-tab-audio'); check('Unity音频AAC48kHz双声道', await browser.evaluate("document.querySelector('#video-sample-rate').textContent.includes('48')&&document.querySelector('#video-channels').textContent.includes('双声道')"));
    await browser.click('#video-tab-video'); await browser.fill('#video-crf', 21); await browser.click('#video-tab-trim'); await browser.fill('#video-start', 2); await browser.fill('#video-duration', 3);
    await browser.click('#video-save-new'); await browser.fill('#video-preset-name', '我的Unity'); failSave = true; await browser.click('#video-confirm-save');
    await browser.wait("document.querySelector('.ui-dialog [role=alert]')?.textContent.includes('保存失败')");
    check('保存失败保留弹窗、名称和当前参数', await browser.evaluate("document.querySelector('#video-preset-name').value==='我的Unity'&&document.querySelector('#video-start').value==='2'"));
    await browser.click('#video-confirm-save'); await browser.wait("!document.querySelector('.ui-dialog')");
    let saved = store.list().find(item => item.name === '我的Unity');
    check('模板保存到服务器且排除裁剪时间和文件', saved && saved.options.crf === 21 && !('start' in saved.options) && !JSON.stringify(await readFile(config, 'utf8')).includes('one.mp4'));
    await browser.select('#video-template', 'balanced'); await browser.select('#video-template', saved.id);
    check('复用模板重置本次裁剪时间', await browser.evaluate("document.querySelector('#video-start').value==='0'&&document.querySelector('#video-duration').value===''") );
    await browser.click('#video-update-preset'); await browser.fill('#video-preset-name', 'Unity重命名');
    store.save({ name: saved.name, options: { ...saved.options, crf: 20 }, revision: saved.revision }, saved.id);
    await browser.click('#video-confirm-save'); await browser.wait("document.querySelector('.ui-dialog [role=alert]')?.textContent.includes('其他页面')");
    check('并发冲突不覆盖模板并保留改名草稿', await browser.evaluate("document.querySelector('#video-preset-name').value==='Unity重命名'"));
    await browser.evaluate("document.querySelector('.ui-dialog [aria-label=关闭弹窗]').click()"); await clickText('刷新模板'); await browser.wait("!document.querySelector('#video-update-preset').disabled");
    await browser.click('#video-update-preset'); await browser.fill('#video-preset-name', 'Unity重命名'); await browser.click('#video-confirm-save'); await browser.wait("!document.querySelector('.ui-dialog')");
    store = createVideoPresets({ file: config }); saved = store.list().find(item => item.id === saved.id);
    check('改名更新及重建服务仍保留压制参数', saved.name === 'Unity重命名' && saved.options.crf === 21);
    await navigate(); await browser.select('#video-template', saved.id); await browser.click('#video-tab-video');
    check('刷新页面从服务器恢复自定义模板', await browser.evaluate("document.querySelector('#video-crf').value==='21'"));
    for (const theme of ['dark', 'light']) for (const width of [1700, 1280]) {
        await browser.send('Emulation.setDeviceMetricsOverride', { width, height: 1050, deviceScaleFactor: 1, mobile: false });
        await browser.evaluate(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`); await delay(200);
        check(`${theme}/${width}参数和队列无横向溢出`, await browser.evaluate("[...document.querySelectorAll('.workshop-panel')].every(el=>el.scrollWidth<=el.clientWidth+1)&&document.querySelector('.main-content').scrollWidth<=document.querySelector('.main-content').clientWidth+1"));
        await browser.click('#video-fps'); check(`${theme}/${width}菜单挂到body且选项清晰`, await browser.evaluate("document.querySelector('.ui-choice-overlay').parentElement===document.body&&[...document.querySelectorAll('.ui-choice-overlay [role=option]')].every(el=>{const s=getComputedStyle(el);return s.color!=='transparent'})"));
        await browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
        if (width === 1700) await shot(`v0140-video-${theme}.png`);
    }
    await many([first, second]); failSecond = true; await browser.click('#media-start');
    await waitLong("!document.querySelector('#media-stop').disabled"); await waitLong("!document.querySelector('#media-start').disabled");
    check('批量实际编码第一项，第二项失败明确反馈', await browser.evaluate("document.querySelectorAll('.workshop-item a[download]').length===1&&document.querySelector('.workshop-item:last-child').textContent.includes('失败')"));
    await browser.click('#media-start'); await waitLong("document.querySelectorAll('.workshop-item a[download]').length===2");
    check('只重试失败项且保留成功结果', invocations.map(item => item.name).join(',') === 'one.mp4,two.mp4,two.mp4');
    const result = await browser.evaluate("(async()=>{const a=document.querySelector('.workshop-item a[download]'),r=await fetch(a.href);return {name:a.download,size:(await r.blob()).size};})()");
    check('队列返回真实可下载MP4而非空占位', result.name.endsWith('.mp4') && result.size > 100);
    await browser.click('#media-reset'); await browser.click('#video-tab-subtitle'); await browser.select('#video-subtitle-mode', 'burn'); await browser.click('#media-start');
    check('烧录未选字幕阻止整批执行并指引选择', await browser.evaluate("document.querySelector('[role=alert]').textContent.includes('需要字幕')"));
    await browser.choose('#video-subtitle-file', srt); await browser.click('#media-start'); await waitLong("document.querySelectorAll('.workshop-item a[download]').length===2");
    check('外置字幕应用到两项真实编码', invocations.slice(-2).every(item => item.subtitle === 'subtitle.srt' && item.options.subtitleMode === 'burn'));
    await browser.click('#media-reset'); slow = true; await browser.click('#media-start'); await waitLong("document.querySelector('.workshop-item').textContent.includes('正在编码')");
    const beforeCancel = invocations.length; await browser.click('#media-stop'); await browser.wait("!document.querySelector('#media-start').disabled");
    check('停止在途任务并阻止后续文件启动', invocations.length === beforeCancel && await browser.evaluate("document.querySelector('.workshop-item').textContent.includes('已停止')"));
    await browser.click('#media-start'); await waitLong("document.querySelector('.workshop-item').textContent.includes('正在编码')");
    await browser.evaluate("Object.defineProperty(document,'hidden',{value:true,configurable:true});document.dispatchEvent(new Event('visibilitychange'));"); await browser.wait("!document.querySelector('#media-start').disabled");
    check('后台停止采集和编码队列', await browser.evaluate("document.querySelector('.workshop-item').textContent.includes('已停止')"));
    await browser.evaluate("Object.defineProperty(document,'hidden',{value:false,configurable:true});");
    await browser.click('#media-start'); await waitLong("document.querySelector('.workshop-item').textContent.includes('正在编码')"); await browser.click('#tool-tab-toolbox'); await browser.wait("!!document.querySelector('.page-tools')");
    await delay(200); check('离页等待取消并清理全部随机临时目录', directories.every(path => !existsSync(path)));
    slow = false; await navigate(); await browser.select('#video-template', saved.id); await browser.click('#video-delete-preset');
    check('删除模板先弹出确认且键盘聚焦弹窗', await browser.evaluate("!!document.querySelector('#video-confirm-delete')&&document.querySelector('.ui-dialog').contains(document.activeElement)"));
    await browser.click('#video-confirm-delete'); await browser.wait("!document.querySelector('.ui-dialog')"); check('确认删除仅删除模板，压制参数保留', !store.list().some(item => item.id === saved.id) && await browser.evaluate("document.querySelector('#video-crf').value==='21'"));
    check('所有浏览器请求同源或Blob，未访问外部网站', browser.requests.every(url => url.startsWith(base) || url.startsWith('blob:') || url.startsWith('data:')));
    check('浏览器脚本无未处理异常', browser.errors.length === 0);
    console.log(`视频压制浏览器验收 ${count}/${count}`);
} catch (error) { if (browser) { await shot('v0140-video-failure.png'); console.log(await browser.evaluate("document.querySelector('.video-workshop')?.innerText")); } throw error; }
finally { await browser?.close(); await media.dispose(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await removeBrowserFixture(temporary); }
