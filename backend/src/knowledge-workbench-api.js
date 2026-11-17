import express from 'express';
import archiver from 'archiver';
import { createToolAccess } from './tool-access.js';
import { workbenchState, getEntry, saveEntry, deleteEntry, readNote, createWorkbenchNote, saveWorkbenchNote, revisions, restoreRevision, runAction } from './knowledge-workbench-store.js';
import { clipWebPage, importMarkdownFiles, markdownExportFiles } from './knowledge-transfer.js';
import { fail, object, integer } from './knowledge-workbench-validation.js';

export function registerKnowledgeWorkbenchApi(app, { getDb, access = createToolAccess(), log = message => console.warn(message), clipper = clipWebPage }) {
    const router = express.Router();
    router.use((req, res, next) => {
        res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
        if (!access.allows(req, { browser: true })) return access.deny(res);
        if (req.get('x-toolbox-knowledge') !== '1') return res.status(403).json({ error: 'forbidden', message: '请从知识库工作台操作' }); next();
    });
    router.use(express.json({ limit: '12mb', strict: true }));
    const wrap = action => async (req, res) => {
        try { await action(req, res); }
        catch (error) { if (res.destroyed) return; const status = { invalid_input: 400, not_found: 404, conflict: 409, confirmation_required: 400 }[error.code]; log(`[knowledge-workbench] ${req.method} failed (${status ? error.code : 'storage_error'})`); res.status(status || 503).json({ error: status ? error.code : 'storage_error', message: status ? error.message : '知识库读取或保存失败，请重试' }); }
    };
    function input(req, fields) { const value = object(req.body); if (Object.keys(value).some(key => !fields.includes(key)) || Object.keys(req.query).length) fail('知识库参数不正确'); return value; }
    function clean(req) { if (Object.keys(req.query).length) fail('此操作不接受附加参数'); }
    const docId = req => integer(Number(req.params.id));
    router.get('/state', wrap((req, res) => { clean(req); res.json(workbenchState(getDb())); }));
    router.post('/entries', wrap((req, res) => res.status(201).json(saveEntry(getDb(), input(req, ['kind', 'name', 'data'])))));
    router.get('/entries/:id', wrap((req, res) => { clean(req); res.json(getEntry(getDb(), req.params.id)); }));
    router.put('/entries/:id', wrap((req, res) => res.json(saveEntry(getDb(), input(req, ['name', 'data', 'version']), req.params.id))));
    router.delete('/entries/:id', wrap((req, res) => {
        if (req.query.confirm !== '1' || Object.keys(req.query).some(key => !['confirm', 'version'].includes(key))) fail('请确认永久删除', 'confirmation_required');
        res.json(deleteEntry(getDb(), req.params.id, integer(Number(req.query.version))));
    }));
    router.post('/notes', wrap((req, res) => res.status(201).json(createWorkbenchNote(getDb(), input(req, ['title', 'templateId', 'daily', 'day', 'databaseId'])))));
    router.get('/notes/:id', wrap((req, res) => { clean(req); res.json(readNote(getDb(), docId(req))); }));
    router.put('/notes/:id', wrap((req, res) => res.json(saveWorkbenchNote(getDb(), docId(req), input(req, ['version', 'title', 'content_md', 'meta'])))));
    router.get('/notes/:id/history', wrap((req, res) => { clean(req); res.json({ items: revisions(getDb(), docId(req)) }); }));
    router.post('/notes/:id/restore', wrap((req, res) => {
        if (req.query.confirm !== '1' || Object.keys(req.query).length !== 1) fail('请确认恢复历史版本', 'confirmation_required');
        const value = object(req.body); if (Object.keys(value).some(key => !['revisionId', 'version'].includes(key))) fail('恢复参数不正确');
        res.json(restoreRevision(getDb(), docId(req), value));
    }));
    router.post('/actions/:id/run', wrap((req, res) => res.json(runAction(getDb(), req.params.id, input(req, ['version', 'requestId', 'docId'])))));
    router.post('/clip', wrap(async (req, res) => {
        const value = input(req, ['url']), controller = new AbortController(), close = () => { if (!res.writableEnded) controller.abort(); };
        res.on('close', close); try { res.json(await clipper(value.url, { signal: controller.signal })); } finally { res.removeListener('close', close); }
    }));
    router.post('/markdown/import', wrap((req, res) => res.json(importMarkdownFiles(getDb(), input(req, ['files'])))));
    router.get('/markdown/export', wrap((req, res) => {
        clean(req); const files = markdownExportFiles(getDb()), archive = archiver('zip', { zlib: { level: 6 } });
        res.type('application/zip'); res.setHeader('Content-Disposition', 'attachment; filename="knowledge-markdown.zip"');
        archive.on('error', () => res.destroy()); res.on('close', () => { if (!res.writableEnded) archive.abort(); }); archive.pipe(res);
        for (const file of files) archive.append(file.content, { name: file.path }); return archive.finalize();
    }));
    router.use((error, _req, res, _next) => res.status(error.status === 413 ? 413 : 400).json({ error: 'invalid_input', message: error.status === 413 ? '知识库请求超过12MiB限制' : '请提交有效JSON参数' }));
    app.use('/api/knowledge-workbench', router);
}
