// 真实Vue与HTTP + 离线ADB协议/合成文件，不连接真实手机或数据库。
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createAndroidAdbService, AdbError } from '../backend/src/android-adb.js';
import { registerAndroidApi } from '../backend/src/android-api.js';
import { createToolAccess } from '../backend/src/tool-access.js';
import { testBrowser, removeBrowserFixture, delay } from './verify-browser.mjs';
const require = createRequire(new URL('../backend/package.json', import.meta.url)), express = require('express');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..'), temporary = await mkdtemp(join(tmpdir(), 'tt-persistent-ui-'));
const adb = join(temporary, process.platform === 'win32' ? 'adb.exe' : 'adb'); await writeFile(adb, 'offline fixture', { mode: 0o700 });
const source = join(temporary, '新配置.json'); await writeFile(source, '{"level":2}');
const files = new Map([['save.json', Buffer.from('{"level":1}')], ['配置/旧数据.txt', Buffer.from('中文存档\n<script>window.__persistentInjected=true</script>')], ['binary.bin', Buffer.from([0,255,1])]]);
const sha = value => createHash('sha256').update(value).digest('hex');
let hold = '', fail = '', writes = 0, cancelled = 0, waiting = 0, reads = 0, user = '10', serials = ['PHONE', 'SECOND']; const tempFiles = new Map();
function tokenize(command) {
    const result = []; let text = '', quoted = false;
    for (let i = 0; i < command.length; i++) { const char = command[i]; if (char === "'") quoted = !quoted; else if (char === '\\' && !quoted) text += command[++i]; else if (char === ' ' && !quoted) { result.push(text); text = ''; } else text += char; }
    result.push(text); return result;
}
function protocol(command) { const parts = tokenize(command); return { script: parts[2], path: parts[5], args: parts.slice(7) }; }
const service = createAndroidAdbService({ configFile: join(temporary, 'config.json'), env: { ADB_PATH: adb }, log: () => {}, persistentOptions: {
    temporaryBase: temporary,
    binaryReader: async (_exe, args, file) => { const { path } = protocol(args.at(-1)), bytes = files.get(path); await writeFile(file, bytes); reads++; return { size: bytes.length, sha256: sha(bytes) }; }
}, runner: async (_exe, args, options) => {
    if (args[0] === 'devices') return { stdout: serials.map(serial => serial + ' device model:Fixture_Phone').join('\n') };
    if (args.includes('get-current-user')) return { stdout: user };
    if (args.includes('list') && args.includes('packages')) return { stdout: 'package:com.example.unity\npackage:com.other.app' };
    if (args.includes('pm') && args.includes('path')) return { stdout: 'package:/data/app/base.apk' };
    if (args[2] === 'push') { tempFiles.set(args.at(-1).split('/').at(-1), await readFile(args[3])); return { stdout: '1 file pushed' }; }
    if (args[2] === 'shell' && args.length === 4) {
        const { script, path, args: extra } = protocol(args[3]);
        const kind = script.includes('DDP1') ? 'list' : script.includes('DDP2') ? 'inspect' : script.includes('DDP_READY') ? 'prepare' : script.includes('DDP_OK') ? 'commit' : 'cleanup';
        if (hold === kind) { waiting++; try { await new Promise((_, reject) => { const abort = () => { cancelled++; reject(new AdbError('cancelled', 'fixture cancelled', 499)); }; options.signal.addEventListener('abort', abort, { once: true }); if (options.signal.aborted) abort(); }); } finally { waiting--; } }
        if (fail === kind) throw new AdbError('adb_failed', kind === 'commit' ? 'DDP_CONFLICT' : 'DDP_ACCESS');
        if (kind === 'list') {
            const children = new Map();
            for (const [name, bytes] of files) if (!path || name.startsWith(path + '/')) { const relative = path ? name.slice(path.length + 1) : name, part = relative.split('/')[0]; children.set(part, relative.includes('/') ? ['directory', '0:100:1', part] : ['file', `${bytes.length}:100:2`, part]); }
            return { stdout: ['DDP1', ...[...children.values()].flat(), 'END', ''].join('\0') };
        }
        if (kind === 'inspect') { const bytes = files.get(path); if (!bytes) throw new AdbError('adb_failed', 'DDP_ACCESS'); return { stdout: `DDP2\0${bytes.length}:100:2\0${sha(bytes)}\0` }; }
        if (kind === 'prepare') return { stdout: 'DDP_READY' };
        if (kind === 'cleanup') { tempFiles.delete(extra[0]); return { stdout: 'DDP_CLEAN' }; }
        const [temp, mode, expected, uploaded] = extra, bytes = tempFiles.get(temp);
        if (sha(bytes) !== uploaded || (mode === 'replace' ? !files.has(path) || sha(files.get(path)) !== expected : files.has(path))) throw new AdbError('adb_failed', 'DDP_CONFLICT');
        files.set(path, bytes); tempFiles.delete(temp); writes++; return { stdout: 'DDP_OK' };
    }
    // 原有六项命令仅加载目录，不执行设备命令。
    throw new Error('unexpected offline command: ' + args[0]);
} });
const app = express(), lan = process.env.TT_VERIFY_LAN === '1', access = createToolAccess({ allowLan: lan }), pageHost = lan ? access.addresses()[0] : '127.0.0.1';
assert.ok(pageHost); app.use(access.middleware); app.use(express.json()); registerAndroidApi(app, { service, access });
app.get('/api/documents/tree', (_req,res) => res.json({ items: [] })); app.get('/api/documents', (_req,res) => res.json({ items: [], total: 0 })); app.get('/api/update/status', (_req,res) => res.json({ current: '0.3.1', configured: false }));
app.use(express.static(join(root, 'frontend/dist'), { index: false })); app.get(/^(?!\/api\/).*/, (_req,res) => res.sendFile(join(root, 'frontend/dist/index.html')));
const server = await new Promise(resolveListen => { const s = app.listen(0, lan ? '0.0.0.0' : '127.0.0.1', () => resolveListen(s)); });
let browser, checks = 0;
const check = (name, value = true) => { assert.ok(value, name); console.log(`PASS ${++checks} - ${name}`); };
try {
    browser = await testBrowser(temporary); const { send, evaluate, wait, click, select, fill, choose } = browser;
    const base = `http://${pageHost}:${server.address().port}`;
    await send('Page.navigate', { url: base + '/tools/android-wireless' }); await wait("document.querySelector('#adb-refresh') && !document.querySelector('#adb-refresh').disabled");
    check('persistent面板默认不读取设备或应用内容', reads === 0 && !await evaluate("!!document.querySelector('#adb-persistent-path')"));
    await click('#adb-refresh'); await wait("document.querySelectorAll('.adb-devices tbody tr').length===2 || document.querySelectorAll('#adb-persistent-device option').length===3");
    await select('#adb-persistent-device', 'PHONE'); await click('#adb-persistent-apps-refresh'); await wait("document.querySelectorAll('#adb-persistent-app option').length===3");
    await fill('#adb-persistent-search', 'unity'); check('可按包名筛选并选择Unity应用', await evaluate("document.querySelectorAll('#adb-persistent-app option').length===2"));
    await select('#adb-persistent-app', 'com.example.unity'); await click('#adb-persistent-load'); await wait("document.querySelectorAll('[data-persistent-name]').length===3");
    check('显示标准应用目录、当前用户和文件', await evaluate("document.querySelector('#adb-persistent-path').textContent.includes('/storage/emulated/10/Android/data/com.example.unity/files')"));
    await click('[data-persistent-name="配置"] button'); await wait("document.querySelector('[data-persistent-name=\"旧数据.txt\"]')"); check('进入子目录并可返回', await evaluate("!!document.querySelector('#adb-persistent-up')"));
    await click('.persistent-preview'); await wait("document.querySelector('#adb-persistent-preview')?.textContent.includes('中文存档')"); check('UTF8预览以纯文本显示，无脚本注入', !await evaluate('!!window.__persistentInjected'));
    await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: join(temporary, 'downloads'), eventsEnabled: true });
    await click('.persistent-download'); await wait("document.querySelector('#adb-persistent-notice')?.textContent.includes('浏览器下载')");
    for (let i = 0; i < 50 && !(await readdir(join(temporary, 'downloads')).catch(() => [])).includes('旧数据.txt'); i++) await delay(70);
    check('下载字节完整且仅保存用户下载结果', (await readFile(join(temporary, 'downloads/旧数据.txt'))).equals(files.get('配置/旧数据.txt')));
    await click('#adb-persistent-up'); await wait("document.querySelector('[data-persistent-name=\"save.json\"]')");
    await choose('#adb-persistent-file', source); await click('#adb-persistent-prepare'); await wait("document.querySelector('#adb-persistent-confirmation')"); check('添加前需完整确认且不会提前写入', writes === 0 && await evaluate("document.querySelector('#adb-persistent-confirmation').textContent.includes('com.example.unity')"));
    await click('#adb-persistent-dismiss'); check('取消确认不会写入', writes === 0);
    await click('#adb-persistent-prepare'); await click('#adb-persistent-confirm'); await wait("document.querySelector('#adb-persistent-notice')?.textContent.includes('添加成功')"); check('添加上传并刷新当前目录', writes === 1 && files.get('新配置.json').toString() === '{"level":2}');
    await choose('#adb-persistent-file', source); await click('#adb-persistent-prepare'); await wait("document.querySelector('#adb-persistent-error')?.textContent.includes('同名')"); check('添加不覆盖同名文件', writes === 1);
    await click('[data-persistent-name="save.json"] .persistent-replace'); await choose('#adb-persistent-file', source); await click('#adb-persistent-prepare'); await wait("document.querySelector('#adb-persistent-confirmation')");
    check('替换保留原文件名并显示原/新大小与设备', await evaluate("document.querySelector('#adb-persistent-name').readOnly && document.querySelector('#adb-persistent-confirmation').textContent.includes('原文件')"));
    files.set('save.json', Buffer.from('changed meanwhile'));
    await click('#adb-persistent-confirm'); await wait("document.querySelector('#adb-persistent-error')?.textContent.includes('已变化')"); check('原文件变化时拒绝替换且保留新文件供重试', writes === 1 && await evaluate("!document.querySelector('#adb-persistent-prepare').disabled"));
    await click('#adb-persistent-prepare'); await wait("document.querySelector('#adb-persistent-confirmation')"); await click('#adb-persistent-confirm'); await wait("document.querySelector('#adb-persistent-notice')?.textContent.includes('替换成功')"); check('重新核对后成功替换', writes === 2 && files.get('save.json').toString() === '{"level":2}');
    fail = 'list'; await click('#adb-persistent-load'); await wait("document.querySelector('#adb-persistent-error')?.textContent.includes('权限')"); check('权限错误可见，不冒充空目录成功', await evaluate("document.querySelectorAll('[data-persistent-name]').length===4"));
    fail = ''; await click('#adb-persistent-load'); await wait("!document.querySelector('#adb-persistent-progress')"); check('错误后可刷新恢复', !await evaluate("!!document.querySelector('#adb-persistent-error')"));
    hold = 'list'; await click('#adb-persistent-load'); await wait("document.querySelector('#adb-persistent-cancel')"); await click('#adb-persistent-cancel'); await delay(150); check('取消终止ADB等待并恢复按钮', cancelled > 0 && !await evaluate("document.querySelector('#adb-persistent-load').disabled")); hold = '';
    await select('#adb-persistent-device', 'SECOND'); await wait("!document.querySelector('#adb-persistent-path')"); check('切换设备清理目录、预览与待替换文件', !await evaluate("!!document.querySelector('#adb-persistent-app') || !!document.querySelector('#adb-persistent-confirmation')"));
    await click('#adb-persistent-apps-refresh'); await wait("document.querySelector('#adb-persistent-app')"); await select('#adb-persistent-app', 'com.example.unity'); await click('#adb-persistent-load'); await wait("document.querySelector('#adb-persistent-path')");
    hold = 'list'; await click('#adb-persistent-load'); await wait("document.querySelector('#adb-persistent-cancel')"); await evaluate("Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'))"); await delay(150); check('后台取消读取并阻止迟到回填', !await evaluate("!!document.querySelector('#adb-persistent-progress')")); hold = ''; await evaluate("Object.defineProperty(document,'hidden',{configurable:true,value:false})");
    user = '0'; await click('#adb-persistent-load'); await wait("document.querySelector('#adb-persistent-error')?.textContent.includes('用户已切换')"); check('当前用户变化时拒绝访问旧目录', true);
    await click('#adb-persistent-root'); await wait("document.querySelector('#adb-persistent-path')?.textContent.includes('/emulated/0/')"); check('主动重新定位可恢复当前用户目录', true);
    for (const theme of ['light', 'dark']) {
        await evaluate(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`); await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
        await evaluate("document.querySelector('.persistent-panel').scrollIntoView()"); await delay(300);
        check(`${theme} 文件面板下拉可读、1280布局无内部横向溢出`, await evaluate("{const p=document.querySelector('.persistent-panel'),s=getComputedStyle(document.querySelector('#adb-persistent-device'));p.scrollWidth<=p.clientWidth+1 && s.color!==s.backgroundColor;}"));
        await mkdir(join(root, 'build'), { recursive: true }); await writeFile(join(root, `build/persistent-${theme}.png`), Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
    }
    hold = 'list'; await click('#adb-persistent-load'); await wait("document.querySelector('#adb-persistent-cancel')"); for (let i = 0; i < 50 && !waiting; i++) await delay(20); assert.ok(waiting, '服务端已开始等待'); const before = cancelled;
    await click('a[href="/tools"]'); await wait("document.querySelector('.tools-grid')"); for (let i=0;i<100 && waiting;i++) await delay(30); check('离页取消服务端等待、无临时传送残留', cancelled > before && waiting === 0 && tempFiles.size === 0);
    check('无浏览器运行异常', browser.errors.length === 0);
    console.log(`RESULT: ${checks} checks passed; offline ADB only; hardware was not accessed.`);
} catch (error) { if (browser) console.error('PERSISTENT DIAGNOSTICS', await browser.evaluate("JSON.stringify({text:document.querySelector('.persistent-panel')?.innerText,busy:document.querySelector('.adb-page')?.__vueParentComponent?.proxy?.busy,own:document.querySelector('.persistent-panel')?.__vueParentComponent?.proxy?.busy,disabled:document.querySelector('.persistent-panel')?.__vueParentComponent?.proxy?.disabled,revision:document.querySelector('.persistent-panel')?.__vueParentComponent?.proxy?._revision})").catch(() => 'unavailable')); throw error; } finally { service.dispose(); await browser?.close(); server.closeAllConnections(); await new Promise(resolveClose => server.close(resolveClose)); await removeBrowserFixture(temporary); }
