import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, readdir, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const temporary = await mkdtemp(join(tmpdir(), 'tt-live-tests-'));
process.env.ASSET_DIR = join(temporary, 'assets');
const { jpegXmp, motionRange, validVideo, prepareLivePhoto, motionStorageKey, liveVideoArgs } = await import('./live-photo.js');
const { videoRange } = await import('./live-photo-http.js');
const { packLivePhoto } = await import('../../frontend/src/utils/live-photo.js');
const { generatePreview } = await import('./asset-preview.js');
const { saveAssetFile, resolveAssetPath } = await import('./asset-storage.js');
const sharp = (await import('sharp')).default;
const photo = await sharp({ create: { width: 32, height: 24, channels: 3, background: 'blue' } }).jpeg().toBuffer();
const box = (type, data = Buffer.alloc(0)) => { const head = Buffer.alloc(8); head.writeUInt32BE(8 + data.length); head.write(type, 4); return Buffer.concat([head, data]); };
const fakeVideo = Buffer.concat([box('ftyp', Buffer.from('isom\0\0\0\0isom')), box('moov'), box('mdat')]);
function motionJpeg(video, offset = video.length) {
    const xml = `<x:xmpmeta xmlns:GCamera="http://ns.google.com/photos/1.0/camera/" GCamera:MicroVideo="1" GCamera:MicroVideoOffset="${offset}"/>`;
    const app = Buffer.concat([Buffer.from('http://ns.adobe.com/xap/1.0/\0'), Buffer.from(xml)]), h = Buffer.from([255, 225, 0, 0]); h.writeUInt16BE(app.length + 2, 2);
    return Buffer.concat([photo.subarray(0, 2), h, app, photo.subarray(2), video]);
}
async function file(name, data) { const p = join(temporary, name); await writeFile(p, data); return p; }
after(async () => { await rm(temporary, { recursive: true, force: true }); });
test('普通JPEG无实况；只读取APP1 XMP，不把像素/尾部文本当元数据', async () => {
    assert.equal(jpegXmp(photo), ''); assert.equal(jpegXmp(Buffer.concat([photo, Buffer.from('MicroVideoOffset="99"')])), '');
    assert.equal(await prepareLivePhoto(await file('still.jpg', photo), '.jpg'), null);
});
test('旧版XMP和新版Container目录解析偏移；拒绝超限、歧义、伪造与残缺长度', () => {
    const size = 1000;
    assert.deepEqual(motionRange(jpegXmp(motionJpeg(fakeVideo)), photo.length + 500), { start: photo.length + 500 - fakeVideo.length, length: fakeVideo.length });
    const xml = '<Container:Item Item:Semantic="Primary"/><Container:Item Item:Semantic="MotionPhoto" Item:Mime="video/mp4" Item:Length="80"/>';
    assert.deepEqual(motionRange(xml, size), { start: 920, length: 80 });
    for (const invalid of ['', 'MicroVideoOffset="999999999999"', 'MicroVideoOffset="1000"', 'MicroVideoOffset="1"', 'MicroVideoOffset="x"', xml + ' MicroVideoOffset="90"']) assert.equal(motionRange(invalid, size), null);
});
test('内嵌视频按真实BMFF边界校验，不接受伪ftyp、缺块或越界', async () => {
    assert.equal(await validVideo(await file('valid.mp4', fakeVideo)), true);
    for (const [i, bytes] of [Buffer.from('ftypmoovmdat'), fakeVideo.subarray(0, -1), box('ftyp', Buffer.alloc(8))].entries()) assert.equal(await validVideo(await file(`bad${i}.mp4`, bytes)), false);
});
test('无效嵌入偏移不误报为实况，无效视频明确报错且不修改原图', async () => {
    const bytes = motionJpeg(fakeVideo, fakeVideo.length + 10), path = await file('wrong-offset.jpg', bytes);
    assert.equal(await prepareLivePhoto(path, '.jpg'), null); assert.deepEqual(await readFile(path), bytes);
    const broken = motionJpeg(fakeVideo.subarray(0, -1));
    await assert.rejects(prepareLivePhoto(await file('broken.jpg', broken), '.jpg'), /结构无效/);
});
test('LIVP解包复核CRC和视频结构，失败不修改压缩包', async () => {
    const packed = await packLivePhoto([new File([photo], 'a.jpg'), new File([fakeVideo], 'a.mov')], 'pair.livp');
    const bytes = Buffer.from(await packed.arrayBuffer());
    const corrupt = Buffer.from(bytes); corrupt[40] ^= 1;
    const path = await file('corrupt.livp', corrupt);
    await assert.rejects(prepareLivePhoto(path, '.livp'), /CRC/); assert.deepEqual(await readFile(path), corrupt);
});
test('LIVP拒绝目录越界、加密、链接和多图歧义条目', async () => {
    const archiver = (await import('archiver')).default;
    const { PassThrough } = await import('node:stream');
    async function archive(names) { const a = archiver('zip'), out = new PassThrough(), chunks = []; out.on('data', c => chunks.push(c)); const done = new Promise((r, j) => { out.on('end', r); out.on('error', j); }); a.pipe(out); for (const name of names) a.append(photo, { name }); await a.finalize(); await done; return Buffer.concat(chunks); }
    await assert.rejects(prepareLivePhoto(await file('many.livp', await archive(['a.jpg', 'b.jpg', 'v.mov'])), '.livp'), /只能包含/);
    const good = Buffer.from(await (await packLivePhoto([new File([photo], 'a.jpg'), new File([fakeVideo], 'a.mov')], 'p.livp')).arrayBuffer());
    const central = good.indexOf(Buffer.from([80, 75, 1, 2]));
    for (const mode of ['encrypted', 'link', 'path']) {
        const b = Buffer.from(good);
        if (mode === 'encrypted') b.writeUInt16LE(b.readUInt16LE(central + 8) | 1, central + 8);
        if (mode === 'link') b.writeUInt32LE(0xa0000000, central + 38);
        if (mode === 'path') b.write('../xx.jpg', central + 46);
        await assert.rejects(prepareLivePhoto(await file(mode + '.livp', b), '.livp'));
    }
});
test('动态派生键仅可引用本资源本版本的motion.mp4', () => {
    const key = '1/2/motion1700000000000-0123456789abcdef.mp4';
    assert.equal(motionStorageKey({ livePhoto: { status: 'ready', motionStorageKey: key } }, 1, 2), key);
    for (const bad of [key.replace('1/2/', '3/2/'), key.replace('motion', 'original'), '../' + key, key.replace('.mp4', '.mov')]) assert.equal(motionStorageKey({ livePhoto: { status: 'ready', motionStorageKey: bad } }, 1, 2), null);
});
test('HTTP Range支持首段、尾段及开放末尾，拒绝多段/超界/空后缀', () => {
    assert.equal(videoRange('', 100), null); assert.deepEqual(videoRange('bytes=0-9', 100), { start: 0, end: 9 }); assert.deepEqual(videoRange('bytes=-5', 100), { start: 95, end: 99 }); assert.deepEqual(videoRange('bytes=90-', 100), { start: 90, end: 99 });
    for (const range of ['bytes=100-', 'bytes=-0', 'bytes=5-2', 'bytes=1-2,5-9', 'bytes=-', 'items=0-2']) assert.equal(videoRange(range, 100), false);
});
test('FFmpeg参数固定本地输入、无shell、限时尺寸和输出，不允许网络协议', () => {
    const args = liveVideoArgs('input.mov', 'output.mp4'); assert.ok(args.includes('file,pipe')); assert.ok(args.includes('30')); assert.ok(args.includes('libx264')); assert.ok(!args.some(v => v.includes('http'))); assert.equal(args.at(-1), 'output.mp4');
});
test('真实FFmpeg生成两种实况预览、静态封面和可解码MP4，原件逐字节不变', { skip: process.env.TT_VERIFY_LIVE_MEDIA !== '1' }, async () => {
    const { detectExecutable } = await import('./integration-common.js'); const ffmpeg = await detectExecutable('ffmpeg', ''); assert.ok(ffmpeg, '显式实媒体测试需要FFmpeg');
    const clip = join(temporary, 'real.mp4'); await promisify(execFile)(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=blue:s=96x64:d=0.6', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-threads', '1', clip], { windowsHide: true, timeout: 15000 });
    const bytes = await readFile(clip), packed = await packLivePhoto([new File([photo], 'a.jpg'), new File([bytes], 'a.mov')], 'pair.livp');
    let id = 50;
    for (const [name, original] of [['motion.jpg', motionJpeg(bytes)], ['pair.livp', Buffer.from(await packed.arrayBuffer())]]) {
        const saved = saveAssetFile({ assetId: id, versionId: id, buffer: original, originalName: name });
        const result = await generatePreview({ assetId: id, versionId: id, originalStorageKey: saved.storageKey });
        assert.equal(result.status, 'ready', result.error); assert.equal(result.metadata.livePhoto.status, 'ready', result.metadata.livePhoto.error);
        assert.ok(result.previewKey); assert.ok(result.thumbnailKey); assert.ok(await validVideo(resolveAssetPath(result.metadata.livePhoto.motionStorageKey)));
        assert.deepEqual(await readFile(resolveAssetPath(saved.storageKey)), original); id++;
    }
});

test('真实HTTP上传/Range播放/原件、镜像、导出导入重映射和历史恢复均保留实况', { skip: process.env.TT_VERIFY_LIVE_MEDIA !== '1' }, async () => {
    const Database = (await import('better-sqlite3')).default, express = (await import('express')).default;
    const { runMigrations } = await import('./migrate.js'); const { registerAssetApi } = await import('./asset-api.js');
    const { buildExportManifest, importAssets } = await import('./asset-transfer.js');
    const { setMirrorPath } = await import('./asset-mirror.js');
    const { copyFile } = await import('node:fs/promises');
    const db = new Database(':memory:'); await runMigrations({ connection: db });
    const mirror = join(temporary, 'mirror'); await mkdir(mirror); setMirrorPath(db, mirror);
    const app = express(); app.use(express.json()); registerAssetApi(app, { getDb: () => db });
    const server = app.listen(0, '127.0.0.1'); await new Promise(done => server.once('listening', done));
    const base = `http://127.0.0.1:${server.address().port}`;
    const wait = async id => { for (let i = 0; i < 300; i++) { const d = await (await fetch(base + '/api/assets/' + id)).json(); const v = d.versions[0]; if (['ready', 'failed', 'none'].includes(v.previewStatus)) return v; await new Promise(done => setTimeout(done, 20)); } throw new Error('preview timeout'); };
    try {
        const original = motionJpeg(await readFile(join(temporary, 'real.mp4')));
        const form = new FormData(); form.append('file', new File([original], 'HTTP实况.jpg'));
        const upload = await fetch(base + '/api/assets/upload', { method: 'POST', body: form }); assert.equal(upload.status, 201); const asset = await upload.json();
        const version = await wait(asset.id); assert.equal(version.metadata.livePhoto.status, 'ready', version.metadata.livePhoto.error);
        const motion = await fetch(base + `/api/assets/files/${asset.id}/motion/latest`); assert.equal(motion.status, 200); const media = Buffer.from(await motion.arrayBuffer()); assert.equal(motion.headers.get('content-type'), 'video/mp4');
        for (const [range, wanted] of [['bytes=0-15', media.subarray(0, 16)], ['bytes=-10', media.subarray(-10)]]) {
            const part = await fetch(base + `/api/assets/files/${asset.id}/motion/1`, { headers: { Range: range } }); assert.equal(part.status, 206); assert.equal(part.headers.get('accept-ranges'), 'bytes'); assert.deepEqual(Buffer.from(await part.arrayBuffer()), wanted);
        }
        assert.equal((await fetch(base + `/api/assets/files/${asset.id}/motion/latest`, { headers: { Range: 'bytes=999999999-' } })).status, 416);
        const raw = await fetch(base + `/api/assets/files/${asset.id}/original/latest`); assert.deepEqual(Buffer.from(await raw.arrayBuffer()), original);
        assert.deepEqual(await readFile(join(mirror, version.metadata.livePhoto.motionStorageKey)), media);
        const exported = buildExportManifest({ connection: db, assetIds: [asset.id] }); assert.ok(exported.files.some(f => f.kind === 'motion'));
        const extracted = join(temporary, 'extracted'); await mkdir(extracted);
        for (const file of exported.files) { const target = join(extracted, file.zipPath.replace(/^files\//, '')); await mkdir(join(target, '..'), { recursive: true }); await copyFile(resolveAssetPath(file.storageKey), target); }
        const imported = importAssets({ connection: db, manifest: exported.manifest, filesDir: extracted, assetsRoot: process.env.ASSET_DIR }); assert.equal(imported.assets, 1);
        const newAsset = db.prepare('SELECT id FROM assets ORDER BY id DESC LIMIT 1').get(); assert.notEqual(newAsset.id, asset.id);
        const detail = await (await fetch(base + '/api/assets/' + newAsset.id)).json(), newVersion = detail.versions[0];
        assert.ok(newVersion.metadata.livePhoto.motionStorageKey.startsWith(`${newAsset.id}/${newVersion.id}/`));
        assert.deepEqual(Buffer.from(await (await fetch(base + `/api/assets/files/${newAsset.id}/motion/latest`)).arrayBuffer()), media);
        // 污染导入metadata不得读取其它版本；没有派生文件时不沿用旧键。
        const forged = structuredClone(exported.manifest); delete forged.assets[0].versions[0].files.motion;
        importAssets({ connection: db, manifest: forged, filesDir: extracted, assetsRoot: process.env.ASSET_DIR });
        const forgedId = db.prepare('SELECT MAX(id) AS id FROM assets').get().id;
        assert.equal((await fetch(base + `/api/assets/files/${forgedId}/motion/latest`)).status, 404);
        // 模拟升级前已生成静态预览的动态JPEG；手动重建应识别实况，不新建版本或改写原件。
        db.prepare('UPDATE asset_versions SET metadata = ? WHERE id = ?').run('{}', version.id);
        const regenerated = await fetch(base + `/api/assets/${asset.id}/versions/${version.id}/preview`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        assert.equal(regenerated.status, 200); assert.equal((await regenerated.json()).metadata.livePhoto.status, 'ready');
        const rebuilt = await (await fetch(base + '/api/assets/' + asset.id)).json();
        assert.equal(rebuilt.versions.length, 1); assert.equal(rebuilt.versions[0].id, version.id);
        assert.deepEqual(Buffer.from(await (await fetch(base + `/api/assets/files/${asset.id}/original/latest`)).arrayBuffer()), original);
        const restored = await fetch(base + `/api/assets/${asset.id}/versions/${version.id}/restore`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); assert.equal(restored.status, 201);
        const latest = await wait(asset.id); assert.equal(latest.versionNumber, 2); assert.equal(latest.metadata.livePhoto.status, 'ready');
        assert.notEqual(latest.metadata.livePhoto.motionStorageKey, version.metadata.livePhoto.motionStorageKey);
        assert.deepEqual(Buffer.from(await (await fetch(base + `/api/assets/files/${asset.id}/original/2`)).arrayBuffer()), original);
        assert.equal((await fetch(base + `/api/assets/files/${asset.id}/motion/1`)).status, 200);
    } finally { server.closeAllConnections(); await new Promise(done => server.close(done)); db.close(); }
});
