// 版本号的唯一来源。
//
// 为什么单独抽一个模块：版本号此前散落在四处（backend/package.json、
// frontend/package.json、installer 的 AppVersion、index.js 里的硬编码字符串），
// 且打包脚本只覆盖 .iss 那一处 —— 结果 v0.1.1 的包对外自称 0.1.0。
//
// 这是一个真实发生过的缺陷：`/api/health` 返回 0.1.0，而 package.json 是 0.1.1。
// 自动更新依赖版本比对，版本号不可信就等于更新检测完全失效 ——
// 会把「已经是新版」判成「需要更新」，或者反过来永远提示有新版本。
//
// 现在的约定：**backend/package.json 的 version 是唯一事实来源**，
// 打包脚本按 -Version 参数覆写它，其余地方一律读这里。

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** 包根目录（含 backend / frontend / runtime / data）。 */
export const APP_ROOT = join(__dirname, '..', '..');

const PKG_PATH = join(__dirname, '..', 'package.json');

let cached = null;

/**
 * 读取当前应用版本。
 *
 * 读不到 package.json 时返回 '0.0.0' 而不是抛错 ——
 * 版本读不出不该导致服务起不来，但会明确表现为「任何版本都被视为更新」，
 * 这在日志与 UI 上一眼可见，比静默降级成某个看似正常的版本号安全。
 *
 * @returns {string} 形如 0.1.1
 */
export function getAppVersion() {
    if (cached !== null) return cached;
    try {
        const pkg = JSON.parse(readFileSync(PKG_PATH, 'utf8'));
        cached = String(pkg.version || '0.0.0');
    } catch {
        cached = '0.0.0';
    }
    return cached;
}

/**
 * 比较两个语义化版本。
 *
 * 只处理 `x.y.z` 与 `x.y.z-suffix` 两种形态。比较规则：
 *   1. 主次修订号按数字比
 *   2. 主次修订都相同时，**无后缀的新于有后缀的**（1.0.0 > 1.0.0-rc.1），
 *      这与 semver 一致，也是发布实践里期望的行为
 *   3. 都有后缀时按字符串比（够用：rc.1 < rc.2 恰好成立）
 *
 * @returns {number} a<b 返回负数，相等返回 0，a>b 返回正数
 */
export function compareVersions(a, b) {
    const parse = (v) => {
        const s = String(v || '0.0.0').trim().replace(/^v/i, '');
        const dash = s.indexOf('-');
        const core = dash === -1 ? s : s.slice(0, dash);
        const pre = dash === -1 ? '' : s.slice(dash + 1);
        const nums = core.split('.').map((x) => {
            const n = Number.parseInt(x, 10);
            return Number.isFinite(n) ? n : 0;
        });
        while (nums.length < 3) nums.push(0);
        return { nums: nums.slice(0, 3), pre };
    };

    const pa = parse(a);
    const pb = parse(b);

    for (let i = 0; i < 3; i += 1) {
        if (pa.nums[i] !== pb.nums[i]) return pa.nums[i] - pb.nums[i];
    }

    if (pa.pre === pb.pre) return 0;
    if (pa.pre === '') return 1;
    if (pb.pre === '') return -1;
    return pa.pre < pb.pre ? -1 : 1;
}
