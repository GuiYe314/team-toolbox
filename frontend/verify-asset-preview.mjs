/**
 * 预览管线前端验收
 *
 * 覆盖：
 * 1. 列表/网格缩略图真的显示（不是类型图标）
 * 2. 预览弹窗加载的是**预览图**而非原图
 * 3. 预览失败状态可见且可重试
 * 4. 预览状态徽标正确
 */

const URL_BASE = process.env.VERIFY_BASE || 'http://127.0.0.1:5173';
const CDP_PORT = Number(process.env.CDP_PORT) || 9400;
const STAMP = 'PV' + Date.now().toString().slice(-6);

import { spawn } from 'node:child_process';
import { purgeTestAssets } from './verify-cleanup.mjs';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const results = [];
const check = (name, pass, detail = '') => {
    results.push({ name, pass });
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  → ' + detail : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── 准备一张真实 PNG（前端直接上传，让后端走一遍管线）─────────────
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAGQAAABkCAYAAABw4pVUAAAAaklEQVR42u3BAQ0AAADCoPdPbQ8HAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgLYFZgGz8B4SCAF0dC5UO7UAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADgvwZ2gAAB0EJnwAAAABJRU5ErkJggg==';

const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
    '--headless=new', '--disable-gpu', '--no-first-run', '--disable-extensions',
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${mkdtempSync(join(tmpdir(), 'pv-verify-'))}`,
    '--window-size=1700,1050', 'about:blank'
], { stdio: 'ignore' });

let targets;
for (let i = 0; i < 40; i++) {
    try {
        targets = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
        if (targets.length) break;
    } catch { /* 还没起来 */ }
    await sleep(300);
}
const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
let msgId = 0;
const pending = new Map();
const consoleErrs = [];
ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
        consoleErrs.push(m.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
    }
});
await new Promise((r) => ws.addEventListener('open', r));
const send = (method, params = {}) => {
    const n = ++msgId;
    ws.send(JSON.stringify({ id: n, method, params }));
    return new Promise((r) => pending.set(n, r));
};
const evalJs = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result?.exceptionDetails) return 'EXC ' + JSON.stringify(r.result.exceptionDetails).slice(0, 200);
    return r.result?.result?.value;
};
const goto = async (url, w = 1700, h = 1050) => {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url });
    await sleep(2600);
};
await send('Page.enable');
await send('Runtime.enable');

/** 通过后端 API 上传一个文件，返回资源 id。 */
async function apiUpload(name, buffer) {
    const fd = new FormData();
    fd.append('file', new File([buffer], name));
    const r = await fetch(`${URL_BASE}/api/assets/upload`, { method: 'POST', body: fd });
    return { status: r.status, body: await r.json().catch(() => null) };
}
/** 轮询直到该资源进入预览终态。 */
async function waitPreview(assetId, timeoutMs = 20000) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
        const r = await fetch(`${URL_BASE}/api/assets/${assetId}`);
        const d = await r.json();
        const v = (d.versions || [])[0];
        if (v && ['ready', 'failed', 'none'].includes(v.previewStatus)) return v;
        await sleep(300);
    }
    return null;
}

// ═══ 1. 上传一张真 PNG，验证预览生成 ═══
const pngBuf = Buffer.from(PNG_B64, 'base64');
const up = await apiUpload(STAMP + '预览验证.png', pngBuf);
check('上传 PNG 成功', up.status === 201, `status=${up.status}`);
const assetId = up.body?.id;

let ver = null;
if (assetId) {
    ver = await waitPreview(assetId);
    check('预览状态进入终态', !!ver, ver ? ver.previewStatus : '超时');
    check('预览生成成功（ready）', ver?.previewStatus === 'ready',
        ver ? `${ver.previewStatus} ${ver.previewError || ''}` : '');
    check('生成了缩略图', !!ver?.thumbnailStorageKey, ver?.thumbnailStorageKey || '无');
    check('生成了预览图', !!ver?.previewStorageKey, ver?.previewStorageKey || '无');
}

// ═══ 2. 列表里的缩略图真的显示 ═══
await goto(`${URL_BASE}/assets`);
const thumbState = await evalJs(`(() => {
    const rows = [...document.querySelectorAll('.am-table tbody tr')];
    const row = rows.find(r => r.textContent.includes(${JSON.stringify(STAMP)}));
    if (!row) return { found: false };
    const img = row.querySelector('.am-thumb img');
    return {
        found: true,
        hasImg: !!img,
        natural: img ? img.naturalWidth + 'x' + img.naturalHeight : '',
        src: img ? img.getAttribute('src') : '',
        complete: img ? img.complete : false
    };
})()`);
const ts = typeof thumbState === 'string' ? {} : thumbState;
check('列表渲染出该资源', ts.found === true);
check('列表显示真实缩略图（非类型图标）', ts.hasImg === true, ts.natural || '');
check('缩略图已加载完成', ts.complete === true);
check('缩略图走的是 thumbnail 端点', /\/thumbnail\//.test(ts.src || ''), ts.src || '');

// ═══ 3. 预览弹窗加载的是预览图，不是原图 ═══
await evalJs(`(() => {
    const row = [...document.querySelectorAll('.am-table tbody tr')].find(r => r.textContent.includes(${JSON.stringify(STAMP)}));
    row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    return 1;
})()`);
await sleep(3000);
const dlg = await evalJs(`(() => {
    const stage = document.querySelector('.am-modal-stage');
    if (!stage) return { open: false };
    const img = stage.querySelector('img');
    return {
        open: true,
        imgSrc: img ? img.getAttribute('src') : '',
        natural: img ? img.naturalWidth + 'x' + img.naturalHeight : '',
        errBoxes: stage.querySelectorAll('.pv-error').length
    };
})()`);
const ds = typeof dlg === 'string' ? {} : dlg;
check('预览弹窗已打开', ds.open === true);
check('预览加载的是预览图（/preview/ 而非 /original/）',
    /\/preview\//.test(ds.imgSrc || ''), ds.imgSrc || '无 img');
check('预览图加载成功', /^\d+x\d+$/.test(ds.natural || ''), ds.natural || '');
check('没有误报错误框', ds.errBoxes === 0, `${ds.errBoxes} 个`);

// ═══ 4. 预览状态徽标 ═══
await evalJs(`document.querySelector('.am-mbtn[aria-label="关闭预览"]')?.click()`);
await sleep(600);
await evalJs(`(() => {
    const row = [...document.querySelectorAll('.am-table tbody tr')].find(r => r.textContent.includes(${JSON.stringify(STAMP)}));
    row.click();
    return 1;
})()`);
await sleep(1200);
const detail = await evalJs(`(() => {
    const d = document.querySelector('.am-detail');
    if (!d) return { open: false };
    return {
        open: true,
        badge: (d.querySelector('.am-ver-preview') || {}).textContent?.trim() || '',
        failBadge: (d.querySelector('.am-ver-preview-fail') || {}).textContent?.trim() || '',
        thumbImg: !!d.querySelector('.am-detail-thumb img')
    };
})()`);
const dl = typeof detail === 'string' ? {} : detail;
check('详情面板已打开', dl.open === true);
check('详情显示真实缩略图', dl.thumbImg === true);
check('预览成功后不显示「正在生成预览」徽标', !dl.badge.includes('正在生成'), dl.badge || '无');
check('预览成功后不显示「预览失败」徽标', !dl.failBadge.includes('预览失败'), dl.failBadge || '无');

// ═══ 5. 失败场景：视频（无 ffmpeg）应显示失败徽标与原因 ═══
const mp4Head = Buffer.alloc(24);
mp4Head.writeUInt32BE(20, 0);
mp4Head.write('ftypisom', 4, 'ascii');
mp4Head.writeUInt32BE(512, 16);
const vup = await apiUpload(STAMP + '视频验证.mp4', Buffer.concat([mp4Head, Buffer.alloc(400)]));
let vver = null;
if (vup.body?.id) {
    vver = await waitPreview(vup.body.id);
    check('视频预览标记为 failed（缺 ffmpeg）', vver?.previewStatus === 'failed',
        vver ? `${vver.previewStatus}` : '超时');
    check('失败原因已记录', !!vver?.previewError, vver?.previewError || '无');
}
await goto(`${URL_BASE}/assets`);
await evalJs(`(() => {
    const row = [...document.querySelectorAll('.am-table tbody tr')].find(r => r.textContent.includes(${JSON.stringify(STAMP)}));
    row.click();
    return 1;
})()`);
await sleep(1200);
const failDetail = await evalJs(`(() => {
    const d = document.querySelector('.am-detail');
    if (!d) return { open: false };
    return {
        open: true,
        failBadge: (d.querySelector('.am-ver-preview-fail') || {}).textContent?.trim() || '',
        errText: (d.querySelector('.am-preview-err') || {}).textContent?.trim() || '',
        hasRetry: !!d.querySelector('.am-link-btn')
    };
})()`);
const fd = typeof failDetail === 'string' ? {} : failDetail;
check('失败资源详情显示「预览失败」徽标', fd.failBadge.includes('预览失败'), fd.failBadge || '无');
check('失败原因对用户可见', fd.errText.length > 0, fd.errText || '无');
check('提供重试入口', fd.hasRetry === true);

// ═══ 6. 控制台无报错 ═══
const realErrs = consoleErrs.filter((e) => !/favicon|DevTools/i.test(e));
check('控制台无报错', realErrs.length === 0, realErrs.slice(0, 3).join(' | '));

// ── 清理 ──
// 不只删本轮 id：脚本若中途被中断，id 可能没记录下来；
// 按名称特征（PV + 数字）把历次残留一并清掉，且同时扫正常集合与回收站。
async function cleanup() {
    await purgeTestAssets(URL_BASE + '/api', /^PV\d{4,}/);
    for (const id of [assetId, vup.body?.id].filter(Boolean)) {
        await fetch(`${URL_BASE}/api/assets/batch-delete`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ assetIds: [id] })
        }).catch(() => {});
        await fetch(`${URL_BASE}/api/assets/purge?confirm=1`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ assetIds: [id] })
        }).catch(() => {});
    }
}
await cleanup();

await send('Browser.close').catch(() => {});
chrome.kill();
const failed = results.filter((r) => !r.pass);
console.log(`\n=== ${results.length - failed.length}/${results.length} 通过 ===`);
if (failed.length) { failed.forEach((f) => console.log('FAIL: ' + f.name)); process.exit(1); }
process.exit(0);
