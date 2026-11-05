import { opendir, stat } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { AdbError } from './android-adb-protocol.js';

const skipDirectories = new Set(['.git', 'node_modules', '.gradle', '.idea', '$recycle.bin', 'system volume information']);

/** 搜索用户指定的目录，不跟随链接，也不枚举整台电脑。 */
export async function findAdbInFolder(raw, { signal, maxDepth = 6, maxDirectories = 2000, maxEntries = 20000, maxResults = 32, timeoutMs = 5000 } = {}) {
    if (typeof raw !== 'string' || raw.length > 2048 || /[\x00-\x1f]/.test(raw)) throw new AdbError('invalid_input', '请输入有效的文件夹路径');
    const folder = raw.trim().replace(/^"(.*)"$/, '$1');
    if (!isAbsolute(folder)) throw new AdbError('invalid_input', '请输入文件夹的完整绝对路径');
    const directory = resolve(folder);
    try {
        if (!(await stat(directory)).isDirectory()) throw new Error('not_directory');
    } catch { throw new AdbError('invalid_input', '文件夹不存在或无法访问，请输入包含 ADB 的文件夹'); }

    const executableName = process.platform === 'win32' ? 'adb.exe' : 'adb';
    const candidates = [];
    const pending = [{ path: directory, depth: 0 }];
    const deadline = Date.now() + timeoutMs;
    let scannedDirectories = 0;
    let entries = 0;
    let truncated = false;
    let skippedDirectories = 0;
    while (pending.length) {
        if (signal?.aborted) throw new AdbError('cancelled', '文件夹搜索已取消', 499);
        if (scannedDirectories >= maxDirectories || entries >= maxEntries || Date.now() >= deadline) { truncated = true; break; }
        const current = pending.shift();
        scannedDirectories++;
        try {
            for await (const item of await opendir(current.path)) {
                if (signal?.aborted) throw new AdbError('cancelled', '文件夹搜索已取消', 499);
                if (++entries > maxEntries || Date.now() >= deadline) { truncated = true; break; }
                // Dirent 的 isDirectory/isFile 均排除符号链接和 Windows junction。
                if (item.isFile() && item.name.toLowerCase() === executableName) {
                    candidates.push(join(current.path, item.name));
                    if (candidates.length >= maxResults) { truncated = true; break; }
                } else if (item.isDirectory() && !skipDirectories.has(item.name.toLowerCase())) {
                    if (current.depth < maxDepth) pending.push({ path: join(current.path, item.name), depth: current.depth + 1 });
                    else truncated = true;
                }
            }
        } catch (error) {
            if (error instanceof AdbError) throw error;
            if (current.depth === 0) throw new AdbError('invalid_input', '无法读取此文件夹，请检查访问权限');
            skippedDirectories++;
        }
        if (entries > maxEntries || candidates.length >= maxResults) break;
    }
    return { directory, candidates: candidates.sort(), truncated, skippedDirectories, scannedDirectories };
}
