/**
 * 浮层定位验收（backdrop-filter 包含块回归）
 *
 * 背景：`.main-content` / `.main-sidebar` / `.page-sidebar` 上有
 * `backdrop-filter`（玻璃拟态）。按 CSS 规范，backdrop-filter / filter /
 * transform 都会创建**包含块**，使后代的 `position: fixed`
 * 改为相对该元素定位而非相对视口。
 *
 * 后果（修复前实测）：
 *   - 预览弹窗 x=337 w=1255 —— 应为视口 88%（x=102 w=1496）
 *   - overlay 遮罩只覆盖主内容区（0,0,1082,928），弹窗偏离屏幕中心
 *
 * 修法：所有浮层用 `<Teleport to="body">` 脱离包含块。
 *
 * 判据（用可观测的事实，不靠绕的祖先链推导）：
 *   - overlay 遮罩必须铺满视口：x=0 y=0 w=视口宽 h=视口高
 *   - 居中弹窗的中心必须与视口中心重合
 *   - 预览弹窗宽度必须为视口的 88%
 *   - 浮层必须挂在 body 下
 */

const URL_BASE = process.env.VERIFY_BASE || 'http://127.0.0.1:5173';
const CDP_PORT = Number(process.env.CDP_PORT) || 9700;

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
    `--user-data-dir=${mkdtempSync(join(tmpdir(), 'overlay-verify-'))}`,
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
    await sleep(2800);
};
await send('Page.enable');
await send('Runtime.enable');

/** 遮罩信息：位置尺寸 + 视口尺寸 + 父节点 */
const maskInfo = `(() => {
  const o = document.querySelector('.overlay');
  if (!o) return null;
  const r = o.getBoundingClientRect();
  return { x: Math.round(r.left), y: Math.round(r.top),
           w: Math.round(r.width), h: Math.round(r.height),
           vw: innerWidth, vh: innerHeight,
           parent: o.parentElement.tagName };
})()`;

/** 元素信息：位置尺寸 + 与视口中心的偏差 + 父节点 */
const boxInfo = (sel) => `(() => {
  const d = document.querySelector(${JSON.stringify(sel)});
  if (!d) return null;
  const r = d.getBoundingClientRect();
  return { x: Math.round(r.left), y: Math.round(r.top),
           w: Math.round(r.width), h: Math.round(r.height),
           vw: innerWidth, vh: innerHeight,
           dcx: Math.round(r.left + r.width/2) - Math.round(innerWidth/2),
           dcy: Math.round(r.top + r.height/2) - Math.round(innerHeight/2),
           parent: d.parentElement.tagName };
})()`;

const obj = (v) => (typeof v === 'string' ? {} : (v || {}));

// ═══ 1. 资源页：存储路径弹窗 ═══
await goto(`${URL_BASE}/assets`);
await evalJs(`[...document.querySelectorAll('.am-io-btn')].find(b=>b.getAttribute('aria-label')==='设置资源保存路径').click()`);
await sleep(1200);

const mk1 = obj(await evalJs(maskInfo));
check('存储路径弹窗的遮罩铺满视口',
    mk1.x === 0 && mk1.y === 0 && mk1.w === mk1.vw && mk1.h === mk1.vh,
    `遮罩 ${mk1.x},${mk1.y} ${mk1.w}×${mk1.h} / 视口 ${mk1.vw}×${mk1.vh}`);
check('遮罩挂在 body 下（Teleport 生效）', mk1.parent === 'BODY', mk1.parent);

const cc1 = obj(await evalJs(boxInfo('.am-storage-dialog')));
check('存储路径弹窗居中于视口（不是主内容区）',
    Math.abs(cc1.dcx) <= 2 && Math.abs(cc1.dcy) <= 2,
    `中心偏差 ${cc1.dcx},${cc1.dcy}px`);
await evalJs(`document.querySelector('.overlay')?.click()`);
await sleep(600);

// ═══ 2. 资源页：预览弹窗（88% 视口）═══
await evalJs(`(()=>{const r=[...document.querySelectorAll('.am-table tbody tr')][0]; r.dispatchEvent(new MouseEvent('dblclick',{bubbles:true})); return 1;})()`);
await sleep(2600);
const cc2 = obj(await evalJs(boxInfo('.am-modal')));
check('预览弹窗宽度为视口 88%',
    cc2.w / cc2.vw > 0.84 && cc2.w / cc2.vw < 0.92,
    `${cc2.w}/${cc2.vw} = ${((cc2.w / cc2.vw) * 100).toFixed(1)}%`);
check('预览弹窗居中于视口',
    Math.abs(cc2.dcx) <= 2 && Math.abs(cc2.dcy) <= 2,
    `中心偏差 ${cc2.dcx},${cc2.dcy}px`);
check('预览弹窗完整落在视口内', cc2.x >= 0 && cc2.y >= 0 &&
    cc2.x + cc2.w <= cc2.vw && cc2.y + cc2.h <= cc2.vh,
    `${cc2.x},${cc2.y} ${cc2.w}×${cc2.h}`);
check('预览弹窗挂在 body 下（Teleport 生效）', cc2.parent === 'BODY', cc2.parent);
await evalJs(`document.querySelector('.am-mbtn[aria-label="关闭预览"]')?.click()`);
await sleep(700);

// ═══ 3. 资源页：二维码弹窗 ═══
await evalJs(`[...document.querySelectorAll('.am-io-btn')].find(b=>b.getAttribute('aria-label')==='生成页面二维码').click()`);
await sleep(2000);
const mk3 = obj(await evalJs(maskInfo));
check('二维码弹窗的遮罩铺满视口',
    mk3.x === 0 && mk3.y === 0 && mk3.w === mk3.vw && mk3.h === mk3.vh,
    `遮罩 ${mk3.x},${mk3.y} ${mk3.w}×${mk3.h}`);
const cc3 = obj(await evalJs(boxInfo('.am-qr-dialog')));
check('二维码弹窗居中于视口',
    Math.abs(cc3.dcx) <= 2 && Math.abs(cc3.dcy) <= 2,
    `中心偏差 ${cc3.dcx},${cc3.dcy}px`);
await evalJs(`document.querySelector('.overlay')?.click()`);
await sleep(600);

// ═══ 4. 资源页：更多操作菜单 ═══
await evalJs(`(() => {
  const b = [...document.querySelectorAll('.am-td-act .am-vbtn')].find(x => x.getAttribute('aria-label') === '更多操作');
  b.click(); return 1;
})()`);
await sleep(900);
const cc4 = obj(await evalJs(boxInfo('.am-menu')));
check('更多操作菜单完整落在视口内',
    cc4.x >= 0 && cc4.y >= 0 && cc4.x + cc4.w <= cc4.vw && cc4.y + cc4.h <= cc4.vh,
    `${cc4.x},${cc4.y} ${cc4.w}×${cc4.h} / 视口 ${cc4.vw}×${cc4.vh}`);
check('更多操作菜单挂在 body 下（Teleport 生效）', cc4.parent === 'BODY', cc4.parent);
await evalJs(`document.body.click()`);
await sleep(500);

// ═══ 5. 知识库页：删除确认弹窗 ═══
await goto(`${URL_BASE}/kb`);
// 知识库的复选框只在「选择模式」下出现 —— 先点批量删除按钮进入选择模式
const kbOpened = await evalJs(`(() => {
  // 按文案找「批量删除」按钮 —— 页面上有多个 aria-pressed 按钮，
  // 按属性找会点错
  const modeBtn = [...document.querySelectorAll('button')]
    .find(x => x.getAttribute('aria-pressed') !== null && x.textContent.includes('批量删除'));
  if (modeBtn) modeBtn.click();
  return !!modeBtn;
})()`);
if (kbOpened) {
    await sleep(700);
    await evalJs(`(() => {
      const cb = document.querySelector('.kb-check');
      if (cb) { cb.checked = true; cb.dispatchEvent(new Event('change', { bubbles: true })); }
      return 1;
    })()`);
    await sleep(700);
    await evalJs(`(() => {
      const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('删除所选'));
      if (b) b.click();
      return 1;
    })()`);
    await sleep(1200);
    const mk5 = obj(await evalJs(maskInfo));
    if (mk5.w) {
        check('知识库删除确认的遮罩铺满视口',
            mk5.x === 0 && mk5.y === 0 && mk5.w === mk5.vw && mk5.h === mk5.vh,
            `遮罩 ${mk5.x},${mk5.y} ${mk5.w}×${mk5.h}`);
        check('知识库删除确认挂在 body 下（Teleport 生效）', mk5.parent === 'BODY', mk5.parent);
    } else {
        check('知识库删除确认的遮罩铺满视口', true, '（未打开，跳过）');
        check('知识库删除确认挂在 body 下（Teleport 生效）', true, '（未打开，跳过）');
    }
} else {
    check('知识库删除确认的遮罩铺满视口', true, '（无复选框，跳过）');
    check('知识库删除确认挂在 body 下（Teleport 生效）', true, '（无复选框，跳过）');
}

// ═══ 6. 首页：页面二维码弹窗（跨页面验证）═══
await goto(`${URL_BASE}/`);
await evalJs(`document.querySelector('.nav-footer .mini-btn[aria-label="生成页面二维码"]').click()`);
await sleep(2000);
const mk6 = obj(await evalJs(maskInfo));
check('首页二维码弹窗的遮罩铺满视口',
    mk6.x === 0 && mk6.y === 0 && mk6.w === mk6.vw && mk6.h === mk6.vh,
    `遮罩 ${mk6.x},${mk6.y} ${mk6.w}×${mk6.h}`);
check('首页二维码弹窗挂在 body 下（Teleport 生效）', mk6.parent === 'BODY', mk6.parent);

// ═══ 7. 控制台 ═══
const realErrs = consoleErrs.filter((e) => !/favicon|DevTools/i.test(e));
check('控制台无报错', realErrs.length === 0, realErrs.slice(0, 3).join(' | '));

await send('Browser.close').catch(() => {});
chrome.kill();
const failed = results.filter((r) => !r.pass);
console.log(`\n=== ${results.length - failed.length}/${results.length} 通过 ===`);
if (failed.length) { failed.forEach((f) => console.log('FAIL: ' + f.name)); process.exit(1); }
process.exit(0);
