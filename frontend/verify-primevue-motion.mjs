// PrimeVue + Motion：真实构建/API、临时数据库/浏览器，不读取用户资料或手机。
import assert from 'node:assert/strict';
import { knowledgeFixture, knowledgeModule } from './verify-knowledge-fixture.mjs';
import { delay } from './verify-browser.mjs';
const { createDocument } = await import(knowledgeModule('store.js'));
const { saveEntry, saveMeta, noteMeta } = await import(knowledgeModule('knowledge-workbench-store.js'));
const f = await knowledgeFixture('tt-prime-motion-'), b = f.browser, db = f.db;
let count = 0;
const check = (name, condition) => { assert.ok(condition, name); console.log(`PASS ${++count} ${name}`); };
const target = saveEntry(db, { kind: 'database', name: '关联资料', data: { fields: [], views: [] } });
const database = saveEntry(db, { kind: 'database', name: '控件验收库', data: { fields: [
    { key: 'status', label: '状态', type: 'status', options: ['待办', '完成'] },
    { key: 'tags', label: '多选标签', type: 'multi', options: ['本地', 'Vue', '安卓'] },
    { key: 'related', label: '关联笔记', type: 'relation', target: target.id },
    { key: 'number', label: '数量', type: 'number' }, { key: 'date', label: '日期', type: 'date' },
    { key: 'owner', label: '人员', type: 'person' },
], views: [] } });
const note = createDocument({ connection: db, title: 'PrimeVue 控件验收', content_md: '# 验收正文' });
const linked = createDocument({ connection: db, title: '关联目标一', content_md: '关联资料' });
const linkedTwo = createDocument({ connection: db, title: '关联目标二', content_md: '第二份关联资料' });
saveMeta(db, linked.id, { version: 0, databaseId: target.id, values: {} });
saveMeta(db, linkedTwo.id, { version: 0, databaseId: target.id, values: {} });
saveMeta(db, note.id, { version: 0, databaseId: database.id, values: { status: '待办', tags: ['本地'], related: [linked.id], number: 2, date: '2026-11-17', owner: '原显示名' } });

async function pointer(selector) {
    await b.evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'nearest',inline:'nearest'})`);
    const point = await b.evaluate(`{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();({x:r.x+r.width/2,y:r.y+r.height/2})}`);
    await b.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
    await b.send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point });
    await b.send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point });
}
async function key(key, code = key, virtual = 0, modifiers = 0) {
    await b.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: virtual, modifiers });
    await b.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: virtual, modifiers });
}
async function choose(selector, value) { await b.select(selector, value); }
const option = value => `.ui-choice-overlay [role=option]:has([data-option-value=${JSON.stringify(String(value))}])`;
const property = label => `.kw-properties .ui-choice:has([aria-label=${JSON.stringify(label)}])`;
async function clickText(selector, text) { await b.evaluate(`{const el=[...document.querySelectorAll(${JSON.stringify(selector)})].find(el=>el.textContent.trim()===${JSON.stringify(text)});if(!el)throw Error('按钮不存在');el.click();}`); await delay(50); }
const idle = () => b.wait("!document.querySelector('[data-ui-motion]')");
const contrast = `(() => {
    const l = value => value.match(/[\\d.]+/g).slice(0,3).map(Number).map(v => {v/=255; return v<=.04045?v/12.92:((v+.055)/1.055)**2.4}).reduce((n,v,i)=>n+v*[.2126,.7152,.0722][i],0);
    return [...document.querySelectorAll('.ui-choice-overlay [role=option]')].every(el=>{const s=getComputedStyle(el),a=l(s.color),z=l(s.backgroundColor);return (Math.max(a,z)+.05)/(Math.min(a,z)+.05)>=4.5});
})()`;

try {
    await f.navigate('/tools', '.tool-card'); await idle();
    check('分组卡片实际使用 PrimeVue Select 和 ToggleSwitch', await b.evaluate("document.querySelectorAll('.tool-card [data-pc-name=select]').length>10&&document.querySelectorAll('.tool-group [data-pc-name=toggleswitch]').length===4"));
    for (const theme of ['light', 'dark']) {
        await b.evaluate(`localStorage.setItem('tt-theme',${JSON.stringify(theme)});document.documentElement.dataset.theme=${JSON.stringify(theme)}`);
        await delay(300);
        for (const width of [1700, 1280]) {
            await b.send('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: false });
            const choice = '[data-tool-id=quick-calculation] .ui-choice'; await pointer(choice); await b.wait("!!document.querySelector('.ui-choice-overlay')");
            check(`${theme}/${width} 菜单在 body，位于视口内且不被卡片裁切`, await b.evaluate("{const o=document.querySelector('.ui-choice-overlay'),r=o.getBoundingClientRect();o.parentElement===document.body&&r.left>=0&&r.right<=innerWidth+1&&r.top>=0&&r.bottom<=innerHeight+1;}"));
            check(`${theme}/${width} 未选及选中菜单均达到4.5文字对比度`, await b.evaluate(contrast));
            await key('Escape', 'Escape', 27); await b.wait("!document.querySelector('.ui-choice-overlay')");
            await pointer('#manage-tool-groups'); await b.wait("document.activeElement?.getAttribute('role')==='dialog'");
            check(`${theme}/${width} PrimeVue 弹窗在 body 居中并获得焦点`, await b.evaluate("{const d=document.querySelector('.ui-dialog'),r=d.getBoundingClientRect(),o=d.parentElement.getBoundingClientRect();d.parentElement.parentElement===document.body&&o.x===0&&o.y===0&&Math.abs((r.left+r.right)/2-innerWidth/2)<2&&r.top>=0&&r.bottom<=innerHeight;}"));
            await f.screenshot(`primevue-${theme}-${width}`);
            await b.evaluate("{const a=[...document.querySelectorAll('.ui-dialog button,.ui-dialog input')].filter(el=>!el.disabled&&el.checkVisibility());a.at(-1).focus();}"); await key('Tab', 'Tab', 9);
            check(`${theme}/${width} Tab 焦点被限制在弹窗内`, await b.evaluate("!!document.activeElement.closest('.ui-dialog')"));
            await key('Escape', 'Escape', 27); await b.wait("!document.querySelector('.ui-dialog')");
            check(`${theme}/${width} Escape 关闭并归还入口焦点`, await b.evaluate("document.activeElement.id==='manage-tool-groups'"));
        }
    }
    await b.send('Emulation.setDeviceMetricsOverride', { width: 1700, height: 1000, deviceScaleFactor: 1, mobile: false });
    await pointer('[data-tool-id=quick-calculation] .ui-choice'); await pointer(option('media')); await b.wait("!!document.querySelector('[data-group-id=media] [data-tool-id=quick-calculation]')");
    check('原生鼠标选择分组实际改变归属并保存', await b.evaluate("JSON.parse(localStorage.getItem('team-toolbox-tool-groups-v1')).assignments['quick-calculation']==='media'"));
    await b.evaluate("document.querySelector('#tool-tab-toolbox').focus()");
    await pointer('[data-tool-id=quick-calculation] .tool-card-actions button'); await b.wait("!!document.querySelector('#calc-run')");
    check('路由入场使用 Motion 且没有保留旧工具页', await b.evaluate("!document.querySelector('.page-tools')&&document.querySelector('.main-content[data-ui-motion]')?.getAnimations().some(a=>a.effect.getTiming().duration<=180)"));
    await idle(); check('入场在180ms级别内释放内联透明度和位移', await b.evaluate("document.querySelector('.main-content').style.opacity===''&&document.querySelector('.main-content').style.transform===''"));
    await b.evaluate("document.querySelector('#calc-precision').focus()"); await key('ArrowDown', 'ArrowDown', 40); await b.wait("!!document.querySelector('.ui-choice-overlay')"); await key('End', 'End', 35); await key('Enter', 'Enter', 13); await b.wait("!document.querySelector('.ui-choice-overlay')");
    check('PrimeVue 单选支持方向键、End 和 Enter，数字值未变为字符串', await b.evaluate("document.querySelector('#calc-precision').textContent==='12 位'"));
    await b.click('#calc-run'); await b.wait("document.querySelector('#calc-lower')?.textContent==='27.195000000000'");
    check('新控件参数经过原计算API生成正确精度', await b.evaluate("document.querySelectorAll('.calc-table tbody tr').length===10"));
    await pointer('#tool-tab-toolbox'); await b.wait("!!document.querySelector('.page-tools')"); await idle();
    check('标签指示条对齐当前选中标签且不拦截指针', await b.evaluate("{const i=document.querySelector('.tool-tab-indicator').getBoundingClientRect(),a=document.querySelector('.tool-tab.is-active').getBoundingClientRect();Math.abs(i.left-a.left)<2&&Math.abs(i.width-a.width)<2&&getComputedStyle(document.querySelector('.tool-tab-indicator')).pointerEvents==='none';}"));
    await b.evaluate("document.querySelector('.tool-card').dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:new DataTransfer()}))");
    check('拖动立即结束卡片动效，原拖放状态仍可用', await b.evaluate("!document.querySelector('.tool-card[data-ui-motion]')&&!!document.querySelector('.tool-card.is-dragging')"));
    await b.evaluate("document.querySelector('.tool-card').dispatchEvent(new DragEvent('dragend',{bubbles:true}))");
    await b.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await pointer('[data-tool-id=quick-calculation] .tool-card-actions button'); await b.wait("!!document.querySelector('#calc-run')");
    check('减少动态时路由和标签直接显示最终态', await b.evaluate("!document.querySelector('[data-ui-motion]')&&document.querySelector('.main-content').style.transform===''"));
    await b.send('Emulation.setEmulatedMedia', { features: [] });
    await pointer('#tool-tab-toolbox'); await b.wait("!!document.querySelector('.page-tools')");
    await b.evaluate("Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'))");
    check('进入后台回收所有 Motion 活动状态', await b.evaluate("!document.querySelector('[data-ui-motion]')&&document.querySelector('.main-content').style.opacity===''"));
    await b.evaluate("delete document.hidden;document.dispatchEvent(new Event('visibilitychange'))");
    await f.navigate(`/kb/workbench?note=${note.id}`, '.kw-properties'); await idle();
    await b.click('.kw-note-pane details summary');
    check('阅读状态的属性选择和多选均禁用', await b.evaluate("[...document.querySelectorAll('.kw-properties [role=combobox]')].every(el=>el.disabled||el.getAttribute('aria-disabled')==='true')"));
    await clickText('.kw-note-toolbar button', '编辑');
    await b.evaluate("window.__decisions=[];window.confirm=text=>{window.__decisions.push(text);return false}");
    await choose(property('所属资料库'), '');
    check('拒绝切换资料库保留原选择及全部属性草稿', await b.evaluate("document.querySelector('.kw-properties .ui-choice').textContent.includes('控件验收库')&&document.querySelector('.kw-properties [aria-label=人员]').value==='原显示名'&&window.__decisions.length===1"));
    await choose(property('状态'), '完成');
    await pointer(property('多选标签')); await b.wait("!!document.querySelector('.ui-choice-overlay input')");
    check('搜索输入框有中文可访问名称', await b.evaluate("document.querySelector('.ui-choice-overlay input').getAttribute('aria-label')==='搜索选项'"));
    await b.fill('.ui-choice-overlay input', '不存在的选项'); await b.wait("document.querySelectorAll('.ui-choice-overlay [data-option-value]').length===0");
    check('未命中搜索显示可读的中文空状态', await b.evaluate("[...document.querySelectorAll('.ui-choice-overlay [data-pc-section=emptymessage]')].some(el=>el.checkVisibility()&&el.textContent.includes('没有匹配'))"));
    await b.fill('.ui-choice-overlay input', 'Vue'); await b.wait("document.querySelectorAll('.ui-choice-overlay [data-option-value]').length===1");
    check('多选搜索实际过滤选项，保留已有选择', await b.evaluate("document.querySelector('.ui-choice-overlay').textContent.includes('Vue')&&!document.querySelector('.ui-choice-overlay [data-option-value=安卓]')"));
    await pointer(option('Vue')); await key('Escape', 'Escape', 27); await b.wait("!document.querySelector('.ui-choice-overlay')");
    await pointer(property('关联笔记')); await b.wait("!!document.querySelector('.ui-choice-overlay')"); await pointer(option(linkedTwo.id)); await key('Escape', 'Escape', 27); await b.wait("!document.querySelector('.ui-choice-overlay')");
    await b.fill('.kw-properties [aria-label=人员]', '新显示名');
    await b.click('.kw-save-note'); await b.wait("document.querySelector('.kw-note-pane [role=status]')?.textContent.includes('已保存')");
    const meta = noteMeta(db, note.id);
    check('单选与多选经真实API保存，string/array/number及关联ID类型不变', meta.values.status === '完成' && meta.values.tags.includes('Vue') && meta.values.tags.includes('本地') && meta.values.owner === '新显示名' && meta.values.number === 2 && meta.values.date === '2026-11-17' && meta.values.related[0] === linked.id);
    check('实际选择的关联多选仍为数字ID数组', meta.values.related.length === 2 && meta.values.related.includes(linkedTwo.id) && meta.values.related.every(Number.isInteger));
    await b.evaluate('window.__primeReload=true'); await b.send('Page.reload', { ignoreCache: true }); await b.wait("!window.__primeReload&&!!document.querySelector('.kw-properties [aria-label=人员]')");
    check('刷新从SQLite重新读取属性回显', await b.evaluate("document.querySelector('.kw-properties').textContent.includes('完成')&&document.querySelector('.kw-properties [aria-label=人员]').value==='新显示名'"));
    check('所有依赖及界面请求同源，没有在线主题或字体', b.requests.filter(url => /^https?:/.test(url)).every(url => url.startsWith(f.base + '/')));
    check('无浏览器脚本异常', b.errors.length === 0);
    console.log(`RESULT ${count} PrimeVue/Motion browser checks passed.`);
} catch (error) {
    await f.screenshot('primevue-failure').catch(() => {}); throw error;
} finally { await f.close(); }
