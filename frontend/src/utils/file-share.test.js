import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shareLink, readShareLink, fileShareSize } from './file-share.js';
test('共享票据只在fragment，刷新可解析，不出现在路径/查询', () => {
    const share = { id: 'a'.repeat(32), token: 'b'.repeat(48) }, url = new URL(shareLink('http://192.168.1.8:3000', share));
    assert.equal(url.pathname, '/file-share'); assert.equal(url.search, ''); assert.ok(!url.pathname.includes(share.token));
    assert.deepEqual(readShareLink(url.hash), share); assert.equal(readShareLink('#id=other&token=bad'), null); assert.equal(readShareLink(''), null);
});
test('大小展示覆盖空文件和常见大文件，不把无效数值当成结果', () => {
    assert.equal(fileShareSize(0), '0 B'); assert.equal(fileShareSize(1024), '1.0 KiB'); assert.equal(fileShareSize(1024 ** 3), '1.0 GiB'); assert.equal(fileShareSize(NaN), '—');
});
