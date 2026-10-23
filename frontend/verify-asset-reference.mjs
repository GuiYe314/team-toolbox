// 文档引用资源库的浏览器验收。
//
// 验的是**用户可见的完整链路**：
//   1. 编辑器里有「插入资源」入口，选择器能打开、列出资源
//   2. 选中资源后插入的是**标准 Markdown 图片语法**（可手改、可粘贴）
//   3. 保存后从 API 读回，正文里确实有引用
//   4. 阅读页渲染时有效引用显示为图片
//   5. 失效引用（资源被删）降级为提示块，而不是浏览器原生破图
//
// 判据用实际渲染结果与落库内容，不看内部状态。

const BASE = process.env.VERIFY_BASE || 'http://127.0.0.1:5210';
const CDP_PORT = Number(process.env.CDP_PORT || 10910);
const API = BASE.replace(/:\d+$/, ':3000');

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
    `--user-data-dir=${mkdtempSync(join(tmpdir(), 'aref-'))}`,
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
    if (r.result?.exceptionDetails) return 'EXC ' + JSON.stringify(r.result.exceptionDetails).slice(0, 180);
    return r.result?.result?.value;
};

// ── 准备：造一篇含有效引用与失效引用的文档 ──
console.log('\n── 0. 准备测试文档 ──');

const created = await fetch(API + '/api/documents', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
        title: '验收·资源引用',
        content_md: [
            '# 资源引用验收',
            '',
            '有效引用：',
            '',
            '![有效资源](/api/assets/files/88/preview/auto)',
            '',
            '失效引用：',
            '',
            '![已删除的资源](/api/assets/files/999999/preview/auto)',
            ''
        ].join('\n')
    })
});
const doc = await created.json();
check('测试文档已创建', !!(doc && doc.id), JSON.stringify(doc).slice(0, 80));
const docId = doc.id;

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1700, height: 1050, deviceScaleFactor: 1, mobile: false });

console.log('\n── 1. 阅读页渲染有效引用 ──');
await send('Page.navigate', { url: BASE + '/kb/' + docId });
await sleep(3500);

const imgs = JSON.parse(await ev(`JSON.stringify([...document.querySelectorAll('.markdown-body img')].map(i => ({
    src: i.getAttribute('src'),
    ok: i.complete && i.naturalWidth > 0
})))`) || '[]');
console.log('  正文图片:', JSON.stringify(imgs));
check('有效引用渲染为 img 元素', imgs.some((i) => i.src && i.src.includes('/assets/files/88/preview/auto')));
check('有效引用图片实际加载成功', imgs.some((i) => i.ok === true));
check('引用用了 auto 指针', imgs.every((i) => !i.src || i.src.endsWith('/auto')), JSON.stringify(imgs.map((i) => i.src)));

console.log('\n── 2. 失效引用降级为提示块 ──');
const broken = await ev(`document.querySelectorAll('.md-broken').length`);
check('失效引用被替换为占位块', broken === 1, `占位数 ${broken}`);
const brokenText = await ev(`(document.querySelector('.md-broken')||{}).textContent||''`);
console.log('  占位文案:', brokenText);
check('占位块显示了原 alt 文本', brokenText.includes('已删除的资源'), brokenText);
check('占位块说明了原因', /已删除|不可用|丢失/.test(brokenText), brokenText);
check('没有残留浏览器原生破图', await ev(`[...document.querySelectorAll('.markdown-body img')].every(i => i.complete && i.naturalWidth > 0)`));

console.log('\n── 3. 编辑器有「插入资源」入口 ──');
await send('Page.navigate', { url: BASE + '/kb/' + docId + '/edit' });
await sleep(3500);
const hasBtn = await ev(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='插入资源'); return !!b;})()`);
check('编辑器有「插入资源」按钮', hasBtn === true);

await ev(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='插入资源'); if(b) b.click(); return 1;})()`);
await sleep(2200);
check('资源选择器可打开', await ev(`!!document.querySelector('.asset-picker')`));
const itemCount = await ev(`document.querySelectorAll('.asset-picker-item').length`);
check('选择器列出了资源', itemCount > 0, `${itemCount} 个`);
check('选择器有搜索框', await ev(`!!document.querySelector('.asset-picker-input')`));

console.log('\n── 4. 搜索资源 ──');
await ev(`(()=>{const i=document.querySelector('.asset-picker-input'); if(!i) return 0; i.value='渐变'; i.dispatchEvent(new Event('input',{bubbles:true})); return 1;})()`);
await sleep(1200);
const filtered = await ev(`document.querySelectorAll('.asset-picker-item').length`);
check('搜索能过滤结果', filtered > 0 && filtered <= itemCount, `${filtered} / ${itemCount}`);

console.log('\n── 5. 选中资源插入引用 ──');
const picked = await ev(`(()=>{const it=document.querySelector('.asset-picker-item'); if(!it) return null; const n=it.querySelector('.asset-picker-name').textContent.trim(); it.click(); return n;})()`);
check('选中了一个资源', !!picked, String(picked));
await sleep(2200);
check('选择器在选中后关闭', await ev(`!document.querySelector('.asset-picker')`));

console.log('\n── 6. 保存后正文确实含引用 ──');
await ev(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>/保存/.test(x.textContent)); if(b) b.click(); return 1;})()`);
await sleep(3000);

const saved = await (await fetch(API + '/api/documents/' + docId)).json();
const md = saved.content_md || '';
const refs = md.match(/!\[[^\]]*\]\(\/api\/assets\/files\/\d+\/(?:preview|original)\/auto\)/g) || [];
console.log('  落库的引用:', JSON.stringify(refs));
check('正文含标准 Markdown 引用语法', refs.length >= 2, `${refs.length} 处`);
check('引用指向 auto 指针', refs.every((r) => r.endsWith('/auto)')));

// ── 清理 ──
await fetch(API + '/api/documents/' + docId, { method: 'DELETE' }).catch(() => {});

console.log('\n── 7. 控制台无错误 ──');
const realErrs = errs.filter((e) => !/favicon|DevTools/i.test(e));
check('控制台无错误', realErrs.length === 0, realErrs.slice(0, 2).join(' | '));

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
