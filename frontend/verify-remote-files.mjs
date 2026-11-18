// 实际本机SFTP/FTP、临时文件与下载目录；不使用真实团队库或服务器。
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { testBrowser, removeBrowserFixture, delay } from './verify-browser.mjs';
const root = fileURLToPath(new URL('..', import.meta.url)), backend = resolve(process.env.VERIFY_BACKEND_ROOT || join(root, 'backend'));
const require = createRequire(join(backend, 'package.json')), express = require('express'), source = path => import(pathToFileURL(join(backend, path)).href);
const { sftpFixture, ftpFixture, fixtureFingerprint } = await source('test-support/remote-files-fixture.mjs'), { createRemoteFilesService } = await source('src/remote-files.js'), { registerRemoteFilesApi } = await source('src/remote-files-api.js');
const { createToolAccess } = await source('src/tool-access.js'), access = createToolAccess({ allowLan: process.env.TT_VERIFY_LAN === '1' });
const temp = await mkdtemp(join(tmpdir(), 'tt-remote-browser-')); await mkdir(join(temp, 'downloads')); await mkdir(join(temp, 'files')); await mkdir(join(root, 'build'), { recursive: true });
const local = join(temp, 'files'); await writeFile(join(local, '上传甲.txt'), 'browser upload 中文'); await writeFile(join(local, '上传乙.bin'), Buffer.from([0, 255, 128])); await writeFile(join(local, '原件.txt'), 'confirmed replacement'); await writeFile(join(local, '大文件.bin'), Buffer.alloc(1024 * 1024, 4));
const ssh = await sftpFixture({ writeDelayMs: 5 }), ftp = await ftpFixture(), service = createRemoteFilesService({ log() {} }), app = express(); registerRemoteFilesApi(app, { service, access });
app.get('/api/documents/tree', (_req, res) => res.json({ items: [] })); app.get('/api/documents', (_req, res) => res.json({ items: [] })); app.use('/api', (_req, res) => res.status(503).json({ message: '隔离服务无团队数据' }));
const dist = resolve(process.env.VERIFY_DIST || join(root, 'frontend/dist')); app.use(express.static(dist, { index: false })); app.get('/{*path}', (_req, res) => res.sendFile(join(dist, 'index.html')));
const address = access.allowLan ? access.addresses()[0] : '127.0.0.1'; assert.ok(address, 'LAN验收需要真实私网IPv4网卡');
const server = await new Promise(done => { const s = app.listen(0, access.allowLan ? '0.0.0.0' : '127.0.0.1', () => done(s)); }), base = `http://${address}:${server.address().port}`;
let browser, count = 0;
const check = (label, value = true) => { assert.ok(value, label); console.log(`PASS ${++count} ${label}`); };
const wait = expression => browser.wait(expression);
const click = selector => browser.click(selector);
const fill = (selector, value) => browser.fill(selector, value);
async function navigate(path) { await browser.send('Page.navigate', { url: base + path }); await wait(path === '/tools' ? '!!document.querySelector(".page-tools")' : '!!document.querySelector("#remote-connect")'); }
async function choose(names) { const doc = await browser.send('DOM.getDocument'), el = await browser.send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '#remote-files' }); await browser.send('DOM.setFileInputFiles', { nodeId: el.nodeId, files: names.map(name => join(local, name)) }); }
async function select(name) { await click(`[data-remote-name="${name}"] input`); }
async function confirm() { await click('#remote-confirm'); await wait('!document.querySelector("#remote-confirm")'); }
async function login(protocol = 'sftp', wrong = false) {
    await browser.select('#remote-protocol', protocol); await fill('#remote-host', '127.0.0.1'); await fill('#remote-port', protocol === 'sftp' ? ssh.port : ftp.port); await fill('#remote-user', 'tester'); await fill('#remote-password', wrong ? 'wrong-fixture-password' : 'fixture-secret');
    await click('#remote-connect'); await wait('!!document.querySelector("#remote-confirm")');
    if (protocol === 'sftp') { check('SFTP先读取实际指纹且未经勾选不能登录', await browser.evaluate(`document.querySelector('#remote-fingerprint').textContent===${JSON.stringify(fixtureFingerprint)}&&document.querySelector('#remote-confirm').disabled`)); await click('#remote-trust'); }
    else check('FTP连接前明确提示明文传输', await browser.evaluate('document.querySelector(".ui-dialog").textContent.includes("明文")'));
    await confirm();
    if (wrong) await wait('!!document.querySelector("[role=alert]")'); else await wait('!!document.querySelector("[data-remote-name=\\"原件.txt\\"]")');
}
async function shot(name) { const result = await browser.send('Page.captureScreenshot', { format: 'png' }); await writeFile(join(root, 'build', 'task070-' + name + '.png'), Buffer.from(result.data, 'base64')); }
try {
    browser = await testBrowser(temp); await browser.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: join(temp, 'downloads') });
    await navigate('/tools'); check('目录同时保留文件共享与新增FTP客户端', await browser.evaluate('!!document.querySelector("[data-tool-id=remote-files]")&&!!document.querySelector("[data-tool-id=file-share]")'));
    await navigate('/tools/remote-files'); check('默认SFTP，未连接禁止远端操作', await browser.evaluate('document.querySelector("#remote-port").value==="22"&&document.querySelector("#remote-upload").disabled&&document.querySelector("#remote-delete").disabled'));
    await click('#remote-help'); await wait('!!document.querySelector(".ui-dialog")'); check('帮助使用body弹窗并说明TLS和关闭行为', await browser.evaluate('document.querySelector(".ui-dialog").closest(".ui-dialog-mask")?.parentElement===document.body&&document.querySelector(".ui-dialog").textContent.includes("后台")'));
    await browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await wait('!document.querySelector(".ui-dialog")');
    await login('sftp', true); check('认证失败明确可见且密码框清空', await browser.evaluate('document.querySelector("[role=alert]").textContent.includes("登录")&&document.querySelector("#remote-password").value===""'));
    await login(); check('真实SFTP目录、连接信息和文件日期展示', await browser.evaluate('document.querySelector("#remote-status").textContent.includes("已连接")&&document.querySelectorAll("[data-remote-name]").length===2'));
    check('密码与会话不进入浏览器存储', await browser.evaluate('![JSON.stringify(localStorage),JSON.stringify(sessionStorage)].some(x=>x.includes("fixture-secret")||x.includes("remote-token"))'));
    await fill('#remote-search', '不存在'); check('远端搜索空状态', await browser.evaluate('document.querySelectorAll("[data-remote-name]").length===0')); await fill('#remote-search', '');
    await click('[data-remote-name="资料"] button'); await wait('!!document.querySelector("[data-remote-name=\\"child.bin\\"]")'); check('进入中文子目录', await browser.evaluate('document.querySelector("#remote-path").value==="/资料"'));
    await fill('#remote-path', '/'); await browser.evaluate('document.querySelector(".remote-path").requestSubmit()'); await wait('!!document.querySelector("[data-remote-name=\\"原件.txt\\"]")');
    await choose(['上传甲.txt', '上传乙.bin']); await click('#remote-upload'); await wait('!!document.querySelector("#remote-confirm")'); check('批量确认列出全部名称和目标且默认不覆盖', await browser.evaluate('document.querySelectorAll(".remote-confirm-files li").length===2&&!document.querySelector("#remote-overwrite").checked')); await confirm(); await wait('document.querySelectorAll(".remote-job[data-state=success]").length===2&&!document.querySelector("#remote-refresh").disabled');
    check('两项上传实际字节一致并清空成功待传文件', ssh.files.get('/上传甲.txt').bytes.toString() === 'browser upload 中文' && ssh.files.get('/上传乙.bin').bytes.equals(Buffer.from([0, 255, 128]))); check('远端保存回执与真实字节展示', await browser.evaluate('document.querySelector(".remote-job").textContent.includes("远端已确认保存")'));
    await choose(['原件.txt']); await click('#remote-upload'); await confirm(); await wait('document.querySelector("[role=alert]")?.textContent.includes("同名")'); check('默认同名保护保留原件并允许重试', ssh.files.get('/原件.txt').bytes.toString() === 'remote original 中文');
    await click('#remote-upload'); await click('#remote-overwrite'); await confirm(); await wait('document.querySelectorAll(".remote-job[data-state=success]").length===3&&!document.querySelector("#remote-refresh").disabled'); check('明确确认覆盖后远端实际替换', ssh.files.get('/原件.txt').bytes.toString() === 'confirmed replacement');
    await select('上传甲.txt'); await click('#remote-download'); await confirm();
    for (let i = 0; i < 100; i++) { const names = await readdir(join(temp, 'downloads')); if (names.includes('上传甲.txt') && !names.some(n => n.endsWith('.crdownload'))) break; await delay(100); }
    check('原生下载仅在临时目录且字节一致', (await readFile(join(temp, 'downloads', '上传甲.txt'), 'utf8')) === 'browser upload 中文');
    await click('#remote-mkdir'); await fill('#remote-edit-name', '新目录'); await confirm(); await wait('!!document.querySelector("[data-remote-name=\\"新目录\\"]")'); check('新建目录真实存在', ssh.files.get('/新目录').directory);
    await select('新目录'); await click('#remote-rename'); await fill('#remote-edit-name', '重命名目录'); await confirm(); await wait('!!document.querySelector("[data-remote-name=\\"重命名目录\\"]")'); check('重命名真实目录', ssh.files.has('/重命名目录') && !ssh.files.has('/新目录'));
    await select('重命名目录'); await click('#remote-delete'); await wait('!!document.querySelector("#remote-confirm")'); check('永久删除明确二次确认', await browser.evaluate('document.querySelector(".ui-dialog").textContent.includes("无法撤销")')); await confirm(); await wait('!document.querySelector("[data-remote-name=\\"重命名目录\\"]")'); check('确认删除仅移除空目录', !ssh.files.has('/重命名目录') && ssh.files.has('/资料/child.bin'));
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false }); await browser.evaluate('document.documentElement.setAttribute("data-theme","light")'); await delay(400);
    check('1280双栏不重叠且列表独立滚动', await browser.evaluate('{const p=[...document.querySelectorAll(".remote-pane")].map(e=>e.getBoundingClientRect());p[0].right<=p[1].left&&p[1].right<=1280&&getComputedStyle(document.querySelector(".remote-list")).overflowY==="auto"}')); await shot('remote-light-1280');
    check('连接栏输入框没有溢出网格单元', await browser.evaluate('[...document.querySelectorAll(".remote-connect .share-field .input")].every(e=>e.getBoundingClientRect().right<=e.parentElement.getBoundingClientRect().right+1)'));
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 1700, height: 1100, deviceScaleFactor: 1, mobile: false }); await browser.evaluate('document.documentElement.setAttribute("data-theme","dark")'); await delay(400); await shot('remote-dark-1700'); check('1700深色双栏保持可操作', await browser.evaluate('!document.querySelector("#remote-mkdir").disabled'));
    await choose(['大文件.bin']); await browser.send('Network.emulateNetworkConditions', { offline: false, latency: 10, downloadThroughput: 200000, uploadThroughput: 12000 }); await click('#remote-upload'); await confirm(); await wait('!!document.querySelector(".remote-job[data-state=transferring]")'); await click('#remote-stop'); await wait('!!document.querySelector(".remote-job[data-state=cancelled]")'); await browser.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    check('传输取消后关闭连接、未发布目标并说明临时文件', !ssh.files.has('/大文件.bin') && await browser.evaluate('document.querySelector("#remote-status").textContent.includes("已断开")&&document.querySelector(".remote-job[data-state=cancelled]").textContent.includes("临时")'));
    await click('#remote-disconnect'); await login(); await navigate('/tools'); await delay(200); check('切换工具卸载并释放真实SSH连接', ssh.clients === 0);
    await navigate('/tools/remote-files'); await login('ftp'); check('FTP浏览器真实目录成功', await browser.evaluate('document.querySelector("#remote-status").textContent.includes("FTP")&&!!document.querySelector("[data-remote-name=\\"原件.txt\\"]")'));
    await browser.evaluate('Object.defineProperty(document,"hidden",{configurable:true,value:true});document.dispatchEvent(new Event("visibilitychange"));'); await wait('!!document.querySelector("#remote-connect")'); check('后台关闭连接并清空密码', await browser.evaluate('document.querySelector("#remote-password").value===""&&document.querySelector("#remote-status").textContent.includes("未连接")'));
    await browser.evaluate('Object.defineProperty(document,"hidden",{configurable:true,value:false});');
    check('页面不请求任何外站', browser.requests.every(url => url.startsWith(base) || url.startsWith('data:') || url.startsWith('blob:'))); check('无浏览器运行异常', browser.errors.length === 0);
    console.log(`${count}/${count} FTP客户端浏览器检查通过`);
} finally { await browser?.close(); await service.dispose(); await new Promise(done => { server.closeAllConnections(); server.close(done); }); await ssh.close(); await ftp.close(); await removeBrowserFixture(temp); }
