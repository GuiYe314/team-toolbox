// 文档卡片布局验收（CDP 直连）
// 验证点针对本轮改动：
//   1) 列表返回 snippet（否则卡片只有标题，等于白改）
//   2) snippet 已剥离 Markdown 源码符号与日期前缀，读起来像句话
//   3) 卡片是多列网格而非一行一条（信息密度）
//   4) 同一排卡片等高（摘要固定 2 行 + flex 占位）
//   5) 摘要最多 2 行（-webkit-line-clamp 生效，不撑高卡片）
//   6) 首页与知识库视觉语言一致
//   7) 列表接口不回传 content_md 正文（体积优化）
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const URL_BASE = process.env.VERIFY_BASE || 'http://127.0.0.1:5173';
const PORT = Number(process.env.CDP_PORT) || 9420;

const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
    '--headless=new', '--disable-extensions', '--disable-gpu',
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'cdp-cards-'))}`,
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
    await sleep(2000);
}
await send('Page.enable'); await send('Runtime.enable');

const results = [];
const check = (name, pass, detail = '') => { results.push({ name, pass }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  → ' + detail : ''}`); };

// 造一篇内容丰富的文档：覆盖 Markdown 标题、列表、链接、加粗、日期前缀
const stamp = 'CARD' + Date.now().toString().slice(-6);
const created = await (await fetch(`${URL_BASE}/api/documents`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
        title: stamp,
        content_md: [
            '## 部署步骤',
            '',
            '2026-10-18',
            '- **构建**：执行 `npm run build` 产出静态资源',
            '- [发布](https://example.com) 将产物上传到内网服务器',
            '',
            '> 注意：发布前需确认后端 3000 端口已就绪',
            '',
            '```bash',
            'npm run build && node server.js',
            '```',
            '',
            '2026-10-19 完成灰度验证，切流比例 10%。'
        ].join('\n')
    })
})).json();

const cleanup = async () => {
    await fetch(`${URL_BASE}/api/documents/${created.id}`, { method: 'DELETE' }).catch(() => {});
};
process.on('exit', cleanup);

await goto(`${URL_BASE}/kb`);
await evalJs(`(() => { try { localStorage.setItem('tt-theme','light'); } catch(e){} location.reload(); return 1; })()`);
await sleep(2200);

// ── 1. 接口层：snippet 与体积 ──
const api = await (await fetch(`${URL_BASE}/api/documents?limit=50`)).json();
const mine = api.items.find(i => i.title === stamp);
check('列表接口返回 snippet', !!mine && typeof mine.snippet === 'string' && mine.snippet.length > 0,
    mine ? JSON.stringify((mine.snippet || '').slice(0, 40)) : '未找到测试文档');
check('列表接口不回传正文 content_md', mine ? !('content_md' in mine) : false,
    mine ? Object.keys(mine).join(',') : '');

// ── 2. snippet 质量：不能出现 Markdown 源码符号 ──
const snip = (mine && mine.snippet) || '';
check('snippet 已剥离日期前缀', !/\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(snip), JSON.stringify(snip.slice(0, 40)));
check('snippet 无 Markdown 源码符号', !/[#*`|\]]|\]\(/.test(snip), JSON.stringify(snip));

// ── 3. 卡片布局：多列网格 ──
const grid = await evalJs(`(() => {
  const list = document.querySelector('.doc-list');
  if (!list) return { exists: false };
  const cards = [...document.querySelectorAll('.doc-row')];
  const rows = new Map();
  for (const c of cards) {
    const top = Math.round(c.getBoundingClientRect().top);
    rows.set(top, (rows.get(top) || 0) + 1);
  }
  const cs = getComputedStyle(list);
  const first = cards[0] ? cards[0].getBoundingClientRect() : null;
  const second = cards[1] ? cards[1].getBoundingClientRect() : null;
  return { exists: true, display: cs.display, cols: cs.gridTemplateColumns.split(' ').length,
           cards: cards.length,
           firstRowCount: rows.size ? Math.max(...rows.values()) : 0,
           sameLine: first && second ? Math.abs(first.top - second.top) < 4 : false,
           cardW: first ? Math.round(first.width) : 0 };
})()`);
check('文档列表为 Grid 布局', grid.exists && grid.display === 'grid', grid.display);
check('文档卡片已渲染', grid.cards > 0, grid.cards + ' 张');
check('卡片多列排列（非一行一条）', grid.firstRowCount >= 2 && grid.sameLine,
    `首行 ${grid.firstRowCount} 张，卡片宽 ${grid.cardW}px`);

// ── 4. 卡片等高：只比**同一排**的卡片 ──
// 不同排的卡片本来就可以有不同高度（内容长度不同），拿全量比会误判。
const rowHeights = await evalJs(`(() => {
  const cards = [...document.querySelectorAll('.doc-row')];
  const rows = new Map();
  for (const c of cards) {
    const top = Math.round(c.getBoundingClientRect().top);
    if (!rows.has(top)) rows.set(top, []);
    rows.get(top).push(Math.round(c.getBoundingClientRect().height));
  }
  // 只看第一排
  const firstTop = Math.min(...rows.keys());
  return rows.get(firstTop);
})()`);
const maxH = Math.max(...rowHeights), minH = Math.min(...rowHeights);
check('同一排卡片等高', rowHeights.length < 2 || maxH - minH <= 2, `heights=${JSON.stringify(rowHeights)}`);

// ── 5. 摘要限 2 行 ──
const clamp = await evalJs(`(() => {
  const s = document.querySelector('.doc-snippet');
  if (!s) return null;
  const cs = getComputedStyle(s);
  const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.5;
  return { lines: Math.round(s.getBoundingClientRect().height / lh),
           clamp: cs.webkitLineClamp, text: s.textContent.trim().slice(0, 30) };
})()`);
check('摘要限 2 行（line-clamp 生效）', clamp && String(clamp.clamp) === '2', clamp ? `clamp=${clamp.clamp} 实测${clamp.lines}行` : '未找到摘要');
check('摘要已渲染到卡片', clamp && clamp.text.length > 0, clamp ? JSON.stringify(clamp.text) : '');

// ── 6. 首页卡片与知识库一致 ──
await goto(`${URL_BASE}/`);
const home = await evalJs(`(() => {
  const list = document.querySelector('.recent-list');
  if (!list) return { exists: false };
  const cards = [...document.querySelectorAll('.recent-item')];
  const cs = getComputedStyle(list);
  return { exists: true, display: cs.display, cards: cards.length,
           hasSnippet: !!document.querySelector('.recent-snippet') };
})()`);
check('首页最近更新为 Grid 布局', home.exists && home.display === 'grid', home.display);
check('首页卡片已渲染', home.cards > 0, home.cards + ' 张');
check('首页卡片含摘要', home.hasSnippet);

// 首页与知识库用同一套类名语义（.doc-snippet / .recent-snippet 视觉语言一致）
const sameLang = await evalJs(`(() => {
  const a = document.querySelector('.recent-snippet');
  const cs = a ? getComputedStyle(a) : null;
  return cs ? { clamp: cs.webkitLineClamp, color: cs.color } : null;
})()`);
check('首页摘要同样限 2 行', sameLang && String(sameLang.clamp) === '2', sameLang ? `clamp=${sameLang.clamp}` : '');

// ── 7. 卡片网格随容器变窄而降列（不靠缩放页面） ──
// 注意两点口径：
//  ① .app-layout 刻意设了 min-width:1280px（窄屏横向滚动而非整体缩放，
//     见 layout.css），所以不能用「视口变窄→列数变少」来断言——视口变窄时
//     页面栏先折叠、主内容宽度反而不变，与容器宽度不是一回事。
//  ② 因此直接改主内容容器宽度来测，这才是 minmax+auto-fit 真正响应的东西。
await goto(`${URL_BASE}/kb`, 1600, 1000);
const responsive = await evalJs(`(() => {
  const main = document.querySelector('.main-content');
  const list = document.querySelector('.doc-list');
  const cols = () => getComputedStyle(list).gridTemplateColumns.split(' ').length;
  const natural = { w: Math.round(list.getBoundingClientRect().width), cols: cols() };
  // 依次压窄主内容，列数应随之递减
  const samples = [];
  for (const w of [900, 700, 520]) {
    main.style.width = w + 'px';
    void list.offsetWidth;
    samples.push({ w, cols: cols() });
  }
  main.style.width = '';
  return { natural, samples };
})()`);
check('容器变窄时卡片列数递减',
    responsive.samples.every((s, i) => i === 0 || s.cols <= responsive.samples[i - 1].cols) &&
    responsive.samples[responsive.samples.length - 1].cols < responsive.natural.cols,
    `自然 ${responsive.natural.w}px=${responsive.natural.cols}列 → ` +
    responsive.samples.map(s => `${s.w}px=${s.cols}列`).join(' → '));

// 卡片宽度不应超出容器（防止 minmax 下限把网格撑破导致横向滚动条）
const fits = await evalJs(`(() => {
  const list = document.querySelector('.doc-list');
  const card = document.querySelector('.doc-row');
  const lw = list.getBoundingClientRect().width;
  const cw = card.getBoundingClientRect().width;
  return { overflow: cw > lw + 1, lw: Math.round(lw), cw: Math.round(cw) };
})()`);
check('卡片宽度未超出列表容器', !fits.overflow, `list=${fits.lw} card=${fits.cw}`);

// 全局 min-width 生效时页面不横向溢出（视口 ≥1280 时）
const noOverflow = await evalJs(`document.documentElement.scrollWidth <= window.innerWidth + 1`);
check('1280px 以上无横向溢出', noOverflow === true);

const realErrs = consoleErrs.filter(e => !/favicon|DevTools/i.test(e));
check('控制台无报错', realErrs.length === 0, realErrs.slice(0, 2).join(' | '));

await cleanup();
await send('Browser.close').catch(() => {});
chrome.kill();
const failed = results.filter(r => !r.pass);
console.log(`\n=== ${results.length - failed.length}/${results.length} 通过 ===`);
if (failed.length) { failed.forEach(f => console.log('FAIL: ' + f.name)); process.exit(1); }
process.exit(0);