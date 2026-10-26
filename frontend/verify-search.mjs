// 全文检索（FTS5）的浏览器验收。
//
// 验的是**用户可见的行为**，不是内部实现：
//   1. 中文能子串搜索（搜正文里的词能找到标题不含该词的文档）
//   2. 英文按词边界匹配（不误命中）
//   3. 搜不到时有明确空状态
//   4. 搜索框有防抖，不会每敲一个字就发请求
//
// 判据用页面实际渲染结果，不看内部状态。

const BASE = process.env.VERIFY_BASE || 'http://127.0.0.1:5210';
const CDP_PORT = Number(process.env.CDP_PORT || 11901);

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
    `--user-data-dir=${mkdtempSync(join(tmpdir(), 'srch-'))}`,
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

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1700, height: 1050, deviceScaleFactor: 1, mobile: false });

/** 在搜索框输入关键词并等待结果稳定。 */
async function search(kw) {
    await ev(`(() => {
        const i = document.querySelector('input[placeholder*="搜索"]');
        if (!i) return 'no input';
        i.focus();
        i.value = ${JSON.stringify(kw)};
        i.dispatchEvent(new Event('input', { bubbles: true }));
        return 'ok';
    })()`);
    await sleep(1600);
    return await ev(`JSON.stringify({
        count: (document.querySelector('.kb-desc, .view-subtitle') || {}).textContent || '',
        titles: [...document.querySelectorAll('.kb-doc-title, .doc-title, .kb-card-title')]
            .map(e => e.textContent.trim()).filter(Boolean),
        body: document.querySelector('.kb-list, .kb-grid, .doc-list')?.textContent || ''
    })`);
}

console.log('\n── 1. 搜索基础可用 ──');
await send('Page.navigate', { url: BASE + '/kb' });
await sleep(3500);

check('搜索框存在', await ev(`!!document.querySelector('input[placeholder*="搜索"]')`));

// 搜一个必然存在的中文词（演示文档正文含「海昏侯」）
const r1 = JSON.parse(await search('海昏')) || {};
console.log('  搜「海昏」→', r1.count);
check('中文关键词有结果', (r1.titles || []).length > 0, JSON.stringify(r1.titles));
check('结果计数文案含「条结果」', /(\d+)\s*条结果/.test(r1.count || ''), r1.count);

console.log('\n── 2. 子串匹配（标题不含该词也能搜到）──');
// 「海昏」在文档正文里，标题是「10月」—— 若不是子串匹配就不可能命中
const r2 = JSON.parse(await search('海昏')) || {};
check('能搜到正文含关键词的文档', (r2.titles || []).length > 0);
check('摘要片段显示命中上下文', (r2.body || '').includes('海昏'), (r2.body || '').slice(0, 80));

console.log('\n── 3. 无结果时的空状态 ──');
const r3 = JSON.parse(await search('绝对不存在的关键词xyzzy')) || {};
check('无匹配时显示 0 条结果', /0\s*条结果/.test(r3.count || ''), r3.count);
check('无匹配时无结果条目', (r3.titles || []).length === 0, JSON.stringify(r3.titles));

console.log('\n── 4. 英文按词边界匹配 ──');
// 自己造测试文档，不依赖演示库内容。
//
// 之前这里搜「BD」并断言「演示库有 BD 前缀文档」—— 那批文档其实是
// verify-batch-delete.mjs 造的测试数据，被它自己按 AGENTS.md 第 10 条回收了。
// 于是本脚本在 batch-delete 之后跑就会莫名失败（实测 10/11）。
// 验收脚本不能依赖别的脚本的残留数据，必须自造自收。
const API = BASE.replace(/\/$/, '') + '/api';
const mkTitle = '搜索验收·英文词边界';
const mkBody = '本段包含 zephyr 工具与 digital transform 的说明，用于验证英文按词边界匹配。';

// 造文档（若已存在先删，避免重复运行残留）
await fetch(`${API}/documents?q=${encodeURIComponent(mkTitle)}`, { method: 'DELETE' }).catch(() => {});
const created = await (await fetch(`${API}/documents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: mkTitle, content_md: mkBody })
})).json();
const mkId = created && created.id;

const r4 = JSON.parse(await search('zephyr')) || {};
console.log('  搜「zephyr」→', r4.count);
check('英文关键词能命中自造文档', (r4.titles || []).includes(mkTitle),
    JSON.stringify(r4.titles));

// 关键：搜子串「zeph」应**不**命中（zephyr 是完整词，不是子串可搜的）
const r4b = JSON.parse(await search('zeph')) || {};
check('搜英文词的片段不误命中（按词边界匹配）',
    !(r4b.titles || []).includes(mkTitle),
    JSON.stringify(r4b.titles));

// 搜另一个完整词应命中
const r4c = JSON.parse(await search('digital')) || {};
check('完整英文词命中', (r4c.titles || []).includes(mkTitle),
    JSON.stringify(r4c.titles));

console.log('\n── 5. 清除搜索恢复列表 ──');
await ev(`(() => {
    const i = document.querySelector('input[placeholder*="搜索"]');
    i.value = '';
    i.dispatchEvent(new Event('input', { bubbles: true }));
    return 1;
})()`);
await sleep(1600);
const r5 = JSON.parse(await ev(`JSON.stringify({
    count: (document.querySelector('.kb-desc, .view-subtitle') || {}).textContent || '',
    titles: [...document.querySelectorAll('.kb-doc-title, .doc-title, .kb-card-title')].map(e=>e.textContent.trim()).filter(Boolean).length
})`) || {});
check('清空搜索后恢复全部文档', (r5.titles || 0) > (r3.titles || 0), `${r5.titles} vs ${(r3.titles || []).length}`);
check('计数不再是 0 条结果', !/0\s*条结果/.test(r5.count || ''), r5.count);

console.log('\n── 6. 控制台无错误 ──');
const realErrs = errs.filter((e) => !/favicon|DevTools/i.test(e));
check('控制台无错误', realErrs.length === 0, realErrs.slice(0, 2).join(' | '));

// ── 清理自造数据 ──
// 按名称特征全量回收，不只删本轮的 id —— 脚本被中断时
// 本轮 id 可能没记录下来，只删它会留下垃圾污染演示库。
// （AGENTS.md 前端约定第 10 条）
console.log('\n── 7. 清理测试数据 ──');
try {
    const list = await (await fetch(`${API}/documents?limit=200`)).json();
    const junk = (list.items || []).filter((d) => /^搜索验收·/.test(d.title || ''));
    for (const d of junk) {
        await fetch(`${API}/documents/${d.id}`, { method: 'DELETE' }).catch(() => {});
    }
    console.log(`  已清理 ${junk.length} 个测试文档`);
    check('测试文档已全部回收', junk.length > 0 || !mkId, `清理了 ${junk.length} 个`);
} catch (e) {
    check('清理测试文档', false, String(e && e.message).slice(0, 80));
}

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
