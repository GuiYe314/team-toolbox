import { mkdtemp, open, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { AdbError } from './android-adb-protocol.js';
import { APK_MAX_BYTES, APK_MAX_DEVICES, inspectApk, validateApkRequest } from './android-apk.js';

export const APK_QUEUE_MAX_FILES = 20;
export const APK_QUEUE_MAX_BYTES = 4 * APK_MAX_BYTES;
export const APK_QUEUE_HEADER_BYTES = 64 * 1024;
const cancelled = () => new AdbError('cancelled', '多 APK 安装已取消，已完成安装不回滚，请核对手机实际状态', 499);
const invalid = () => new AdbError('invalid_input', '多 APK 安装数据无效或传送不完整，请重新选择文件和设备');

export function validateApkQueue(value, maximumBytes = APK_MAX_BYTES, maximumTotal = APK_QUEUE_MAX_BYTES) {
    if (!value || typeof value !== 'object' || Array.isArray(value)
        || Object.keys(value).some(key => !['serials', 'files', 'jobs', 'confirm'].includes(key))
        || !Array.isArray(value.files) || !value.files.length || value.files.length > APK_QUEUE_MAX_FILES
        || !Array.isArray(value.serials) || !value.serials.length || value.serials.length > APK_MAX_DEVICES
        || new Set(value.serials).size !== value.serials.length) throw invalid();
    const files = value.files.map(file => {
        if (!file || typeof file !== 'object' || Array.isArray(file) || Object.keys(file).some(key => !['fileName', 'size'].includes(key))) throw invalid();
        for (const serial of value.serials) validateApkRequest({ ...file, serial, confirm: value.confirm }, maximumBytes);
        return { fileName: file.fileName, size: file.size };
    });
    const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
    if (!Number.isSafeInteger(totalBytes) || totalBytes > maximumTotal) throw new AdbError('file_limit', '所选 APK 总大小超出 4 GiB 限制', 413);
    const jobs = value.jobs === undefined ? value.serials.flatMap(serial => files.map((_, fileIndex) => ({ serial, fileIndex }))) : value.jobs;
    if (!Array.isArray(jobs) || !jobs.length || jobs.length > APK_MAX_DEVICES * APK_QUEUE_MAX_FILES) throw invalid();
    const keys = new Set();
    for (const job of jobs) {
        if (!job || typeof job !== 'object' || Array.isArray(job) || Object.keys(job).some(key => !['serial', 'fileIndex'].includes(key))
            || !value.serials.includes(job.serial) || !Number.isInteger(job.fileIndex) || job.fileIndex < 0 || job.fileIndex >= files.length) throw invalid();
        const key = JSON.stringify([job.serial, job.fileIndex]); if (keys.has(key)) throw invalid(); keys.add(key);
    }
    if (value.serials.some(serial => !jobs.some(job => job.serial === serial))) throw invalid();
    return { files, serials: [...value.serials], jobs: jobs.map(job => ({ ...job })).sort((a, b) => a.fileIndex - b.fileIndex), totalBytes };
}

// TTAP + uint32 BE JSON字节数 + 有界JSON + 依次拼接的原始APK。
// 不对整个请求或APK使用Buffer.concat；仅元数据缓冲，文件逐块写盘。
async function receiveQueue(input, directory, signal, options) {
    const source = new PassThrough(), iterator = source[Symbol.asyncIterator]();
    source.on('error', () => {}); // 取消可能先于首次iterator.next，仍须接住流错误。
    let pending = Buffer.alloc(0), offset = 0, consumed = 0;
    const abort = () => source.destroy(cancelled()), broken = () => source.destroy(invalid());
    input.on('error', broken); input.on('aborted', broken); signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    input.pipe(source);
    async function take(length, write) {
        while (length) {
            if (signal.aborted) throw cancelled();
            if (offset === pending.length) { const next = await iterator.next(); if (next.done) throw invalid(); pending = next.value; offset = 0; }
            const count = Math.min(length, pending.length - offset), chunk = pending.subarray(offset, offset + count);
            await write(chunk); offset += count; consumed += count; length -= count;
        }
    }
    async function bytes(length) { const result = Buffer.alloc(length); let position = 0; await take(length, chunk => { result.set(chunk, position); position += chunk.length; }); return result; }
    try {
        const prefix = await bytes(8), length = prefix.readUInt32BE(4);
        if (prefix.subarray(0, 4).toString('ascii') !== 'TTAP' || length < 2 || length > APK_QUEUE_HEADER_BYTES) throw invalid();
        let value; try { value = JSON.parse((await bytes(length)).toString('utf8')); } catch (error) { if (signal.aborted) throw error; throw invalid(); }
        const metadata = validateApkQueue(value, options.maximumBytes, options.maximumTotalBytes);
        if (options.expectedSize !== 8 + length + metadata.totalBytes) throw invalid();
        await options.checkTargets(metadata.serials);
        const saved = [];
        for (let index = 0; index < metadata.files.length; index++) {
            const path = join(directory, `${index}.apk`), file = await open(path, 'wx', 0o600);
            try {
                await take(metadata.files[index].size, async chunk => { let written = 0; while (written < chunk.length) { const result = await file.write(chunk, written, chunk.length - written); if (!result.bytesWritten) throw invalid(); written += result.bytesWritten; } });
            } finally { await file.close(); }
            await inspectApk(path, signal); saved.push(path);
        }
        if (offset !== pending.length || !(await iterator.next()).done || consumed !== options.expectedSize) throw invalid();
        return { ...metadata, saved };
    } finally {
        input.unpipe(source); input.removeListener('error', broken); input.removeListener('aborted', broken);
        signal.removeEventListener('abort', abort); source.destroy(); input.resume();
    }
}

export function createAndroidApkQueue({ run, readDevices, log = () => {}, temporaryBase = tmpdir(), maximumBytes = APK_MAX_BYTES,
    maximumTotalBytes = APK_QUEUE_MAX_BYTES, uploadTimeoutMs = 300000, installTimeoutMs = 300000, queueTimeoutMs = 3600000 } = {}) {
    let current;
    return {
        async install(input, expectedSize, signal, onUpdate = () => {}) {
            if (!Number.isSafeInteger(expectedSize) || expectedSize < 10 || expectedSize > maximumTotalBytes + APK_QUEUE_HEADER_BYTES + 8) throw invalid();
            if (current) throw new AdbError('busy', '另一个多 APK 安装正在进行', 409);
            if (signal?.aborted) throw cancelled();
            const controller = new AbortController(), operation = current = { controller };
            const abort = () => controller.abort(); signal?.addEventListener('abort', abort, { once: true });
            let directory, timer, timedOut = false;
            const deadline = milliseconds => { clearTimeout(timer); timer = setTimeout(() => { timedOut = true; controller.abort(); }, milliseconds); };
            try {
                deadline(uploadTimeoutMs);
                directory = await mkdtemp(join(temporaryBase, 'team-toolbox-apk-queue-'));
                const request = await receiveQueue(input, directory, controller.signal, { expectedSize, maximumBytes, maximumTotalBytes,
                    checkTargets: async serials => {
                        const devices = await readDevices(controller.signal);
                        if (!devices.some(device => device.state === 'device' && serials.includes(device.serial))) throw new AdbError('device_unavailable', '所选安装设备均未连接或未授权，请刷新设备后重试', 409);
                    } });
                deadline(queueTimeoutMs);
                if (controller.signal.aborted) throw cancelled();
                onUpdate({ type: 'ready', total: request.jobs.length, files: request.files.length, devices: request.serials.length });
                const results = []; let nextDevice = 0;
                const safe = text => String(text || '').replaceAll(directory, '<临时目录>').slice(0, 4000);
                async function worker() {
                    while (nextDevice < request.serials.length && !controller.signal.aborted) {
                        const serial = request.serials[nextDevice++];
                        for (const job of request.jobs.filter(item => item.serial === serial)) {
                            if (controller.signal.aborted) throw cancelled();
                            const common = { serial, fileIndex: job.fileIndex, fileName: request.files[job.fileIndex].fileName };
                            onUpdate({ type: 'device', result: { ...common, status: 'installing', message: '正在检查连接并安装' } });
                            const target = new AbortController(), targetSignal = AbortSignal.any([controller.signal, target.signal]);
                            let timeout = false, result;
                            const targetTimer = setTimeout(() => { timeout = true; target.abort(); }, installTimeoutMs);
                            try {
                                if (!(await readDevices(targetSignal)).some(device => device.serial === serial && device.state === 'device')) throw new AdbError('device_unavailable', '安装设备未连接或未授权，请刷新设备后重试', 409);
                                if (targetSignal.aborted) throw cancelled();
                                const file = request.saved[job.fileIndex], output = await run(['-s', serial, 'install', '-r', file], { signal: targetSignal, timeoutMs: installTimeoutMs, maxBytes: 64 * 1024, secrets: [file, directory] });
                                const combined = String(output.stdout || '') + '\n' + String(output.stderr || '');
                                if (!/(?:^|\r?\n)\s*Success\s*(?:\r?\n|$)/.test(combined) || /\b(?:Failure\s*\[|INSTALL_FAILED_)/.test(combined)) throw new AdbError('install_failed', `APK 未安装成功：${safe(combined).trim().slice(0, 2000) || 'ADB 未确认成功'}`, 502);
                                if (targetSignal.aborted) throw cancelled();
                                result = { ...common, status: 'success', message: 'APK 安装成功', stdout: safe(output.stdout), stderr: safe(output.stderr) };
                            } catch (error) {
                                if (controller.signal.aborted) throw error;
                                result = { ...common, status: 'failed', code: timeout ? 'timeout' : error instanceof AdbError ? error.code : 'install_failed', message: timeout ? '此安装项超时，请核对手机实际状态' : error instanceof AdbError ? safe(error.message) : '此安装项失败，请检查连接后重试' };
                            } finally { clearTimeout(targetTimer); }
                            result.completedAt = new Date().toISOString(); results.push(result);
                            log({ action: 'apk_queue_item', ok: result.status === 'success', ...(result.code ? { code: result.code } : {}) });
                            onUpdate({ type: 'device', result });
                        }
                    }
                }
                // 任一工作线程异常须先中止其他线程，再等待全部退出，之后才能删除共享APK。
                const workers = await Promise.allSettled(Array.from({ length: Math.min(2, request.serials.length) }, () => worker().catch(error => { controller.abort(); throw error; })));
                if (controller.signal.aborted) throw cancelled();
                const rejected = workers.find(item => item.status === 'rejected'); if (rejected) throw rejected.reason;
                const succeeded = results.filter(item => item.status === 'success').length, failed = results.length - succeeded;
                return { total: request.jobs.length, succeeded, failed, files: request.files.length, devices: request.serials.length,
                    message: `安装结束：成功 ${succeeded} 项，失败 ${failed} 项`, completedAt: new Date().toISOString() };
            } catch (error) {
                if (timedOut) throw new AdbError('timeout', 'APK 上传或安装队列超时，已停止后续任务，请核对手机状态', 504);
                if (controller.signal.aborted) throw cancelled();
                if (error instanceof AdbError) throw error;
                throw new AdbError('upload_failed', '多 APK 传送或临时文件处理失败，请检查磁盘空间和连接', 500);
            } finally {
                clearTimeout(timer); signal?.removeEventListener('abort', abort);
                if (directory) await rm(directory, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 }).catch(() => log({ action: 'apk_queue_cleanup', ok: false }));
                if (current === operation) current = null;
            }
        },
        dispose() { current?.controller.abort(); }
    };
}
