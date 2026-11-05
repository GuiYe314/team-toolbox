export class AdbError extends Error {
    constructor(code, message, status = 400) {
        super(message);
        this.code = code;
        this.status = status;
    }
}

export function validateEndpoint(raw) {
    if (typeof raw !== 'string' || raw.length > 64) throw new AdbError('invalid_input', '请输入 IPv4:端口');
    const value = raw.trim();
    const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3}):(\d{1,5})$/.exec(value);
    if (!match) throw new AdbError('invalid_input', '地址格式应为 IPv4:端口，例如 192.168.1.20:37123');
    const octets = match.slice(1, 5);
    const port = Number(match[5]);
    if (octets.some((x) => Number(x) > 255 || String(Number(x)) !== x) ||
        Number(octets[0]) === 0 || Number(octets[0]) === 127 || Number(octets[0]) >= 224 || port < 1 || port > 65535) {
        throw new AdbError('invalid_input', '请填写有效的手机 IPv4 地址和 1–65535 端口，不能使用回环或组播地址');
    }
    return `${octets.join('.')}:${port}`;
}

export function parseDevices(output) {
    const devices = new Map();
    for (const line of output.split(/\r?\n/)) {
        const match = /^(\S+)\s+(device|offline|unauthorized|recovery|sideload|bootloader|no permissions)(?:\s+(.*))?$/.exec(line.trim());
        if (!match || !/^[A-Za-z0-9_][A-Za-z0-9_.:-]{0,254}$/.test(match[1])) continue;
        const [, serial, state, extra = ''] = match;
        const attrs = Object.fromEntries([...extra.matchAll(/(model|product|device|transport_id):([^\s]+)/g)].map((m) => [m[1], m[2]]));
        let wireless = /\._adb-tls-connect\._tcp\.?$/i.test(serial);
        try { validateEndpoint(serial); wireless = true; } catch { /* USB 或模拟器序列号 */ }
        const connection = wireless ? 'wireless' : /^emulator-\d+$/.test(serial) ? 'emulator' : 'usb';
        devices.set(serial, { serial, state, connection, model: (attrs.model || '').replaceAll('_', ' '), product: attrs.product || '', transportId: attrs.transport_id || '' });
        if (devices.size >= 200) break;
    }
    return [...devices.values()].sort((a, b) => a.serial.localeCompare(b.serial));
}

export function parseMdns(output) {
    const found = new Map();
    for (const line of output.split(/\r?\n/)) {
        const match = /^([A-Za-z0-9_.-]{1,255})\s+_adb-tls-(connect|pairing)\._tcp\.?\s+(\S+)\s*$/.exec(line.trim());
        if (!match) continue;
        try {
            const endpoint = validateEndpoint(match[3]);
            const id = `${match[2]}|${match[1]}|${endpoint}`;
            found.set(id, { id, name: match[1], kind: match[2], endpoint });
        } catch { /* 忽略不支持的 IPv6 或无效广播结果 */ }
        if (found.size >= 200) break;
    }
    return [...found.values()].sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
}
