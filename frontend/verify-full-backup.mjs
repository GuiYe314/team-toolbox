// 真实API、临时SQLite/附件和临时浏览器；支持最终发布包，不访问用户数据。
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { knowledgeFixture, knowledgeModule } from './verify-knowledge-fixture.mjs';
const f = await knowledgeFixture('tt-full-backup-browser-'), b = f.browser;
const { saveEntry } = await import(knowledgeModule('knowledge-workbench-store.js'));
const { saveCalculation } = await import(knowledgeModule('quick-calculation-store.js'));
const { saveSopTemplate, startSopRun } = await import(knowledgeModule('knowledge-sops-store.js'));
const { saveProject, createTodo, setTodoArchived } = await import(knowledgeModule('project-todos-store.js'));
const require = createRequire(resolve(process.env.VERIFY_BACKEND_ROOT || 'backend', 'package.json')), yauzl = require('yauzl');
let count=0; const check=(name,value=true)=>{assert.ok(value,name);console.log(`PASS ${++count} ${name}`);};
async function request(path,method='GET',body) { const res=await fetch(f.base+path,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)}); const value=res.status===204?null:await res.json(); assert.ok(res.ok,JSON.stringify(value));return value; }
async function unzip(buffer) { return new Promise((done,reject)=>yauzl.fromBuffer(buffer,{lazyEntries:true},(error,zip)=>{if(error)return reject(error);const files=new Map();zip.on('error',reject);zip.on('entry',entry=>zip.openReadStream(entry,(failure,stream)=>{if(failure)return reject(failure);const chunks=[];stream.on('data',c=>chunks.push(c));stream.on('error',reject);stream.on('end',()=>{files.set(entry.fileName,Buffer.concat(chunks));zip.readEntry();});}));zip.on('end',()=>done(files));zip.readEntry();})); }
try {
    const n=await request('/api/documents','POST',{title:'原编辑器备份验收',content_md:'# 传统正文\n\n保留内容'});
    await f.navigate('/kb/'+n.id,'.doc-title');
    check('原Markdown阅读及工作台入口正常',await b.evaluate("document.querySelector('.markdown-body').textContent.includes('传统正文')&&!!document.querySelector('.topbar-actions a[href*=workbench]')"));
    await b.evaluate("[...document.querySelectorAll('.topbar-actions button')].find(e=>e.textContent.trim()==='编辑').click()");
    await b.wait("!!document.querySelector('#title')&&!!document.querySelector('.vditor')");await b.fill('#title','传统编辑器已修改');
    await b.click('.edit-top-actions .nt-btn-primary');await b.wait("document.querySelector('.doc-title')?.textContent==='传统编辑器已修改'");
    check('旧编辑器保存保留正文', (await request('/api/documents/'+n.id)).content_md.includes('保留内容'));
    check('旧编辑器修改也保留历史',f.db.prepare('SELECT COUNT(*) n FROM kb_note_revisions WHERE document_id=?').get(n.id).n===1);
    const block=saveEntry(f.db,{kind:'block',name:'备份同步块',data:{content:'统一内容'}});
    saveCalculation(f.db,{name:'备份方案',base:'2.58',rate:'0.02',rateMode:'ratio',count:10,precision:6});
    const sop=saveSopTemplate(f.db,{name:'备份流程',description:'',steps:[{id:randomUUID(),text:'核对'}]});startSopRun(f.db,sop.id,{version:sop.version,requestId:randomUUID()});
    const project=saveProject(f.db,{name:'备份项目',description:'项目说明',status:'paused',dueDate:'2026-12-10'});
    const todo=createTodo(f.db,project.id,{issue:'备份归档问题',details:'待办说明',priority:'urgent',stage:'doing',dueDate:'2026-12-08',assignee:'验收员',tags:['发版']});
    setTodoArchived(f.db,todo.id,{version:todo.version,archived:true});
    const photo=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64');
    const form=new FormData();form.append('name','备份验收.png');form.append('file',new Blob([photo],{type:'image/png'}),'备份验收.png');
    const uploaded=await fetch(f.base+'/api/assets/upload',{method:'POST',body:form});assert.equal(uploaded.status,201);const asset=await uploaded.json();
    await f.navigate('/kb','.kb-io-menu > button');await b.click('.kb-io-menu > button');await b.wait("!!document.querySelector('.kb-io-dropdown')");
    const menu=await b.evaluate("document.querySelector('.kb-io-dropdown').textContent");
    check('备份菜单明示项目待办、工作台、SOP与资源范围',menu.includes('项目待办')&&menu.includes('工作台')&&menu.includes('SOP')&&menu.includes('资源文件'));
    check('JSON菜单明示不含附件',menu.includes('不含图片与资源文件'));
    const snapshot=await request('/api/backup/export');
    check('JSON快照含计算、SOP、工作台和历史',snapshot.quick_calculations.length===1&&snapshot.sops.runs.length===1&&snapshot.workbench.entries.length===1&&snapshot.workbench.revisions.length===1);
    check('JSON快照保留项目及归档待办',snapshot.project_todos.projects[0].id===project.id&&snapshot.project_todos.todos[0].status==='archived'&&!!snapshot.project_todos.todos[0].archivedAt);
    const zipResponse=await fetch(f.base+'/api/backup/full-export');check('全量备份流端点可用',zipResponse.ok&&zipResponse.headers.get('content-type').includes('application/zip'));
    const zip=Buffer.from(await zipResponse.arrayBuffer()), files=await unzip(zip),manifest=JSON.parse(files.get('manifest.json')),docs=JSON.parse(files.get('documents.json'));
    check('ZIP含文档及资源清单',files.has('documents.json')&&files.has('assets/manifest.json'));
    check('ZIP包含原件字节',[...files].some(([name,value])=>name.startsWith('assets/files/')&&value.equals(photo)));
    check('ZIP快照扩展与JSON一致',docs.workbench.entries[0].id===block.id&&docs.sops.runs.length===1&&docs.quick_calculations.length===1);
    check('全量清单计数包含工作台和历史',manifest.counts.workbench_entries===1&&manifest.counts.note_revisions===1&&manifest.counts.assets===1);
    check('ZIP快照和清单包含完整项目待办',JSON.stringify(docs.project_todos)===JSON.stringify(snapshot.project_todos)&&manifest.counts.project_todos_projects===1&&manifest.counts.project_todos===1);
    const bad=new FormData();bad.append('file',new Blob(['not a zip']),'bad.zip');const rejected=await fetch(f.base+'/api/backup/full-import',{method:'POST',body:bad});check('损坏ZIP明确拒绝',rejected.status===400&&!!(await rejected.json()).message);
    await request('/api/documents/'+n.id,'DELETE');
    const unavailable=await fetch(f.base+'/api/knowledge-workbench/notes/'+n.id,{headers:{'X-Toolbox-Knowledge':'1'}});check('回收站笔记无法从工作台读取',unavailable.status===404);
    const trash=await request('/api/documents/trash');check('普通删除仍在原回收站可见',JSON.stringify(trash).includes('传统编辑器已修改'));
    await request('/api/documents/restore','POST',{ids:[n.id]});check('恢复后原正文及历史保留',(await request('/api/documents/'+n.id)).content_md.includes('保留内容')&&f.db.prepare('SELECT COUNT(*) n FROM kb_note_revisions').get().n===1);
    // 仅清空本脚本刚创建的临时库，再从真实ZIP恢复。
    f.db.exec('DELETE FROM documents; DELETE FROM kb_entries; DELETE FROM quick_calculations; DELETE FROM kb_sop_runs; DELETE FROM kb_sop_templates; DELETE FROM kb_projects;');
    const restore=new FormData();restore.append('file',new Blob([zip],{type:'application/zip'}),'backup.zip');const response=await fetch(f.base+'/api/backup/full-import',{method:'POST',body:restore});const result=await response.json();check('真实ZIP可恢复到临时空库',response.status===201);
    const restored=await request('/api/backup/export');check('恢复所有文字扩展与历史',restored.documents.length===1&&restored.workbench.entries.length===1&&restored.workbench.revisions.length===1&&restored.sops.runs.length===1&&restored.quick_calculations.length===1);
    check('全量ZIP恢复项目、问题及归档时间',JSON.stringify(restored.project_todos)===JSON.stringify(snapshot.project_todos));
    const original=await fetch(f.base+`/api/assets/files/${asset.id}/original/latest?download=1`);check('备份操作保留原件可下载',original.ok&&Buffer.from(await original.arrayBuffer()).equals(photo));
    await f.navigate('/kb/'+restored.documents[0].ref,'.doc-title');check('恢复页面可在原阅读器打开',await b.evaluate("document.querySelector('.markdown-body').textContent.includes('保留内容')"));
    check('浏览器无脚本异常',b.errors.length===0);console.log(`RESULT ${count}/${count} original Markdown, trash and full backup checks passed; isolated data.`);
} finally {await f.close();}
