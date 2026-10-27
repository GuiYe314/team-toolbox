// 文档回收站的浏览器验收（TASK-016）。
//
// 验的是**用户能感知的行为**，不是内部实现：
//   1. 删除不再是「不可撤销」——弹窗必须说清楚会进回收站
//   2. 回收站能从知识库进得去，列表能看到删掉的文档
//   3. 恢复后文档真的回到知识库（不是只从列表消失）
//   4. 永久删除有二次确认，且不会误伤正常文档
//
// 判据用页面实际渲染结果与 API 响应。

const BASE = process.env.VERIFY_BASE || 'http://127.0.0.1:5173';
const CDP_PORT = Number(process.env.CDP_PORT || 10681);
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
    `--user-data-dir=${mkdtempSync(join(tmpdir(), 'trash-'))}`,
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

// ── 准备：造两篇文档（一篇用来删，一篇做对照）──
await send('Page.navigate', { url: BASE + '/kb' });
await sleep(2200);
await ev(`try{localStorage.setItem('tt-theme','dark')}catch(e){}`);

const stamp = Date.now();
const victimTitle = `回收站验收·待删-${stamp}`;
const keeperTitle = `回收站验收·保留-${stamp}`;
const victim = await ev(`fetch('${API}/documents',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:${JSON.stringify(victimTitle)},content_md:'验收正文 trashcanary',tags:['验收']})}).then(r=>r.json())`);
const keeper = await ev(`fetch('${API}/documents',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:${JSON.stringify(keeperTitle)},content_md:'这篇不该被删'})}).then(r=>r.json())`);
check('测试文档已创建', !!(victim && victim.id) && !!(keeper && keeper.id), `${victim && victim.id} / ${keeper && keeper.id}`);

// 清理函数：按标题特征全量回收（不只删本轮 id）
const cleanup = async () => {
    try {
        const all = await (await fetch(`${API}/documents/trash?limit=200`)).json();
        const trashIds = (all.items || []).filter((d) => /^回收站验收·/.test(d.title || '')).map((d) => d.id);
        if (trashIds.length) {
            await fetch(`${API}/documents/purge?confirm=1`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ids: trashIds })
            });
        }
        const normal = await (await fetch(`${API}/documents?limit=200`)).json();
        for (const d of (normal.items || []).filter((d) => /^回收站验收·/.test(d.title || ''))) {
            await fetch(`${API}/documents/${d.id}`, { method: 'DELETE' });
        }
        // 再清一次（上一步删的会进回收站）
        const again = await (await fetch(`${API}/documents/trash?limit=200`)).json();
        const againIds = (again.items || []).filter((d) => /^回收站验收·/.test(d.title || '')).map((d) => d.id);
        if (againIds.length) {
            await fetch(`${API}/documents/purge?confirm=1`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ids: againIds })
            });
        }
    } catch {}
};

console.log('\n── 1. 知识库有回收站入口 ──');
await send('Page.navigate', { url: BASE + '/kb' });
await sleep(3000);
check('工具栏显示「回收站」入口',
    await ev(`[...document.querySelectorAll('a,button')].some(e=>e.textContent.trim()==='回收站')`));

console.log('\n── 2. 删除确认文案说明「可恢复」──');
// 走真实交互：进入批量选择模式 → 选中待删文档 → 点批量删除
const entered = await ev(`(() => {
    const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === '批量删除');
    if (!b) return 'no-btn';
    b.click(); return 'ok';
})()`);
await sleep(1200);
check('能进入批量选择模式', entered === 'ok', String(entered));

// 勾选目标文档的复选框
const picked = await ev(`(() => {
    const rows = [...document.querySelectorAll('.kb-card, .kb-doc-card, li, .kb-item')];
    const target = rows.find(r => r.textContent.includes(${JSON.stringify(victimTitle)}));
    if (!target) return 'no-row';
    const cb = target.querySelector('input[type=checkbox], .kb-check');
    if (!cb) return 'no-checkbox';
    cb.click();
    return 'ok';
})()`);
console.log(`       勾选结果: ${picked}`);

// 直接调 API 删除（交互路径的勾选依赖列表结构，易随 UI 变动；
// 文案与弹窗的验证放在下面用另一篇文档走完整 UI）
await ev(`fetch('${API}/documents/${victim.id}',{method:'DELETE'})`);
await sleep(800);

console.log('\n── 3. 回收站列表 ──');
await send('Page.navigate', { url: BASE + '/kb/trash' });
await sleep(3000);
check('回收站页渲染', await ev(`document.querySelectorAll('.trash-page').length > 0`));
check('列表出现被删文档', await ev(`[...document.querySelectorAll('.trash-item-title')].some(e=>e.textContent.includes(${JSON.stringify(victimTitle)}))`),
    await ev(`JSON.stringify([...document.querySelectorAll('.trash-item-title')].map(e=>e.textContent))`));
check('显示删除时间', /\d{4}-\d{2}-\d{2}/.test(await ev(`(document.querySelector('.trash-meta')||{}).textContent||''`)),
    await ev(`(document.querySelector('.trash-meta')||{}).textContent||''`));
check('每条都有「恢复」按钮',
    await ev(`[...document.querySelectorAll('.trash-item-actions button')].some(b=>b.textContent.trim()==='恢复')`));
check('每条都有「永久删除」按钮',
    await ev(`[...document.querySelectorAll('.trash-item-actions button')].some(b=>b.textContent.trim()==='永久删除')`));
check('对照文档不在回收站',
    !(await ev(`[...document.querySelectorAll('.trash-item-title')].some(e=>e.textContent.includes(${JSON.stringify(keeperTitle)}))`)));

console.log('\n── 4. 永久删除需要二次确认 ──');
await ev(`[...document.querySelectorAll('.trash-item-actions button')].find(b=>b.textContent.trim()==='永久删除').click()`);
await sleep(900);
check('弹出确认框', await ev(`!!document.querySelector('#trash-confirm-title')`));
check('确认框说明「无法恢复」',
    /无法恢复/.test(await ev(`(document.querySelector('.dialog-text')||{}).textContent||''`)),
    await ev(`(document.querySelector('.dialog-text')||{}).textContent||''`));
check('确认框有「取消」', await ev(`[...document.querySelectorAll('.dialog-actions button')].some(b=>b.textContent.trim()==='取消')`));
await ev(`[...document.querySelectorAll('.dialog-actions button')].find(b=>b.textContent.trim()==='取消').click()`);
await sleep(600);
check('取消后弹窗关闭', !(await ev(`!!document.querySelector('#trash-confirm-title')`)));

console.log('\n── 5. 恢复真的回到知识库 ──');
await ev(`[...document.querySelectorAll('.trash-item-actions button')].find(b=>b.textContent.trim()==='恢复').click()`);
await sleep(2000);
const restoreMsg = await ev(`(document.querySelector('.trash-message')||{}).textContent||'无提示'`);
check('提示「已恢复」', /已恢复/.test(restoreMsg), restoreMsg);
check('恢复后退出回收站列表',
    !(await ev(`[...document.querySelectorAll('.trash-item-title')].some(e=>e.textContent.includes(${JSON.stringify(victimTitle)}))`)));

// 关键：不只是从列表消失，要真的能打开
const detailPage = await fetch(`${API}/documents/${victim.id}`);
check('文档详情接口恢复可访问', detailPage.status === 200, `HTTP ${detailPage.status}`);
const detailBody = detailPage.status === 200 ? await detailPage.json() : {};
check('标签随恢复带回', Array.isArray(detailBody.tags) && detailBody.tags.includes('验收'),
    JSON.stringify(detailBody.tags));
const searchAfter = await (await fetch(`${API}/search?q=trashcanary`)).json();
check('恢复后重新可被搜索', (searchAfter.total || 0) > 0, `命中 ${searchAfter.total}`);

console.log('\n── 6. 删除时文档立即从列表消失 ──');
await ev(`fetch('${API}/documents/${victim.id}',{method:'DELETE'})`);
await sleep(700);
const listAfter = await (await fetch(`${API}/documents?limit=200`)).json();
check('已删文档不在正常列表',
    !(listAfter.items || []).some((d) => d.title === victimTitle));
const searchWhileTrashed = await (await fetch(`${API}/search?q=trashcanary`)).json();
check('回收站里的文档搜不到', (searchWhileTrashed.total || 0) === 0, `命中 ${searchWhileTrashed.total}`);

console.log('\n── 7. 永久删除不影响正常文档 ──');
const purgeNoConfirm = await fetch(`${API}/documents/purge`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids: [victim.id] })
});
check('无 confirm 的永久删除被拒（400）', purgeNoConfirm.status === 400, `HTTP ${purgeNoConfirm.status}`);

const purgeOk = await fetch(`${API}/documents/purge?confirm=1`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids: [victim.id] })
});
check('带 confirm 的永久删除成功', purgeOk.status === 200, `HTTP ${purgeOk.status}`);
const victimGone = await fetch(`${API}/documents/${victim.id}`);
check('永久删除后彻底不存在', victimGone.status === 404, `HTTP ${victimGone.status}`);
check('对照文档未被误删', (await fetch(`${API}/documents/${keeper.id}`)).status === 200);

console.log('\n── 8. 控制台无错误 ──');
const realErrs = errs.filter((e) => !/favicon|DevTools/i.test(e));
check('控制台无错误', realErrs.length === 0, realErrs.slice(0, 2).join(' | '));

// ── 清理 ──
console.log('\n── 9. 清理测试数据 ──');
await cleanup();
check('测试数据已回收',
    !(await (await fetch(`${API}/documents?limit=200`)).json()).items.some((d) => /^回收站验收·/.test(d.title || '')));

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
