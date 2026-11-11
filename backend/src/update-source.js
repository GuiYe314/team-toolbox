// 更新源配置。默认读取公开项目的 GitHub Releases 静态资产，不调用 GitHub API。
// 保留自定义 HTTP/共享目录，以供不能访问 GitHub 的内网使用。
// 仓库地址只规范化到发布资产目录，不拉源码、不调用 Git、不分发凭据。
//
// ── 支持的形态 ──
//
//   https://example.com/team-toolbox/      → 取该目录下的 manifest.json
//   https://github.com/o/r/releases/latest/download  → 同上（static 下载地址）
//   \\fileserver\share\team-toolbox\        → 内网共享盘
//   D:\releases\team-toolbox\              → 本地目录
//   .../manifest.json                      → 直接指向清单文件
//
// 环境变量 UPDATE_SOURCE 优先于配置文件 —— 便于用组策略/快捷方式统一注入，
// 不必逐台去界面里填。

import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, isAbsolute, join } from 'node:path';
import { APP_ROOT } from './version.js';

/**
 * 更新相关文件的存放目录。
 *
 * 刻意放在 `data/` 下而非包根：升级时会用 robocopy 覆盖包根但排除 `data/`，
 * 放这儿才不会在升级过程中把自己删掉。
 *
 * TT_UPDATE_DIR 仅供测试注入 —— 验收要能对着临时目录跑，不污染真实部署。
 */
export const UPDATE_ROOT = process.env.TT_UPDATE_DIR
    ? process.env.TT_UPDATE_DIR
    : join(APP_ROOT, 'data', 'updates');

export const SOURCE_FILE = join(UPDATE_ROOT, 'source.json');
export const STATE_FILE = join(UPDATE_ROOT, 'state.json');
export const DEFAULT_UPDATE_SOURCE = 'https://github.com/GuiYe314/team-toolbox/releases/latest/download';

const MAX_SOURCE_LEN = 500;

/** 仅把 GitHub 仓库和 Releases 首页映射为资产目录，其他源保持原样。 */
export function normalizeUpdateSource(raw) {
    const source = typeof raw === 'string' ? raw.trim() : '';
    if (!/^https?:\/\//i.test(source)) return source;
    let url;
    try { url = new URL(source); } catch { return source; }
    if (url.hostname.toLowerCase() !== 'github.com' || url.username || url.password || url.port || url.search || url.hash) return source;
    const match = url.pathname.match(/^\/([a-z\d][a-z\d-]*)\/([a-z\d_.-]+?)(?:\.git)?(?:\/(?:releases(?:\/latest)?))?\/?$/i);
    if (!match) return source;
    return `https://github.com/${match[1]}/${match[2]}/releases/latest/download`;
}

/** 确保更新目录存在。所有写操作前调用。 */
export function ensureUpdateRoot() {
    mkdirSync(UPDATE_ROOT, { recursive: true });
}

/**
 * 判断更新源形态。
 *
 * @param {string} raw
 * @returns {{ kind: 'http'|'file'|'invalid', value: string, reason?: string }}
 */
export function classifySource(raw) {
    const s = String(raw || '').trim();
    if (!s) return { kind: 'invalid', value: '', reason: 'empty' };
    if (s.length > MAX_SOURCE_LEN) return { kind: 'invalid', value: s, reason: 'too_long' };

    if (/^https?:\/\//i.test(s)) {
        let url;
        try { url = new URL(s); } catch { return { kind: 'invalid', value: s, reason: 'invalid_url' }; }
        if (!url.hostname || url.username || url.password) return { kind: 'invalid', value: s, reason: 'invalid_url' };
        const value = normalizeUpdateSource(s);
        if (url.hostname.toLowerCase() === 'github.com') {
            const normalized = new URL(value);
            // 代码浏览页和单次发布页不是静态更新源，避免把 HTML 当清单。
            if (url.port || url.search || url.hash || !/^\/[^/]+\/[^/]+\/releases\/(?:latest\/download|download\/[^/]+)(?:\/manifest\.json)?\/?$/i.test(normalized.pathname)) {
                return { kind: 'invalid', value: s, reason: 'github_page' };
            }
        }
        return { kind: 'http', value };
    }
    // 刻意不支持 ftp/ssh 等：更新包必须能流式读取并用 sha256 校验，
    // 多一种协议就多一类失败模式，收益为零。
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) {
        return { kind: 'invalid', value: s, reason: 'unsupported_scheme' };
    }
    return { kind: 'file', value: s };
}

/**
 * 把「更新源」解析成 manifest 的具体位置。
 *
 * 允许直接指向 manifest.json，也允许只给目录 —— 后者对分享盘更自然
 * （用户只会记得「放这个文件夹」）。
 *
 * @param {string} raw
 * @returns {{ kind: 'http'|'file', url: string } | null}
 */
export function resolveManifestLocation(raw) {
    const c = classifySource(raw);
    if (c.kind === 'invalid') return null;

    if (c.kind === 'http') {
        const url = new URL(c.value);
        if (!/\.json$/i.test(url.pathname)) url.pathname = url.pathname.replace(/\/+$/, '') + '/manifest.json';
        return { kind: 'http', url: url.href };
    }

    const looksLikeJson = /\.json$/i.test(c.value);
    const base = isAbsolute(c.value) ? c.value : join(APP_ROOT, c.value);
    const target = looksLikeJson ? base : join(base, 'manifest.json');
    return { kind: 'file', url: target, dir: looksLikeJson ? dirname(base) : base };
}

/**
 * 读取当前生效的更新源。
 *
 * @returns {{ source: string, origin: 'env'|'file'|'default'|'none' }}
 */
export function getUpdateSource() {
    const fromEnv = String(process.env.UPDATE_SOURCE || '').trim();
    if (fromEnv) return { source: normalizeUpdateSource(fromEnv), origin: 'env' };

    try {
        if (existsSync(SOURCE_FILE)) {
            const j = JSON.parse(readFileSync(SOURCE_FILE, 'utf8'));
            // 空字符串是明确关闭，兼容此前已清空的配置；不可退回默认源。
            if (!j || typeof j.url !== 'string') return { source: '', origin: 'none' };
            const s = normalizeUpdateSource(j.url);
            return { source: s, origin: s ? 'file' : 'none' };
        }
    } catch {
        // 损坏配置保持关闭，不擅自切换到另一个可信源。
        return { source: '', origin: 'none' };
    }
    return { source: DEFAULT_UPDATE_SOURCE, origin: 'default' };
}

/**
 * 写入更新源配置。
 *
 * 传空字符串表示清除配置（回到「未启用自动更新」）。
 *
 * @param {string} raw
 * @returns {{ source: string, origin: string }}
 */
export function setUpdateSource(raw) {
    let s = typeof raw === 'string' ? raw.trim() : '';
    if (typeof raw !== 'string' || s) {
        const c = typeof raw === 'string' ? classifySource(s) : { kind: 'invalid' };
        if (c.kind === 'invalid') {
            const err = new Error(
                c.reason === 'unsupported_scheme'
                    ? '只支持 http(s) 地址或本地/共享目录路径'
                    : c.reason === 'github_page'
                        ? '请填写 GitHub 仓库地址或 Releases 下载目录，不要填写代码浏览页或单次发布页'
                        : '更新源地址无效，请填写 http(s) 地址或本地/共享目录'
            );
            err.code = 'invalid_input';
            throw err;
        }
        s = c.value;
    }

    ensureUpdateRoot();
    const temporary = `${SOURCE_FILE}.${randomUUID()}.tmp`;
    try {
        writeFileSync(temporary, JSON.stringify({ url: s, updated_at: new Date().toISOString() }, null, 2), 'utf8');
        renameSync(temporary, SOURCE_FILE);
    } finally { rmSync(temporary, { force: true }); }
    return getUpdateSource();
}

/** 读取上次检查结果（缓存，供页面首屏直接展示，不触发网络请求）。 */
export function readUpdateState() {
    try {
        if (!existsSync(STATE_FILE)) return null;
        return JSON.parse(readFileSync(STATE_FILE, 'utf8'));
    } catch {
        return null;
    }
}

/** 写入检查结果。 */
export function writeUpdateState(state) {
    try {
        ensureUpdateRoot();
        writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
    } catch {
        // 缓存写不了不值得让检查失败
    }
}
