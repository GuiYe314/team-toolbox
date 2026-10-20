// 资源管理：镜像目录（外部存储路径）管理。
//
// ── 语义（用户需求：「设置资源保存路径，当选择路径后资源自动拷贝到指定路径」）──
//
// 主存储永远是 data/assets/<assetId>/<versionId>/（服务端的权威副本），
// 镜像目录是用户指定的**额外副本**。
//
// 为什么不做「主存储切换」：
//   主存储路径是数据库里 storage_key 的解析基准。若允许运行时切换，
//   存量资源的 storage_key 全部失效，且服务重启、外部盘掉线时没有兜底。
//   镜像语义既满足「自动拷贝到指定路径」，又让数据不受外部目录可用性影响 ——
//   外部盘挂了只是同步失败，主存储照常工作。
//
// ── 安全边界 ──
//
// 用户指定任意路径 = 服务端可在任意位置写文件，这是功能本身的要求。
// 但仍要守住三条底线：
//   1. 路径必须是**绝对路径** —— 相对路径会随进程工作目录漂移，
//      同一份配置在开发/生产下指向不同位置，是极难排查的坑。
//   2. 路径必须**已存在且是目录** —— 不自动创建未知层级的目录，
//      否则一个笔误就会在磁盘上撒出一串空目录。
//   3. 写入时用 relative() 校验目标仍在镜像目录之内 —— 防符号链接/路径穿越。
//
// 另外：拒绝把镜像目录设成主存储目录的子目录或反之 —— 那样会自我递归，
// 同步时把文件复制进自己的子目录，再被下一轮同步当成源。

import { existsSync, statSync, mkdirSync, copyFileSync, readdirSync, unlinkSync } from 'node:fs';
import { resolve as resolvePath, join, relative, isAbsolute, sep, dirname } from 'node:path';
import { errorMap } from './errors.js';
import { ASSET_DIR, resolveAssetPath } from './asset-storage.js';

const err = (msg) => errorMap(new Error(msg), '(assets)', 'invalid_input');

/** 设置项 key（存 asset_settings 表）。 */
export const SETTING_MIRROR_PATH = 'mirror_path';

/**
 * 校验并规范化镜像目录路径。
 *
 * @param {string} raw 用户输入的路径
 * @returns {string} 规范化后的绝对路径（去掉末尾分隔符）
 * @throws {{ code:'invalid_input', message:string }}
 */
export function normalizeMirrorPath(raw) {
    const text = String(raw || '').trim();
    if (!text) throw err('存储路径不能为空');

    // 必须是绝对路径
    if (!isAbsolute(text)) {
        throw err('存储路径必须是绝对路径，例如 D:\\Assets 或 /mnt/assets');
    }

    const abs = resolvePath(text);

    // 去掉末尾分隔符（根目录除外），便于显示与比较
    const normalized = abs.length > 1 ? abs.replace(/[\\/]+$/, '') : abs;

    // 不能是主存储目录本身或其子目录 —— 否则同步会自我递归
    const rel = relative(ASSET_DIR, normalized);
    if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) {
        throw err('存储路径不能是资源主存储目录本身或其子目录');
    }
    // 反向：主存储也不能在镜像目录里面
    const rel2 = relative(normalized, ASSET_DIR);
    if (rel2 === '' || (!rel2.startsWith('..') && !isAbsolute(rel2))) {
        throw err('存储路径不能是资源主存储目录的上级目录');
    }

    // 必须已存在且是目录
    if (!existsSync(normalized)) {
        throw err(`路径不存在：${normalized}`);
    }
    let st;
    try {
        st = statSync(normalized);
    } catch {
        throw err(`无法访问路径：${normalized}`);
    }
    if (!st.isDirectory()) {
        throw err(`路径不是文件夹：${normalized}`);
    }

    return normalized;
}

/**
 * 读镜像目录配置。
 * @param {import('better-sqlite3').Database} db
 * @returns {string|null} 未设置时返回 null
 */
export function getMirrorPath(db) {
    const row = db.prepare('SELECT value FROM asset_settings WHERE key = ?').get(SETTING_MIRROR_PATH);
    return row ? row.value : null;
}

/**
 * 写镜像目录配置。
 * @param {import('better-sqlite3').Database} db
 * @param {string|null} path 传 null 表示清除配置
 * @returns {string|null} 实际生效的路径
 */
export function setMirrorPath(db, path) {
    if (path === null || path === undefined || String(path).trim() === '') {
        db.prepare('DELETE FROM asset_settings WHERE key = ?').run(SETTING_MIRROR_PATH);
        return null;
    }
    const normalized = normalizeMirrorPath(path);
    db.prepare(`
        INSERT INTO asset_settings (key, value, updated_at)
        VALUES (?, ?, datetime('now'))
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
    `).run(SETTING_MIRROR_PATH, normalized);
    return normalized;
}

/**
 * 镜像目录中某个版本的存放位置。
 * 与主存储同构：<mirror>/<assetId>/<versionId>/<文件名>
 */
function mirrorVersionDir(mirrorRoot, assetId, versionId) {
    return join(mirrorRoot, String(assetId), String(versionId));
}

/**
 * 把一个存储键对应的文件拷贝到镜像目录。
 *
 * 目标路径用 relative() 做边界校验 —— 即便 storageKey 被污染，
 * 也无法写到镜像目录之外。
 *
 * @param {string} mirrorRoot
 * @param {string} storageKey 主存储中的相对键
 * @returns {boolean} 是否拷贝成功
 */
export function mirrorFile(mirrorRoot, storageKey) {
    if (!mirrorRoot) return false;
    const src = resolveAssetPath(storageKey);
    if (!src) return false;

    const rel = relative(ASSET_DIR, src);
    if (!rel || rel.startsWith('..') || isAbsolute(rel)) return false;

    const dest = join(mirrorRoot, rel);
    // 二次边界校验：确保目标确实落在镜像目录内
    const relCheck = relative(mirrorRoot, dest);
    if (!relCheck || relCheck.startsWith('..') || isAbsolute(relCheck)) return false;

    try {
        mkdirSync(dirname(dest), { recursive: true });
        copyFileSync(src, dest);
        return true;
    } catch {
        // 磁盘满、权限不足、外部盘掉线 —— 都不能影响主流程
        return false;
    }
}

/**
 * 把一个版本的全部文件（original/preview/thumbnail）同步到镜像目录。
 *
 * @param {string} mirrorRoot
 * @param {number} assetId
 * @param {number} versionId
 * @param {object} version 版本行（含三个 storage_key）
 * @returns {{ copied: number, failed: number }}
 */
export function mirrorVersion(mirrorRoot, assetId, versionId, version) {
    const result = { copied: 0, failed: 0 };
    if (!mirrorRoot || !version) return result;

    const keys = [
        version.original_storage_key,
        version.preview_storage_key,
        version.thumbnail_storage_key
    ].filter(Boolean);

    for (const key of keys) {
        if (mirrorFile(mirrorRoot, key)) result.copied++;
        else result.failed++;
    }
    return result;
}

/**
 * 全量同步：把主存储下的所有文件镜像到目标目录。
 *
 * 遍历主存储目录树即可 —— 不必查数据库，因为磁盘上的文件就是真相，
 * 且这样能顺带把「数据库有记录但文件已丢失」的异常暴露出来。
 *
 * @param {string} mirrorRoot
 * @returns {{ copied: number, failed: number, total: number }}
 */
export function mirrorAll(mirrorRoot) {
    const result = { copied: 0, failed: 0, total: 0 };
    if (!mirrorRoot) return result;
    if (!existsSync(ASSET_DIR)) return result;

    const walk = (dir, relBase) => {
        let entries;
        try {
            entries = readdirSync(dir, { withFileTypes: true });
        } catch {
            return;
        }
        for (const entry of entries) {
            const full = join(dir, entry.name);
            const rel = relBase ? `${relBase}/${entry.name}` : entry.name;
            if (entry.isDirectory()) {
                walk(full, rel);
            } else if (entry.isFile()) {
                result.total++;
                if (mirrorFile(mirrorRoot, rel)) result.copied++;
                else result.failed++;
            }
        }
    };
    walk(ASSET_DIR, '');
    return result;
}

/**
 * 统计镜像目录的现状（用于 UI 展示「已同步 N 个文件」）。
 *
 * @param {string|null} mirrorRoot
 * @returns {{ configured: boolean, path: string|null, files: number, bytes: number }}
 */
export function mirrorStats(mirrorRoot) {
    const base = {
        configured: !!mirrorRoot,
        path: mirrorRoot || null,
        files: 0,
        bytes: 0
    };
    if (!mirrorRoot || !existsSync(mirrorRoot)) return base;

    const walk = (dir) => {
        let entries;
        try {
            entries = readdirSync(dir, { withFileTypes: true });
        } catch {
            return;
        }
        for (const entry of entries) {
            const full = join(dir, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (entry.isFile()) {
                base.files++;
                try { base.bytes += statSync(full).size; } catch { /* 并发删除，忽略 */ }
            }
        }
    };
    walk(mirrorRoot);
    return base;
}

/**
 * 清除镜像目录内的内容（不删目录本身）。
 * 用于「停止镜像并清理」的操作。
 *
 * @param {string} mirrorRoot
 * @returns {{ removed: number }}
 */
export function clearMirror(mirrorRoot) {
    let removed = 0;
    if (!mirrorRoot || !existsSync(mirrorRoot)) return { removed };
    for (const entry of readdirSync(mirrorRoot, { withFileTypes: true })) {
        const full = join(mirrorRoot, entry.name);
        try {
            if (entry.isDirectory()) {
                // 目录递归删除
                const rm = (d) => {
                    for (const e of readdirSync(d, { withFileTypes: true })) {
                        const p = join(d, e.name);
                        if (e.isDirectory()) rm(p);
                        else { unlinkSync(p); removed++; }
                    }
                };
                rm(full);
            } else {
                unlinkSync(full);
                removed++;
            }
        } catch { /* 占用中则跳过 */ }
    }
    return { removed };
}
