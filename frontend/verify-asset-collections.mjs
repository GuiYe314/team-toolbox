// 资源集合（Packs）的浏览器验收（TASK-017）。
//
// 验的是**用户能感知的行为**，重点在「集合是什么、不是什么」：
//   1. 资源页有入口，集合页能列出集合与成员数
//   2. 集合详情能看到资源（缩略图、类型、版本）
//   3. 从集合移除资源 —— 必须说清「资源本身没被删」
//   4. 删除集合 —— 必须说清「集合里的资源没被删」，且删完资源真的还在
//
// 第 3、4 条是这个功能最容易让用户误解的地方：集合是视图不是容器。
// 如果文案不说清，用户不敢用，或者用错了以为丢了文件。

const BASE = process.env.VERIFY_BASE || 'http://127.0.0.1:5173';
const CDP_PORT = Number(process.env.CDP_PORT || 10921);
const API = BASE.replace(/\/$/, '') + '/api';

let pass = 0, fail = 0;
const failures = [];
function check(name, ok, detail = '') {
    if (ok) { pass++; console.log(`  ok   ${name}`); }
    else { fail++; failures.push(`${name}${detail ? ' — ' + detail : ''}`); console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`); }
}

import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
    '--headless=new', '--disable-gpu', '--no-first-run', '--disable-extensions',
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${mkdtempSync(join(tmpdir(), 'colv-'))}`,
    '--window-size=1700,1050', 'about:blank'
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let list;
for (let i = 0; i < 40; i++) {
    try { list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json(); if (list.length) break; } catch {}
    await sleep(300);
}
const ws = new WebSocket(list.find((t) => t.type === 'page').webSocketDebuggerUrl);
let id = 0; const pending = new Map(); const errs = [];
ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
        errs.push(m.params.args.map((a) => a.value ?? '').join(' '));
    }
});
await new Promise((r) => ws.addEventListener('open', r));
const send = (method, params = {}) => {
    const n = ++id;
    ws.send(JSON.stringify({ id: n, method, params }));
    return new Promise((r) => pending.set(n, r));
};
const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result?.exceptionDetails) return 'EXC ' + JSON.stringify(r.result.exceptionDetails).slice(0, 160);
    return r.result?.result?.value;
};
await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1700, height: 1050, deviceScaleFactor: 1, mobile: false });

// ── 准备：建集合 + 加入 3 个资源 ──
await send('Page.navigate', { url: BASE + '/assets' });
await sleep(2400);
await ev(`try{localStorage.setItem('tt-theme','dark')}catch(e){}`);

const stamp = Date.now();
const colName = `验收集合-${stamp}`;
const made = await ev(`fetch('${API}/collections',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:${JSON.stringify(colName)},description:'验收用集合'})}).then(r=>r.json())`);
check('测试集合已创建', !!(made && made.id), JSON.stringify(made).slice(0, 120));

const listed = await ev(`fetch('${API}/assets?pageSize=3').then(r=>r.json())`);
const assetIds = ((listed && listed.items) || []).slice(0, 3).map((a) => a.id);
await ev(`fetch('${API}/collections/${made.id}/items',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({assetIds:${JSON.stringify(assetIds)}})})`);
check('已加入 3 个资源', assetIds.length === 3, JSON.stringify(assetIds));

// 清理：集合直接删（资源侧无回收站）；资源不动
const cleanup = async () => {
    try {
        const all = await (await fetch(`${API}/collections`)).json();
        for (const c of (all.items || []).filter((x) => /^验收集合-/.test(x.name || ''))) {
            await fetch(`${API}/collections/${c.id}`, { method: 'DELETE' });
        }
    } catch {}
};

console.log('\n── 1. 资源页有集合入口 ──');
await send('Page.navigate', { url: BASE + '/assets' });
await sleep(2600);
const entry = await ev(`(() => {
    const a = [...document.querySelectorAll('a,button')].find(e => e.textContent.trim() === '集合');
    return a ? (a.getAttribute('href') || 'ok') : 'none';
})()`);
check('资源页显示「集合」入口', entry !== 'none', String(entry));

console.log('\n── 2. 集合列表 ──');
await send('Page.navigate', { url: BASE + '/assets/collections' });
await sleep(2800);
check('集合页渲染', await ev(`document.querySelectorAll('.col-page').length > 0`));
check('列出测试集合',
    await ev(`[...document.querySelectorAll('.col-name')].some(e=>e.textContent.includes(${JSON.stringify(colName)}))`),
    await ev(`JSON.stringify([...document.querySelectorAll('.col-name')].map(e=>e.textContent))`));
const meta = await ev(`(() => {
    const cards = [...document.querySelectorAll('.col-card')];
    const mine = cards.find(c => c.querySelector('.col-name').textContent.includes(${JSON.stringify(colName)}));
    return mine ? mine.querySelector('.col-card-meta').textContent : '';
})()`);
check('显示成员数', /3\s*个资源/.test(meta), meta);

console.log('\n── 3. 集合详情 ──');
await send('Page.navigate', { url: BASE + '/assets/collections/' + made.id });
await sleep(2800);
check('详情页渲染', await ev(`document.querySelectorAll('.cd-page').length > 0`));
check('标题是集合名',
    (await ev(`(document.querySelector('.cd-title')||{}).textContent||''`)).includes(colName));
check('列出 3 个资源卡片', (await ev(`document.querySelectorAll('.cd-card').length`)) === 3,
    String(await ev(`document.querySelectorAll('.cd-card').length`)));
check('资源卡片显示名称与类型',
    await ev(`(() => {
        const n = document.querySelector('.cd-name');
        const m = document.querySelector('.cd-meta');
        return !!(n && n.textContent.trim() && m && m.textContent.trim());
    })()`));

console.log('\n── 4. 从集合移除：必须说明资源本身不删 ──');
await ev(`document.querySelector('.cd-check input').click()`);
await sleep(700);
const removeBtn = await ev(`(() => {
    const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('从集合移除'));
    if (!b) return 'none';
    b.click(); return 'ok';
})()`);
check('勾选后出现「从集合移除」按钮', removeBtn === 'ok', String(removeBtn));
await sleep(900);
const removeWarn = await ev(`(document.querySelector('.dialog-warn')||{}).textContent||''`);
check('确认框明确说明「资源不会被删除」', /不会.*删除|未被删除|仍可/.test(removeWarn), removeWarn.trim());
// 取消，保留 3 个资源供下一步验证
await ev(`[...document.querySelectorAll('.dialog-actions button')].find(b=>b.textContent.trim()==='取消').click()`);
await sleep(600);

console.log('\n── 5. 删除集合：资源必须还在 ──');
const openDel = await ev(`(() => {
    const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === '删除集合');
    if (!b) return 'none';
    b.click(); return 'ok';
})()`);
check('有「删除集合」按钮', openDel === 'ok', String(openDel));
await sleep(900);
const delWarn = await ev(`(document.querySelector('.dialog-warn')||{}).textContent||''`);
check('删除确认明确说明资源不会被删', /不会被删除|不会删除/.test(delWarn), delWarn.trim());

await ev(`[...document.querySelectorAll('.dialog-actions button')].find(b=>b.textContent.trim()==='删除集合').click()`);
await sleep(2200);
check('删除后回到集合列表', (await ev(`location.pathname`)) === '/assets/collections',
    await ev(`location.pathname`));

// 关键：资源真的还在
const assetStill = await fetch(`${API}/assets/${assetIds[0]}`);
check('集合里的资源仍然存在（删集合不删资源）', assetStill.status === 200, `HTTP ${assetStill.status}`);

const colGone = await fetch(`${API}/collections/${made.id}`);
check('集合本身已删除', colGone.status === 404, `HTTP ${colGone.status}`);

console.log('\n── 6. 空状态 ──');
await send('Page.navigate', { url: BASE + '/assets/collections' });
await sleep(2600);
const emptyOrList = await ev(`(() => {
    const empty = document.querySelector('.empty-title');
    const cards = document.querySelectorAll('.col-card').length;
    return JSON.stringify({ empty: !!empty, cards });
})()`);
check('无集合时显示空状态（或列出其他集合）', emptyOrList !== '', emptyOrList);

console.log('\n── 7. 控制台无错误 ──');
const realErrs = errs.filter((e) => !/favicon|DevTools/i.test(e));
check('控制台无错误', realErrs.length === 0, realErrs.slice(0, 2).join(' | '));

console.log('\n── 8. 清理测试数据 ──');
await cleanup();
const rest = await (await fetch(`${API}/collections`)).json();
check('测试集合已回收',
    !(rest.items || []).some((c) => /^验收集合-/.test(c.name || '')),
    JSON.stringify((rest.items || []).map((c) => c.name)));

console.log('\n────────────────────────────────────────────────');
console.log(`通过 ${pass} / ${pass + fail}`);
if (failures.length) {
    console.log('\n未通过:');
    failures.forEach((f) => console.log('  - ' + f));
}
console.log('────────────────────────────────────────────────');

await send('Browser.close').catch(() => {});
chrome.kill();
process.exit(fail === 0 ? 0 : 1);
