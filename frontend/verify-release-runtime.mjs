// 发布包的运行时兼容性验收。
//
// 存在的原因：v0.1.0 的发布包在**构建机**上验收通过，装到用户机器却起不来。
// 根因是 better-sqlite3 的原生二进制与 Node 的 ABI（NODE_MODULE_VERSION）绑定，
// 构建机是 Node 22（ABI 127），用户机是 Node 24（ABI 137）—— 不兼容。
//
// 本脚本验的是**发布包本身**，不是源码目录：
//   1. 包内必须自带 Node 运行时（runtime\node.exe）—— 用户不该被迫装 Node；
//   2. 随包分发的原生模块必须能被包内运行时加载；
//   3. 用**系统 Node**（版本与构建机不同）去跑随包模块时，
//      必须给出可读的错误，而不是把用户直接甩给堆栈。
//
// 判据用可观测事实：文件是否存在、命令退出码、输出文本。
// 不依赖内部实现。

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = process.env.PKG_DIR || '';
const SYSTEM_NODE = process.env.SYSTEM_NODE || 'C:/Program Files/nodejs/node.exe';

let pass = 0, fail = 0;
const failures = [];

function check(name, ok, detail = '') {
    if (ok) { pass++; console.log(`  ok   ${name}`); }
    else { fail++; failures.push(`${name}${detail ? ' — ' + detail : ''}`); console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`); }
}

if (!PKG) {
    console.error('必须指定 PKG_DIR（发布包解压后的目录）');
    process.exit(2);
}

console.log(`\n发布包运行时兼容性验收`);
console.log(`包目录: ${PKG}\n`);

// ── 1. 内置运行时存在 ──
const runtimeExe = join(PKG, 'runtime', 'node.exe');
check('包内自带 Node 运行时 runtime/node.exe', existsSync(runtimeExe),
    runtimeExe);

if (!existsSync(runtimeExe)) {
    console.log('\n内置运行时缺失，后续检查无法进行。');
    process.exit(1);
}

const exeSize = statSync(runtimeExe).size;
check('node.exe 是完整文件（> 40 MB，非占位）', exeSize > 40 * 1024 * 1024,
    `${(exeSize / 1048576).toFixed(1)} MB`);

// ── 2. 内置运行时能独立运行 ──
const ver = spawnSync(runtimeExe, ['-v'], { encoding: 'utf8' });
check('内置 node.exe 能独立运行', ver.status === 0, (ver.stderr || '').slice(0, 80));
const builtinVersion = (ver.stdout || '').trim();
console.log(`       内置版本: ${builtinVersion}`);

const abi = spawnSync(runtimeExe, ['-p', 'process.versions.modules'], { encoding: 'utf8' });
const builtinAbi = (abi.stdout || '').trim();
console.log(`       内置 ABI: ${builtinAbi}`);

// ── 3. 随包原生模块能被内置运行时加载 ──
// 这是 v0.1.0 真正失败的那一步：模块在，但加载不了。
const loadProbe = join(PKG, 'runtime', 'check.js');
check('包内有运行时自检脚本 runtime/check.js', existsSync(loadProbe));

const checkRun = spawnSync(runtimeExe, [loadProbe], {
    encoding: 'utf8',
    cwd: PKG,
});
const checkOut = ((checkRun.stdout || '') + (checkRun.stderr || '')).trim();
check('内置运行时能加载 better-sqlite3（ABI 匹配）',
    checkRun.status === 0,
    checkOut.split('\n').filter(Boolean).slice(0, 3).join(' | ').slice(0, 200));

if (checkRun.status !== 0) {
    console.log('\n自检输出（用于诊断）:');
    console.log(checkOut);
}

// ── 4. 随包模块的 ABI 与内置运行时一致 ──
// 直接读模块头部的 NODE_MODULE_VERSION 不现实，改为对比：
// 用系统 Node 去 require 随包模块，若 ABI 不同必然失败。
const sysAbi = spawnSync(SYSTEM_NODE, ['-p', 'process.versions.modules'], { encoding: 'utf8' });
if (sysAbi.status === 0) {
    const sysAbiVal = (sysAbi.stdout || '').trim();
    const sysVer = spawnSync(SYSTEM_NODE, ['-v'], { encoding: 'utf8' });
    console.log(`       系统 Node: ${(sysVer.stdout || '').trim()} (ABI ${sysAbiVal})`);

    if (sysAbiVal === builtinAbi) {
        console.log('       （系统 Node 与内置 Node 同 ABI —— 未覆盖跨版本场景）');
    } else {
        // 关键场景：系统 Node 与内置 Node ABI 不同。
        // 此时随包模块**用系统 Node 跑必然失败**，这是预期行为；
        // 但失败信息必须可读（自检脚本会给出明确说明），而不是裸堆栈。
        const sysProbe = spawnSync(SYSTEM_NODE, [loadProbe], {
            encoding: 'utf8',
            cwd: PKG,
        });
        const sysOut = ((sysProbe.stdout || '') + (sysProbe.stderr || '')).trim();

        check('跨 ABI 时自检给出可读提示（而非裸堆栈）',
            sysProbe.status !== 0 && sysOut.includes('NODE_MODULE_VERSION'),
            sysOut.split('\n').filter(Boolean).slice(0, 2).join(' | ').slice(0, 160));

        check('跨 ABI 时提示包含可操作建议',
            sysOut.includes('重新下载') || sysOut.includes('npm install'),
            sysOut.split('\n').filter(Boolean).slice(-2).join(' | ').slice(0, 160));
    }
} else {
    console.log('       （未找到系统 Node，跳过跨 ABI 检查）');
}

// ── 5. 启动脚本指向内置运行时 ──
const startCmd = join(PKG, '启动.cmd');
check('包内有 启动.cmd', existsSync(startCmd));

if (existsSync(startCmd)) {
    const { readFileSync } = await import('node:fs');
    const cmd = readFileSync(startCmd, 'utf8');
    check('启动脚本优先使用 runtime\\node.exe',
        cmd.includes('runtime\\node.exe'),
        '未找到对内置运行时的引用');
    check('启动脚本不再依赖 npm start',
        !cmd.includes('npm start'),
        '仍调用 npm start —— 会因缺 npm 而失败');
    check('启动脚本不再依赖系统 node 必须存在',
        !cmd.includes('where node >nul 2>&1\nif errorlevel 1'),
        '仍有强制的系统 Node 检查');
    check('启动脚本含运行时自检步骤',
        cmd.includes('check.js'),
        '缺少自检');
}

// ── 6. 自检脚本与浏览器脚本存在 ──
check('包内有 runtime/open-browser.js', existsSync(join(PKG, 'runtime', 'open-browser.js')));

const runtimeDir = join(PKG, 'runtime');
if (existsSync(runtimeDir)) {
    const files = readdirSync(runtimeDir);
    console.log(`\nruntime/ 目录内容: ${files.join(', ')}`);
    check('runtime/ 里没有多余的 npm / include / lib（只保留必要文件）',
        !files.includes('node_modules') && !files.includes('include'),
        files.join(', '));
}

// ── 汇总 ──
console.log(`\n${pass}/${pass + fail} 通过`);
if (fail > 0) {
    console.log('\n未通过:');
    failures.forEach((f) => console.log('  - ' + f));
    process.exit(1);
}
