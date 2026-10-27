// Vditor 接入验收脚本（CDP 直连，无第三方依赖）
// 验证：实例创建 / 资源全部本地 / 工具栏渲染 / 内容区渲染 / 旧 textarea 已移除 /
//       工具栏点击可改内容 / getValue 往返一致 / 无 CDN 外网请求 / 控制台无报错
import { spawn } from 'node:child_process';
import { purgeTestDocuments } from './verify-cleanup.mjs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const URL_BASE = process.env.VERIFY_BASE || 'http://127.0.0.1:5175';
const PORT = 9233;

const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
    '--headless=new', '--disable-extensions', '--disable-gpu',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${mkdtempSync(join(tmpdir(), 'cdp-vditor-'))}`,
    '--window-size=1600,1000', 'about:blank'
], { stdio: 'ignore' });

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function targets() {
    for (let i = 0; i < 40; i++) {
        try {
            const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
            const j = await r.json();
            if (j.length) return j;
        } catch { /* retry */ }
        await sleep(300);
    }
    throw new Error('CDP not ready');
}

const list = await targets();
const page = list.find(t => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const requests = [];
const consoleErrors = [];
ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    if (m.method === 'Network.requestWillBeSent') requests.push(m.params.request.url);
    if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) {
        consoleErrors.push(m.params.args.map(a => a.value ?? a.description ?? '').join(' '));
    }
    if (m.method === 'Runtime.exceptionThrown') {
        consoleErrors.push(m.params.exceptionDetails?.exception?.description || 'exception');
    }
});
await new Promise(r => ws.addEventListener('open', r));
function send(method, params = {}) {
    const n = ++id;
    ws.send(JSON.stringify({ id: n, method, params }));
    return new Promise(r => pending.set(n, r));
}
async function evalJs(expr) {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
    return r.result?.result?.value;
}
async function goto(url, w = 1600, h = 1000) {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url });
    await sleep(1800);
}
async function shot(name) {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    const { writeFileSync } = await import('node:fs');
    writeFileSync(join(process.cwd(), name), Buffer.from(r.result.data, 'base64'));
}
await send('Page.enable');
await send('Network.enable');
await send('Runtime.enable');

const results = [];
const check = (name, pass, detail = '') => { results.push({ name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  → ' + detail : ''}`); };

// ── 准备一篇文档，拿到编辑页地址 ──
await goto(`${URL_BASE}/kb`);
await evalJs(`(() => { try { localStorage.setItem('tt-theme', 'light'); } catch (e) {} })()`);

const doc = await evalJs(`(async () => {
  const r = await fetch('/api/documents', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: '__vditor-verify__', content_md: '# 标题\\n\\n初始正文。\\n\\n- 一\\n- 二' })
  });
  const j = await r.json();
  return { id: j.id };
})()`);
check('探针文档已创建', !!doc.id, `id=${doc.id}`);

// ── 进入编辑页 ──
await goto(`${URL_BASE}/kb/${doc.id}/edit`);
await sleep(3500); // 3.7MB lute 内核解析需要时间

const state = await evalJs(`(() => {
  const host = document.querySelector('.md-editor');
  // 注意：不能断言「编辑区里没有 textarea」——Vditor 的 sv 模式内部就用一个
  // textarea.vditor-sv 作为编辑区。要断言的是**旧方案的** textarea（.md-input）已不存在。
  const ta = document.querySelector('.md-input');
  return {
    hasHost: !!host,
    stillTextarea: !!ta,
    hasVditorRoot: !!document.querySelector('.vditor'),
    toolbar: !!document.querySelector('.vditor-toolbar'),
    toolbarBtns: document.querySelectorAll('.vditor-toolbar button').length,
    contentArea: !!document.querySelector('.vditor-content'),
    contentText: (document.querySelector('.vditor-content')?.innerText || '').trim().slice(0, 80)
  };
})()`);

check('编辑器外壳已挂载', state.hasHost);
check('旧 textarea 已移除', !state.stillTextarea);
check('Vditor 根节点已渲染', state.hasVditorRoot);
check('工具栏已渲染', state.toolbar);
check('工具栏按钮数 > 10', state.toolbarBtns > 10, `${state.toolbarBtns} 个`);
check('内容区已渲染', state.contentArea);
check('初始内容已灌入', state.contentText.includes('标题') || state.contentText.includes('初始正文'), JSON.stringify(state.contentText));

// 实例是否真的建起来：Vue 组件的 $refs 拿不到，但 Vditor 实例会把 __vditor 挂到元素上
const inst = await evalJs(`(() => {
  const root = document.querySelector('.vditor');
  if (!root) return { ok: false, reason: 'no .vditor root' };
  const v = root.__vditor;
  return { ok: !!v, hasGetValue: !!(v && typeof v.getValue === 'function') };
})()`);
check('Vditor 实例已创建', inst.ok);
check('实例 getValue 可用', inst.hasGetValue);

// 资源来源核对
const localAssets = requests.filter(u => u.includes('/vendor/vditor/'));
check('Vditor 资源从本地加载', localAssets.length >= 3, `${localAssets.length} 个本地请求`);
check('lute 内核已加载', localAssets.some(u => u.includes('lute.min.js')));
const external = requests.filter(u => /^https?:\/\//.test(u) && !u.includes('127.0.0.1'));
check('无任何外网请求', external.length === 0, external.slice(0, 5).join(', '));

// ── 工具栏交互：点「粗体」后内容应变化 ──
const bold = await evalJs(`(async () => {
  const v = document.querySelector('.vditor')?.__vditor;
  if (!v) return { md: '' };
  const el = document.querySelector('.vditor-content p, .vditor-content h1, .vditor-content div');
  if (!el) return { md: '' };
  el.focus();
  const sel = window.getSelection();
  sel.removeAllRanges();
  const r = document.createRange();
  r.selectNodeContents(el);
  sel.addRange(r);
  const btn = [...document.querySelectorAll('.vditor-toolbar button')]
    .find(b => /bold/i.test(b.getAttribute('data-type') || b.className || ''));
  if (!btn) return { md: '' };
  btn.click();
  await new Promise(r => setTimeout(r, 900));
  return { md: v.getValue() };
})()`);
check('工具栏按钮可点击并改写内容', !!bold.md && /\*\*/.test(bold.md), (bold.md || JSON.stringify(bold)).slice(0, 60));

// ── 往返一致性：getValue 内容再 setValue 回去应稳定 ──
const roundtrip = await evalJs(`(() => {
  const root = document.querySelector('.vditor');
  if (!root || !root.__vditor) return { ok: false };
  const v = root.__vditor;
  const a = v.getValue();
  v.setValue(a);
  const b = v.getValue();
  const c = v.getValue();
  // 不要求 a === b：Vditor 会规范化 Markdown（列表符号、空白等），
  // 这是预期行为。真正的硬要求是：正文不丢，且此后取值稳定（幂等）。
  const keepsHeading = b.includes('标题');
  const keepsBody = b.includes('初始正文');
  return { ok: true, stable: b === c, keepsHeading, keepsBody, len: b.length };
})()`);
check('往返后正文未丢失', roundtrip.ok && roundtrip.keepsHeading && roundtrip.keepsBody, `len=${roundtrip.len}`);
check('连续 getValue 稳定（幂等）', roundtrip.stable);

await shot('shot-vditor-light.png');

// ── 深色主题 ──
await evalJs(`(() => { localStorage.setItem('tt-theme', 'dark'); location.reload(); return 1; })()`);
await sleep(4000);
const dark = await evalJs(`(() => ({
  html: document.documentElement.getAttribute('data-theme'),
  hasVditor: !!document.querySelector('.vditor'),
  toolbar: !!document.querySelector('.vditor-toolbar')
}))()`);
check('深色主题下编辑器仍在', dark.hasVditor && dark.toolbar, `data-theme=${dark.html}`);
await shot('shot-vditor-dark.png');

// 清理：软删之后必须 purge（TASK-016），否则探针文档堆在回收站里。
// 兜底：上面若因断言/异常提前退出，探针文档会留在库里变成垃圾数据，
// 进而干扰其他按标题前缀匹配的验证脚本。退出时无条件再清一次。
await evalJs(`fetch('/api/documents/${doc.id}', { method: 'DELETE' }).then(r => r.status)`);
await purgeTestDocuments(URL_BASE + '/api', /^__vditor-verify__$/);
process.on('exit', () => {
    fetch(`${URL_BASE}/api/documents/purge?confirm=1`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [doc.id] })
    }).catch(() => {});
});

// ── 控制台 ──
const realErrors = consoleErrors.filter(e => !/favicon|DevTools/i.test(e));
check('控制台无报错', realErrors.length === 0, realErrors.slice(0, 3).join(' | '));

await send('Browser.close').catch(() => {});
chrome.kill();

const failed = results.filter(r => !r.pass);
console.log(`\n=== ${results.length - failed.length}/${results.length} 通过 ===`);
if (failed.length) { failed.forEach(f => console.log(`FAIL: ${f.name} ${f.detail}`)); process.exit(1); }
process.exit(0);