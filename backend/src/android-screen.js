import { spawn } from 'node:child_process';
import { AdbError } from './android-adb-protocol.js';

const maximumBytes = 16 * 1024 * 1024;
const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
    for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    return value >>> 0;
});
function crc32(buffer, start, end) {
    let crc = 0xffffffff;
    for (let index = start; index < end; index++) crc = crcTable[(crc ^ buffer[index]) & 255] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
}

/** 校验完整 PNG、块 CRC 与解码尺寸，拒绝截断/超大的设备输出。 */
export function inspectScreenPng(data) {
    const invalid = () => { throw new AdbError('invalid_image', '设备未返回完整有效的 PNG 画面，请重新读取', 502); };
    if (!Buffer.isBuffer(data) || data.length < 57 || data.length > maximumBytes || !data.subarray(0, 8).equals(signature)) invalid();
    let offset = 8, width = 0, height = 0, hasData = false, ended = false;
    while (offset < data.length) {
        if (data.length - offset < 12) invalid();
        const size = data.readUInt32BE(offset), end = offset + size + 12;
        if (end > data.length) invalid();
        const type = data.toString('ascii', offset + 4, offset + 8);
        if (!/^[A-Za-z]{4}$/.test(type) || crc32(data, offset + 4, end - 4) !== data.readUInt32BE(end - 4)) invalid();
        if (offset === 8 && (type !== 'IHDR' || size !== 13)) invalid();
        if (type === 'IHDR') {
            if (width || offset !== 8 || size !== 13) invalid();
            width = data.readUInt32BE(offset + 8); height = data.readUInt32BE(offset + 12);
            if (!width || !height || width > 16384 || height > 16384 || width * height > 32 * 1024 * 1024) {
                throw new AdbError('image_limit', '设备画面尺寸超出预览限制', 502);
            }
        }
        if (type === 'IDAT') hasData = true;
        if (type === 'IEND') { if (size || end !== data.length || !hasData) invalid(); ended = true; }
        offset = end;
    }
    if (!ended) invalid();
    return { width, height };
}

/** 与文本 ADB runner 分开，PNG 输出始终保持原始字节。 */
export function runScreenProcess(executable, args, { signal, spawnProcess = spawn, timeoutMs = 12000, maxBytes = maximumBytes } = {}) {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) return reject(new AdbError('cancelled', '屏幕读取已取消', 499));
        let child;
        try { child = spawnProcess(executable, args, { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); }
        catch { return reject(new AdbError('adb_failed', '无法启动屏幕读取，请检查 ADB 配置和权限', 502)); }
        let output = [], errors = [], bytes = 0, errorBytes = 0, settled = false;
        const finish = (error, data) => {
            if (settled) return;
            settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort);
            output = []; errors = [];
            if (error) { child.kill('SIGKILL'); reject(error); } else resolve(data);
        };
        const abort = () => finish(new AdbError('cancelled', '屏幕读取已取消', 499));
        const timer = setTimeout(() => finish(new AdbError('timeout', '屏幕读取超时，请检查设备和网络', 504)), timeoutMs);
        child.stdout.on('data', chunk => {
            if (settled) return;
            bytes += chunk.length;
            if (bytes > maxBytes) finish(new AdbError('output_limit', '设备画面超出 16 MiB 读取限制', 502));
            else output.push(chunk);
        });
        child.stderr.on('data', chunk => {
            if (settled) return;
            errorBytes += chunk.length;
            if (errorBytes > 4096) finish(new AdbError('output_limit', '屏幕读取错误输出超出限制', 502));
            else errors.push(chunk);
        });
        child.on('error', () => finish(new AdbError('adb_failed', '无法启动屏幕读取，请检查 ADB 配置和权限', 502)));
        child.on('close', code => {
            if (settled) return;
            if (code !== 0) finish(new AdbError('adb_failed', `屏幕读取失败：${Buffer.concat(errors).toString('utf8').trim().slice(0, 1000) || '设备断开或 ADB 进程退出'}`, 502));
            else finish(null, Buffer.concat(output, bytes));
        });
        signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort();
    });
}

export function createAndroidScreen({ executable, readDevices, spawnProcess = spawn, log = () => {}, timeoutMs = 12000 }) {
    let current;
    return {
        async capture(serial, signal) {
            if (typeof serial !== 'string' || !/^[A-Za-z0-9_][A-Za-z0-9_.:-]{0,254}$/.test(serial)) throw new AdbError('invalid_input', '请选择明确的屏幕设备');
            if (signal?.aborted) throw new AdbError('cancelled', '屏幕读取已取消', 499);
            if (current) throw new AdbError('busy', '另一个屏幕读取正在进行，请稍后重试', 409);
            const controller = new AbortController(), operation = current = { serial, controller };
            let timedOut = false;
            const abort = () => controller.abort(); signal?.addEventListener('abort', abort, { once: true });
            const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
            try {
                const target = (await readDevices(controller.signal)).find(item => item.serial === serial && item.state === 'device');
                if (controller.signal.aborted) throw new AdbError('cancelled', '屏幕读取已取消', 499);
                if (!target) throw new AdbError('device_unavailable', '屏幕设备未连接或未授权，请刷新设备后重试', 409);
                const data = await runScreenProcess(executable(), ['-s', serial, 'exec-out', 'screencap', '-p'], { signal: controller.signal, spawnProcess });
                const dimensions = inspectScreenPng(data);
                return { data, ...dimensions, capturedAt: new Date().toISOString() };
            } catch (error) {
                const failure = timedOut ? new AdbError('timeout', '屏幕读取超时，请检查设备和网络', 504) : error;
                if (failure.code !== 'cancelled') log({ action: 'screen_capture', ok: false, code: failure.code || 'internal_error' });
                throw failure;
            } finally {
                clearTimeout(timer); signal?.removeEventListener('abort', abort); if (current === operation) current = null;
            }
        },
        stopDevice(serial) { if (current?.serial === serial) current.controller.abort(); },
        dispose() { current?.controller.abort(); }
    };
}
