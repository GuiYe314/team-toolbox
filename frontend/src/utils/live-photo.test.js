import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pairLiveFiles, packLivePhoto } from './live-photo.js';
const image = (name = 'IMG_1.JPG') => new File([Uint8Array.of(255, 216, 255, 217)], name, { lastModified: 1 });
const video = (name = 'img_1.MOV') => new File(['synthetic-video'], name, { lastModified: 2 });
test('配对需主动开启且只配同名原照片/视频，歧义和孤立文件保持独立', () => {
    const a = image(), b = video(), c = image('other.jpg');
    assert.deepEqual(pairLiveFiles([a, b], false), [{ file: a }, { file: b }]);
    const paired = pairLiveFiles([b, a, c], true); assert.deepEqual(paired[0].parts, [a, b]); assert.equal(paired[0].name, 'IMG_1.livp'); assert.equal(paired[1].file, c);
    assert.equal(pairLiveFiles([a, b, image('img_1.jpeg')], true).length, 3);
    assert.equal(pairLiveFiles([a, video('IMG_2.MOV')], true).length, 2);
});
test('LIVP为CRC正确的无压缩ZIP且保留两份原片和稳定文件大小', async () => {
    const a = image(), b = video(), packed = await packLivePhoto([a, b], 'IMG_1.livp');
    const bytes = Buffer.from(await packed.arrayBuffer());
    assert.equal(bytes.readUInt32LE(0), 0x04034b50); assert.equal(bytes.readUInt32LE(bytes.length - 22), 0x06054b50);
    assert.ok(bytes.includes(Buffer.from(await a.arrayBuffer()))); assert.ok(bytes.includes(Buffer.from(await b.arrayBuffer())));
    assert.equal(packed.name, 'IMG_1.livp'); assert.equal(packed.lastModified, 2);
    // 标准CRC32已知向量，避免只用同一实现自证。
    const vector = new File(['123456789'], 'test.jpg'); const zip = Buffer.from(await (await packLivePhoto([vector, b], 'test.livp')).arrayBuffer());
    assert.equal(zip.readUInt32LE(14), 0xcbf43926);
});
test('准备阶段可取消，空/超限原片明确拒绝', async () => {
    const controller = new AbortController(); controller.abort();
    await assert.rejects(packLivePhoto([image(), video()], 'a.livp', controller.signal), { name: 'AbortError' });
    await assert.rejects(packLivePhoto([new File([], 'a.jpg'), video()], 'a.livp'), /256/);
    await assert.rejects(packLivePhoto([{ name: 'a.jpg', size: 300 * 1024 ** 2 }, video()], 'a.livp'), /256/);
});
