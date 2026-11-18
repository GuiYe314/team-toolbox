export function shareLink(origin, share) {
    const url = new URL('/file-share', origin);
    url.hash = new URLSearchParams({ id: share.id, token: share.token }).toString(); return url.href;
}
export function readShareLink(hash) {
    const values = new URLSearchParams(hash.replace(/^#/, '')), id = values.get('id'), token = values.get('token');
    return /^[a-f0-9]{32}$/.test(id || '') && /^[a-f0-9]{48}$/.test(token || '') ? { id, token } : null;
}
export function fileShareSize(bytes) {
    if (!Number.isFinite(bytes) || bytes < 0) return '—';
    for (const [unit, amount] of [['GiB', 1024 ** 3], ['MiB', 1024 ** 2], ['KiB', 1024]]) if (bytes >= amount) return `${(bytes / amount).toFixed(1)} ${unit}`;
    return `${bytes} B`;
}
export function uploadRequestId() { return Array.from(crypto.getRandomValues(new Uint8Array(16)), value => value.toString(16).padStart(2, '0')).join(''); }
