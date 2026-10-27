// 自动更新。
//
// ── 为什么要自动更新，而不是「下载安装包手动装一次」 ──
//
// 手动升级的实际结局是「没人升」。而这个项目已经发生过一次必须升级的
// 情况：v0.1.0 的包在部分机器上装完根本起不来，修好的 0.1.1 躺在发布页上
// 也没人知道要去下。
//
// ── 为什么不能「原地覆盖」 ──
//
// Windows 上运行中的 node.exe 不可替换，被占用的文件也无法写入。
// 所以整个流程是：**下载到暂存区 → 校验 → 备份数据 → 由独立的 cmd 进程
// 等服务退出后换文件 → 重启**。服务自己只负责「准备好 + 退出」。
//
// ── 为什么必须有回滚 ──
//
// 自动更新一旦装上一个坏包，用户的机器就再无服务可用，而且远程无法介入。
// 所以换文件前先把现有程序复制一份到 rollback/，换完启动后由**新版本自己**
// 删掉 pending 标记；标记还在就说明新版本没起来，apply.cmd 自动回滚。
//
// 这套机制是有代价的（临时多占一份程序体积），但比「远程装坏无从挽回」便宜。
//
// ── 安全检查 ──
//
// 1. 只接受 http(s) 与本地/共享目录
// 2. 包必须与清单里的 sha256 一致，不一致直接丢弃
// 3. 解压必须防路径穿越（zip slip）
// 4. 包结构必须完整（缺 backend / frontend / runtime 一律拒绝）
// 5. 换文件前用**包内自带的 node.exe** 跑一次原生模块自检 ——
//    这正是 v0.1.0 出问题的那个点，必须在落地前拦住，而不是装完才发现

import { createHash } from 'node:crypto';
import {
    createReadStream,
    createWriteStream,
    existsSync,
    mkdirSync,
    readFileSync,
    readdirSync,
    renameSync,
    rmSync,
    statSync,
    writeFileSync
} from 'node:fs';
import { dirname, join, resolve as resolvePath, sep } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { spawn, spawnSync } from 'node:child_process';
import yauzl from 'yauzl';
import { getDefaultDatabase } from './db.js';
import { exportFullBackup } from './full-backup.js';
import { getAppVersion, compareVersions, APP_ROOT } from './version.js';
import {
    UPDATE_ROOT,
    ensureUpdateRoot,
    getUpdateSource,
    readUpdateState,
    resolveManifestLocation,
    writeUpdateState
} from './update-source.js';

/** 清单格式版本。格式不兼容时靠它拒绝，而不是靠猜字段。 */
const MANIFEST_SCHEMA = 1;

/** 单包体积上限（未压缩）。超过直接拒绝，防止被指向一个超大文件拖死磁盘。 */
const MAX_PACKAGE_BYTES = 512 * 1024 * 1024;

// 读清单的超时。实测 GitHub 的资产下载 1.3–2.6 秒，但同一主机上的页面请求
// 出现过 11 秒；清单本身极小，超时设太紧会把「网络慢」误报成「更新源不可达」，
// 而那个错误提示会让用户去改本来正确的配置。
const MANIFEST_TIMEOUT_MS = 30_000;
const DOWNLOAD_TIMEOUT_MS = 600_000;

const PENDING_FILE = join(UPDATE_ROOT, 'pending.json');
const ROLLBACK_MARKER = join(UPDATE_ROOT, 'ROLLBACK.txt');
const APPLY_LOG = join(UPDATE_ROOT, 'apply.log');

/** 包内必须存在的路径 —— 缺任何一个都说明这不是一个可运行的完整包。 */
const REQUIRED_ENTRIES = [
    'backend/src/index.js',
    'backend/package.json',
    'backend/node_modules/better-sqlite3/package.json',
    'frontend/dist/index.html',
    'runtime/node.exe'
];

function fail(message, code = 'update_failed') {
    const err = new Error(message);
    err.code = code;
    return err;
}

function versionDir(version) {
    // 版本号参与目录名，必须挡住路径穿越（恶意清单可能给 ../../ 之类）
    if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(String(version || ''))) {
        throw fail(`版本号格式非法：${version}`, 'invalid_input');
    }
    return join(UPDATE_ROOT, version);
}

// ─────────────────────────────────────────────────
// 清单读取与校验
// ─────────────────────────────────────────────────

/**
 * 读取并校验清单。
 *
 * @param {{kind:'http'|'file', url:string, dir?:string}} loc
 * @returns {Promise<object>}
 */
async function readManifest(loc) {
    let text;
    if (loc.kind === 'http') {
        let res;
        try {
            res = await fetch(loc.url, { signal: AbortSignal.timeout(MANIFEST_TIMEOUT_MS) });
        } catch (e) {
            throw fail(`无法访问更新源：${e && e.message ? e.message : e}`, 'source_unreachable');
        }
        if (!res.ok) {
            // 403 与 404 分开说 —— 私有仓库匿名访问返回 404，
            // 限流返回 403，两者处置方式完全不同。
            const hint = res.status === 404
                ? '（404：地址不存在，或仓库是私有的且未授权）'
                : res.status === 403
                    ? '（403：可能触发了访问频率限制）'
                    : '';
            throw fail(`更新源返回 HTTP ${res.status}${hint}`, 'source_unreachable');
        }
        text = await res.text();
    } else {
        if (!existsSync(loc.url)) {
            throw fail(`更新源里找不到 manifest.json：${loc.url}`, 'source_unreachable');
        }
        text = readFileSync(loc.url, 'utf8');
    }

    let json;
    try {
        // 先剥 BOM。JSON.parse 不接受开头的 \uFEFF，而 Windows 上
        // 用 PowerShell 的 Set-Content/Out-File 写 UTF-8 默认会带 BOM ——
        // 报错信息只会说「Unexpected token」，根本指不到编码上。
        json = JSON.parse(String(text).replace(/^\uFEFF/, ''));
    } catch {
        throw fail('manifest.json 不是合法的 JSON', 'manifest_invalid');
    }
    return validateManifest(json);
}

/**
 * 校验清单结构。
 *
 * 刻意写得严格：清单决定「装什么」，任何字段的宽松解释
 * 都可能让一个错误的包被执行。
 */
function validateManifest(json) {
    if (!json || typeof json !== 'object') throw fail('manifest.json 内容无效', 'manifest_invalid');
    if (Number(json.schema) !== MANIFEST_SCHEMA) {
        throw fail(`清单格式版本不受支持（期望 ${MANIFEST_SCHEMA}，实际 ${json.schema}）`, 'manifest_invalid');
    }
    if (!Array.isArray(json.releases) || json.releases.length === 0) {
        throw fail('清单里没有任何版本条目', 'manifest_invalid');
    }

    const releases = json.releases.map((r) => {
        if (!r || typeof r !== 'object') throw fail('清单条目格式无效', 'manifest_invalid');
        const version = String(r.version || '');
        if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
            throw fail(`清单里的版本号非法：${version}`, 'manifest_invalid');
        }
        const sha256 = String(r.sha256 || '').toLowerCase();
        if (!/^[0-9a-f]{64}$/.test(sha256)) {
            throw fail(`版本 ${version} 的 sha256 缺失或格式错误 —— 没有校验值就不允许安装`, 'manifest_invalid');
        }
        const file = String(r.file || r.url || '');
        if (!file) throw fail(`版本 ${version} 缺少包文件地址`, 'manifest_invalid');

        return {
            version,
            file,
            sha256,
            size: Number(r.size) || 0,
            mandatory: Boolean(r.mandatory),
            notes: String(r.notes || ''),
            released_at: String(r.released_at || '')
        };
    });

    const latest = String(json.latest || '').trim()
        || releases.map((r) => r.version).sort(compareVersions).pop();

    return { schema: MANIFEST_SCHEMA, latest, releases };
}

/** 把清单里的相对路径解析成可下载的绝对地址。 */
function resolveReleaseUrl(loc, file) {
    if (/^https?:\/\//i.test(file)) return { kind: 'http', url: file };

    if (loc.kind === 'http') {
        return { kind: 'http', url: new URL(file, loc.url).toString() };
    }
    // 本地/共享目录：清单的 dir 就是基目录
    const base = loc.dir || dirname(loc.url);
    const isAbs = /^[A-Za-z]:[\\/]/.test(file) || file.startsWith('\\\\') || file.startsWith('/');
    return { kind: 'file', url: isAbs ? file : join(base, file) };
}

function pickRelease(manifest, version) {
    if (version) {
        const hit = manifest.releases.find((r) => r.version === version);
        if (!hit) throw fail(`清单里没有版本 ${version}`, 'not_found');
        return hit;
    }
    const sorted = [...manifest.releases].sort((a, b) => compareVersions(a.version, b.version));
    return sorted[sorted.length - 1];
}

// ─────────────────────────────────────────────────
// 检查更新
// ─────────────────────────────────────────────────

/**
 * 检查是否有可用更新。
 *
 * 不抛错：更新检查是附加能力，它失败不该让调用方崩。
 * 失败信息放在返回值的 error 字段里，由 UI 决定怎么展示。
 *
 * @returns {Promise<object>}
 */
export async function checkForUpdate() {
    const current = getAppVersion();
    const { source, origin } = getUpdateSource();

    if (!source) {
        return {
            configured: false,
            current,
            hasUpdate: false,
            source: '',
            sourceOrigin: origin,
            message: '尚未配置更新源'
        };
    }

    const loc = resolveManifestLocation(source);
    if (!loc) {
        return {
            configured: true,
            current,
            hasUpdate: false,
            source,
            sourceOrigin: origin,
            error: 'invalid_source',
            message: '更新源地址无效'
        };
    }

    try {
        const manifest = await readManifest(loc);
        const latestRelease = pickRelease(manifest);
        const hasUpdate = compareVersions(latestRelease.version, current) > 0;

        const result = {
            configured: true,
            current,
            latest: latestRelease.version,
            hasUpdate,
            mandatory: Boolean(latestRelease.mandatory) && hasUpdate,
            notes: latestRelease.notes,
            releasedAt: latestRelease.released_at,
            size: latestRelease.size,
            sha256: latestRelease.sha256,
            source,
            sourceOrigin: origin,
            checkedAt: new Date().toISOString(),
            message: hasUpdate ? `有新版本 ${latestRelease.version}` : '已是最新版本'
        };

        writeUpdateState(result);
        return result;
    } catch (e) {
        const result = {
            configured: true,
            current,
            hasUpdate: false,
            source,
            sourceOrigin: origin,
            checkedAt: new Date().toISOString(),
            error: e.code || 'update_failed',
            message: e.message || String(e)
        };
        writeUpdateState(result);
        return result;
    }
}

// ─────────────────────────────────────────────────
// 下载与校验
// ─────────────────────────────────────────────────

/**
 * 下载指定版本的包并校验 sha256。
 *
 * @param {string} version
 * @returns {Promise<{ version:string, path:string, sha256:string, size:number }>}
 */
export async function downloadUpdate(version) {
    // 先校验版本号格式再读清单：非法输入不该先跑一趟网络，
    // 也不该被报成「清单里没有这个版本」——那是两件完全不同的事。
    versionDir(version);

    const { source } = getUpdateSource();
    if (!source) throw fail('尚未配置更新源', 'not_configured');

    const loc = resolveManifestLocation(source);
    if (!loc) throw fail('更新源地址无效', 'invalid_source');

    const manifest = await readManifest(loc);
    const release = pickRelease(manifest, version);

    const dir = versionDir(release.version);
    ensureUpdateRoot();
    mkdirSync(dir, { recursive: true });
    const zipPath = join(dir, 'package.zip');
    const src = resolveReleaseUrl(loc, release.file);

    if (release.size > MAX_PACKAGE_BYTES) {
        throw fail(`包体积 ${release.size} 字节超出上限，已拒绝下载`, 'package_too_large');
    }

    // 先写临时文件，校验通过后再改名 —— 中途失败不会留下一个
    // 「看起来存在但内容不完整」的 package.zip。
    const tmpPath = `${zipPath}.part`;
    const hash = createHash('sha256');
    let written = 0;

    // 用 Transform 边落盘边哈希。
    //
    // 不能写成 `stream.on('data', ...)` 再 pipeline —— 挂上 data 监听会把流
    // 切到 flowing 模式，chunk 在 pipeline 接管之前就开始流出，
    // 结果就是「文件写完了但哈希少算了开头几块」，校验必然失败。
    const meter = new Transform({
        transform(chunk, _enc, cb) {
            written += chunk.length;
            if (written > MAX_PACKAGE_BYTES) {
                return cb(fail('包体积超出上限，已中止下载', 'package_too_large'));
            }
            hash.update(chunk);
            cb(null, chunk);
        }
    });

    try {
        if (src.kind === 'http') {
            let res;
            try {
                res = await fetch(src.url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
            } catch (e) {
                throw fail(`下载失败：${e && e.message ? e.message : e}`, 'download_failed');
            }
            if (!res.ok) throw fail(`下载返回 HTTP ${res.status}`, 'download_failed');
            await pipeline(Readable.fromWeb(res.body), meter, createWriteStream(tmpPath));
        } else {
            if (!existsSync(src.url)) throw fail(`包文件不存在：${src.url}`, 'download_failed');
            const st = statSync(src.url);
            if (st.size > MAX_PACKAGE_BYTES) throw fail('包体积超出上限', 'package_too_large');
            await pipeline(createReadStream(src.url), meter, createWriteStream(tmpPath));
        }
    } catch (e) {
        rmSync(tmpPath, { force: true });
        throw e;
    }

    const actual = hash.digest('hex');
    if (actual !== release.sha256) {
        // 校验失败必须**丢弃文件**而不是「重试一次」：
        // 哈希不一致意味着来源不可信（传输损坏或清单被改过），
        // 继续用它是把不可控内容装进用户机器。
        rmSync(tmpPath, { force: true });
        throw fail(
            `校验失败：清单声明 ${release.sha256.slice(0, 12)}…，实际 ${actual.slice(0, 12)}…。已丢弃下载的文件。`,
            'checksum_mismatch'
        );
    }

    rmSync(zipPath, { force: true });
    // 改名而不是复制：大包复制一遍等于多占一倍磁盘
    renameSync(tmpPath, zipPath);

    return { version: release.version, path: zipPath, sha256: actual, size: written };
}

// ─────────────────────────────────────────────────
// 解压与自检
// ─────────────────────────────────────────────────

/**
 * 解压到暂存目录。
 *
 * 防路径穿越：zip 条目里可以写 `../../evil.js`，直接 join 会把文件
 * 释放到暂存目录之外。必须逐条校验解析后的绝对路径仍在目标目录内。
 */
function extractZip(zipPath, outDir) {
    return new Promise((resolvePromise, rejectPromise) => {
        mkdirSync(outDir, { recursive: true });
        const root = resolvePath(outDir);
        let settled = false;
        const done = (fn, arg) => {
            if (settled) return;
            settled = true;
            fn(arg);
        };

        yauzl.open(zipPath, { lazyEntries: true, autoClose: true }, (err, zip) => {
            if (err) return done(rejectPromise, fail(`无法打开压缩包：${err.message}`, 'extract_failed'));

            zip.on('error', (e) => done(rejectPromise, fail(`解压失败：${e.message}`, 'extract_failed')));
            zip.on('end', () => done(resolvePromise));

            zip.readEntry();
            zip.on('entry', (entry) => {
                const rel = entry.fileName.replace(/\\/g, '/');

                // 绝对路径条目（C:/ 或 /x）一律拒绝
                if (rel.startsWith('/') || /^[A-Za-z]:/.test(rel)) {
                    return done(rejectPromise, fail(`压缩包含非法路径：${entry.fileName}`, 'extract_failed'));
                }

                const target = resolvePath(join(root, rel));
                if (target !== root && !target.startsWith(root + sep)) {
                    return done(rejectPromise, fail(`压缩包含路径穿越条目：${entry.fileName}`, 'extract_failed'));
                }

                if (/\/$/.test(rel)) {
                    mkdirSync(target, { recursive: true });
                    return zip.readEntry();
                }

                mkdirSync(dirname(target), { recursive: true });
                zip.openReadStream(entry, (e2, rs) => {
                    if (e2) return done(rejectPromise, fail(`读取压缩包条目失败：${e2.message}`, 'extract_failed'));
                    const ws = createWriteStream(target);
                    rs.on('error', (e3) => done(rejectPromise, fail(`写出失败：${e3.message}`, 'extract_failed')));
                    ws.on('error', (e3) => done(rejectPromise, fail(`写出失败：${e3.message}`, 'extract_failed')));
                    ws.on('close', () => {
                        if (!settled) zip.readEntry();
                    });
                    rs.pipe(ws);
                });
            });
        });
    });
}

/**
 * 在解压结果里定位「应用根目录」。
 *
 * 发布包的 zip 是多一层 `team-toolbox/` 的 —— 打包时压缩的是父目录，
 * 目的是让用户解压后得到一个干净的文件夹，而不是把一堆文件散在当前目录。
 * 但更新器要的是「含 backend/ frontend/ runtime/ 的那一层」。
 *
 * 两种布局都必须支持：
 *   平铺    <dir>/backend/...            （人工重打包时常见）
 *   套一层  <dir>/team-toolbox/backend/...
 *
 * 用「能找到 backend/src/index.js 的那层」来判定，而不是硬编码目录名 ——
 * 目录名以后可能改，文件结构不会。
 *
 * @param {string} dir
 * @returns {string|null}
 */
function findAppRoot(dir) {
    if (existsSync(join(dir, 'backend', 'src', 'index.js'))) return dir;

    let entries;
    try {
        entries = readdirSync(dir, { withFileTypes: true });
    } catch {
        return null;
    }

    const dirs = entries.filter((e) => e.isDirectory());
    if (dirs.length === 1) {
        const cand = join(dir, dirs[0].name);
        if (existsSync(join(cand, 'backend', 'src', 'index.js'))) return cand;
    }
    return null;
}

/**
 * 解压并做落地前自检。
 *
 * 自检用**包内自带的 node.exe** 跑 —— 这正是用户机器上的实际运行方式。
 * 用构建机的 node 去检查是无效的：v0.1.0 就是这么漏出去的，
 * 构建机（ABI 127）跑得好好的，用户机器（ABI 137）一加载就崩。
 *
 * @param {string} version
 * @returns {Promise<{ version:string, dir:string }>} dir 为应用根目录
 */
export async function stageUpdate(version) {
    const dir = versionDir(version);
    const zipPath = join(dir, 'package.zip');
    if (!existsSync(zipPath)) throw fail('尚未下载该版本的包', 'not_downloaded');

    const staged = join(dir, 'staged');
    // 清掉上次的解压结果，保证「包内容」与「清单声明」一致。
    //
    // 但清理失败不能让整个解压失败：暂存目录可能被杀毒软件扫描占着、
    // 被资源管理器打开着，或文件数量太多触发外部删除保护。
    // 这种情况下换一个全新的目录解压即可 —— 旧目录留着不影响正确性，
    // 只是占点磁盘，可以在升级成功后再清。
    let workDir = staged;
    try {
        if (existsSync(staged)) rmSync(staged, { recursive: true, force: true });
    } catch {
        workDir = join(dir, `staged-${Date.now()}`);
    }
    mkdirSync(workDir, { recursive: true });

    await extractZip(zipPath, workDir);

    const appRoot = findAppRoot(workDir);
    if (!appRoot) {
        throw fail(
            '包结构不正确：找不到 backend/src/index.js。' +
            '这不是一个可运行的程序包（可能是只含资源的包，或压缩方式不对）。',
            'package_invalid'
        );
    }

    const missing = REQUIRED_ENTRIES.filter((p) => !existsSync(join(appRoot, p)));
    if (missing.length > 0) {
        throw fail(`包结构不完整，缺少：${missing.join('、')}`, 'package_invalid');
    }

    // 原生模块自检：这是自动更新最容易埋雷的地方
    const checkResult = runStageSelfCheck(appRoot);
    if (!checkResult.ok) {
        throw fail(`包内运行时自检未通过：${checkResult.detail}`, 'self_check_failed');
    }

    // 用指针文件记录「这一次的应用根在哪」。
    // 不靠扫描 staged* 目录推断 —— 多目录共存时推断容易挑错，
    // 而装错目录的后果是替换掉一半文件。
    writeFileSync(join(dir, 'stage.json'), JSON.stringify({
        root: appRoot,
        stagedAt: new Date().toISOString()
    }, null, 2), 'utf8');

    return { version, dir: appRoot };
}

/** 读取已暂存版本的应用根目录（未暂存或结构不对返回 null）。 */
function stagedAppRootOrNull(version) {
    const dir = versionDir(version);
    try {
        const ptr = JSON.parse(readFileSync(join(dir, 'stage.json'), 'utf8'));
        const root = String(ptr.root || '');
        if (!root) return null;
        if (!existsSync(join(root, 'backend', 'src', 'index.js'))) return null;
        return findAppRoot(root);
    } catch {
        return null;
    }
}

/**
 * 用包内的 node.exe 跑包内的 check.js（若存在），否则最小化验证原生模块。
 */
function runStageSelfCheck(staged) {
    const nodeExe = join(staged, 'runtime', 'node.exe');
    const checkJs = join(staged, 'runtime', 'check.js');

    try {
        if (existsSync(checkJs)) {
            const r = spawnSync(nodeExe, [checkJs], { cwd: staged, encoding: 'utf8', timeout: 120_000 });
            if (r.status === 0) return { ok: true };
            return { ok: false, detail: (r.stderr || r.stdout || `退出码 ${r.status}`).trim().slice(0, 400) };
        }

        // 老版本包里可能没有 check.js，退回最小验证：
        // 只确认「包内 node 能加载包内 better-sqlite3 并开一个内存库」。
        const modPath = join(staged, 'backend', 'node_modules', 'better-sqlite3');
        const script = [
            `const m = require(${JSON.stringify(modPath)});`,
            "const db = new m(':memory:');",
            "db.exec('CREATE TABLE t(a)');",
            'db.close();'
        ].join('\n');
        const r = spawnSync(nodeExe, ['-e', script], { cwd: staged, encoding: 'utf8', timeout: 120_000 });
        if (r.status === 0) return { ok: true };
        return { ok: false, detail: (r.stderr || `退出码 ${r.status}`).trim().slice(0, 400) };
    } catch (e) {
        return { ok: false, detail: e && e.message ? e.message : String(e) };
    }
}

// ─────────────────────────────────────────────────
// 应用更新
// ─────────────────────────────────────────────────

/**
 * 备份用户数据（升级前的保险）。
 *
 * 复用全量备份能力：文档 + 文档图片 + 资源文件。
 * 升级出问题、迁移把数据改坏时，这是唯一的退路。
 */
async function backupBeforeUpdate(version) {
    const dir = versionDir(version);
    const out = join(dir, 'pre-update-backup.zip');
    const ws = createWriteStream(out);

    // exportFullBackup 把 res 当作可写流用（只监听 close、往里 pipe），
    // 因此可以直接传文件流，不必为备份再写一套归档逻辑。
    await exportFullBackup({ connection: getDefaultDatabase(), res: ws });
    await new Promise((r) => ws.on('close', r));
    return out;
}

/**
 * 生成 apply.cmd 的内容。
 *
 * 导出供验收脚本使用：这段脚本是「换文件 + 回滚」的全部逻辑，
 * 也是整个更新链路里唯一无法靠单元测试覆盖的部分（它有副作用且会重启服务）。
 * 把它做成纯函数，验收就能在隔离目录里真跑一遍换文件，而不动真实部署。
 *
 * @param {{ appRoot:string, staged:string, pid:number, logPath:string }} opts
 * @returns {string}
 */
export function buildApplyScript({ appRoot, staged, pid, logPath }) {
    // 用绝对路径：这个脚本从 data\updates\<ver>\ 下执行，
    // 而它要操作的是包根，相对路径容易算错。
    return `@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
set "APP=${appRoot}"
set "STAGED=${staged}"
set "LOG=${logPath}"
set "OLD_PID=${pid}"

echo [update] %DATE% %TIME% start >> "%LOG%"

rem ── 1. 等待旧进程退出 ──
rem 运行中的 node.exe 与 node_modules 无法被覆盖，必须等它彻底退出。
rem 按 PID 精确等待而不是「等所有 node.exe 消失」—— 用户可能同时开着
rem 别的 node 程序，按名字等会永远等不到。
rem
rem 延时用 ping 而不是 timeout /t：本脚本以「无控制台、stdin 被重定向」
rem 的方式启动，此时 timeout 会**立刻返回**而不是等满秒数 ——
rem 结果是验证循环一秒跑完 20 次，把「新版本还在启动中」误判成
rem 「启动失败」，触发一次本不该发生的回滚。ping 不依赖 stdin。
set /a TRIES=0
:wait
if %TRIES% GEQ 120 goto timeout
tasklist /FI "PID eq %OLD_PID%" /NH 2>nul | find /I "node.exe" >nul
if not errorlevel 1 (
    ping -n 2 127.0.0.1 >nul
    set /a TRIES+=1
    goto wait
)

rem ── 2. 确认暂存目录仍完好 ──
if not exist "%STAGED%\\backend\\src\\index.js" goto fail_staged
if not exist "%STAGED%\\runtime\\node.exe" goto fail_staged

rem ── 3. 保留当前版本用于回滚（排除 data，用户数据不参与换文件）──
if exist "%APP%\\data\\updates\\rollback" rmdir /s /q "%APP%\\data\\updates\\rollback"
robocopy "%APP%" "%APP%\\data\\updates\\rollback" /E /XD "%APP%\\data" /NFL /NDL /NJH /NJS /NP >> "%LOG%" 2>&1
if errorlevel 8 goto fail_backup

rem ── 4. 换文件 ──
rem 不用 /MIR：被删掉的文件残留在原地，比误删用户文件安全得多。
rem 排除 data 是硬要求 —— 那里是数据库、上传图片与资源文件。
robocopy "%STAGED%" "%APP%" /E /XD "%APP%\\data" /NFL /NDL /NJH /NJS /NP >> "%LOG%" 2>&1
if errorlevel 8 goto fail_copy

rem ── 5. 启动新版本 ──
rem 新版本启动成功后会自动删除 pending.json；标记还在说明没起来。
set TT_SKIP_BROWSER=1
start "" "%APP%\\启动.cmd"

rem ── 6. 等待新版本自证成功 ──
set /a WAIT=0
:verify
ping -n 4 127.0.0.1 >nul
set /a WAIT+=1
if not exist "%APP%\\data\\updates\\pending.json" goto success
if %WAIT% GEQ 20 goto rollback
goto verify

:success
echo [update] %DATE% %TIME% success >> "%LOG%"
del /q "%APP%\\data\\updates\\ROLLBACK.txt" 2>nul
rmdir /s /q "%APP%\\data\\updates\\rollback" 2>nul
exit /b 0

:rollback
echo [update] %DATE% %TIME% new version did not start, rolling back >> "%LOG%"
del /q "%APP%\\data\\updates\\pending.json" 2>nul
if not exist "%APP%\\data\\updates\\rollback\\backend\\src\\index.js" goto fail_norollback
robocopy "%APP%\\data\\updates\\rollback" "%APP%" /E /XD "%APP%\\data" /NFL /NDL /NJH /NJS /NP >> "%LOG%" 2>&1
echo [update] rolled back to previous version at %DATE% %TIME% >> "%APP%\\data\\updates\\ROLLBACK.txt"
set TT_SKIP_BROWSER=1
start "" "%APP%\\启动.cmd"
exit /b 2

:timeout
echo [update] timeout waiting for old process to exit >> "%LOG%"
exit /b 3

:fail_staged
echo [update] staged files missing >> "%LOG%"
exit /b 4

:fail_backup
echo [update] rollback snapshot failed, abort before touching files >> "%LOG%"
exit /b 5

:fail_copy
echo [update] copy failed, restoring previous version >> "%LOG%"
del /q "%APP%\\data\\updates\\pending.json" 2>nul
robocopy "%APP%\\data\\updates\\rollback" "%APP%" /E /XD "%APP%\\data" /NFL /NDL /NJH /NJS /NP >> "%LOG%" 2>&1
start "" "%APP%\\启动.cmd"
exit /b 6

:fail_norollback
echo [update] rollback snapshot missing, manual recovery needed >> "%LOG%"
exit /b 7
`;
}

/**
 * 执行更新：备份 → 写脚本 → 拉起独立进程 → 由调用方负责退出本进程。
 *
 * @param {object} opts
 * @param {string} opts.version
 * @returns {Promise<object>} 即将发生的动作描述
 */
export async function applyUpdate({ version }) {
    const dir = versionDir(version);
    const appRoot = stagedAppRootOrNull(version);
    if (!appRoot) {
        throw fail('更新包尚未解压或结构不正确，请先下载并解压', 'not_staged');
    }

    ensureUpdateRoot();

    const backupPath = await backupBeforeUpdate(version);

    // pending 标记：新版本启动时会删掉它。apply.cmd 靠它判断是否成功。
    writeFileSync(PENDING_FILE, JSON.stringify({
        from: getAppVersion(),
        to: version,
        started_at: new Date().toISOString(),
        backup: backupPath
    }, null, 2), 'utf8');

    const scriptPath = join(dir, 'apply.cmd');
    writeFileSync(scriptPath, buildApplyScript({
        appRoot: APP_ROOT,
        staged: appRoot,
        pid: process.pid,
        logPath: APPLY_LOG
    }), 'utf8');

    // 用 cmd 而不是 node 执行换文件：node.exe 自己就在被替换的目录里，
    // 它跑着就换不了自己。cmd 是系统进程，不受影响。
    const child = spawn('cmd.exe', ['/c', scriptPath], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true
    });
    child.unref();

    return {
        restarting: true,
        version,
        backup: backupPath,
        script: scriptPath,
        log: APPLY_LOG,
        from: getAppVersion()
    };
}

/**
 * 新版本启动成功后调用：删掉 pending 标记。
 *
 * 这就是「自动回滚」的握手信号。放在 listen 成功之后 ——
 * 迁移失败时进程会 exit(1)，标记留着，apply.cmd 就会回滚。
 *
 * @returns {object|null} 被清除的标记（说明本次是升级启动）
 */
export function confirmStartupOk() {
    const pending = readPending();
    if (!pending) return null;
    try {
        rmSync(PENDING_FILE, { force: true });
        return pending;
    } catch {
        return null;
    }
}

/** 读取 pending 标记（若存在，说明上次更新尚未确认成功）。 */
export function readPending() {
    try {
        if (!existsSync(PENDING_FILE)) return null;
        return JSON.parse(readFileSync(PENDING_FILE, 'utf8'));
    } catch {
        return null;
    }
}

/** 上次自动回滚的记录，供界面提示「更新未成功」。 */
export function readRollbackNotice() {
    try {
        if (!existsSync(ROLLBACK_MARKER)) return null;
        return readFileSync(ROLLBACK_MARKER, 'utf8').trim();
    } catch {
        return null;
    }
}

/** 更新相关状态汇总，供 /api/update/status 使用。 */
export function getUpdateSnapshot() {
    const { source, origin } = getUpdateSource();
    return {
        current: getAppVersion(),
        source,
        sourceOrigin: origin,
        configured: Boolean(source),
        lastCheck: readUpdateState(),
        pending: readPending(),
        rollback: readRollbackNotice(),
        updateRoot: UPDATE_ROOT
    };
}

/** 清除回滚提示（用户在界面上确认已知晓）。 */
export function clearRollbackNotice() {
    try {
        rmSync(ROLLBACK_MARKER, { force: true });
        return true;
    } catch {
        return false;
    }
}
