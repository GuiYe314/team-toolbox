// 仅在临时目录验证更新设置和界面，禁止下载、暂存、安装及真实上游访问。
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const temporary = mkdtempSync(join(tmpdir(), 'tt-settings-update-'));
process.env.TT_UPDATE_DIR = join(temporary, 'updates');
process.env.DB_PATH = join(temporary, 'db.sqlite3');
process.env.UPLOAD_DIR = join(temporary, 'uploads');
process.env.ASSET_DIR = join(temporary, 'assets');
delete process.env.UPDATE_SOURCE;
const require = createRequire(new URL('../backend/package.json', import.meta.url));
const express = require('express');
const { registerUpdateApi } = await import('../backend/src/update-api.js');
const { closeDefaultDatabase } = await import('../backend/src/db.js');
const { getAppVersion } = await import('../backend/src/version.js');
const { getUpdateSource } = await import('../backend/src/update-source.js');
const { registerAndroidApi } = await import('../backend/src/android-api.js');
const { createAndroidAdbService } = await import('../backend/src/android-adb.js');
const app = express(); app.use(express.json());
app.use('/api/update', (req, res, next) => {
    if (!['/status', '/source', '/check'].includes(req.path)) return res.sendStatus(403);
    if (req.path === '/check') {
        const source = resolve(getUpdateSource().source);
        if (dirname(source) !== resolve(temporary) || !basename(source).startsWith('tt-upd-verify-')) return res.status(403).json({ message: '隔离验收禁止读取外部更新源' });
    }
    next();
});
registerUpdateApi(app);
const adb = registerAndroidApi(app, { service: createAndroidAdbService({ configFile: join(temporary, 'adb.json'), env: {}, log: () => {}, runner: () => { throw new Error('Real ADB execution forbidden'); } }) });
app.get('/api/health', (_req, res) => res.json({ version: getAppVersion(), verificationMode: 'isolated-update' }));
app.get('/api/documents/tree', (_req, res) => res.json({ items: [] }));
app.use(express.static(join(root, 'frontend', 'dist')));
app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(join(root, 'frontend', 'dist', 'index.html')));
const server = await new Promise(resolvePromise => { const s = app.listen(0, '127.0.0.1', () => resolvePromise(s)); });
const reservation = createServer(); await new Promise(resolvePromise => reservation.listen(0, '127.0.0.1', resolvePromise));
const cdpPort = reservation.address().port; await new Promise(resolvePromise => reservation.close(resolvePromise));
const originalFetch = globalThis.fetch;
globalThis.fetch = () => { throw new Error('隔离验收禁止服务端外部 HTTP 请求'); };
try {
    const child = spawn(process.execPath, ['frontend/verify-update.mjs'], { cwd: root, env: { ...process.env,
        VERIFY_BASE: `http://127.0.0.1:${server.address().port}`, CDP_PORT: String(cdpPort), TEMP: temporary, TMP: temporary
    }, windowsHide: true, stdio: 'inherit', timeout: 90000 });
    const code = await new Promise((resolvePromise, reject) => { child.on('error', reject); child.on('exit', resolvePromise); });
    assert.equal(code, 0, 'verify-update failed');
    console.log('Isolated update browser regression passed; downloads and installation were blocked.');
} finally {
    globalThis.fetch = originalFetch; adb.dispose();
    server.closeAllConnections(); await new Promise(resolvePromise => server.close(resolvePromise)); closeDefaultDatabase();
    assert.equal(dirname(resolve(temporary)), resolve(tmpdir())); assert.ok(basename(temporary).startsWith('tt-settings-update-'));
    for (let attempt = 0; ; attempt++) {
        try { rmSync(temporary, { recursive: true, force: true }); break; }
        catch (error) { if (attempt === 20) throw error; await new Promise(resolvePromise => setTimeout(resolvePromise, 200)); }
    }
}
