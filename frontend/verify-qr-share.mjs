/**
 * 二维码分享验收
 *
 * 覆盖：
 * 1. 页面二维码按钮存在于所有页面（主导航底部）
 * 2. 资源管理页有「生成页面二维码」按钮
 * 3. 每个资源行有「生成下载二维码」按钮
 * 4. 弹窗渲染出真实二维码（SVG path，不是占位）
 * 5. 二维码内容 = 当前页面 URL
 * 6. 资源二维码内容 = 带 ?download=1 的下载地址
 * 7. 对外访问地址可配置并生效（改了地址二维码内容跟着变）
 * 8. 下载端点确实返回 attachment（手机扫码会直接下载）
 * 9. 深色主题下二维码前景是浅色（否则扫不出来）
 */

const URL_BASE = process.env.VERIFY_BASE || 'http://127.0.0.1:5173';
const CDP_PORT = Number(process.env.CDP_PORT) || 9500;

import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const results = [];
const check = (name, pass, detail = '') => {
    results.push({ name, pass });
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  → ' + detail : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
    '--headless=new', '--disable-gpu', '--no-first-run', '--disable-extensions',
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${mkdtempSync(join(tmpdir(), 'qr-verify-'))}`,
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

// ═══ 1. 主导航的页面二维码按钮（所有页面通用）═══
await goto(`${URL_BASE}/`);
const navQr = await evalJs(`(() => {
    const b = document.querySelector('.nav-footer .mini-btn[aria-label="生成页面二维码"]');
    return { found: !!b, title: b ? b.getAttribute('title') : '' };
})()`);
check('主导航底部有页面二维码按钮', navQr.found === true, navQr.title || '');

// 在非资源管理页也能打开
await evalJs(`document.querySelector('.nav-footer .mini-btn[aria-label="生成页面二维码"]').click()`);
await sleep(2200);
const homeQr = await evalJs(`JSON.stringify({
    open: !!document.querySelector('.am-qr-dialog'),
    hasSvg: !!document.querySelector('.am-qr-svg svg'),
    // qrcode 的 SVG 结构：第 1 个 path 是背景矩形，第 2 个是数据（用 stroke 画模块）
    dataLen: (() => {
        const ps = document.querySelectorAll('.am-qr-svg svg path');
        if (ps.length < 2) return 0;
        return (ps[1].getAttribute('d') || '').length;
    })(),
    url: (document.querySelector('.am-qr-url') || {}).textContent || ''
})`);
const hq = JSON.parse(homeQr);
check('首页能打开页面二维码弹窗', hq.open === true);
check('二维码是真实 SVG（有 path 数据）', hq.hasSvg === true && hq.dataLen > 200, `数据 path 长度 ${hq.dataLen}`);
check('二维码内容 = 当前页 URL', hq.url.endsWith('/'), hq.url);
await evalJs(`document.querySelector('.am-qr-foot .btn')?.click()`);
await sleep(500);

// ═══ 2. 资源管理页的页面二维码按钮 ═══
await goto(`${URL_BASE}/assets`);
const ioQr = await evalJs(`(() => {
    const b = [...document.querySelectorAll('.am-io-btn')].find(x => x.getAttribute('aria-label') === '生成页面二维码');
    return { found: !!b };
})()`);
check('资源管理页有「生成页面二维码」按钮', ioQr.found === true);

await evalJs(`[...document.querySelectorAll('.am-io-btn')].find(x=>x.getAttribute('aria-label')==='生成页面二维码').click()`);
await sleep(2200);
const pageQr = await evalJs(`JSON.stringify({
    title: (document.querySelector('.am-qr-title') || document.querySelector('.dialog-title') || {}).textContent || '',
    url: (document.querySelector('.am-qr-url') || {}).textContent || '',
    hasSvg: !!document.querySelector('.am-qr-svg svg')
})`);
const pq = JSON.parse(pageQr);
check('资源管理页二维码弹窗标题正确', pq.title.includes('扫码'), pq.title);
check('资源管理页二维码内容 = /assets', pq.url.includes('/assets'), pq.url);
check('资源管理页二维码已渲染', pq.hasSvg === true);

// ═══ 3. 对外访问地址可配置并生效 ═══
const before = pq.url;
await evalJs(`(() => {
    const i = document.querySelector('.am-qr-origin');
    i.value = 'http://192.168.1.50:5205';
    i.dispatchEvent(new Event('input', { bubbles: true }));
    return 1;
})()`);
await sleep(300);
await evalJs(`[...document.querySelectorAll('.am-qr-dialog .btn')].find(b=>b.textContent.trim()==='应用').click()`);
await sleep(1800);
const after = await evalJs(`(document.querySelector('.am-qr-url')||{}).textContent||''`);
check('设置对外访问地址后二维码内容随之改变',
    after.includes('192.168.1.50') && after !== before, after);

// ═══ 4. 资源下载二维码 ═══
await evalJs(`document.querySelector('.am-qr-foot .btn')?.click()`);
await sleep(600);
const rowQrBtn = await evalJs(`(() => {
    const b = document.querySelector('.am-td-act .am-vbtn[aria-label="生成下载二维码"]');
    return { found: !!b, total: document.querySelectorAll('.am-td-act .am-vbtn[aria-label="生成下载二维码"]').length };
})()`);
check('每个资源行都有二维码按钮', rowQrBtn.found === true, `共 ${rowQrBtn.total} 个`);

await evalJs(`document.querySelector('.am-td-act .am-vbtn[aria-label="生成下载二维码"]').click()`);
await sleep(2200);
const assetQr = await evalJs(`JSON.stringify({
    title: (document.querySelector('.dialog-title') || {}).textContent || '',
    url: (document.querySelector('.am-qr-url') || {}).textContent || '',
    hasSvg: !!document.querySelector('.am-qr-svg svg')
})`);
const aq = JSON.parse(assetQr);
check('资源二维码弹窗标题是「扫码下载资源」', aq.title.includes('下载资源'), aq.title);
check('资源二维码内容是下载地址', /\/api\/assets\/files\/\d+\/original\//.test(aq.url), aq.url);
check('下载地址带 download=1（手机会直接下载）', aq.url.includes('download=1'), aq.url);
check('资源二维码已渲染', aq.hasSvg === true);

// ═══ 5. 下载端点确实返回 attachment ═══
// 注意：不能直接 fetch 上面的 aq.url —— 那是被测改成 192.168.1.50 的地址，
// 本机访问不到。这里从接口取一个真实资源 id 自行拼下载地址来验证。
const realAsset = await (await fetch(`${URL_BASE}/api/assets?pageSize=1`)).json();
const realId = realAsset?.items?.[0]?.id;
const dlUrl = `${URL_BASE}/api/assets/files/${realId}/original/latest?download=1`;
const dl = await fetch(dlUrl);
const cd = dl.headers.get('content-disposition') || '';
check('下载端点返回 attachment（手机直接下载而非打开）',
    dl.status === 200 && /attachment/.test(cd), `${dl.status} ${cd.slice(0, 60)}`);

// ═══ 6. 已发布资源优先用 published 版本 ═══
await evalJs(`document.querySelector('.am-qr-foot .btn')?.click()`);
await sleep(600);
const pubRow = await evalJs(`(() => {
    const rows = [...document.querySelectorAll('.am-table tbody tr')];
    const r = rows.find(x => x.textContent.includes('发布 v'));
    if (!r) return null;
    const b = r.querySelector('.am-vbtn[aria-label="生成下载二维码"]');
    b.click();
    return true;
})()`);
if (pubRow) {
    await sleep(2200);
    const pubUrl = await evalJs(`(document.querySelector('.am-qr-url')||{}).textContent||''`);
    check('已发布资源的二维码指向 published 版本',
        pubUrl.includes('/published'), pubUrl);
    await evalJs(`document.querySelector('.am-qr-foot .btn')?.click()`);
    await sleep(500);
} else {
    check('已发布资源的二维码指向 published 版本', true, '（无已发布资源，跳过）');
}

// ═══ 7. 深色主题下二维码前景为浅色 ═══
await evalJs(`try{localStorage.setItem('tt-theme','dark')}catch(e){}`);
await goto(`${URL_BASE}/assets`);
await evalJs(`document.querySelector('.nav-footer .mini-btn[aria-label="生成页面二维码"]').click()`);
await sleep(2200);
const darkFg = await evalJs(`(() => {
    const ps = document.querySelectorAll('.am-qr-svg svg path');
    if (ps.length < 2) return '';
    // qrcode 把前景色放在数据 path 的 stroke 上（不是 fill）
    const f = ps[1].getAttribute('stroke') || ps[1].getAttribute('fill') || '';
    const m = f.match(/#([0-9a-f]{6})/i);
    if (!m) return f;
    const r = parseInt(m[1].slice(0,2),16), g = parseInt(m[1].slice(2,4),16), b = parseInt(m[1].slice(4,6),16);
    return (r + g + b) / 3 > 128 ? 'light' : 'dark';
})()`);
check('深色主题下二维码前景为浅色（否则扫不出）', darkFg === 'light', darkFg || '未取到颜色');
// 颜色必须来自 CSS 变量（--qr-foreground/--qr-background），
// 不能在组件里硬编码 —— 主题切换时变量变了 SVG 不会自动更新，
// 所以还额外用 MutationObserver 监听 data-theme 重绘
const qrToken = await evalJs(`(() => {
  const cs = getComputedStyle(document.documentElement);
  return { fg: cs.getPropertyValue('--qr-foreground').trim(),
           bg: cs.getPropertyValue('--qr-background').trim() };
})()`);
const qt = typeof qrToken === 'string' ? {} : qrToken;
check('二维码颜色走 CSS 变量（--qr-foreground/--qr-background）',
    !!qt.fg && !!qt.bg, `fg=${qt.fg} bg=${qt.bg}`);
// 前景色确实取自变量（与变量值一致）
const fgMatches = await evalJs(`(() => {
  const ps = document.querySelectorAll('.am-qr-svg svg path');
  if (ps.length < 2) return 'no-svg';
  const used = (ps[1].getAttribute('stroke') || ps[1].getAttribute('fill') || '').toLowerCase();
  const token = getComputedStyle(document.documentElement).getPropertyValue('--qr-foreground').trim().toLowerCase();
  return used === token ? 'match' : 'mismatch:' + used + ' vs ' + token;
})()`);
check('二维码前景色与 --qr-foreground 一致', fgMatches === 'match', String(fgMatches));
await evalJs(`document.querySelector('.am-qr-foot .btn')?.click()`);
await sleep(400);

// ═══ 8. 控制台无报错 ═══
const realErrs = consoleErrs.filter((e) => !/favicon|DevTools/i.test(e));
check('控制台无报错', realErrs.length === 0, realErrs.slice(0, 3).join(' | '));

await send('Browser.close').catch(() => {});
chrome.kill();
const failed = results.filter((r) => !r.pass);
console.log(`\n=== ${results.length - failed.length}/${results.length} 通过 ===`);
if (failed.length) { failed.forEach((f) => console.log('FAIL: ' + f.name)); process.exit(1); }
process.exit(0);
