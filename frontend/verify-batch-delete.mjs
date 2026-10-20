// 批量删除功能的浏览器级验证（CDP 直连，无第三方依赖）。
//
// 覆盖：选择模式进出、行勾选、全选/半选、操作条计数、
//       确认弹窗与级联警告、Esc 取消、真实删除后列表刷新与提示。
//
// 运行：node verify-batch-delete.mjs [baseUrl]
// 前置：后端 :3000 与前端 dev（默认 5173）均已启动。

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = process.argv[2] || 'http://127.0.0.1:5175';
const API = 'http://127.0.0.1:3000/api';
const PORT = Number(process.env.CDP_PORT) || 9334;
const profile = mkdtempSync(join(tmpdir(), 'tt-bd-'));

let pass = 0;
const fails = [];
function ok(cond, label, extra = '') {
    if (cond) { pass++; console.log(`  ok   ${label}`); }
    else { fails.push(label); console.log(`  FAIL ${label}${extra ? '  → ' + extra : ''}`); }
}

// ── 准备测试数据（父页 + 两个子页 + 三个独立页）─────────────────
async function apiPost(path, body) {
    const res = await fetch(API + path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
    });
    return { status: res.status, data: await res.json().catch(() => null) };
}
const stamp = Date.now();
const parent = await apiPost('/documents', { title: `BD父-${stamp}`, content_md: '父页' });
const kid1 = await apiPost('/documents', { title: `BD子1-${stamp}`, parent_id: parent.data.id });
const kid2 = await apiPost('/documents', { title: `BD子2-${stamp}`, parent_id: parent.data.id });
const lonely = [0, 1, 2].map((i) => apiPost('/documents', { title: `BD孤${i}-${stamp}` }));
const lonelyIds = (await Promise.all(lonely)).map((r) => r.data.id);
const ALL_IDS = [parent.data.id, kid1.data.id, kid2.data.id, ...lonelyIds];
console.log(`准备测试数据：父 ${parent.data.id} / 子 ${kid1.data.id},${kid2.data.id} / 独立 ${lonelyIds.join(',')}\n`);

// ── 启动 Chrome ──────────────────────────────────────────────────
const chrome = spawn(
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
     '--disable-extensions', '--no-first-run', '--window-size=1680,1000', BASE],
    { stdio: 'ignore' }
);
process.on('exit', () => { try { chrome.kill(); } catch { /* ignore */ } });

async function cdpTargets() {
    for (let i = 0; i < 50; i++) {
        try {
            const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
            const list = await r.json();
            const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
            if (page) return page;
        } catch { /* 还没起来 */ }
        await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error('Chrome 调试端口未就绪');
}

const page = await cdpTargets();
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let msgId = 0;
const pending = new Map();
ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
        const { res, rej } = pending.get(m.id);
        pending.delete(m.id);
        m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
    }
};
function send(method, params = {}) {
    const id = ++msgId;
    ws.send(JSON.stringify({ id, method, params }));
    return new Promise((res, rej) => pending.set(id, { res, rej }));
}

/** 在页面里求值，返回 JSON 化结果。 */
async function evalJs(expression) {
    const r = await send('Runtime.evaluate', {
        expression, awaitPromise: true, returnByValue: true
    });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval 失败');
    return r.result.value;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(expr, label, timeout = 6000) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
        if (await evalJs(expr)) return true;
        await sleep(200);
    }
    return false;
}

try {
    await send('Page.enable');
    await send('Runtime.enable');
    // Chrome 启动时已加载 BASE（首页），这里显式导航到知识库路由。
    // 导航后需等待文档切换完成，否则求值仍落在旧的 about:blank 上。
    await send('Page.navigate', { url: BASE + '/kb' });
    await sleep(1500);

    // 固定浅色主题，避免跟随宿主深色偏好导致断言不稳。
    // 首次导航时 origin 可能尚未就绪（读 localStorage 抛 SecurityError），失败不致命。
    await evalJs("localStorage.setItem('tt-theme','light'); location.reload();").catch(() => {});
    await sleep(2500);
    ok(await waitFor("document.querySelectorAll('.doc-row').length > 0", '列表渲染'),
        '固定浅色主题后列表正常渲染');

    // ── 1. 默认状态：无勾选列、无操作条 ─────────────────────────
    console.log('【1】默认状态');
    ok(!(await evalJs("!!document.querySelector('.kb-check-cell')")), '默认不渲染勾选列');
    ok(!(await evalJs("!!document.querySelector('.kb-selbar')")), '默认不显示操作条');
    ok(await evalJs("!!document.querySelector('.kb-io .btn.is-on') === false"), '「批量删除」按钮默认非激活态');

    // ── 2. 进入选择模式 ─────────────────────────────────────────
    console.log('\n【2】进入选择模式');
    await evalJs(`[...document.querySelectorAll('.kb-io .btn')].find(b => b.textContent.includes('批量删除')).click();`);
    await sleep(500);
    ok(await evalJs("!!document.querySelector('.kb-selbar')"), '操作条出现');
    ok(await evalJs("document.querySelectorAll('.kb-check-cell').length === document.querySelectorAll('.doc-row').length"),
        '每行都有勾选框');
    ok(await evalJs("document.querySelector('.kb-io .btn.is-on') !== null"), '按钮切到激活态');
    ok(await evalJs("document.querySelector('.kb-sel-count').textContent.includes('已选 0 项')"), '计数初始为 0');
    ok(await evalJs("document.querySelector('.kb-selbar .btn-danger-solid').disabled === true"),
        '未选中时「删除所选」置灰');

    // ── 3. 勾选与全选/半选 ───────────────────────────────────────
    console.log('\n【3】勾选与全选');
    await evalJs(`document.querySelectorAll('.doc-row .kb-check')[0].click();`);
    await sleep(250);
    ok(await evalJs("document.querySelector('.kb-sel-count').textContent.includes('已选 1 项')"), '单选计数 = 1');
    ok(await evalJs("document.querySelector('.doc-row').classList.contains('is-selected')"), '首行标记为已选');
    ok(await evalJs("document.querySelector('.kb-selbar .btn-danger-solid').disabled === false"),
        '选中后「删除所选」可用');
    ok(await evalJs("document.querySelector('.kb-sel-all .kb-check').indeterminate === true"), '全选框呈半选态');

    await evalJs(`document.querySelector('.kb-sel-all .kb-check').click();`);
    await sleep(400);
    const total = await evalJs("document.querySelectorAll('.doc-row').length");
    ok(await evalJs(`document.querySelector('.kb-sel-count').textContent.includes('已选 ${total} 项')`),
        `全选后计数 = ${total}`);
    ok(await evalJs("document.querySelector('.kb-sel-all .kb-check').indeterminate === false"), '全选后不再是半选态');
    ok(await evalJs("document.querySelector('.kb-sel-all').textContent.includes('取消全选')"), '文案切到「取消全选」');

    await evalJs(`document.querySelector('.kb-sel-all .kb-check').click();`);
    await sleep(300);
    ok(await evalJs("document.querySelector('.kb-sel-count').textContent.includes('已选 0 项')"), '取消全选归零');

    // ── 4. 搜索会剔除不可见勾选 ───────────────────────────────────
    console.log('\n【4】列表变化后清理勾选');
    await evalJs(`document.querySelectorAll('.doc-row .kb-check')[0].click();`);
    await sleep(200);
    ok(await evalJs("document.querySelector('.kb-sel-count').textContent.includes('已选 1 项')"), '先勾 1 项');
    await evalJs(`
        const i = document.querySelector('.kb-search-input');
        i.value = 'zzz不存在的关键词zzz';
        i.dispatchEvent(new Event('input', { bubbles: true }));
    `);
    await sleep(900);
    ok(await waitFor("document.querySelectorAll('.doc-row').length === 0", '搜索空结果'), '搜索无结果');
    ok(await evalJs("document.querySelector('.kb-sel-count').textContent.includes('已选 0 项')"),
        '不可见的勾选被自动剔除');
    await evalJs("document.querySelector('.kb-search-clear') && document.querySelector('.kb-search-clear').click();");
    await sleep(900);

    // ── 5. 确认弹窗与级联警告 ─────────────────────────────────────
    console.log('\n【5】确认弹窗');
    await evalJs(`(() => {
        const hit = [...document.querySelectorAll('.doc-row')]
            .find(r => r.querySelector('.doc-title').textContent.includes(${JSON.stringify(`BD父-${stamp}`)}));
        hit.querySelector('.kb-check').click();
    })()`);
    await sleep(300);
    await evalJs(`[...document.querySelectorAll('.kb-selbar .btn')].find(b => b.textContent.includes('删除所选')).click();`);
    await sleep(500);
    ok(await evalJs("!!document.querySelector('.overlay .dialog')"), '确认弹窗打开');
    ok(await evalJs("document.querySelector('.dialog-title').textContent.includes('确认批量删除')"), '弹窗标题正确');
    ok(await evalJs("document.querySelector('.dialog-text').textContent.includes('1')"), '弹窗显示选中数量');
    ok(await evalJs("!!document.querySelector('.dialog-warn')"), '父页面触发级联警告');
    ok(await evalJs("document.querySelector('.dialog-warn').textContent.includes('2 个子页面')"),
        '级联警告正确统计 2 个子页面');
    ok(await evalJs("document.querySelectorAll('.kb-del-item').length === 1"), '弹窗列出选中标题');

    // ── 6. Esc 取消不删除 ────────────────────────────────────────
    console.log('\n【6】Esc 取消');
    await evalJs("window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));");
    await sleep(400);
    ok(!(await evalJs("!!document.querySelector('.overlay .dialog')")), 'Esc 关闭弹窗');
    const stillThere = await fetch(`${API}/documents/${parent.data.id}`);
    ok(stillThere.status === 200, '父页未被删除（Esc 安全）');

    // ── 7. 真实删除：三个独立页 ───────────────────────────────────
    console.log('\n【7】执行批量删除');
    // 上一步 Esc 只关弹窗、不清勾选（父页仍处于选中态），这里先显式清空，
    // 否则本步实际会带着父页一起删掉。
    await evalJs(`[...document.querySelectorAll('.kb-selbar .btn')].find(b => b.textContent.includes('清空选择')).click();`);
    await sleep(300);
    ok(await evalJs("document.querySelector('.kb-sel-count').textContent.includes('已选 0 项')"), '「清空选择」归零');
    await evalJs(`(() => {
        // 必须按本轮唯一 stamp 精确匹配。写死 'BD孤' 前缀会在上一轮
        // 清理失败留下同名残留时多勾选，导致「已选 3 项」假性失败。
        const stamp = ${JSON.stringify(String(stamp))};
        for (const r of document.querySelectorAll('.doc-row')) {
            const t = r.querySelector('.doc-title').textContent;
            if (t.includes('BD孤') && t.includes(stamp)) r.querySelector('.kb-check').click();
        }
    })()`);
    await sleep(400);
    ok(await evalJs("document.querySelector('.kb-sel-count').textContent.includes('已选 3 项')"), '选中 3 个独立页');
    await evalJs(`[...document.querySelectorAll('.kb-selbar .btn')].find(b => b.textContent.includes('删除所选')).click();`);
    await sleep(400);
    await evalJs(`[...document.querySelectorAll('.dialog-actions .btn')].find(b => b.textContent.includes('确认删除')).click();`);
    await sleep(1500);
    ok(!(await evalJs("!!document.querySelector('.overlay .dialog')")), '删除后弹窗关闭');
    for (const id of lonelyIds) {
        const r = await fetch(`${API}/documents/${id}`);
        ok(r.status === 404, `独立页 ${id} 已删除`);
    }
    const parentAlive = await fetch(`${API}/documents/${parent.data.id}`);
    ok(parentAlive.status === 200, '未选中的父页仍在');
    ok(await evalJs("document.querySelector('.kb-io-msg') && document.querySelector('.kb-io-msg').textContent.includes('已删除 3 个文档')"),
        '顶部提示已删除 3 个');
    ok(await evalJs("document.querySelector('.kb-sel-count').textContent.includes('已选 0 项')"), '删除后选择已清空');

    // ── 8. 删除父页验证级联 ───────────────────────────────────────
    console.log('\n【8】级联删除父页');
    await evalJs(`(() => {
        const hit = [...document.querySelectorAll('.doc-row')]
            .find(r => r.querySelector('.doc-title').textContent.includes(${JSON.stringify(`BD父-${stamp}`)}));
        hit.querySelector('.kb-check').click();
    })()`);
    await sleep(300);
    await evalJs(`[...document.querySelectorAll('.kb-selbar .btn')].find(b => b.textContent.includes('删除所选')).click();`);
    await sleep(400);
    await evalJs(`[...document.querySelectorAll('.dialog-actions .btn')].find(b => b.textContent.includes('确认删除')).click();`);
    await sleep(1500);
    for (const id of [parent.data.id, kid1.data.id, kid2.data.id]) {
        const r = await fetch(`${API}/documents/${id}`);
        ok(r.status === 404, `级联删除：${id} 已不存在`);
    }
    ok(await evalJs("document.querySelector('.kb-io-msg').textContent.includes('连带 2 个子页面')"),
        '提示报告连带删除的子页数');

    // ── 9. 退出选择模式清空状态 ───────────────────────────────────
    console.log('\n【9】退出选择模式');
    await evalJs(`(() => {
        const r = document.querySelector('.doc-row');
        if (r) r.querySelector('.kb-check').click();
    })()`);
    await sleep(250);
    await evalJs(`[...document.querySelectorAll('.kb-io .btn')].find(b => b.textContent.includes('退出选择')).click();`);
    await sleep(400);
    ok(!(await evalJs("!!document.querySelector('.kb-selbar')")), '操作条已隐藏');
    ok(!(await evalJs("!!document.querySelector('.kb-check-cell')")), '勾选列已移除');
    ok(await evalJs("document.querySelectorAll('.doc-row.is-selected').length === 0"), '选中样式已清除');
    // 再进入时不应有残留勾选
    await evalJs(`[...document.querySelectorAll('.kb-io .btn')].find(b => b.textContent.includes('批量删除')).click();`);
    await sleep(400);
    ok(await evalJs("document.querySelector('.kb-sel-count').textContent.includes('已选 0 项')"), '重新进入无残留选择');
} catch (err) {
    fails.push('执行异常：' + err.message);
    console.error('\n执行异常：', err);
} finally {
    // 清理：确保测试数据不残留
    await fetch(`${API}/documents/batch-delete`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ids: ALL_IDS })
    }).catch(() => {});
    try { ws.close(); } catch { /* ignore */ }
    try { chrome.kill(); } catch { /* ignore */ }
    try { rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
}

console.log(`\n${'─'.repeat(50)}`);
console.log(`通过 ${pass} / ${pass + fails.length}`);
if (fails.length) {
    console.log('\n未通过：');
    for (const f of fails) console.log('  - ' + f);
    process.exit(1);
}
