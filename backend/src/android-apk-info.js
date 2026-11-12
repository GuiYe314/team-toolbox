import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32 } from 'node:zlib';
import yauzl from 'yauzl';
import { AdbError } from './android-adb-protocol.js';
import { APK_MAX_BYTES, inspectApk, receiveApk } from './android-apk.js';
import { APK_MANIFEST_MAX_BYTES, parseApkPackageName } from './android-apk-manifest.js';

const cancelled = () => new AdbError('cancelled', 'APK 包名读取已取消', 499);
const invalid = () => new AdbError('invalid_manifest', '无法读取 APK 清单：文件损坏、压缩格式不支持或完整性校验失败');

export async function readApkPackageName(file, signal) {
    await inspectApk(file, signal);
    if (signal?.aborted) throw cancelled();
    const data = await new Promise((resolve, reject) => {
        let zip, stream, settled = false;
        const finish = (error, bytes) => {
            if (settled) return; settled = true;
            signal?.removeEventListener('abort', abort); stream?.destroy(); zip?.close();
            error ? reject(error) : resolve(bytes);
        };
        const abort = () => finish(cancelled());
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) { abort(); return; }
        yauzl.open(file, { lazyEntries: true, autoClose: false, strictFileNames: true, validateEntrySizes: true }, (error, opened) => {
            if (settled) { opened?.close(); return; }
            if (error) { finish(invalid()); return; }
            zip = opened;
            zip.on('error', () => finish(invalid())); zip.on('end', () => finish(invalid()));
            zip.on('entry', entry => {
                if (entry.fileName !== 'AndroidManifest.xml') { zip.readEntry(); return; }
                if (!entry.uncompressedSize || entry.uncompressedSize > APK_MANIFEST_MAX_BYTES) { finish(invalid()); return; }
                zip.openReadStream(entry, (error, openedStream) => {
                    if (settled) { openedStream?.destroy(); return; }
                    if (error) { finish(invalid()); return; }
                    stream = openedStream; let size = 0, checksum = 0; const chunks = [];
                    stream.on('error', () => finish(invalid()));
                    stream.on('data', chunk => {
                        size += chunk.length;
                        if (size > APK_MANIFEST_MAX_BYTES || size > entry.uncompressedSize) { finish(invalid()); return; }
                        checksum = crc32(chunk, checksum); chunks.push(chunk);
                    });
                    stream.on('end', () => finish(size !== entry.uncompressedSize || checksum !== entry.crc32 ? invalid() : null, Buffer.concat(chunks, size)));
                });
            });
            zip.readEntry();
        });
    });
    if (signal?.aborted) throw cancelled();
    return parseApkPackageName(data);
}

export function createAndroidApkInfo({ temporaryBase = tmpdir(), maximumBytes = APK_MAX_BYTES, timeoutMs = 300000, reader = readApkPackageName, log = () => {} } = {}) {
    let current;
    return {
        async inspect(request, input, signal) {
            if (!request || typeof request !== 'object' || Array.isArray(request) || Object.keys(request).some(key => !['fileName', 'size'].includes(key))
                || typeof request.fileName !== 'string' || request.fileName.length > 255 || /[\x00-\x1f\x7f/\\]/.test(request.fileName) || !/^.+\.apk$/i.test(request.fileName)
                || !Number.isSafeInteger(request.size) || request.size <= 0) throw new AdbError('invalid_input', '请选择单个非空 .apk 文件，不支持 AAB/APKS 或文件路径');
            if (request.size > maximumBytes) throw new AdbError('file_limit', 'APK 超出 1 GiB 大小限制', 413);
            if (current) throw new AdbError('busy', '另一个 APK 包名读取正在进行，请稍后重试', 409);
            if (signal?.aborted) throw cancelled();
            const controller = new AbortController(), operation = current = { controller }, abort = () => controller.abort();
            signal?.addEventListener('abort', abort, { once: true });
            let directory, timedOut = false;
            const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
            try {
                directory = await mkdtemp(join(temporaryBase, 'toolbox-apk-info-'));
                const file = join(directory, 'package.apk');
                await receiveApk(input, file, request.size, maximumBytes, controller.signal);
                const packageName = await reader(file, controller.signal);
                if (controller.signal.aborted) throw cancelled();
                log({ action: 'apk_inspect', ok: true });
                return { fileName: request.fileName, size: request.size, packageName };
            } catch (error) {
                const result = timedOut ? new AdbError('timeout', 'APK 包名读取超时，请重试', 504) : controller.signal.aborted ? cancelled()
                    : error instanceof AdbError ? error : new AdbError('apk_read_failed', 'APK 读取失败，请检查文件、磁盘空间和权限', 500);
                log({ action: 'apk_inspect', ok: false, code: result.code }); throw result;
            } finally {
                clearTimeout(timer); signal?.removeEventListener('abort', abort);
                if (directory) await rm(directory, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 }).catch(() => log({ action: 'apk_inspect_cleanup', ok: false }));
                if (current === operation) current = null;
            }
        },
        dispose() { current?.controller.abort(); }
    };
}
