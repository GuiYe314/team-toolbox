import { randomUUID } from 'node:crypto';

export function fail(message, code = 'invalid_input') { const error = new Error(message); error.code = code; throw error; }
export const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export function text(value, max, empty = true) {
    if (typeof value !== 'string' || value.length > max || !empty && !value.trim()) fail(`文字不能为空且不能超过${max}字`);
    return value;
}
export function object(value) { if (!value || typeof value !== 'object' || Array.isArray(value)) fail('需要对象参数'); return value; }
export function array(value, max) { if (!Array.isArray(value) || value.length > max) fail(`列表不能超过${max}项`); return value; }
export function integer(value, min = 1, max = Number.MAX_SAFE_INTEGER) { if (!Number.isSafeInteger(value) || value < min || value > max) fail('数字参数超出范围'); return value; }
export function date(value) { const parsed = new Date(value + 'T12:00:00Z'); if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) fail('日期格式应为YYYY-MM-DD'); return value; }
export function ref(value, optional = false) { if (optional && (value === null || value === '')) return null; if (!uuid(value)) fail('引用ID不正确'); return value; }
export const kinds = ['database', 'template', 'canvas', 'block', 'workspace', 'comment', 'action'];
export const fieldTypes = ['text', 'number', 'status', 'date', 'range', 'multi', 'person', 'check', 'relation', 'rollup'];
export const viewTypes = ['table', 'board', 'gallery', 'calendar', 'timeline'];
export function validateEntity(kind, value) {
    if (!kinds.includes(kind)) fail('不支持的知识库项目类型');
    const data = structuredClone(object(value));
    if (Buffer.byteLength(JSON.stringify(data)) > 262144) fail('项目超过256KiB');
    if (kind === 'database') {
        const keys = new Set();
        for (const field of array(data.fields, 24)) {
            object(field); if (!/^[a-z][a-z0-9_]{0,23}$/.test(field.key) || keys.has(field.key)) fail('字段标识须为不重复的小写英文/数字/下划线');
            keys.add(field.key); text(field.label, 40, false); if (!fieldTypes.includes(field.type)) fail('字段类型不支持');
            if (['status', 'multi'].includes(field.type)) { array(field.options, 30).forEach(option => text(option, 40, false)); if (new Set(field.options).size !== field.options.length) fail('选项不能重复'); }
            if (field.type === 'relation') ref(field.target);
            if (field.type === 'rollup') { text(field.relation, 24, false); text(field.field, 24); if (!['count', 'sum', 'average'].includes(field.aggregate)) fail('汇总方式不支持'); }
        }
        for (const field of data.fields.filter(f => f.type === 'rollup')) if (!data.fields.some(f => f.key === field.relation && f.type === 'relation')) fail('汇总须引用关联字段');
        for (const view of array(data.views, 12)) {
            text(view.name, 40, false); if (!viewTypes.includes(view.type)) fail('视图类型不正确');
            for (const key of ['group', 'sort', 'dateField']) if (view[key] && !keys.has(view[key]) && view[key] !== 'title') fail('视图引用的字段不存在');
            if (view.direction && !['asc', 'desc'].includes(view.direction)) fail('排序方向不正确');
            if (view.dateField && !data.fields.some(f => f.key === view.dateField && ['date', 'range'].includes(f.type))) fail('日历和时间线需要日期或日期范围属性');
            for (const filter of array(view.filters || [], 8)) { if (!keys.has(filter.field) && filter.field !== 'title' || !['contains', 'equals', 'empty', 'not-empty'].includes(filter.op)) fail('筛选条件不正确'); text(filter.value || '', 200); }
        }
        if (data.templateId) ref(data.templateId);
    } else if (kind === 'template') {
        text(data.title, 100, false); text(data.content, 100000); ref(data.databaseId, true); object(data.values || {});
    } else if (kind === 'block') text(data.content, 60000);
    else if (kind === 'canvas') {
        const ids = new Set();
        for (const node of array(data.nodes, 100)) {
            ref(node.id); if (ids.has(node.id)) fail('画布节点重复'); ids.add(node.id);
            if (!['note', 'text'].includes(node.type)) fail('画布节点类型不正确');
            if (node.type === 'note') integer(node.docId); else text(node.text, 2000);
            for (const key of ['x', 'y']) if (!Number.isFinite(node[key]) || Math.abs(node[key]) > 10000) fail('画布位置超限');
        }
        for (const edge of array(data.edges, 200)) if (!ids.has(edge.from) || !ids.has(edge.to) || edge.from === edge.to) fail('画布连接无效');
    } else if (kind === 'workspace') {
        array(data.tabs, 30).forEach(id => integer(id)); array(data.bookmarks, 100).forEach(id => integer(id));
        if (data.active !== null) integer(data.active); if (data.secondary !== null) integer(data.secondary);
        if (typeof data.split !== 'boolean') fail('分屏设置不正确');
    } else if (kind === 'comment') {
        integer(data.docId); text(data.author, 40, false); text(data.content, 4000, false);
    } else if (kind === 'action') {
        if (!['manual', 'note-created', 'property-changed'].includes(data.trigger)) fail('触发条件不支持');
        if (!['create-note', 'set-property', 'start-sop'].includes(data.action)) fail('按钮动作不支持');
        ref(data.databaseId, true);
        if (data.action === 'create-note') ref(data.templateId);
        if (data.action === 'start-sop') ref(data.sopId);
        if (data.action === 'set-property') { text(data.field, 24, false); if (data.value === undefined) fail('请填写属性值'); if (Buffer.byteLength(JSON.stringify(data.value)) > 16000) fail('属性值过大'); }
    }
    return data;
}
export function validateValues(database, values) {
    object(values); if (Buffer.byteLength(JSON.stringify(values)) > 16384) fail('笔记属性超过16KiB');
    const fields = database?.data.fields || [];
    for (const [key, value] of Object.entries(values)) {
        const field = fields.find(f => f.key === key); if (!field || field.type === 'rollup') fail('属性不存在或为自动汇总');
        if (value === null || value === '') continue;
        if (['text', 'person'].includes(field.type)) text(value, 1000);
        if (field.type === 'number' && (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 1e15)) fail('请输入有限数字');
        if (field.type === 'check' && typeof value !== 'boolean') fail('勾选属性应为布尔值');
        if (field.type === 'status' && !field.options.includes(value)) fail('状态选项不存在');
        if (field.type === 'date') date(value);
        if (field.type === 'range') { object(value); date(value.start); date(value.end); if (value.start > value.end) fail('结束日期不能早于开始日期'); }
        if (field.type === 'multi') { array(value, 30); if (value.some(item => !field.options.includes(item))) fail('多选选项不存在'); }
        if (field.type === 'relation') { array(value, 50).forEach(id => integer(id)); if (new Set(value).size !== value.length) fail('关联笔记重复'); }
    }
    return structuredClone(values);
}
export const newId = () => randomUUID();
