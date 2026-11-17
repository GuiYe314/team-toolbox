import express from 'express';
import { createToolAccess } from './tool-access.js';
import { calculateRange } from './quick-calculation-math.js';
import { deleteCalculation, listCalculations, saveCalculation } from './quick-calculation-store.js';

export function registerQuickCalculationApi(app, { getDb, access = createToolAccess(), log = message => console.warn(message) }) {
    const router = express.Router();
    router.use((req, res, next) => {
        res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
        if (!access.allows(req, { browser: true })) return access.deny(res);
        if (req.get('x-toolbox-calculation') !== '1') return res.status(403).json({ error: 'forbidden', message: '请从工具箱快速计算页面操作' });
        next();
    });
    router.use(express.json({ limit: '8kb', strict: true }));
    const wrap = fn => (req, res) => {
        try { fn(req, res); }
        catch (error) {
            const known = ['invalid_input', 'confirmation_required', 'conflict', 'not_found'].includes(error.code);
            log(`[quick-calculation] ${req.method} failed (${known ? error.code : 'storage_error'})`);
            res.status(({ invalid_input: 400, confirmation_required: 400, conflict: 409, not_found: 404 })[error.code] || 503)
                .json({ error: known ? error.code : 'storage_error', message: known ? error.message : '计算方案读取或保存失败，请重试' });
        }
    };
    function fields(req, saving = false) {
        const allowed = ['base', 'rate', 'rateMode', 'count', 'precision', ...(saving ? ['name'] : [])];
        if (!req.body || Array.isArray(req.body) || Object.keys(req.body).some(key => !allowed.includes(key)) || Object.keys(req.query).length) {
            const error = new Error('计算参数不正确'); error.code = 'invalid_input'; throw error;
        }
        return req.body;
    }
    router.post('/preview', wrap((req, res) => res.json(calculateRange(fields(req)))));
    router.get('/', wrap((req, res) => {
        if (Object.keys(req.query).length) return res.status(400).json({ error: 'invalid_input', message: '列表不接受附加参数' });
        res.json({ items: listCalculations(getDb()) });
    }));
    router.post('/', wrap((req, res) => {
        const saved = saveCalculation(getDb(), fields(req, true)); res.status(saved.created ? 201 : 200).json(saved);
    }));
    router.delete('/:id', wrap((req, res) => {
        if (req.query.confirm !== '1' || Object.keys(req.query).length !== 1) { const error = new Error('请先确认删除方案'); error.code = 'confirmation_required'; throw error; }
        if (!/^[1-9]\d{0,14}$/.test(req.params.id)) { const error = new Error('方案编号不正确'); error.code = 'invalid_input'; throw error; }
        deleteCalculation(getDb(), Number(req.params.id)); res.json({ deleted: true });
    }));
    router.use((error, _req, res, _next) => res.status(error.status === 413 ? 413 : 400).json({ error: 'invalid_input', message: error.status === 413 ? '计算参数超过8KiB限制' : '请提交有效JSON参数' }));
    app.use('/api/quick-calculations', router);
}
