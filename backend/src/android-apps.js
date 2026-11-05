import { AdbError } from './android-adb-protocol.js';

export function validatePackageName(value) {
    if (typeof value !== 'string' || value.length > 255 || !/^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/.test(value)) {
        throw new AdbError('invalid_input', '请选择有效的应用包名');
    }
    return value;
}

export function parseInstalledPackages(output) {
    return [...new Set(String(output).split(/\r?\n/).flatMap(line => {
        const match = /^package:([^\s]+)\s*$/.exec(line.trim());
        if (!match) return [];
        try { return [validatePackageName(match[1])]; } catch { return []; }
    }))].sort();
}

export function parseAppProcesses(output, packageName) {
    validatePackageName(packageName);
    const found = new Map();
    for (const line of String(output).split(/\r?\n/)) {
        const match = /^\s*([0-9]+)\s+(\S+)\s*$/.exec(line);
        if (!match || Number(match[1]) < 1 || Number(match[1]) > 2147483647) continue;
        const [, pid, name] = match;
        if (name === packageName || name.startsWith(packageName + ':')) found.set(pid, { pid, name });
    }
    return [...found.values()].sort((a, b) => Number(a.pid) - Number(b.pid));
}

/** 只读应用信息；参数固定，应用包名不交给 Shell 拼接。 */
export function createAndroidApps({ run, readDevices }) {
    function validateSerial(serial) {
        if (typeof serial !== 'string' || !/^[A-Za-z0-9_][A-Za-z0-9_.:-]{0,254}$/.test(serial)) throw new AdbError('invalid_input', '请选择明确的已连接设备');
    }
    async function online(serial, signal) {
        validateSerial(serial);
        if (signal?.aborted) throw new AdbError('cancelled', '应用信息读取已取消', 499);
        if (!(await readDevices(signal)).some(device => device.serial === serial && device.state === 'device')) {
            throw new AdbError('device_unavailable', '应用设备未连接或未授权，请刷新设备后重试', 409);
        }
    }
    async function processes(serial, packageName, signal) {
        validateSerial(serial); validatePackageName(packageName);
        const { stdout } = await run(['-s', serial, 'shell', 'ps', '-A', '-w', '-o', 'PID,NAME'], { signal, timeoutMs: 5000, maxBytes: 512 * 1024 });
        if (!/^\s*PID\s+NAME\s*$/m.test(stdout)) throw new AdbError('adb_failed', '无法识别设备进程列表，请检查 Android 系统是否支持 ps -A -w -o PID,NAME', 502);
        const found = parseAppProcesses(stdout, packageName);
        return { packageName, running: found.length > 0, processes: found, checkedAt: new Date().toISOString() };
    }
    return {
        async list(serial, signal) {
            await online(serial, signal);
            const { stdout } = await run(['-s', serial, 'shell', 'pm', 'list', 'packages'], { signal, timeoutMs: 10000, maxBytes: 256 * 1024 });
            if (stdout.trim() && !/^package:/m.test(stdout)) throw new AdbError('adb_failed', '无法读取已安装应用，请检查设备权限', 502);
            const packages = parseInstalledPackages(stdout);
            return { serial, packages: packages.slice(0, 2000), truncated: packages.length > 2000 };
        },
        async status(serial, packageName, signal) {
            validatePackageName(packageName); await online(serial, signal);
            const { stdout } = await run(['-s', serial, 'shell', 'pm', 'path', packageName], { signal, timeoutMs: 5000, maxBytes: 64 * 1024 });
            if (!/^package:\//m.test(stdout)) throw new AdbError('app_unavailable', '所选应用已不在设备中，请刷新应用列表', 409);
            return { serial, ...await processes(serial, packageName, signal) };
        },
        processes
    };
}
