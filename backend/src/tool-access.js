import { networkInterfaces } from 'node:os';
import { isIP } from 'node:net';

function ipv4(value) {
    if (typeof value !== 'string') return null;
    const address = value.replace(/^::ffff:/i, '');
    if (isIP(address) !== 4) return null;
    return address.split('.').reduce((result, part) => (result * 256 + Number(part)) >>> 0, 0);
}

function privateIp(value) {
    return value !== null && (value >>> 24 === 10 || value >>> 20 === 0xac1 || value >>> 16 === 0xc0a8);
}

function loopback(value) {
    return ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(value?.toLowerCase());
}

const localHost = value => ['localhost', '127.0.0.1', '[::1]'].includes(value);

function parseHost(value, protocol = 'http:') {
    if (typeof value !== 'string' || !value || /[\s/@?#\\]/.test(value)) return null;
    try {
        const url = new URL(`${protocol}//${value}`);
        // URL 会把 127.1、十六进制 IP 等别名规范化；Host 必须使用明确地址。
        const suffix = protocol === 'https:' ? ':443' : ':80';
        const canonical = value.toLowerCase().endsWith(suffix) ? value.toLowerCase().slice(0, -suffix.length) : value.toLowerCase();
        if (url.host !== canonical) return null;
        return url;
    } catch { return null; }
}

/** 只使用 TCP 来源和实际网卡；不读取 X-Forwarded-*，可供 Vite 代理前复用。 */
export function createToolAccess({ allowLan = process.env.TOOLBOX_ALLOW_LAN === '1', interfaces = networkInterfaces } = {}) {
    function networks() {
        return Object.values(interfaces()).flat().flatMap(item => {
            if (item.internal || !['IPv4', 4].includes(item.family)) return [];
            const address = ipv4(item.address), mask = ipv4(item.netmask);
            const inverse = mask === null ? null : (~mask >>> 0);
            if (!privateIp(address) || !mask || (inverse & (inverse + 1)) !== 0) return [];
            return [{ address: item.address, value: address, mask }];
        });
    }

    function allows(req, { browser = false } = {}) {
        const header = name => req.get ? req.get(name) : req.headers?.[name];
        const remote = req.socket?.remoteAddress;
        const local = loopback(remote), host = parseHost(req.headers?.host);
        if (!host) return false;
        const available = allowLan ? networks() : [];
        const peer = ipv4(remote);
        if (!local && (!allowLan || !privateIp(peer) || !available.some(item => (peer & item.mask) === (item.value & item.mask)))) return false;
        if (!localHost(host.hostname) && (!allowLan || !available.some(item => item.address === host.hostname))) return false;
        // 远程请求必须使用服务器的私网 IP，不能伪装成 localhost。
        if (!local && localHost(host.hostname)) return false;
        if (!browser) return true;
        const site = header('sec-fetch-site');
        if (site && !['same-origin', 'none'].includes(site)) return false;
        const origin = header('origin');
        if (!origin) return true; // 原生/脚本客户端仍需各模块专用头与确认。
        try {
            const parsed = new URL(origin);
            if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== origin) return false;
            if (local && localHost(host.hostname) && localHost(parsed.hostname)) return true;
            const expected = parseHost(req.headers.host, req.socket.encrypted ? 'https:' : 'http:');
            return parsed.origin === expected?.origin;
        } catch { return false; }
    }

    function deny(res) {
        const body = { error: allowLan ? 'access_denied' : 'local_only', message: allowLan
            ? '请通过工具箱电脑的局域网 IP 从同一网段访问，并在同源工具箱页面执行操作'
            : '当前为仅本机模式，请通过 localhost 或 127.0.0.1 访问；局域网使用需以 Lan 模式重启工具箱' };
        res.statusCode = 403;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.end(JSON.stringify(body));
    }

    function middleware(req, res, next) {
        const api = /^\/api(?:\/|\?|$)/.test(req.url || '');
        if (!allows(req, { browser: api })) return deny(res);
        next();
    }

    return { allowLan, allows, deny, middleware, addresses: () => allowLan ? [...new Set(networks().map(item => item.address))] : [] };
}
