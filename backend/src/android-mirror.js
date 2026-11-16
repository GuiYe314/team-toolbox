import { spawn } from 'node:child_process';
import { createConnection } from 'node:net';
import { readFile } from 'node:fs/promises';
import { randomBytes, createHash } from 'node:crypto';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AdbError } from './android-adb-protocol.js';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const SCRCPY = Object.freeze({ version: '5.0.1', size: 733930, sha256: '764eb6f79811d5211fe9df341120882ba9994c7a61b897d7bf3fb662e53bc536' });
const fail = (message, status = 400) => { throw new AdbError('mirror_error', message, status); };
export function mirrorArguments(serial, scid, remote) {
    return ['-s', serial, 'shell', `CLASSPATH=${remote}`, 'app_process', '/', 'com.genymobile.scrcpy.Server', SCRCPY.version, `scid=${scid}`, 'tunnel_forward=true', 'audio=false', 'control=true', 'video_codec=h264', 'max_size=1280', 'max_fps=30', 'video_bit_rate=4000000', 'video_codec_options=i-frame-interval=1', 'send_device_meta=false', 'send_dummy_byte=true', 'send_stream_meta=true', 'send_frame_meta=true', 'clipboard_autosync=false', 'cleanup=true', 'power_on=true'];
}
export function controlMessage(value, dimensions) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail('控制参数无效');
    if (value.type === 'key') {
        const allowed = [3, 4, 19, 20, 21, 22, 23, 24, 25, 61, 66, 67, 82, 92, 93, 111, 112, 122, 123, 187];
        if (!allowed.includes(value.keycode) || ![0, 1].includes(value.action)) fail('按键无效');
        const bytes = Buffer.alloc(14); bytes[0] = 0; bytes[1] = value.action; bytes.writeUInt32BE(value.keycode, 2); return bytes;
    }
    if (value.type === 'text') {
        if (typeof value.text !== 'string' || !/^[\x20-\x7e]{1,200}$/.test(value.text)) fail('输入文字仅支持最多200个英文、数字或英文符号');
        const text = Buffer.from(value.text), bytes = Buffer.alloc(5 + text.length); bytes[0] = 1; bytes.writeUInt32BE(text.length, 1); text.copy(bytes, 5); return bytes;
    }
    if (value.type === 'touch') {
        const { width, height } = dimensions;
        if (!Number.isInteger(width) || !Number.isInteger(height) || !width || !height || ![0, 1, 2, 3].includes(value.action) || !Number.isInteger(value.x) || !Number.isInteger(value.y) || value.x < 0 || value.x >= width || value.y < 0 || value.y >= height) fail('触控坐标或画面尺寸无效');
        const bytes = Buffer.alloc(32); bytes[0] = 2; bytes[1] = value.action; bytes.writeBigInt64BE(-1n, 2); bytes.writeUInt32BE(value.x, 10); bytes.writeUInt32BE(value.y, 14); bytes.writeUInt16BE(width, 18); bytes.writeUInt16BE(height, 20); bytes.writeUInt16BE(value.action === 1 || value.action === 3 ? 0 : 65535, 22); bytes.writeUInt32BE(value.action === 0 || value.action === 1 ? 1 : 0, 24); bytes.writeUInt32BE(value.action === 1 || value.action === 3 ? 0 : 1, 28); return bytes;
    }
    fail('不支持的控制操作');
}

export function createAndroidMirror({ executable, readDevices, run, spawnProcess = spawn, connect = createConnection, jar = join(ROOT, 'vendor/scrcpy/scrcpy-server.jar'), verifyComponent, now = Date.now, log = () => {} } = {}) {
    let current, starting = false, stopping = Promise.resolve();
    async function capabilities() { try { const bytes = await readFile(jar); return { ready: bytes.length === SCRCPY.size && createHash('sha256').update(bytes).digest('hex') === SCRCPY.sha256, version: SCRCPY.version }; } catch { return { ready: false, version: SCRCPY.version }; } }
    function session(id) { if (!current || current.id !== id || current.closed) fail('投屏会话已结束，请重新启动', 410); current.lastSeen = now(); return current; }
    function end(target) {
        if (!target || target.closed) return stopping;
        target.closed = true; clearInterval(target.watchdog); target.controller.abort(); target.video?.destroy(); target.control?.destroy(); target.child?.kill(); target.response?.destroy();
        if (current === target) current = null;
        stopping = stopping.then(async () => {
            if (target.port) await run(['-s', target.serial, 'forward', '--remove', `tcp:${target.port}`], { timeoutMs: 4000, maxBytes: 4096 }).catch(() => {});
            if (target.remote) await run(['-s', target.serial, 'shell', 'rm', '-f', target.remote], { timeoutMs: 4000, maxBytes: 4096 }).catch(() => {});
        });
        log({ action: 'mirror_stop', ok: true }); return stopping;
    }
    async function socket(port, signal, dummy = false) {
        for (let attempt = 0; attempt < 40; attempt++) {
            signal.throwIfAborted();
            try {
                return await new Promise((resolveSocket, reject) => {
                    const connection = connect({ host: '127.0.0.1', port }); let done = false;
                    const finish = error => { if (done) return; done = true; clearTimeout(timer); signal.removeEventListener('abort', abort); connection.removeListener('error', failed); connection.removeListener('data', first); if (error) { connection.destroy(); reject(error); } else { connection.pause(); connection.on('error', () => {}); resolveSocket(connection); } };
                    const failed = () => finish(new Error('socket_unavailable')), abort = () => finish(new Error('cancelled'));
                    const first = bytes => { if (!bytes.length || bytes[0] !== 0) return finish(new Error('invalid_dummy')); if (bytes.length > 1) connection.unshift(bytes.subarray(1)); finish(); };
                    const timer = setTimeout(() => finish(new Error('socket_timeout')), 500);
                    signal.addEventListener('abort', abort, { once: true }); connection.once('error', failed);
                    connection.once('connect', () => { if (dummy) connection.once('data', first); else finish(); });
                });
            } catch { signal.throwIfAborted(); await new Promise(resolveWait => setTimeout(resolveWait, 100)); }
        }
        fail('手机投屏服务未能建立连接，请检查系统版本和调试授权', 502);
    }
    async function start(serial, signal) {
        if (starting || current) fail('已有投屏正在运行，请先停止', 409);
        if (typeof serial !== 'string' || !/^[A-Za-z0-9_][A-Za-z0-9_.:-]{0,254}$/.test(serial)) fail('请选择明确的安卓设备');
        starting = true; const controller = new AbortController(), externalAbort = () => controller.abort(); signal?.addEventListener('abort', externalAbort, { once: true });
        const scid = (randomBytes(4).readUInt32BE() & 0x7fffffff).toString(16).padStart(8, '0');
        const target = { id: randomBytes(24).toString('hex'), serial, controller, remote: `/data/local/tmp/toolbox-scrcpy-${scid}.jar`, lastSeen: now(), startedAt: now(), dimensions: { width: 0, height: 0 } };
        current = target;
        const deadline = setTimeout(() => controller.abort(), 25_000);
        try {
            if (signal?.aborted) controller.abort();
            await stopping; controller.signal.throwIfAborted();
            const devices = await readDevices(controller.signal);
            if (!devices.some(device => device.serial === serial && device.state === 'device')) fail('设备未在线或未授权', 409);
            if (!(await (verifyComponent ? verifyComponent() : capabilities())).ready) fail('scrcpy 组件未准备或校验失败，请在工具箱目录运行 node scripts/prepare-scrcpy.mjs', 409);
            await run(['-s', serial, 'push', jar, target.remote], { signal: controller.signal, timeoutMs: 15_000, maxBytes: 16 * 1024 });
            const forwarded = await run(['-s', serial, 'forward', 'tcp:0', `localabstract:scrcpy_${scid}`], { signal: controller.signal, timeoutMs: 8000 });
            target.port = Number(forwarded.stdout.trim());
            if (!Number.isInteger(target.port) || target.port < 1 || target.port > 65535) fail('ADB 未返回有效的临时投屏端口', 502);
            controller.signal.throwIfAborted();
            target.child = spawnProcess(executable(), mirrorArguments(serial, scid, target.remote), { windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
            let output = 0;
            const drain = chunk => { output += chunk.length; if (output > 64 * 1024) void end(target); };
            target.child.stdout.on('data', drain); target.child.stderr.on('data', drain);
            target.child.once('error', () => { void end(target); }); target.child.once('close', () => { void end(target); });
            target.video = await socket(target.port, controller.signal, true);
            target.control = await socket(target.port, controller.signal);
            target.control.resume(); target.control.on('data', () => {});
            target.video.on('close', () => { void end(target); }); target.control.on('close', () => { void end(target); });
            target.watchdog = setInterval(() => { if (now() - target.lastSeen > 20_000 || now() - target.startedAt > 60 * 60_000) void end(target); }, 3000); target.watchdog.unref?.();
            controller.signal.throwIfAborted(); log({ action: 'mirror_start', ok: true });
            return { id: target.id, version: SCRCPY.version, maxSize: 1280, maxFps: 30 };
        } catch (error) { await end(target); if (error instanceof AdbError) throw error; fail('投屏启动失败或已取消，请确认手机解锁、在线和调试授权', 502); }
        finally { clearTimeout(deadline); signal?.removeEventListener('abort', externalAbort); starting = false; }
    }
    function attach(id, response) {
        const target = session(id); if (target.response) fail('投屏画面只能读取一次，请重新启动', 409);
        target.response = response; let bytes = 0;
        response.type('application/octet-stream'); response.flushHeaders();
        target.video.on('data', chunk => { bytes += chunk.length; if (bytes > 8 * 1024 ** 3 || response.writableLength > 4 * 1024 ** 2) void end(target); });
        target.video.pipe(response); response.once('close', () => { void end(target); }); target.video.resume();
    }
    function control(id, value) {
        const target = session(id);
        if (value.type === 'dimensions') {
            if (![value.width, value.height].every(size => Number.isInteger(size) && size >= 1 && size <= 4096) || value.width * value.height > 8 * 1024 ** 2) fail('投屏尺寸无效');
            target.dimensions = { width: value.width, height: value.height }; return { ok: true };
        }
        const second = Math.floor(now() / 1000); if (target.second !== second) { target.second = second; target.controls = 0; }
        if (++target.controls > 120) fail('操作过于频繁', 429);
        if (target.control.writableLength > 64 * 1024) fail('设备控制通道繁忙', 409);
        target.control.write(controlMessage(value, target.dimensions)); return { ok: true };
    }
    return { capabilities, start, attach, control, heartbeat(id) { const target = session(id); return { active: !target.closed }; }, stop: id => end(session(id)), stopDevice(serial) { if (current?.serial === serial) void end(current); }, dispose() { return end(current); } };
}
