import { sha256 } from '@noble/hashes/sha256';
export const TRANSFER_LIMITS = Object.freeze({ file: 100 * 1024 ** 2, total: 200 * 1024 ** 2, chunk: 48 * 1024, text: 16_384 });
export const safeFileName = value => typeof value === 'string' ? value.replace(/[\\/\u0000-\u001f]/g, '_').slice(0, 180) : '接收文件';
export const digestHex = bytes => Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
export function validOffer(value) {
    return value && value.type === 'file' && /^[a-f0-9]{24}$/.test(value.id) && typeof value.name === 'string' && value.name.length > 0 && value.name.length <= 180 && Number.isSafeInteger(value.size) && value.size > 0 && value.size <= TRANSFER_LIMITS.file;
}
export async function sendPeerFile(channel, file, id, { signal, onProgress } = {}) {
    const hash = sha256.create();
    const wait = async () => {
        while (channel.bufferedAmount > 512 * 1024) { if (signal.aborted || channel.readyState !== 'open') throw new Error('传输已停止'); await new Promise(resolve => setTimeout(resolve, 12)); }
        if (signal.aborted || channel.readyState !== 'open') throw new Error('传输已停止');
    };
    for (let offset = 0; offset < file.size; offset += TRANSFER_LIMITS.chunk) {
        await wait(); const bytes = new Uint8Array(await file.slice(offset, offset + TRANSFER_LIMITS.chunk).arrayBuffer());
        await wait(); hash.update(bytes); channel.send(bytes); onProgress?.(Math.round(Math.min(file.size, offset + bytes.length) / file.size * 100));
    }
    await wait(); channel.send(JSON.stringify({ type: 'end', id, hash: digestHex(hash.digest()) }));
}
