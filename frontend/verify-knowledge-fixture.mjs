// 两个数据工具的隔离验收：真实API与临时SQLite，绝不读取项目data或用户浏览器。
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { testBrowser, removeBrowserFixture } from './verify-browser.mjs';

const backendRoot = resolve(process.env.VERIFY_BACKEND_ROOT || fileURLToPath(new URL('../backend', import.meta.url)));
export const knowledgeModule = name => pathToFileURL(join(backendRoot, 'src', name)).href;

export async function knowledgeFixture(prefix, intercept = (_req, _res, next) => next(), options = {}) {
    const root = resolve(dirname(fileURLToPath(import.meta.url)), '..'), temporary = await mkdtemp(join(tmpdir(), prefix));
    assert.ok(temporary.startsWith(resolve(tmpdir()) + sep) && temporary.includes(prefix));
    const previous = { UPLOAD_DIR: process.env.UPLOAD_DIR, ASSET_DIR: process.env.ASSET_DIR };
    process.env.UPLOAD_DIR = join(temporary, 'uploads'); process.env.ASSET_DIR = join(temporary, 'assets');
    const require = createRequire(join(backendRoot, 'package.json')), express = require('express'), app = express();
    const { createTestingDatabase } = await import(knowledgeModule('db.js')), { runMigrations } = await import(knowledgeModule('migrate.js'));
    const { registerQuickCalculationApi } = await import(knowledgeModule('quick-calculation-api.js')), { registerKnowledgeSopsApi } = await import(knowledgeModule('knowledge-sops-api.js'));
    const { registerKnowledgeWorkbenchApi } = await import(knowledgeModule('knowledge-workbench-api.js'));
    const { registerApi } = await import(knowledgeModule('api.js')), { createToolAccess } = await import(knowledgeModule('tool-access.js'));
    const path = join(temporary, 'test.sqlite3'); let db = createTestingDatabase({ path }); assert.deepEqual((await runMigrations({ connection: db })).errors, []);
    const dist = resolve(process.env.VERIFY_DIST || join(root, 'frontend/dist')); assert.ok(existsSync(join(dist, 'index.html')), '请先构建前端');
    app.use(createToolAccess().middleware); app.use((req, res, next) => intercept(req, res, next, db));
    const logs = []; registerQuickCalculationApi(app, { getDb: () => db, log: value => logs.push(value) }); registerKnowledgeSopsApi(app, { getDb: () => db, log: value => logs.push(value) });
    registerKnowledgeWorkbenchApi(app, {getDb: () => db, log: value => logs.push(value), ...options});
    app.post('/api/backup/import', express.json({ limit: '96mb' }));
    app.use(express.json({ limit: '16mb' })); registerApi(app, { getDb: () => db });
    const { registerAssetApi } = await import(knowledgeModule('asset-api.js'));
    registerAssetApi(app, { getDb: () => db });
    app.use('/api', (_req, res) => res.status(503).json({ message: '隔离服务不连接设备或更新源' }));
    app.use(express.static(dist, { index: false })); app.get('/{*path}', (_req, res) => res.sendFile(join(dist, 'index.html')));
    const server = await new Promise(done => { const listener = app.listen(0, '127.0.0.1', () => done(listener)); });
    const base = `http://127.0.0.1:${server.address().port}`; let browser;
    try { browser = await testBrowser(temporary); } catch (error) { db.close(); server.closeAllConnections(); await new Promise(done => server.close(done)); await removeBrowserFixture(temporary); throw error; }
    await mkdir(join(root, 'build'), { recursive: true });
    return { root, base, browser, logs, get db() { return db; },
        reopen() { db.close(); db = createTestingDatabase({ path }); },
        async navigate(path, selector) { await browser.send('Page.navigate', { url: base + path }); await browser.wait(`!!document.querySelector(${JSON.stringify(selector)})`); },
        async screenshot(name) { const value = await browser.send('Page.captureScreenshot', { format: 'png' }); await writeFile(join(root, 'build', name + '.png'), Buffer.from(value.data, 'base64')); },
        async close() { await browser.close(); server.closeAllConnections(); await new Promise(done => server.close(done)); db.close(); await removeBrowserFixture(temporary); for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
    };
}
export const contrastScript = `(() => {
    const luminance=value=>value.match(/[\\d.]+/g).slice(0,3).map(Number).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4}).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
    return [...document.querySelectorAll('select')].every(select=>[select,...select.options].every(el=>{const style=getComputedStyle(el),a=luminance(style.color),b=luminance(style.backgroundColor);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05)>=4.5}));
})()`;
