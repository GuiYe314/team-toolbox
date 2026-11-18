// 仅本机临时协议服务器；运行时生成SSH密钥，文件只存在内存。
import net from 'node:net';
import tls from 'node:tls';
import { generateKeyPairSync, createHash } from 'node:crypto';
import { posix } from 'node:path';
import ssh2 from 'ssh2';
const key = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs1', format: 'pem' });
export const fixtureFingerprint = 'SHA256:' + createHash('sha256').update(ssh2.utils.parseKey(key).getPublicSSH()).digest('base64').replace(/=+$/, '');
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
const norm = path => posix.resolve('/', path);
function memory() {
    const files = new Map([['/', { directory: true }], ['/资料', { directory: true }], ['/原件.txt', { bytes: Buffer.from('remote original 中文') }], ['/资料/child.bin', { bytes: Buffer.from([0, 1, 254, 255]) }]]);
    const attrs = file => ({ mode: file.directory ? 0o40755 : 0o100644, uid: 1000, gid: 1000, size: file.bytes?.length || 0, atime: 1700000000, mtime: file.mtime || 1700000000 });
    const list = path => [...files.entries()].filter(([p]) => p !== path && posix.dirname(p) === path).map(([path, file]) => ({ path, file, name: posix.basename(path) }));
    return { files, attrs, list };
}
export async function sftpFixture({ readDelayMs = 0, writeDelayMs = 0, denyCleanup = false, posixRename = true } = {}) {
    const { files, attrs, list } = memory(), clients = new Set(), timers = new Set(); let authAttempts = 0;
    const server = new ssh2.Server({ hostKeys: [key] }, client => {
        clients.add(client); client.on('error', () => {}); client.once('close', () => clients.delete(client));
        client.on('authentication', ctx => { if (ctx.method === 'password') authAttempts++; ctx.method === 'password' && ctx.username === 'tester' && ctx.password === 'fixture-secret' ? ctx.accept() : ctx.reject(['password']); });
        client.on('ready', () => client.on('session', accept => accept().on('sftp', accept => {
            const sftp = accept(), handles = new Map(); let counter = 0;
            if (posixRename) {
                // ssh2测试服务器默认不公布扩展；仅在本连接的VERSION包追加标准OpenSSH扩展。
                const channelData = sftp._protocol.channelData;
                sftp._protocol.channelData = function (id, payload) {
                    if (id === sftp.outgoing.id && payload.length === 9 && payload[4] === 2) {
                        const name = Buffer.from('posix-rename@openssh.com'), value = Buffer.from('1'), packet = Buffer.alloc(9 + 8 + name.length + value.length);
                        payload.copy(packet); packet.writeUInt32BE(packet.length - 4); packet.writeUInt32BE(name.length, 9); name.copy(packet, 13); packet.writeUInt32BE(value.length, 13 + name.length); value.copy(packet, 17 + name.length); payload = packet;
                    }
                    return channelData.call(this, id, payload);
                };
            }
            sftp.on('error', () => {});
            const fail = (id, code = 4) => { if (!sftp.destroyed) sftp.status(id, code); };
            const ok = id => fail(id, 0);
            const handle = (id, value) => { const b = Buffer.alloc(4); b.writeUInt32BE(++counter); handles.set(b.toString('hex'), value); sftp.handle(id, b); };
            const later = (ms, fn) => { if (!ms) return fn(); const t = setTimeout(() => { timers.delete(t); if (!sftp.destroyed) fn(); }, ms); timers.add(t); };
            sftp.on('REALPATH', (id, path) => sftp.name(id, [{ filename: path === '.' ? '/' : norm(path), longname: '/', attrs: attrs(files.get('/')) }]));
            const stat = (id, path) => files.has(norm(path)) ? sftp.attrs(id, attrs(files.get(norm(path)))) : fail(id, 2);
            sftp.on('STAT', stat); sftp.on('LSTAT', stat);
            sftp.on('OPENDIR', (id, path) => files.get(norm(path))?.directory ? handle(id, { directory: norm(path), read: false }) : fail(id, 2));
            sftp.on('READDIR', (id, h) => { const value = handles.get(h.toString('hex')); if (!value) return fail(id); if (value.read) return fail(id, 1); value.read = true; const items = list(value.directory); if (!items.length) return fail(id, 1); sftp.name(id, items.map(({ name, file }) => ({ filename: name, longname: name, attrs: attrs(file) }))); });
            sftp.on('CLOSE', (id, h) => { handles.delete(h.toString('hex')); ok(id); });
            sftp.on('OPEN', (id, path, flags) => { path = norm(path); const existing = files.get(path); if (flags & 2) { if (existing && flags & 32) return fail(id); if (!files.get(posix.dirname(path))?.directory) return fail(id, 2); if (!existing || flags & 16) files.set(path, { bytes: Buffer.alloc(0) }); }
                if (!files.has(path) || files.get(path).directory) return fail(id, 2); handle(id, { path }); });
            sftp.on('FSTAT', (id, h) => { const v = handles.get(h.toString('hex')); v && files.has(v.path) ? sftp.attrs(id, attrs(files.get(v.path))) : fail(id); });
            sftp.on('READ', (id, h, offset, length) => later(readDelayMs, () => { const file = files.get(handles.get(h.toString('hex'))?.path); if (!file || offset >= file.bytes.length) return fail(id, 1); sftp.data(id, file.bytes.subarray(offset, offset + Math.min(length, 32768))); }));
            sftp.on('WRITE', (id, h, offset, data) => later(writeDelayMs, () => { const file = files.get(handles.get(h.toString('hex'))?.path); if (!file) return fail(id); const bytes = Buffer.alloc(Math.max(file.bytes.length, offset + data.length)); file.bytes.copy(bytes); data.copy(bytes, offset); file.bytes = bytes; ok(id); }));
            sftp.on('MKDIR', (id, path) => { path = norm(path); if (files.has(path) || !files.get(posix.dirname(path))?.directory) return fail(id); files.set(path, { directory: true }); ok(id); });
            sftp.on('RMDIR', (id, path) => { path = norm(path); if (!files.get(path)?.directory || list(path).length) return fail(id); files.delete(path); ok(id); });
            sftp.on('REMOVE', (id, path) => { path = norm(path); if (denyCleanup || !files.has(path) || files.get(path).directory) return fail(id, 3); files.delete(path); ok(id); });
            const move = (id, from, to, replace = false) => { from = norm(from); to = norm(to); if (!files.has(from)) return fail(id, 2); if (!replace && files.has(to)) return fail(id); const moving = [...files.entries()].filter(([path]) => path === from || path.startsWith(from + '/')); for (const [path] of moving) files.delete(path); for (const [path, file] of moving) files.set(to + path.slice(from.length), file); ok(id); };
            sftp.on('RENAME', (id, from, to) => move(id, from, to));
            sftp.on('EXTENDED', (id, name, bytes) => { if (!posixRename || name !== 'posix-rename@openssh.com') return fail(id, 8); const n = bytes.readUInt32BE(0), m = bytes.readUInt32BE(4 + n); move(id, bytes.toString('utf8', 4, 4 + n), bytes.toString('utf8', 8 + n, 8 + n + m), true); });
            sftp.on('SETSTAT', id => ok(id)); sftp.on('FSETSTAT', id => ok(id));
        })));
    });
    const port = await listen(server);
    return { files, port, get clients() { return clients.size; }, get authAttempts() { return authAttempts; }, async close() { for (const t of timers) clearTimeout(t); for (const c of clients) c.end(); await new Promise(done => server.close(done)); } };
}
export async function ftpFixture({ key, cert } = {}) {
    const { files, list } = memory(), sockets = new Set(), dataServers = new Set();
    const track = socket => { sockets.add(socket); socket.on('error', () => {}); socket.once('close', () => sockets.delete(socket)); return socket; };
    const server = net.createServer(raw => {
        let socket = track(raw), buffer = '', loggedIn = false, dataServer, dataPromise, renameFrom, protectedData = false;
        const send = line => socket.write(line + '\r\n');
        const passive = async () => {
            if (dataServer) dataServer.close();
            dataPromise = new Promise(resolve => { dataServer = protectedData ? tls.createServer({ key, cert }, s => resolve(track(s))) : net.createServer(s => resolve(track(s))); });
            dataServer.on('connection', track); dataServer.on('tlsClientError', () => {}); dataServers.add(dataServer); dataServer.once('close', () => dataServers.delete(dataServer));
            const port = await listen(dataServer); send('229 Entering Extended Passive Mode (|||' + port + '|)');
        };
        async function command(line) {
            const space = line.indexOf(' '), cmd = (space < 0 ? line : line.slice(0, space)).toUpperCase(), arg = space < 0 ? '' : line.slice(space + 1), path = norm(arg);
            if (cmd === 'AUTH' && arg === 'TLS' && cert) { send('234 TLS ready'); socket.removeListener('data', receive); socket = track(new tls.TLSSocket(socket, { isServer: true, secureContext: tls.createSecureContext({ key, cert }) })); socket.on('data', receive); return; }
            if (cmd === 'USER') { send('331 Password required'); return; }
            if (cmd === 'PASS') { loggedIn = arg === 'fixture-secret'; send(loggedIn ? '230 Logged in' : '530 Denied'); return; }
            if (['OPTS', 'TYPE', 'STRU', 'PBSZ', 'PROT'].includes(cmd)) { if (cmd === 'PROT') protectedData = arg === 'P'; send('200 OK'); return; }
            if (cmd === 'FEAT') { send('211-Features\r\n UTF8\r\n MLST type*;size*;modify*;\r\n EPSV\r\n211 End'); return; }
            if (cmd === 'QUIT') { send('221 Bye'); socket.end(); return; }
            if (!loggedIn) { send('530 Login first'); return; }
            if (cmd === 'PWD') { send('257 "/"'); return; }
            if (cmd === 'EPSV') return passive();
            if (cmd === 'MKD') { if (files.has(path) || !files.get(posix.dirname(path))?.directory) return send('550 Denied'); files.set(path, { directory: true }); send('257 Created'); return; }
            if (cmd === 'DELE' || cmd === 'RMD') { if (!files.has(path) || cmd === 'RMD' && list(path).length) return send('550 Denied'); files.delete(path); send('250 Deleted'); return; }
            if (cmd === 'RNFR') { renameFrom = path; send(files.has(path) ? '350 Continue' : '550 Missing'); return; }
            if (cmd === 'RNTO') { if (!files.has(renameFrom)) return send('550 Missing'); files.set(path, files.get(renameFrom)); files.delete(renameFrom); send('250 Renamed'); return; }
            if (['MLSD', 'LIST', 'RETR', 'STOR'].includes(cmd)) {
                if (!dataPromise || cmd === 'RETR' && !files.get(path)?.bytes || ['MLSD', 'LIST'].includes(cmd) && !files.get(path)?.directory) return send('550 Missing');
                send('150 Transfer starting'); const data = await dataPromise; dataServer.close(); dataPromise = null;
                if (cmd === 'STOR') { const chunks = []; data.on('data', b => chunks.push(b)); data.once('end', () => { files.set(path, { bytes: Buffer.concat(chunks) }); data.end(); send('226 Complete'); }); }
                else { const body = cmd === 'RETR' ? files.get(path).bytes : Buffer.from(list(path).map(({ name, file }) => `type=${file.directory ? 'dir' : 'file'};size=${file.bytes?.length || 0};modify=20231114221320; ${name}\r\n`).join('')); data.end(body, () => send('226 Complete')); }
                return;
            }
            send('502 Unsupported');
        }
        function receive(bytes) { buffer += bytes.toString('utf8'); for (;;) { const end = buffer.indexOf('\r\n'); if (end < 0) break; const line = buffer.slice(0, end); buffer = buffer.slice(end + 2); command(line).catch(() => socket.destroy()); } }
        socket.on('data', receive); send('220 Local protocol fixture');
    });
    const port = await listen(server);
    return { files, port, async close() { for (const s of sockets) s.destroy(); for (const s of dataServers) s.close(); await new Promise(done => server.close(done)); } };
}
