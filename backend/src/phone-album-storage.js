import { createHash, randomBytes } from 'node:crypto';
import { createWriteStream, mkdirSync, renameSync, rmSync } from 'node:fs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { PassThrough, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { ASSET_DIR } from './asset-storage.js';
import { createAsset } from './asset-store.js';
import { AlbumError, verifyAlbumHeader } from './phone-album-protocol.js';

// 临时文件和正式文件在同一资源卷中，提交只需 rename，避免整文件缓存和跨卷复制。
export async function receiveAlbumFile(req, file, controller, limits, onProgress = () => {}) {
    await mkdir(ASSET_DIR, { recursive: true });
    const directory = await mkdtemp(join(ASSET_DIR, '.phone-upload-'));
    const path = join(directory, 'incoming');
    let size = 0, head = Buffer.alloc(0), reason;
    const hash = createHash('sha256');
    const input = new PassThrough();
    const timeout = (code, message) => { reason = new AlbumError(code, message, 408); controller.abort(); };
    const totalTimer = setTimeout(() => timeout('upload_timeout', '文件传送超过五分钟，请重试'), limits.uploadMs);
    let idleTimer;
    const touch = () => { clearTimeout(idleTimer); idleTimer = setTimeout(() => timeout('upload_timeout', '长时间未收到文件数据，请检查网络后重试'), limits.idleMs); };
    const disconnected = () => controller.abort();
    req.once('aborted', disconnected); req.once('error', disconnected);
    const meter = new Transform({ transform(chunk, _encoding, callback) {
        touch(); size += chunk.length;
        if (size > file.size || size > limits.fileBytes) return callback(new AlbumError('file_limit', '接收内容超出声明大小', 413));
        if (head.length < 512) head = Buffer.concat([head, chunk.subarray(0, 512 - head.length)]);
        hash.update(chunk); onProgress(size); callback(null, chunk);
    } });
    try {
        touch();
        const receiving = pipeline(input, meter, createWriteStream(path, { flags: 'wx', mode: 0o600 }), { signal: controller.signal });
        req.pipe(input);
        await receiving;
        if (size !== file.size) throw new AlbumError('size_mismatch', '文件未完整传送，请重试');
        verifyAlbumHeader(head, file.ext);
        return { path, size, sha256: hash.digest('hex'), cleanup: () => rm(directory, { recursive: true, force: true }) };
    } catch (error) {
        await rm(directory, { recursive: true, force: true });
        if (reason) throw reason;
        if (controller.signal.aborted) throw new AlbumError('cancelled', '传送已取消或接收已停止', 409);
        throw error;
    } finally {
        clearTimeout(totalTimer); clearTimeout(idleTimer);
        req.removeListener('aborted', disconnected); req.removeListener('error', disconnected);
        req.unpipe(input); input.destroy();
    }
}

export function commitAlbumFile(db, file, received, folderId) {
    let destination;
    try {
        return db.transaction(() => {
            const created = createAsset({ connection: db, input: {
                name: file.name, folderId, type: file.type, mimeType: file.mime, ext: file.ext,
                fileSize: received.size, sha256: received.sha256, originalStorageKey: 'pending', comment: '手机相册上传'
            }, operator: 'phone-album' });
            const relative = `${created.assetId}/${created.versionId}`;
            const name = `original${Date.now()}-${randomBytes(8).toString('hex')}${file.ext}`;
            destination = join(ASSET_DIR, relative);
            mkdirSync(destination, { recursive: true });
            renameSync(received.path, join(destination, name));
            const storageKey = `${relative}/${name}`;
            db.prepare('UPDATE asset_versions SET original_storage_key = ? WHERE id = ?').run(storageKey, created.versionId);
            return { ...created, name: file.name, size: received.size, sha256: received.sha256 };
        })();
    } catch (error) {
        // destination 只来自本事务新建的数字ID；失败时仅清理本次版本目录。
        if (destination) rmSync(destination, { recursive: true, force: true });
        throw error;
    }
}
