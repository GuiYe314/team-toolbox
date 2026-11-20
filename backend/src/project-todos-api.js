import express from 'express';
import { createToolAccess } from './tool-access.js';
import { createTodo, deleteProject, deleteTodo, getProject, getTodo, listProjectTodos, listProjects, saveProject, saveTodo, setTodoArchived } from './project-todos-store.js';

export function registerProjectTodosApi(app, { getDb, access = createToolAccess(), log = message => console.warn(message) }) {
    const router = express.Router();
    const fail = (code, message) => { const error = new Error(message); error.code = code; throw error; };
    router.use((req, res, next) => {
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        if (!access.allows(req, { browser: true })) return access.deny(res);
        if (req.get('x-toolbox-project-todos') !== '1') return res.status(403).json({ error: 'forbidden', message: '请从项目待办页面操作' });
        next();
    });
    router.use(express.json({ limit: '128kb', strict: true }));
    const wrap = action => (req, res) => {
        try { action(req, res); }
        catch (error) {
            const status = { invalid_input: 400, confirmation_required: 400, not_found: 404, conflict: 409 }[error.code];
            log(`[project-todos] ${req.method} failed (${status ? error.code : 'storage_error'})`);
            res.status(status || 503).json({ error: status ? error.code : 'storage_error', message: status ? error.message : '项目待办读取或保存失败，请重试' });
        }
    };
    function input(req, fields) {
        if (Object.keys(req.query).length || !req.body || Array.isArray(req.body) || Object.keys(req.body).some(key => !fields.includes(key))) fail('invalid_input', '项目待办参数不正确');
        return req.body;
    }
    function noQuery(req) { if (Object.keys(req.query).length) fail('invalid_input', '此操作不接受附加参数'); }
    function confirmed(req) {
        if (req.query.confirm !== '1' || Object.keys(req.query).some(key => !['confirm', 'version'].includes(key))) fail('confirmation_required', '请先确认删除');
        if (!/^[1-9]\d{0,9}$/.test(req.query.version || '')) fail('invalid_input', '请重新读取版本后删除');
        return Number(req.query.version);
    }
    router.get('/state', wrap((req, res) => {
        if (Object.keys(req.query).some(key => key !== 'view')) fail('invalid_input', '项目待办筛选不正确');
        res.json(listProjectTodos(getDb(), { view: req.query.view || 'active' }));
    }));
    router.get('/projects', wrap((req, res) => { noQuery(req); res.json({ items: listProjects(getDb()) }); }));
    router.post('/projects', wrap((req, res) => res.status(201).json(saveProject(getDb(), input(req, ['name', 'description'])))));
    router.get('/projects/:id', wrap((req, res) => { noQuery(req); res.json(getProject(getDb(), req.params.id)); }));
    router.put('/projects/:id', wrap((req, res) => res.json(saveProject(getDb(), input(req, ['name', 'description', 'version']), req.params.id))));
    router.delete('/projects/:id', wrap((req, res) => { deleteProject(getDb(), req.params.id, confirmed(req)); res.json({ deleted: true }); }));
    router.post('/projects/:id/todos', wrap((req, res) => res.status(201).json(createTodo(getDb(), req.params.id, input(req, ['issue', 'details'])))));
    router.get('/todos/:id', wrap((req, res) => { noQuery(req); res.json(getTodo(getDb(), req.params.id)); }));
    router.put('/todos/:id', wrap((req, res) => res.json(saveTodo(getDb(), req.params.id, input(req, ['issue', 'details', 'version'])))));
    router.patch('/todos/:id', wrap((req, res) => res.json(setTodoArchived(getDb(), req.params.id, input(req, ['archived', 'version'])))));
    router.delete('/todos/:id', wrap((req, res) => { deleteTodo(getDb(), req.params.id, confirmed(req)); res.json({ deleted: true }); }));
    router.use((error, _req, res, _next) => res.status(error.status === 413 ? 413 : 400).json({ error: 'invalid_input', message: error.status === 413 ? '项目待办请求超过128KiB限制' : '请提交有效JSON参数' }));
    app.use('/api/project-todos', router);
}
