import { spawn } from 'node:child_process';
import { accessSync, constants, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { APP_ROOT } from './version.js';
import { AdbError, parseDevices, parseMdns, validateEndpoint } from './android-adb-protocol.js';
import { findAdbInFolder } from './android-adb-search.js';
import { createAndroidQrPairing } from './android-qr.js';
import { listAndroidCommands, executeAndroidCommand } from './android-adb-commands.js';
import { createAndroidLogcat } from './android-logcat.js';
import { createAndroidApps } from './android-apps.js';
import { createAndroidScreen } from './android-screen.js';
import { createAndroidCustomCommands } from './android-custom-commands.js';
import { createAndroidHome } from './android-home.js';
import { createAndroidApk } from './android-apk.js';
import { createAndroidPersistent } from './android-persistent.js';
export { AdbError, parseDevices, parseMdns, validateEndpoint } from './android-adb-protocol.js';

function redact(text, secrets = []) {
    let value = String(text || '');
    for (const secret of secrets) if (secret) value = value.replaceAll(secret, '[已隐藏]');
    return value;
}

/** 直接执行程序；配对码只允许通过 input/stdin 传入。 */
export function runAdbProcess(executable, args, { input = '', secrets = [], signal, timeoutMs = 20000, maxBytes = 1024 * 1024 } = {}) {
    return new Promise((resolvePromise, reject) => {
        if (signal?.aborted) return reject(new AdbError('cancelled', '操作已取消', 499));
        const child = spawn(executable, args, { shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');
        let stdout = '';
        let stderr = '';
        let bytes = 0;
        let failure = null;
        let settled = false;
        const stop = (error) => { failure ||= error; child.kill('SIGKILL'); };
        const abort = () => stop(new AdbError('cancelled', '操作已取消', 499));
        const timer = setTimeout(() => stop(new AdbError('timeout', 'ADB 操作超时，请检查手机网络和无线调试状态', 504)), timeoutMs);
        const finish = (error, result) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            signal?.removeEventListener('abort', abort);
            if (error) reject(error); else resolvePromise(result);
        };
        const collect = (kind, chunk) => {
            bytes += Buffer.byteLength(chunk);
            if (bytes > maxBytes) return stop(new AdbError('output_limit', 'ADB 输出超出大小限制', 502));
            if (kind === 'stdout') stdout += chunk.toString('utf8'); else stderr += chunk.toString('utf8');
        };
        child.stdout.on('data', (chunk) => collect('stdout', chunk));
        child.stderr.on('data', (chunk) => collect('stderr', chunk));
        child.stdin.on('error', () => { /* 提前退出时以进程结果为准 */ });
        child.on('error', () => finish(new AdbError('adb_failed', '无法启动 ADB，请检查可执行文件路径及访问权限', 502)));
        child.on('close', (code) => {
            const result = { stdout: redact(stdout, secrets), stderr: redact(stderr, secrets) };
            finish(failure || (code !== 0 ? new AdbError('adb_failed', `ADB 执行失败：${(result.stderr || result.stdout || `退出码 ${code}`).slice(0, 2000)}`, 502) : null), result);
        });
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) abort();
        child.stdin.end(input);
    });
}

function validateExecutable(raw) {
    if (typeof raw !== 'string' || raw.length > 2048 || /[\x00-\x1f]/.test(raw)) throw new AdbError('invalid_input', 'ADB 路径无效');
    const path = raw.trim().replace(/^"(.*)"$/, '$1');
    if (!isAbsolute(path) || basename(path).toLowerCase() !== (process.platform === 'win32' ? 'adb.exe' : 'adb')) {
        throw new AdbError('invalid_input', '请选择 Android Platform-Tools 中 ADB 可执行文件的完整绝对路径');
    }
    try {
        if (!statSync(path).isFile()) throw new Error('not_file');
        accessSync(path, process.platform === 'win32' ? constants.R_OK : constants.X_OK);
    } catch { throw new AdbError('invalid_input', 'ADB 文件不存在或无法访问，请检查路径'); }
    return resolve(path);
}

export function createAndroidAdbService({ configFile = join(APP_ROOT, 'data', 'android-adb.json'), commandFile = join(dirname(configFile), 'android-commands.json'), env = process.env, runner = runAdbProcess, logcatSpawn = spawn, screenSpawn = spawn, apkOptions = {}, persistentOptions = {}, now = Date.now, log = (entry) => console.info('[android-adb]', JSON.stringify(entry)) } = {}) {
    let busy = false;
    let discovered = [];
    let discoveredAt = 0;
    function config() {
        if (env.ADB_PATH) return { path: env.ADB_PATH, directory: dirname(env.ADB_PATH), origin: 'env', configured: true };
        try {
            const value = JSON.parse(readFileSync(configFile, 'utf8'));
            if (value.version !== 1 || typeof value.path !== 'string') throw new Error('bad_config');
            return { path: value.path, directory: value.path ? dirname(value.path) : '', origin: 'file', configured: !!value.path };
        } catch (error) {
            if (error.code === 'ENOENT') return { path: '', directory: '', origin: 'none', configured: false };
            throw new AdbError('config_error', 'ADB 配置无法读取，请检查服务器上的 data/android-adb.json', 500);
        }
    }
    async function exclusive(action, fn) {
        if (busy) throw new AdbError('busy', '另一个 ADB 操作正在执行，请稍后重试', 409);
        busy = true;
        try {
            const result = await fn();
            log({ action, ok: true });
            return result;
        } catch (error) {
            log({ action, ok: false, code: error.code || 'internal_error' });
            throw error;
        } finally { busy = false; }
    }
    async function run(args, options) {
        const saved = config();
        if (!saved.path) throw new AdbError('not_configured', '请先配置 ADB 路径', 409);
        return runner(validateExecutable(saved.path), args, options);
    }
    const qr = createAndroidQrPairing({ run, now, log });
    const customCommands = createAndroidCustomCommands({ file: commandFile, log });
    const readDevices = async (signal) => parseDevices((await run(['devices', '-l'], { signal })).stdout);
    const apps = createAndroidApps({ run, readDevices });
    const home = createAndroidHome({ run, readDevices });
    const apk = createAndroidApk({ ...apkOptions, run, readDevices, log });
    const persistent = createAndroidPersistent({ ...persistentOptions, run, readDevices, executable: () => validateExecutable(config().path), log });
    const screen = createAndroidScreen({ executable: () => validateExecutable(config().path), readDevices, spawnProcess: screenSpawn, log });
    const logcat = createAndroidLogcat({ executable: () => validateExecutable(config().path), readDevices, spawnProcess: logcatSpawn, log,
        readApplication: (serial, packageName, signal) => apps.status(serial, packageName, signal), readProcesses: apps.processes });
    async function refreshed(message, signal) {
        try { return { message, devices: await readDevices(signal) }; }
        catch (error) {
            if (signal?.aborted) throw error;
            return { message, devices: null, warning: `操作成功，但设备列表刷新失败：${error.message}` };
        }
    }
    return {
        getConfig: config,
        commands: () => ({ commands: [...listAndroidCommands(), ...customCommands.list()] }),
        saveCommand: (input, id) => exclusive('custom_command_save', () => customCommands.save(input, id)),
        deleteCommand: (id, input) => exclusive('custom_command_delete', () => customCommands.remove(id, input)),
        executeCommand: (request, signal) => exclusive('command', async () => {
            const result = await executeAndroidCommand(request, { run, readDevices, signal, resolveCustomCommand: customCommands.resolve, home });
            if (result.deviceRestarted) { logcat.stopDevice(request.serial); screen.stopDevice(request.serial); persistent.stopDevice(request.serial); }
            return result;
        }),
        listApps: (serial, signal) => exclusive('apps_list', () => apps.list(serial, signal)),
        listHomeApps: (serial, signal) => exclusive('home_apps', () => home.list(serial, signal)),
        appStatus: (serial, packageName, signal) => exclusive('app_status', () => apps.status(serial, packageName, signal)),
        startLogcat: (serial, signal, packageName = '') => exclusive('logcat_start', () => logcat.start(serial, signal, packageName)),
        pollLogcat: async (id, after, signal) => { logcat.poll(id, after); await logcat.refreshApplication(id, signal); return logcat.poll(id, after); },
        stopLogcat: (id) => logcat.stop(id),
        captureScreen: (serial, signal) => screen.capture(serial, signal),
        installApk: (request, input, signal) => exclusive('apk_install', () => apk.install(request, input, signal)),
        installApkBatch: (request, input, signal, onUpdate) => exclusive('apk_install_batch', () => apk.installBatch(request, input, signal, onUpdate)),
        listPersistent: (request, signal) => exclusive('persistent_list', () => persistent.list(request, signal)),
        inspectPersistent: (request, signal) => exclusive('persistent_inspect', () => persistent.inspect(request, signal)),
        readPersistent: (request, signal, consume) => exclusive('persistent_read', () => persistent.read(request, signal, consume)),
        uploadPersistent: (request, input, signal) => exclusive('persistent_upload', () => persistent.upload(request, input, signal)),
        dispose: () => { qr.invalidate(); logcat.dispose(); screen.dispose(); apk.dispose(); persistent.dispose(); },
        searchFolder: (folder, signal) => exclusive('search_folder', () => findAdbInFolder(folder, { signal })),
        startQr: (signal) => exclusive('qr_start', () => qr.start(signal)),
        pollQr: (id, signal) => exclusive('qr_poll', () => qr.poll(id, signal)),
        // 取消不排队：即使轮询正等待 ADB，也要立即撤销会话、终止其进程。
        cancelQr: (id) => qr.cancel(id),
        configure: (path, signal) => exclusive('configure', async () => {
            if (env.ADB_PATH) throw new AdbError('environment_override', 'ADB_PATH 环境变量已指定路径，请在服务器修改', 409);
            if (typeof path !== 'string') throw new AdbError('invalid_input', '请填写 ADB 路径');
            let normalized = '';
            let version = '';
            if (path.trim()) {
                normalized = validateExecutable(path);
                const result = await runner(normalized, ['version'], { signal, timeoutMs: 10000 });
                if (!/Android Debug Bridge version\s+\d+/i.test(result.stdout)) throw new AdbError('invalid_input', '所选程序未返回有效的 ADB 版本信息');
                version = result.stdout.trim().slice(0, 2000);
            }
            const temporary = `${configFile}.${randomUUID()}.tmp`;
            try {
                mkdirSync(dirname(configFile), { recursive: true });
                writeFileSync(temporary, JSON.stringify({ version: 1, path: normalized }), { encoding: 'utf8', mode: 0o600 });
                renameSync(temporary, configFile);
            } catch {
                throw new AdbError('config_error', 'ADB 路径保存失败，请检查服务器数据目录权限', 500);
            } finally {
                try { unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') log({ action: 'config_cleanup', ok: false, code: error.code }); }
            }
            discovered = [];
            qr.invalidate();
            logcat.dispose();
            screen.dispose();
            persistent.dispose();
            return { ...config(), version };
        }),
        devices: (signal) => exclusive('devices', async () => ({ devices: await readDevices(signal) })),
        discover: (signal) => exclusive('discover', async () => {
            discovered = [];
            discovered = parseMdns((await run(['mdns', 'services'], { signal })).stdout);
            discoveredAt = now();
            return { services: discovered, expiresInSeconds: 120 };
        }),
        connect: (endpoint, signal) => exclusive('connect', async () => {
            const address = validateEndpoint(endpoint);
            const result = await run(['connect', address], { signal });
            if (!/\b(?:already )?connected to\s+/i.test(result.stdout)) throw new AdbError('adb_failed', `连接失败：${(result.stdout || result.stderr || 'ADB 未确认连接成功').slice(0, 2000)}`, 502);
            return refreshed('无线设备已连接', signal);
        }),
        pair: (serviceId, code, signal) => exclusive('pair', async () => {
            if (typeof code !== 'string' || !/^\d{6}$/.test(code)) throw new AdbError('invalid_input', '配对码必须是六位数字');
            const service = discovered.find((item) => item.id === serviceId && item.kind === 'pairing');
            if (!service || now() - discoveredAt > 120000) throw new AdbError('invalid_input', '配对服务已失效，请重新搜索并选择手机的配对服务');
            try {
                const result = await run(['pair', service.endpoint], { signal, input: code + '\n', secrets: [code], timeoutMs: 30000 });
                if (!/Successfully paired to\s+/i.test(result.stdout)) throw new AdbError('adb_failed', `配对失败：${redact(result.stdout || result.stderr, [code]) || '请核对手机配对页面'}`, 502);
                discovered = [];
                return { message: '配对成功，请重新搜索并连接手机的连接服务' };
            } catch (error) {
                throw new AdbError(error.code || 'adb_failed', redact(error.message, [code]).slice(0, 2000), error.status || 502);
            }
        }),
        disconnect: (serial, signal) => exclusive('disconnect', async () => {
            if (typeof serial !== 'string' || !/^[A-Za-z0-9_][A-Za-z0-9_.:-]{0,254}$/.test(serial)) throw new AdbError('invalid_input', '请选择明确的无线设备');
            const target = (await readDevices(signal)).find((item) => item.serial === serial && item.connection === 'wireless');
            if (!target) throw new AdbError('invalid_input', '所选无线设备已不在列表中，请刷新设备');
            const result = await run(['disconnect', serial], { signal });
            if (!/disconnected\s+/i.test(result.stdout)) throw new AdbError('adb_failed', `断开失败：${result.stdout || result.stderr || 'ADB 未确认断开成功'}`, 502);
            logcat.stopDevice(serial);
            screen.stopDevice(serial);
            persistent.stopDevice(serial);
            return refreshed('所选无线设备已断开', signal);
        })
    };
}
