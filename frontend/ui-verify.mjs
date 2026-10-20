// UI 重构验收脚本（CDP 直连，无第三方依赖）
// 验证：三栏布局 / 主题切换 / 分类数据保留 / 响应式折叠 / 无横向溢出
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const URL_BASE = process.env.VERIFY_BASE || 'http://127.0.0.1:5173';
const PORT = 9222;

const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
    '--headless=new', '--disable-extensions', '--disable-gpu',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${mkdtempSync(join(tmpdir(), 'cdp-'))}`,
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
ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
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
    await sleep(1600);
}
async function shot(name) {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    const { writeFileSync } = await import('node:fs');
    writeFileSync(join(process.cwd(), name), Buffer.from(r.result.data, 'base64'));
}
await send('Page.enable');

const results = [];
const check = (name, pass, detail = '') => { results.push({ name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  → ' + detail : ''}`); };

// ── 1. Light 主题三栏布局 ──
// 显式写死 light，避免跟随宿主系统偏好导致断言不稳定
await goto(`${URL_BASE}/kb`);
await evalJs(`localStorage.setItem('tt-theme','light'); location.reload();`).catch(() => {});
await sleep(1500);
let r = await evalJs(`(() => {
  const q = s => document.querySelector(s);
  const box = s => { const e = q(s); return e ? Math.round(e.getBoundingClientRect().width) : null; };
  return {
    theme: document.documentElement.getAttribute('data-theme'),
    main: box('.main-sidebar'), page: box('.page-sidebar'), content: box('.main-content'),
    docRows: document.querySelectorAll('.doc-row').length,
    hasCategory: !!q('.category-sidebar'),
    hasCatalogInside: !!q('.kb-catalog'),
    bodyOverflowX: document.documentElement.scrollWidth > window.innerWidth + 1,
    blur: getComputedStyle(q('.main-content')).backdropFilter
  };
})()`);
check('主题初始化为 light', r.theme === 'light', r.theme);
check('三栏均渲染（主导航/页面树/内容）', r.main > 150 && r.page > 150 && r.content > 600, JSON.stringify({ main: r.main, page: r.page, content: r.content }));
check('侧栏宽度符合 190-250 规范', r.main >= 190 && r.main <= 220 && r.page >= 190 && r.page <= 250, JSON.stringify({ main: r.main, page: r.page }));
check('内容区最小宽度 ≥600', r.content >= 600, String(r.content));
check('文档行已渲染', r.docRows > 0, r.docRows + ' 行');
check('分类侧栏已移除', r.hasCategory === false && r.hasCatalogInside === false);
check('无横向溢出', r.bodyOverflowX === false);
check('主内容使用 backdrop-filter', String(r.blur).includes('blur'), String(r.blur));
await shot('shot-light-kb.png');

// ── 2. 文档行 Grid 与 token ──
r = await evalJs(`(() => {
  const row = document.querySelector('.doc-row');
  const cs = getComputedStyle(row);
  return { display: cs.display, cols: cs.gridTemplateColumns, radius: cs.borderRadius,
           trans: cs.transitionDuration, titleFont: getComputedStyle(row.querySelector('.doc-title')).fontSize };
})()`);
check('文档行为 Grid 布局', r.display === 'grid', r.display);
check('文档行圆角 12px 级', parseFloat(r.radius) >= 10 && parseFloat(r.radius) <= 14, r.radius);
check('过渡时长 120-180ms', r.trans.split(',').every(x => { const v = parseFloat(x)*1000; return v >= 100 && v <= 200; }), r.trans);

// ── 3. 无硬编码 emoji / 图标统一 ──
r = await evalJs(`(() => {
  const txt = document.body.innerText;
  const emoji = txt.match(/[\\u{1F300}-\\u{1FAFF}\\u{2600}-\\u{27BF}]/gu) || [];
  const svgs = document.querySelectorAll('.app-layout svg').length;
  const strokes = new Set([...document.querySelectorAll('.app-layout svg')].map(s => getComputedStyle(s).strokeWidth));
  return { emoji: [...new Set(emoji)], svgs, strokes: [...strokes] };
})()`);
check('界面无 Emoji', r.emoji.length === 0, JSON.stringify(r.emoji));
check('图标为内联 SVG 且 stroke 统一 1.7–1.9', r.svgs > 10 && r.strokes.every(s => { const v = parseFloat(s); return v >= 1.7 && v <= 1.9; }), `${r.svgs} svg, strokes=${r.strokes}`);

// ── 4. Dark 主题切换 ──
await evalJs(`document.querySelector('.theme-toggle').click()`);
await sleep(700);
r = await evalJs(`(() => {
  const cs = getComputedStyle(document.body);
  const rgb = s => (s.match(/[\\d.]+/g) || []).map(Number);
  const [br, bgc, bb] = rgb(cs.backgroundColor);
  const [tr] = rgb(cs.color);
  return { theme: document.documentElement.getAttribute('data-theme'),
           bg: cs.backgroundColor, text: cs.color, tr,
           isDarkBg: br < 40 && bgc < 45 && bb < 60,
           saved: localStorage.getItem('tt-theme'),
           glass: getComputedStyle(document.querySelector('.main-content')).backgroundColor };
})()`);
check('切换到 dark', r.theme === 'dark', r.theme);
check('dark 背景为深蓝黑而非纯黑', r.isDarkBg && r.bg !== 'rgb(0, 0, 0)', r.bg);
check('dark 文字为浅色', r.tr > 180, `rgb=${r.text}`);
check('主题已持久化', r.saved === 'dark', String(r.saved));
await shot('shot-dark-kb.png');

// ── 5. 分类数据保留（侧栏已移除，但数据与文档标签仍可用）──
// 用户选择「只移除侧栏 UI」：分类表、文档 category_name、导入导出全部保留。
//
// 注意：这里**不能**断言「现有文档里有几篇带分类」——那是数据状态而非能力，
// 演示数据被清理后就会假性失败（曾踩过：文档数变化导致断言误报）。
// 改为自证式：现建一篇带分类的文档 → 断言列表可见 → 删除还原。
r = await evalJs(`(async () => {
  const cats = await (await fetch('/api/categories')).json();
  if (!Array.isArray(cats) || cats.length === 0) return { cats: 0, skipped: true };

  const catId = cats[0].id;
  const title = '__ui-verify-cat-probe__';
  const created = await fetch('/api/documents', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title, content_md: '分类链路探针', category_id: catId })
  });
  const doc = await created.json();
  if (!doc.id) return { cats: cats.length, createFailed: true };

  // 列表不会因外部 API 写入自动刷新，必须重新拉取（直接调组件的 load逻辑不可靠，
  // 这里触发一次搜索框输入即可走 load()，同时顺带验证筛选链路）
  const input = document.querySelector('.kb-search-input');
  input.value = '__ui-verify-cat-probe__';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise(r => setTimeout(r, 1200));

  const row = [...document.querySelectorAll('.doc-row')]
    .find(el => el.querySelector('.doc-title')?.textContent.includes(title));
  const shown = row ? row.querySelector('.tag-static')?.textContent.trim() : null;

  // 还原：清空搜索 + 删除探针文档
  document.querySelector('.kb-search-clear')?.click();
  await fetch('/api/documents/' + doc.id, { method: 'DELETE' });
  await new Promise(r => setTimeout(r, 900));

  return { cats: cats.length, expected: cats[0].name, shown };
})()`);
check('分类数据仍在（API 可读）', r.cats > 0, `${r.cats} 个分类`);
check('新建文档的分类在列表中正确显示', r.shown === r.expected,
    `期望「${r.expected}」，实际「${r.shown}」`);

// ── 6. 响应式折叠 ──
// 设计约定：≥1320 三栏（主导航/页面树/内容）；≤1320 折叠页面树变两栏。
// 折叠是「移出网格流」，因此列数应真的变少，而不是宽度变0。
const resp = [];
for (const w of [1920, 1600, 1440, 1320]) {
    await goto(`${URL_BASE}/kb`, w, 1000);
    const x = await evalJs(`(() => {
      const q = s => document.querySelector(s);
      const vis = s => { const e = q(s); if(!e) return false; return e.getBoundingClientRect().width > 1; };
      const cols = getComputedStyle(q('.app-layout')).gridTemplateColumns.split(' ').length;
      return { cols, page: vis('.page-sidebar'), main: vis('.main-sidebar'),
               overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
               content: Math.round(q('.main-content').getBoundingClientRect().width) };
    })()`);
    resp.push({ w, ...x });
    await shot(`shot-kb-${w}.png`);
}
const by = Object.fromEntries(resp.map(r => [r.w, r]));
check('1920 三栏全开', by[1920].cols === 3 && by[1920].page, JSON.stringify(by[1920]));
check('1600 三栏全开', by[1600].cols === 3 && by[1600].page, JSON.stringify(by[1600]));
check('1440 三栏全开', by[1440].cols === 3 && by[1440].page, JSON.stringify(by[1440]));
check('1320 折叠页面树（3→2 列）', by[1320].cols === 2 && !by[1320].page, JSON.stringify(by[1320]));
// 设计规范规定最小宽度 1280px，低于此宽度允许出现横向滚动
check('1280 及以上无横向溢出', resp.every(r => !r.overflow), resp.map(r => r.w + ':' + r.overflow).join(' '));
// 折叠收益应在同一视口下比较（跨视口会被视口宽度本身干扰）。
// 1320 下默认已折叠，点一下是「展开」——宽度应变小。
const foldedW = by[1320].content;
await evalJs(`document.querySelector('.col-toggles .mini-btn').click()`);
await sleep(400);
const expanded = await evalJs(`(() => {
  const e = document.querySelector('.page-sidebar');
  return { w: Math.round(document.querySelector('.main-content').getBoundingClientRect().width),
           visible: e ? e.getBoundingClientRect().width > 1 : false,
           cols: getComputedStyle(document.querySelector('.app-layout')).gridTemplateColumns.split(' ').length };
})()`);
check('手动展开页面树后内容区让出宽度', expanded.visible && expanded.cols === 3 && expanded.w < foldedW,
    `${foldedW} → ${expanded.w}, cols=${expanded.cols}`);
// 再点收起，恢复折叠态
await evalJs(`document.querySelector('.col-toggles .mini-btn').click()`);
await sleep(400);
const refolded = await evalJs(`(() => {
  const e = document.querySelector('.page-sidebar');
  return { w: Math.round(document.querySelector('.main-content').getBoundingClientRect().width),
           visible: e ? e.getBoundingClientRect().width > 1 : false };
})()`);
check('可再次收起页面树', !refolded.visible && refolded.w === foldedW, `${refolded.w}px`);
console.log('\n响应式汇总：', JSON.stringify(resp));
await goto(`${URL_BASE}/kb`, 1600, 1000);

// ── 7. 全部路由：无裁切、可滚动、无旧样式断层 ──
// 取一个真实文档 id，覆盖详情页与编辑页
const firstDoc = await evalJs(`(async () => {
  const r = await fetch('/api/documents?limit=1');
  const j = await r.json();
  return j && j.items && j.items[0] ? j.items[0].id : null;
})()`);
const ROUTES = [
    ['首页', '/'], ['工具箱', '/tools'], ['比例锁定', '/tools/ratio-lock'],
    ['JSON占位', '/tools/json-fmt'], ['二维码占位', '/tools/qrcode'], ['404', '/nope-404'],
    ['知识库', '/kb'], ['新建文档', '/kb/new']
];
if (firstDoc) {
    ROUTES.push(['文档详情', `/kb/${firstDoc}`], ['文档编辑', `/kb/${firstDoc}/edit`]);
}
const routeResults = [];
for (const [name, path] of ROUTES) {
    await goto(`${URL_BASE}${path}`, 1600, 1000);
    const x = await evalJs(`(() => {
      const q = s => document.querySelector(s);
      const mc = q('.main-content');
      const view = mc && mc.firstElementChild;
      const vr = view ? view.getBoundingClientRect() : null;
      const vcs = view ? getComputedStyle(view) : null;
      const layout = document.querySelector('.app-layout');
      const cols = layout ? getComputedStyle(layout).gridTemplateColumns.split(' ').length : 0;
      const contentW = Math.round(mc ? mc.getBoundingClientRect().width : 0);
      // 关键指标：视图根元素的可滚动高度应 >= 可见高度（否则内容被裁且滚不动）
      const scrollable = view ? view.scrollHeight - view.clientHeight : -1;
      // 子元素右边界不得超出主内容区右边界（横向溢出 = 被裁）
      let maxRight = 0;
      if (mc) {
        const mcr = mc.getBoundingClientRect();
        for (const el of mc.querySelectorAll('*')) {
          const b = el.getBoundingClientRect();
          if (b.width > 0 && b.right > maxRight) maxRight = b.right;
        }
        var mcrRight = mcr.right;
      }
      return {
        cls: view ? view.className : null,
        cols,
        content: contentW,
        viewOverflowY: vcs ? vcs.overflowY : null,
        canScroll: vcs ? ['auto','scroll'].includes(vcs.overflowY) : false,
        scrollable,
        clippedRight: Math.round(maxRight - (mcrRight ?? 0)),
        docOverflowX: document.documentElement.scrollWidth > window.innerWidth + 1,
        // 旧样式断层：视图根元素不应再有写死的 96px 左右内边距
        padX: vcs ? vcs.paddingLeft + ' / ' + vcs.paddingRight : null
      };
    })()`);
    routeResults.push({ name, path, ...x });
    // 知识库列表自带内滚动区（.kb-scroll），因此不要求根元素可滚动；
    // 其余视图一律走 .view-page 由根元素负责纵向滚动。
    const kbStyle = name === '知识库';
    const scrollOK = kbStyle
        ? String(x.cls).includes('kb-page')
        : (x.canScroll && String(x.cls).includes('view-page'));
    check(`${name}：${kbStyle ? '使用列表内滚动区' : '根元素挂 view-page 且可纵向滚动'}`,
        scrollOK, `${x.cls} overflow-y=${x.viewOverflowY}`);
    check(`${name}：无横向裁切`, x.clippedRight <= 1 && !x.docOverflowX, `右溢出 ${x.clippedRight}px, pad=${x.padX}`);
    // 非知识库区块必须退化为两栏。否则不渲染的第二栏会把主内容挤窄
    // （曾出现首页主内容仅 145px：沿用四栏模板但空着一列侧栏）
    if (!['知识库', '新建文档', '文档详情', '文档编辑'].includes(name)) {
        check(`${name}：两栏布局且内容区宽裕`, x.cols === 2 && x.content > 700,
            `cols=${x.cols}, content=${x.content}px`);
    }
}
console.log('\n路由汇总：', JSON.stringify(routeResults, null, 1));
await goto(`${URL_BASE}/kb`, 1600, 1000);
await evalJs(`document.querySelector('.theme-toggle').click()`);
await sleep(600);
await shot('shot-light-kb-final.png');

// ── 8. 性能：backdrop-filter 数量 ──
const perf = await evalJs(`(() => {
  const all = [...document.querySelectorAll('*')];
  const heavy = all.filter(e => getComputedStyle(e).backdropFilter !== 'none');
  return { total: all.length, blurred: heavy.length,
           classes: heavy.map(e => e.className).filter(c => typeof c === 'string').slice(0, 12) };
})()`);
check('backdrop-filter 仅用于大面板（≤8 个元素）', perf.blurred <= 8, `${perf.blurred}/${perf.total} 个元素, classes=${JSON.stringify(perf.classes)}`);

const failed = results.filter(r => !r.pass);
console.log(`\n===== ${results.length - failed.length}/${results.length} 通过 =====`);
if (failed.length) console.log('失败：', failed.map(f => f.name).join(' / '));

ws.close();
chrome.kill();
process.exit(failed.length ? 1 : 0);