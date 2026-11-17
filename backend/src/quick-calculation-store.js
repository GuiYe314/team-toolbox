import { normalizeCalculation } from './quick-calculation-math.js';

const failure = (code, message) => { const error = new Error(message); error.code = code; return error; };
function named(value) {
    const name = typeof value?.name === 'string' ? value.name.trim() : '';
    if (!name || name.length > 60 || /\p{C}/u.test(name)) throw failure('invalid_input', '方案名称请输入1～60个可见字符');
    return { name, key: name.normalize('NFKC').toLowerCase(), parameters: normalizeCalculation(value) };
}
const fromRow = row => ({ id: row.id, name: row.name, ...JSON.parse(row.parameters_json), createdAt: row.created_at });
export function listCalculations(db) {
    // 兼容只导出旧schema的离线维护场景；正常启动必须先完成009迁移。
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='quick_calculations'").get()) return [];
    return db.prepare('SELECT * FROM quick_calculations ORDER BY id DESC LIMIT 500').all().map(fromRow);
}
export function saveCalculation(db, value) {
    const item = named(value), parameters = JSON.stringify(item.parameters);
    return db.transaction(() => {
        const existing = db.prepare('SELECT * FROM quick_calculations WHERE name_key = ?').get(item.key);
        if (existing) {
            if (existing.parameters_json === parameters) return { item: fromRow(existing), created: false };
            throw failure('conflict', '已有同名方案，请修改名称后另存为新方案');
        }
        if (db.prepare('SELECT COUNT(*) AS n FROM quick_calculations').get().n >= 500) throw failure('conflict', '最多保存500个方案，请先删除不需要的方案');
        const inserted = db.prepare('INSERT INTO quick_calculations (name, name_key, parameters_json) VALUES (?, ?, ?)').run(item.name, item.key, parameters);
        return { item: fromRow(db.prepare('SELECT * FROM quick_calculations WHERE id = ?').get(inserted.lastInsertRowid)), created: true };
    })();
}
export function deleteCalculation(db, id) {
    if (!Number.isSafeInteger(id) || id < 1) throw failure('invalid_input', '方案编号不正确');
    if (!db.prepare('DELETE FROM quick_calculations WHERE id = ?').run(id).changes) throw failure('not_found', '方案已不存在，请刷新列表');
}
export function validateCalculationBackup(value) {
    if (value === undefined) return [];
    if (!Array.isArray(value) || value.length > 500) throw failure('invalid_input', '备份中的快速计算方案列表不正确或超过500项');
    return value.map(item => { const checked = named(item); return { name: checked.name, ...checked.parameters }; });
}
export function importCalculations(db, values) {
    const result = { imported: 0, skipped: 0 };
    for (const value of values) {
        try { const saved = saveCalculation(db, value); result[saved.created ? 'imported' : 'skipped']++; }
        catch (error) { if (error.code !== 'conflict') throw error; result.skipped++; }
    }
    return result;
}
