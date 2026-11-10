// Windows 启动集成验收：仅创建临时项目和随机端口，不接触真实数据库或项目服务。
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, open, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { createToolAccess } from '../backend/src/tool-access.js';

if (process.platform !== 'win32') throw new Error('本验收需要 Windows PowerShell 5.1。');
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sandbox = await mkdtemp(join(tmpdir(), 'team-toolbox-startup-'));
const fixtures = [];
let passed = 0;
let invocation = 0;

async function run(exe, args, env = {}) {
    // PowerShell 的后台后代会继承未使用的管道句柄；用文件收集输出，
    // 避免把管道仍打开误判成启动器仍在运行。
    const outputFile = join(sandbox, `launcher-${invocation++}.log`);
    const outputHandle = await open(outputFile, 'w');
    return new Promise((resolveRun, reject) => {
        const child = spawn(exe, args, {
            cwd: sandbox, windowsHide: true, env: { ...process.env, TT_SKIP_BROWSER: '1', ...env },
            windowsVerbatimArguments: exe === 'cmd.exe',
            stdio: ['ignore', outputHandle.fd, outputHandle.fd],
        });
        const timer = setTimeout(() => child.kill(), 60000);
        child.once('error', async error => { clearTimeout(timer); await outputHandle.close(); reject(error); });
        child.once('close', async code => {
            clearTimeout(timer);
            await outputHandle.close();
            resolveRun({ code, output: await readFile(outputFile, 'utf8') });
        });
    });
}

const ps = (file, args = [], env = {}) => run('powershell.exe', [
    '-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', file, ...args,
], env);

async function freePort() {
    const server = createServer();
    await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen));
    const port = server.address().port;
    await new Promise(resolveClose => server.close(resolveClose));
    return port;
}

async function fixture(label, behavior = 'ok') {
    // 空格、中文及 CMD 特殊字符可揭示参数转义和延迟展开问题。
    const root = join(sandbox, `${fixtures.length} 中文 space ! & (${label})`);
    const backendPort = await freePort();
    let frontendPort;
    do { frontendPort = await freePort(); } while (frontendPort === backendPort);
    const item = { root, backendPort, frontendPort };
    fixtures.push(item);
    for (const dir of ['backend/src', 'backend/node_modules', 'frontend/node_modules/vite/bin', 'scripts', 'runtime', 'data']) {
        await mkdir(join(root, dir), { recursive: true });
    }
    for (const name of ['start-services.ps1', 'stop.ps1']) {
        await copyFile(join(repo, 'scripts', name), join(root, 'scripts', name));
    }
    await copyFile(join(repo, 'scripts/release-start.cmd'), join(root, 'launch.cmd'));
    await copyFile(join(repo, 'start.bat'), join(root, 'start.bat'));
    await copyFile(join(repo, 'stop.bat'), join(root, 'stop.bat'));
    await writeFile(join(root, 'data/team-toolbox.sqlite3'), 'not a real database');
    await writeFile(join(root, 'runtime/check.js'), 'console.log("fixture runtime check");');
    await writeFile(join(root, 'backend/src/index.js'), serverSource(behavior, true));
    await writeFile(join(root, 'frontend/node_modules/vite/bin/vite.js'), serverSource('ok', false));
    await writeFile(join(root, 'frontend/node_modules/vite/bin/vite.js.worker.js'), 'setInterval(() => {}, 1000);');
    return item;
}

function serverSource(behavior, backend) {
    return `const http = require('node:http');
const fs = require('node:fs');
const worker = ${backend ? 'null' : "require('node:child_process').spawn(process.execPath, [process.argv[1] + '.worker.js'], {windowsHide:true,stdio:'ignore'})"};
fs.writeFileSync(${JSON.stringify(backend ? '../backend-pid.json' : '../frontend-pid.json')}, JSON.stringify({pid:process.pid, childPid:worker?.pid, host:process.env.HOST, viteHost:process.env.VITE_DEV_HOST, allowLan:process.env.TOOLBOX_ALLOW_LAN, args:process.argv.slice(2), nodeEnv:process.env.NODE_ENV, executable:process.execPath}));
console.log('fixture stdout'); console.error('fixture stderr');
const behavior = ${JSON.stringify(behavior)};
if (behavior === 'exit') { setTimeout(() => process.exit(7), 100); }
else if (behavior === 'never') { setInterval(() => {}, 1000); }
else {
    const since = Date.now();
    http.createServer((req,res) => {
        if (req.url === '/write-logs') { console.log('after launcher exit'); console.error('error after launcher exit'); }
        if (behavior === '503' || (behavior === 'delayed' && Date.now() - since < 1800)) { res.writeHead(503); res.end('waiting'); return; }
        if (behavior === 'invalid') { res.end('not JSON'); return; }
        if (behavior === 'wrong') { res.end(JSON.stringify({status:'ok',service:'different',db:{ok:true}})); return; }
        if (behavior === 'bad-db') { res.end(JSON.stringify({status:'ok',service:'team-toolbox-backend',db:{ok:false}})); return; }
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(${backend ? "{status:'ok',service:'team-toolbox-backend',db:{ok:true}}" : "{frontend:true}"}));
    }).listen(Number(${backend ? 'process.env.PORT' : 'process.env.VITE_DEV_PORT'}), ${backend ? 'process.env.HOST' : 'process.env.VITE_DEV_HOST'});
}
`;
}

function start(item, mode = 'Development', timeout = 8, extra = []) {
    return ps(join(item.root, 'scripts/start-services.ps1'), [
        '-ProjectRoot', item.root, '-NodeExecutable', process.execPath, '-Mode', mode,
        '-BackendPort', String(item.backendPort), '-FrontendPort', String(item.frontendPort),
        '-TimeoutSeconds', String(timeout), '-NoBrowser', ...extra,
    ]);
}

const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
async function pidInfo(item, service) {
    try { return JSON.parse(await readFile(join(item.root, `${service}-pid.json`), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function stopped(item) {
    for (const service of ['backend', 'frontend']) {
        const info = await pidInfo(item, service);
        if (info) assert.equal(alive(info.pid), false, `${service} leaked PID ${info.pid}`);
        if (info?.childPid) assert.equal(alive(info.childPid), false, `${service} leaked worker PID ${info.childPid}`);
    }
}
async function stop(item) {
    const result = await run('cmd.exe', ['/d', '/s', '/c', `""${join(item.root, 'stop.bat')}" /nopause"`]);
    assert.equal(result.code, 0, result.output);
    await delay(100);
    await stopped(item);
}
async function check(name, fn) {
    await fn();
    passed++;
    console.log(`PASS ${name}`);
}

try {
    const first = await fixture('development', 'delayed');
    await check('源码模式等待双服务，控制器退出后服务继续运行', async () => {
        const result = await start(first);
        assert.equal(result.code, 0, result.output);
        assert.match(result.output, /Startup successful/);
        for (const [service, port] of [['backend', first.backendPort], ['frontend', first.frontendPort]]) {
            const info = await pidInfo(first, service);
            assert.ok(info && alive(info.pid));
            assert.equal((await fetch(`http://127.0.0.1:${port}/`)).status, 200);
        }
        assert.equal((await pidInfo(first, 'backend')).host, '0.0.0.0');
        assert.equal((await pidInfo(first, 'backend')).allowLan, '1');
        assert.equal((await pidInfo(first, 'frontend')).viteHost, '0.0.0.0');
        assert.deepEqual((await pidInfo(first, 'frontend')).args, ['--host', '0.0.0.0', '--port', String(first.frontendPort), '--strictPort']);
        assert.match(result.output, /Access mode: Lan/);
        for (const address of createToolAccess({ allowLan: true }).addresses()) {
            assert.ok(result.output.includes(`http://${address}:${first.frontendPort}/`));
            assert.equal((await fetch(`http://${address}:${first.frontendPort}/`)).status, 200);
        }
        await fetch(`http://127.0.0.1:${first.backendPort}/write-logs`);
        await delay(200);
        assert.match(await readFile(join(first.root, 'logs/backend.log'), 'utf8'), /after launcher exit/);
        assert.match(await readFile(join(first.root, 'logs/backend-error.log'), 'utf8'), /error after launcher exit/);
    });

    await check('Local 模式统一回环监听并关闭全部工具的 LAN 开关', async () => {
        const item = await fixture('local');
        const result = await start(item, 'Development', 8, ['-AccessMode', 'Local']);
        assert.equal(result.code, 0, result.output);
        for (const service of ['backend', 'frontend']) {
            const info = await pidInfo(item, service);
            assert.equal(info.host, '127.0.0.1'); assert.equal(info.viteHost, '127.0.0.1'); assert.equal(info.allowLan, '0');
        }
        assert.doesNotMatch(result.output, /LAN access:/);
        await stop(item);
    });

    const release = await fixture('release');
    await check('发布模式只启动生产后端，另一项目不受影响', async () => {
        const result = await start(release, 'Release');
        assert.equal(result.code, 0, result.output);
        assert.equal(await pidInfo(release, 'frontend'), null);
        assert.equal((await pidInfo(release, 'backend')).nodeEnv, 'production');
        await stop(release);
        assert.ok(alive((await pidInfo(first, 'backend')).pid));
    });

    await check('已占用端口拒绝启动，保留原服务和日志', async () => {
        const oldLog = await readFile(join(first.root, 'logs/backend.log'), 'utf8');
        const result = await start(first);
        assert.equal(result.code, 1, result.output);
        assert.match(result.output, /already in use/);
        assert.equal(await readFile(join(first.root, 'logs/backend.log'), 'utf8'), oldLog);
        assert.ok(alive((await pidInfo(first, 'backend')).pid));
    });

    await check('停止入口能关闭本目录的后台双服务', () => stop(first));
    await check('停止入口保留同目录的 Vite build 进程', async () => {
        const item = await fixture('vite-build');
        await writeFile(join(item.root, 'frontend/node_modules/vite/bin/vite.js'), 'setInterval(() => {}, 1000);');
        const build = spawn(process.execPath, [join(item.root, 'frontend/node_modules/vite/bin/vite.js'), 'build'], { windowsHide: true, stdio: 'ignore' });
        const buildExited = new Promise(resolveExit => build.once('exit', resolveExit));
        try {
            await new Promise((resolveSpawn, reject) => { build.once('spawn', resolveSpawn); build.once('error', reject); });
            const result = await ps(join(item.root, 'scripts/stop.ps1'), ['-ProjectRoot', item.root]);
            assert.equal(result.code, 0, result.output); assert.ok(alive(build.pid), 'build was stopped as a service');
        } finally { build.kill(); await buildExited; }
    });
    await check('保留标准输出与错误，重新启动只轮换一份日志', async () => {
        const oldLog = await readFile(join(first.root, 'logs/backend.log'), 'utf8');
        const result = await start(first);
        assert.equal(result.code, 0, result.output);
        assert.equal(await readFile(join(first.root, 'logs/backend.log.previous'), 'utf8'), oldLog);
        assert.match(await readFile(join(first.root, 'logs/backend-error.log'), 'utf8'), /fixture stderr/);
        await stop(first);
    });

    for (const behavior of ['exit', 'never', '503', 'invalid', 'wrong', 'bad-db']) {
        await check(`失败分支 ${behavior} 返回非零、显示诊断并清理本轮子进程`, async () => {
            const item = await fixture(behavior, behavior);
            const result = await start(item, 'Development', 2);
            assert.equal(result.code, 1, result.output);
            assert.match(result.output, /Startup failed/);
            assert.doesNotMatch(result.output, /Startup successful/);
            assert.match(result.output, /fixture (stdout|stderr)/);
            await stopped(item);
        });
    }

    for (const [mode, filename] of [['源码', 'start.bat'], ['发布', 'launch.cmd']]) {
        await check(`${mode} CMD 入口成功退出，支持特殊字符目录及自定义端口`, async () => {
            const item = await fixture(`cmd-${mode}`);
            if (mode === '发布') await copyFile(process.execPath, join(item.root, 'runtime/node.exe'));
            const result = await run('cmd.exe', ['/d', '/s', '/c', `""${join(item.root, filename)}" /nopause"`], {
                PATH: `${dirname(process.execPath)};${process.env.PATH}`,
                PORT: String(item.backendPort), VITE_DEV_PORT: String(item.frontendPort),
            });
            assert.equal(result.code, 0, result.output);
            assert.match(result.output, /Startup successful/);
            assert.equal((await pidInfo(item, 'backend')).allowLan, '1');
            assert.ok(alive((await pidInfo(item, 'backend')).pid));
            assert.equal((await pidInfo(item, 'backend')).executable.toLowerCase(),
                (mode === '发布' ? join(item.root, 'runtime/node.exe') : process.execPath).toLowerCase());
            await stop(item);
            const localResult = await run('cmd.exe', ['/d', '/s', '/c', `""${join(item.root, filename)}" /local"`], {
                PATH: `${dirname(process.execPath)};${process.env.PATH}`, PORT: String(item.backendPort), VITE_DEV_PORT: String(item.frontendPort),
            });
            assert.equal(localResult.code, 0, localResult.output);
            assert.equal((await pidInfo(item, 'backend')).allowLan, '0');
            assert.equal((await pidInfo(item, 'backend')).host, '127.0.0.1');
            await stop(item);
            await rm(join(item.root, 'scripts/start-services.ps1'));
            const missing = await run('cmd.exe', ['/d', '/s', '/c', `""${join(item.root, filename)}" /nopause"`], {
                PATH: `${dirname(process.execPath)};${process.env.PATH}`,
            });
            assert.equal(missing.code, 1, missing.output);
            assert.match(missing.output, /Missing scripts/);
        });
    }

    console.log(`${passed}/${passed} startup integration checks passed`);
} finally {
    // 身份匹配仍由生产 stop.ps1 执行；不能按端口或公共标题清理进程。
    let cleanupFailed = false;
    for (const item of fixtures) {
        try {
            const result = await ps(join(repo, 'scripts/stop.ps1'), ['-ProjectRoot', item.root]);
            assert.equal(result.code, 0, result.output);
            await stopped(item);
        }
        catch (error) { console.error(`临时服务清理失败：${item.root}`, error); process.exitCode = 1; cleanupFailed = true; }
    }
    const boundary = resolve(tmpdir());
    assert.equal(dirname(sandbox), boundary);
    assert.ok(sandbox.startsWith(join(boundary, 'team-toolbox-startup-')));
    if (!cleanupFailed) await rm(sandbox, { recursive: true, force: true });
}
