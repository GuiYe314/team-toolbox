import { createReadStream } from 'node:fs';

export function videoRange(header, size) {
    if (!header) return null;
    const m = /^bytes=(\d*)-(\d*)$/.exec(header);
    if (!m || (!m[1] && !m[2])) return false;
    let start, end;
    if (!m[1]) { const suffix = Number(m[2]); if (!Number.isSafeInteger(suffix) || suffix <= 0) return false; start = Math.max(0, size - suffix); end = size - 1; }
    else { start = Number(m[1]); end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1; }
    return Number.isSafeInteger(start) && Number.isSafeInteger(end) && start >= 0 && start < size && end >= start ? { start, end } : false;
}
export function sendLiveVideo(req, res, path, size, name) {
    res.set({ 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
    const range = videoRange(req.get('range'), size);
    if (range === false) { res.set('Content-Range', `bytes */${size}`); return res.sendStatus(416); }
    const start = range?.start ?? 0, end = range?.end ?? size - 1;
    if (range) res.status(206).set('Content-Range', `bytes ${start}-${end}/${size}`);
    res.set('Content-Length', String(end - start + 1));
    if (req.query.download === '1') res.set('Content-Disposition', `attachment; filename="live-photo.mp4"; filename*=UTF-8''${encodeURIComponent(name.replace(/\.[^.]+$/, '') + '-实况.mp4')}`);
    const stream = createReadStream(path, { start, end });
    stream.on('error', () => res.destroy()); res.once('close', () => stream.destroy()); stream.pipe(res);
}
