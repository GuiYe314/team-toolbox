import { lstat, realpath, open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { isAbsolute, resolve, join, parse, relative, sep } from 'node:path';

export class FileShareError extends Error {
    constructor(code, message, status = 400) { super(message); this.code = code; this.status = status; }
}
const invalid = () => new FileShareError('invalid_path', '目录或文件名称无效，请使用共享目录中的普通文件夹和文件');
const samePath = (a, b) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
export const sameFile = (a, b) => a.dev === b.dev && a.ino === b.ino;
export function shareName(value) {
    if (typeof value !== 'string' || !value || value.length > 180 || /[\\/:*?"<>|\x00-\x1f\x7f]/.test(value)
        || /[. ]$/.test(value) || /^(?:\.|\.\.)$/.test(value) || /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(value)
        || /^\.toolbox-share-/i.test(value)) throw invalid();
    return value;
}
export function sharePath(value = '') {
    if (typeof value !== 'string' || value.length > 2048 || value.includes('\\')) throw invalid();
    const parts = value === '' ? [] : value.split('/');
    if (parts.length > 32) throw invalid();
    parts.forEach(shareName); return parts;
}
async function ordinary(path, directory) {
    const info = await lstat(path);
    if (info.isSymbolicLink() || (directory ? !info.isDirectory() : !info.isFile() || info.nlink !== 1)
        || !samePath(await realpath(path), resolve(path))) throw new FileShareError('blocked_file', '为保护共享范围，不支持链接、目录联接、硬链接或特殊文件', 403);
    return info;
}
export async function pinShareRoot(value) {
    if (typeof value !== 'string' || value.length > 2048 || !isAbsolute(value) || /[\x00-\x1f]/.test(value)
        || /^(?:\\\\|\/\/)/.test(value) || (process.platform === 'win32' && value.slice(2).includes(':'))) throw invalid();
    const path = resolve(value), base = parse(path).root;
    if (samePath(path, base)) throw new FileShareError('invalid_root', '请选择具体文件夹，不能共享整个磁盘');
    let current = base;
    for (const part of relative(base, path).split(sep)) { current = join(current, part); await ordinary(current, true); }
    return { path, identity: await ordinary(path, true) };
}
export async function checkedSharePath(root, value = '', directory = true) {
    const parts = sharePath(value), info = await ordinary(root.path, true);
    if (!sameFile(root.identity, info)) throw new FileShareError('root_changed', '共享文件夹已被移动或替换，请停止后重新开启共享', 409);
    let path = root.path, last = info;
    for (let i = 0; i < parts.length; i++) { path = join(path, parts[i]); last = await ordinary(path, i < parts.length - 1 || directory); }
    if (!parts.length && !directory) throw invalid();
    return { path, info: last };
}
export async function openSharedFile(root, value) {
    const target = await checkedSharePath(root, value, false);
    const file = await open(target.path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    try {
        const info = await file.stat();
        if (!sameFile(target.info, info) || !info.isFile() || info.nlink !== 1) throw new FileShareError('file_changed', '文件已变化，请刷新后重试', 409);
        await checkedSharePath(root, value, false);
        return { file, info };
    } catch (error) { await file.close(); throw error; }
}
export function shareFailure(error) {
    if (error instanceof FileShareError) return error;
    const known = {
        ENOENT: ['not_found', '文件或目录不存在，请刷新后重试', 404],
        ENOTDIR: ['not_found', '目录已变化，请刷新后重试', 404],
        EACCES: ['permission_denied', '工具箱没有此目录的读写权限', 403],
        EPERM: ['permission_denied', '文件被占用或工具箱没有此目录的读写权限', 403],
        ENOSPC: ['disk_full', '电脑磁盘空间不足，文件未保存', 507],
        EEXIST: ['name_exists', '此名称已经存在，请换一个名称', 409],
    };
    return new FileShareError(...(known[error?.code] || ['transfer_failed', '文件操作失败，请刷新后重试', 500]));
}
