// 真实计算API + SQLite + 隔离浏览器；不使用团队数据库或系统剪贴板。
import assert from 'node:assert/strict';
import { knowledgeFixture, contrastScript, knowledgeModule } from './verify-knowledge-fixture.mjs';
const { listCalculations } = await import(knowledgeModule('quick-calculation-store.js'));
import { delay } from './verify-browser.mjs';

let failSave = false, failDelete = false, failList = false, freezeList = false, delayPreview = 0, previewReads = 0;
const f = await knowledgeFixture('tt-calc-browser-', (req, res, next, db) => {
    if (!req.path.startsWith('/api/quick-calculations')) return next();
    if (req.method === 'POST' && req.path.endsWith('/preview')) { previewReads++; if (delayPreview) { const wait = delayPreview; delayPreview = 0; setTimeout(next, wait); return; } }
    if (req.method === 'GET') {
        if (failList) { failList = false; return res.status(503).json({ message: '验收读取失败，请重试' }); }
        if (freezeList) { freezeList = false; const items = listCalculations(db); setTimeout(() => { if (!res.destroyed) res.json({ items }); }, 600); return; }
    }
    if (req.method === 'POST' && !req.path.endsWith('/preview') && failSave) { failSave = false; return res.status(503).json({ message: '验收保存失败，请重试' }); }
    if (req.method === 'DELETE' && failDelete) { failDelete = false; return res.status(503).json({ message: '验收删除失败，请重试' }); }
    next();
});
const b = f.browser; let passed = 0;
const check = (name, condition) => { assert.ok(condition, name); console.log(`PASS ${++passed} ${name}`); };
const rows = () => b.evaluate("[...document.querySelectorAll('.calc-table tbody tr')].map(row=>[row.querySelector('.calc-down').textContent,row.querySelector('.calc-up').textContent])");
const ready = () => b.wait("!!document.querySelector('#calc-lower')&&!document.querySelector('#calc-run').disabled&&!document.querySelector('#calc-stale')");
async function run() { await b.click('#calc-run'); await ready(); }
async function example() { await b.click('#calc-example'); await ready(); }
try {
    await f.navigate('/tools', '[data-tool-id="quick-calculation"]');
    check('工具分组内有快速计算入口和计算器图标', await b.evaluate("!!document.querySelector('[data-tool-id=quick-calculation] svg')&&document.querySelector('[data-group-id=everyday]').textContent.includes('快速计算')"));
    await b.click('[data-tool-id="quick-calculation"] .tool-card-actions button'); await ready();
    check('默认示例与截图上下限一致', await b.evaluate("document.querySelector('#calc-lower').textContent==='27.195000'&&document.querySelector('#calc-upper').textContent==='28.305000'"));
    const initial = await rows();
    check('两组10个数，截图所有向下数值逐项一致', JSON.stringify(initial.map(row => row[0])) === JSON.stringify(['27.195000', '27.256667', '27.318333', '27.380000', '27.441667', '27.503333', '27.565000', '27.626667', '27.688333', '27.750000']));
    check('向上含基准和上限，基准单元格突出', initial[0][1] === '27.750000' && initial.at(-1)[1] === '28.305000' && await b.evaluate("document.querySelectorAll('.calc-center-value').length===2"));
    await b.fill('#calc-base', '2.58');
    check('参数变化标出旧结果并禁用保存和复制', await b.evaluate("!!document.querySelector('#calc-stale')&&document.querySelector('#calc-save').disabled&&document.querySelector('#calc-copy-all').disabled"));
    await b.fill('#calc-count', '3'); await b.select('#calc-precision', '4'); await run();
    check('自选数量和精度，每组3个、4位小数', JSON.stringify(await rows()) === JSON.stringify([['2.5284', '2.5800'], ['2.5542', '2.6058'], ['2.5800', '2.6316']]));
    const ratioRows = await rows(); await b.select('#calc-rate-mode', 'percent'); await b.fill('#calc-rate', '2'); await run();
    check('百分比2与倍率0.02结果一致', JSON.stringify(await rows()) === JSON.stringify(ratioRows));
    await b.fill('#calc-base', '-2.58'); await run();
    check('负基准上下界顺序正确', await b.evaluate("document.querySelector('#calc-lower').textContent==='-2.6316'&&document.querySelector('#calc-upper').textContent==='-2.5284'"));
    await b.select('#calc-precision', '0'); await run(); check('精度不足时提示重复值', await b.evaluate("!!document.querySelector('#calc-rounding')"));
    await b.fill('#calc-base', '1e3'); await b.click('#calc-run'); await b.wait("document.querySelector('form [role=alert]')?.textContent.includes('科学计数法')");
    check('非法输入明确反馈且保留输入与上次结果', await b.evaluate("document.querySelector('#calc-base').value==='1e3'&&!!document.querySelector('#calc-lower')&&document.querySelector('#calc-save').disabled"));
    await example();
    await b.evaluate("Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.__calcClipboard=text}}})");
    await b.click('#calc-copy-down'); await b.wait("window.__calcClipboard?.startsWith('27.195000')");
    check('复制向下为10行，不触碰系统剪贴板', await b.evaluate("window.__calcClipboard.split('\\n').length===10&&window.__calcClipboard.endsWith('27.750000')"));
    await b.click('#calc-copy-all'); await b.wait("window.__calcClipboard?.includes('向上')");
    check('复制全部带基准、比例与两组数值', await b.evaluate("window.__calcClipboard.includes('上下浮动 2%')&&window.__calcClipboard.includes('28.305000')"));
    await b.fill('#calc-name', '计算验收方案A'); failSave = true; await b.click('#calc-save'); await b.wait("document.querySelector('.calc-stack [role=alert]')?.textContent.includes('保存失败')");
    check('保存失败保留方案名称和结果', await b.evaluate("document.querySelector('#calc-name').value==='计算验收方案A'&&document.querySelector('#calc-lower').textContent==='27.195000'"));
    await b.click('#calc-save'); await b.wait("document.querySelectorAll('[data-calculation-id]').length===1");
    check('保存写入真实临时SQLite', listCalculations(f.db).length === 1 && listCalculations(f.db)[0].base === '27.75');
    await b.click('#calc-save'); await b.wait("document.querySelector('[role=status]')?.textContent.includes('无需重复')"); check('同名同参数重复保存幂等', listCalculations(f.db).length === 1);
    await b.fill('#calc-count', '5'); await run(); await b.click('#calc-save'); await b.wait("document.querySelector('.calc-stack [role=alert]')?.textContent.includes('同名')");
    check('同名不同参数提示另取名，不覆盖旧方案', listCalculations(f.db)[0].count === 10 && await b.evaluate("document.querySelector('#calc-name').value==='计算验收方案A'"));
    await b.fill('#calc-name', '计算验收方案B'); await b.click('#calc-save'); await b.wait("document.querySelectorAll('[data-calculation-id]').length===2");
    await b.fill('#calc-search', '方案A'); check('名称搜索只展示匹配方案', await b.evaluate("document.querySelectorAll('[data-calculation-id]').length===1&&document.querySelector('.calc-saved-name').textContent==='计算验收方案A'"));
    await b.click('.calc-use'); await ready(); check('载入保存参数重新计算', (await rows()).length === 10 && await b.evaluate("document.querySelector('#calc-count').value==='10'"));
    f.reopen(); await b.send('Page.reload', { ignoreCache: true }); await ready(); await b.wait("document.querySelectorAll('[data-calculation-id]').length===2");
    check('关闭重开数据库与刷新网页后方案仍在', listCalculations(f.db).length === 2);
    failList = true; await b.click('#calc-reload'); await b.wait("document.querySelector('.calc-saved [role=alert]')?.textContent.includes('读取失败')"); check('列表读取失败保留已有方案', await b.evaluate("document.querySelectorAll('[data-calculation-id]').length===2"));
    await b.click('#calc-reload'); await b.wait("!document.querySelector('.calc-saved [role=alert]')&&!document.querySelector('#calc-reload').disabled");
    check('列表可刷新恢复', await b.evaluate("document.querySelectorAll('[data-calculation-id]').length===2"));
    freezeList = true; await b.click('#calc-reload'); await b.fill('#calc-name', '计算验收方案C'); await b.click('#calc-save'); await b.wait("document.querySelectorAll('[data-calculation-id]').length===3"); await delay(700);
    check('迟到旧列表不能抹掉新保存记录', await b.evaluate("document.querySelectorAll('[data-calculation-id]').length===3") && listCalculations(f.db).length === 3);
    const prior = previewReads; delayPreview = 600; await b.fill('#calc-base', '10'); await b.click('#calc-run');
    for (let i = 0; i < 40 && previewReads === prior; i++) await delay(20);
    await b.fill('#calc-base', '30'); await run(); await delay(700);
    check('修改输入取消旧计算，迟到结果不能覆盖新结果', await b.evaluate("document.querySelector('#calc-center').textContent==='30.000000'&&document.querySelector('#calc-lower').textContent==='29.400000'"));
    await b.click('.calc-delete'); await b.wait("!!document.querySelector('[role=dialog]')");
    check('删除确认弹窗在body下', await b.evaluate("document.querySelector('[role=dialog]').parentElement.parentElement===document.body"));
    await b.click('#calc-delete-cancel'); check('取消删除保留记录', listCalculations(f.db).length === 3);
    await b.click('.calc-delete'); failDelete = true; await b.click('#calc-delete-confirm'); await b.wait("document.querySelector('[role=dialog] [role=alert]')?.textContent.includes('删除失败')");
    check('删除失败保留记录与确认弹窗', listCalculations(f.db).length === 3 && await b.evaluate("!!document.querySelector('[role=dialog]')"));
    await b.click('#calc-delete-confirm'); await b.wait("!document.querySelector('[role=dialog]')&&document.querySelectorAll('[data-calculation-id]').length===2"); check('确认重试后只删除目标方案', listCalculations(f.db).length === 2);
    await example();
    for (const theme of ['light', 'dark']) {
        if (await b.evaluate('document.documentElement.dataset.theme') !== theme) await b.click('.theme-toggle'); await b.wait(`document.documentElement.dataset.theme==='${theme}'`); await delay(300);
        for (const width of [1700, 1280]) {
            await b.send('Emulation.setDeviceMetricsOverride', { width, height: 1100, deviceScaleFactor: 1, mobile: false });
            await b.evaluate("document.querySelector('.main-content').scrollTop=0");
            check(`${theme}/${width} 页面无整体横向溢出且结果可读`, await b.evaluate("['.main-content','.quick-calculation'].every(s=>{const e=document.querySelector(s);return e.scrollWidth<=e.clientWidth+1})&&getComputedStyle(document.querySelector('.calc-down')).fontVariantNumeric==='tabular-nums'"));
            check(`${theme}/${width} 下拉菜单文字对比度至少4.5`, await b.evaluate(contrastScript));
            await f.screenshot(`quick-calculation-${theme}-${width}`);
        }
    }
    await f.navigate('/kb', '#kb-sops'); await b.click('.kb-io-menu > button'); await b.wait("!!document.querySelector('.kb-io-dropdown')");
    check('备份菜单明示计算方案、SOP和图片范围', await b.evaluate("document.querySelector('.kb-io-dropdown').textContent.includes('计算方案')&&document.querySelector('.kb-io-dropdown').textContent.includes('SOP')&&document.querySelector('.kb-io-dropdown').textContent.includes('不含图片与资源文件')"));
    await f.navigate('/tools/quick-calculation', '.quick-calculation'); await ready(); delayPreview = 600; await b.fill('#calc-base', '50'); await b.click('#calc-run'); await b.click('.ext-back'); await b.wait("!!document.querySelector('.page-tools')"); await delay(700);
    check('离页卸载计算页面，迟到结果不回填', await b.evaluate("!document.querySelector('.quick-calculation')"));
    check('方案未写入浏览器个人偏好', await b.evaluate("!Object.keys(localStorage).some(key=>/calculation|calc-scheme/.test(key))"));
    check('没有脚本异常或外站请求', b.errors.length === 0 && b.requests.every(url => url.startsWith(f.base) || /^(data:|blob:)/.test(url)));
    console.log(`快速计算浏览器验收 ${passed}/${passed}`);
} finally { await f.close(); }
