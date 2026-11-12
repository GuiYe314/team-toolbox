import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { readMediaLock, validateMediaLock, fetchMediaAsset, prepareMediaTools, verifyMediaTools, stageMediaTools } from '../../scripts/prepare-media-tools.mjs';

const sha = data => createHash('sha256').update(data).digest('hex');
async function fixture(t) {
    const root = await mkdtemp(join(tmpdir(), 'tt-media-components-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const lock = structuredClone(await readMediaLock()), downloads = new Map(), outputs = new Map();
    for (const asset of lock.assets) {
        const bytes = Buffer.from(('isolated-test-' + asset.file + '\n').repeat(80)), download = asset.compression ? gzipSync(bytes) : bytes;
        asset.size = bytes.length; asset.sha256 = sha(bytes);
        if (asset.compression) { asset.downloadSize = download.length; asset.downloadSha256 = sha(download); }
        downloads.set(asset.file, download); outputs.set(asset.file, bytes);
    }
    const fetchAsset = async (asset, file) => writeFile(file, downloads.get(asset.file));
    return { root, lock, downloads, outputs, fetchAsset, report: () => {}, target: join(root, 'vendor/media/win32-x64') };
}
test('组件锁固定完整白名单、HTTPS来源、大小及SHA256，不接受自由地址或路径', async () => {
    const original = await readMediaLock();
    assert.equal(original.assets.length, 7);
    for (const patch of [
        { file: '../yt-dlp.exe' }, { url: 'http://github.com/yt-dlp/yt-dlp/releases/download/v/file' },
        { url: 'https://example.com/yt-dlp.exe' }, { url: 'https://github.com/other/repo/releases/download/v/yt-dlp.exe' },
        { url: 'https://github.com/yt-dlp/yt-dlp/releases/download/v/yt-dlp.exe?token=not-real' },
        { sha256: 'invalid' }, { size: 0 }, { size: 100 * 1024 * 1024 + 1 }, { compression: 'zip' }
    ]) { const lock = structuredClone(original); Object.assign(lock.assets[0], patch); assert.throws(() => validateMediaLock(lock)); }
    const duplicate = structuredClone(original); duplicate.assets[1] = duplicate.assets[0]; assert.throws(() => validateMediaLock(duplicate));
});
test('分段下载按偏移组装、限制并发、校验完整摘要，并离线重用已完成缓存', async t => {
    const f = await fixture(t), data = Buffer.from('range-fixture-media-data'.repeat(200)), cache = join(f.root, 'asset.download');
    const asset = { file: 'yt-dlp.exe', url: 'https://github.com/yt-dlp/yt-dlp/releases/download/test/yt-dlp.exe', size: data.length, sha256: sha(data) };
    let active = 0, maximum = 0, calls = 0;
    const attempt = async (_url, file, expected, range) => {
        calls++; active++; maximum = Math.max(maximum, active); await new Promise(resolvePromise => setImmediate(resolvePromise));
        const [start, end] = range.split('-').map(Number); assert.equal(end - start + 1, expected);
        await writeFile(file, data.subarray(start, end + 1)); active--; return { code: 0 };
    };
    await fetchMediaAsset(asset, cache, () => {}, { attempt, chunkBytes: 1024, concurrency: 2 });
    assert.deepEqual(await readFile(cache), data); assert.equal(calls, Math.ceil(data.length / 1024)); assert.equal(maximum, 2);
    await fetchMediaAsset(asset, cache, () => {}, { attempt: async () => { throw new Error('network must not run'); } });
    assert.ok(!(await readdir(f.root)).some(name => name.endsWith('.tmp') || name.endsWith('.chunk')));
});
test('分段失败仅重试未完成段，保留的完整段可续传，不把部分下载当成组件', async t => {
    const f = await fixture(t), data = Buffer.alloc(3500, 7), cache = join(f.root, 'resume.download');
    const asset = { file: 'yt-dlp.exe', size: data.length, sha256: sha(data) };
    await writeFile(cache + '.0.chunk', data.subarray(0, 1024)); const calls = [];
    const attempt = async (_url, file, _expected, range) => {
        calls.push(range); const [start, end] = range.split('-').map(Number);
        if (start === 1024 && calls.filter(value => value === range).length === 1) { await writeFile(file, 'partial'); return { code: 28 }; }
        await writeFile(file, data.subarray(start, end + 1)); return { code: 0 };
    };
    await fetchMediaAsset(asset, cache, () => {}, { attempt, chunkBytes: 1024, concurrency: 2 });
    assert.deepEqual(await readFile(cache), data); assert.ok(!calls.includes('0-1023')); assert.equal(calls.filter(value => value === '1024-2047').length, 2);
});
test('分段响应过大或完整摘要错误拒绝采用，保留旧缓存且清理失败临时内容', async t => {
    const f = await fixture(t), data = Buffer.alloc(3500, 7), cache = join(f.root, 'bad.download');
    const asset = { file: 'yt-dlp.exe', size: data.length, sha256: sha(data) }; await writeFile(cache, 'old-cache');
    await assert.rejects(fetchMediaAsset(asset, cache, () => {}, { attempt: async (_url, file, expected) => { await writeFile(file, Buffer.alloc(expected, 8)); return { code: 0 }; }, chunkBytes: 1024 }), /SHA256不符/);
    assert.equal(await readFile(cache, 'utf8'), 'old-cache');
    await assert.rejects(fetchMediaAsset(asset, cache, () => {}, { attempt: async (_url, file, expected) => { await writeFile(file, Buffer.alloc(expected + 1)); return { code: 0 }; }, chunkBytes: 1024 }), /分段下载失败/);
    assert.equal(await readFile(cache, 'utf8'), 'old-cache'); assert.ok(!(await readdir(f.root)).some(name => name.endsWith('.tmp')));
});
test('显式准备校验压缩包及成品，全部许可与版本清单齐全后通过离线检查', async t => {
    const f = await fixture(t);
    await prepareMediaTools(f.root, f);
    await verifyMediaTools(f.root, f.lock);
    for (const asset of f.lock.assets) assert.deepEqual(await readFile(join(f.target, asset.file)), f.outputs.get(asset.file));
    let fetches = 0;
    await prepareMediaTools(f.root, { ...f, fetchAsset: async () => { fetches++; throw new Error('must stay offline'); } });
    assert.equal(fetches, 0, '完整组件重用时不下载');
    assert.equal((await readdir(f.target)).filter(name => name.endsWith('.tmp')).length, 0);
});
test('下载摘要错误不覆盖已有组件，失败临时文件不进入组件目录', async t => {
    const f = await fixture(t); await mkdir(f.target, { recursive: true });
    const original = Buffer.from('existing-component-is-preserved');
    await writeFile(join(f.target, 'yt-dlp.exe'), original);
    await assert.rejects(prepareMediaTools(f.root, { ...f, fetchAsset: async (asset, file) => writeFile(file, asset.file === 'yt-dlp.exe' ? 'bad-download' : f.downloads.get(asset.file)) }), /下载校验失败/);
    assert.deepEqual(await readFile(join(f.target, 'yt-dlp.exe')), original);
    assert.ok(!(await readdir(f.target)).some(name => name.endsWith('.tmp')));
    await assert.rejects(verifyMediaTools(f.root, f.lock));
});
test('gzip解压过量会停止且保留原组件，不遗留成品临时文件', async t => {
    const f = await fixture(t), asset = f.lock.assets.find(item => item.file === 'ffmpeg.exe');
    asset.size = 500;
    const original = Buffer.from('old-ffmpeg'); await mkdir(f.target, { recursive: true }); await writeFile(join(f.target, asset.file), original);
    await assert.rejects(prepareMediaTools(f.root, f), /解压超过大小限制/);
    assert.deepEqual(await readFile(join(f.target, asset.file)), original);
    assert.ok(!(await readdir(f.target)).some(name => name.endsWith('.tmp')));
});
test('发布暂存仅复制已核验白名单，损坏/缺少许可或版本不符拒绝分发', async t => {
    const f = await fixture(t); await prepareMediaTools(f.root, f);
    await writeFile(join(f.target, 'unrelated-private-file.txt'), 'never-copy');
    const destination = join(f.root, 'staged-product');
    await stageMediaTools(f.root, destination, f.lock); await verifyMediaTools(destination, f.lock);
    assert.ok(!(await readdir(join(destination, 'vendor/media/win32-x64'))).includes('unrelated-private-file.txt'));
    await writeFile(join(f.target, 'FFmpeg-LICENSE.txt'), 'broken');
    await assert.rejects(stageMediaTools(f.root, join(f.root, 'invalid-stage'), f.lock), /FFmpeg-LICENSE/);
    await writeFile(join(f.target, 'FFmpeg-LICENSE.txt'), f.outputs.get('FFmpeg-LICENSE.txt'));
    await writeFile(join(f.target, 'components-lock.json'), '{"version":999}');
    await assert.rejects(verifyMediaTools(f.root, f.lock), /版本清单不匹配/);
});
