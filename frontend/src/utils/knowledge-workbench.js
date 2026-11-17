export const fieldLabels = { text: '文本', number: '数字', status: '状态', date: '日期', range: '日期范围', multi: '多选', person: '人员标签', check: '勾选', relation: '关联笔记', rollup: '关联汇总' };
export const viewLabels = { table: '表格', board: '看板', gallery: '画廊', calendar: '日历', timeline: '时间线' };
export const localDay = (value = new Date()) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
export function propertyValue(note, field, database, notes, databases) {
    if (field.key === 'title') return note.title;
    const values = note.meta.values;
    if (field.type !== 'rollup') return values[field.key] ?? null;
    const relation = database.data.fields.find(item => item.key === field.relation && item.type === 'relation');
    const ids = relation && values[relation.key] || [], related = ids.map(id => notes.find(n => n.id === id && n.meta.databaseId === relation.target)).filter(Boolean);
    if (field.aggregate === 'count') return related.length;
    const targetField = databases.find(d => d.id === relation?.target)?.data.fields.find(f => f.key === field.field && f.type === 'number');
    if (!targetField) return null;
    const numbers = related.map(n => n.meta.values[targetField.key]).filter(n => typeof n === 'number' && Number.isFinite(n));
    if (!numbers.length) return field.aggregate === 'sum' ? 0 : null;
    const sum = numbers.reduce((a, b) => a + b, 0); return field.aggregate === 'average' ? sum / numbers.length : sum;
}
export function displayValue(value, field, notes = []) {
    if (value === null || value === undefined || value === '') return '—';
    if (field?.type === 'relation') return value.map(id => notes.find(n => n.id === id)?.title || `已失效笔记 #${id}`).join('、');
    if (typeof value === 'boolean') return value ? '是' : '否';
    if (Array.isArray(value)) return value.join('、');
    if (typeof value === 'object') return `${value.start || ''} ～ ${value.end || ''}`;
    return String(value);
}
export function visibleDatabaseNotes(database, view, notes, databases) {
    if (!database) return [];
    const field = key => key === 'title' ? { key: 'title', type: 'text' } : database.data.fields.find(f => f.key === key);
    const value = (note, key) => { const f = field(key); return f ? propertyValue(note, f, database, notes, databases) : null; };
    let selected = notes.filter(n => n.meta.databaseId === database.id).filter(note => (view.filters || []).every(filter => {
        const raw = value(note, filter.field), empty = raw == null || raw === '' || Array.isArray(raw) && !raw.length;
        const text = empty ? '' : displayValue(raw, field(filter.field), notes).toLocaleLowerCase();
        if (filter.op === 'empty') return empty; if (filter.op === 'not-empty') return !empty;
        return filter.op === 'equals' ? text === filter.value.toLocaleLowerCase() : text.includes(filter.value.toLocaleLowerCase());
    }));
    if (view.sort) selected = selected.slice().sort((a, b) => {
        const av = value(a, view.sort), bv = value(b, view.sort);
        const result = typeof av === 'number' && typeof bv === 'number' ? av - bv : displayValue(av, field(view.sort), notes).localeCompare(displayValue(bv, field(view.sort), notes), 'zh-CN', { numeric: true });
        return (view.direction === 'desc' ? -result : result) || a.id - b.id;
    });
    return selected;
}
export function groupNotes(rows, key, database, notes, databases) {
    const field = database.data.fields.find(f => f.key === key), groups = new Map();
    for (const note of rows) { const name = field ? displayValue(propertyValue(note, field, database, notes, databases), field, notes) : '全部'; if (!groups.has(name)) groups.set(name, []); groups.get(name).push(note); }
    return [...groups].map(([name, items]) => ({ name, items }));
}
export function splitMarkdownBlocks(md) {
    if (!md) return ['']; const blocks = [], lines = md.replace(/\r\n/g, '\n').split('\n'); let buffer = [], fence = '', callout = false;
    for (const line of lines) {
        const match = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
        if (match) { if (!fence) fence = match[1]; else if (match[1][0] === fence[0] && match[1].length >= fence.length) fence = ''; }
        if (!fence && /^:::(?:toggle|callout)\s/.test(line)) callout = true; else if (callout && line === ':::') callout = false;
        if (!line.trim() && !fence && !callout) { if (buffer.length) { blocks.push(buffer.join('\n')); buffer = []; } }
        else buffer.push(line);
    }
    if (buffer.length) blocks.push(buffer.join('\n')); return blocks.length ? blocks : [''];
}
export const blockSnippets = [
    ['正文', ''], ['一级标题', '# 标题'], ['二级标题', '## 标题'], ['待办清单', '- [ ] 待办事项'], ['无序列表', '- 列表项'], ['引用', '> 引用文字'], ['代码', '```\n代码\n```'], ['分隔线', '---'], ['提示块', ':::callout 提示\n提示内容\n:::'], ['折叠列表', ':::toggle 点击展开\n折叠内容\n:::'], ['笔记链接', '[[笔记名称]]'], ['块嵌入', '![[笔记名称#标题]]']
];
