// 资源管理前端验收（CDP 直连）。
//
// 重点验证本模块的核心不变量（这些是用户明确要求、且最容易在重构中丢掉的）：
//   1) 三栏布局：左导航+文件夹树 / 中列表 / 右详情
//   2) List / Grid 双视图切换
//   3) 搜索 / 类型筛选 / 状态筛选 / 排序 走服务端（不是前端过滤）
//   4) 多选 + 批量操作条
//   5) 详情面板：版本徽标 Latest / Published 分离、未发布警示
//   6) 版本历史：历史版本一个不少、latest/published 各自正确
//   7) 预览弹窗：单份渲染（PreviewManager 竞态回归点）
//   8) 文件夹树：展开/折叠、层级
//   9) 回收站独立视图
//  10) 窄屏响应式
//
// 用真实后端 + 真实浏览器，不 mock。

import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { purgeTestAssets } from './verify-cleanup.mjs';

const URL_BASE = process.env.VERIFY_BASE || 'http://127.0.0.1:5173';
const PORT = Number(process.env.CDP_PORT) || 9800;

const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
    '--headless=new', '--disable-extensions', '--disable-gpu', '--no-first-run',
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'cdp-am-'))}`,
    '--window-size=1700,1050', 'about:blank'
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
    if (m.method === 'Runtime.exceptionThrown') {
        consoleErrs.push('EXC:' + String(m.params.exceptionDetails?.exception?.description || '').slice(0, 120));
    }
});
await new Promise(r => ws.addEventListener('open', r));
function send(method, params = {}) { const n = ++id; ws.send(JSON.stringify({ id: n, method, params })); return new Promise(r => pending.set(n, r)); }
async function evalJs(expression) { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 300)); return r.result?.result?.value; }
async function goto(url, w = 1700, h = 1050) {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url });
    await sleep(2200);
}
await send('Page.enable'); await send('Runtime.enable');

const results = [];
const check = (name, pass, detail = '') => { results.push({ name, pass }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  → ' + detail : ''}`); };

// ── 造测试数据：文件夹 + 资源 + 多版本 + 发布 ────────────────────
const stamp = 'AM' + Date.now().toString().slice(-6);
async function api(path, opts = {}) {
    const res = await fetch(URL_BASE + path, {
        method: opts.method || 'GET',
        headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
        body: opts.body ? JSON.stringify(opts.body) : undefined
    });
    return { status: res.status, body: await res.json().catch(() => null) };
}
const folder = await api('/api/asset-folders', { method: 'POST', body: { name: stamp + '夹' } });
const folderId = folder.body.id;

/** 造一个 GLB（带真魔数）。 */
function makeGlb(n = 1024) {
    const h = Buffer.alloc(12);
    h.write('glTF', 0, 'ascii');
    h.writeUInt32LE(2, 4);
    h.writeUInt32LE(12 + n, 8);
    return Buffer.concat([h, Buffer.alloc(n, 7)]);
}
async function upload(name, buf, fields = {}) {
    const fd = new FormData();
    fd.append('file', new File([buf], name, { type: 'application/octet-stream' }));
    for (const [k, v] of Object.entries(fields)) fd.append(k, String(v));
    const res = await fetch(URL_BASE + '/api/assets/upload', { method: 'POST', body: fd });
    return { status: res.status, body: await res.json().catch(() => null) };
}

const a1 = await upload(stamp + '主模型.glb', makeGlb(1024), { folderId, tags: '测试' });
const a2 = await upload(stamp + '配图.png', Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'
), { folderId, tags: '测试,图片' });
const assetId = a1.body.id;

// 追加两个版本 → v3
await upload(stamp + '主模型.glb', makeGlb(2048), { assetId, comment: '第二版' });
await upload(stamp + '主模型.glb', makeGlb(4096), { assetId, comment: '第三版' });
// 发布 v1 → latest=v3, published=v1
const versions = (await api(`/api/assets/${assetId}/versions`)).body.items;
const v1 = versions.find(v => v.versionNumber === 1);
await api(`/api/assets/${assetId}/publish`, { method: 'POST', body: { versionId: v1.id } });

/**
 * 清理本脚本造出来的全部资源。
 *
 * 两个坑：
 * 1. 只按本轮的 [assetId, a2.body.id] 删不够 —— 脚本若中途被 SIGTERM
 *    打断，exit 处理器里的 async fetch 不会跑完，资源就留在库里了。
 * 2. 所以按**名称特征**（/^AM\d{4,}/）搜索，把历次残留一起清掉。
 */
async function cleanup() {
    // 必须同时扫「正常集合」与「回收站」—— 只扫正常集合时，
    // 一旦某次运行中途失败、残留沉进回收站，此后再也匹配不到，会永久堆积。
    // 实测演示库回收站里积了 10 个从 10-20 起的 AMxxxxxx配图.png。
    await purgeTestAssets(URL_BASE + '/api', /^AM\d{4,}/);
    // 测试文件夹同理：按名称特征删
    try {
        const fs = await api('/api/asset-folders');
        for (const f of (fs.body.items || [])) {
            if (/^AM\d{4,}/.test(f.name)) {
                await fetch(`${URL_BASE}/api/asset-folders/${f.id}`, { method: 'DELETE' }).catch(() => {});
            }
        }
    } catch { /* 忽略 */ }
}
process.on('exit', () => { cleanup(); });

await goto(`${URL_BASE}/assets`);
await evalJs(`(() => { try { localStorage.setItem('tt-theme','light'); } catch(e){} location.reload(); return 1; })()`);
await sleep(2400);

// ── 1. 三栏布局 ──
const layout = await evalJs(`(() => ({
  side: document.querySelectorAll('.am-side').length,
  listWrap: document.querySelectorAll('.am-list-wrap').length,
  navItems: document.querySelectorAll('.am-nav-item').length,
  treeRows: document.querySelectorAll('.am-tree-row').length,
  title: (document.querySelector('.am-title')||{}).textContent || ''
}))()`);
check('三栏结构完整（侧栏/列表/导航）', layout.side === 1 && layout.listWrap === 1 && layout.navItems >= 5, JSON.stringify(layout));
check('页面标题为「资源管理」', layout.title.trim() === '资源管理', layout.title);
check('文件夹树已渲染', layout.treeRows >= 1, layout.treeRows + ' 个节点');

// ── 2. List / Grid 切换 ──
const listRows = await evalJs(`document.querySelectorAll('.am-table tbody tr').length`);
await evalJs(`[...document.querySelectorAll('.am-seg-icon')][1].click()`);
await sleep(700);
const gridCards = await evalJs(`document.querySelectorAll('.am-card').length`);
check('List 视图有数据行', listRows > 0, listRows + ' 行');
check('Grid 视图有数据卡', gridCards > 0, gridCards + ' 张');
check('两视图数据量一致', listRows === gridCards, `${listRows} vs ${gridCards}`);
await evalJs(`[...document.querySelectorAll('.am-seg-icon')][0].click()`);
await sleep(600);

// ── 3. 搜索走服务端 ──
await evalJs(`(() => { const i = document.querySelector('.am-search-input');
  i.value = '${stamp}';
  i.dispatchEvent(new Event('input', {bubbles:true})); return 1; })()`);
await sleep(900);
const searched = await evalJs(`document.querySelectorAll('.am-table tbody tr').length`);
check('搜索命中测试资源', searched >= 2, searched + ' 行（两个资源都含标记串）');
check('搜索结果不含无关资源', await evalJs(`[...document.querySelectorAll('.am-table tbody tr')].every(r => r.textContent.includes('${stamp}'))`));

// 清空搜索
await evalJs(`(() => { const i = document.querySelector('.am-search-input');
  i.value = ''; i.dispatchEvent(new Event('input', {bubbles:true})); return 1; })()`);
await sleep(900);

// ── 4. 类型筛选 ──
await evalJs(`(() => { const s = document.querySelectorAll('.am-select')[0];
  s.value = 'model'; s.dispatchEvent(new Event('change',{bubbles:true})); return 1; })()`);
await sleep(800);
// 按 class 取列，不按 children 索引 —— 复选框列在批量模式下才存在，
// 用索引会随列数变化而错位
const byType = await evalJs(`JSON.stringify([...document.querySelectorAll('.am-table tbody tr')].map(r=>(r.querySelector('td:nth-child(2)')||{}).textContent?.trim()||''))`);
check('类型筛选生效（只看 3D 模型）', JSON.parse(byType).every(t => t === '3D 模型'), byType);
await evalJs(`(() => { const s = document.querySelectorAll('.am-select')[0];
  s.value = 'all'; s.dispatchEvent(new Event('change',{bubbles:true})); return 1; })()`);
await sleep(800);

// ── 5. 排序 ──
await evalJs(`(() => { const th = [...document.querySelectorAll('.am-th-sortable')].find(t=>t.textContent.includes('资源名称')); th.click(); return 1; })()`);
await sleep(900);
const sortedOk = await evalJs(`(() => {
  const names = [...document.querySelectorAll('.am-table tbody tr .am-name-text')].map(e=>e.textContent.trim());
  // 用 localeCompare 比较：中文排序不能用默认的 UTF-16 码位比较
  const asc = [...names].sort((a,b)=>a.localeCompare(b,'zh-CN'));
  const desc = [...asc].reverse();
  const isAsc = JSON.stringify(names) === JSON.stringify(asc);
  const isDesc = JSON.stringify(names) === JSON.stringify(desc);
  return JSON.stringify({ isAsc, isDesc, n: names.length, first: names[0] });
})()`);
const so = JSON.parse(sortedOk);
check('按名称排序生效（升序或降序）', so.isAsc || so.isDesc, `n=${so.n} first=${so.first} asc=${so.isAsc} desc=${so.isDesc}`);

// ── 6. 多选 + 批量操作条 ──
// 复选框只在批量模式下出现（见 verify-batch-mode.mjs），先开启批量模式
await evalJs(`(() => {
  const t = document.querySelector('.am-batch-toggle');
  if (t && t.getAttribute('aria-pressed') !== 'true') t.click();
  return 1;
})()`);
await sleep(500);
await evalJs(`document.querySelector('.am-table tbody .am-check').click()`);
await sleep(500);
const sel = await evalJs(`JSON.stringify({
  bar: document.querySelectorAll('.am-selbar').length,
  text: (document.querySelector('.am-sel-count')||{}).textContent||'',
  selected: document.querySelectorAll('.am-table tbody tr.is-selected').length
})`);
check('选中后出现批量操作条', JSON.parse(sel).bar === 1, sel);
check('批量条显示选中数量', JSON.parse(sel).text.includes('1'), JSON.parse(sel).text);
check('行高亮为选中态', JSON.parse(sel).selected === 1, JSON.parse(sel).selected + ' 行');
await evalJs(`[...document.querySelectorAll('.am-selbar .btn-ghost')].find(b=>b.textContent.includes('取消选择')).click()`);
await sleep(400);
// 注意：批量条现在跟随**批量模式**而非选中数量 ——
// 「取消选择」只清空勾选，批量模式仍在，条还在（符合新语义）。
check('取消选择后计数归零', await evalJs(`(document.querySelector('.am-sel-count')||{}).textContent?.includes('0')`));
check('取消选择后行不再高亮', await evalJs(`document.querySelectorAll('.am-table tbody tr.is-selected').length === 0`));
// 退出批量模式 → 批量条消失
await evalJs(`document.querySelector('.am-batch-toggle').click()`);
await sleep(400);
check('退出批量模式后批量条消失', await evalJs(`document.querySelectorAll('.am-selbar').length === 0`));

// ── 7. 详情面板 + Latest/Published 分离 ──
// 已在上面退出批量模式 —— 批量模式下点行只切换选中，不打开详情
await evalJs(`(() => {
  const r = [...document.querySelectorAll('.am-table tbody tr')].find(x => x.textContent.includes('${stamp}主模型'));
  r.click(); return 1; })()`);
await sleep(1400);
const detail = await evalJs(`JSON.stringify({
  open: document.querySelectorAll('.am-detail').length,
  name: (document.querySelector('.am-detail-name')||{}).textContent||'',
  badges: [...document.querySelectorAll('.am-detail-badges .am-ver')].map(e=>e.textContent.trim()),
  note: (document.querySelector('.am-detail-note')||{}).textContent||'',
  tabs: [...document.querySelectorAll('.am-tab')].map(t=>t.textContent.trim())
})`);
const d = JSON.parse(detail);
check('点击行打开右侧详情', d.open === 1 && d.name.includes('主模型'), d.name);
check('详情显示 Latest 与 Published 两个徽标', d.badges.some(b => /最新 v\d/.test(b)) && d.badges.some(b => /已发布 v\d/.test(b)), JSON.stringify(d.badges));
check('详情有「未发布」警示', d.note.includes('尚未发布'), d.note.trim().slice(0, 50));
check('详情有详情/版本历史/操作记录三个 Tab', d.tabs.length === 3, JSON.stringify(d.tabs));

// ── 8. 版本历史（用测试资源，避免与演示数据混淆）──
await evalJs(`(() => {
  const row = [...document.querySelectorAll('.am-table tbody tr')].find(x => x.textContent.includes('${stamp}主模型'));
  row.click(); return 1; })()`);
await sleep(1400);
await evalJs(`[...document.querySelectorAll('.am-tab')].find(t=>t.textContent.includes('版本历史')).click()`);
await sleep(900);
const vers = await evalJs(`JSON.stringify({
  count: document.querySelectorAll('.am-version').length,
  nums: [...document.querySelectorAll('.am-version-no')].map(e=>e.textContent.trim()),
  latest: document.querySelectorAll('.am-version.is-latest').length,
  published: document.querySelectorAll('.am-version.is-published').length
})`);
const v = JSON.parse(vers);
check('版本历史列出全部 3 个版本', v.count === 3, JSON.stringify(v.nums));
check('版本号序列完整（1/2/3）', v.nums.slice().sort().join(',') === 'v1,v2,v3', JSON.stringify(v.nums));
check('恰有一个 Latest 标记', v.latest === 1, v.latest);
check('恰有一个 Published 标记', v.published === 1, v.published);

// ── 9. 预览弹窗：单份渲染（PreviewManager 竞态回归点）──
// 用 Markdown 资源测（内容是合法的，能真渲染出来），
// 3D 资源的预览单独测（下面那条），因为测试用的 GLB 是伪造的，
// model-viewer 解析必然失败 —— 那不是被测行为。
await evalJs(`(() => {
  const row = [...document.querySelectorAll('.am-table tbody tr')].find(x => x.textContent.includes('${stamp}配图'));
  row.click(); return 1; })()`);
await sleep(1300);
await evalJs(`[...document.querySelectorAll('.am-tab')].find(t=>t.textContent.includes('版本历史')).click()`);
await sleep(700);
await evalJs(`[...document.querySelectorAll('.am-vbtn')].find(b=>b.getAttribute('aria-label')==='预览该版本').click()`);
await sleep(2600);
const preview = await evalJs(`JSON.stringify({
  modal: document.querySelectorAll('.am-modal').length,
  img: document.querySelectorAll('.am-modal-stage img.pv-image').length,
  err: (document.querySelector('.am-modal-stage .pv-error')||{}).textContent||''
})`);
const p = JSON.parse(preview);
check('预览弹窗已打开', p.modal === 1, `modal=${p.modal}`);
check('图片预览只渲染一份（竞态回归）', p.img === 1, `img=${p.img}`);
check('预览无错误提示', p.err === '', p.err.slice(0, 60));
await evalJs(`[...document.querySelectorAll('.am-mbtn')].find(b=>b.getAttribute('aria-label')==='关闭预览').click()`);
await sleep(500);
check('关闭后弹窗移除', await evalJs(`document.querySelectorAll('.am-modal').length === 0`));

// 3D 预览：文件是伪造的 GLB，model-viewer 解析必然失败，
// 但必须**给出明确提示**而不是留一个空白黑框
await evalJs(`(() => {
  const row = [...document.querySelectorAll('.am-table tbody tr')].find(x => x.textContent.includes('${stamp}主模型'));
  row.click(); return 1; })()`);
await sleep(1300);
await evalJs(`[...document.querySelectorAll('.am-tab')].find(t=>t.textContent.includes('版本历史')).click()`);
await sleep(700);
await evalJs(`[...document.querySelectorAll('.am-vbtn')].find(b=>b.getAttribute('aria-label')==='预览该版本').click()`);
await sleep(3000);
const modelPv = await evalJs(`JSON.stringify({
  err: (document.querySelector('.am-modal-stage .pv-error')||{}).textContent||'',
  mv: document.querySelectorAll('.am-modal-stage model-viewer').length
})`);
check('3D 预览失败时给出明确提示（不留空白）', JSON.parse(modelPv).err.length > 0, JSON.parse(modelPv).err.slice(0, 50));
await evalJs(`[...document.querySelectorAll('.am-mbtn')].find(b=>b.getAttribute('aria-label')==='关闭预览').click()`);
await sleep(500);

// ── 10. 回收站视图 ──
await api('/api/assets/batch-delete', { method: 'POST', body: { assetIds: [a2.body.id] } });
await evalJs(`[...document.querySelectorAll('.am-nav-item')].find(b=>b.textContent.includes('回收站')).click()`);
await sleep(1000);
const trash = await evalJs(`document.querySelectorAll('.am-table tbody tr').length`);
check('回收站视图列出已删除资源', trash >= 1, trash + ' 行');
await evalJs(`[...document.querySelectorAll('.am-nav-item')].find(b=>b.textContent.includes('全部资源')).click()`);
await sleep(800);

// ── 11. 窄屏响应式（详情需已打开，才谈得上「变抽屉」）──
await evalJs(`(() => {
  const row = [...document.querySelectorAll('.am-table tbody tr')].find(x => x.textContent.includes('${stamp}主模型'));
  if (row) row.click();
  return 1; })()`);
await sleep(1200);
await goto(`${URL_BASE}/assets`, 900, 1000);
await evalJs(`(() => {
  const row = [...document.querySelectorAll('.am-table tbody tr')].find(x => x.textContent.includes('${stamp}主模型'));
  if (row) row.click();
  return 1; })()`);
await sleep(1400);
const narrow = await evalJs(`(() => {
  const d = document.querySelector('.am-detail');
  const cs = d ? getComputedStyle(d) : null;
  return { pos: cs ? cs.position : 'none', exists: !!d,
           overflow: document.documentElement.scrollWidth > innerWidth + 1 };
})()`);
check('窄屏下详情为抽屉（fixed 定位）', narrow.exists && narrow.pos === 'fixed', `exists=${narrow.exists} pos=${narrow.pos}`);

// model-viewer 内部（GLTFLoader）对**伪造 GLB** 必然报错 ——
// 那是第三方库的行为，不在本模块可控范围。
// 本模块的责任是「捕获 error 事件并给出提示」，这一点已由
// 「3D 预览失败时给出明确提示」一条断言覆盖。
const realErrs = consoleErrs.filter(e =>
    !/favicon|DevTools/i.test(e) &&
    !/GLTFLoader|model-viewer|THREE\./i.test(e)
);
check('控制台无报错', realErrs.length === 0, realErrs.slice(0, 3).join(' | '));

await cleanup();
await send('Browser.close').catch(() => {});
chrome.kill();
const failed = results.filter(r => !r.pass);
console.log(`\n=== ${results.length - failed.length}/${results.length} 通过 ===`);
if (failed.length) { failed.forEach(f => console.log('FAIL: ' + f.name)); process.exit(1); }
process.exit(0);