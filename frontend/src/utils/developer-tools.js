const encoder = new TextEncoder(), decoder = new TextDecoder('utf-8', { fatal: true });
export const DEV_TOOLS = [
    ['json', 'JSON 格式化'], ['base64', 'Base64'], ['url', 'URL 编解码'], ['timestamp', '时间戳'], ['uuid', 'UUID'], ['hash', 'SHA-256'], ['regex', '正则测试'], ['color', '颜色转换'], ['qrcode', '二维码'], ['diff', '文本对比']
].map(([id, name]) => ({ id, name }));
export function utf8Base64(text, decode = false) {
    if (decode) {
        const normalized = text.replace(/\s/g, '');
        if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(normalized)) throw new Error('Base64 格式无效');
        return decoder.decode(Uint8Array.from(atob(normalized), character => character.charCodeAt(0)));
    }
    const bytes = encoder.encode(text); let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
    return btoa(binary);
}
export function timestampConvert(text, toTimestamp = false) {
    const value = text.trim();
    if (toTimestamp) {
        if (!value || Number.isNaN(Date.parse(value))) throw new Error('请输入有效日期，例如 2026-11-16T12:00:00+08:00');
        const ms = Date.parse(value); return `秒：${Math.floor(ms / 1000)}\n毫秒：${ms}\nUTC：${new Date(ms).toISOString()}`;
    }
    if (!/^-?\d{1,15}$/.test(value)) throw new Error('请输入秒或毫秒整数时间戳');
    const ms = Math.abs(Number(value)) < 100_000_000_000 ? Number(value) * 1000 : Number(value);
    const date = new Date(ms); if (Number.isNaN(date.valueOf())) throw new Error('时间戳超出范围');
    return `本地：${date.toLocaleString()}\nUTC：${date.toISOString()}\n毫秒：${ms}`;
}
export function convertColor(text) {
    const input = text.trim(); let channels;
    const hex = /^#?([\da-f]{3}|[\da-f]{6})$/i.exec(input), rgb = /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/i.exec(input);
    if (hex) { const h = hex[1].length === 3 ? [...hex[1]].map(c => c + c).join('') : hex[1]; channels = [0, 2, 4].map(offset => parseInt(h.slice(offset, offset + 2), 16)); }
    else if (rgb && rgb.slice(1).every(value => Number(value) <= 255)) channels = rgb.slice(1).map(Number);
    else throw new Error('请输入 #RGB、#RRGGBB 或 rgb(0, 0, 0)');
    const [r, g, b] = channels.map(value => value / 255), max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min, l = (max + min) / 2;
    let h = 0; if (delta) h = (max === r ? (g - b) / delta + (g < b ? 6 : 0) : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4) * 60;
    const s = delta ? delta / (1 - Math.abs(2 * l - 1)) : 0;
    return `HEX：#${channels.map(value => value.toString(16).padStart(2, '0')).join('').toUpperCase()}\nRGB：rgb(${channels.join(', ')})\nHSL：hsl(${Math.round(h)}, ${Math.round(s * 100)}%, ${Math.round(l * 100)}%)`;
}
export function normalizeRegexFlags(flags) {
    if (typeof flags !== 'string' || !/^[gimsu]*$/.test(flags) || new Set(flags).size !== flags.length) throw new Error('标志仅支持 g、i、m、s、u 且不能重复');
    return flags.includes('g') ? flags : flags + 'g';
}
