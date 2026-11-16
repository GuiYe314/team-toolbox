// 使用 FFmpeg 合成 H.264 与固定 scrcpy 帧协议，不运行 ADB 或连接手机。
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { once } from 'node:events';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { testBrowser, removeBrowserFixture, delay } from './verify-browser.mjs';
const backendRoot = resolve(process.env.VERIFY_BACKEND_ROOT || fileURLToPath(new URL('../backend', import.meta.url)));
const { bundledExecutable, runIntegrationProcess } = await import(pathToFileURL(join(backendRoot, 'src/integration-common.js')).href);
const require = createRequire(join(backendRoot, 'package.json')), express = require('express');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const temporary = await mkdtemp(join(tmpdir(), 'tt-mirror-browser-'));
const raw = join(temporary, 'fixture.h264'), streams = new Set(), controls = [];
let browser, server, enabled = false, stopped = 0, failControl = false, count = 0;
const check = (label, value = true) => { assert.ok(value, label); console.log(`PASS ${++count} ${label}`); };
const packet = (bytes, flags) => { const header = Buffer.alloc(12); header.writeBigUInt64BE(flags); header.writeUInt32BE(bytes.length, 8); return Buffer.concat([header, bytes]); };
try {
    await runIntegrationProcess(bundledExecutable('ffmpeg'), ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=blue:s=160x120:r=10:d=0.1', '-frames:v', '1', '-c:v', 'libx264', '-profile:v', 'baseline', '-pix_fmt', 'yuv420p', '-tune', 'zerolatency', '-f', 'h264', raw]);
    const bytes = await readFile(raw), starts = [];
    for (let index = 0; index + 3 < bytes.length; index++) {
        const prefix = bytes[index] === 0 && bytes[index + 1] === 0 ? bytes[index + 2] === 1 ? 3 : bytes[index + 2] === 0 && bytes[index + 3] === 1 ? 4 : 0 : 0;
        if (prefix) { starts.push({ index, type: bytes[index + prefix] & 31 }); index += prefix - 1; }
    }
    const nals = starts.map((item, index) => ({ type: item.type, data: bytes.subarray(item.index, starts[index + 1]?.index ?? bytes.length) }));
    const config = Buffer.concat(nals.filter(item => [7, 8].includes(item.type)).map(item => item.data));
    const frame = Buffer.concat(nals.filter(item => ![7, 8].includes(item.type)).map(item => item.data));
    assert.ok(config.length && nals.some(item => item.type === 5));
    const size = Buffer.alloc(12); size.writeUInt32BE(0x80000000); size.writeUInt32BE(160, 4); size.writeUInt32BE(120, 8);
    const app = express(); app.use(express.json());
    app.get('/api/documents/tree', (_req, res) => res.json({ items: [] }));
    app.get('/api/documents', (_req, res) => res.json({ items: [] }));
    app.get('/api/android/devices', (_req, res) => res.json({ devices: enabled ? [{ serial: 'fixture-usb', model: '合成离线设备', state: 'device' }] : [] }));
    app.get('/api/android/mirror/capabilities', (_req, res) => res.json({ ready: true, version: '5.0.1' }));
    app.post('/api/android/mirror', (req, res) => { assert.equal(req.body.serial, 'fixture-usb'); assert.equal(req.body.confirmed, true); res.json({ id: 'fixture', version: '5.0.1' }); });
    app.get('/api/android/mirror/fixture', (_req, res) => res.json({ active: true }));
    app.post('/api/android/mirror/fixture/control', (req, res) => {
        if (failControl && req.body.type === 'key') { failControl = false; return res.status(503).json({ message: '合成暂时控制失败，请重试' }); }
        controls.push(req.body); res.json({ ok: true });
    });
    app.delete('/api/android/mirror/fixture', (_req, res) => { stopped++; res.json({ ok: true }); });
    app.get('/api/android/mirror/fixture/video', (_req, res) => {
        res.type('application/octet-stream'); res.write(Buffer.concat([Buffer.from('h264'), size, packet(config, 1n << 62n)]));
        let timestamp = 0n;
        const send = () => { res.write(packet(frame, (1n << 61n) | timestamp)); timestamp += 100000n; };
        send(); const timer = setInterval(send, 100); streams.add(res);
        res.once('close', () => { clearInterval(timer); streams.delete(res); });
    });
    app.use('/api', (_req, res) => res.status(503).json({ message: '隔离验收无真实数据' }));
    const dist = resolve(process.env.VERIFY_DIST || join(root, 'frontend/dist')); app.use(express.static(dist, { index: false })); app.get('/{*path}', (_req, res) => res.sendFile(join(dist, 'index.html')));
    server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
    const base = `http://127.0.0.1:${server.address().port}`;
    browser = await testBrowser(temporary);
    await browser.send('Page.navigate', { url: base + '/tools/android-mirror' });
    await browser.wait("!!document.querySelector('#mirror-device')");
    check('无设备时不能启动，不生成虚构画面', await browser.evaluate("document.querySelector('#mirror-start').disabled&&document.querySelector('canvas').width===300"));
    enabled = true; await browser.evaluate("[...document.querySelectorAll('button')].find(item=>item.textContent==='刷新设备').click()");
    await browser.wait("document.querySelector('#mirror-device').value==='fixture-usb'");
    const start = async () => { await browser.click('#mirror-start'); await browser.wait("document.querySelector('[role=status]').textContent.includes('正在投屏')"); };
    const stop = async () => { await browser.evaluate("[...document.querySelectorAll('button')].find(item=>item.textContent==='停止投屏').click()"); await browser.wait("!document.querySelector('#mirror-start').disabled"); await delay(150); };
    await start();
    check('WebCodecs 实际解码 H.264 并绘制蓝色画面', await browser.evaluate("(()=>{const canvas=document.querySelector('canvas');return canvas.width===160&&canvas.height===120&&canvas.getContext('2d').getImageData(50,50,1,1).data[2]>150})()"));
    check('协议尺寸同步到控制通道', controls.some(value => value.type === 'dimensions' && value.width === 160 && value.height === 120));
    const point = await browser.evaluate("(()=>{const r=document.querySelector('canvas').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()");
    await browser.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
    await browser.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
    await delay(200); check('真实鼠标点击发送限定坐标的按下和抬起', [0, 1].every(action => controls.some(value => value.type === 'touch' && value.action === action && value.x >= 0 && value.x < 160 && value.y >= 0 && value.y < 120)));
    failControl = true;
    await browser.evaluate("[...document.querySelectorAll('button')].find(item=>item.textContent==='主页').click()");
    await browser.wait("document.querySelector('[role=alert]')?.textContent.includes('暂时控制失败')");
    await browser.evaluate("[...document.querySelectorAll('button')].find(item=>item.textContent==='主页').click()"); await delay(250);
    check('控制请求暂时失败后可继续使用', [0, 1].every(action => controls.some(value => value.type === 'key' && value.action === action && value.keycode === 3)));
    for (const theme of ['dark', 'light']) {
        await browser.evaluate(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`); await delay(200);
        const shot = await browser.send('Page.captureScreenshot', { format: 'png' }); await writeFile(join(root, `build/workshops-mirror-${theme}.png`), Buffer.from(shot.data, 'base64'));
    }
    await stop(); check('停止关闭视频请求与服务，保留最后画面', stopped === 1 && streams.size === 0 && await browser.evaluate("document.querySelector('canvas').getContext('2d').getImageData(50,50,1,1).data[2]>150"));
    await start();
    await browser.evaluate("Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'))");
    await browser.wait("!document.querySelector('#mirror-start').disabled"); await delay(200);
    check('进入后台停止解码和视频会话', stopped === 2 && streams.size === 0);
    await browser.evaluate("Object.defineProperty(document,'hidden',{configurable:true,value:false})");
    await start(); await browser.click('#tool-tab-toolbox'); await browser.wait("!!document.querySelector('.page-tools')"); await delay(250);
    check('离开页面释放视频和控制会话', stopped === 3 && streams.size === 0);
    check('浏览器没有未处理脚本异常', browser.errors.length === 0);
    check('所有视频和脚本请求保持本地', browser.requests.every(url => url.startsWith(base) || url.startsWith('blob:') || url.startsWith('data:')));
    console.log(`完成 ${count} 项合成协议浏览器验收；不代表手机真机验收`);
} catch (error) {
    if (browser) console.log('合成投屏诊断', await browser.evaluate("({status:document.querySelector('[role=status]')?.textContent,error:document.querySelector('[role=alert]')?.textContent,width:document.querySelector('canvas')?.width,height:document.querySelector('canvas')?.height,supported:!!window.VideoDecoder})"), { controls, stopped, streams: streams.size, errors: browser.errors });
    throw error;
} finally {
    await browser?.close(); for (const response of streams) response.destroy();
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    await removeBrowserFixture(temporary);
}
