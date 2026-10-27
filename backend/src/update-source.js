// 更新源配置。
//
// ── 为什么更新源要可配置 ──
//
// 自动更新的第一版直觉是「直接读 GitHub Releases」。实测下来这条路在本项目
// 上有三个硬障碍：
//   1. 仓库是私有的。匿名访问 api.github.com 直接 404，每台客户端都得带
//      token —— 而 token 随安装包分发等于把仓库读权限发给所有人，
//      轮换一次就得重新分发安装包。
//   2. 未认证 API 限流 60 次/小时/IP。公司 NAT 下十几台机器各查几次就打满，
//      而 403 无法区分「限流」与「仓库不存在」，排查成本很高。
//   3. 部署前提是受控内网，客户端机器可能根本出不了网；
//      且 objects.githubusercontent.com 的可达性并不稳定。
//
// 但「更新源」本质上只需要是一个**能放静态文件的地址**：
// manifest.json + 包 + 校验值。GitHub Releases、内网共享盘、nginx 目录、
// 对象存储，都满足这个条件，实现上没有任何区别。
//
// 所以这里把源抽成配置：默认不启用，用户填什么就用什么。
// 换源不需要改代码，也不需要重新发版。
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

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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

const MAX_SOURCE_LEN = 500;

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

    if (/^https?:\/\//i.test(s)) return { kind: 'http', value: s };
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

    const looksLikeJson = /\.json$/i.test(c.value);
    if (c.kind === 'http') {
        const url = looksLikeJson ? c.value : c.value.replace(/\/+$/, '') + '/manifest.json';
        return { kind: 'http', url };
    }

    const base = isAbsolute(c.value) ? c.value : join(APP_ROOT, c.value);
    const target = looksLikeJson ? base : join(base, 'manifest.json');
    return { kind: 'file', url: target, dir: looksLikeJson ? dirname(base) : base };
}

/**
 * 读取当前生效的更新源。
 *
 * @returns {{ source: string, origin: 'env'|'file'|'none' }}
 */
export function getUpdateSource() {
    const fromEnv = String(process.env.UPDATE_SOURCE || '').trim();
    if (fromEnv) return { source: fromEnv, origin: 'env' };

    try {
        if (existsSync(SOURCE_FILE)) {
            const j = JSON.parse(readFileSync(SOURCE_FILE, 'utf8'));
            const s = String((j && j.url) || '').trim();
            if (s) return { source: s, origin: 'file' };
        }
    } catch {
        // 配置文件损坏按「未配置」处理，不要因此让调用方抛错：
        // 更新是附加能力，它坏掉不该影响主服务。
    }
    return { source: '', origin: 'none' };
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
    const s = String(raw || '').trim();
    if (s) {
        const c = classifySource(s);
        if (c.kind === 'invalid') {
            const err = new Error(
                c.reason === 'unsupported_scheme'
                    ? '只支持 http(s) 地址或本地/共享目录路径'
                    : '更新源地址无效'
            );
            err.code = 'invalid_input';
            throw err;
        }
    }

    ensureUpdateRoot();
    writeFileSync(SOURCE_FILE, JSON.stringify({ url: s, updated_at: new Date().toISOString() }, null, 2), 'utf8');
    return s ? { source: s, origin: 'file' } : { source: '', origin: 'none' };
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
