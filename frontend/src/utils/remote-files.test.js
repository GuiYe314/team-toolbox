import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateRemoteFiles, parentRemotePath, defaultPort, remoteBytes } from './remote-files.js';
test('客户端文件批次拒绝空、超数、过大、总量、同名与目录名称', () => {
    const file = (name = '中文.txt', size = 3) => ({ name, size }); assert.equal(validateRemoteFiles([file()]), '');
    for (const files of [[], Array.from({ length: 101 }, (_, i) => file(String(i))), [file('a', 1024 ** 3 + 1)], Array.from({ length: 5 }, (_, i) => file(String(i), 1024 ** 3)), [file(), file()], [file('../a')]]) assert.ok(validateRemoteFiles(files));
});
test('远端根目录、父目录、协议端口及字节换算', () => { assert.equal(parentRemotePath('/'), '/'); assert.equal(parentRemotePath('/资料/a/'), '/资料'); assert.equal(defaultPort('sftp'), 22); assert.equal(defaultPort('ftps'), 21); assert.equal(remoteBytes(0), '0 B'); assert.equal(remoteBytes(1024), '1.0 KiB'); });
