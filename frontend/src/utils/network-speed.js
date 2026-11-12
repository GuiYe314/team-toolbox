export function networkBytes(value, rate = false) {
    if (!Number.isFinite(value) || value < 0) return { value: '—', unit: '', text: '—' };
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const index = value > 0 ? Math.min(units.length - 1, Math.max(0, Math.floor(Math.log(value) / Math.log(1024)))) : 0;
    const amount = value / 1024 ** index;
    const formatted = amount.toFixed(index === 0 ? 0 : amount >= 100 ? 1 : 2);
    const unit = units[index] + (rate ? '/s' : '');
    return { value: formatted, unit, text: `${formatted} ${unit}` };
}

export function networkBits(value) {
    if (!Number.isFinite(value) || value < 0) return '—';
    const units = ['bps', 'Kbps', 'Mbps', 'Gbps', 'Tbps'];
    const index = value > 0 ? Math.min(units.length - 1, Math.max(0, Math.floor(Math.log(value) / Math.log(1000)))) : 0;
    return `${(value / 1000 ** index).toFixed(index ? 2 : 0)} ${units[index]}`;
}

/** 使用真实观察时间定位；空档分段，不能把失联期连成一条“连续采样”线。 */
export function networkTrafficDelta(previous, current) {
    if (!previous || previous.id !== current.id || previous.counterEpoch !== current.counterEpoch) return null;
    const duration = current.counterTimeMs - previous.counterTimeMs;
    if (!Number.isFinite(duration) || duration <= 0) return null;
    try {
        const download = BigInt(current.receivedBytes) - BigInt(previous.receivedBytes);
        const upload = BigInt(current.sentBytes) - BigInt(previous.sentBytes);
        if (download < 0n || upload < 0n || download > BigInt(Number.MAX_SAFE_INTEGER) || upload > BigInt(Number.MAX_SAFE_INTEGER)) return null;
        return { download: Number(download), upload: Number(upload), duration };
    } catch { return null; }
}

export function networkChart(history, now) {
    const points = history.filter(point => point.time >= now - 60000 && point.time <= now);
    const peak = Math.max(1024, ...points.flatMap(point => [point.down, point.up]));
    const ceiling = 2 ** Math.ceil(Math.log2(peak * 1.15));
    const down = [], up = [];
    for (const point of points) {
        if (!down.length || point.gap) { down.push([]); up.push([]); }
        const x = 40 + (1 - (now - point.time) / 60000) * 840;
        down.at(-1).push(`${x.toFixed(2)},${(212 - point.down / ceiling * 192).toFixed(2)}`);
        up.at(-1).push(`${x.toFixed(2)},${(212 - point.up / ceiling * 192).toFixed(2)}`);
    }
    return { down: down.map(segment => segment.join(' ')), up: up.map(segment => segment.join(' ')), ceiling, count: points.length };
}
