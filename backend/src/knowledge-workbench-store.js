import { createDocument, getDocument, updateDocument } from './store.js';
import { startSopRun, getSopTemplate } from './knowledge-sops-store.js';
import { buildKnowledgeIndex, renderKnowledgeNote, remapWikiNoteIds } from './knowledge-links.js';
import { fail, text, object, integer, ref, date, newId, kinds, validateEntity, validateValues } from './knowledge-workbench-validation.js';

const decode = row => row && ({ id: row.id, kind: row.kind, name: row.name, data: JSON.parse(row.data), version: row.version, createdAt: row.created_at, updatedAt: row.updated_at });
export function getEntry(db, id, kind) {
    ref(id); const item = decode(db.prepare('SELECT * FROM kb_entries WHERE id=?').get(id));
    if (!item || kind && item.kind !== kind) fail('知识库项目不存在，请刷新', 'not_found');
    if (item.kind === 'comment') activeNote(db, item.data.docId);
    return item;
}
export function entries(db, kind) { return db.prepare('SELECT * FROM kb_entries ORDER BY updated_at DESC,id').all().map(decode).filter(item => !kind || item.kind === kind); }
export function noteMeta(db, id) {
    const row = db.prepare('SELECT data,version FROM kb_note_meta WHERE document_id=?').get(id);
    return row ? { ...JSON.parse(row.data), version: row.version } : { databaseId: null, values: {}, version: 0 };
}
function activeNote(db, id) { integer(id); const note = getDocument({ connection: db, id }); if (!note || note.is_deleted) fail('笔记不存在或在回收站中', 'not_found'); return note; }
function valueReferences(db, database, values, allowDeleted = false) {
    validateValues(database, values);
    for (const field of database?.data.fields || []) {
        if (field.type !== 'relation') continue;
        for (const id of values[field.key] || []) {
            const note = allowDeleted ? db.prepare('SELECT id FROM documents WHERE id=?').get(id) : activeNote(db, id);
            if (!note || noteMeta(db, id).databaseId !== field.target) fail('关联笔记必须来自指定资料库');
        }
    }
}
function references(db, kind, data, { allowDeleted = false, candidate = null } = {}) {
    const databaseById = id => candidate?.id === id ? candidate : getEntry(db, id, 'database');
    if (kind === 'database') {
        for (const field of data.fields) if (field.type === 'relation') databaseById(field.target);
        for (const field of data.fields.filter(f => f.type === 'rollup' && f.aggregate !== 'count')) {
            const relation = data.fields.find(f => f.key === field.relation);
            if (!databaseById(relation.target).data.fields.some(f => f.key === field.field && f.type === 'number')) fail('求和和平均须选择被关联资料库中的数字属性');
        }
        if (data.templateId) getEntry(db, data.templateId, 'template');
    }
    if (kind === 'template') valueReferences(db, data.databaseId ? databaseById(data.databaseId) : null, data.values || {}, allowDeleted);
    if (kind === 'comment') {
        if (allowDeleted) { if (!db.prepare('SELECT id FROM documents WHERE id=?').get(data.docId)) fail('评论笔记不在备份中'); }
        else activeNote(db, data.docId);
    }
    if (kind === 'action') {
        if (data.databaseId) databaseById(data.databaseId);
        if (data.action === 'create-note') getEntry(db, data.templateId, 'template');
        if (data.action === 'start-sop') getSopTemplate(db, data.sopId);
        if (data.action === 'set-property') {
            if (!data.databaseId) fail('设置属性动作必须限定资料库');
            valueReferences(db, databaseById(data.databaseId), { [data.field]: data.value }, allowDeleted);
        }
    }
}
export function saveEntry(db, input, id = null) {
    object(input); text(input.name, 80, false); const old = id ? getEntry(db, id) : null;
    if (old && old.version !== input.version) fail('此项目已在别处修改，请重新读取；当前草稿已保留', 'conflict');
    const kind = old?.kind || input.kind, data = validateEntity(kind, input.data); references(db, kind, data);
    if (kind === 'database' && old) {
        const next = new Map(data.fields.map(f => [f.key, f]));
        for (const row of db.prepare('SELECT data FROM kb_note_meta').all()) {
            const meta = JSON.parse(row.data); if (meta.databaseId !== old.id) continue;
            for (const field of old.data.fields) if (meta.values[field.key] !== undefined && meta.values[field.key] !== null && meta.values[field.key] !== '' && (!next.has(field.key) || next.get(field.key).type !== field.type)) fail('该字段已有笔记数据，请先清空其属性再删除或更改类型');
            validateValues({ data }, meta.values);
        }
        for (const item of entries(db).filter(e => e.id !== old.id && ['database', 'template', 'action'].includes(e.kind))) references(db, item.kind, item.data, { allowDeleted: true, candidate: { id: old.id, data } });
    }
    if (!old && entries(db, kind).length >= (kind === 'comment' ? 1000 : 200)) fail('该类项目已到数量上限，请整理后重试');
    const json = JSON.stringify(data), total = db.prepare('SELECT COALESCE(SUM(length(CAST(data AS BLOB))),0) n FROM kb_entries').get().n;
    if (total - Buffer.byteLength(JSON.stringify(old?.data || {})) + Buffer.byteLength(json) > 16777216) fail('工作台资料达到16MiB上限');
    const now = new Date().toISOString(), itemId = id || newId();
    if (old) db.prepare('UPDATE kb_entries SET name=?,data=?,version=version+1,updated_at=? WHERE id=? AND version=?').run(input.name.trim(), json, now, itemId, input.version);
    else db.prepare('INSERT INTO kb_entries(id,kind,name,data,version,created_at,updated_at) VALUES(?,?,?,?,1,?,?)').run(itemId, kind, input.name.trim(), json, now, now);
    return getEntry(db, itemId);
}
export function deleteEntry(db, id, version) {
    const item = getEntry(db, id); if (item.version !== version) fail('项目已变更，请刷新后删除', 'conflict');
    if (item.kind === 'database' && db.prepare('SELECT data FROM kb_note_meta').all().some(row => JSON.parse(row.data).databaseId === id)) fail('资料库仍有笔记，请先将笔记移出资料库');
    for (const other of entries(db)) {
        if (other.id === id) continue;
        if ((other.data.databaseId === id || other.data.templateId === id || other.data.sopId === id || other.data.fields?.some(f => f.target === id))) fail('此项目仍被模板、资料库或动作引用，请先解除引用');
    }
    db.prepare('DELETE FROM kb_entries WHERE id=? AND version=?').run(id, version); return { deleted: true };
}
export function saveMeta(db, id, input) {
    activeNote(db, id); object(input); integer(input.version, 0);
    const old = noteMeta(db, id); if (old.version !== input.version) fail('笔记属性已变更，请刷新后重试', 'conflict');
    ref(input.databaseId, true); const database = input.databaseId ? getEntry(db, input.databaseId, 'database') : null;
    const values = validateValues(database, input.values);
    if (!database && Object.keys(values).length) fail('请先选择资料库');
    valueReferences(db, database, values);
    const data = JSON.stringify({ databaseId: input.databaseId || null, values });
    if (Buffer.byteLength(data) > 16384) fail('笔记属性及资料库引用总量超过16KiB');
    db.prepare('INSERT INTO kb_note_meta(document_id,data,version) VALUES(?,?,1) ON CONFLICT(document_id) DO UPDATE SET data=excluded.data,version=kb_note_meta.version+1').run(id, data);
    return noteMeta(db, id);
}
export function readNote(db, id) {
    const note = activeNote(db, id); return { ...note, meta: noteMeta(db, id), ...renderKnowledgeNote(db, note) };
}
export function workbenchState(db) {
    const index = buildKnowledgeIndex(db), { content: _content, ...publicIndex } = index;
    const activeIds = new Set(index.notes.map(n => n.id));
    return { ...publicIndex, entries: entries(db).filter(e => e.kind !== 'comment' || activeIds.has(e.data.docId)) };
}
function fromTemplate(db, templateId, title, day) {
    const template = templateId ? getEntry(db, templateId, 'template') : null;
    const replace = value => value.replace(/\{\{date\}\}/g, day).replace(/\{\{title\}\}/g, title || day);
    const note = createDocument({ connection: db, title: title || replace(template?.data.title || '新笔记'), content_md: replace(template?.data.content || '') });
    if (template?.data.databaseId) saveMeta(db, note.id, { version: 0, databaseId: template.data.databaseId, values: template.data.values || {} });
    return note;
}
export function createWorkbenchNote(db, input) {
    object(input); if (input.templateId) ref(input.templateId); const day = input.day ? date(input.day) : new Date().toISOString().slice(0, 10);
    if (input.title !== undefined) text(input.title, 100, false);
    return db.transaction(() => {
        if (input.daily === true) {
            const existing = db.prepare('SELECT document_id FROM kb_daily_notes WHERE day=?').get(day);
            if (existing) return { ...activeNote(db, existing.document_id), reused: true };
        }
        const note = fromTemplate(db, input.templateId, input.daily ? day : input.title, day);
        if (input.databaseId && noteMeta(db, note.id).databaseId !== input.databaseId) saveMeta(db, note.id, {version: noteMeta(db, note.id).version, databaseId: input.databaseId, values: {}});
        if (input.daily === true) db.prepare('INSERT INTO kb_daily_notes(day,document_id) VALUES(?,?)').run(day, note.id);
        const actions = runTriggeredActions(db, 'note-created', note.id); return { ...note, actions };
    })();
}
export function saveWorkbenchNote(db, id, input) {
    object(input); activeNote(db, id);
    return db.transaction(() => {
        let metaChanged = false;
        if (input.meta !== undefined) {
            object(input.meta); object(input.meta.values); integer(input.meta.version, 0); ref(input.meta.databaseId, true);
            const current = noteMeta(db, id);
            if (current.version !== input.meta.version) fail('笔记属性已变更，请重新读取', 'conflict');
            const sorted = values => JSON.stringify(Object.entries(values).sort(([a], [b]) => a.localeCompare(b)));
            metaChanged = current.databaseId !== input.meta.databaseId || sorted(current.values) !== sorted(input.meta.values);
            if (metaChanged) saveMeta(db, id, input.meta);
        }
        const result = updateDocument({ connection: db, id, version: input.version, title: input.title, content_md: input.content_md });
        const actions = metaChanged ? runTriggeredActions(db, 'property-changed', id) : [];
        return { ...result, meta: noteMeta(db, id), actions };
    })();
}
export function revisions(db, id) { activeNote(db, id); return db.prepare('SELECT id,title,content_md,version,saved_at FROM kb_note_revisions WHERE document_id=? ORDER BY id DESC LIMIT 20').all(id); }
export function restoreRevision(db, id, input) {
    const current = activeNote(db, id); integer(input.revisionId); integer(input.version);
    const revision = db.prepare('SELECT title,content_md FROM kb_note_revisions WHERE document_id=? AND id=?').get(id, input.revisionId);
    if (!revision) fail('该历史版本不存在或已轮换', 'not_found');
    return updateDocument({ connection: db, id, version: input.version, title: revision.title, content_md: revision.content_md, category_id: current.category_id, parent_id: current.parent_id, tags: current.tags });
}
function performAction(db, item, docId) {
    const data = item.data;
    if (data.action === 'create-note') return { noteId: fromTemplate(db, data.templateId, undefined, new Date().toISOString().slice(0, 10)).id };
    if (data.action === 'start-sop') { const sop = getSopTemplate(db, data.sopId); return { runId: startSopRun(db, sop.id, { version: sop.version, requestId: newId() }).item.id }; }
    const note = activeNote(db, docId), meta = noteMeta(db, note.id); if (data.databaseId && meta.databaseId !== data.databaseId) fail('当前笔记不属于此动作的资料库');
    saveMeta(db, docId, { ...meta, values: { ...meta.values, [data.field]: data.value } }); return { noteId: docId };
}
function runTriggeredActions(db, trigger, docId) {
    const meta = noteMeta(db, docId), results = [];
    for (const item of entries(db, 'action').filter(e => e.data.trigger === trigger && (!e.data.databaseId || e.data.databaseId === meta.databaseId)).slice(0, 20)) results.push({ name: item.name, ...performAction(db, item, docId) });
    return results;
}
export function runAction(db, id, input) {
    const item = getEntry(db, id, 'action'); if (item.version !== input.version) fail('按钮已变更，请重新读取', 'conflict'); ref(input.requestId);
    if (item.data.trigger !== 'manual') fail('此动作由笔记事件触发');
    return db.transaction(() => {
        const cached = db.prepare('SELECT action_id,result FROM kb_action_requests WHERE request_id=?').get(input.requestId);
        if (cached) { if (cached.action_id !== id) fail('请求编号已用于其他动作', 'conflict'); return JSON.parse(cached.result); }
        const result = performAction(db, item, input.docId);
        db.prepare('INSERT INTO kb_action_requests(request_id,action_id,result) VALUES(?,?,?)').run(input.requestId, id, JSON.stringify(result));
        db.prepare('DELETE FROM kb_action_requests WHERE rowid NOT IN(SELECT rowid FROM kb_action_requests ORDER BY rowid DESC LIMIT 2000)').run(); return result;
    })();
}

export function exportWorkbench(db) {
    const documentIds = new Set(db.prepare('SELECT id FROM documents').all().map(row => row.id));
    return { entries: entries(db).filter(item => item.kind !== 'comment' || documentIds.has(item.data.docId)), meta: db.prepare('SELECT document_id,data,version FROM kb_note_meta').all().map(row => ({ docRef: row.document_id, data: JSON.parse(row.data), version: row.version })), revisions: db.prepare('SELECT document_id,title,content_md,version,saved_at FROM kb_note_revisions').all(), daily: db.prepare('SELECT day,document_id FROM kb_daily_notes').all() };
}
export function validateWorkbenchBackup(value) {
    if (value === undefined) return null; object(value);
    if (Buffer.byteLength(JSON.stringify(value)) > 72 * 1048576) fail('知识库工作台备份超过72MiB');
    if (!Array.isArray(value.entries) || value.entries.length > 2200 || !Array.isArray(value.meta) || value.meta.length > 10000 || !Array.isArray(value.revisions) || value.revisions.length > 200000 || !Array.isArray(value.daily) || value.daily.length > 10000) fail('知识库工作台备份结构不正确');
    const ids = new Set(), counters = {}, perDoc = {};
    let size = 0;
    for (const item of value.entries) {
        ref(item.id); if (ids.has(item.id)) fail('工作台项目ID重复'); ids.add(item.id); text(item.name, 80, false); integer(item.version);
        item.data = validateEntity(item.kind, item.data); size += Buffer.byteLength(JSON.stringify(item.data)); counters[item.kind] = (counters[item.kind] || 0) + 1;
        if (counters[item.kind] > (item.kind === 'comment' ? 1000 : 200)) fail('工作台项目数量超限');
    }
    if (size > 16777216) fail('工作台项目总量超限');
    const docIds = new Set();
    for (const item of value.meta) { integer(item.docRef); if (docIds.has(item.docRef)) fail('笔记属性重复'); docIds.add(item.docRef); object(item.data); integer(item.version); ref(item.data.databaseId, true); if (Buffer.byteLength(JSON.stringify(item.data)) > 16384) fail('笔记属性过大'); object(item.data.values); }
    size = 0;
    for (const row of value.revisions) { integer(row.document_id); text(row.title, 100, false); text(row.content_md, 1048576); integer(row.version); text(row.saved_at, 40, false); perDoc[row.document_id] = (perDoc[row.document_id] || 0) + 1; size += Buffer.byteLength(row.content_md); if (perDoc[row.document_id] > 20 || size > 52428800) fail('笔记历史超限'); }
    const days = new Set(); for (const row of value.daily) { date(row.day); integer(row.document_id); if (days.has(row.day)) fail('每日笔记日期重复'); days.add(row.day); }
    return value;
}
export function importWorkbench(db, value, docMap, newDocuments) {
    if (!value) return 0; let count = 0;
    const remap = id => { const mapped = docMap.get(id); if (!mapped) fail('工作台引用的笔记不在备份中'); return mapped; };
    const now = new Date().toISOString();
    const added = [];
    for (const item of value.entries) {
        if (db.prepare('SELECT 1 FROM kb_entries WHERE id=?').get(item.id)) continue;
        const data = structuredClone(item.data);
        if (item.kind === 'comment') data.docId = remap(data.docId);
        if (item.kind === 'workspace') { data.tabs = data.tabs.filter(id => docMap.has(id)).map(remap); data.bookmarks = data.bookmarks.filter(id => docMap.has(id)).map(remap); data.active = docMap.get(data.active) || null; data.secondary = docMap.get(data.secondary) || null; }
        if (item.kind === 'canvas') data.nodes = data.nodes.map(n => n.type !== 'note' ? n : docMap.has(n.docId) ? { ...n, docId: remap(n.docId) } : { id: n.id, type: 'text', text: `已失效笔记（原编号${n.docId}）`, x: n.x, y: n.y });
        if (['template', 'block'].includes(item.kind)) data.content = remapWikiNoteIds(data.content, docMap);
        db.prepare('INSERT INTO kb_entries(id,kind,name,data,version,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run(item.id, item.kind, item.name, JSON.stringify(data), item.version, now, now); count++;
        added.push({ ...item, data });
    }
    for (const item of value.meta) {
        const id = remap(item.docRef); if (!newDocuments.has(id)) continue;
        const data = structuredClone(item.data), database = data.databaseId ? getEntry(db, data.databaseId, 'database') : null;
        validateValues(database, data.values);
        for (const field of database?.data.fields || []) if (field.type === 'relation' && Array.isArray(data.values[field.key])) data.values[field.key] = data.values[field.key].filter(id => docMap.has(id)).map(remap);
        db.prepare('INSERT INTO kb_note_meta(document_id,data,version) VALUES(?,?,?)').run(id, JSON.stringify(data), item.version);
    }
    // 所有实体与笔记属性先就位，再校验跨资料库关系，避免依赖导出顺序。
    for (const item of added) {
        const data = item.data;
        const mapValues = (databaseId, values) => {
            const database = databaseId ? getEntry(db, databaseId, 'database') : null;
            for (const field of database?.data.fields || []) if (field.type === 'relation' && Array.isArray(values[field.key])) values[field.key] = values[field.key].filter(id => docMap.has(id)).map(remap);
        };
        if (item.kind === 'template') mapValues(data.databaseId, data.values || {});
        if (item.kind === 'action' && data.action === 'set-property') {
            const values = { [data.field]: data.value }; mapValues(data.databaseId, values); data.value = values[data.field];
        }
        references(db, item.kind, data, { allowDeleted: true });
        db.prepare('UPDATE kb_entries SET data=? WHERE id=?').run(JSON.stringify(data), item.id);
    }
    for (const item of value.meta) {
        const id = remap(item.docRef); if (!newDocuments.has(id)) continue;
        const meta = noteMeta(db, id);
        valueReferences(db, meta.databaseId ? getEntry(db, meta.databaseId, 'database') : null, meta.values, true);
    }
    for (const row of value.revisions) { const id = remap(row.document_id); if (newDocuments.has(id)) db.prepare('INSERT INTO kb_note_revisions(document_id,title,content_md,version,saved_at) VALUES(?,?,?,?,?)').run(id, row.title, remapWikiNoteIds(row.content_md, docMap), row.version, row.saved_at); }
    for (const row of value.daily) db.prepare('INSERT OR IGNORE INTO kb_daily_notes(day,document_id) VALUES(?,?)').run(row.day, remap(row.document_id));
    validateWorkbenchBackup(exportWorkbench(db));
    return count;
}
