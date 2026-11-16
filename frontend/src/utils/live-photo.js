// 配对必须由用户主动开启；只接受无歧义的同名照片与MOV/MP4，不按相近时间猜测。
const PHOTO = /\.(jpe?g|heic|heif)$/i, VIDEO = /\.(mov|mp4|m4v)$/i;
const stem = name => name.replace(/\.[^.]+$/, '').normalize('NFC').toLowerCase();
export function pairLiveFiles(files, enabled) {
    if (!enabled) return files.map(file => ({ file }));
    const groups = new Map();
    for (const file of files) { const key = stem(file.name); if (!groups.has(key)) groups.set(key, []); groups.get(key).push(file); }
    const used = new Set(), items = [];
    for (const file of files) {
        if (used.has(file)) continue;
        const group = groups.get(stem(file.name)), photos = group.filter(f => PHOTO.test(f.name)), videos = group.filter(f => VIDEO.test(f.name));
        if (photos.length === 1 && videos.length === 1) {
            const parts = [photos[0], videos[0]]; parts.forEach(value => used.add(value));
            items.push({ parts, name: photos[0].name.replace(/\.[^.]+$/, '') + '.livp' });
        } else { used.add(file); items.push({ file }); }
    }
    return items;
}
const table = Array.from({ length: 256 }, (_, n) => { for (let i = 0; i < 8; i++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1; return n >>> 0; });
async function checksum(file, signal) {
    const reader = file.stream().getReader(); let crc = 0xffffffff;
    const abort = () => reader.cancel(); signal?.addEventListener('abort', abort, { once: true });
    try {
        while (true) {
            signal?.throwIfAborted();
            const { value, done } = await reader.read();
            signal?.throwIfAborted(); if (done) break;
            for (const byte of value) crc = table[(crc ^ byte) & 255] ^ (crc >>> 8);
        }
        return (crc ^ 0xffffffff) >>> 0;
    } finally { signal?.removeEventListener('abort', abort); reader.releaseLock(); }
}
function block(size) { const bytes = new Uint8Array(size), view = new DataView(bytes.buffer); return { bytes, u16: (at, v) => view.setUint16(at, v, true), u32: (at, v) => view.setUint32(at, v >>> 0, true) }; }
export async function packLivePhoto(parts, name, signal) {
    if (parts.length !== 2 || !PHOTO.test(parts[0].name) || !VIDEO.test(parts[1].name)) throw new Error('实况照片需要原照片和MOV/MP4各一份');
    if (parts.some(file => !file.size || file.size > 256 * 1024 ** 2)) throw new Error('实况照片的每个原片不能超过256 MiB');
    const chunks = [], central = []; let offset = 0, centralSize = 0;
    for (const file of parts) {
        signal?.throwIfAborted();
        const ext = /\.[^.]+$/.exec(file.name)[0].toLowerCase(), filename = new TextEncoder().encode((PHOTO.test(file.name) ? 'photo' : 'motion') + ext);
        const crc = await checksum(file, signal), header = block(30 + filename.length);
        header.u32(0, 0x04034b50); header.u16(4, 20); header.u16(6, 0x800); header.u16(12, 33); header.u32(14, crc); header.u32(18, file.size); header.u32(22, file.size); header.u16(26, filename.length); header.bytes.set(filename, 30);
        chunks.push(header.bytes, file);
        const directory = block(46 + filename.length);
        directory.u32(0, 0x02014b50); directory.u16(4, 20); directory.u16(6, 20); directory.u16(8, 0x800); directory.u16(14, 33); directory.u32(16, crc); directory.u32(20, file.size); directory.u32(24, file.size); directory.u16(28, filename.length); directory.u32(42, offset); directory.bytes.set(filename, 46);
        central.push(directory.bytes); centralSize += directory.bytes.length; offset += header.bytes.length + file.size;
    }
    const end = block(22); end.u32(0, 0x06054b50); end.u16(8, 2); end.u16(10, 2); end.u32(12, centralSize); end.u32(16, offset);
    signal?.throwIfAborted();
    // Blob引用原文件，视频始终按块计算CRC，没有整文件ArrayBuffer或base64。
    return new File([...chunks, ...central, end.bytes], name, { type: 'application/zip', lastModified: Math.max(...parts.map(f => f.lastModified || 0)) });
}
