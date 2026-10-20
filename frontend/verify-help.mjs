// MarkdownHelp 弹窗验收（CDP 直连）
// 验证：弹窗可打开 / 三组内容齐全 / 工具栏按钮标记渲染 / 复制生效 /
//Esc 关闭 / 紧凑模式无文字 / 深色主题正常
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const URL_BASE = process.env.VERIFY_BASE || 'http://127.0.0.1:5175';
const PORT = Number(process.env.CDP_PORT) || 9237;

const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
    '--headless=new', '--disable-extensions', '--disable-gpu',
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'cdp-help-'))}`,
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
    await send('Page.navigate', { url }); await sleep(1800);
}
async function shot(name) {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(process.cwd(), name), Buffer.from(r.result.data, 'base64'));
}
await send('Page.enable'); await send('Runtime.enable');
// headless Chrome 默认拒绝剪贴板写入（NotAllowedError: Write permission denied），
// 不授权就无法验证复制功能。这只是无头环境的限制，与产品代码无关。
try {
    await send('Browser.grantPermissions', {
        origin: URL_BASE,
        permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite']
    });
} catch {
    console.log('  [warn] 剪贴板授权失败，复制断言将不成立');
}

const results = [];
const check = (name, pass, detail = '') => { results.push({ name, pass }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  → ' + detail : ''}`); };

// ── 编辑页（紧凑模式）──
await goto(`${URL_BASE}/kb/new`);
await evalJs(`(() => { try { localStorage.setItem('tt-theme','light'); } catch(e){} location.reload(); return 1; })()`);
await sleep(3500);

const compact = await evalJs(`(() => {
  const t = document.querySelector('.edit-mode-switch .help-trigger');
  return { found: !!t, text: t ? t.textContent.trim() : null, hasSvg: !!(t && t.querySelector('svg')) };
})()`);
check('编辑页紧凑模式触发按钮存在', compact.found);
check('紧凑模式只显示图标（无「帮助」文字）', compact.hasSvg && !compact.text, `text=${JSON.stringify(compact.text)}`);
await evalJs(`document.querySelector('.edit-mode-switch .help-trigger').click();`);
await sleep(700);

const dlg = await evalJs(`(() => ({
  open: !!document.querySelector('.overlay .dialog-lg'),
  title: document.querySelector('#md-help-title')?.textContent.trim(),
  sub: document.querySelector('.help-sub')?.textContent.trim(),
  groups: [...document.querySelectorAll('.help-group-title')].map(e => e.textContent.trim()),
  rows: document.querySelectorAll('.help-item').length,
  btnTags: document.querySelectorAll('.help-btn').length,
  staticRows: document.querySelectorAll('.help-item.is-static').length
}))()`);
check('弹窗已打开', dlg.open);
check('标题正确', dlg.title === 'Markdown 语法速查', dlg.title);
check('副标题提示了工具栏对应', /工具栏/.test(dlg.sub || ''), dlg.sub);
check('分组数为 7（5 可用 + 半可用 + 不生效）', dlg.groups.length === 7, dlg.groups.join(' / '));
check('语法行数 > 20', dlg.rows > 20, `${dlg.rows} 行`);
check('工具栏按钮标记已渲染', dlg.btnTags > 10, `${dlg.btnTags} 个标记`);
// 静态行 =半可用组 1 条 + 不生效组 5 条 = 6（这两组刻意不可复制）
check('静态行（不可复制）数量正确', dlg.staticRows === 6, `${dlg.staticRows} 行`);

// 语法片段不应折行：折行会让「复制到剪贴板」拿到带换行的文本，
// 粘到编辑器里就是坏的 Markdown。
const wraps = await evalJs(`(() => {
  const out = [];
  for (const el of document.querySelectorAll('.help-syntax')) {
    const r = el.getBoundingClientRect();
    // 用行高判断：单行元素的渲染高度 ≈ 一个 line-height
    const lh = parseFloat(getComputedStyle(el).lineHeight) || 20;
    if (r.height > lh * 1.6) out.push({ text: el.textContent.trim(), h: Math.round(r.height) });
  }
  return out;
})()`);
check('语法片段无折行（复制后可直接粘贴）', wraps.length === 0, wraps.map(w => w.text).join(', '));

// 半可用组必须提到「阅读页」
const partialTxt = await evalJs(`(() => {
  const gs = [...document.querySelectorAll('.help-group')];
  const g = gs.find(x => /半可用|编辑期可用/.test(x.querySelector('.help-group-title')?.textContent || ''));
  return g ? g.innerText.replace(/\\s+/g,' ').slice(0, 220) : null;
})()`);
check('半可用组说明了阅读页会丢效果', !!partialTxt && /阅读页/.test(partialTxt), (partialTxt||'').slice(0,80));

// 复制
// 必须发真实鼠标事件：element.click() 是合成事件、不产生「用户激活」，
// 而 navigator.clipboard 读写都要求用户激活，且 readText 还要求文档处于焦点态。
const box = await evalJs(`(() => {
  const el = document.querySelector('.help-list .help-item:not(.is-static)');
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), want: el.querySelector('.help-syntax').textContent.trim() };
})()`);
for (const type of ['mousePressed', 'mouseReleased']) {
    await send('Input.dispatchMouseEvent', { type, x: box.x, y: box.y, button: 'left', clickCount: 1 });
}
await sleep(600);
const copy = await evalJs(`(async () => {
  const tip = document.querySelector('.help-tip')?.textContent.trim();
  let got = null;
  try { got = await navigator.clipboard.readText(); } catch (e) { got = 'ERR:' + e.message; }
  return { got, tip };
})()`);
copy.want = box.want;
check('点击行有复制反馈', /已复制/.test(copy.tip || ''), copy.tip);
check('剪贴板内容与被点行的语法一致', copy.got === copy.want, `want=${JSON.stringify(copy.want)} got=${JSON.stringify(copy.got)}`);

await shot('shot-help-light.png');

// Esc 关闭
await evalJs(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
await sleep(500);
check('Esc 可关闭弹窗', !(await evalJs(`!!document.querySelector('.overlay .dialog-lg')`)));

// ── 详情页（非紧凑 + 深色）──
await goto(`${URL_BASE}/kb`);
const firstDoc = await evalJs(`(async()=>{const r=await fetch('/api/documents?limit=1');const j=await r.json();const it=j.items||j;return it.length?it[0].id:null;})()`);
if (firstDoc) {
    await goto(`${URL_BASE}/kb/${firstDoc}`);
    await evalJs(`(() => { try { localStorage.setItem('tt-theme','dark'); } catch(e){} location.reload(); return 1; })()`);
    await sleep(2500);
    const full = await evalJs(`(() => {
      const t = [...document.querySelectorAll('.topbar-actions .help-trigger')][0];
      if (!t) return { found: false };
      t.click();
      return { found: true, hasText: /帮助/.test(t.textContent) };
    })()`);
    await sleep(700);
    check('详情页非紧凑模式显示「帮助」文字', full.found && full.hasText);
    check('深色主题下弹窗正常打开', await evalJs(`!!document.querySelector('.overlay .dialog-lg')`));
    await shot('shot-help-dark.png');
}

const realErrs = consoleErrs.filter(e => !/favicon|DevTools/i.test(e));
check('控制台无报错', realErrs.length === 0, realErrs.slice(0,2).join(' | '));

await send('Browser.close').catch(() => {});
chrome.kill();
const failed = results.filter(r => !r.pass);
console.log(`\n=== ${results.length - failed.length}/${results.length} 通过 ===`);
if (failed.length) { failed.forEach(f => console.log('FAIL: ' + f.name)); process.exit(1); }
process.exit(0);