import { AdbError } from './android-adb-protocol.js';
import { validatePackageName } from './android-apps.js';

export const APK_MANIFEST_MAX_BYTES = 16 * 1024 * 1024;
const NONE = 0xffffffff;
const invalid = () => new AdbError('invalid_manifest', '无法读取 APK 包名：AndroidManifest.xml 损坏或不是受支持的编译后清单');
const requireValid = condition => { if (!condition) throw invalid(); };

function chunkAt(data, offset, end) {
    requireValid(offset + 8 <= end && offset % 4 === 0);
    const type = data.readUInt16LE(offset), header = data.readUInt16LE(offset + 2), size = data.readUInt32LE(offset + 4);
    requireValid(header >= 8 && header % 4 === 0 && size >= header && size % 4 === 0 && size <= end - offset);
    return { type, header, size, offset, end: offset + size };
}

function stringPool(data, chunk) {
    const start = chunk.offset;
    requireValid(chunk.header >= 28);
    const count = data.readUInt32LE(start + 8), styles = data.readUInt32LE(start + 12), flags = data.readUInt32LE(start + 16);
    const stringsStart = data.readUInt32LE(start + 20), stylesStart = data.readUInt32LE(start + 24);
    requireValid(count > 0 && count <= 100000 && styles <= count && chunk.header + 4 * (count + styles) <= chunk.size);
    requireValid(stringsStart >= chunk.header + 4 * (count + styles) && stringsStart < chunk.size);
    requireValid(stylesStart === 0 ? styles === 0 : stylesStart >= stringsStart && stylesStart <= chunk.size);
    const utf8 = !!(flags & 0x100), end = start + (stylesStart || chunk.size), cache = new Map();
    let decodedBytes = 0;
    return index => {
        if (index === NONE) return null;
        requireValid(index < count);
        if (cache.has(index)) return cache.get(index);
        let cursor = start + stringsStart + data.readUInt32LE(start + chunk.header + index * 4);
        requireValid(cursor >= start + stringsStart && cursor < end);
        const length = () => {
            if (utf8) {
                requireValid(cursor < end); const first = data[cursor++];
                if (!(first & 0x80)) return first;
                requireValid(cursor < end); return ((first & 0x7f) << 8) | data[cursor++];
            }
            requireValid(cursor + 2 <= end); const first = data.readUInt16LE(cursor); cursor += 2;
            if (!(first & 0x8000)) return first;
            requireValid(cursor + 2 <= end); const second = data.readUInt16LE(cursor); cursor += 2;
            return (first & 0x7fff) * 65536 + second;
        };
        const characters = length(), bytes = utf8 ? length() : characters * 2, terminator = utf8 ? 1 : 2;
        decodedBytes += bytes;
        requireValid(decodedBytes <= APK_MANIFEST_MAX_BYTES * 2 && bytes <= end - cursor - terminator);
        requireValid(data[cursor + bytes] === 0 && (utf8 || data[cursor + bytes + 1] === 0));
        let value;
        try { value = new TextDecoder(utf8 ? 'utf-8' : 'utf-16le', { fatal: true }).decode(data.subarray(cursor, cursor + bytes)); }
        catch { throw invalid(); }
        requireValid(value.length === characters);
        cache.set(index, value); return value;
    };
}

/** Android ResXMLTree；只读取根 manifest 的无命名空间 package 属性，不解析资源引用。 */
export function parseApkPackageName(data) {
    requireValid(Buffer.isBuffer(data) && data.length >= 8 && data.length <= APK_MANIFEST_MAX_BYTES);
    const container = chunkAt(data, 0, data.length);
    requireValid(container.type === 3 && container.header === 8 && container.size === data.length);
    let strings, packageName, rootSeen = false, nodes = 0;
    const stack = [];
    for (let offset = container.header; offset < container.end;) {
        requireValid(++nodes <= 100000);
        const chunk = chunkAt(data, offset, container.end), ext = offset + chunk.header;
        if (chunk.type === 1) {
            requireValid(!strings && !rootSeen); strings = stringPool(data, chunk);
        } else if (chunk.type === 0x180) {
            requireValid(strings && !rootSeen && chunk.header === 8);
        } else {
            requireValid(strings && chunk.header === 16);
            if (chunk.type === 0x102) {
                requireValid(ext + 20 <= chunk.end && stack.length < 256);
                const namespace = strings(data.readUInt32LE(ext)), name = strings(data.readUInt32LE(ext + 4));
                const start = data.readUInt16LE(ext + 8), stride = data.readUInt16LE(ext + 10), count = data.readUInt16LE(ext + 12);
                requireValid(name && start >= 20 && stride >= 20 && ext + start + stride * count <= chunk.end);
                if (stack.length === 0) {
                    requireValid(!rootSeen && namespace === null && name === 'manifest'); rootSeen = true;
                    for (let i = 0; i < count; i++) {
                        const attr = ext + start + i * stride;
                        if (strings(data.readUInt32LE(attr)) !== null || strings(data.readUInt32LE(attr + 4)) !== 'package') continue;
                        requireValid(packageName === undefined && data.readUInt16LE(attr + 12) === 8 && data[attr + 14] === 0);
                        if (data[attr + 15] !== 3) throw new AdbError('unsupported_manifest', 'APK 包名使用了资源引用或非字符串值，无法直接读取');
                        const typed = strings(data.readUInt32LE(attr + 16)), raw = strings(data.readUInt32LE(attr + 8));
                        requireValid(typed !== null && (raw === null || raw === typed));
                        try { packageName = validatePackageName(typed); } catch { throw invalid(); }
                    }
                    requireValid(packageName !== undefined);
                }
                stack.push({ namespace, name });
            } else if (chunk.type === 0x103) {
                requireValid(ext + 8 <= chunk.end && stack.length);
                const element = stack.pop();
                requireValid(strings(data.readUInt32LE(ext)) === element.namespace && strings(data.readUInt32LE(ext + 4)) === element.name);
            } else if (chunk.type === 0x100 || chunk.type === 0x101) {
                requireValid(ext + 8 <= chunk.end);
                strings(data.readUInt32LE(ext)); strings(data.readUInt32LE(ext + 4));
            } else if (chunk.type === 0x104) {
                requireValid(stack.length && ext + 12 <= chunk.end);
            } else throw invalid();
        }
        offset = chunk.end;
    }
    requireValid(rootSeen && stack.length === 0 && packageName !== undefined);
    return packageName;
}
