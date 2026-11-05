import { networkInterfaces } from 'node:os';
import { randomUUID } from 'node:crypto';
import { formatIpv4, ipv4Number, isPrivateIpv4, readLogJson, UnityLogError, validatePort } from './unity-log-http.js';

export function buildScanPlan(interfaces, maxTargets = 1024, requestedAddress = '') {
    const networks = [];
    for (const [name, entries] of Object.entries(interfaces)) for (const item of entries || []) {
        if (item.internal || item.family !== 'IPv4' || !isPrivateIpv4(item.address)) continue;
        const local = ipv4Number(item.address), mask = ipv4Number(item.netmask);
        if (mask === null) continue;
        const inverse = 0xffffffff - mask;
        if ((inverse & (inverse + 1)) !== 0) continue;
        const first = (local & mask) >>> 0, last = first + inverse;
        const start = inverse > 1 ? first + 1 : first, end = inverse > 1 ? last - 1 : last;
        if (!isPrivateIpv4(formatIpv4(start)) || !isPrivateIpv4(formatIpv4(end))) continue;
        networks.push({ name, address: item.address, cidr: `${formatIpv4(first)}/${32 - Math.log2(inverse + 1)}`, start, end,
            totalHosts: end - start + 1, planned: 0, checked: 0, limited: false });
    }
    networks.sort((a, b) => Number(/virtual|vethernet|docker|vmware|tailscale/i.test(a.name)) - Number(/virtual|vethernet|docker|vmware|tailscale/i.test(b.name)) || a.totalHosts - b.totalHosts || a.cidr.localeCompare(b.cidr));
    if (requestedAddress && (!isPrivateIpv4(requestedAddress) || !networks.some(n => ipv4Number(requestedAddress) >= n.start && ipv4Number(requestedAddress) <= n.end)))
        throw new UnityLogError('invalid_address', '指定 IP 必须位于本机连接的局域网网段中');
    const targets = [], seen = new Set();
    const add = (address, network) => {
        if (targets.length >= maxTargets || seen.has(address) || !isPrivateIpv4(address)) return;
        seen.add(address); targets.push({ address, network }); network.planned++;
    };
    for (const network of networks) {
        if (requestedAddress) {
            const number = ipv4Number(requestedAddress);
            if (number >= network.start && number <= network.end) add(requestedAddress, network);
        } else {
            // 大网段先找本机所在 /24，随后从真实子网起点补齐，循环始终有界。
            const block = (ipv4Number(network.address) & 0xffffff00) >>> 0;
            for (let n = Math.max(network.start, block); n <= Math.min(network.end, block + 255) && targets.length < maxTargets; n++) add(formatIpv4(n), network);
            for (let n = network.start; n <= network.end && targets.length < maxTargets; n++) add(formatIpv4(n), network);
        }
        network.limited = !requestedAddress && network.planned < network.totalHosts;
    }
    return { targets, networks, targeted: Boolean(requestedAddress) };
}

export function parseDiscovery(body, requestId, port) {
    const text = key => typeof body?.[key] === 'string' && body[key].length <= 160 && !/[\x00-\x1f]/.test(body[key]);
    if (body?.protocol !== 'hhh-startup-log' || body.protocolVersion !== 1 || body.requestId !== requestId || body.httpPort !== port
        || !/^[0-9a-f]{32}$/i.test(body.deviceId) || !/^[0-9a-f]{64}$/i.test(body.sessionTicket)
        || !Number.isInteger(body.expiresInSeconds) || body.expiresInSeconds < 1 || body.expiresInSeconds > 120
        || !['deviceName', 'deviceModel', 'platform', 'appId', 'appVersion'].every(text))
        throw new UnityLogError('invalid_protocol', '不是兼容的 Unity 日志设备', 502);
    return { deviceId: body.deviceId.toLowerCase(), deviceName: body.deviceName || 'Unity 设备', deviceModel: body.deviceModel,
        platform: body.platform, appId: body.appId, appVersion: body.appVersion, ticket: body.sessionTicket.toLowerCase() };
}

export async function probeLogDevice(address, port, signal, timeout = 650, readJson = readLogJson) {
    const requestId = randomUUID().replaceAll('-', '');
    const body = await readJson({ address, port, path: `/api/discovery?requestId=${requestId}`, headers: { 'X-HHH-Log-Discovery': '1' }, signal, timeout, maxBytes: 8192 });
    return { ...parseDiscovery(body, requestId, port), address, port };
}

export async function scanLogDevices({ port = 17523, address = '', signal, interfaces = networkInterfaces(), probe = probeLogDevice, maxTargets = 1024, concurrency = 64, deadline = 25000 } = {}) {
    validatePort(port);
    const plan = buildScanPlan(interfaces, maxTargets, address);
    if (!plan.targets.length) throw new UnityLogError('no_network', '未找到可搜索的局域网 IPv4，请连接 Wi-Fi 或有线局域网');
    signal?.throwIfAborted();
    const controller = new AbortController(), devices = new Map();
    const cancel = () => controller.abort();
    signal?.addEventListener('abort', cancel, { once: true });
    let timedOut = false, cursor = 0;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, deadline);
    try {
        await Promise.all(Array.from({ length: Math.min(concurrency, plan.targets.length) }, async () => {
            while (!controller.signal.aborted) {
                const target = plan.targets[cursor++]; if (!target) return;
                try {
                    const device = await probe(target.address, port, controller.signal);
                    if (!controller.signal.aborted && devices.size < 128) devices.set(device.deviceId, device);
                } catch { /* 非日志端口、离线设备或超时均计入实际扫描，不输出票据。 */ }
                finally { target.network.checked++; }
            }
        }));
        signal?.throwIfAborted();
        return { devices: [...devices.values()].sort((a, b) => a.deviceName.localeCompare(b.deviceName)), port, timedOut, targeted: plan.targeted,
            planned: plan.targets.length, checked: plan.networks.reduce((n, network) => n + network.checked, 0),
            networks: plan.networks.map(({ name, address: localAddress, cidr, totalHosts, planned, checked, limited }) => ({ name, localAddress, cidr, totalHosts, planned, checked, limited })) };
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel); }
}
