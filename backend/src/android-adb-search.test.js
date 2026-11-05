import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { findAdbInFolder } from './android-adb-search.js';
import { createAndroidAdbService } from './android-adb.js';

const adbName = process.platform === 'win32' ? 'adb.exe' : 'adb';
function fixture(t) {
    const root = mkdtempSync(join(tmpdir(), 'tt-adb-folder-'));
    t.after(() => {
        assert.equal(dirname(resolve(root)), resolve(tmpdir()));
        assert.ok(basename(root).startsWith('tt-adb-folder-'));
        rmSync(root, { recursive: true, force: true });
    });
    const file = (relative) => {
        const path = join(root, relative, adbName);
        mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, 'offline fixture', { mode: 0o700 });
        return path;
    };
    return { root, file };
}

test('从中文及空格文件夹搜索根目录与嵌套 ADB，返回完整路径', async (t) => {
    const f = fixture(t); const root = join(f.root, '安卓 SDK');
    const direct = f.file('安卓 SDK'); const nested = f.file('安卓 SDK/platform-tools');
    const result = await findAdbInFolder(`"${root}"`);
    assert.deepEqual(result.candidates, [direct, nested].sort());
    assert.equal(result.directory, root); assert.equal(result.truncated, false);
});

test('不存在、不合法或文件路径被拒；空目录明确返回无结果', async (t) => {
    const f = fixture(t); const file = f.file('tools');
    for (const input of ['', 'relative', null, {}, file, join(f.root, 'missing'), f.root + '\u0000']) await assert.rejects(findAdbInFolder(input));
    mkdirSync(join(f.root, 'empty'));
    assert.deepEqual((await findAdbInFolder(join(f.root, 'empty'))).candidates, []);
});

test('扫描遵守深度、目录数量、条目、结果数和时间上限', async (t) => {
    const f = fixture(t); f.file('a'); f.file('b/deep');
    const depth = await findAdbInFolder(f.root, { maxDepth: 1 });
    assert.equal(depth.candidates.length, 1); assert.equal(depth.truncated, true);
    const directories = await findAdbInFolder(f.root, { maxDirectories: 1 });
    assert.equal(directories.scannedDirectories, 1); assert.equal(directories.truncated, true);
    const entries = await findAdbInFolder(f.root, { maxEntries: 1 });
    assert.equal(entries.truncated, true);
    const results = await findAdbInFolder(f.root, { maxResults: 1 });
    assert.equal(results.candidates.length, 1); assert.equal(results.truncated, true);
    assert.equal((await findAdbInFolder(f.root, { timeoutMs: 0 })).truncated, true);
});

test('扫描不跟随链接/联接到目录外，也跳过依赖目录', async (t) => {
    const f = fixture(t); f.file('outside'); f.file('scan/node_modules/tools'); f.file('scan/.git');
    symlinkSync(join(f.root, 'outside'), join(f.root, 'scan', 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
    assert.deepEqual((await findAdbInFolder(join(f.root, 'scan'))).candidates, []);
});

test('取消搜索不会改变已保存配置；搜索本身不执行任何 ADB', async (t) => {
    const f = fixture(t); const path = f.file('sdk/platform-tools'); const calls = [];
    const service = createAndroidAdbService({ configFile: join(f.root, 'config.json'), env: {}, log: () => {}, runner: async (_exe, args) => { calls.push(args); return { stdout: 'Android Debug Bridge version 1.0.41' }; } });
    await service.configure(path);
    const count = calls.length;
    const found = await service.searchFolder(join(f.root, 'sdk'));
    assert.deepEqual(found.candidates, [path]); assert.equal(calls.length, count);
    const controller = new AbortController(); controller.abort();
    await assert.rejects(service.searchFolder(f.root, controller.signal), { code: 'cancelled' });
    assert.equal(service.getConfig().path, path); assert.equal(service.getConfig().directory, dirname(path));
});

test('服务忙碌时也能取消扫码；更改配置使旧会话失效', async (t) => {
    const f = fixture(t); const path = f.file('sdk');
    let entered;
    const started = new Promise((resolvePromise) => { entered = resolvePromise; });
    const service = createAndroidAdbService({ configFile: join(f.root, 'config.json'), env: {}, log: () => {}, runner: async (_exe, args, options) => {
        if (args[0] === 'version') return { stdout: 'Android Debug Bridge version 1.0.41' };
        entered();
        return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true }));
    } });
    await service.configure(path); const session = await service.startQr();
    const poll = service.pollQr(session.id); await started;
    await assert.rejects(service.devices(), { code: 'busy' });
    assert.equal(service.cancelQr(session.id).state, 'cancelled'); assert.equal((await poll).state, 'cancelled');
    await service.configure(''); await assert.rejects(service.pollQr(session.id), { code: 'invalid_session' });
});
