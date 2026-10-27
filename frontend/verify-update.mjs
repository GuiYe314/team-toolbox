// 自动更新的界面验收。
//
// ── 刻意不点「下载并安装」 ──
//
// 那个按钮会真的替换程序文件并重启服务，跑完这台机器上的服务就变样了。
// 验收脚本的职责是「确认界面把状态讲清楚了」，不是「每次都重装一遍应用」。
// 安装与回滚由 backend/src/updater.test.js 的单元测试、
// 以及隔离沙箱里的 apply.cmd 手工验证覆盖（见 docs/acceptance）。
//
// ── 覆盖的状态 ──
//
//   1. 未配置更新源
//   2. 已配置、已是最新
//   3. 已配置、有新版本（含说明与体积）
//   4. 清单损坏时的错误提示
//
// 更新源指向一个临时目录，脚本结束时清空配置 —— 不污染真实部署。

import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = Number(process.env.CDP_PORT) || 10501;
const BASE = process.env.VERIFY_BASE || 'http://127.0.0.1:5173';
const API = BASE + '/api';

const SRC = mkdtempSync(join(tmpdir(), 'tt-upd-verify-'));

let pass = 0;
const failures = [];
function check(name, ok, detail = '') {
    if (ok) {
        pass += 1;
        console.log(`  ✓ ${name}`);
    } else {
        failures.push(`${name}${detail ? ' — ' + detail : ''}`);
        console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`);
    }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function writeManifest(obj) {
    mkdirSync(SRC, { recursive: true });
    writeFileSync(join(SRC, 'manifest.json'), typeof obj === 'string' ? obj : JSON.stringify(obj), 'utf8');
}

const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
    '--headless=new', '--disable-gpu', '--no-first-run', '--disable-extensions',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${mkdtempSync(join(tmpdir(), 'tt-upd-cdp-'))}`,
    '--window-size=1700,1050', 'about:blank'
], { stdio: 'ignore' });

let list = null;
for (let i = 0; i < 40; i += 1) {
    try {
        list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
        if (list.length) break;
    } catch { /* 还没起来 */ }
    await sleep(300);
}
if (!list || !list.length) {
    console.error('Chrome 启动失败（端口可能被 Windows 保留段占用，换 CDP_PORT）');
    process.exit(1);
}

const ws = new WebSocket(list.find((t) => t.type === 'page').webSocketDebuggerUrl);
let msgId = 0;
const pending = new Map();
const errs = [];
ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
        pending.get(m.id)(m);
        pending.delete(m.id);
        return;
    }
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
        errs.push(m.params.args.map((a) => a.value ?? '').join(' '));
    }
});
await new Promise((r) => ws.addEventListener('open', r));

const send = (method, params = {}) => {
    const id = ++msgId;
    ws.send(JSON.stringify({ id, method, params }));
    return new Promise((r) => pending.set(id, r));
};
const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result?.exceptionDetails) return 'EXC ' + JSON.stringify(r.result.exceptionDetails).slice(0, 200);
    return r.result?.result?.value;
};
const text = async (sel) => await ev(`(document.querySelector(${JSON.stringify(sel)})||{}).textContent?.trim()||''`);

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1700, height: 1050, deviceScaleFactor: 1, mobile: false });

async function goto() {
    await send('Page.navigate', { url: BASE + '/settings' });
    await sleep(2500);
}

try {
    // ── 准备：清空更新源，保证从「未配置」开始 ──
    const health = await (await fetch(API + '/health')).json();
    await fetch(API + '/update/source', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: '' })
    });

    await goto();
    console.log('\n── 1. 页面与导航 ──');
    check('设置页渲染', await ev(`document.querySelectorAll('.set-page').length>0`));
    check('侧栏有「设置」入口', await ev(`[...document.querySelectorAll('.nav-item')].some(a=>a.textContent.trim()==='设置')`));
    check('当前版本与后端一致', (await text('.set-code')) === health.version,
        `页面 ${await text('.set-code')} vs 后端 ${health.version}`);

    console.log('\n── 2. 未配置更新源 ──');
    check('显示「未配置」', (await text('.set-tag')) === '未配置', await text('.set-tag'));
    check('提示先填地址', /先在上面填写更新源地址/.test(await ev(`document.querySelector('.set-card:last-child .set-note')?.textContent||''`)));

    console.log('\n── 3. 保存更新源（界面可编辑）──');
    check('输入框可编辑（未被环境变量锁定）', (await ev(`!!(document.querySelector('.set-input')||{}).disabled`)) === false);

    // 分两步：先填值，等 Vue 重渲染后再点。
    // 同一个 tick 内「改 v-model + 点按钮」时按钮还是禁用态（disabled 依赖
    // sourceInput，重渲染是异步的），点击会被浏览器直接吞掉 —— 这不是产品缺陷，
    // 是自动化脚本必须绕开的时序。
    await ev(`(() => {
        const i = document.querySelector('.set-input');
        i.value = ${JSON.stringify(SRC)};
        i.dispatchEvent(new Event('input', { bubbles: true }));
        return 1;
    })()`);
    await sleep(400);
    const saved = await ev(`(() => {
        const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === '保存');
        if (!b) return 'no-button';
        if (b.disabled) return 'disabled';
        b.click();
        return 'clicked';
    })()`);
    check('能点保存', saved === 'clicked', String(saved));
    await sleep(1500);
    check('保存成功提示', /已保存/.test(await ev(`document.body.innerText`)));

    /** 点一次「检查更新」并等结果。 */
    const clickCheck = async () => {
        await ev(`[...document.querySelectorAll('button')].find(x=>x.textContent.includes('检查更新'))?.click()`);
        await sleep(2200);
    };

    console.log('\n── 4. 已是最新 ──');
    writeManifest({
        schema: 1,
        latest: health.version,
        releases: [{ version: health.version, file: 'x.zip', sha256: 'a'.repeat(64) }]
    });
    await clickCheck();
    check('提示已是最新', /已是最新版本/.test(await ev(`document.body.innerText`)));

    console.log('\n── 5. 有新版本 ──');
    writeManifest({
        schema: 1,
        latest: '99.0.0',
        releases: [{
            version: '99.0.0',
            file: 'team-toolbox-99.0.0.zip',
            sha256: 'b'.repeat(64),
            size: 74438578,
            notes: '验收用更新说明'
        }]
    });
    await clickCheck();
    check('显示版本变化', /→\s*99\.0\.0/.test(await text('.set-update-ver')), await text('.set-update-ver'));
    check('显示更新说明', (await text('.set-update-notes')) === '验收用更新说明');
    check('显示包体积', /MB/.test(await ev(`[...document.querySelectorAll('.set-kv-tight dd')].map(e=>e.textContent).join(' ')`)));
    check('有「下载并安装」按钮', await ev(`[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='下载并安装')`));
    check('明示会备份与可回滚', /自动备份全部数据/.test(await text('.set-warn')));

    console.log('\n── 6. 清单损坏 ──');
    writeManifest('{ this is not json');
    await clickCheck();
    const body = await ev(`document.body.innerText`);
    check('给出错误提示而不是静默', /检查失败|不是合法的 JSON/.test(body));
    check('错误状态不残留安装按钮', !(await ev(`[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='下载并安装')`)));

    console.log('\n── 7. 控制台 ──');
    const realErrs = errs.filter((e) => !/favicon|DevTools/i.test(e));
    check('控制台无错误', realErrs.length === 0, realErrs.slice(0, 2).join(' | '));
} finally {
    // 还原：清空更新源 + 删临时目录
    await fetch(API + '/update/source', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: '' })
    }).catch(() => {});
    try { rmSync(SRC, { recursive: true, force: true }); } catch { /* 忽略 */ }

    console.log('\n────────────────────────────────────────────────');
    console.log(`通过 ${pass} / ${pass + failures.length}`);
    if (failures.length) {
        console.log('\n未通过:');
        failures.forEach((f) => console.log('  - ' + f));
    }
    console.log('────────────────────────────────────────────────');

    await send('Browser.close').catch(() => {});
    chrome.kill();
    process.exit(failures.length === 0 ? 0 : 1);
}
