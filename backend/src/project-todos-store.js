import { randomUUID } from 'node:crypto';

const MAX_PROJECTS = 100;
const MAX_TODOS = 5000;
const MAX_BYTES = 8 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const failure = (code, message) => { const error = new Error(message); error.code = code; return error; };
const bad = message => { throw failure('invalid_input', message); };
const conflict = message => { throw failure('conflict', message); };

export function projectTodoId(value, label = '编号') {
    if (typeof value !== 'string' || !UUID.test(value)) bad(`${label}不正确`);
    return value;
}

function text(value, label, max, required = false) {
    if (typeof value !== 'string' || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) bad(`${label}最多${max}字，请使用普通文字`);
    const result = value.trim();
    if (required && !result) bad(`请填写${label}`);
    return result;
}

function version(value) {
    if (!Number.isSafeInteger(value) || value < 1 || value > 2147483647) bad('版本不正确，请重新读取');
    return value;
}

function nameKey(value) {
    if (/\p{C}/u.test(value)) bad('项目名称请使用可见文字');
    return value.normalize('NFKC').toLowerCase();
}

function iso(value, label) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
        || Number.isNaN(Date.parse(value)) || new Date(value).toISOString() !== value) bad(`${label}不正确`);
    return value;
}

function projectInput(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) bad('项目参数不正确');
    const name = text(value.name, '项目名称', 80, true);
    return { name, nameKey: nameKey(name), description: text(value.description ?? '', '项目说明', 1000) };
}

function todoInput(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) bad('待办参数不正确');
    return { issue: text(value.issue, '问题', 200, true), details: text(value.details ?? '', '待办说明', 2000) };
}

function projectRow(row) {
    return {
        id: row.id,
        name: row.name,
        description: row.description,
        version: row.version,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        todoCount: Number(row.todo_count ?? 0),
        activeCount: Number(row.active_count ?? 0),
        archivedCount: Number(row.archived_count ?? 0)
    };
}

function todoRow(row) {
    return {
        id: row.id,
        projectId: row.project_id,
        projectName: row.project_name,
        issue: row.issue,
        details: row.details,
        status: row.status,
        version: row.version,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        completedAt: row.completed_at,
        archivedAt: row.archived_at,
        isArchived: row.status === 'archived'
    };
}

function project(db, id) {
    const row = db.prepare(`
        SELECT p.*,
          (SELECT COUNT(*) FROM kb_project_todos t WHERE t.project_id = p.id) AS todo_count,
          (SELECT COUNT(*) FROM kb_project_todos t WHERE t.project_id = p.id AND t.status = 'active') AS active_count,
          (SELECT COUNT(*) FROM kb_project_todos t WHERE t.project_id = p.id AND t.status = 'archived') AS archived_count
        FROM kb_projects p WHERE p.id=?
    `).get(projectTodoId(id, '项目编号'));
    if (!row) throw failure('not_found', '项目不存在，请刷新后重试');
    return row;
}

function todo(db, id) {
    const row = db.prepare(`
        SELECT t.*, p.name AS project_name
        FROM kb_project_todos t JOIN kb_projects p ON p.id=t.project_id
        WHERE t.id=?
    `).get(projectTodoId(id, '待办编号'));
    if (!row) throw failure('not_found', '待办不存在，请刷新后重试');
    return row;
}

function current(row, expected) {
    if (row.version !== version(expected)) conflict('内容已被其他页面修改，请重新读取后再操作；当前草稿仍保留');
}

function sizeAllowed(db, delta) {
    const row = db.prepare(`
        SELECT COALESCE((SELECT SUM(length(CAST(name AS BLOB)) + length(CAST(description AS BLOB))) FROM kb_projects), 0)
          + COALESCE((SELECT SUM(length(CAST(issue AS BLOB)) + length(CAST(details AS BLOB))) FROM kb_project_todos), 0) AS n
    `).get();
    if (row.n + delta > MAX_BYTES) conflict('项目待办正文达到8MiB上限，请先整理不需要的内容');
}

export function listProjects(db) {
    return db.prepare(`
        SELECT p.*,
          (SELECT COUNT(*) FROM kb_project_todos t WHERE t.project_id = p.id) AS todo_count,
          (SELECT COUNT(*) FROM kb_project_todos t WHERE t.project_id = p.id AND t.status = 'active') AS active_count,
          (SELECT COUNT(*) FROM kb_project_todos t WHERE t.project_id = p.id AND t.status = 'archived') AS archived_count
        FROM kb_projects p ORDER BY p.updated_at DESC, p.id
    `).all().map(projectRow);
}

export function getProject(db, id) {
    return projectRow(project(db, id));
}

export function listProjectTodos(db, { view = 'active' } = {}) {
    if (!['active', 'archived', 'all'].includes(view)) bad('项目待办筛选不正确');
    const projects = listProjects(db);
    const where = view === 'all' ? '' : ' WHERE t.status=?';
    const params = view === 'all' ? [] : [view];
    const rows = db.prepare(`
        SELECT t.*, p.name AS project_name
        FROM kb_project_todos t JOIN kb_projects p ON p.id=t.project_id
        ${where}
        ORDER BY p.updated_at DESC, p.id, t.status, t.updated_at DESC, t.id
    `).all(...params).map(todoRow);
    const byProject = new Map(projects.map(item => [item.id, { ...item, todos: [] }]));
    for (const row of rows) byProject.get(row.projectId)?.todos.push(row);
    return { projects: [...byProject.values()], view, total: rows.length };
}

export function saveProject(db, value, id) {
    const checked = projectInput(value);
    const serializedDelta = Buffer.byteLength(checked.name + checked.description);
    return db.transaction(() => {
        const old = id ? project(db, id) : null;
        if (old) current(old, value.version);
        if (!old && db.prepare('SELECT COUNT(*) AS n FROM kb_projects').get().n >= MAX_PROJECTS) conflict(`最多${MAX_PROJECTS}个项目，请先整理项目`);
        const duplicate = db.prepare('SELECT id FROM kb_projects WHERE name_key=? AND id<>?').get(checked.nameKey, id || '');
        if (duplicate) conflict('已有同名项目，请换一个名称');
        sizeAllowed(db, serializedDelta - (old ? Buffer.byteLength(old.name + old.description) : 0));
        const now = new Date().toISOString(), ownId = id || randomUUID();
        if (old) db.prepare('UPDATE kb_projects SET name=?,name_key=?,description=?,version=version+1,updated_at=? WHERE id=?').run(checked.name, checked.nameKey, checked.description, now, ownId);
        else db.prepare('INSERT INTO kb_projects(id,name,name_key,description,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(ownId, checked.name, checked.nameKey, checked.description, now, now);
        return getProject(db, ownId);
    })();
}

export function deleteProject(db, id, expected) {
    db.transaction(() => {
        const old = project(db, id); current(old, expected);
        const count = db.prepare('SELECT COUNT(*) AS n FROM kb_project_todos WHERE project_id=?').get(old.id).n;
        if (count) conflict('项目下仍有进行中或已归档待办，请先整理待办后再删除项目');
        db.prepare('DELETE FROM kb_projects WHERE id=?').run(old.id);
    })();
}

export function createTodo(db, projectId, value) {
    const checked = todoInput(value);
    return db.transaction(() => {
        project(db, projectId);
        if (db.prepare('SELECT COUNT(*) AS n FROM kb_project_todos').get().n >= MAX_TODOS) conflict(`最多${MAX_TODOS}条待办，请先整理归档记录`);
        sizeAllowed(db, Buffer.byteLength(checked.issue + checked.details));
        const now = new Date().toISOString(), id = randomUUID();
        db.prepare('INSERT INTO kb_project_todos(id,project_id,issue,details,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(id, projectId, checked.issue, checked.details, now, now);
        db.prepare('UPDATE kb_projects SET updated_at=? WHERE id=?').run(now, projectId);
        return todoRow(todo(db, id));
    })();
}

export function getTodo(db, id) {
    return todoRow(todo(db, id));
}

export function saveTodo(db, id, value) {
    const checked = todoInput(value);
    return db.transaction(() => {
        const old = todo(db, id); current(old, value.version);
        sizeAllowed(db, Buffer.byteLength(checked.issue + checked.details) - Buffer.byteLength(old.issue + old.details));
        const now = new Date().toISOString();
        db.prepare('UPDATE kb_project_todos SET issue=?,details=?,version=version+1,updated_at=? WHERE id=?').run(checked.issue, checked.details, now, old.id);
        db.prepare('UPDATE kb_projects SET updated_at=? WHERE id=?').run(now, old.project_id);
        return todoRow(todo(db, old.id));
    })();
}

export function setTodoArchived(db, id, value) {
    if (!value || typeof value !== 'object' || typeof value.archived !== 'boolean') bad('归档状态不正确');
    return db.transaction(() => {
        const old = todo(db, id); current(old, value.version);
        const now = new Date().toISOString(), archived = value.archived;
        db.prepare(`UPDATE kb_project_todos
            SET status=?, completed_at=?, archived_at=?, version=version+1, updated_at=?
            WHERE id=?`).run(archived ? 'archived' : 'active', archived ? (old.completed_at || now) : null, archived ? (old.archived_at || now) : null, now, old.id);
        db.prepare('UPDATE kb_projects SET updated_at=? WHERE id=?').run(now, old.project_id);
        return todoRow(todo(db, old.id));
    })();
}

export function deleteTodo(db, id, expected) {
    db.transaction(() => {
        const old = todo(db, id); current(old, expected); db.prepare('DELETE FROM kb_project_todos WHERE id=?').run(old.id);
        db.prepare('UPDATE kb_projects SET updated_at=? WHERE id=?').run(new Date().toISOString(), old.project_id);
    })();
}

function dateValue(value, label) {
    if (value === null) return null;
    return iso(value, label);
}

export function exportProjectTodos(db) {
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE name='kb_projects' AND type='table'").get()) return { projects: [], todos: [] };
    return {
        projects: db.prepare('SELECT id,name,description,version,created_at,updated_at FROM kb_projects ORDER BY id').all().map(row => ({ id: row.id, name: row.name, description: row.description, version: row.version, createdAt: row.created_at, updatedAt: row.updated_at })),
        todos: db.prepare('SELECT id,project_id,issue,details,status,version,created_at,updated_at,completed_at,archived_at FROM kb_project_todos ORDER BY id').all().map(row => ({ id: row.id, projectId: row.project_id, issue: row.issue, details: row.details, status: row.status, version: row.version, createdAt: row.created_at, updatedAt: row.updated_at, completedAt: row.completed_at, archivedAt: row.archived_at }))
    };
}

export function validateProjectTodoBackup(value) {
    if (value === undefined) return { projects: [], todos: [] };
    if (!value || !Array.isArray(value.projects) || !Array.isArray(value.todos) || value.projects.length > MAX_PROJECTS || value.todos.length > MAX_TODOS) bad('项目待办备份格式不正确或超过限额');
    const projects = value.projects.map(item => {
        if (!item || typeof item !== 'object') bad('项目待办备份中的项目不正确');
        const checked = projectInput(item);
        return { id: projectTodoId(item.id, '项目编号'), ...checked, version: version(item.version), createdAt: iso(item.createdAt, '创建时间'), updatedAt: iso(item.updatedAt, '修改时间') };
    });
    const ids = new Set(projects.map(item => item.id));
    if (ids.size !== projects.length) bad('项目编号不能重复');
    if (new Set(projects.map(item => item.nameKey)).size !== projects.length) bad('备份中的项目名称不能重复');
    const todos = value.todos.map(item => {
        if (!item || typeof item !== 'object') bad('项目待办备份中的待办不正确');
        const checked = todoInput(item);
        if (!['active', 'archived'].includes(item.status)) bad('项目待办状态不正确');
        if (!ids.has(item.projectId)) bad('项目待办引用的项目不存在');
        const completedAt = dateValue(item.completedAt, '完成时间'), archivedAt = dateValue(item.archivedAt, '归档时间');
        if (item.status === 'active' && (completedAt !== null || archivedAt !== null)
            || item.status === 'archived' && (!completedAt || !archivedAt)) bad('项目待办状态与归档时间不一致');
        return { id: projectTodoId(item.id, '待办编号'), projectId: projectTodoId(item.projectId, '项目编号'), ...checked, status: item.status, version: version(item.version), createdAt: iso(item.createdAt, '创建时间'), updatedAt: iso(item.updatedAt, '修改时间'), completedAt, archivedAt };
    });
    if (new Set(todos.map(item => item.id)).size !== todos.length) bad('待办编号不能重复');
    const bytes = projects.reduce((n, item) => n + Buffer.byteLength(item.name + item.description), 0)
        + todos.reduce((n, item) => n + Buffer.byteLength(item.issue + item.details), 0);
    if (bytes > MAX_BYTES) bad('项目待办备份正文超过8MiB限制');
    return { projects, todos };
}

export function importProjectTodos(db, value) {
    const checked = validateProjectTodoBackup(value);
    return db.transaction(() => {
        const stats = { projects: 0, todos: 0, skipped: 0 }, projectIds = new Map();
        for (const item of checked.projects) {
            // ID优先；项目改名后再导入旧备份时仍归于原项目。
            const existing = db.prepare('SELECT id FROM kb_projects WHERE id=?').get(item.id)
                || db.prepare('SELECT id FROM kb_projects WHERE name_key=?').get(item.nameKey);
            if (existing) { projectIds.set(item.id, existing.id); stats.skipped++; continue; }
            if (db.prepare('SELECT COUNT(*) AS n FROM kb_projects').get().n >= MAX_PROJECTS) conflict(`导入后超过${MAX_PROJECTS}个项目限制`);
            db.prepare('INSERT INTO kb_projects(id,name,name_key,description,version,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run(item.id, item.name, item.nameKey, item.description, item.version, item.createdAt, item.updatedAt);
            projectIds.set(item.id, item.id); stats.projects++;
        }
        for (const item of checked.todos) {
            const projectId = projectIds.get(item.projectId);
            if (db.prepare('SELECT 1 FROM kb_project_todos WHERE id=?').get(item.id)) { stats.skipped++; continue; }
            if (db.prepare('SELECT COUNT(*) AS n FROM kb_project_todos').get().n >= MAX_TODOS) conflict(`导入后超过${MAX_TODOS}条待办限制`);
            db.prepare('INSERT INTO kb_project_todos(id,project_id,issue,details,status,version,created_at,updated_at,completed_at,archived_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(item.id, projectId, item.issue, item.details, item.status, item.version, item.createdAt, item.updatedAt, item.completedAt, item.archivedAt);
            stats.todos++;
        }
        sizeAllowed(db, 0);
        return stats;
    })();
}
