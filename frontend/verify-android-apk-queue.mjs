// 真实Vue/HTTP/流式多APK协议，使用离线ADB与合成APK，不触碰手机或团队数据。
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readdir, readFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createAndroidAdbService, AdbError } from '../backend/src/android-adb.js';
import { registerAndroidApi } from '../backend/src/android-api.js';
import { createToolAccess } from '../backend/src/tool-access.js';
import { apkFixture } from '../backend/test-support/apk-fixture.js';
import { testBrowser, removeBrowserFixture, delay } from './verify-browser.mjs';
const require = createRequire(new URL('../backend/package.json', import.meta.url)), express = require('express');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..'), temporary = await mkdtemp(join(tmpdir(), 'tt-apk-queue-ui-'));
const first = join(temporary, '第一个应用.apk'), second = join(temporary, '第二个应用.apk'), broken = join(temporary, '损坏.apk'), executable = join(temporary, process.platform === 'win32' ? 'adb.exe' : 'adb');
await writeFile(first, apkFixture()); await writeFile(second, apkFixture({ packageName: 'com.example.second' })); await writeFile(broken, 'broken'); await writeFile(executable, 'offline', { mode: 0o700 });
const calls = [], failures = new Set(); let hold = false, active = 0, peak = 0, cancelled = 0, uploads = 0, omitSummary = false;
const service = createAndroidAdbService({ env: {}, configFile: join(temporary, 'settings.json'), apkOptions: { temporaryBase: temporary }, log: () => {}, runner: async (_exe, args, { signal } = {}) => {
    if (args[0] === 'version') return { stdout: 'Android Debug Bridge version 1.0.41', stderr: '' };
    if (args[0] === 'devices') return { stdout: 'PHONE_A device model:测试手机A\nPHONE_B device model:测试手机B\nOFF offline\n', stderr: '' };
    assert.deepEqual(args.slice(2, 4), ['install', '-r']); assert.equal(args.length, 5); calls.push([args[1], basename(args[4])]); peak = Math.max(peak, ++active);
    try {
        while (hold) { if (signal.aborted) { cancelled++; throw new AdbError('cancelled', '已取消', 499); } await delay(10); }
        await delay(20); if (signal.aborted) { cancelled++; throw new AdbError('cancelled', '已取消', 499); }
        return { stdout: failures.has(args[1] + ':' + basename(args[4])) ? 'Failure [INSTALL_FAILED_TEST]' : 'Success\n<script>window.__apkQueueInjected=true</script>', stderr: '' };
    } finally { active--; }
} });
await service.configure(executable);
const app = express(), lan = process.env.TT_VERIFY_LAN === '1', access = createToolAccess({ allowLan: lan }), host = lan ? access.addresses()[0] : '127.0.0.1'; assert.ok(host);
app.use(access.middleware); app.use(express.json());
app.use('/api/android/apk/install-many', (_req, res, next) => { uploads++; if (omitSummary) { const write = res.write.bind(res); res.write = (chunk, ...args) => String(chunk).includes('"type":"complete"') ? true : write(chunk, ...args); } next(); });
registerAndroidApi(app, { service, access });
app.get('/api/documents/tree', (_req, res) => res.json({ items: [] })); app.get('/api/documents', (_req, res) => res.json({ items: [], total: 0 })); app.get('/api/update/status', (_req, res) => res.json({ configured: false }));
app.use(express.static(join(root, 'frontend/dist'), { index: false })); app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(join(root, 'frontend/dist/index.html')));
const server = await new Promise(done => { const s = app.listen(0, lan ? '0.0.0.0' : '127.0.0.1', () => done(s)); }), base = `http://${host}:${server.address().port}`;
let browser, checks = 0; const check = (name, value = true) => { assert.ok(value, name); console.log(`PASS ${++checks} - ${name}`); };
async function idle() { for (let i = 0; i < 200; i++) { if (!active && !(await readdir(temporary)).some(name => name.startsWith('team-toolbox-apk-queue-'))) return; await delay(20); } throw new Error('安装任务未清理'); }
try {
    browser = await testBrowser(temporary); const { send, evaluate, click, wait, select } = browser;
    const choose = async files => { const document = await send('DOM.getDocument'); const node = await send('DOM.querySelector', { nodeId: document.root.nodeId, selector: '#adb-apk-file' }); await send('DOM.setFileInputFiles', { nodeId: node.nodeId, files }); };
    const install = async () => { await click('#adb-apk-install'); await click('#adb-apk-confirm'); };
    await send('Page.navigate', { url: base + '/tools/android-wireless' }); await wait("document.querySelectorAll('#adb-apk-device option').length===3");
    check('安装面板允许多选文件，默认不执行', await evaluate("document.querySelector('#adb-apk-file').multiple && document.querySelector('#adb-apk-install').disabled") && !calls.length);
    await select('#adb-apk-device', 'PHONE_A'); await choose([first, second]); await click('#adb-apk-install');
    check('单设备多APK确认列出全部文件、大小和两项任务', await evaluate("document.querySelector('#adb-apk-confirm-files').children.length===2 && document.querySelector('.adb-apk-confirm').textContent.includes('PHONE_A') && document.querySelector('.adb-apk-confirm').textContent.includes('2 个安装项')") && !calls.length);
    await click('#adb-apk-dismiss'); check('取消确认不上传、不安装', uploads === 0 && calls.length === 0);
    await click('#adb-apk-files li:last-child button'); check('移除单个文件保留另一个并撤销确认', await evaluate("!document.querySelector('#adb-apk-files') && document.querySelector('#adb-apk-selected').textContent.includes('第一个')"));
    await choose([first, second]); await install(); await wait("document.querySelector('#adb-apk-batch-results')?.textContent.includes('成功 2 项，失败 0 项') && !document.querySelector('#adb-refresh').disabled"); await idle();
    check('一台手机按两个APK顺序安装，单次上传', JSON.stringify(calls) === JSON.stringify([['PHONE_A', '0.apk'], ['PHONE_A', '1.apk']]) && peak === 1 && uploads === 1);
    check('逐APK输出纯文本展示，不执行HTML', await evaluate("document.querySelector('#adb-apk-batch-results').textContent.includes('<script>') && !document.querySelector('#adb-apk-batch-results script') && !window.__apkQueueInjected"));
    await click('#adb-apk-batch-mode'); await click('#adb-apk-select-all'); failures.add('PHONE_A:0.apk'); failures.add('PHONE_B:1.apk'); hold = true;
    await click('#adb-apk-install'); check('多设备多APK完整确认四项任务', await evaluate("document.querySelector('#adb-apk-confirm-targets').children.length===2 && document.querySelector('#adb-apk-confirm-files').children.length===2 && document.querySelector('.adb-apk-confirm').textContent.includes('4 个安装项')"));
    await click('#adb-apk-confirm'); await wait("document.querySelectorAll('.adb-apk-result-list [data-status=installing]').length===2");
    check('两台同时安装，每台后续APK等待，选择与刷新锁定', active === 2 && await evaluate("document.querySelectorAll('.adb-apk-result-list [data-status=pending]').length===2 && document.querySelector('#adb-apk-file').disabled && document.querySelector('#adb-refresh').disabled"));
    hold = false; await wait("document.querySelector('#adb-apk-batch-results')?.textContent.includes('成功 2 项，失败 2 项') && !document.querySelector('#adb-refresh').disabled"); await idle();
    check('每项失败独立反馈，继续其他APK和手机', calls.length === 6 && peak === 2 && uploads === 2 && await evaluate("document.querySelectorAll('.adb-apk-result-list [data-status=failed]').length===2 && document.querySelectorAll('.adb-apk-result-list [data-status=success]').length===2"));
    await click('#adb-apk-retry-failed'); await click('#adb-apk-install');
    check('只选择两个失败组合再次确认，不做笛卡尔积', calls.length === 6 && await evaluate("document.querySelector('#adb-apk-confirm-jobs').children.length===2 && document.querySelector('#adb-apk-install').textContent.includes('2 个失败项')"));
    failures.clear(); await click('#adb-apk-confirm'); await wait("document.querySelector('#adb-apk-batch-results')?.textContent.includes('成功 2 项，失败 0 项') && !document.querySelector('#adb-refresh').disabled"); await idle();
    check('重试只执行A的第一个和B的第二个APK', JSON.stringify(calls.slice(6).sort()) === JSON.stringify([['PHONE_A', '0.apk'], ['PHONE_B', '1.apk']]));
    await evaluate("{const dt=new DataTransfer();for(let i=0;i<21;i++)dt.items.add(new File(['x'],i+'.apk'));const input=document.querySelector('#adb-apk-file');input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}));}");
    check('超过20个文件在上传前拒绝', await evaluate("document.querySelector('#adb-apk-error')?.textContent.includes('20') && document.querySelector('#adb-apk-install').disabled"));
    await evaluate("{const dt=new DataTransfer();for(let i=0;i<5;i++){const f=new File(['x'],i+'.apk');Object.defineProperty(f,'size',{value:1024**3});dt.items.add(f);}const input=document.querySelector('#adb-apk-file');input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}));}");
    check('整批超过4GiB在上传前拒绝', await evaluate("document.querySelector('#adb-apk-error')?.textContent.includes('4 GiB') && document.querySelector('#adb-apk-install').disabled"));
    await choose([first, broken]); await install(); await wait("document.querySelector('#adb-apk-error')?.textContent.includes('安装包结构无效') && !document.querySelector('#adb-refresh').disabled"); await idle(); check('后一个APK损坏时全部不安装并清理', calls.length === 8);
    await choose([first, second]); hold = true; await install(); await wait("document.querySelectorAll('.adb-apk-result-list [data-status=installing]').length===2"); const beforeCancel = calls.length; await click('#adb-apk-cancel'); await idle();
    check('取消两台活动安装及后续APK，保留逐项状态', cancelled === 2 && calls.length === beforeCancel && await evaluate("document.querySelectorAll('.adb-apk-result-list [data-status=cancelled]').length===2 && document.querySelectorAll('.adb-apk-result-list [data-status=stopped]').length===2"));
    await install(); await wait("document.querySelectorAll('.adb-apk-result-list [data-status=installing]').length===2"); await evaluate("Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'))"); await idle();
    check('进入后台取消整批安装并阻止迟到回填', cancelled === 4); await evaluate("Object.defineProperty(document,'hidden',{configurable:true,value:false})");
    await install(); await wait("document.querySelectorAll('.adb-apk-result-list [data-status=installing]').length===2"); await click('a[href="/tools"]'); await idle(); check('离页终止全部线程并清理临时包', cancelled === 6);
    hold = false; await send('Page.navigate', { url: base + '/tools/android-wireless' }); await wait("document.querySelectorAll('#adb-apk-device option').length===3");
    check('重新进入不保留旧文件、目标或队列', await evaluate("!document.querySelector('#adb-apk-batch-results') && document.querySelector('#adb-apk-file').files.length===0 && document.querySelector('#adb-apk-device').value===''") );
    await select('#adb-apk-device', 'PHONE_A'); await choose([first, second]); omitSummary = true; await install(); await wait("document.querySelector('#adb-apk-error')?.textContent.includes('完整安装结果') && !document.querySelector('#adb-refresh').disabled");
    check('缺少最终汇总不能声称整批成功，保留已知结果', !await evaluate("!!document.querySelector('#adb-apk-batch-results strong') && document.querySelector('#adb-apk-batch-results strong').textContent.includes('安装结束')"));
    omitSummary = false; await install(); await wait("document.querySelector('#adb-apk-batch-results')?.textContent.includes('成功 2 项，失败 0 项') && !document.querySelector('#adb-refresh').disabled"); check('中断后重新确认可恢复安装', true);
    for (const theme of ['light', 'dark']) { await evaluate(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`); await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false }); await evaluate("document.querySelector('.adb-apk').scrollIntoView()"); await delay(200); check(theme + '文件列表与结果在1280布局可读', await evaluate("[...document.querySelectorAll('.adb-apk,.adb-apk-file-list,.adb-apk-result-list')].every(el=>el.scrollWidth<=el.clientWidth+1)")); await mkdir(join(root, 'build'), { recursive: true }); await writeFile(join(root, `build/apk-queue-${theme}.png`), Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64')); }
    check('没有浏览器异常', browser.errors.length === 0); console.log(`RESULT: ${checks} APK queue checks passed; offline ADB and synthetic APKs only.`);
} finally { service.dispose(); await idle().catch(() => {}); await browser?.close(); server.closeAllConnections(); await new Promise(done => server.close(done)); await removeBrowserFixture(temporary); }
