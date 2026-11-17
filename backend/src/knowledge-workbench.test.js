import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { randomUUID } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { createTestingDatabase } from './db.js';
import { runMigrations } from './migrate.js';
import { createDocument, getDocument, updateDocument, deleteDocument, exportSnapshot, importSnapshot } from './store.js';
import { saveEntry, getEntry, deleteEntry, saveMeta, noteMeta, readNote, createWorkbenchNote, saveWorkbenchNote, revisions, restoreRevision, workbenchState, runAction } from './knowledge-workbench-store.js';
import { publicIPv4, clipTarget, clipWebPage, clipHtml, importMarkdownFiles, markdownExportFiles } from './knowledge-transfer.js';
import { registerKnowledgeWorkbenchApi } from './knowledge-workbench-api.js';
import { saveSopTemplate } from './knowledge-sops-store.js';

async function db(t) { const value=createTestingDatabase({memory:true}); t.after(()=>value.close()); assert.deepEqual((await runMigrations({connection:value})).errors,[]); return value; }
const note=(db,title,content_md='',parent_id=null)=>createDocument({connection:db,title,content_md,parent_id});
const base=(fields=[])=>({kind:'database',name:'资料',data:{fields,views:[{name:'全部',type:'table',filters:[]}]}});
const template=(databaseId=null)=>({kind:'template',name:'日志模板',data:{title:'{{date}} {{title}}',content:'# {{date}}\n\n{{title}}',databaseId,values:{}}});
const bad=action=>assert.throws(action,{code:'invalid_input'});

test('011迁移在旧文档后追加，不改正文，重复迁移不重复建表',async t=>{const d=await db(t);const n=note(d,'原文','# 保留');assert.deepEqual((await runMigrations({connection:d})).errors,[]);assert.equal(getDocument({connection:d,id:n.id}).content_md,'# 保留');});
test('标题、完整路径、id引用、反链、大纲与标题/段落嵌入',async t=>{const d=await db(t),a=note(d,'根'),b=note(d,'目标','## 概要\n\n这是段落 ^p1\n\n## 后续\n\n不嵌入',a.id),c=note(d,'引用',`[[根/目标|别名]]\n\n![[id:${b.id}#概要]]\n\n![[目标#^p1]]`);const rendered=readNote(d,c.id);assert.equal(rendered.outgoing.length,3);assert.match(rendered.html,/data-note-id/);assert.match(rendered.html,/这是段落/);assert.doesNotMatch(rendered.html,/不嵌入/);assert.equal(readNote(d,b.id).backlinks[0].id,c.id);assert.deepEqual(readNote(d,b.id).outline.map(h=>h.id),['h-0','h-1']);});
test('代码中不解析链接；重名不猜测目标；缺失明确显示',async t=>{const d=await db(t);note(d,'同名');const p=note(d,'父');note(d,'同名','',p.id);const n=note(d,'检查','`[[同名]]`\n\n```\n[[缺失]]\n```\n\n[[同名]] 与 [[缺失]]');const result=readNote(d,n.id);assert.equal(result.outgoing.length,2);assert.equal(result.outgoing[0].status,'ambiguous');assert.match(result.html,/重名/);assert.match(result.html,/缺失/);});
test('未链接提及与局部图关系排除回收站笔记',async t=>{const d=await db(t),a=note(d,'苹果笔记'),b=note(d,'提及','苹果笔记是主题'),c=note(d,'反链','[[苹果笔记]]');assert.equal(readNote(d,a.id).mentions[0].id,b.id);deleteDocument({connection:d,id:c.id});assert.equal(readNote(d,a.id).backlinks.length,0);assert.equal(workbenchState(d).notes.length,2);});
test('同步块统一修改，折叠和提示块渲染，脚本被净化',async t=>{const d=await db(t),block=saveEntry(d,{kind:'block',name:'说明',data:{content:'统一正文 <script>alert(1)</script>'}}),n=note(d,'展示',`![[block:${block.id}]]\n\n:::toggle 展开\n隐藏文字\n:::\n\n:::callout 提醒\n内容\n:::`);assert.match(readNote(d,n.id).html,/<details>/);assert.doesNotMatch(readNote(d,n.id).html,/<script>/);saveEntry(d,{name:'说明',data:{content:'更新的统一正文'},version:1},block.id);assert.match(readNote(d,n.id).html,/更新的统一正文/);});
test('互相嵌入不递归，恶意标题不生成事件或脚本地址',async t=>{const d=await db(t);note(d,'A','![[B]]');note(d,'B','![[A]]');const n=note(d,'注入','[[A|<img src=x onerror=alert(1)>]]\n\n[恶意](javascript:alert(1))');const r=readNote(d,n.id);assert.doesNotMatch(r.html,/<img[^>]*onerror=|href="javascript:/);assert.ok(readNote(d,1).html.length<20000);});
test('笔记属性支持全部类型，数字日期多选严格校验',async t=>{const d=await db(t),db1=saveEntry(d,base([{key:'title1',label:'文字',type:'text'},{key:'count',label:'数量',type:'number'},{key:'status',label:'状态',type:'status',options:['待办','完成']},{key:'date',label:'日期',type:'date'},{key:'range',label:'范围',type:'range'},{key:'tags',label:'多选',type:'multi',options:['A','B']},{key:'owner',label:'人员',type:'person'},{key:'done',label:'勾选',type:'check'}])),n=note(d,'资料');const values={title1:'中文',count:3,status:'待办',date:'2026-11-17',range:{start:'2026-11-16',end:'2026-11-18'},tags:['A'],owner:'编辑者',done:true};assert.deepEqual(saveMeta(d,n.id,{version:0,databaseId:db1.id,values}).values,values);for(const change of [{count:'3'},{date:'2026-02-30'},{status:'未知'},{tags:['C']},{done:1},{range:{start:'2026-12-01',end:'2026-11-01'}}])bad(()=>saveMeta(d,n.id,{version:1,databaseId:db1.id,values:{...values,...change}}));});
test('属性和正文乐观锁冲突都保留原数据；原子回滚',async t=>{const d=await db(t),database=saveEntry(d,base()),n=note(d,'原文');saveMeta(d,n.id,{databaseId:database.id,values:{},version:0});assert.throws(()=>saveWorkbenchNote(d,n.id,{version:99,title:'不应保存',meta:{version:1,databaseId:null,values:{}}}),{code:'conflict'});assert.equal(noteMeta(d,n.id).databaseId,database.id);assert.equal(getDocument({connection:d,id:n.id}).title,'原文');assert.throws(()=>saveMeta(d,n.id,{version:0,databaseId:null,values:{}}),{code:'conflict'});});

test('属性总量包含资料库引用；上限内保存后可完整备份恢复，超限不写入', async t => {
    const source = await db(t), target = await db(t);
    const fields = Array.from({ length: 17 }, (_, index) => ({ key: `f${index}`, type: 'text', label: `字段${index}` }));
    const database = saveEntry(source, base(fields)), n = note(source, '属性大小边界');
    const values = Object.fromEntries(fields.map((field, index) => [field.key, index < 16 ? 'x'.repeat(1000) : '']));
    values.f16 = 'x'.repeat(16380 - Buffer.byteLength(JSON.stringify(values)));
    const totalSize = () => Buffer.byteLength(JSON.stringify({ databaseId: database.id, values }));
    assert.ok(Buffer.byteLength(JSON.stringify(values)) <= 16384 && totalSize() > 16384);
    bad(() => saveMeta(source, n.id, { version: 0, databaseId: database.id, values }));
    assert.equal(noteMeta(source, n.id).version, 0);
    values.f16 = values.f16.slice(0, values.f16.length - (totalSize() - 16384));
    assert.equal(totalSize(), 16384);
    saveMeta(source, n.id, { version: 0, databaseId: database.id, values });
    importSnapshot({ connection: target, snapshot: exportSnapshot({ connection: source }) });
    const restored = target.prepare('SELECT id FROM documents WHERE title=?').get('属性大小边界');
    assert.deepEqual(noteMeta(target, restored.id).values, values);
});
test('关联只能选择目标资料库内的有效笔记，汇总为只读',async t=>{const d=await db(t),target=saveEntry(d,base([{key:'count',type:'number',label:'数量'}])),source=saveEntry(d,base([{key:'related',type:'relation',label:'关联',target:target.id},{key:'total',type:'rollup',label:'合计',relation:'related',field:'count',aggregate:'sum'}])),a=note(d,'目标'),b=note(d,'源'),outside=note(d,'外部');saveMeta(d,a.id,{databaseId:target.id,values:{count:5},version:0});saveMeta(d,b.id,{databaseId:source.id,values:{related:[a.id]},version:0});bad(()=>saveMeta(d,b.id,{databaseId:source.id,values:{related:[outside.id]},version:1}));bad(()=>saveMeta(d,b.id,{databaseId:source.id,values:{total:3},version:1}));});
test('保存视图完整往返；有值字段禁止删除或改类型；资料库引用删除保护',async t=>{const d=await db(t),database=saveEntry(d,base([{key:'count',type:'number',label:'数量'}])),n=note(d,'资料');saveMeta(d,n.id,{version:0,databaseId:database.id,values:{count:5}});bad(()=>saveEntry(d,{name:'资料',version:1,data:{fields:[],views:[]}},database.id));bad(()=>deleteEntry(d,database.id,1));const views=['table','board','gallery','calendar','timeline'].map(type=>({name:type,type,sort:'count',direction:'desc',filters:[{field:'count',op:'equals',value:'5'}]}));saveEntry(d,{name:'资料',version:1,data:{...database.data,views}},database.id);assert.equal(getEntry(d,database.id).data.views.length,5);});
test('模板变量替换、资料库默认属性与每日笔记幂等',async t=>{const d=await db(t),database=saveEntry(d,base()),temp=saveEntry(d,template(database.id));const a=createWorkbenchNote(d,{templateId:temp.id,daily:true,day:'2026-11-17'}),b=createWorkbenchNote(d,{templateId:temp.id,daily:true,day:'2026-11-17'});assert.equal(a.id,b.id);assert.equal(b.reused,true);assert.match(readNote(d,a.id).content_md,/2026-11-17/);assert.equal(noteMeta(d,a.id).databaseId,database.id);deleteDocument({connection:d,id:a.id});assert.throws(()=>createWorkbenchNote(d,{daily:true,day:'2026-11-17'}),{code:'not_found'});});
test('画布节点/连接、工作区与书签在服务端保存，删除不删原文',async t=>{const d=await db(t),n=note(d,'画布笔记'),a=randomUUID(),b=randomUUID(),canvas=saveEntry(d,{kind:'canvas',name:'画布',data:{nodes:[{id:a,type:'note',docId:n.id,x:0,y:0},{id:b,type:'text',text:'观点',x:500,y:400}],edges:[{from:a,to:b}]}}),workspace=saveEntry(d,{kind:'workspace',name:'布局',data:{tabs:[n.id],active:n.id,secondary:null,split:false,bookmarks:[n.id]}});assert.equal(getEntry(d,workspace.id).data.bookmarks[0],n.id);deleteEntry(d,canvas.id,1);assert.ok(readNote(d,n.id));bad(()=>saveEntry(d,{kind:'canvas',name:'错',data:{nodes:[],edges:[{from:a,to:b}]}}));});
test('评论按笔记隔离，版本冲突与回收站隐藏',async t=>{const d=await db(t),n=note(d,'评论页'),item=saveEntry(d,{kind:'comment',name:'评论',data:{docId:n.id,author:'测试显示名',content:'建议'}});assert.throws(()=>deleteEntry(d,item.id,2),{code:'conflict'});deleteDocument({connection:d,id:n.id});assert.equal(workbenchState(d).entries.filter(e=>e.kind==='comment').length,0);assert.throws(()=>saveEntry(d,{kind:'comment',name:'评论',data:{docId:n.id,author:'A',content:'B'}}),{code:'not_found'});});
test('旧编辑器保存同样有历史，恢复递增版本且保留当前标签和分类',async t=>{const d=await db(t),n=note(d,'第一版','正文1');updateDocument({connection:d,id:n.id,version:1,title:'第二版',content_md:'正文2',tags:['保留']});const history=revisions(d,n.id);assert.equal(history[0].title,'第一版');restoreRevision(d,n.id,{revisionId:history[0].id,version:2});const current=readNote(d,n.id);assert.equal(current.version,3);assert.equal(current.content_md,'正文1');assert.deepEqual(current.tags,['保留']);assert.equal(revisions(d,n.id).length,2);});
test('历史每篇只保留20次；旧版本恢复要求乐观锁',async t=>{const d=await db(t),n=note(d,'历史','0');for(let version=1;version<=30;version++)updateDocument({connection:d,id:n.id,version,content_md:String(version)});assert.equal(revisions(d,n.id).length,20);assert.throws(()=>restoreRevision(d,n.id,{revisionId:revisions(d,n.id)[0].id,version:1}),{code:'conflict'});});
test('手动按钮从模板新建幂等，SOP按钮生成独立执行记录',async t=>{const d=await db(t),temp=saveEntry(d,template()),action=saveEntry(d,{kind:'action',name:'新建',data:{trigger:'manual',action:'create-note',databaseId:null,templateId:temp.id}}),requestId=randomUUID();const a=runAction(d,action.id,{version:1,requestId}),b=runAction(d,action.id,{version:1,requestId});assert.equal(a.noteId,b.noteId);const sop=saveSopTemplate(d,{name:'流程',description:'',steps:[{id:randomUUID(),text:'核对'}]}),button=saveEntry(d,{kind:'action',name:'开始流程',data:{trigger:'manual',action:'start-sop',sopId:sop.id,databaseId:null}});assert.ok(runAction(d,button.id,{version:1,requestId:randomUUID()}).runId);});
test('事件自动化只执行一轮，不递归；失败回滚整个笔记保存',async t=>{const d=await db(t),database=saveEntry(d,base([{key:'status',type:'status',label:'状态',options:['新建','完成']}]));saveEntry(d,{kind:'action',name:'标记完成',data:{trigger:'note-created',action:'set-property',databaseId:database.id,field:'status',value:'完成'}});const n=createWorkbenchNote(d,{title:'新资料',databaseId:database.id});assert.equal(noteMeta(d,n.id).values.status,'完成');const broken=saveEntry(d,{kind:'action',name:'错误动作',data:{trigger:'property-changed',action:'set-property',databaseId:database.id,field:'status',value:'完成'}});d.prepare('UPDATE kb_entries SET data=? WHERE id=?').run(JSON.stringify({...broken.data,field:'missing'}),broken.id);bad(()=>saveWorkbenchNote(d,n.id,{version:1,title:'不可保存',meta:{...noteMeta(d,n.id),values:{status:'新建'}}}));assert.equal(readNote(d,n.id).title,'新资料');assert.equal(noteMeta(d,n.id).values.status,'完成');});
test('Markdown文件夹导入层级/父页正文/重导不覆盖；路径越界整批拒绝',async t=>{const d=await db(t),files=[{path:'主题/子页.md',content:'子正文'},{path:'主题.md',content:'父正文'}];assert.equal(importMarkdownFiles(d,{files}).imported,2);assert.equal(importMarkdownFiles(d,{files:[{path:'主题.md',content:'不覆盖'}]}).skipped,1);assert.equal(d.prepare('SELECT content_md FROM documents WHERE title=?').get('主题').content_md,'父正文');assert.deepEqual(markdownExportFiles(d).map(f=>f.path),['主题.md','主题/子页.md']);bad(()=>importMarkdownFiles(d,{files:[{path:'安全.md',content:'安全'},{path:'../越界.md',content:'拒绝'}]}));assert.equal(d.prepare('SELECT COUNT(*) n FROM documents').get().n,2);});
test('公开地址校验拒绝内网、IPv6、凭据、端口和混合DNS',async()=>{for(const ip of ['127.0.0.1','10.0.0.1','172.16.0.1','192.168.1.1','100.64.0.1','169.254.169.254','::1','198.18.0.1','203.0.113.1'])assert.equal(publicIPv4(ip),false);assert.ok(publicIPv4('8.8.8.8'));for(const url of ['http://example.com','https://user:pass@example.com','https://example.com:8080','https://127.0.0.1','https://[::1]'])await assert.rejects(clipTarget(url),{code:'invalid_input'});await assert.rejects(clipTarget('https://example.com',async()=>[{address:'8.8.8.8'},{address:'127.0.0.1'}]),{code:'invalid_input'});});
test('剪藏DNS固定、每跳验证、去脚本/导航，断连信号可取消',async()=>{let receives=0;const resolver=async()=>[{address:'8.8.8.8'}];const value=await clipWebPage('https://example.com',{resolver,receiver:async target=>{assert.equal(target.address,'8.8.8.8');receives++;return{html:'<title>测试网页</title><nav>导航</nav><h1>主题</h1><p>正文</p><script>evil()</script>'};}});assert.equal(value.title,'测试网页');assert.doesNotMatch(value.content_md,/evil|导航/);assert.equal(receives,1);await assert.rejects(clipWebPage('https://example.com',{resolver,receiver:async()=>({redirect:'https://127.0.0.1'})}),{code:'invalid_input'});const controller=new AbortController();controller.abort();await assert.rejects(clipWebPage('https://example.com',{resolver,signal:controller.signal}));assert.match(clipHtml('<p>中文</p>','https://example.com').content_md,/中文/);});
test('新旧内容备份兼容，属性/评论/画布引用映射且重复导入不覆盖',async t=>{const a=await db(t),b=await db(t),database=saveEntry(a,base([{key:'n',label:'数量',type:'number'}])),n=note(a,'资料','正文');saveMeta(a,n.id,{version:0,databaseId:database.id,values:{n:2}});saveEntry(a,{kind:'comment',name:'评论',data:{docId:n.id,author:'A',content:'注释'}});updateDocument({connection:a,id:n.id,version:1,content_md:'更新'});const snapshot=exportSnapshot({connection:a});note(b,'占位');importSnapshot({connection:b,snapshot});const imported=b.prepare('SELECT id FROM documents WHERE title=?').get('资料');assert.equal(noteMeta(b,imported.id).values.n,2);assert.equal(workbenchState(b).entries.find(e=>e.kind==='comment').data.docId,imported.id);assert.equal(revisions(b,imported.id).length,1);importSnapshot({connection:b,snapshot});assert.equal(b.prepare('SELECT COUNT(*) n FROM kb_note_meta').get().n,1);assert.ok(importSnapshot({connection:b,snapshot:{version:1,documents:[{title:'旧备份'}]}}));});
test('损坏工作台备份在任何文档写入前被拒绝',async t=>{const d=await db(t);bad(()=>importSnapshot({connection:d,snapshot:{documents:[{title:'不可导入'}],workbench:{entries:[{id:randomUUID(),kind:'shell',name:'非法',data:{},version:1}],meta:[],revisions:[],daily:[]}}}));assert.equal(d.prepare('SELECT COUNT(*) n FROM documents').get().n,0);});

test('跨库恢复显式笔记链接、历史、模板默认关联及按钮值均重映射', async t => {
    const a = await db(t), b = await db(t);
    const target = saveEntry(a, base([{ key: 'amount', type: 'number', label: '数字' }]));
    const source = saveEntry(a, base([{ key: 'related', type: 'relation', label: '关联', target: target.id }]));
    const first = note(a, '被引用页'), second = note(a, '引用页', `[[id:${first.id}]]\n\n\`[[id:${first.id}]]\``);
    saveMeta(a, first.id, { version: 0, databaseId: target.id, values: { amount: 3 } });
    saveMeta(a, second.id, { version: 0, databaseId: source.id, values: { related: [first.id] } });
    const temp = saveEntry(a, { ...template(source.id), data: { ...template(source.id).data, content: `![[id:${first.id}]]`, values: { related: [first.id] } } });
    const action = saveEntry(a, { kind: 'action', name: '关联按钮', data: { action: 'set-property', trigger: 'manual', databaseId: source.id, field: 'related', value: [first.id] } });
    updateDocument({ connection: a, id: second.id, version: 1, content_md: `更新\n\n[[id:${first.id}]]` });
    const snapshot = exportSnapshot({ connection: a });
    note(b, '占位1'); note(b, '占位2');
    importSnapshot({ connection: b, snapshot });
    const mapped = b.prepare('SELECT id FROM documents WHERE title=?').get('被引用页').id;
    const mappedSecond = b.prepare('SELECT id FROM documents WHERE title=?').get('引用页').id;
    assert.notEqual(mapped, first.id);
    assert.deepEqual(noteMeta(b, mappedSecond).values.related, [mapped]);
    assert.deepEqual(getEntry(b, temp.id).data.values.related, [mapped]);
    assert.deepEqual(getEntry(b, action.id).data.value, [mapped]);
    assert.equal(getEntry(b, temp.id).data.content, `![[id:${mapped}]]`);
    assert.match(readNote(b, mappedSecond).content_md, new RegExp(`id:${mapped}`));
    assert.match(revisions(b, mappedSecond)[0].content_md, new RegExp(`^\\[\\[id:${mapped}\\]\\]`));
    assert.match(revisions(b, mappedSecond)[0].content_md, new RegExp('`\\[\\[id:' + first.id + '\\]\\]`'));
    assert.equal(revisions(b, mappedSecond).length, 1, '导入修正不制造虚假历史');
    assert.equal(createWorkbenchNote(b, { templateId: temp.id }).id > 0, true);
});

test('备份依赖损坏整体回滚分类及文档；回收站评论不能凭ID读取', async t => {
    const a = await db(t), b = await db(t), n = note(a, '回收页');
    const comment = saveEntry(a, { kind: 'comment', name: '评论', data: { docId: n.id, author: '显示名', content: '内容' } });
    deleteDocument({ connection: a, id: n.id });
    assert.throws(() => getEntry(a, comment.id), { code: 'not_found' });
    importSnapshot({ connection: b, snapshot: exportSnapshot({ connection: a }) });
    assert.equal(workbenchState(b).entries.filter(e => e.kind === 'comment').length, 0);
    const broken = exportSnapshot({ connection: a });
    broken.categories.push({ name: '不应残留' });
    broken.workbench.entries.push({ id: randomUUID(), kind: 'template', name: '坏依赖', version: 1, data: { ...template().data, databaseId: randomUUID() } });
    assert.throws(() => importSnapshot({ connection: b, snapshot: broken }));
    assert.equal(b.prepare('SELECT COUNT(*) n FROM categories WHERE name=?').get('不应残留').n, 0);
    assert.equal(b.prepare('SELECT COUNT(*) n FROM documents').get().n, 1);
});

test('畸形属性请求明确拒绝，未改变属性不触发自动化', async t => {
    const d = await db(t), database = saveEntry(d, base([{ key: 'count', label: '数量', type: 'number' }]));
    const n = createWorkbenchNote(d, { title: '属性页', databaseId: database.id });
    const temp = saveEntry(d, template());
    saveEntry(d, { kind: 'action', name: '属性变化创建', data: { trigger: 'property-changed', action: 'create-note', databaseId: database.id, templateId: temp.id } });
    bad(() => saveWorkbenchNote(d, n.id, { version: 1, meta: { version: 1 } }));
    saveWorkbenchNote(d, n.id, { version: 1, content_md: '只改正文', meta: noteMeta(d, n.id) });
    assert.equal(d.prepare('SELECT COUNT(*) n FROM documents').get().n, 1);
    saveWorkbenchNote(d, n.id, { version: 2, meta: { ...noteMeta(d, n.id), values: { count: 2 } } });
    assert.equal(d.prepare('SELECT COUNT(*) n FROM documents').get().n, 2);
});

test('汇总只接受目标数字属性，模板默认值与按钮关联也检查目标', async t => {
    const d = await db(t), target = saveEntry(d, base([{ key: 'amount', type: 'number', label: '数字' }]));
    const relation = { key: 'related', type: 'relation', label: '关联', target: target.id };
    bad(() => saveEntry(d, base([relation, { key: 'total', type: 'rollup', label: '汇总', relation: 'related', aggregate: 'sum', field: 'missing' }])));
    const source = saveEntry(d, base([relation])), outside = note(d, '外部');
    bad(() => saveEntry(d, { ...template(source.id), data: { ...template(source.id).data, values: { related: [outside.id] } } }));
    bad(() => saveEntry(d, { kind: 'action', name: '错误关联', data: { action: 'set-property', trigger: 'manual', databaseId: source.id, field: 'related', value: [outside.id] } }));
});
test('API专用头、同源、方法、确认、JSON大小和错误净化',async t=>{const d=await db(t),app=express(),logs=[];registerKnowledgeWorkbenchApi(app,{getDb:()=>d,log:value=>logs.push(value)});const server=await new Promise(done=>{const listener=app.listen(0,'127.0.0.1',()=>done(listener));});t.after(()=>new Promise(done=>{server.closeAllConnections();server.close(done);}));const port=server.address().port;
const request=(path,{method='GET',body,headers={}}={})=>new Promise((resolve,reject)=>{const req=httpRequest({host:'127.0.0.1',port,path:'/api/knowledge-workbench'+path,method,headers:{'X-Toolbox-Knowledge':'1','Content-Type':'application/json',...headers}},res=>{const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>resolve({status:res.statusCode,body:Buffer.concat(chunks).toString()}));});req.on('error',reject);req.end(body===undefined?undefined:JSON.stringify(body));});
assert.equal((await request('/state',{headers:{'X-Toolbox-Knowledge':''}})).status,403);assert.equal((await request('/state',{headers:{Origin:'https://evil.example'}})).status,403);assert.equal((await request('/state?x=1')).status,400);const result=await request('/entries',{method:'POST',body:{kind:'block',name:'安全',data:{content:'正文'}}});assert.equal(result.status,201);const item=JSON.parse(result.body);assert.equal((await request('/entries/'+item.id,{method:'DELETE'})).status,400);assert.equal((await request('/entries/'+item.id+'?confirm=1&version=1',{method:'DELETE'})).status,200);assert.equal((await request('/entries',{method:'POST',body:{kind:'block',name:'大',data:{content:'X'.repeat(13*1048576)}}})).status,413);assert.ok(logs.every(value=>!value.includes('正文')));});
