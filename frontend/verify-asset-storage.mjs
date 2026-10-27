// 资源管理：存储路径与导入导出验收（CDP 直连 + 真实后端）。
//
// 验证用户明确要求的两块新功能：
//   ① 设置资源保存路径 → 资源自动拷贝到指定路径
//   ② 导入导出资源
//
// 以及安全边界（这两块是「服务端在任意路径写文件」+「解压外部内容」，攻击面最大）：
//   - 相对路径被拒
//   - 不存在的路径被拒
//   - 主存储目录及其子目录/上级目录被拒（防自我递归）
//   - ZIP 路径穿越被拒
//   - 非本工具导出的包被拒
//
// 真实浏览器 + 真实文件系统，不 mock。

import { spawn } from 'node:child_process';
import { purgeTestAssets } from './verify-cleanup.mjs';
import { mkdtempSync, writeFileSync, readdirSync, existsSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const URL_BASE = process.env.VERIFY_BASE || 'http://127.0.0.1:5173';
const PORT = Number(process.env.CDP_PORT) || 9850;

const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
    '--headless=new', '--disable-extensions', '--disable-gpu', '--no-first-run',
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'cdp-store-'))}`,
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
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, devicePixelFactor: 1, mobile: false });
    await send('Page.navigate', { url });
    await sleep(2200);
}
await send('Page.enable'); await send('Runtime.enable');

const results = [];
const check = (name, pass, detail = '') => { results.push({ name, pass }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  → ' + detail : ''}`); };

// ── 测试用镜像目录（真实文件系统）────────────────────────────────────
const MIRROR = mkdtempSync(join(tmpdir(), 'tt-mirror-'));
const STAMP = 'ST' + Date.now().toString().slice(-6);

async function api(path, opts = {}) {
    const res = await fetch(URL_BASE + path, {
        method: opts.method || 'GET',
        headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
        body: opts.body ? JSON.stringify(opts.body) : undefined
    });
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/json')) return { status: res.status, body: await res.json().catch(() => null) };
    return { status: res.status, body: Buffer.from(await res.arrayBuffer()) };
}

/** 造一个合法 GLB。 */
function makeGlb(n = 1024) {
    const h = Buffer.alloc(12);
    h.write('glTF', 0, 'ascii');
    h.writeUInt32LE(2, 4);
    h.writeUInt32LE(12 + n, 8);
    return Buffer.concat([h, Buffer.alloc(n, 7)]);
}
async function upload(name, buf) {
    const fd = new FormData();
    fd.append('file', new File([buf], name, { type: 'application/octet-stream' }));
    const res = await fetch(URL_BASE + '/api/assets/upload', { method: 'POST', body: fd });
    return { status: res.status, body: await res.json().catch(() => null) };
}
/** 递归列文件。 */
function listFiles(dir, base = '') {
    if (!existsSync(dir)) return [];
    const out = [];
    for (const e of readdirSync(dir, { withFileTypes: true })) {
        const rel = base ? `${base}/${e.name}` : e.name;
        if (e.isDirectory()) out.push(...listFiles(join(dir, e.name), rel));
        else out.push(rel);
    }
    return out;
}

const asset = await upload(STAMP + '存储测试.glb', makeGlb(2048));
const assetId = asset.body.id;

/**
 * 清理本脚本创建的全部资源。
 *
 * 两个坑：
 * 1. 本脚本一共上传了 3 个带 STAMP 前缀的资源（存储测试 / 自动同步 / 不再同步），
 *    只删第一个会留下垃圾数据污染演示库。
 * 2. 只按**当前** STAMP 搜还不够 —— 上一轮运行失败残留的旧 STAMP 资源
 *    也会一直留在库里。所以这里按通用前缀 'ST' 搜，把历次残留一起清掉。
 */
const cleanup = async () => {
    await fetch(URL_BASE + '/api/assets/settings/storage', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: '' })
    }).catch(() => {});
    try {
        // 搜 'ST' 会误伤正常资源（名称里含 ST 的），所以按
        // 「以 ST + 数字开头」这一特征精确挑出本脚本造出来的探针。
        // 必须同时扫正常集合与回收站 —— 只扫正常集合时，
        // 一旦某次运行中途失败、残留沉进回收站，此后再也匹配不到，会永久堆积。
        await purgeTestAssets(URL_BASE + '/api', /^ST\d{4,}/);
    } catch { /* 清理失败不应影响主流程 */ }
    try { rmSync(MIRROR, { recursive: true, force: true }); } catch { /* 忽略 */ }
};
process.on('exit', cleanup);

await goto(`${URL_BASE}/assets`);
await evalJs(`(() => { try { localStorage.setItem('tt-theme','light'); } catch(e){} location.reload(); return 1; })()`);
await sleep(2400);

// ── 1. UI 元素存在 ──
const ui = await evalJs(`JSON.stringify({
  ioBtns: document.querySelectorAll('.am-io-btn').length,
  labels: [...document.querySelectorAll('.am-io-btn')].map(b=>b.getAttribute('aria-label'))
})`);
const u = JSON.parse(ui);
// 注意：不写死数量 —— 工具栏后来又加了「生成页面二维码」，
// 硬编码「三个」会随功能增加而误报。改为检查关键按钮都在。
const NEEDED = ['导入资源包', '导出所选资源', '设置资源保存路径'];
check('工具栏有导入/导出/存储路径按钮',
    NEEDED.every(n => u.labels.includes(n)), JSON.stringify(u.labels));
check('按钮有可访问名称', u.labels.every(l => !!l), JSON.stringify(u.labels));

// ── 2. 存储路径设置接口 ──
const before = await api('/api/assets/settings/storage');
check('存储设置接口返回主存储路径', before.status === 200 && !!before.body.primaryPath, before.body.primaryPath);
check('初始未配置镜像', before.body.configured === false);

// ── 3. 非法路径被拒 ──
const rel = await api('/api/assets/settings/storage/validate', { method: 'POST', body: { path: 'relative/dir' } });
check('相对路径被拒绝', rel.status === 400 && /绝对路径/.test(rel.body.message), rel.body.message);

const missing = await api('/api/assets/settings/storage/validate', {
    method: 'POST', body: { path: join(MIRROR, 'no-such-dir') }
});
check('不存在的路径被拒绝', missing.status === 400 && /不存在/.test(missing.body.message), missing.body.message);

const primary = before.body.primaryPath;
const self = await api('/api/assets/settings/storage/validate', { method: 'POST', body: { path: primary } });
check('主存储目录本身被拒绝', self.status === 400 && /主存储/.test(self.body.message), self.body.message);

const child = await api('/api/assets/settings/storage/validate', {
    method: 'POST', body: { path: join(primary, 'sub') }
});
check('主存储子目录被拒绝', child.status === 400 && /主存储/.test(child.body.message), child.body.message);

const parent = await api('/api/assets/settings/storage/validate', {
    method: 'POST', body: { path: join(primary, '..', '..') }
});
check('主存储上级目录被拒绝', parent.status === 400 && /上级目录/.test(parent.body.message), parent.body.message);

// ── 4. 设置路径 → 全量同步 ──
const set = await api('/api/assets/settings/storage', { method: 'PUT', body: { path: MIRROR } });
check('设置保存路径成功', set.status === 200, set.body.path);
check('设置后立即全量同步', set.body.synced && set.body.synced.copied >= 1, JSON.stringify(set.body.synced));

const mirrored = listFiles(MIRROR);
check('资源文件已拷贝到指定路径', mirrored.length >= 1, mirrored.length + ' 个文件');
check('拷贝后的文件名是服务端生成形态', mirrored.some(f => /original\d+-[0-9a-f]{16}\.glb$/.test(f)),
    mirrored[0] || '');

// ── 5. 新上传自动同步 ──
const before2 = listFiles(MIRROR).length;
const newer = await upload(STAMP + '自动同步.glb', makeGlb(1024));
check('新资源上传成功', newer.status === 201, String(newer.status));
await sleep(600);
check('新资源自动拷贝到指定路径', listFiles(MIRROR).length > before2,
    `${before2} → ${listFiles(MIRROR).length}`);

// ── 6. 存储路径弹窗 UI ──
await evalJs(`[...document.querySelectorAll('.am-io-btn')].find(b=>b.getAttribute('aria-label')==='设置资源保存路径').click()`);
await sleep(1200);
const dialog = await evalJs(`JSON.stringify({
  open: document.querySelectorAll('.am-storage-dialog').length,
  primary: (document.querySelector('.am-primary-path')||{}).textContent||'',
  input: !!document.querySelector('.am-path-input'),
  value: (document.querySelector('.am-path-input')||{}).value||'',
  hasStats: !!document.querySelector('.am-mirror-state')
})`);
const d = JSON.parse(dialog);
check('存储路径弹窗可打开', d.open === 1, `open=${d.open}`);
check('弹窗展示主存储路径', d.primary.includes('assets'), d.primary);
check('弹窗有路径输入框且回填当前路径', d.input && d.value.length > 0, d.value);
check('弹窗显示镜像统计（已配置时）', d.hasStats === true);

// 校验按钮
await evalJs(`(()=>{ const i=document.querySelector('.am-path-input'); i.value='relative/bad'; 
  const btn=[...document.querySelectorAll('.am-storage-dialog .btn')].find(b=>b.textContent.trim()==='校验'); btn.click(); return 1; })()`);
await sleep(900);
const pathMsg = await evalJs(`JSON.stringify({
  msg: (document.querySelector('.am-path-msg')||{}).textContent||'',
  ok: (document.querySelector('.am-path-msg')||{}).classList?.contains('is-ok')
})`);
const pm = JSON.parse(pathMsg);
check('弹窗内路径校验给出错误提示', pm.msg.includes('绝对路径'), pm.msg.trim());
check('校验失败时不是成功态', pm.ok === false);

await evalJs(`[...document.querySelectorAll('.am-storage-dialog .btn')].find(b=>b.textContent.includes('关闭')).click()`);
await sleep(600);
check('弹窗可关闭', await evalJs(`document.querySelectorAll('.am-storage-dialog').length === 0`));

// ── 7. 导出 ──
const exported = await api('/api/assets/export', { method: 'POST', body: { assetIds: [assetId] } });
check('导出返回 ZIP', exported.status === 200 && exported.body[0] === 0x50 && exported.body[1] === 0x4b,
    `${exported.body.length} 字节`);

// ── 8. 导入 ──
const fd = new FormData();
fd.append('file', new File([exported.body], 'pkg.zip', { type: 'application/zip' }));
const imp = await fetch(URL_BASE + '/api/assets/import', { method: 'POST', body: fd });
const impBody = await imp.json();
check('导入成功', imp.status === 201, JSON.stringify(impBody));
check('导入计数正确（1 资源 1 版本）', impBody.assets === 1 && impBody.versions === 1, JSON.stringify(impBody));

const searched = await api('/api/assets?pageSize=100&search=' + encodeURIComponent(STAMP));
const imported = (searched.body.items || []).find(a => a.id !== assetId);
check('导入产生独立的新资源（id 不同）', !!imported && imported.id !== assetId, imported ? `id=${imported.id}` : '未找到');

// 导入的资源文件可下载
const dl = await fetch(`${URL_BASE}/api/assets/files/${imported.id}/original/latest`);
check('导入的资源文件可下载', dl.status === 200, String(dl.status));
const buf = Buffer.from(await dl.arrayBuffer());
check('导入文件内容与原文件一致', buf.length === 2048 + 12 && buf.subarray(0, 4).toString('ascii') === 'glTF',
    `${buf.length} 字节`);

// 清理导入的资源
await fetch(URL_BASE + '/api/assets/batch-delete', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ assetIds: [imported.id] })
});
await fetch(URL_BASE + '/api/assets/purge?confirm=1', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ assetIds: [imported.id] })
});

// ── 9. 非法包被拒 ──
const notZip = new FormData();
notZip.append('file', new File([Buffer.from('definitely not a zip')], 'x.zip', { type: 'application/zip' }));
const bad = await fetch(URL_BASE + '/api/assets/import', { method: 'POST', body: notZip });
check('非 ZIP 文件被拒绝', bad.status === 400, String(bad.status));

// ── 10. 清除配置 ──
const cleared = await api('/api/assets/settings/storage', { method: 'PUT', body: { path: '' } });
check('可清除保存路径配置', cleared.status === 200 && cleared.body.cleared === true);
const afterClear = listFiles(MIRROR).length;
await upload(STAMP + '不再同步.glb', makeGlb(512));
await sleep(600);
check('清除配置后不再自动拷贝', listFiles(MIRROR).length === afterClear,
    `${afterClear} → ${listFiles(MIRROR).length}`);

const realErrs = consoleErrs.filter(e => !/favicon|DevTools/i.test(e));
check('控制台无报错', realErrs.length === 0, realErrs.slice(0, 3).join(' | '));

await cleanup();
await send('Browser.close').catch(() => {});
chrome.kill();
const failed = results.filter(r => !r.pass);
console.log(`\n=== ${results.length - failed.length}/${results.length} 通过 ===`);
if (failed.length) { failed.forEach(f => console.log('FAIL: ' + f.name)); process.exit(1); }
process.exit(0);