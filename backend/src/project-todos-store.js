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
    return {
        name, nameKey: nameKey(name), description: text(value.description ?? '', '项目说明', 1000),
        status: option(value.status, ['planning', 'active', 'paused', 'completed', 'archived'], 'active', '项目状态'),
        dueDate: dueDate(value.dueDate)
    };
}

function option(value, options, fallback, label) {
    if (value === undefined) return fallback;
    if (!options.includes(value)) bad(`${label}不正确`);
    return value;
}

function dueDate(value) {
    if (value === undefined || value === null) return null;
    if (typeof value !== 'string' || !/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value)) bad('截止日期不正确');
    iso(value + 'T00:00:00.000Z', '截止日期');
    return value;
}

function tags(value = []) {
    if (!Array.isArray(value) || value.length > 10) bad('每条待办最多10个标签');
    const normalized = value.map(tag => text(tag, '标签', 30, true));
    if (normalized.some(tag => /[,，\r\n]/.test(tag))) bad('标签内不能包含逗号或换行');
    return [...new Set(normalized)];
}

function todoInput(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) bad('待办参数不正确');
    return {
        issue: text(value.issue, '问题', 200, true), details: text(value.details ?? '', '待办说明', 2000),
        priority: option(value.priority, ['urgent', 'high', 'normal', 'low'], 'normal', '优先级'),
        stage: option(value.stage, ['pending', 'doing'], 'pending', '处理阶段'),
        dueDate: dueDate(value.dueDate), assignee: text(value.assignee === undefined ? '' : value.assignee, '负责人', 60),
        tags: tags(value.tags)
    };
}

function projectRow(row) {
    return {
        id: row.id,
        name: row.name,
        description: row.description,
        status: row.status,
        dueDate: row.due_at,
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
        priority: row.priority,
        stage: row.stage,
        dueDate: row.due_at,
        assignee: row.assignee,
        tags: JSON.parse(row.tags_json),
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
    return db.transaction(() => {
        const old = id ? project(db, id) : null;
        if (!value || typeof value !== 'object' || Array.isArray(value)) bad('项目参数不正确');
        if (old) current(old, value.version);
        const checked = projectInput({ ...value,
            status: value.status === undefined ? old?.status : value.status,
            dueDate: value.dueDate === undefined ? old?.due_at : value.dueDate
        });
        const serializedDelta = Buffer.byteLength(checked.name + checked.description);
        if (!old && db.prepare('SELECT COUNT(*) AS n FROM kb_projects').get().n >= MAX_PROJECTS) conflict(`最多${MAX_PROJECTS}个项目，请先整理项目`);
        const duplicate = db.prepare('SELECT id FROM kb_projects WHERE name_key=? AND id<>?').get(checked.nameKey, id || '');
        if (duplicate) conflict('已有同名项目，请换一个名称');
        sizeAllowed(db, serializedDelta - (old ? Buffer.byteLength(old.name + old.description) : 0));
        const now = new Date().toISOString(), ownId = id || randomUUID();
        if (old) {
            db.prepare('UPDATE kb_projects SET name=?,name_key=?,description=?,status=?,due_at=?,version=version+1,updated_at=? WHERE id=?')
                .run(checked.name, checked.nameKey, checked.description, checked.status, checked.dueDate, now, ownId);
        } else {
            db.prepare('INSERT INTO kb_projects(id,name,name_key,description,status,due_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)')
                .run(ownId, checked.name, checked.nameKey, checked.description, checked.status, checked.dueDate, now, now);
        }
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
        db.prepare(`INSERT INTO kb_project_todos(id,project_id,issue,details,priority,stage,due_at,assignee,tags_json,created_at,updated_at)
            VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(id, projectId, checked.issue, checked.details, checked.priority, checked.stage,
            checked.dueDate, checked.assignee, JSON.stringify(checked.tags), now, now);
        db.prepare('UPDATE kb_projects SET updated_at=? WHERE id=?').run(now, projectId);
        return todoRow(todo(db, id));
    })();
}

export function getTodo(db, id) {
    return todoRow(todo(db, id));
}

export function saveTodo(db, id, value) {
    return db.transaction(() => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) bad('待办参数不正确');
        const old = todo(db, id); current(old, value.version);
        const previous = todoRow(old);
        const checked = todoInput({
            priority: previous.priority, stage: previous.stage, dueDate: previous.dueDate,
            assignee: previous.assignee, tags: previous.tags, ...value
        });
        sizeAllowed(db, Buffer.byteLength(checked.issue + checked.details) - Buffer.byteLength(old.issue + old.details));
        const now = new Date().toISOString();
        db.prepare(`UPDATE kb_project_todos SET issue=?,details=?,priority=?,stage=?,due_at=?,assignee=?,tags_json=?,
            version=version+1,updated_at=? WHERE id=?`).run(checked.issue, checked.details, checked.priority, checked.stage,
            checked.dueDate, checked.assignee, JSON.stringify(checked.tags), now, old.id);
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
        projects: db.prepare('SELECT * FROM kb_projects ORDER BY id').all().map(row => {
            const { todoCount, activeCount, archivedCount, ...item } = projectRow(row);
            return item;
        }),
        todos: db.prepare('SELECT * FROM kb_project_todos ORDER BY id').all().map(row => {
            const { projectName, isArchived, ...item } = todoRow(row);
            return item;
        })
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
            db.prepare(`INSERT INTO kb_projects(id,name,name_key,description,status,due_at,version,created_at,updated_at)
                VALUES(?,?,?,?,?,?,?,?,?)`).run(item.id, item.name, item.nameKey, item.description, item.status, item.dueDate,
                item.version, item.createdAt, item.updatedAt);
            projectIds.set(item.id, item.id); stats.projects++;
        }
        for (const item of checked.todos) {
            const projectId = projectIds.get(item.projectId);
            if (db.prepare('SELECT 1 FROM kb_project_todos WHERE id=?').get(item.id)) { stats.skipped++; continue; }
            if (db.prepare('SELECT COUNT(*) AS n FROM kb_project_todos').get().n >= MAX_TODOS) conflict(`导入后超过${MAX_TODOS}条待办限制`);
            db.prepare(`INSERT INTO kb_project_todos(id,project_id,issue,details,status,priority,stage,due_at,assignee,tags_json,
                version,created_at,updated_at,completed_at,archived_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
                .run(item.id, projectId, item.issue, item.details, item.status, item.priority, item.stage, item.dueDate,
                    item.assignee, JSON.stringify(item.tags), item.version, item.createdAt, item.updatedAt, item.completedAt, item.archivedAt);
            stats.todos++;
        }
        sizeAllowed(db, 0);
        return stats;
    })();
}
