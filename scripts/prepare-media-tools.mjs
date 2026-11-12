// 显式维护命令；网页及服务启动不调用，不接受远程用户指定的地址。
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, writeFile, lstat, realpath, rm, rename, copyFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { createGunzip } from 'node:zlib';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const bundlePath = root => join(root, 'vendor', 'media', 'win32-x64');
const hashPattern = /^[a-f0-9]{64}$/;
const allowedFiles = new Set(['yt-dlp.exe', 'ffmpeg.exe', 'ffprobe.exe', 'yt-dlp-LICENSE.txt', 'yt-dlp-THIRD-PARTY-LICENSES.txt', 'FFmpeg-LICENSE.txt', 'FFmpeg-README.txt']);
const samePath = (a, b) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;

export function validateMediaLock(lock) {
    if (lock?.version !== 1 || lock.platform !== 'win32-x64' || !Array.isArray(lock.assets) || lock.assets.length !== allowedFiles.size) throw new Error('视频组件锁文件无效');
    const seen = new Set();
    for (const asset of lock.assets) {
        const url = new URL(asset.url);
        const official = url.origin === 'https://github.com' && /^\/(yt-dlp\/yt-dlp|eugeneware\/ffmpeg-static)\/releases\/download\/[^/]+\//.test(url.pathname)
            || url.origin === 'https://raw.githubusercontent.com' && /^\/yt-dlp\/yt-dlp\/[^/]+\/(LICENSE|THIRD_PARTY_LICENSES.txt)$/.test(url.pathname);
        if (!allowedFiles.has(asset.file) || seen.has(asset.file) || !official || url.username || url.password || url.search || url.hash
            || !Number.isSafeInteger(asset.size) || asset.size <= 0 || asset.size > 100 * 1024 * 1024 || !hashPattern.test(asset.sha256)
            || asset.compression && asset.compression !== 'gzip'
            || asset.compression && (!Number.isSafeInteger(asset.downloadSize) || asset.downloadSize <= 0 || asset.downloadSize > asset.size || !hashPattern.test(asset.downloadSha256))) throw new Error('视频组件锁文件含非法地址、名称、大小或摘要');
        seen.add(asset.file);
    }
    return lock;
}
export async function readMediaLock() { return validateMediaLock(JSON.parse(await readFile(join(projectRoot, 'scripts', 'media-tools.lock.json'), 'utf8'))); }

async function matches(file, size, sha256) {
    try {
        const info = await lstat(file);
        if (!info.isFile() || info.isSymbolicLink() || info.size !== size) return false;
        const hash = createHash('sha256');
        for await (const chunk of createReadStream(file)) hash.update(chunk);
        return hash.digest('hex') === sha256;
    } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}
async function localDirectory(directory) {
    await mkdir(directory, { recursive: true });
    if (!samePath(await realpath(directory), resolve(directory))) throw new Error('组件目录不能经过符号链接或目录联接');
}

function curlAttempt(url, file, maxBytes, range) {
    return new Promise((resolvePromise, reject) => {
        const child = spawn('curl.exe', ['--fail', '--location', '--proto', '=https', '--proto-redir', '=https', '--connect-timeout', '20', '--max-time', '150', '--max-filesize', String(maxBytes), ...(range ? ['--range', range] : []), '--silent', '--show-error', '--output', file, url], { windowsHide: true, shell: false, stdio: ['ignore', 'ignore', 'pipe'] });
        let stderr = '';
        const timer = setTimeout(() => child.kill(), 155000);
        child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString('utf8')).slice(-4096); });
        child.on('error', error => { clearTimeout(timer); reject(error); });
        child.on('close', code => { clearTimeout(timer); resolvePromise({ code, stderr }); });
    });
}
/** 固定大小分段/最多4并发，每段150秒/3次；核对全文件后才能作为组件使用。 */
export async function fetchMediaAsset(asset, cache, report = console.log, { attempt = curlAttempt, chunkBytes = 2 * 1024 * 1024, concurrency = 4 } = {}) {
    const compressed = asset.compression === 'gzip';
    const size = compressed ? asset.downloadSize : asset.size, digest = compressed ? asset.downloadSha256 : asset.sha256;
    if (await matches(cache, size, digest)) return;
    const old = await lstat(cache).catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
    if (old && (!old.isFile() || old.isSymbolicLink())) throw new Error('组件下载缓存不是普通文件');
    const pieces = Array.from({ length: Math.ceil(size / chunkBytes) }, (_, index) => ({ start: index * chunkBytes, end: Math.min(size, (index + 1) * chunkBytes) - 1, file: cache + '.' + index + '.chunk' }));
    let next = 0, completed = 0, failure;
    const regularSize = async (file, size) => { const item = await lstat(file).catch(error => { if (error.code !== 'ENOENT') throw error; return null; }); return item?.isFile() && !item.isSymbolicLink() && item.size === size; };
    async function worker() {
        while (!failure && next < pieces.length) {
            const piece = pieces[next++], expected = piece.end - piece.start + 1;
            if (!await regularSize(piece.file, expected)) {
                let successful = false;
                for (let retry = 1; retry <= 3 && !failure; retry++) {
                    const partial = piece.file + '.' + randomUUID() + '.tmp';
                    try {
                        const response = await attempt(asset.url, partial, expected, `${piece.start}-${piece.end}`);
                        if (response.code === 0 && await regularSize(partial, expected)) { await rename(partial, piece.file); successful = true; break; }
                        report(`${asset.file}：分段重试 ${retry}/3`);
                    } finally { await rm(partial, { force: true }); }
                }
                if (!successful) throw new Error(`${asset.file} 分段下载失败；已完成分段保留，重新运行可以继续`);
            }
            completed += expected; report(`${asset.file}：${completed}/${size} 字节`);
        }
    }
    const jobs = await Promise.allSettled(Array.from({ length: Math.min(concurrency, pieces.length) }, () => worker().catch(error => { failure ||= error; throw error; })));
    for (const result of jobs) if (result.status === 'rejected') throw result.reason;
    const temporary = cache + '.' + randomUUID() + '.tmp';
    try {
        const chunks = async function* () { for (const piece of pieces) yield* createReadStream(piece.file); };
        let received = 0;
        const limit = new Transform({ transform(chunk, _encoding, done) { received += chunk.length; done(received > size ? new Error('下载组件超出大小上限') : null, chunk); } });
        await pipeline(chunks(), limit, createWriteStream(temporary, { flags: 'wx' }));
        if (!await matches(temporary, size, digest)) {
            await Promise.all(pieces.map(piece => rm(piece.file, { force: true })));
            throw new Error(`${asset.file} SHA256不符，未安装`);
        }
        await rename(temporary, cache);
        await Promise.all(pieces.map(piece => rm(piece.file, { force: true })));
    } finally { await rm(temporary, { force: true }); }
}

export async function prepareMediaTools(root = projectRoot, { lock, fetchAsset = fetchMediaAsset, report = console.log } = {}) {
    lock = validateMediaLock(lock || await readMediaLock());
    const target = bundlePath(root), cache = join(root, 'build', 'media-cache');
    await localDirectory(target); await localDirectory(cache);
    // 三个大文件独立续传；许可在后面顺序补齐，避免同时启动过多连接。
    const install = async asset => {
        const file = join(target, asset.file);
        if (await matches(file, asset.size, asset.sha256)) { report(`${asset.file}：校验通过`); return; }
        const download = join(cache, asset.file + (asset.compression ? '.gz' : '') + '.download');
        await fetchAsset(asset, download, report);
        if (!await matches(download, asset.compression ? asset.downloadSize : asset.size, asset.compression ? asset.downloadSha256 : asset.sha256)) throw new Error(`${asset.file} 下载校验失败，未安装`);
        const temporary = join(target, `.${asset.file}.${randomUUID()}.tmp`);
        try {
            if (asset.compression) {
                let received = 0;
                const limit = new Transform({ transform(chunk, _encoding, done) { received += chunk.length; done(received > asset.size ? new Error('组件解压超过大小限制') : null, chunk); } });
                await pipeline(createReadStream(download), createGunzip(), limit, createWriteStream(temporary, { flags: 'wx' }), { signal: AbortSignal.timeout(30000) });
            } else await copyFile(download, temporary, 1);
            if (!await matches(temporary, asset.size, asset.sha256)) throw new Error(`${asset.file} 成品校验失败，既有组件未修改`);
            await rename(temporary, file); report(`${asset.file}：已准备`);
        } finally { await rm(temporary, { force: true }); }
    };
    const binaries = await Promise.allSettled(lock.assets.filter(asset => asset.file.endsWith('.exe')).map(install));
    for (const result of binaries) if (result.status === 'rejected') throw result.reason;
    for (const asset of lock.assets.filter(asset => !asset.file.endsWith('.exe'))) await install(asset);
    await writeFile(join(target, 'components-lock.json'), JSON.stringify(lock, null, 2) + '\n');
    await verifyMediaTools(root, lock);
    return target;
}
export async function verifyMediaTools(root = projectRoot, lock) {
    lock = validateMediaLock(lock || await readMediaLock());
    const target = bundlePath(root);
    if (!samePath(await realpath(target), resolve(target))) throw new Error('组件目录不能经过链接');
    for (const asset of lock.assets) if (!await matches(join(target, asset.file), asset.size, asset.sha256)) throw new Error(`缺少或损坏的视频组件：${asset.file}；请运行 scripts/prepare-media-tools.mjs`);
    const recorded = JSON.parse(await readFile(join(target, 'components-lock.json'), 'utf8'));
    if (JSON.stringify(recorded) !== JSON.stringify(lock)) throw new Error('组件版本清单不匹配');
    return lock;
}
export async function stageMediaTools(root, destination, lock) {
    lock = await verifyMediaTools(root, lock);
    const target = bundlePath(destination); await localDirectory(target);
    for (const file of [...lock.assets.map(asset => asset.file), 'components-lock.json']) await copyFile(join(bundlePath(root), file), join(target, file), 1);
    await verifyMediaTools(destination, lock);
    return target;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    try {
        const args = process.argv.slice(2);
        if (args.length === 1 && args[0] === '--check') { await verifyMediaTools(); console.log('视频组件与许可全部校验通过'); }
        else if (args.length === 2 && args[0] === '--stage') { console.log(await stageMediaTools(projectRoot, resolve(args[1]))); }
        else if (args.length === 0) {
            if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('内置组件仅提供Windows x64；其他平台请使用组件设置指定本机工具');
            console.log(await prepareMediaTools());
        } else throw new Error('用法：node scripts/prepare-media-tools.mjs [--check | --stage <发布暂存根目录>]');
    } catch (error) { console.error(error.message); process.exitCode = 1; }
}
