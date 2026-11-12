// 合成编译清单与ZIP，只用于协议/浏览器验收，不是可安装应用。
import { deflateRawSync, crc32 } from 'node:zlib';

const align = size => (size + 3) & ~3;
function chunk(type, header, tail) {
    const result = Buffer.alloc(align(8 + header.length + tail.length));
    result.writeUInt16LE(type); result.writeUInt16LE(8 + header.length, 2); result.writeUInt32LE(result.length, 4);
    header.copy(result, 8); tail.copy(result, 8 + header.length); return result;
}
function length8(value) { return value > 127 ? Buffer.from([(value >> 8) | 0x80, value & 255]) : Buffer.from([value]); }
function length16(value) { const bytes = Buffer.alloc(value > 32767 ? 4 : 2); if (bytes.length === 4) { bytes.writeUInt16LE((value >>> 16) | 0x8000); bytes.writeUInt16LE(value & 65535, 2); } else bytes.writeUInt16LE(value); return bytes; }
export function binaryManifest({ packageName = 'com.example.unity', utf8 = true, raw = true, namespace = 'http://schemas.android.com/apk/res/android', duplicate = false, packageType = 3 } = {}) {
    const strings = ['manifest', 'package', packageName, 'application', namespace, 'android'];
    const encoded = strings.map(text => utf8 ? Buffer.concat([length8(text.length), length8(Buffer.byteLength(text)), Buffer.from(text), Buffer.from([0])])
        : Buffer.concat([length16(text.length), Buffer.from(text, 'utf16le'), Buffer.alloc(2)]));
    const poolHead = Buffer.alloc(20), offsets = Buffer.alloc(strings.length * 4); let total = 0;
    encoded.forEach((bytes, i) => { offsets.writeUInt32LE(total, i * 4); total += bytes.length; });
    poolHead.writeUInt32LE(strings.length); poolHead.writeUInt32LE(utf8 ? 0x100 : 0, 8); poolHead.writeUInt32LE(28 + offsets.length, 12);
    const pool = chunk(1, poolHead, Buffer.concat([offsets, ...encoded]));
    const node = (type, extension) => { const head = Buffer.alloc(8); head.writeUInt32LE(1); head.writeUInt32LE(0xffffffff, 4); return chunk(type, head, extension); };
    const namespaceExt = Buffer.alloc(8); namespaceExt.writeUInt32LE(5); namespaceExt.writeUInt32LE(4, 4);
    const start = (name, attributes) => {
        const ext = Buffer.alloc(20 + attributes * 20); ext.writeUInt32LE(0xffffffff); ext.writeUInt32LE(name, 4); ext.writeUInt16LE(20, 8); ext.writeUInt16LE(20, 10); ext.writeUInt16LE(attributes, 12);
        for (let i = 0; i < attributes; i++) { const a = 20 + i * 20; ext.writeUInt32LE(0xffffffff, a); ext.writeUInt32LE(1, a + 4); ext.writeUInt32LE(raw ? 2 : 0xffffffff, a + 8); ext.writeUInt16LE(8, a + 12); ext[a + 15] = packageType; ext.writeUInt32LE(2, a + 16); }
        return node(0x102, ext);
    };
    const end = name => { const ext = Buffer.alloc(8); ext.writeUInt32LE(0xffffffff); ext.writeUInt32LE(name, 4); return node(0x103, ext); };
    return chunk(3, Buffer.alloc(0), Buffer.concat([pool, node(0x100, namespaceExt), start(0, duplicate ? 2 : 1), start(3, 0), end(3), end(0), node(0x101, namespaceExt)]));
}

export function zipFixture(entries, { compressed = true } = {}) {
    const local = [], central = []; let offset = 0;
    for (const [name, input] of entries) {
        const data = Buffer.from(input), encoded = Buffer.from(name), packed = compressed ? deflateRawSync(data) : data, checksum = crc32(data);
        const head = Buffer.alloc(30); head.writeUInt32LE(0x04034b50); head.writeUInt16LE(20, 4); head.writeUInt16LE(0x800, 6); head.writeUInt16LE(compressed ? 8 : 0, 8); head.writeUInt32LE(checksum, 14); head.writeUInt32LE(packed.length, 18); head.writeUInt32LE(data.length, 22); head.writeUInt16LE(encoded.length, 26);
        const index = Buffer.alloc(46); index.writeUInt32LE(0x02014b50); index.writeUInt16LE(20, 4); index.writeUInt16LE(20, 6); index.writeUInt16LE(0x800, 8); index.writeUInt16LE(compressed ? 8 : 0, 10); index.writeUInt32LE(checksum, 16); index.writeUInt32LE(packed.length, 20); index.writeUInt32LE(data.length, 24); index.writeUInt16LE(encoded.length, 28); index.writeUInt32LE(offset, 42);
        local.push(head, encoded, packed); central.push(index, encoded); offset += head.length + encoded.length + packed.length;
    }
    const directory = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
    return Buffer.concat([...local, directory, end]);
}
export const apkFixture = options => zipFixture([['AndroidManifest.xml', binaryManifest(options)], ['classes.dex', Buffer.from('synthetic dex')]]);
