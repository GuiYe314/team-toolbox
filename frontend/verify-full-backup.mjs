// 全量备份的前端验收。
//
// 覆盖两件事：
//   1. 界面必须**明示**备份范围 —— 用户点「导出备份」以为数据安全了，
//      实际只保住文字，这是本功能要修的核心问题。
//   2. 全量备份端点可用，且产出的包结构完整（文档 + 图片 + 资源文件）。
//
// 判据用**可观测事实**：菜单文案、端点 HTTP 状态、包内条目 ——
// 不依赖内部实现。

const BASE = process.env.VERIFY_BASE || 'http://127.0.0.1:5210';
const CDP_PORT = Number(process.env.CDP_PORT || 11601);

let pass = 0, fail = 0;
const failures = [];

function check(name, ok, detail = '') {
    if (ok) { pass++; console.log(`  ok   ${name}`); }
    else { fail++; failures.push(`${name}${detail ? ' — ' + detail : ''}`); console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`); }
}

import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
    '--headless=new', '--disable-gpu', '--no-first-run', '--disable-extensions',
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${mkdtempSync(join(tmpdir(), 'fbv-'))}`,
    '--window-size=1700,1050', 'about:blank'
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let list;
for (let i = 0; i < 40; i++) {
    try { list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json(); if (list.length) break; } catch {}
    await sleep(300);
}
const ws = new WebSocket(list.find((t) => t.type === 'page').webSocketDebuggerUrl);
let id = 0; const pending = new Map();
ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
});
await new Promise((r) => ws.addEventListener('open', r));
const send = (method, params = {}) => {
    const n = ++id;
    ws.send(JSON.stringify({ id: n, method, params }));
    return new Promise((r) => pending.set(n, r));
};
const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result?.exceptionDetails) return 'EXC ' + JSON.stringify(r.result.exceptionDetails).slice(0, 200);
    return r.result?.result?.value;
};

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1700, height: 1050, deviceScaleFactor: 1, mobile: false });

console.log('\n── 1. 备份菜单明示范围 ──');

await send('Page.navigate', { url: BASE + '/kb' });
await sleep(3500);

// 打开导出菜单
const opened = await ev(`(() => {
    const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim().startsWith('导出'));
    if (b) { b.click(); return true; }
    return false;
})()`);
check('导出菜单可打开', opened === true);
await sleep(800);

const menu = JSON.parse(await ev(`JSON.stringify([...document.querySelectorAll('.kb-io-dropdown button')].map(b => ({
    title: b.querySelector('.dd-title')?.textContent?.trim() || '',
    desc: b.querySelector('.dd-desc')?.textContent?.trim() || ''
})))`) || '[]');

console.log('  菜单项:', menu.map((m) => m.title).join(' / '));

check('有「全量备份」选项', menu.some((m) => m.title.includes('全量备份')), menu.map((m) => m.title).join(','));
check('全量备份说明提到资源文件', menu.some((m) => m.title.includes('全量备份') && m.desc.includes('资源')),
    menu.find((m) => m.title.includes('全量备份'))?.desc || '');
check('仅文档选项明示不含资源文件', menu.some((m) => m.desc.includes('不含图片与资源文件')),
    menu.map((m) => m.desc).join(' | '));

console.log('\n── 2. 全量备份端点可用 ──');

// 直接调端点（前端菜单只是入口，真正的验证在服务端）
const zipRes = await fetch(BASE + '/api/backup/full-export');
check('GET /api/backup/full-export 返回 200', zipRes.status === 200, `实际 ${zipRes.status}`);
check('Content-Type 为 application/zip',
    (zipRes.headers.get('content-type') || '').includes('application/zip'),
    zipRes.headers.get('content-type') || '(无)');
check('Content-Disposition 含附件下载',
    (zipRes.headers.get('content-disposition') || '').includes('attachment'),
    zipRes.headers.get('content-disposition') || '(无)');

const zipBuf = Buffer.from(await zipRes.arrayBuffer());
check('包非空且是 ZIP 魔数', zipBuf.length > 4 && zipBuf[0] === 0x50 && zipBuf[1] === 0x4b,
    `${zipBuf.length} 字节`);

// 解析 ZIP 中央目录，列出条目
function listZipEntries(buf) {
    let eocd = -1;
    for (let i = buf.length - 22; i >= 0; i--) {
        if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) return null;
    const count = buf.readUInt16LE(eocd + 10);
    let off = buf.readUInt32LE(eocd + 16);
    const names = [];
    for (let i = 0; i < count; i++) {
        const nameLen = buf.readUInt16LE(off + 28);
        const extraLen = buf.readUInt16LE(off + 30);
        const cmtLen = buf.readUInt16LE(off + 32);
        names.push(buf.toString('utf8', off + 46, off + 46 + nameLen));
        off += 46 + nameLen + extraLen + cmtLen;
    }
    return names;
}

const entries = listZipEntries(zipBuf);
check('ZIP 中央目录可解析', entries !== null);
if (entries) {
    console.log(`  包内条目: ${entries.length} 个`);
    const has = (pred) => entries.some(pred);
    check('含 manifest.json', has((n) => n === 'manifest.json'));
    check('含 documents.json', has((n) => n === 'documents.json'));
    check('含 assets/manifest.json（资源清单）', has((n) => n === 'assets/manifest.json'));
    check('含 assets/files/ 下的资源文件', has((n) => n.startsWith('assets/files/')));
    // 关键：资源文件必须在 files/ 目录层下 —— 少了这层恢复时一个文件都找不到
    check('资源文件在 assets/files/ 层（与恢复端约定一致）',
        has((n) => /^assets\/files\/\d+\/\d+\//.test(n)),
        entries.filter((n) => n.includes('assets/')).slice(0, 3).join(', '));
}

console.log('\n── 3. 导入端点存在且校验非法包 ──');

const bad = new FormData();
bad.append('file', new Blob([Buffer.from('not a zip at all')], { type: 'application/zip' }), 'bad.zip');
const badRes = await fetch(BASE + '/api/backup/full-import', { method: 'POST', body: bad });
check('POST /api/backup/full-import 拒绝非法包', badRes.status === 400, `实际 ${badRes.status}`);
const badBody = await badRes.json().catch(() => ({}));
check('错误响应带说明文字', typeof badBody.message === 'string' && badBody.message.length > 0,
    JSON.stringify(badBody).slice(0, 120));

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
