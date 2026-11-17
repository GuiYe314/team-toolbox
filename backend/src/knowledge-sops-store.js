import { randomUUID } from 'node:crypto';

const MAX_BYTES = 8 * 1024 * 1024;
const failure = (code, message) => { const error = new Error(message); error.code = code; return error; };
const bad = message => { throw failure('invalid_input', message); };
const conflict = message => { throw failure('conflict', message); };
export function sopId(value) { if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)) bad('清单编号不正确'); return value; }
function text(value, label, max, required = false) {
    if (typeof value !== 'string' || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) bad(`${label}最多${max}字，请使用普通文字`);
    const result = value.trim(); if (required && !result) bad(`请填写${label}`); return result;
}
function version(value) { if (!Number.isSafeInteger(value) || value < 1 || value > 2147483647) bad('版本不正确，请重新读取'); return value; }
function nameKey(name) { if (/\p{C}/u.test(name)) bad('名称请使用可见文字'); return name.normalize('NFKC').toLowerCase(); }
function templateInput(value) {
    const name = text(value?.name, '模板名称', 80, true), description = text(value?.description ?? '', '模板说明', 2000);
    if (!Array.isArray(value?.steps) || value.steps.length < 1 || value.steps.length > 50) bad('每个模板需要1～50条步骤');
    const ids = new Set(), steps = value.steps.map(step => {
        if (!step || typeof step !== 'object' || Array.isArray(step) || Object.keys(step).some(key => !['id', 'text'].includes(key))) bad('步骤格式不正确');
        const id = step.id ? sopId(step.id) : randomUUID(); if (ids.has(id)) bad('步骤编号不能重复'); ids.add(id);
        return { id, text: text(step.text, '步骤内容', 500, true) };
    });
    return { name, nameKey: nameKey(name), description, steps };
}
const templateRow = row => ({ id: row.id, name: row.name, description: row.description, steps: JSON.parse(row.steps_json), version: row.version, createdAt: row.created_at, updatedAt: row.updated_at });
const runRow = row => ({ id: row.id, templateId: row.template_id, templateName: row.template_name, templateVersion: row.template_version, description: row.description, steps: JSON.parse(row.steps_json), notes: row.notes, status: row.status, version: row.version, createdAt: row.created_at, updatedAt: row.updated_at, completedAt: row.completed_at });
function row(db, table, id) { const result = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(sopId(id)); if (!result) throw failure('not_found', '模板或执行记录已不存在，请刷新'); return result; }
function current(row, expected) { if (row.version !== version(expected)) conflict('内容已被其他页面修改，请重新读取后再操作；编辑草稿仍保留'); }
function sizeAllowed(db, delta) {
    const bytes = db.prepare(`SELECT COALESCE((SELECT SUM(length(CAST(steps_json AS BLOB)) + length(CAST(description AS BLOB))) FROM kb_sop_templates), 0)
        + COALESCE((SELECT SUM(length(CAST(steps_json AS BLOB)) + length(CAST(notes AS BLOB)) + length(CAST(description AS BLOB))) FROM kb_sop_runs), 0) AS n`).get().n;
    if (bytes + delta > MAX_BYTES) conflict('SOP正文达到8MiB上限，请先备份并删除不需要的记录');
}
const bytes = value => Buffer.byteLength(value, 'utf8');
export function listSopTemplates(db) {
    return db.prepare('SELECT * FROM kb_sop_templates ORDER BY updated_at DESC, id').all().map(value => { const item = templateRow(value); return { ...item, steps: undefined, stepCount: item.steps.length }; });
}
export const getSopTemplate = (db, id) => templateRow(row(db, 'kb_sop_templates', id));
export function saveSopTemplate(db, value, id) {
    const checked = templateInput(value), steps = JSON.stringify(checked.steps);
    return db.transaction(() => {
        const old = id ? row(db, 'kb_sop_templates', id) : null; if (old) current(old, value.version);
        if (!old && db.prepare('SELECT COUNT(*) AS n FROM kb_sop_templates').get().n >= 200) conflict('最多200个模板，请先整理不需要的模板');
        if (db.prepare('SELECT id FROM kb_sop_templates WHERE name_key = ? AND id <> ?').get(checked.nameKey, id || '')) conflict('已有同名模板，请换一个名称');
        sizeAllowed(db, bytes(steps) + bytes(checked.description) - (old ? bytes(old.steps_json) + bytes(old.description) : 0));
        const now = new Date().toISOString(), ownId = id || randomUUID();
        if (old) db.prepare('UPDATE kb_sop_templates SET name=?, name_key=?, description=?, steps_json=?, version=version+1, updated_at=? WHERE id=?').run(checked.name, checked.nameKey, checked.description, steps, now, ownId);
        else db.prepare('INSERT INTO kb_sop_templates (id,name,name_key,description,steps_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').run(ownId, checked.name, checked.nameKey, checked.description, steps, now, now);
        return getSopTemplate(db, ownId);
    })();
}
export function deleteSopTemplate(db, id, expected) {
    db.transaction(() => { current(row(db, 'kb_sop_templates', id), expected); db.prepare('DELETE FROM kb_sop_templates WHERE id=?').run(id); })();
}
export function startSopRun(db, templateId, value) {
    const id = sopId(value?.requestId);
    return db.transaction(() => {
        const existing = db.prepare('SELECT * FROM kb_sop_runs WHERE id=?').get(id);
        if (existing) { if (existing.template_id !== templateId || existing.template_version !== version(value.version)) conflict('执行请求编号已使用，请刷新历史核对'); return { item: runRow(existing), created: false }; }
        const template = row(db, 'kb_sop_templates', templateId); current(template, value.version);
        if (db.prepare('SELECT COUNT(*) AS n FROM kb_sop_runs').get().n >= 1000) conflict('最多1000条执行记录，请先备份并整理历史');
        const steps = JSON.stringify(JSON.parse(template.steps_json).map(step => ({ ...step, done: false })));
        sizeAllowed(db, bytes(steps) + bytes(template.description)); const now = new Date().toISOString();
        db.prepare('INSERT INTO kb_sop_runs (id,template_id,template_name,template_version,description,steps_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').run(id, templateId, template.name, template.version, template.description, steps, now, now);
        return { item: getSopRun(db, id), created: true };
    })();
}
export const getSopRun = (db, id) => runRow(row(db, 'kb_sop_runs', id));
export function listSopRuns(db, { offset = 0, status = '' } = {}) {
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 1000 || !['', 'active', 'completed'].includes(status)) bad('历史筛选参数不正确');
    const where = status ? ' WHERE status=?' : '', params = status ? [status] : [];
    const total = db.prepare('SELECT COUNT(*) AS n FROM kb_sop_runs' + where).get(...params).n;
    const items = db.prepare('SELECT * FROM kb_sop_runs' + where + ' ORDER BY updated_at DESC, id LIMIT 50 OFFSET ?').all(...params, offset).map(value => {
        const item = runRow(value); return { ...item, steps: undefined, notes: undefined, stepCount: item.steps.length, doneCount: item.steps.filter(step => step.done).length };
    });
    return { items, total, offset, limit: 50 };
}
export function changeSopRun(db, id, value) {
    return db.transaction(() => {
        const old = row(db, 'kb_sop_runs', id); current(old, value?.version); if (old.status === 'completed') conflict('已完成记录为只读，请从模板开始新一次执行');
        const steps = JSON.parse(old.steps_json); let notes = old.notes, status = old.status, completedAt = null;
        if (Object.hasOwn(value, 'stepId')) {
            const step = steps.find(step => step.id === sopId(value.stepId)); if (!step || typeof value.done !== 'boolean') bad('步骤或勾选状态不正确'); step.done = value.done;
        } else if (Object.hasOwn(value, 'notes')) notes = text(value.notes, '执行备注', 2000);
        else if (value.complete === true) { if (steps.some(step => !step.done)) bad('请完成全部步骤后再结束本次执行'); status = 'completed'; completedAt = new Date().toISOString(); }
        else bad('执行操作不正确');
        const serialized = JSON.stringify(steps); sizeAllowed(db, bytes(serialized) + bytes(notes) - bytes(old.steps_json) - bytes(old.notes));
        db.prepare('UPDATE kb_sop_runs SET steps_json=?,notes=?,status=?,completed_at=?,version=version+1,updated_at=? WHERE id=?').run(serialized, notes, status, completedAt, new Date().toISOString(), id);
        return getSopRun(db, id);
    })();
}
export function deleteSopRun(db, id, expected) { db.transaction(() => { current(row(db, 'kb_sop_runs', id), expected); db.prepare('DELETE FROM kb_sop_runs WHERE id=?').run(id); })(); }

export function exportSops(db) {
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE name='kb_sop_templates' AND type='table'").get()) return { templates: [], runs: [] };
    return { templates: db.prepare('SELECT * FROM kb_sop_templates ORDER BY id').all().map(templateRow), runs: db.prepare('SELECT * FROM kb_sop_runs ORDER BY id').all().map(runRow) };
}
function date(value, label) { if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) || Number.isNaN(Date.parse(value))) bad(`备份中的${label}不正确`); return value; }
export function validateSopBackup(value) {
    if (value === undefined) return { templates: [], runs: [] };
    if (!value || !Array.isArray(value.templates) || !Array.isArray(value.runs) || value.templates.length > 200 || value.runs.length > 1000 || bytes(JSON.stringify(value)) > MAX_BYTES) bad('SOP备份格式不正确或超过限额');
    const templates = value.templates.map(item => {
        if (!Array.isArray(item?.steps)) bad('SOP备份中的模板步骤不正确'); for (const step of item.steps) sopId(step?.id);
        return { ...templateInput(item), id: sopId(item.id), version: version(item.version), createdAt: date(item.createdAt, '创建时间'), updatedAt: date(item.updatedAt, '修改时间') };
    });
    const runs = value.runs.map(item => {
        if (!Array.isArray(item?.steps)) bad('SOP备份中的执行步骤不正确'); for (const step of item.steps) sopId(step?.id);
        const checked = templateInput({ name: item.templateName, steps: item.steps.map(step => ({ id: step.id, text: step.text })) });
        if (!['active', 'completed'].includes(item.status) || item.steps.some(step => typeof step.done !== 'boolean') || item.status === 'completed' && item.steps.some(step => !step.done)) bad('SOP备份中的执行状态不正确');
        return { id: sopId(item.id), templateId: item.templateId === null ? null : sopId(item.templateId), templateName: checked.name, templateVersion: version(item.templateVersion),
            description: text(item.description ?? '', '操作说明', 2000), steps: checked.steps.map((step, index) => ({ ...step, done: item.steps[index].done })), notes: text(item.notes, '执行备注', 2000), status: item.status, version: version(item.version),
            createdAt: date(item.createdAt, '创建时间'), updatedAt: date(item.updatedAt, '修改时间'), completedAt: item.status === 'completed' ? date(item.completedAt, '完成时间') : null };
    });
    return { templates, runs };
}
export function importSops(db, value) {
    const stats = { templates: 0, runs: 0, skipped: 0 };
    for (const item of value.templates) {
        if (db.prepare('SELECT 1 FROM kb_sop_templates WHERE id=? OR name_key=?').get(item.id, item.nameKey)) { stats.skipped++; continue; }
        const steps = JSON.stringify(item.steps);
        try { sizeAllowed(db, bytes(steps) + bytes(item.description)); if (db.prepare('SELECT COUNT(*) AS n FROM kb_sop_templates').get().n >= 200) conflict('limit'); }
        catch (error) { if (error.code !== 'conflict') throw error; stats.skipped++; continue; }
        db.prepare('INSERT INTO kb_sop_templates (id,name,name_key,description,steps_json,version,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').run(item.id, item.name, item.nameKey, item.description, steps, item.version, item.createdAt, item.updatedAt); stats.templates++;
    }
    for (const item of value.runs) {
        if (db.prepare('SELECT 1 FROM kb_sop_runs WHERE id=?').get(item.id)) { stats.skipped++; continue; }
        const steps = JSON.stringify(item.steps);
        try { sizeAllowed(db, bytes(steps) + bytes(item.notes) + bytes(item.description)); if (db.prepare('SELECT COUNT(*) AS n FROM kb_sop_runs').get().n >= 1000) conflict('limit'); }
        catch (error) { if (error.code !== 'conflict') throw error; stats.skipped++; continue; }
        const templateId = item.templateId && db.prepare('SELECT 1 FROM kb_sop_templates WHERE id=?').get(item.templateId) ? item.templateId : null;
        db.prepare('INSERT INTO kb_sop_runs (id,template_id,template_name,template_version,description,steps_json,notes,status,version,created_at,updated_at,completed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
            .run(item.id, templateId, item.templateName, item.templateVersion, item.description, steps, item.notes, item.status, item.version, item.createdAt, item.updatedAt, item.completedAt); stats.runs++;
    }
    return stats;
}
