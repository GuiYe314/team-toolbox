// 自动更新的测试。
//
// 重点不在「能装成功」，而在**装不成功时会不会把用户的机器弄坏**：
//   - 哈希不对 → 必须丢弃，不能「凑合用」
//   - 压缩包带 ../ → 必须拒绝，不能释放到目录外
//   - 包结构不全 / 原生模块 ABI 不对 → 必须在动文件之前失败
//
// 这些路径平时不会被走到，但一旦走到就是不可逆的损失。
//
// 注意：本文件全部用动态 import。因为 UPDATE_ROOT 在模块加载时由
// TT_UPDATE_DIR 环境变量决定，必须先设好环境变量再加载模块 ——
// 静态 import 会被提升到文件顶部，环境变量来不及生效。

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
    copyFileSync,
    createWriteStream,
    existsSync,
    mkdtempSync,
    mkdirSync,
    readFileSync,
    rmSync,
    writeFileSync
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { crc32 } from 'node:zlib';
import archiver from 'archiver';

const TMP = mkdtempSync(join(tmpdir(), 'tt-updater-'));
const UPDATES = join(TMP, 'updates');
const SOURCE = join(TMP, 'source');

process.env.TT_UPDATE_DIR = UPDATES;
process.env.UPDATE_SOURCE = SOURCE;

const { compareVersions, getAppVersion } = await import('./version.js');
const updater = await import('./updater.js');
const updateSource = await import('./update-source.js');

function sha256Of(path) {
    return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/** 造一个 zip。entries 为 { '包内路径': '文本内容' } 或 { '包内路径': {file: '本地路径'} }。 */
function makeZip(outPath, entries) {
    return new Promise((resolvePromise, rejectPromise) => {
        const ws = createWriteStream(outPath);
        const archive = archiver('zip', { zlib: { level: 1 } });
        ws.on('close', () => resolvePromise());
        archive.on('error', rejectPromise);
        archive.pipe(ws);
        for (const [name, val] of Object.entries(entries)) {
            if (typeof val === 'string') archive.append(val, { name });
            else archive.file(val.file, { name });
        }
        archive.finalize();
    });
}

/**
 * 手写一个只含单条目的 ZIP（STORE，不压缩），条目名原样写入。
 *
 * 为什么不用 archiver：它会把 `../../escaped.txt` 规范化成 `escaped.txt`，
 * 造不出路径穿越的攻击样本 —— 而这条防护正是最需要被真实验证的。
 *
 * @param {string} outPath
 * @param {string} name 条目名（原样，不做任何处理）
 * @param {string} data 条目内容
 */
function makeRawZip(outPath, name, data) {
    const nameBuf = Buffer.from(name, 'utf8');
    const dataBuf = Buffer.from(data, 'utf8');
    const crc = crc32(dataBuf) >>> 0;
    const dataLen = dataBuf.length;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(dataLen, 18);
    local.writeUInt32LE(dataLen, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(dataLen, 20);
    central.writeUInt32LE(dataLen, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(0, 42);

    const cdOffset = 30 + nameBuf.length + dataLen;
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(0, 4);
    eocd.writeUInt16LE(0, 6);
    eocd.writeUInt16LE(1, 8);
    eocd.writeUInt16LE(1, 10);
    eocd.writeUInt32LE(46 + nameBuf.length, 12);
    eocd.writeUInt32LE(cdOffset, 16);
    eocd.writeUInt16LE(0, 20);

    writeFileSync(outPath, Buffer.concat([local, nameBuf, dataBuf, central, nameBuf, eocd]));
}

/** 写一份 manifest.json 到更新源目录。 */
function writeManifest(releases, extra = {}) {
    mkdirSync(SOURCE, { recursive: true });
    writeFileSync(join(SOURCE, 'manifest.json'), JSON.stringify({
        schema: 1,
        ...extra,
        releases
    }, null, 2), 'utf8');
}

/** 生成一个「结构完整」的包内容（node.exe 用小文件代替，够结构校验用）。 */
function structuralEntries() {
    return {
        'backend/src/index.js': '// dummy',
        'backend/package.json': JSON.stringify({ name: 'team-toolbox-backend', version: '9.9.9' }),
        'backend/node_modules/better-sqlite3/package.json': JSON.stringify({ name: 'better-sqlite3', version: '11.10.0' }),
        'frontend/dist/index.html': '<!doctype html><title>x</title>',
        'runtime/node.exe': 'not-a-real-binary'
    };
}

before(async () => {
    mkdirSync(UPDATES, { recursive: true });
    mkdirSync(SOURCE, { recursive: true });
});

after(() => {
    try { rmSync(TMP, { recursive: true, force: true }); } catch { /* 忽略 */ }
});

// ─────────────────────────────────────────────────

describe('版本比较', () => {
    test('按数字而非字符串比较', () => {
        assert.ok(compareVersions('0.1.10', '0.1.9') > 0, '0.1.10 应大于 0.1.9');
        assert.ok(compareVersions('0.2.0', '0.1.99') > 0);
        assert.equal(compareVersions('1.2.3', '1.2.3'), 0);
    });

    test('正式版高于同号预发布版', () => {
        assert.ok(compareVersions('1.0.0', '1.0.0-rc.1') > 0);
        assert.ok(compareVersions('1.0.0-rc.2', '1.0.0-rc.1') > 0);
    });

    test('允许 v 前缀与不同位宽', () => {
        assert.equal(compareVersions('v1.2.3', '1.2.3'), 0);
        assert.equal(compareVersions('1.2', '1.2.0'), 0);
    });
});

describe('清单校验', () => {
    test('缺少 sha256 的条目被拒绝', async () => {
        writeManifest([{ version: '9.9.9', file: 'x.zip' }]);
        const r = await updater.checkForUpdate();
        assert.equal(r.error, 'manifest_invalid');
        assert.match(r.message, /sha256/);
    });

    test('schema 不匹配被拒绝', async () => {
        mkdirSync(SOURCE, { recursive: true });
        writeFileSync(join(SOURCE, 'manifest.json'), JSON.stringify({ schema: 99, releases: [] }), 'utf8');
        const r = await updater.checkForUpdate();
        assert.equal(r.error, 'manifest_invalid');
    });

    test('更新源不存在时给出可读错误而不是抛异常', async () => {
        process.env.UPDATE_SOURCE = join(TMP, 'no-such-dir');
        const r = await updater.checkForUpdate();
        assert.equal(r.error, 'source_unreachable');
        assert.match(r.message, /manifest\.json/);
        process.env.UPDATE_SOURCE = SOURCE;
    });
});

describe('检查更新', () => {
    test('更高版本 → hasUpdate', async () => {
        const zip = join(SOURCE, 'pkg.zip');
        await makeZip(zip, structuralEntries());
        writeManifest([{
            version: '9.9.9',
            file: 'pkg.zip',
            sha256: sha256Of(zip),
            size: 123,
            notes: '测试版本'
        }]);

        const r = await updater.checkForUpdate();
        assert.equal(r.hasUpdate, true);
        assert.equal(r.latest, '9.9.9');
        assert.equal(r.current, getAppVersion());
        assert.equal(r.notes, '测试版本');
    });

    test('同版本 → 不提示更新', async () => {
        const zip = join(SOURCE, 'pkg.zip');
        const current = getAppVersion();
        writeManifest([{
            version: current,
            file: 'pkg.zip',
            sha256: sha256Of(zip)
        }]);

        const r = await updater.checkForUpdate();
        assert.equal(r.hasUpdate, false);
        assert.equal(r.message, '已是最新版本');
    });

    test('更低版本 → 不提示更新（防止发布失误导致降级）', async () => {
        const zip = join(SOURCE, 'pkg.zip');
        writeManifest([{
            version: '0.0.1',
            file: 'pkg.zip',
            sha256: sha256Of(zip)
        }]);

        const r = await updater.checkForUpdate();
        assert.equal(r.hasUpdate, false);
    });

    test('检查结果写入缓存，便于首屏直接展示', async () => {
        await updater.checkForUpdate();
        const st = updateSource.readUpdateState();
        assert.ok(st, '应写入 state.json');
        assert.ok(st.checkedAt);
    });
});

describe('下载与校验', () => {
    test('哈希一致 → 落地成功', async () => {
        const zip = join(SOURCE, 'ok.zip');
        await makeZip(zip, structuralEntries());
        writeManifest([{ version: '9.9.8', file: 'ok.zip', sha256: sha256Of(zip) }]);

        const r = await updater.downloadUpdate('9.9.8');
        assert.equal(r.sha256, sha256Of(zip));
        assert.ok(existsSync(r.path));
        assert.ok(r.size > 0);
    });

    test('哈希不一致 → 抛错且不留下任何包文件', async () => {
        const zip = join(SOURCE, 'bad.zip');
        await makeZip(zip, structuralEntries());
        writeManifest([{
            version: '9.9.7',
            file: 'bad.zip',
            sha256: 'a'.repeat(64)
        }]);

        await assert.rejects(
            () => updater.downloadUpdate('9.9.7'),
            (err) => {
                assert.equal(err.code, 'checksum_mismatch');
                assert.match(err.message, /已丢弃/);
                return true;
            }
        );

        // 关键：既不能留下 package.zip，也不能留下 .part 半成品
        assert.equal(existsSync(join(UPDATES, '9.9.7', 'package.zip')), false);
        assert.equal(existsSync(join(UPDATES, '9.9.7', 'package.zip.part')), false);
    });

    test('版本号带路径穿越 → 拒绝', async () => {
        await assert.rejects(
            () => updater.downloadUpdate('../../evil'),
            (err) => err.code === 'invalid_input'
        );
    });

    test('清单里没有该版本 → not_found', async () => {
        await assert.rejects(
            () => updater.downloadUpdate('1.2.3'),
            (err) => err.code === 'not_found'
        );
    });
});

describe('解压与自检', () => {
    test('包结构不全 → package_invalid，且失败发生在动文件之前', async () => {
        const zip = join(SOURCE, 'partial.zip');
        const entries = structuralEntries();
        delete entries['runtime/node.exe'];
        await makeZip(zip, entries);
        writeManifest([{ version: '9.9.6', file: 'partial.zip', sha256: sha256Of(zip) }]);

        await updater.downloadUpdate('9.9.6');
        await assert.rejects(
            () => updater.stageUpdate('9.9.6'),
            (err) => {
                assert.equal(err.code, 'package_invalid');
                assert.match(err.message, /runtime\/node\.exe/);
                return true;
            }
        );
    });

    test('压缩包含路径穿越条目 → extract_failed', async () => {
        const zip = join(SOURCE, 'slip.zip');
        // 条目名原样是 ../../escaped.txt，解压后应落在暂存目录之外
        makeRawZip(zip, '../../escaped.txt', 'should never be written');
        writeManifest([{ version: '9.9.5', file: 'slip.zip', sha256: sha256Of(zip) }]);

        await updater.downloadUpdate('9.9.5');
        await assert.rejects(
            () => updater.stageUpdate('9.9.5'),
            (err) => {
                assert.equal(err.code, 'extract_failed');
                // 实际拦截发生在 yauzl（它的 validateEntrySizes/名字校验会先拒掉），
                // 我们自己的路径校验是第二道。两层任一生效即可，
                // 所以这里只断言「被拒绝了」，不锁死某一层的文案。
                assert.match(err.message, /路径穿越|invalid relative path/);
                return true;
            }
        );

        // 关键断言：真的没被释放到上层目录
        assert.equal(existsSync(join(UPDATES, 'escaped.txt')), false);
        assert.equal(existsSync(join(TMP, 'escaped.txt')), false);
    });

    test('包内运行时自检失败 → self_check_failed', async () => {
        const zip = join(SOURCE, 'badbin.zip');
        // runtime/node.exe 是假文件，执行必然失败 —— 正是「ABI 不对装完起不来」的模型
        await makeZip(zip, structuralEntries());
        writeManifest([{ version: '9.9.4', file: 'badbin.zip', sha256: sha256Of(zip) }]);

        await updater.downloadUpdate('9.9.4');
        await assert.rejects(
            () => updater.stageUpdate('9.9.4'),
            (err) => err.code === 'self_check_failed'
        );
    });

    test('包内运行时可用 → 暂存成功', async () => {
        const zip = join(SOURCE, 'good.zip');
        // 用当前真实 node.exe 当包内运行时，配一个直接通过的 check.js
        const nodeCopy = join(TMP, 'node.exe');
        copyFileSync(process.execPath, nodeCopy);

        await makeZip(zip, {
            ...structuralEntries(),
            'runtime/node.exe': { file: nodeCopy },
            'runtime/check.js': "console.log('[check] ok');\n"
        });
        writeManifest([{ version: '9.9.3', file: 'good.zip', sha256: sha256Of(zip) }]);

        await updater.downloadUpdate('9.9.3');
        const r = await updater.stageUpdate('9.9.3');
        assert.equal(r.version, '9.9.3');
        assert.ok(existsSync(join(r.dir, 'backend', 'src', 'index.js')));
    });

    test('未下载就暂存 → not_downloaded', async () => {
        await assert.rejects(
            () => updater.stageUpdate('9.9.2'),
            (err) => err.code === 'not_downloaded'
        );
    });

    test('包内多一层目录（真实发布包的样子）也能定位到应用根', async () => {
        // 真实发布包的 zip 里是 team-toolbox/backend/... ——
        // 打包脚本压缩的是父目录，好让用户解压后得到一个干净文件夹。
        // 更新器必须兼容这一层，否则「包看着没问题，一解压就说结构不对」。
        const zip = join(SOURCE, 'nested.zip');
        const nodeCopy = join(TMP, 'node2.exe');
        copyFileSync(process.execPath, nodeCopy);

        const inner = {};
        for (const [k, v] of Object.entries(structuralEntries())) {
            inner[`team-toolbox/${k}`] = v;
        }
        inner['team-toolbox/runtime/node.exe'] = { file: nodeCopy };
        inner['team-toolbox/runtime/check.js'] = "console.log('ok');\n";

        await makeZip(zip, inner);
        writeManifest([{ version: '9.9.0', file: 'nested.zip', sha256: sha256Of(zip) }]);

        await updater.downloadUpdate('9.9.0');
        const r = await updater.stageUpdate('9.9.0');
        assert.ok(r.dir.endsWith('team-toolbox'), `应定位到内层目录，实际 ${r.dir}`);
        assert.ok(existsSync(join(r.dir, 'backend', 'src', 'index.js')));
    });

    test('根本不是程序包的 zip → package_invalid', async () => {
        const zip = join(SOURCE, 'notapp.zip');
        await makeZip(zip, { 'readme.txt': 'just some files' });
        writeManifest([{ version: '9.8.9', file: 'notapp.zip', sha256: sha256Of(zip) }]);

        await updater.downloadUpdate('9.8.9');
        await assert.rejects(
            () => updater.stageUpdate('9.8.9'),
            (err) => {
                assert.equal(err.code, 'package_invalid');
                assert.match(err.message, /backend\/src\/index\.js/);
                return true;
            }
        );
    });
});

describe('换文件脚本（apply.cmd）', () => {
    const script = updater.buildApplyScript({
        appRoot: 'C:\\app',
        staged: 'C:\\app\\data\\updates\\9.9.9\\staged\\team-toolbox',
        pid: 4321,
        logPath: 'C:\\app\\data\\updates\\apply.log'
    });

    test('必须是 CRLF 换行', () => {
        // 这条不是风格问题：cmd.exe 解析纯 LF 的批处理文件会把相邻行粘在一起，
        // 报出一堆「不是内部或外部命令」。而且这个错误只在真实触发时暴露 ——
        // 在 Git Bash 里手工 cmd //c 跑同一个文件可能看着正常。
        assert.ok(script.includes('\r\n'), '完全没有 CRLF');
        assert.equal(
            script.replace(/\r\n/g, '').includes('\n'),
            false,
            '存在裸 LF —— cmd.exe 会把相邻行粘在一起'
        );
    });

    test('除启动器文件名外必须是纯 ASCII', () => {
        // Windows 中文系统控制台默认 OEM 代码页，UTF-8 中文会把 rem 行
        // 按字节错切成几条「命令」去执行 —— 除非文件带 BOM（由调用方添加）。
        //
        // 唯一允许出现的中文是 `启动.cmd` 这个文件名本身：它由打包脚本生成，
        // 改不了。因此把它剥掉之后，其余内容必须全为 ASCII。
        const stripped = script.split('启动.cmd').join('<LAUNCHER>');
        const bad = [...stripped].filter((c) => c.charCodeAt(0) > 127);
        assert.equal(bad.length, 0, `含非 ASCII 字符: ${JSON.stringify(bad.slice(0, 8))}`);
    });

    test('关键步骤都在脚本里', () => {
        // 换文件时排除 data：用户数据永不参与替换
        assert.match(script, /robocopy "%STAGED%" "%APP%" \/E \/XD "%APP%\\data"/);
        // 回滚快照也排除 data
        assert.match(script, /robocopy "%APP%" "%APP%\\data\\updates\\rollback" \/E \/XD "%APP%\\data"/);
        // 延时必须用 ping（timeout 在无控制台环境立刻返回，会误判回滚）
        assert.match(script, /ping -n 4 127\.0\.0\.1 >nul/);
        assert.equal(/timeout \/t/.test(script), false, '不应再使用 timeout /t');
        // 三个终止分支都要存在
        ['success', 'rollback', 'fail_norollback'].forEach((label) => {
            assert.ok(script.includes(`:${label}`), `缺少 :${label} 分支`);
        });
    });

    test('路径被写进脚本时保持绝对形式', () => {
        assert.ok(script.includes('set "APP=C:\\app"'));
        assert.ok(script.includes('set "OLD_PID=4321"'));
    });
});

describe('安装前置条件', () => {
    test('未暂存就安装 → not_staged，且不会写 pending 标记', async () => {
        await assert.rejects(
            () => updater.applyUpdate({ version: '9.9.1' }),
            (err) => err.code === 'not_staged'
        );
        assert.equal(updater.readPending(), null, '失败时不应留下 pending 标记');
    });
});

describe('更新源配置', () => {
    test('拒绝 FTP 等不受支持的协议', () => {
        assert.equal(updateSource.classifySource('ftp://x/y').kind, 'invalid');
        assert.equal(updateSource.classifySource('ftp://x/y').reason, 'unsupported_scheme');
    });

    test('目录型地址自动补 manifest.json', () => {
        const http = updateSource.resolveManifestLocation('https://example.com/tb');
        assert.equal(http.url, 'https://example.com/tb/manifest.json');

        const asFile = updateSource.resolveManifestLocation('https://example.com/tb/manifest.json');
        assert.equal(asFile.url, 'https://example.com/tb/manifest.json');
    });

    test('写入非法地址被拒绝', () => {
        assert.throws(() => updateSource.setUpdateSource('ftp://x'), (e) => e.code === 'invalid_input');
    });

    test('环境变量优先于配置文件', () => {
        process.env.UPDATE_SOURCE = 'https://env.example.com/m.json';
        updateSource.setUpdateSource('https://file.example.com/m.json');
        const r = updateSource.getUpdateSource();
        assert.equal(r.origin, 'env');
        assert.equal(r.source, 'https://env.example.com/m.json');
        process.env.UPDATE_SOURCE = SOURCE;
    });
});
