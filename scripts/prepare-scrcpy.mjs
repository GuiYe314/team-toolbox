// 显式开发/打包准备，不在网页或服务器启动时下载程序。
import { readFile, writeFile, mkdir, cp, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withUpdateResponse } from '../backend/src/update-http.js';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const lock = JSON.parse(await readFile(join(root, 'scripts/scrcpy.lock.json'), 'utf8'));
const directory = join(root, 'vendor/scrcpy'), target = join(directory, 'scrcpy-server.jar');
const valid = bytes => bytes.length === lock.size && createHash('sha256').update(bytes).digest('hex') === lock.sha256;
await mkdir(directory, { recursive: true });
let bytes; try { bytes = await readFile(target); } catch { /* 首次准备 */ }
if (!bytes || !valid(bytes)) {
    if (process.argv.includes('--check')) throw new Error('scrcpy 组件缺失或摘要无效，请运行 node scripts/prepare-scrcpy.mjs');
    const temporary = target + '.tmp';
    try {
        bytes = await withUpdateResponse(lock.url, { timeoutMs: 60000 }, async response => {
            if (!response.ok) throw new Error('scrcpy 下载失败，HTTP ' + response.status);
            const chunks = []; let size = 0;
            for await (const chunk of response.body) { size += chunk.length; if (size > lock.size) throw new Error('scrcpy 组件大小无效'); chunks.push(chunk); }
            return Buffer.concat(chunks);
        });
        if (!valid(bytes)) throw new Error('scrcpy 组件摘要无效，拒绝采用');
        await writeFile(temporary, bytes, { mode: 0o600 }); await cp(temporary, target);
    } finally { await rm(temporary, { force: true }); }
}
await cp(join(root, 'licenses/scrcpy-LICENSE.txt'), join(directory, 'LICENSE.txt'));
await writeFile(join(directory, 'component.json'), JSON.stringify(lock, null, 2));
const stageIndex = process.argv.indexOf('--stage');
if (stageIndex !== -1) { if (!process.argv[stageIndex + 1]) throw new Error('缺少暂存目录'); const stage = resolve(process.argv[stageIndex + 1], 'vendor/scrcpy'); await mkdir(stage, { recursive: true }); for (const file of ['scrcpy-server.jar', 'LICENSE.txt', 'component.json']) await cp(join(directory, file), join(stage, file)); }
console.log(`scrcpy ${lock.version} 组件大小、SHA-256 与许可检查通过`);
