// 知识库SOP真实API/数据库浏览器验收，使用独立服务、数据库和浏览器。
import assert from 'node:assert/strict';
import { knowledgeFixture, contrastScript, knowledgeModule } from './verify-knowledge-fixture.mjs';
const { getSopTemplate, saveSopTemplate, listSopTemplates, getSopRun, listSopRuns, changeSopRun } = await import(knowledgeModule('knowledge-sops-store.js'));
import { delay } from './verify-browser.mjs';
let failTemplate = false, failDelete = false, delayDetail = 0;
const f = await knowledgeFixture('tt-sop-browser-', (req, res, next) => {
    if (!req.path.startsWith('/api/knowledge-sops')) return next();
    if (req.method === 'GET' && /\/(templates|runs)\/[^/]+$/.test(req.path) && delayDetail) { const wait = delayDetail; delayDetail = 0; setTimeout(next, wait); return; }
    if (['POST', 'PUT'].includes(req.method) && req.path.includes('/templates') && !req.path.endsWith('/runs') && failTemplate) { failTemplate = false; return res.status(503).json({ message: '验收模板保存失败，请重试' }); }
    if (req.method === 'DELETE' && failDelete) { failDelete = false; return res.status(503).json({ message: '验收删除失败，请重试' }); }
    next();
});
const b = f.browser; let passed = 0;
const check = (name, condition) => { assert.ok(condition, name); console.log(`PASS ${++passed} ${name}`); };
const idle = () => b.wait("!document.querySelector('#sop-new').disabled&&!document.querySelector('.sop-detail [role=status]')");
const noDialog = () => b.wait("!document.querySelector('[role=dialog]')");
const queryId = kind => b.evaluate(`new URL(location.href).searchParams.get('${kind}')`);
async function selectTemplate(id) { await b.click('#sop-templates-tab'); await b.click(`[data-template-id="${id}"]`); await b.wait("!!document.querySelector('#sop-template-title')"); }
async function selectRun(id) { await b.click('#sop-runs-tab'); await b.click(`[data-run-id="${id}"]`); await b.wait("!!document.querySelector('#sop-run-title')"); }
try {
    await f.navigate('/kb', '#kb-sops'); check('知识库提供SOP入口', await b.evaluate("document.querySelector('#kb-sops').textContent.includes('SOP清单')"));
    await b.click('#kb-sops'); await b.wait("!!document.querySelector('.sop-page')&&!document.querySelector('#sop-refresh').disabled");
    check('无记录时提供模板与历史说明', await b.evaluate("document.querySelector('.sop-page').textContent.includes('新增一个模板')&&document.querySelector('.sop-detail').textContent.includes('执行历史')"));
    await b.click('#sop-new'); await b.wait("!!document.querySelector('#sop-name')");
    check('编辑弹窗在body下，包含键盘焦点', await b.evaluate("{const d=document.querySelector('[role=dialog]');d.parentElement.parentElement===document.body&&d.contains(document.activeElement)}"));
    await b.fill('#sop-name', '发布验收清单'); await b.fill('#sop-description', '用于验收的操作说明'); await b.fill('#sop-edit-step-0', '核对版本号');
    await b.click('#sop-add-step'); await b.fill('#sop-edit-step-1', '保存测试报告'); await b.click('#sop-add-step'); await b.fill('#sop-edit-step-2', '核对安装包');
    await b.click('.sop-editor-step:last-child .sop-step-up');
    check('步骤可上移且文字随步骤移动', await b.evaluate("document.querySelectorAll('.sop-edit-step-text')[1].value==='核对安装包'&&document.querySelectorAll('.sop-edit-step-text')[2].value==='保存测试报告'"));
    await b.click('.sop-editor-step:last-child .sop-step-remove'); await b.click('#sop-add-step'); await b.fill('#sop-edit-step-2', '完成备份');
    check('移除步骤后可再添加，至少保留一条', await b.evaluate("document.querySelectorAll('.sop-edit-step-text').length===3"));
    failTemplate = true; await b.click('#sop-editor-save'); await b.wait("document.querySelector('[role=dialog] [role=alert]')?.textContent.includes('保存失败')");
    check('保存失败保留名称、说明和有序步骤', await b.evaluate("document.querySelector('#sop-name').value==='发布验收清单'&&document.querySelector('#sop-description').value==='用于验收的操作说明'&&document.querySelectorAll('.sop-edit-step-text')[1].value==='核对安装包'"));
    await b.click('#sop-editor-save'); await noDialog(); await b.wait("document.querySelector('#sop-template-title')?.textContent==='发布验收清单'"); await idle();
    const templateId = await queryId('template');
    check('模板保存到真实SQLite并保留顺序', JSON.stringify(getSopTemplate(f.db, templateId).steps.map(step => step.text)) === JSON.stringify(['核对版本号', '核对安装包', '完成备份']));
    await b.send('Page.reload', { ignoreCache: true }); await b.wait("!!document.querySelector('#sop-template-title')"); check('刷新恢复所选模板，URL可定位', await queryId('template') === templateId);
    await b.click('#sop-start'); await b.wait("!!document.querySelector('#sop-run-title')&&document.querySelectorAll('.sop-step-check').length===3"); await idle(); const firstId = await queryId('run');
    check('开始执行创建独立记录和0/3进度', listSopRuns(f.db).total === 1 && await b.evaluate("document.querySelector('#sop-progress').textContent.includes('0/3')&&document.querySelector('.sop-detail').textContent.includes('用于验收的操作说明')"));
    check('尚未勾选时不能完成', await b.evaluate("document.querySelector('#sop-complete').disabled"));
    await b.click('.sop-step-check'); await b.wait("document.querySelector('#sop-progress').textContent.includes('1/3')"); await idle();
    check('勾选自动持久化，前端与数据库一致', getSopRun(f.db, firstId).steps[0].done && await b.evaluate("document.querySelector('.sop-step-check').checked"));
    f.reopen(); await b.send('Page.reload', { ignoreCache: true }); await b.wait("document.querySelector('#sop-progress')?.textContent.includes('1/3')");
    check('重开数据库和刷新后可继续未完成记录', getSopRun(f.db, firstId).status === 'active');
    await b.click('.sop-checklist li:nth-child(2) input'); await idle(); await b.click('.sop-checklist li:nth-child(3) input'); await idle();
    await b.fill('#sop-notes', '所有步骤已核对，异常已处理');
    check('备注未保存时阻止结束，避免漏记', await b.evaluate("document.querySelector('#sop-complete').disabled&&!document.querySelector('#sop-save-notes').disabled"));
    await b.click('#sop-save-notes'); await idle(); check('执行备注持久化', getSopRun(f.db, firstId).notes === '所有步骤已核对，异常已处理');
    await b.click('#sop-complete'); await b.wait("!document.querySelector('#sop-complete')&&document.querySelector('#sop-progress').textContent.includes('已完成')"); await idle();
    check('完成后保留时间、步骤和备注并变为只读', getSopRun(f.db, firstId).status === 'completed' && await b.evaluate("[...document.querySelectorAll('.sop-step-check')].every(e=>e.disabled&&e.checked)&&document.querySelector('#sop-notes').readOnly"));
    await selectTemplate(templateId); await b.click('#sop-edit'); await b.wait("!!document.querySelector('#sop-name')"); await b.fill('#sop-name', '本地未保存名称');
    const external = getSopTemplate(f.db, templateId); saveSopTemplate(f.db, { ...external, description: '另一页面更新的说明' }, templateId);
    await b.click('#sop-editor-save'); await b.wait("document.querySelector('[role=dialog] [role=alert]')?.textContent.includes('其他页面')");
    check('模板版本冲突不覆盖新内容，保留编辑草稿', await b.evaluate("document.querySelector('#sop-name').value==='本地未保存名称'") && getSopTemplate(f.db, templateId).name === '发布验收清单');
    await b.click('#sop-editor-cancel'); await b.click('#sop-refresh'); await b.wait("document.querySelector('.sop-detail').textContent.includes('另一页面更新的说明')"); await b.click('#sop-edit');
    await b.fill('#sop-name', '发布验收清单v2'); await b.fill('#sop-description', '新版本操作说明'); await b.click('#sop-add-step'); await b.fill('#sop-edit-step-3', '补充签收'); await b.click('#sop-editor-save'); await noDialog(); await idle();
    check('修改模板后旧执行仍是旧名称、说明和3步', getSopRun(f.db, firstId).templateName === '发布验收清单' && getSopRun(f.db, firstId).description === '用于验收的操作说明' && getSopRun(f.db, firstId).steps.length === 3);
    await b.click('#sop-start'); await b.wait("document.querySelectorAll('.sop-step-check').length===4"); await idle(); const secondId = await queryId('run');
    check('再次执行新建记录，采用新版4步且全部未勾选', secondId !== firstId && listSopRuns(f.db).total === 2 && getSopRun(f.db, secondId).steps.every(step => !step.done));
    const current = getSopRun(f.db, secondId); changeSopRun(f.db, secondId, { version: current.version, stepId: current.steps[0].id, done: true });
    await b.click('.sop-checklist li:nth-child(2) input'); await b.wait("document.querySelector('.sop-page > [role=alert]')?.textContent.includes('其他页面')");
    check('执行版本冲突不覆盖其他页面勾选', getSopRun(f.db, secondId).steps[0].done && !getSopRun(f.db, secondId).steps[1].done);
    await b.click('#sop-refresh'); await b.wait("document.querySelector('#sop-progress')?.textContent.includes('1/4')");
    check('冲突后可刷新读取最新进度', await b.evaluate("document.querySelector('.sop-step-check').checked"));
    await b.fill('#sop-notes', '尚未保存的备注'); await b.evaluate("window.__sopPrompts=[];window.confirm=message=>{window.__sopPrompts.push(message);return false}");
    await b.click('#sop-templates-tab'); await b.click(`[data-template-id="${templateId}"]`); await delay(100);
    check('未保存备注离开前提醒，取消后仍可编辑', await queryId('run') === secondId && await b.evaluate("window.__sopPrompts.length===1&&document.querySelector('#sop-notes').value==='尚未保存的备注'"));
    await b.evaluate('window.confirm=()=>true'); await selectTemplate(templateId);
    await b.click('#sop-delete-template'); await b.click('#sop-delete-cancel'); check('取消删除模板保留数据', listSopTemplates(f.db).length === 1);
    await b.click('#sop-delete-template'); await b.click('#sop-delete-confirm'); await noDialog(); await idle();
    check('确认删除模板保留两次执行历史和快照', listSopTemplates(f.db).length === 0 && listSopRuns(f.db).total === 2 && getSopRun(f.db, firstId).templateId === null && getSopRun(f.db, secondId).templateId === null);
    await selectRun(firstId); check('模板删除后旧完成记录仍可阅读', await b.evaluate("document.querySelector('#sop-run-title').textContent==='发布验收清单'&&document.querySelector('#sop-notes').value==='所有步骤已核对，异常已处理'"));
    await b.click('#sop-delete-run'); await b.click('#sop-delete-cancel'); check('取消删除执行记录保留历史', listSopRuns(f.db).total === 2);
    await b.click('#sop-delete-run'); failDelete = true; await b.click('#sop-delete-confirm'); await b.wait("document.querySelector('[role=dialog] [role=alert]')?.textContent.includes('删除失败')");
    check('删除失败保留记录和确认弹窗', listSopRuns(f.db).total === 2 && await b.evaluate("!!document.querySelector('[role=dialog]')"));
    await b.click('#sop-delete-confirm'); await noDialog(); await idle(); check('重试确认只删除目标记录', listSopRuns(f.db).total === 1 && getSopRun(f.db, secondId).steps.length === 4);
    await b.click('#sop-runs-tab'); await b.select('#sop-status', 'completed'); await b.wait("document.querySelector('.sop-library').textContent.includes('还没有符合条件')"); check('历史可按完成状态筛选', await b.evaluate("document.querySelectorAll('[data-run-id]').length===0"));
    await b.select('#sop-status', 'active'); await b.wait("document.querySelectorAll('[data-run-id]').length===1"); await selectRun(secondId);
    check('已删除模板的未完成记录仍可继续', await b.evaluate("!document.querySelector('.sop-step-check').disabled&&document.querySelector('#sop-progress').textContent.includes('1/4')"));
    for (const theme of ['light', 'dark']) {
        if (await b.evaluate('document.documentElement.dataset.theme') !== theme) await b.click('.theme-toggle'); await b.wait(`document.documentElement.dataset.theme==='${theme}'`); await delay(300);
        for (const width of [1700, 1280]) {
            await b.send('Emulation.setDeviceMetricsOverride', { width, height: 1100, deviceScaleFactor: 1, mobile: false }); await b.evaluate("document.querySelector('.main-content').scrollTop=0");
            check(`${theme}/${width} SOP布局无整体横向溢出`, await b.evaluate("['.main-content','.sop-page','.sop-detail'].every(s=>{const e=document.querySelector(s);return e.scrollWidth<=e.clientWidth+1})"));
            check(`${theme}/${width} 原生筛选菜单对比度至少4.5`, await b.evaluate(contrastScript)); await f.screenshot(`knowledge-sops-${theme}-${width}`);
        }
    }
    await b.click('#sop-new'); await b.wait("!!document.querySelector('[role=dialog]')");
    check('明暗编辑弹窗在视口中且正文可滚动', await b.evaluate("{const d=document.querySelector('[role=dialog]'),r=d.getBoundingClientRect();r.top>=0&&r.bottom<=innerHeight&&getComputedStyle(d).overflowY==='auto'}"));
    await b.evaluate("document.querySelector('[role=dialog]').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))"); await noDialog();
    check('Escape取消草稿不创建模板', listSopTemplates(f.db).length === 0);
    delayDetail = 600; await b.click('#sop-refresh'); await b.click('.ext-back'); await b.wait("!!document.querySelector('.kb-page')"); await delay(700); check('离页取消详情，迟到结果不回填', await b.evaluate("!document.querySelector('.sop-page')"));
    check('SOP正文与记录未写入localStorage', await b.evaluate("!Object.keys(localStorage).some(key=>/sop/.test(key))"));
    check('无脚本异常或外站请求', b.errors.length === 0 && b.requests.every(url => url.startsWith(f.base) || /^(data:|blob:)/.test(url)));
    console.log(`知识库SOP浏览器验收 ${passed}/${passed}`);
} catch (error) { await f.screenshot('knowledge-sops-failure').catch(() => {}); throw error; }
finally { await f.close(); }
