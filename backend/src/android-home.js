import { AdbError } from './android-adb-protocol.js';
import { validatePackageName } from './android-apps.js';

const homeIntent = ['-a', 'android.intent.action.MAIN', '-c', 'android.intent.category.HOME'];

export function validateHomeComponent(value) {
    if (typeof value !== 'string' || value.length > 512) throw new AdbError('invalid_input', '请选择设备提供的桌面应用');
    const parts = value.split('/');
    if (parts.length !== 2) throw new AdbError('invalid_input', '桌面应用组件格式无效');
    const packageName = validatePackageName(parts[0]);
    const activity = parts[1].startsWith('.') ? packageName + parts[1] : parts[1];
    if (!/^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/.test(activity)) throw new AdbError('invalid_input', '桌面应用组件格式无效');
    return packageName + '/' + activity;
}

export function parseHomeActivities(output) {
    const components = new Map();
    for (const line of String(output).split(/\r?\n/)) {
        try {
            const component = validateHomeComponent(line.trim());
            components.set(component, { component, packageName: component.split('/')[0] });
        } catch { /* --components 输出仅接受完整、合法的组件行。 */ }
    }
    return [...components.values()].sort((a, b) => a.component.localeCompare(b.component));
}

export function createAndroidHome({ run, readDevices, timeoutMs = 30000 }) {
    async function limited(signal, action) {
        const deadline = AbortSignal.timeout(timeoutMs), combined = signal ? AbortSignal.any([signal, deadline]) : deadline;
        try { return await action(combined); }
        catch (error) { if (deadline.aborted && !signal?.aborted) throw new AdbError('timeout', '桌面应用操作超时，请检查设备后重试', 504); throw error; }
    }
    async function online(serial, signal) {
        if (typeof serial !== 'string' || !/^[A-Za-z0-9_][A-Za-z0-9_.:-]{0,254}$/.test(serial)) throw new AdbError('invalid_input', '请选择明确的已连接设备');
        if (signal?.aborted) throw new AdbError('cancelled', '桌面应用操作已取消', 499);
        if (!(await readDevices(signal)).some(item => item.serial === serial && item.state === 'device')) throw new AdbError('device_unavailable', '目标设备未连接或未授权，请刷新设备后重试', 409);
    }
    async function user(serial, signal) {
        const { stdout } = await run(['-s', serial, 'shell', 'am', 'get-current-user'], { signal, timeoutMs: 5000, maxBytes: 4096 });
        if (!/^\d+$/.test(stdout.trim()) || !Number.isSafeInteger(Number(stdout.trim())) || Number(stdout.trim()) > 2147483647) throw new AdbError('adb_failed', '无法识别手机当前用户，请检查系统支持情况', 502);
        return Number(stdout.trim());
    }
    async function query(serial, userId, signal) {
        const { stdout } = await run(['-s', serial, 'shell', 'cmd', 'package', 'query-activities', '--brief', '--components', '--user', String(userId), ...homeIntent], { signal, timeoutMs: 10000, maxBytes: 256 * 1024 });
        const homes = parseHomeActivities(stdout);
        if ((!homes.length && stdout.trim() && !/^No activities found\.?\s*$/i.test(stdout.trim())) || homes.length > 2000) throw new AdbError('adb_failed', '无法识别设备桌面应用列表，请检查系统支持情况', 502);
        return homes;
    }
    async function current(serial, userId, signal) {
        const { stdout } = await run(['-s', serial, 'shell', 'cmd', 'package', 'resolve-activity', '--brief', '--components', '--user', String(userId), ...homeIntent], { signal, timeoutMs: 5000, maxBytes: 16 * 1024 });
        const matches = parseHomeActivities(stdout);
        if (matches.length === 1) return matches[0].component;
        if (!matches.length && (!stdout.trim() || /^No activity found\.?\s*$/i.test(stdout.trim()))) return '';
        throw new AdbError('adb_failed', '无法识别当前默认桌面，请重新读取', 502);
    }
    return {
        list(serial, signal) {
            return limited(signal, async combined => {
                await online(serial, combined); const userId = await user(serial, combined);
                const homes = await query(serial, userId, combined), currentHome = await current(serial, userId, combined);
                return { serial, userId, homes, currentHome };
            });
        },
        async set({ serial, component, userId, confirm }, signal) {
            const normalized = validateHomeComponent(component);
            if (!Number.isSafeInteger(userId) || userId < 0 || userId > 2147483647) throw new AdbError('invalid_input', '请先读取当前用户的桌面应用');
            if (confirm !== true) throw new AdbError('confirmation_required', '修改默认桌面需要再次确认');
            return limited(signal, async combined => {
                await online(serial, combined);
                if (await user(serial, combined) !== userId) throw new AdbError('home_changed', '手机当前用户已改变，请重新读取并选择桌面应用', 409);
                if (!(await query(serial, userId, combined)).some(item => item.component === normalized)) throw new AdbError('home_unavailable', '所选程序未提供 HOME 入口或已不可用，请重新读取桌面应用', 409);
                const result = await run(['-s', serial, 'shell', 'cmd', 'package', 'set-home-activity', '--user', String(userId), normalized], { signal: combined, timeoutMs: 15000, maxBytes: 256 * 1024 });
                if (!/^Success\s*$/im.test(result.stdout) || /(?:Error:|Exception|Failed)/i.test(result.stdout + result.stderr)) throw new AdbError('adb_failed', '默认桌面设置未成功：' + (result.stderr || result.stdout || '设备未确认结果').slice(0, 1000), 502);
                let currentHome;
                try { currentHome = await current(serial, userId, combined); }
                catch (error) { throw new AdbError(error.code || 'adb_failed', '已发送桌面设置，但无法复查当前默认值，请重新读取后核对', error.status || 502); }
                // 新版 Android 按包名选择 HOME 角色，同包内的实际 Activity 可由系统决定。
                if (currentHome.split('/')[0] !== normalized.split('/')[0]) throw new AdbError('home_not_applied', '设备返回成功，但默认桌面未切换到所选程序，请重新读取后核对', 409);
                return { ...result, userId, component: normalized, currentHome };
            });
        }
    };
}
