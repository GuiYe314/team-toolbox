import express from 'express';
import { createToolAccess } from './tool-access.js';
import { listSopTemplates, getSopTemplate, saveSopTemplate, deleteSopTemplate, startSopRun, listSopRuns, getSopRun, changeSopRun, deleteSopRun } from './knowledge-sops-store.js';

export function registerKnowledgeSopsApi(app, { getDb, access = createToolAccess(), log = message => console.warn(message) }) {
    const router = express.Router(), fail = (code, message) => { const error = new Error(message); error.code = code; throw error; };
    router.use((req, res, next) => {
        res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
        if (!access.allows(req, { browser: true })) return access.deny(res);
        if (req.get('x-toolbox-sop') !== '1') return res.status(403).json({ error: 'forbidden', message: '请从知识库SOP页面操作' });
        next();
    });
    router.use(express.json({ limit: '128kb', strict: true }));
    const wrap = action => (req, res) => {
        try { action(req, res); }
        catch (error) {
            const status = { invalid_input: 400, confirmation_required: 400, not_found: 404, conflict: 409 }[error.code];
            log(`[knowledge-sop] ${req.method} failed (${status ? error.code : 'storage_error'})`);
            res.status(status || 503).json({ error: status ? error.code : 'storage_error', message: status ? error.message : 'SOP读取或保存失败，请重试' });
        }
    };
    function input(req, fields) {
        if (Object.keys(req.query).length || !req.body || Array.isArray(req.body) || Object.keys(req.body).some(key => !fields.includes(key))) fail('invalid_input', 'SOP参数不正确'); return req.body;
    }
    function noQuery(req) { if (Object.keys(req.query).length) fail('invalid_input', '此操作不接受附加参数'); }
    function confirmed(req) {
        if (req.query.confirm !== '1' || Object.keys(req.query).some(key => !['confirm', 'version'].includes(key))) fail('confirmation_required', '请先确认删除');
        if (!/^[1-9]\d{0,9}$/.test(req.query.version || '')) fail('invalid_input', '请重新读取版本后删除'); return Number(req.query.version);
    }
    router.get('/templates', wrap((req, res) => { noQuery(req); res.json({ items: listSopTemplates(getDb()) }); }));
    router.get('/templates/:id', wrap((req, res) => { noQuery(req); res.json(getSopTemplate(getDb(), req.params.id)); }));
    router.post('/templates', wrap((req, res) => res.status(201).json(saveSopTemplate(getDb(), input(req, ['name', 'description', 'steps'])))));
    router.put('/templates/:id', wrap((req, res) => res.json(saveSopTemplate(getDb(), input(req, ['name', 'description', 'steps', 'version']), req.params.id))));
    router.delete('/templates/:id', wrap((req, res) => { deleteSopTemplate(getDb(), req.params.id, confirmed(req)); res.json({ deleted: true }); }));
    router.post('/templates/:id/runs', wrap((req, res) => { const result = startSopRun(getDb(), req.params.id, input(req, ['version', 'requestId'])); res.status(result.created ? 201 : 200).json(result); }));
    router.get('/runs', wrap((req, res) => {
        if (Object.keys(req.query).some(key => !['offset', 'status'].includes(key)) || req.query.offset !== undefined && !/^\d{1,4}$/.test(req.query.offset)) fail('invalid_input', '历史筛选参数不正确');
        res.json(listSopRuns(getDb(), { offset: req.query.offset === undefined ? 0 : Number(req.query.offset), status: req.query.status ?? '' }));
    }));
    router.get('/runs/:id', wrap((req, res) => { noQuery(req); res.json(getSopRun(getDb(), req.params.id)); }));
    router.patch('/runs/:id', wrap((req, res) => {
        const value = input(req, ['version', 'stepId', 'done', 'notes', 'complete']);
        const actions = ['stepId', 'notes', 'complete'].filter(key => Object.hasOwn(value, key));
        if (actions.length !== 1 || Object.hasOwn(value, 'done') !== Object.hasOwn(value, 'stepId')) fail('invalid_input', '每次只能执行一个清单操作');
        res.json(changeSopRun(getDb(), req.params.id, value));
    }));
    router.delete('/runs/:id', wrap((req, res) => { deleteSopRun(getDb(), req.params.id, confirmed(req)); res.json({ deleted: true }); }));
    router.use((error, _req, res, _next) => res.status(error.status === 413 ? 413 : 400).json({ error: 'invalid_input', message: error.status === 413 ? 'SOP参数超过128KiB限制' : '请提交有效JSON参数' }));
    app.use('/api/knowledge-sops', router);
}
