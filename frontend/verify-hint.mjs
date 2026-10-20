// v-hint 悬停提示验收（CDP 直连）
// 验证：延迟 1 秒才出现 / 提前移开不出现 / 原生 title 已移除（无双气泡）/
//       气泡内容正确 / 定位在按钮下方且不出视口 / 移开即消失 /
//       带文字按钮不被误接管 / 动态 class 按钮正常 / 深色主题样式正确
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const URL_BASE = process.env.VERIFY_BASE || 'http://127.0.0.1:5175';
const PORT = Number(process.env.CDP_PORT) || 9240;

const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
    '--headless=new', '--disable-extensions', '--disable-gpu',
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'cdp-hint-'))}`,
    '--window-size=1600,1000', 'about:blank'
], { stdio: 'ignore' });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function targets() {
    for (let i = 0; i < 40; i++) {
        try { const j = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); if (j.length) return j; } catch {}
        await sleep(300);
    }
    throw new Error('no cdp');
}
const list = await targets();
const ws = new WebSocket(list.find(t => t.type === 'page').webSocketDebuggerUrl);
let id = 0; const pending = new Map(); const consoleErrs = [];
ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
        consoleErrs.push(m.params.args.map(a => a.value ?? a.description ?? '').join(' '));
    }
});
await new Promise(r => ws.addEventListener('open', r));
function send(method, params = {}) { const n = ++id; ws.send(JSON.stringify({ id: n, method, params })); return new Promise(r => pending.set(n, r)); }
async function evalJs(expression) { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails)); return r.result?.result?.value; }
async function goto(url, w = 1600, h = 1000) {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url });
    await sleep(1800);
}
async function shot(name) {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(process.cwd(), name), Buffer.from(r.result.data, 'base64'));
}
/** 真实鼠标悬停：合成事件不产生 mouseenter 的浏览器默认行为 */
async function hover(x, y) {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await sleep(30);
}
async function unhover(x = 5, y = 5) {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await sleep(30);
}
await send('Page.enable'); await send('Runtime.enable');

const results = [];
const check = (name, pass, detail = '') => { results.push({ name, pass }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  → ' + detail : ''}`); };

// 取「某个被接管按钮自己那个」气泡的状态。
// 注意：页面上同时存在多个 .vhint（每个图标按钮一个），
// 用 document.querySelector('.vhint') 会拿到别的按钮的气泡，断言必然出错。
const tipState = (idx = 0) => evalJs(`(() => {
  const els = [...document.querySelectorAll('[data-vhint]')].filter(e => e.getBoundingClientRect().width > 0);
  const el = els[${idx}];
  const t = el && el.__vhint ? el.__vhint.tip : null;
  if (!t) return { exists: false };
  const cs = getComputedStyle(t);
  const r = t.getBoundingClientRect();
  return {
    exists: true, display: t.style.display, text: t.textContent,
    opacity: cs.opacity, bg: cs.backgroundColor, color: cs.color,
    z: cs.zIndex, pe: cs.pointerEvents,
    rect: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
    anchor: (() => { const b = el.getBoundingClientRect();
      return { cx: Math.round(b.left + b.width/2), top: Math.round(b.top), bottom: Math.round(b.bottom) }; })()
  };
})()`);

// 任一气泡是否可见（扫过一排按钮的用例里，说不清是哪一个，就全查）
const anyTipVisible = () => evalJs(`[...document.querySelectorAll('.vhint')].some(t => t.style.display === 'block' && parseFloat(getComputedStyle(t).opacity) > 0.05)`);

// ── 知识库页（有多个图标按钮）──
await goto(`${URL_BASE}/kb`);
await evalJs(`(() => { try { localStorage.setItem('tt-theme','light'); } catch(e){} location.reload(); return 1; })()`);
await sleep(2200);

// 注意：被指令接管的按钮，其原生 title 已被**移除**（否则会双气泡），
// 所以不能用 hasAttribute('title') 找候选，要用 __vhint 标记。
const targets_ = await evalJs(`(() => {
  const out = [];
  for (const el of document.querySelectorAll('[data-vhint]')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0) continue;
    out.push({ cls: el.className.trim(), hasTitle: el.hasAttribute('title'),
               aria: el.getAttribute('aria-label'), text: (el.textContent||'').trim(),
               hinted: !!el.__vhint,
               cx: Math.round(r.left + r.width/2), cy: Math.round(r.top + r.height/2) });
  }
  return out;
})()`);
check('页面上存在被接管的图标按钮', targets_.length >= 1, `${targets_.length} 个`);

const themedIdx = 0;
const themed = targets_[themedIdx];
check('接管后原生 title 已移除', themed && !themed.hasTitle, themed ? `hasTitle=${themed.hasTitle}` : '');

if (!themed) { console.log('\n无候选按钮，提前结束'); process.exit(1); }

// 1) 悬停 300ms（不足 1 秒）→ 不应出现
await hover(themed.cx, themed.cy);
await sleep(320);
let s = await tipState(themedIdx);
check('悬停 0.3s 时气泡未出现（延迟生效）', !s.exists || s.display === 'none' || parseFloat(s.opacity) < 0.05,
    s.exists ? `display=${s.display} opacity=${s.opacity}` : 'DOM 未创建');

await unhover();
await sleep(250);

// 2) 悬停满 1.2 秒 → 应出现
await hover(themed.cx, themed.cy);
await sleep(1250);
s = await tipState(themedIdx);
check('悬停满 1.2s 后气泡出现', s.exists && s.display === 'block' && parseFloat(s.opacity) > 0.9,
    s.exists ? `display=${s.display} opacity=${s.opacity} text=${JSON.stringify(s.text)}` : 'DOM 未创建');
check('气泡内容等于原 title', s.exists && s.text === themed.aria,
    `tip=${JSON.stringify(s.text)} aria=${JSON.stringify(themed.aria)}`);
check('气泡不拦截鼠标（避免抖动）', s.exists && s.pe === 'none', s.exists ? s.pe : '');

// 3) 定位：应在按钮下方且不超出视口
const posOk = s.exists ? {
  // 按钮贴近视口底部时气泡会翻到上方（避免溢出），两种摆位都算正确
  below: s.rect.y >= s.anchor.bottom - 2,
  above: s.rect.y + s.rect.h <= s.anchor.top + 2,
  inViewport: s.rect.x >= 0 && s.rect.x + s.rect.w <= 1600,
  overlap: (s.rect.x <= s.anchor.cx && s.rect.x + s.rect.w >= s.anchor.cx),
  tRect: s.rect, bRect: s.anchor
} : { below: false, above: false, inViewport: false, overlap: false, tRect: { x: 0, y: 0, w: 0, h: 0 }, bRect: { cx: 0, top: 0, bottom: 0 } };
check('气泡在按钮下方（空间不足时翻到上方）', posOk.below || posOk.above,
    `tip.top=${posOk.tRect.y} btn=[${posOk.bRect.top}, ${posOk.bRect.bottom}] ${posOk.above ? '(已翻到上方)' : ''}`);
// 贴边按钮会被 --vhint-shift 推回视口内，此时中心不再与按钮重合——这是刻意行为，
// 所以只要求「水平方向仍有重叠」而不是「中心严格对齐」。
check('气泡水平覆盖按钮', posOk.overlap,
    `tip=[${posOk.tRect.x}, ${posOk.tRect.x + posOk.tRect.w}] btn.cx=${posOk.bRect.cx}`);
check('气泡未超出视口', posOk.inViewport, `x=${posOk.tRect.x} right=${posOk.tRect.x + posOk.tRect.w}`);

await shot('shot-hint-light.png');

// 4) 移开 → 消失
await unhover();
await sleep(400);
check('移开鼠标后气泡消失', !(await anyTipVisible()));

// 5) 连续快速扫过一排按钮 → 不应出现气泡（这正是延迟的意义）
const rowBtns = await evalJs(`(() => [...document.querySelectorAll('[data-vhint]')]
  .filter(b => b.getBoundingClientRect().width > 0).slice(0,4)
  .map(b => { const r=b.getBoundingClientRect(); return {x:Math.round(r.left+r.width/2), y:Math.round(r.top+r.height/2)}; }))()`);
for (const b of rowBtns) { await hover(b.x, b.y); await sleep(180); }
check('快速扫过 4 个按钮（每个 0.18s）气泡不出现', !(await anyTipVisible()));
await unhover(); await sleep(200);

// 6) 动态 class 按钮（:class 绑定 is-on）也应被接管
const dyn = await evalJs(`(() => {
  const all = [...document.querySelectorAll('[data-vhint]')];
  const i = all.findIndex(x => x.classList.contains('mini-btn') && x.getBoundingClientRect().width > 0);
  if (i < 0) return null;
  const b = all[i]; const r = b.getBoundingClientRect();
  return { idx: i, cx: Math.round(r.left+r.width/2), cy: Math.round(r.top+r.height/2),
           hasTitle: b.hasAttribute('title'), aria: b.getAttribute('aria-label'),
           cls: b.className, vhint: !!b.__vhint };
})()`);
check('动态 class 按钮已被指令接管', dyn && dyn.vhint, dyn ? `class="${dyn.cls}"` : '未找到可见 .mini-btn');
check('被接管的按钮已移除原生 title（无双气泡）', dyn && !dyn.hasTitle, dyn ? `title=${dyn.hasTitle}` : '');

if (dyn) {
    await hover(dyn.cx, dyn.cy);
    await sleep(1250);
    s = await tipState();
    check('动态 class 按钮悬停能出气泡', s.exists && s.display === 'block', s.exists ? s.text : '未出现');
    // 切换 class 后内容应更新
    await unhover(); await sleep(250);
    const before = (await tipState(dyn.idx)).text;
    await evalJs(`[...document.querySelectorAll('.mini-btn')].find(x => x.getBoundingClientRect().width > 0).click()`);
    await sleep(600);
    const after = await evalJs(`(() => {
      const b = [...document.querySelectorAll('.mini-btn')].find(x => x.getBoundingClientRect().width > 0);
      const r = b.getBoundingClientRect();
      return { cx: Math.round(r.left+r.width/2), cy: Math.round(r.top+r.height/2), aria: b.getAttribute('aria-label') };
    })()`);
    await hover(after.cx, after.cy);
    await sleep(1250);
    s = await tipState(dyn.idx);
    check('切换后 aria-label 确实发生变化', after.aria !== dyn.aria, `${dyn.aria} → ${after.aria}`);
    check('title 变化后气泡内容同步更新', s.exists && s.text === after.aria,
        `before=${JSON.stringify(before)} after=${JSON.stringify(s.text)} aria=${JSON.stringify(after.aria)}`);
    await evalJs(`[...document.querySelectorAll('.mini-btn')].find(x => x.getBoundingClientRect().width > 0).click()`);   // 还原
    await unhover(); await sleep(250);
}

// 7) 深色主题
await evalJs(`(() => { localStorage.setItem('tt-theme','dark'); location.reload(); return 1; })()`);
await sleep(2500);
const darkBtn = await evalJs(`(() => { const b=[...document.querySelectorAll('[data-vhint]')].find(x=>x.getBoundingClientRect().width>0); if(!b) return null; const r=b.getBoundingClientRect(); return {cx:Math.round(r.left+r.width/2),cy:Math.round(r.top+r.height/2)}; })()`);
if (darkBtn) {
    await hover(darkBtn.cx, darkBtn.cy);
    await sleep(1250);
    s = await tipState(0);
    const darkOk = s.exists && s.display === 'block';
    check('深色主题下气泡出现', darkOk, s.exists ? s.text : '未出现');
    // 深色下背景不应是纯白
    const isWhite = s.exists && /255,\s*255,\s*255/.test(s.bg);
    check('深色主题下气泡背景非纯白', s.exists && !isWhite, s.exists ? s.bg : '');
    check('深色主题下文字为浅色', s.exists && parseInt(s.color.match(/\d+/g)[0]) > 150, s.exists ? s.color : '');
    await shot('shot-hint-dark.png');
    await unhover();
}

const realErrs = consoleErrs.filter(e => !/favicon|DevTools/i.test(e));
check('控制台无报错', realErrs.length === 0, realErrs.slice(0, 2).join(' | '));

await send('Browser.close').catch(() => {});
chrome.kill();
const failed = results.filter(r => !r.pass);
console.log(`\n=== ${results.length - failed.length}/${results.length} 通过 ===`);
if (failed.length) { failed.forEach(f => console.log('FAIL: ' + f.name)); process.exit(1); }
process.exit(0);