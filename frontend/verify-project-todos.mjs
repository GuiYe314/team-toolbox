// 项目待办真实 API/SQLite/浏览器验收；使用隔离数据库，不读取团队数据。
import assert from 'node:assert/strict';
import { knowledgeFixture, knowledgeModule } from './verify-knowledge-fixture.mjs';
import { delay } from './verify-browser.mjs';

const { listProjects, listProjectTodos, saveProject, getProject, getTodo, saveTodo, setTodoArchived } = await import(knowledgeModule('project-todos-store.js'));
let failSave = false, failArchive = false, failDelete = false, failList = false, freezeList = false;
const f = await knowledgeFixture('tt-project-todos-browser-', (req, res, next, db) => {
    if (!req.path.startsWith('/api/project-todos')) return next();
    if (req.method === 'GET' && req.path.endsWith('/state')) {
        if (failList) { failList = false; return res.status(503).json({ message: '合成读取失败，请重试' }); }
        if (freezeList) { freezeList = false; const snapshot = listProjectTodos(db, { view: req.query.view || 'active' }); setTimeout(() => { if (!res.destroyed) res.json(snapshot); }, 600); return; }
    }
    if (['POST', 'PUT'].includes(req.method) && failSave) { failSave = false; return res.status(503).json({ message: '合成保存失败，请重试' }); }
    if (req.method === 'PATCH' && failArchive) { failArchive = false; return res.status(503).json({ message: '合成归档失败，请重试' }); }
    if (req.method === 'DELETE' && failDelete) { failDelete = false; return res.status(503).json({ message: '合成删除失败，请重试' }); }
    next();
});
const b = f.browser;
let passed = 0;
const check = (name, value = true) => { assert.ok(value, name); console.log(`PASS ${++passed} ${name}`); };
const ready = () => b.wait("!!document.querySelector('.project-todos-page')&&!document.querySelector('#project-todos-refresh').disabled");
const primaryButtonContrast = `(() => {
    const button = document.querySelector('#project-new');
    if (!button || button.disabled) return false;
    const { color, backgroundColor } = getComputedStyle(button);
    const luminance = rgb => rgb.slice(0, 3).map(value => {
        const channel = value / 255;
        return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
    }).reduce((sum, channel, index) => sum + channel * [.2126, .7152, .0722][index], 0);
    const background = backgroundColor.match(/[\\d.]+/g).map(Number);
    if (background.length === 4 && background[3] < 1) return false;
    const foregroundValue = luminance(color.match(/[\\d.]+/g).map(Number));
    const backgroundValue = luminance(background);
    return (Math.max(foregroundValue, backgroundValue) + .05) / (Math.min(foregroundValue, backgroundValue) + .05) >= 4.5;
})()`;
async function clickText(selector, text) {
    await b.evaluate(`{const root=[...document.querySelectorAll(${JSON.stringify(selector)})].find(el=>el.textContent.trim()===${JSON.stringify(text)});if(!root)throw Error('找不到按钮:'+${JSON.stringify(text)});root.click();}`);
    await delay(70);
}

try {
    await f.navigate('/kb', '#kb-project-todos');
    check('知识库显示项目待办入口', await b.evaluate("document.querySelector('#kb-project-todos').textContent.includes('项目待办')"));
    await b.click('#kb-project-todos'); await ready();
    check('页面按项目与待办两层展示', await b.evaluate("document.querySelector('.project-todos-page').textContent.includes('项目 → 待办')&&!!document.querySelector('[aria-label=项目待办视图]')"));
    await b.evaluate('window.__confirms=[];window.__confirmDecision=true;window.confirm=message=>{window.__confirms.push(message);return window.__confirmDecision}');

    await b.click('#project-new'); await b.wait("!!document.querySelector('#project-name')");
    check('编辑弹窗挂到body且焦点在弹窗内', await b.evaluate("{const d=document.querySelector('[role=dialog]');d.parentElement.parentElement===document.body&&d.contains(document.activeElement)}"));
    await b.fill('#project-name', '浏览器验收项目'); await b.fill('#project-description', '用于验证项目分组');
    failSave = true; await b.click('#project-editor-save'); await b.wait("document.querySelector('[role=dialog] [role=alert]')?.textContent.includes('保存失败')");
    check('项目保存失败保留名称与说明', await b.evaluate("document.querySelector('#project-name').value==='浏览器验收项目'&&document.querySelector('#project-description').value==='用于验证项目分组'") && listProjects(f.db).length === 0);
    await b.click('#project-editor-save'); await b.wait("!document.querySelector('#project-editor-save')"); await ready();
    const project = listProjects(f.db)[0];
    check('新建项目写入隔离SQLite', project?.name === '浏览器验收项目');

    await clickText(`[data-project-id="${project.id}"] .project-group-head .btn`, '新增待办');
    await b.wait("!!document.querySelector('#todo-issue')"); await b.fill('#todo-issue', '检查项目发布'); await b.fill('#todo-details', '确认构建和备份'); await b.click('#todo-editor-save'); await b.wait("!document.querySelector('#todo-editor-save')"); await ready();
    const state = listProjectTodos(f.db, { view: 'active' }), todo = state.projects[0].todos[0];
    check('项目下创建二级待办并显示项目—问题', await b.evaluate("document.querySelector('.project-todo-key').textContent.includes('浏览器验收项目')&&document.querySelector('.project-todo-key').textContent.includes('检查项目发布')") && todo.issue === '检查项目发布');
    const empty = saveProject(f.db, { name: '空项目' });
    await b.click('#project-todos-refresh'); await ready();
    check('进行中保留空项目，非空项目没有直接删除按钮', await b.evaluate(`document.querySelectorAll('.project-group').length===2&&!document.querySelector('[data-project-id="${project.id}"] .project-delete')&&!!document.querySelector('[data-project-id="${empty.id}"] .project-delete')`));

    failArchive = true; await b.click('.project-todo-check'); await b.wait("document.querySelector('.project-todos-page > [role=alert]')?.textContent.includes('归档失败')"); await ready();
    check('归档失败保留提示与未勾选状态', !getTodo(f.db, todo.id).isArchived && await b.evaluate("!document.querySelector('.project-todo-check').checked&&document.querySelector('.project-todos-page > [role=alert]').textContent.includes('归档失败')"));

    await b.click('.project-todo-check'); await b.wait("document.querySelectorAll('.project-todo-row').length===0");
    check('勾选待办后自动从进行中归档', listProjectTodos(f.db, { view: 'active' }).total === 0 && listProjectTodos(f.db, { view: 'archived' }).total === 1);
    await b.click('#project-todos-archived'); await ready(); await b.wait("document.querySelectorAll('.project-todo-row').length===1");
    check('已归档视图只显示有归档条目的项目', await b.evaluate("document.querySelectorAll('.project-group').length===1&&document.querySelector('.project-todo-row').textContent.includes('检查项目发布')"));
    f.reopen(); await b.send('Page.reload', { ignoreCache: true }); await ready();
    await b.evaluate('window.__confirmDecision=true;window.confirm=()=>window.__confirmDecision');
    check('重开数据库和刷新仍保留归档与URL筛选', getTodo(f.db, todo.id).isArchived && await b.evaluate("new URL(location.href).searchParams.get('view')==='archived'&&document.querySelector('.project-todo-check').checked"));
    await b.click('.project-todo-check'); await b.wait("document.querySelectorAll('.project-todo-row').length===0");
    check('取消勾选可恢复待办', listProjectTodos(f.db, { view: 'active' }).total === 1 && listProjectTodos(f.db, { view: 'archived' }).total === 0);
    check('归档恢复后显示空状态而非空项目卡片', await b.evaluate("document.querySelectorAll('.project-group').length===0&&document.querySelector('.project-todos-empty').textContent.includes('还没有归档待办')"));

    await b.click('#project-todos-active'); await ready();
    await clickText(`[data-project-id="${project.id}"] .project-group-head .btn`, '编辑项目'); await b.wait("!!document.querySelector('#project-name')"); await b.fill('#project-name', '浏览器验收项目（已编辑）'); await b.click('#project-editor-save'); await b.wait("!document.querySelector('#project-editor-save')"); await ready();
    check('项目编辑保留待办并更新名称', listProjects(f.db)[0].name === '浏览器验收项目（已编辑）' && await b.evaluate("document.querySelector('.project-todo-key').textContent.includes('浏览器验收项目（已编辑）')"));

    await clickText(`[data-todo-id="${todo.id}"] .btn`, '编辑'); await b.wait("!!document.querySelector('#todo-issue')");
    await b.fill('#todo-issue', '本地待办草稿');
    const latest = getTodo(f.db, todo.id); saveTodo(f.db, todo.id, { version: latest.version, issue: '另一页面已保存', details: '新说明' });
    await b.click('#todo-editor-save'); await b.wait("document.querySelector('[role=dialog] [role=alert]')?.textContent.includes('其他页面')");
    check('待办版本冲突保留草稿且不覆盖他人版本', getTodo(f.db, todo.id).issue === '另一页面已保存' && await b.evaluate("document.querySelector('#todo-issue').value==='本地待办草稿'"));
    await b.evaluate('window.__confirmDecision=false'); await b.click('#todo-editor-cancel');
    check('关闭未保存编辑可取消并保留草稿', await b.evaluate("document.querySelector('#todo-issue')?.value==='本地待办草稿'"));
    check('关闭或刷新页面会保护编辑草稿', await b.evaluate("!window.dispatchEvent(new Event('beforeunload',{cancelable:true}))"));
    await b.click('.ext-back'); await delay(80);
    check('离开页面取消后仍在项目待办', await b.evaluate("!!document.querySelector('.project-todos-page')&&!!document.querySelector('#todo-issue')"));
    await b.evaluate('window.__confirmDecision=true'); await b.click('#todo-editor-cancel'); await b.click('#project-todos-refresh'); await ready();
    await clickText(`[data-todo-id="${todo.id}"] .btn`, '编辑'); await b.fill('#todo-issue', '最终发布检查'); await b.click('#todo-editor-save'); await b.wait("!document.querySelector('#todo-editor-save')"); await ready();
    check('重新读取后可正常编辑待办', getTodo(f.db, todo.id).issue === '最终发布检查');
    failList = true; await b.click('#project-todos-refresh'); await b.wait("document.querySelector('.project-todos-page > [role=alert]')?.textContent.includes('读取失败')");
    check('读取失败保留已有项目和待办', await b.evaluate("document.querySelectorAll('.project-group').length===2&&document.querySelector('.project-todo-key').textContent.includes('最终发布检查')"));
    await b.click('#project-todos-refresh'); await ready();

    const activeTodo = getTodo(f.db, todo.id); setTodoArchived(f.db, todo.id, { version: activeTodo.version, archived: true });
    await b.click('#project-todos-all'); await ready();
    check('全部视图同时保留项目和归档状态', await b.evaluate("document.querySelectorAll('.project-group').length===2&&document.querySelector('.project-todo-check').checked&&document.querySelector('#project-todos-all').getAttribute('aria-pressed')==='true'"));

    for (const theme of ['light', 'dark']) {
        if (await b.evaluate('document.documentElement.dataset.theme') !== theme) await b.click('.theme-toggle');
        await b.wait(`document.documentElement.dataset.theme==='${theme}'`); await delay(220);
        for (const width of [1700, 1280]) {
            await b.send('Emulation.setDeviceMetricsOverride', { width, height: 1100, deviceScaleFactor: 1, mobile: false });
            check(`${theme}/${width} 项目待办无横向溢出`, await b.evaluate("['.main-content','.project-todos-page','.project-group'].every(s=>{const e=document.querySelector(s);return e&&e.scrollWidth<=e.clientWidth+1})"));
            check(`${theme}/${width} 新增项目按钮文字对比度至少 4.5`, await b.evaluate(primaryButtonContrast));
            await f.screenshot(`project-todos-${theme}-${width}`);
        }
    }
    await b.click('.project-todo-delete'); await b.wait("!!document.querySelector('#project-delete-confirm')");
    check('删除确认弹窗在body并明确不可撤销', await b.evaluate("document.querySelector('[role=dialog]').parentElement.parentElement===document.body&&document.querySelector('[role=dialog]').textContent.includes('无法撤销')"));
    await b.click('#project-delete-cancel'); check('取消删除保留归档记录', getTodo(f.db, todo.id).isArchived);
    await b.click('.project-todo-delete'); failDelete = true; await b.click('#project-delete-confirm'); await b.wait("document.querySelector('[role=dialog] [role=alert]')?.textContent.includes('删除失败')");
    check('删除失败保留记录和确认弹窗', getTodo(f.db, todo.id).isArchived && await b.evaluate("!!document.querySelector('#project-delete-confirm')"));
    await b.click('#project-delete-confirm'); await b.wait("!document.querySelector('[role=dialog]')"); await ready();
    check('确认重试后只删除所选待办', listProjectTodos(f.db, { view: 'all' }).total === 0 && listProjects(f.db).length === 2);
    await b.click(`[data-project-id="${empty.id}"] .project-delete`); await b.click('#project-delete-confirm'); await b.wait("!document.querySelector('[role=dialog]')"); await ready();
    check('空项目可确认删除，不影响其他项目', listProjects(f.db).length === 1 && getProject(f.db, project.id).name === '浏览器验收项目（已编辑）');
    freezeList = true; await b.click('#project-todos-active'); await delay(60); await b.click('#project-todos-archived'); await ready(); await delay(650);
    check('较早的列表响应不能覆盖新筛选', await b.evaluate("new URL(location.href).searchParams.get('view')==='archived'&&document.querySelectorAll('.project-group').length===0"));
    freezeList = true; await b.click('#project-todos-refresh'); await delay(60); await b.click('.ext-back'); await b.wait("!!document.querySelector('.kb-page')"); await delay(650);
    check('离页取消读取，迟到结果不会回填且清理草稿保护', await b.evaluate("!document.querySelector('.project-todos-page')&&window.dispatchEvent(new Event('beforeunload',{cancelable:true}))"));
    check('项目待办不写入浏览器localStorage', await b.evaluate("!Object.keys(localStorage).some(key=>/project|todo/i.test(key))"));
    check('没有脚本异常或外站请求', b.errors.length === 0 && b.requests.every(url => url.startsWith(f.base) || /^(data:|blob:)/.test(url)));
    console.log(`项目待办浏览器验收 ${passed}/${passed}`);
} catch (error) {
    await f.screenshot('project-todos-failure').catch(() => {});
    throw error;
} finally {
    await f.close();
}
