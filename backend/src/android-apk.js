import { createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import yauzl from 'yauzl';
import { AdbError } from './android-adb-protocol.js';

export const APK_MAX_BYTES = 1024 * 1024 * 1024;
export const APK_MAX_DEVICES = 20;

export function validateApkRequest(input, maximum = APK_MAX_BYTES) {
    if (!input || Object.keys(input).some(key => !['serial', 'fileName', 'size', 'confirm'].includes(key))) throw new AdbError('invalid_input', 'APK 安装参数无效');
    if (typeof input.serial !== 'string' || !/^[A-Za-z0-9_][A-Za-z0-9_.:-]{0,254}$/.test(input.serial)) throw new AdbError('invalid_input', '请选择明确的 APK 安装设备');
    if (input.confirm !== true) throw new AdbError('confirmation_required', '请核对 APK 和目标设备后确认安装');
    if (typeof input.fileName !== 'string' || input.fileName.length > 255 || /[\x00-\x1f\x7f/\\]/.test(input.fileName) || !/^.+\.apk$/i.test(input.fileName)) {
        throw new AdbError('invalid_input', '请选择单个 .apk 安装包，不支持 AAB、APKS 或文件路径');
    }
    if (!Number.isSafeInteger(input.size) || input.size <= 0) throw new AdbError('invalid_input', 'APK 文件为空或大小无效');
    if (input.size > maximum) throw new AdbError('file_limit', 'APK 超出 1 GiB 大小限制', 413);
}

export function validateApkBatchRequest(input, maximum = APK_MAX_BYTES) {
    if (!input || typeof input !== 'object' || Array.isArray(input)
        || Object.keys(input).some(key => !['serials', 'fileName', 'size', 'confirm'].includes(key))
        || !Array.isArray(input.serials) || !input.serials.length || input.serials.length > APK_MAX_DEVICES
        || new Set(input.serials).size !== input.serials.length) {
        throw new AdbError('invalid_input', `请选择 1～${APK_MAX_DEVICES} 台不重复的安装设备`);
    }
    for (const serial of input.serials) validateApkRequest({ serial, fileName: input.fileName, size: input.size, confirm: input.confirm }, maximum);
}

const safeApkOutput = (value, file, directory) => String(value || '').replaceAll(file || '\0', '<APK>').replaceAll(directory || '\0', '<临时目录>').slice(0, 64000);

/** 只读 ZIP 中央目录，不解压内容；签名与 Android 兼容性最终由设备校验。 */
export function inspectApk(file, signal) {
    return new Promise((resolve, reject) => {
        let zip, settled = false, count = 0, manifests = 0, unpacked = 0;
        const invalid = () => new AdbError('invalid_apk', '安装包结构无效：需要包含 AndroidManifest.xml 的完整 APK，不能直接安装 AAB/APKS');
        const finish = error => {
            if (settled) return;
            settled = true; signal?.removeEventListener('abort', abort); zip?.close();
            if (error) reject(error); else resolve();
        };
        const abort = () => finish(new AdbError('cancelled', 'APK 安装已取消，请核对手机实际安装状态', 499));
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) { abort(); return; }
        yauzl.open(file, { lazyEntries: true, autoClose: false, strictFileNames: true, validateEntrySizes: true }, (error, opened) => {
            if (settled) { opened?.close(); return; }
            if (error) { finish(invalid()); return; }
            zip = opened;
            zip.on('error', () => finish(invalid()));
            zip.on('entry', entry => {
                count++; unpacked += entry.uncompressedSize;
                if (count > 100000 || unpacked > 4 * APK_MAX_BYTES || entry.fileName.length > 1024 || (entry.generalPurposeBitFlag & 1)) { finish(invalid()); return; }
                if (entry.fileName === 'AndroidManifest.xml') {
                    manifests++;
                    if (manifests > 1 || !entry.uncompressedSize || entry.uncompressedSize > 16 * 1024 * 1024) { finish(invalid()); return; }
                }
                zip.readEntry();
            });
            zip.on('end', () => finish(manifests === 1 ? null : invalid()));
            zip.readEntry();
        });
    });
}

export async function receiveApk(input, file, expectedSize, maximum, signal) {
    let size = 0;
    // 不让 pipeline 销毁 IncomingMessage，以便超限/写盘失败时仍可返回明确错误。
    const source = new PassThrough();
    const onError = () => source.destroy(new AdbError('upload_failed', 'APK 传送中断，请重新选择文件后重试', 400));
    const limit = new Transform({ transform(chunk, _encoding, callback) {
        size += chunk.length;
        callback(size > maximum || size > expectedSize ? new AdbError('file_limit', 'APK 传送大小超出限制或与所选文件不符', 413) : null, chunk);
    } });
    input.on('error', onError); input.on('aborted', onError);
    try {
        const writing = pipeline(source, limit, createWriteStream(file, { flags: 'wx', mode: 0o600 }), { signal });
        input.pipe(source);
        await writing;
        if (size !== expectedSize) throw new AdbError('upload_failed', 'APK 传送不完整，请重新传送', 400);
        return size;
    } finally {
        input.unpipe(source); input.removeListener('error', onError); input.removeListener('aborted', onError);
        source.destroy(); input.resume();
    }
}

export function createAndroidApk({ run, readDevices, log = () => {}, temporaryBase = tmpdir(), maximumBytes = APK_MAX_BYTES, uploadTimeoutMs = 300000, installTimeoutMs = 300000 }) {
    let current;
    async function online(serial, signal) {
        if (signal.aborted) throw new AdbError('cancelled', 'APK 安装已取消，请核对手机实际安装状态', 499);
        if (!(await readDevices(signal)).some(device => device.serial === serial && device.state === 'device')) throw new AdbError('device_unavailable', '安装设备未连接或未授权，请刷新设备后重试', 409);
        if (signal.aborted) throw new AdbError('cancelled', 'APK 安装已取消，请核对手机实际安装状态', 499);
    }
    async function installDevice(serial, file, directory, signal) {
        await online(serial, signal);
        const result = await run(['-s', serial, 'install', '-r', file], { signal, timeoutMs: installTimeoutMs, maxBytes: 64 * 1024, secrets: [file, directory] });
        const stdout = safeApkOutput(result.stdout, file, directory), stderr = safeApkOutput(result.stderr, file, directory), output = stdout + '\n' + stderr;
        if (!/(?:^|\r?\n)\s*Success\s*(?:\r?\n|$)/.test(output) || /\b(?:Failure\s*\[|INSTALL_FAILED_)/.test(output)) {
            throw new AdbError('install_failed', `APK 未安装成功：${output.trim().slice(0, 2000) || 'ADB 未确认安装成功，请核对手机状态'}`, 502);
        }
        if (signal.aborted) throw new AdbError('cancelled', 'APK 安装已取消，请核对手机实际安装状态', 499);
        return { stdout, stderr };
    }
    return {
        async install(request, input, signal) {
            validateApkRequest(request, maximumBytes);
            if (current) throw new AdbError('busy', '另一个 APK 安装正在进行', 409);
            if (signal?.aborted) throw new AdbError('cancelled', 'APK 安装已取消', 499);
            const controller = new AbortController(), operation = current = { controller, serial: request.serial };
            const abort = () => controller.abort(); signal?.addEventListener('abort', abort, { once: true });
            let directory, file, timer, timedOut = '', stage = 'APK 传送';
            const deadline = milliseconds => { clearTimeout(timer); timer = setTimeout(() => { timedOut = stage; controller.abort(); }, milliseconds); };
            const safe = value => String(value || '').replaceAll(file || '\0', '<APK>').replaceAll(directory || '\0', '<临时目录>').slice(0, 64000);
            try {
                deadline(uploadTimeoutMs);
                await online(request.serial, controller.signal);
                directory = await mkdtemp(join(temporaryBase, 'team-toolbox-apk-'));
                file = join(directory, 'package.apk');
                const size = await receiveApk(input, file, request.size, maximumBytes, controller.signal);
                await inspectApk(file, controller.signal);
                stage = 'ADB 传送及安装'; deadline(installTimeoutMs);
                const { stdout, stderr } = await installDevice(request.serial, file, directory, controller.signal);
                return { serial: request.serial, fileName: request.fileName, size, message: 'APK 安装成功', stdout, stderr, completedAt: new Date().toISOString() };
            } catch (error) {
                if (timedOut) throw new AdbError('timeout', `${timedOut}超时，请检查连接并核对手机实际安装状态`, 504);
                if (controller.signal.aborted) throw new AdbError('cancelled', 'APK 安装已取消，请核对手机实际安装状态', 499);
                if (error instanceof AdbError) throw new AdbError(error.code, safe(error.message), error.status);
                throw new AdbError('upload_failed', 'APK 传送或临时文件处理失败，请检查磁盘空间与目录权限后重试', 500);
            } finally {
                clearTimeout(timer); signal?.removeEventListener('abort', abort);
                if (directory) {
                    try { await rm(directory, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 }); }
                    catch { log({ action: 'apk_cleanup', ok: false, code: 'cleanup_failed' }); }
                }
                if (current === operation) current = null;
            }
        },
        async installBatch(request, input, signal, onUpdate = () => {}) {
            validateApkBatchRequest(request, maximumBytes);
            if (current) throw new AdbError('busy', '另一个 APK 安装正在进行', 409);
            if (signal?.aborted) throw new AdbError('cancelled', 'APK 安装已取消', 499);
            // 复制目标快照，确认后的队列不能被调用方改动或加入新设备。
            const serials = [...request.serials], controller = new AbortController(), operation = current = { controller };
            const abort = () => controller.abort(); signal?.addEventListener('abort', abort, { once: true });
            let directory, file, timer, uploadTimedOut = false;
            const safe = value => safeApkOutput(value, file, directory);
            try {
                timer = setTimeout(() => { uploadTimedOut = true; controller.abort(); }, uploadTimeoutMs);
                const devices = await readDevices(controller.signal);
                if (controller.signal.aborted) throw new AdbError('cancelled', 'APK 安装已取消', 499);
                if (!devices.some(device => device.state === 'device' && serials.includes(device.serial))) {
                    throw new AdbError('device_unavailable', '所选设备均未连接或未授权，请刷新设备后重试', 409);
                }
                directory = await mkdtemp(join(temporaryBase, 'team-toolbox-apk-'));
                file = join(directory, 'package.apk');
                const size = await receiveApk(input, file, request.size, maximumBytes, controller.signal);
                await inspectApk(file, controller.signal);
                clearTimeout(timer);
                onUpdate({ type: 'ready', total: serials.length });
                const results = [];
                for (const serial of serials) {
                    if (controller.signal.aborted) throw new AdbError('cancelled', 'APK 安装已取消，请核对手机实际安装状态', 499);
                    onUpdate({ type: 'device', result: { serial, status: 'installing', message: '正在检查连接并安装' } });
                    const targetController = new AbortController(), targetSignal = AbortSignal.any([controller.signal, targetController.signal]);
                    let targetTimedOut = false, result;
                    timer = setTimeout(() => { targetTimedOut = true; targetController.abort(); }, installTimeoutMs);
                    try {
                        const output = await installDevice(serial, file, directory, targetSignal);
                        result = { serial, status: 'success', message: 'APK 安装成功', ...output };
                    } catch (error) {
                        if (controller.signal.aborted) throw error;
                        result = { serial, status: 'failed', code: targetTimedOut ? 'timeout' : error instanceof AdbError ? error.code : 'install_failed',
                            message: targetTimedOut ? '此设备安装超时，请核对手机实际安装状态' : error instanceof AdbError ? safe(error.message) : '此设备安装失败，请检查连接后重试' };
                    } finally { clearTimeout(timer); }
                    result.completedAt = new Date().toISOString(); results.push(result);
                    log({ action: 'apk_install_device', ok: result.status === 'success', ...(result.code ? { code: result.code } : {}) });
                    onUpdate({ type: 'device', result });
                }
                const succeeded = results.filter(result => result.status === 'success').length, failed = results.length - succeeded;
                return { fileName: request.fileName, size, total: serials.length, succeeded, failed, results,
                    message: `安装结束：成功 ${succeeded} 台，失败 ${failed} 台`, completedAt: new Date().toISOString() };
            } catch (error) {
                if (uploadTimedOut) throw new AdbError('timeout', 'APK 传送超时，请检查连接后重试', 504);
                if (controller.signal.aborted) throw new AdbError('cancelled', '批量安装已取消，已完成安装不回滚，请核对手机实际状态', 499);
                if (error instanceof AdbError) throw new AdbError(error.code, safe(error.message), error.status);
                throw new AdbError('upload_failed', 'APK 传送或临时文件处理失败，请检查磁盘空间与目录权限后重试', 500);
            } finally {
                clearTimeout(timer); signal?.removeEventListener('abort', abort);
                if (directory) {
                    try { await rm(directory, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 }); }
                    catch { log({ action: 'apk_cleanup', ok: false, code: 'cleanup_failed' }); }
                }
                if (current === operation) current = null;
            }
        },
        dispose() { current?.controller.abort(); }
    };
}
