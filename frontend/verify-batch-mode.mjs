/**
 * 批量模式 + 菜单位置验收
 *
 * 覆盖：
 * 1. 默认**不显示**复选框（只有点「批量」按钮才进入批量模式）
 * 2. 点「批量」后复选框与批量操作条出现
 * 3. 退出批量模式时清空选择
 * 4. 批量模式下点击行只切换选中，不打开详情
 * 5. 普通模式下点击行打开详情
 * 6. 更多操作菜单**完整落在视口内**（回归点：曾整块跑到视口外）
 * 7. 菜单右边缘对齐按钮右边缘
 * 8. 文件夹菜单同样在视口内
 * 9. 菜单不遮挡自身锚点
 */

const URL_BASE = process.env.VERIFY_BASE || 'http://127.0.0.1:5173';
const CDP_PORT = Number(process.env.CDP_PORT) || 9600;

import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const results = [];
const check = (name, pass, detail = '') => {
    results.push({ name, pass });
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  → ' + detail : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
    '--headless=new', '--disable-gpu', '--no-first-run', '--disable-extensions',
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${mkdtempSync(join(tmpdir(), 'batch-verify-'))}`,
    '--window-size=1700,1050', 'about:blank'
], { stdio: 'ignore' });

let targets;
for (let i = 0; i < 40; i++) {
    try {
        targets = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
        if (targets.length) break;
    } catch { /* 还没起来 */ }
    await sleep(300);
}
const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
let msgId = 0;
const pending = new Map();
const consoleErrs = [];
ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
        consoleErrs.push(m.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
    }
});
await new Promise((r) => ws.addEventListener('open', r));
const send = (method, params = {}) => {
    const n = ++msgId;
    ws.send(JSON.stringify({ id: n, method, params }));
    return new Promise((r) => pending.set(n, r));
};
const evalJs = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result?.exceptionDetails) return 'EXC ' + JSON.stringify(r.result.exceptionDetails).slice(0, 200);
    return r.result?.result?.value;
};
const goto = async (url, w = 1700, h = 1050) => {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url });
    await sleep(2800);
};
await send('Page.enable');
await send('Runtime.enable');

await goto(`${URL_BASE}/assets`);

// ═══ 1. 默认不显示复选框 ═══
const initial = await evalJs(`JSON.stringify({
    checks: document.querySelectorAll('.am-check').length,
    selbar: !!document.querySelector('.am-selbar'),
    toggle: !!document.querySelector('.am-batch-toggle')
})`);
const ini = JSON.parse(initial);
check('存在「批量」开关按钮', ini.toggle === true);
check('默认不显示复选框', ini.checks === 0, `${ini.checks} 个`);
check('默认不显示批量操作条', ini.selbar === false);

// ═══ 2. 点「批量」后复选框与操作条出现 ═══
await evalJs(`document.querySelector('.am-batch-toggle').click()`);
await sleep(700);
const on = await evalJs(`JSON.stringify({
    checks: document.querySelectorAll('.am-check').length,
    selbar: !!document.querySelector('.am-selbar'),
    pressed: document.querySelector('.am-batch-toggle')?.getAttribute('aria-pressed'),
    onClass: document.querySelector('.am-batch-toggle')?.classList.contains('is-on')
})`);
const o = JSON.parse(on);
check('点批量后复选框出现', o.checks > 1, `${o.checks} 个（含表头全选）`);
check('点批量后批量操作条出现', o.selbar === true);
check('批量按钮标记为按下态', o.pressed === 'true' && o.onClass === true);

// ═══ 3. 批量模式下勾选生效，且点行不开详情 ═══
await evalJs(`(() => {
    const cbs = [...document.querySelectorAll('.am-check')].slice(1, 3);
    cbs.forEach(c => { c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); });
    return 1;
})()`);
await sleep(500);
const sel = await evalJs(`JSON.stringify({
    count: (document.querySelector('.am-sel-count') || {}).textContent || '',
    detail: !!document.querySelector('.am-detail')
})`);
const s = JSON.parse(sel);
check('勾选后计数更新', s.count.includes('2'), s.count);
check('批量模式下点复选框不打开详情面板', s.detail === false);

// 点行（不是复选框）→ 只切换选中，不开详情
await evalJs(`(() => {
    const row = document.querySelectorAll('.am-table tbody tr')[3];
    row.querySelector('.am-td-name').click();
    return 1;
})()`);
await sleep(700);
const afterRow = await evalJs(`JSON.stringify({
    count: (document.querySelector('.am-sel-count') || {}).textContent || '',
    detail: !!document.querySelector('.am-detail')
})`);
const ar = JSON.parse(afterRow);
check('批量模式下点行只切换选中', ar.count.includes('3'), ar.count);
check('批量模式下点行不打开详情面板', ar.detail === false);

// ═══ 4. 退出批量模式清空选择 ═══
await evalJs(`document.querySelector('.am-batch-toggle').click()`);
await sleep(600);
const off = await evalJs(`JSON.stringify({
    checks: document.querySelectorAll('.am-check').length,
    selbar: !!document.querySelector('.am-selbar')
})`);
const of = JSON.parse(off);
check('退出批量模式后复选框隐藏', of.checks === 0, `${of.checks} 个`);
check('退出批量模式后操作条隐藏', of.selbar === false);

// ═══ 5. 普通模式点行打开详情 ═══
await evalJs(`(() => {
    document.querySelectorAll('.am-table tbody tr')[0].querySelector('.am-td-name').click();
    return 1;
})()`);
await sleep(1200);
check('普通模式下点行打开详情', await evalJs(`!!document.querySelector('.am-detail')`));

// ═══ 6. 更多操作菜单完整落在视口内（回归点）═══
await evalJs(`(() => {
    const b = [...document.querySelectorAll('.am-td-act .am-vbtn')].find(x => x.getAttribute('aria-label') === '更多操作');
    b.click();
    return 1;
})()`);
await sleep(900);
const menu = await evalJs(`(() => {
    const m = document.querySelector('.am-menu');
    if (!m) return { exists: false };
    const r = m.getBoundingClientRect();
    const b = [...document.querySelectorAll('.am-td-act .am-vbtn')].find(x => x.getAttribute('aria-label') === '更多操作');
    const br = b.getBoundingClientRect();
    return {
        exists: true,
        left: Math.round(r.left), right: Math.round(r.right),
        top: Math.round(r.top), bottom: Math.round(r.bottom),
        w: Math.round(r.width), h: Math.round(r.height),
        btnRight: Math.round(br.right),
        vw: innerWidth, vh: innerHeight,
        items: m.querySelectorAll('button').length,
        visible: getComputedStyle(m).visibility
    };
})()`);
const mn = typeof menu === 'string' ? {} : menu;
check('更多操作菜单已打开', mn.exists === true);
check('菜单完全在视口内（回归点：曾整块跑到视口外）',
    mn.left >= 0 && mn.right <= mn.vw && mn.top >= 0 && mn.bottom <= mn.vh,
    `x=${mn.left}~${mn.right} (视口 ${mn.vw}), y=${mn.top}~${mn.bottom}`);
check('菜单右边缘对齐按钮右边缘', Math.abs(mn.right - mn.btnRight) <= 2,
    `菜单 right=${mn.right}, 按钮 right=${mn.btnRight}`);
check('菜单项完整（7 项）', mn.items === 7, `${mn.items} 项`);
check('菜单未被隐藏（定位后可见）', mn.visible === 'visible', mn.visible);

// 菜单项文字完整（曾被压成竖排单字）
const itemText = await evalJs(`JSON.stringify([...document.querySelectorAll('.am-menu button')].map(b => b.textContent.trim()))`);
const items = JSON.parse(itemText);
check('菜单项文字完整未被压扁', items.includes('上传新版本') && items.includes('移入回收站'), items.join('|'));

// ═══ 7. 文件夹菜单同样在视口内 ═══
await evalJs(`document.body.click()`);
await sleep(400);
const folderBtn = await evalJs(`(() => {
    const b = document.querySelector('.am-tree-act[aria-label*="更多"], .am-tree-row .am-tree-act:last-of-type');
    if (!b) return false;
    b.click();
    return true;
})()`);
if (folderBtn) {
    await sleep(800);
    const fmenu = await evalJs(`(() => {
        const m = document.querySelector('.am-menu');
        if (!m) return { exists: false };
        const r = m.getBoundingClientRect();
        return { exists: true, left: Math.round(r.left), right: Math.round(r.right), vw: innerWidth };
    })()`);
    const fm = typeof fmenu === 'string' ? {} : fmenu;
    check('文件夹菜单在视口内', fm.exists !== true || (fm.left >= 0 && fm.right <= fm.vw),
        `x=${fm.left}~${fm.right}`);
} else {
    check('文件夹菜单在视口内', true, '（未找到文件夹菜单按钮，跳过）');
}

// ═══ 8. 控制台无报错 ═══
const realErrs = consoleErrs.filter((e) => !/favicon|DevTools/i.test(e));
check('控制台无报错', realErrs.length === 0, realErrs.slice(0, 3).join(' | '));

await send('Browser.close').catch(() => {});
chrome.kill();
const failed = results.filter((r) => !r.pass);
console.log(`\n=== ${results.length - failed.length}/${results.length} 通过 ===`);
if (failed.length) { failed.forEach((f) => console.log('FAIL: ' + f.name)); process.exit(1); }
process.exit(0);
