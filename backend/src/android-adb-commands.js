import { AdbError } from './android-adb-protocol.js';

const definitions = [
    ['lock-home', '锁定程序', '程序与桌面', '选择支持 HOME 入口的程序，设为默认桌面；按主页键进入。此设置不提供系统级禁退锁定。', ['shell', 'cmd', 'package', 'set-home-activity', '--user', '<当前用户>', '<所选程序>'], true, true],
    ['unlock-home', '解锁程序（恢复桌面）', '程序与桌面', '选择要恢复的桌面程序，重新设为默认 HOME。', ['shell', 'cmd', 'package', 'set-home-activity', '--user', '<当前用户>', '<所选桌面>'], true, true],
    ['ip-address', '获取 IP', '设备查询', '读取所有网络接口的 IPv4 地址，包含 Wi-Fi、移动网络及回环接口。', ['shell', 'ip', '-o', '-4', 'addr', 'show']],
    ['device-info', '设备信息', '设备查询', '读取厂商、品牌、型号、Android 版本、SDK 和 CPU 架构。', ['shell', 'getprop', '<设备属性>']],
    ['memory', '手机内存使用', '运行情况', '读取系统 RAM 与进程内存使用快照，结果来自 dumpsys meminfo。', ['shell', 'dumpsys', 'meminfo']],
    ['cpu', 'CPU 使用', '运行情况', '读取系统与进程 CPU 使用快照，采样时段由 Android 提供。', ['shell', 'dumpsys', 'cpuinfo']]
].map(([id, title, category, description, args, requiresConfirmation = false, requiresHome = false]) =>
    Object.freeze({ id, title, category, description, args: Object.freeze(args), requiresConfirmation, requiresHome }));
const commands = new Map(definitions.map((command) => [command.id, command]));

export function listAndroidCommands() {
    return definitions.map(({ args, ...command }) => ({ ...command, preview: 'adb -s <设备> ' + args.join(' ') }));
}

/** 参数由命令 ID 解析；HOME 仅接收结构化用户/组件，自定义内容从服务端命令库按版本解析。 */
export async function executeAndroidCommand(request, { run, readDevices, signal, resolveCustomCommand = () => null, home }) {
    const { id, serial, confirm } = request;
    const command = typeof id === 'string' && (commands.get(id) || resolveCustomCommand(request));
    if (!command) throw new AdbError('invalid_input', '请选择列表中的常用 ADB 命令');
    if (typeof serial !== 'string' || serial.length > 255 || !/^[A-Za-z0-9_]/.test(serial) || /[^A-Za-z0-9_.:-]/.test(serial)) {
        throw new AdbError('invalid_input', '请选择明确的已连接设备');
    }
    if (command.requiresConfirmation && confirm !== true) throw new AdbError('confirmation_required', command.custom ? '执行自定义命令需要再次确认' : '修改默认桌面需要再次确认');
    if (command.requiresHome) {
        const result = await home.set(request, signal);
        return { commandId: command.id, title: command.title, serial, ...result, message: `${command.id === 'lock-home' ? '默认程序已设置' : '默认桌面已恢复'}：${result.currentHome.split('/')[0]}。按手机主页键进入。` };
    }
    if (request.component !== undefined || request.userId !== undefined) throw new AdbError('invalid_input', '此命令不接受桌面应用参数');
    const target = (await readDevices(signal)).find((device) => device.serial === serial);
    if (!target || target.state !== 'device') throw new AdbError('device_unavailable', '目标设备未连接或未授权，请刷新设备后重试', 409);
    let result;
    if (id === 'device-info') {
        const properties = [['厂商', 'ro.product.manufacturer'], ['品牌', 'ro.product.brand'], ['型号', 'ro.product.model'], ['Android 版本', 'ro.build.version.release'], ['SDK', 'ro.build.version.sdk'], ['CPU 架构', 'ro.product.cpu.abilist']];
        const output = [], errors = [];
        for (const [label, property] of properties) {
            const part = await run(['-s', serial, 'shell', 'getprop', property], { signal, timeoutMs: 5000, maxBytes: 16 * 1024 });
            output.push(`${label}：${part.stdout.trim() || '设备未提供'}`); if (part.stderr) errors.push(part.stderr);
        }
        result = { stdout: output.join('\n'), stderr: errors.join('\n') };
    } else result = await run(['-s', serial, ...command.args], { signal, timeoutMs: 20000, maxBytes: 256 * 1024 });
    return { commandId: command.id, title: command.title, serial, stdout: result.stdout, stderr: result.stderr,
        message: command.args[0] === 'reboot' ? '已发送重启请求，设备连接将暂时中断' : `${command.title}执行完成`,
        ...(command.args[0] === 'reboot' ? { deviceRestarted: true } : {}) };
}
