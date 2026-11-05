import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { AdbError } from './android-adb-protocol.js';
import { validatePackageName } from './android-apps.js';

export function parseLogcatLine(raw) {
    const match = /^(\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\.\d+)\s+(\d+)\s+(\d+)\s+([VDIWEFAS])\s+(.+?)\s*:\s?(.*)$/.exec(raw);
    return match ? { time: match[1], pid: match[2], tid: match[3], level: match[4], tag: match[5].trim(), message: match[6], raw }
        : { time: '', pid: '', tid: '', level: 'I', tag: '', message: raw, raw };
}

/** 单个本机实时会话；无心跳时终止，内容只进入有界内存缓存。 */
export function createAndroidLogcat({ executable, readDevices, readApplication, readProcesses, spawnProcess = spawn, log = () => {}, idleMs = 15000, maxEntries = 2000, maxBytes = 1024 * 1024, now = Date.now, applicationRefreshMs = 2000 }) {
    let current;
    const active = (session) => ['starting', 'running'].includes(session.state);
    function add(session, raw) {
        if (!raw) return;
        const text = raw.length > 4096 ? raw.slice(0, 4096) + '…[单行已截断]' : raw;
        const parsed = parseLogcatLine(text);
        if (session.application && !session.application.processes.some(process => process.pid === parsed.pid)) return;
        const entry = { ...parsed, seq: ++session.sequence };
        const bytes = Buffer.byteLength(JSON.stringify(entry));
        session.entries.push({ entry, bytes }); session.bytes += bytes;
        while (session.entries.length > maxEntries || session.bytes > maxBytes) {
            session.bytes -= session.entries.shift().bytes; session.dropped++;
        }
    }
    function finish(session, state, message) {
        if (!active(session)) return;
        if (session.pending) { add(session, session.pending); session.pending = ''; }
        session.state = state; session.message = message;
        clearTimeout(session.idleTimer);
        session.applicationController?.abort();
        session.child?.kill('SIGKILL');
        log({ action: 'logcat_stop', ok: state !== 'failed', code: state });
    }
    function touch(session) {
        clearTimeout(session.idleTimer);
        if (active(session)) {
            session.idleTimer = setTimeout(() => finish(session, 'expired', '日志采集因页面长时间未响应而停止，请重新开始'), idleMs);
            session.idleTimer.unref?.();
        }
    }
    function get(id) {
        if (!current || current.id !== id) throw new AdbError('invalid_session', '日志会话已失效，请重新开始', 409);
        return current;
    }
    function metadata(session) {
        return { id: session.id, serial: session.serial, state: session.state, message: session.message, total: session.sequence, dropped: session.dropped, application: session.application || null };
    }
    return {
        async start(serial, signal, packageName = '') {
            if (typeof serial !== 'string' || serial.length > 255 || !/^[A-Za-z0-9_]/.test(serial) || /[^A-Za-z0-9_.:-]/.test(serial)) throw new AdbError('invalid_input', '请选择明确的已连接日志设备');
            if (packageName !== '') validatePackageName(packageName);
            const device = (await readDevices(signal)).find(item => item.serial === serial && item.state === 'device');
            if (!device) throw new AdbError('device_unavailable', '日志设备未连接或未授权，请刷新设备后重试', 409);
            if (signal?.aborted) throw new AdbError('cancelled', '日志采集已取消', 499);
            const application = packageName ? await readApplication(serial, packageName, signal) : null;
            if (signal?.aborted) throw new AdbError('cancelled', '日志采集已取消', 499);
            const path = executable();
            if (current) finish(current, 'stopped', '已切换日志会话');
            const session = current = { id: randomUUID(), serial, application, applicationCheckedAt: now(), state: 'starting', message: '正在启动日志采集', entries: [], bytes: 0, sequence: 0, dropped: 0, pending: '', stderr: '' };
            try {
                const child = session.child = spawnProcess(path, ['-s', serial, 'logcat', '-v', 'threadtime', '-T', '100'], { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
                child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
                child.stdout.on('data', chunk => {
                    if (!active(session)) return;
                    session.pending += chunk;
                    if (session.pending.length > 65536) { finish(session, 'failed', '日志单次输出过大，采集已停止'); return; }
                    const lines = session.pending.split(/\r?\n/); session.pending = lines.pop();
                    for (const line of lines) add(session, line);
                });
                child.stderr.on('data', chunk => { if (active(session)) session.stderr = (session.stderr + chunk).slice(-4096); });
                child.on('error', () => finish(session, 'failed', '无法启动 ADB 日志进程，请检查配置和权限'));
                child.on('close', code => {
                    if (active(session)) finish(session, code === 0 ? 'stopped' : 'failed', code === 0 ? '设备日志流已结束' : `设备日志采集中断：${session.stderr.trim() || '设备断开或 ADB 进程退出'}`);
                });
                await new Promise((resolve, reject) => {
                    const abort = () => { cleanup(); finish(session, 'stopped', '日志采集已取消'); reject(new AdbError('cancelled', '日志采集已取消', 499)); };
                    const timer = setTimeout(() => { cleanup(); finish(session, 'failed', '启动日志进程超时'); reject(new AdbError('timeout', '启动日志进程超时', 504)); }, 5000);
                    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); };
                    child.once('spawn', () => { cleanup(); resolve(); });
                    child.once('error', () => { cleanup(); reject(new AdbError('adb_failed', session.message, 502)); });
                    signal?.addEventListener('abort', abort, { once: true });
                    if (signal?.aborted) abort();
                });
                if (!active(session)) throw new AdbError('adb_failed', session.message, 502);
                session.state = 'running'; session.message = application ? '正在采集所选应用的 Logcat；应用未运行时等待新进程' : '正在采集设备 Logcat'; touch(session);
                log({ action: 'logcat_start', ok: true });
                return metadata(session);
            } catch (error) {
                finish(session, 'failed', '启动日志采集失败');
                throw error instanceof AdbError ? error : new AdbError('adb_failed', '启动日志采集失败，请检查 ADB 配置', 502);
            }
        },
        async refreshApplication(id, signal) {
            const session = get(id); touch(session);
            if (!session.application || !active(session) || now() - session.applicationCheckedAt < applicationRefreshMs || signal?.aborted) return;
            if (session.applicationRefresh) return session.applicationRefresh;
            const controller = session.applicationController = new AbortController();
            const abort = () => controller.abort(); signal?.addEventListener('abort', abort, { once: true });
            session.applicationRefresh = (async () => {
                try {
                    const application = await readProcesses(session.serial, session.application.packageName, controller.signal);
                    if (active(session) && !controller.signal.aborted) { session.application = application; session.applicationCheckedAt = now(); }
                } catch (error) {
                    if (active(session) && !controller.signal.aborted) finish(session, 'failed', `无法刷新应用运行状态：${error.message}`);
                } finally {
                    signal?.removeEventListener('abort', abort); session.applicationRefresh = null;
                }
            })();
            return session.applicationRefresh;
        },
        poll(id, after = 0) {
            if (!Number.isSafeInteger(after) || after < 0) throw new AdbError('invalid_input', '日志游标无效');
            const session = get(id); touch(session);
            const entries = session.entries.filter(item => item.entry.seq > after).slice(0, 300).map(item => item.entry);
            const cursor = entries.at(-1)?.seq ?? Math.min(after, session.sequence);
            return { ...metadata(session), entries, cursor, hasMore: cursor < session.sequence };
        },
        stop(id) { const session = get(id); finish(session, 'stopped', '日志采集已停止'); return metadata(session); },
        stopDevice(serial) { if (current?.serial === serial) finish(current, 'stopped', '目标设备连接发生变化，日志采集已停止'); },
        dispose() { if (current) finish(current, 'stopped', 'ADB 配置变化或服务关闭，日志采集已停止'); current = null; }
    };
}
