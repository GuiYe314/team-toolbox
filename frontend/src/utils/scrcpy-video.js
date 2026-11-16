export function createScrcpyParser() {
    let buffered = new Uint8Array(0), codecRead = false;
    return {
        push(chunk) {
            if (!(chunk instanceof Uint8Array) || chunk.length > 16 * 1024 ** 2 || buffered.length + chunk.length > 16 * 1024 ** 2) throw new Error('投屏数据超过缓冲限制');
            const joined = new Uint8Array(buffered.length + chunk.length); joined.set(buffered); joined.set(chunk, buffered.length); buffered = joined;
            const events = []; let offset = 0;
            if (!codecRead) { if (buffered.length < 4) return events; if (new DataView(buffered.buffer, buffered.byteOffset).getUint32(0) !== 0x68323634) throw new Error('手机未返回 H.264 视频'); codecRead = true; offset = 4; }
            while (buffered.length - offset >= 12) {
                const view = new DataView(buffered.buffer, buffered.byteOffset + offset), flags = view.getUint32(0);
                if (flags & 0x80000000) {
                    const width = view.getUint32(4), height = view.getUint32(8);
                    if (!width || !height || width > 4096 || height > 4096 || width * height > 8 * 1024 ** 2) throw new Error('投屏画面尺寸超出限制');
                    events.push({ type: 'size', width, height }); offset += 12;
                } else {
                    const length = view.getUint32(8); if (!length || length > 8 * 1024 ** 2) throw new Error('投屏视频帧大小无效');
                    if (buffered.length - offset - 12 < length) break;
                    const timestamp = Number(view.getBigUint64(0) & 0x1fffffffffffffffn); if (!Number.isSafeInteger(timestamp)) throw new Error('视频时间戳无效');
                    events.push({ type: flags & 0x40000000 ? 'config' : 'frame', key: !!(flags & 0x20000000), timestamp, data: buffered.slice(offset + 12, offset + 12 + length) }); offset += 12 + length;
                }
            }
            buffered = buffered.slice(offset); return events;
        },
        finish() { if (buffered.length) throw new Error('投屏数据中途截断，请重新启动'); }
    };
}
export function avcCodec(config) {
    for (let offset = 0; offset + 7 < config.length; offset++) {
        let start = -1;
        if (config[offset] === 0 && config[offset + 1] === 0 && config[offset + 2] === 1) start = offset + 3;
        if (config[offset] === 0 && config[offset + 1] === 0 && config[offset + 2] === 0 && config[offset + 3] === 1) start = offset + 4;
        if (start >= 0 && (config[start] & 31) === 7 && start + 3 < config.length) return 'avc1.' + Array.from(config.slice(start + 1, start + 4), value => value.toString(16).padStart(2, '0')).join('');
    }
    throw new Error('手机视频缺少 H.264 编码配置');
}
