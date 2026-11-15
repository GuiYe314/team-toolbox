import { test } from 'node:test';
import assert from 'node:assert/strict';
import { albumFileId, albumUploadUrl, parseAlbumLink, albumFileError } from './phone-album.js';
test('扫码凭据只在fragment，链接解析严格拒绝额外参数或残缺票据', () => {
    const session = { id: 'a'.repeat(32), uploadToken: 'b'.repeat(48), manageToken: 'c'.repeat(48) };
    const url = new URL(albumUploadUrl('http://192.168.1.3:5173', session));
    assert.equal(url.pathname, '/phone-album'); assert.equal(url.search, '');
    assert.deepEqual(parseAlbumLink(url.hash), { id: session.id, uploadToken: session.uploadToken });
    assert.ok(!url.href.includes(session.manageToken));
    for (const invalid of ['', url.hash + '?extra=1', url.hash.slice(0, -1), '#https://evil.example']) assert.equal(parseAlbumLink(invalid), null);
    for (const invalid of ['javascript:alert(1)', 'https://user:pass@example.com', 'http://192.168.1.3/path', 'http://192.168.1.3/?a=1']) assert.throws(() => albumUploadUrl(invalid, session));
});
test('LAN HTTP兼容安全随机编号；不支持、空和过大文件在上传前提示', () => {
    const ids = Array.from({ length: 50 }, albumFileId); assert.equal(new Set(ids).size, 50); assert.ok(ids.every(id => /^[a-f0-9]{32}$/.test(id)));
    const limits = { fileBytes: 100 };
    assert.equal(albumFileError({ name: '照片.HEIC', size: 30 }, limits), '');
    for (const file of [{ name: 'a.exe', size: 30 }, { name: 'a.png', size: 0 }, { name: 'a.mp4', size: 101 }]) assert.ok(albumFileError(file, limits));
});
