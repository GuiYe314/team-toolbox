import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { PassThrough, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { AdbError } from './android-adb-protocol.js';
import { validatePackageName } from './android-apps.js';

export const PERSISTENT_MAX_BYTES = 256 * 1024 * 1024;
export const PERSISTENT_PREVIEW_BYTES = 256 * 1024;
const fail = (code, message, status = 400) => new AdbError(code, message, status);
const cancelled = () => fail('cancelled', '文件操作已取消；若刚提交替换，请刷新并核对手机文件', 499);
const quote = value => "'" + String(value).replaceAll("'", "'\\''") + "'";

export function validatePersistentPath(value, empty = true) {
    if (typeof value !== 'string' || Buffer.byteLength(value) > 2048 || /[\x00-\x1f\x7f\\]/.test(value)
        || (!value && !empty) || value && (value.split('/').length > 16 || value.split('/').some(part =>
            !part || part === '.' || part === '..' || Buffer.byteLength(part) > 255 || part.startsWith('.toolbox-transfer-')))) {
        throw fail('invalid_input', '文件路径无效：只能选择当前应用目录内的普通文件或子目录');
    }
    return value;
}

function validateRequest(input, extra = [], requireUser = false) {
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['serial', 'packageName', 'path', 'userId', ...extra].includes(key))) throw fail('invalid_input', '文件操作参数无效');
    if (typeof input.serial !== 'string' || !/^[A-Za-z0-9_][A-Za-z0-9_.:-]{0,254}$/.test(input.serial)) throw fail('invalid_input', '请选择明确的在线设备');
    validatePackageName(input.packageName); validatePersistentPath(input.path);
    if ((requireUser || input.userId !== undefined) && (!Number.isInteger(input.userId) || input.userId < 0 || input.userId > 99999)) throw fail('invalid_input', '请重新读取应用目录后操作');
}

// Android 的 adb shell 会再次解释参数，必须连脚本与每个位置参数一起作 POSIX 字面量转义。
export const persistentShellCommand = (script, args) => ['sh', '-c', script, 'toolbox-persistent', ...args].map(quote).join(' ');
const shell = strings => String.raw(strings).replaceAll('@{', '${');
const GUARD = shell`
fail() { printf '%s' "$1" >&2; exit 42; }
base="$1"; rel="$2"; user="$3"
[ "$(am get-current-user)" = "$user" ] || fail DDP_USER_CHANGED
for p in "@{base%/Android/data/*}/Android" "@{base%/data/*}/data" "@{base%/files}" "$base"; do
    [ ! -L "$p" ] || fail DDP_LINK
done
[ -d "$base" ] && [ -r "$base" ] && [ -x "$base" ] || fail DDP_ACCESS
target="$base"
set -f; oldifs="$IFS"; IFS=/
for part in $rel; do target="$target/$part"; [ ! -L "$target" ] || fail DDP_LINK; done
IFS="$oldifs"; set +f
`;

export const PERSISTENT_SCRIPTS = Object.freeze({
    list: GUARD + shell`
[ -d "$target" ] && [ -r "$target" ] && [ -x "$target" ] || fail DDP_ACCESS
printf 'DDP1\000'; count=0
for file in "$target"/* "$target"/.[!.]* "$target"/..?*; do
    [ -e "$file" ] || [ -L "$file" ] || continue
    name="@{file##*/}"
    case "$name" in .toolbox-transfer-*) continue;; esac
    count=$((count + 1)); if [ "$count" -gt 1000 ]; then printf 'TRUNCATED\000'; break; fi
    kind=blocked; info='0:0:0'
    if [ ! -L "$file" ]; then
        if [ -d "$file" ]; then kind=directory; elif [ -f "$file" ]; then kind=file; fi
        if [ "$kind" != blocked ]; then info="$(stat -c '%s:%Y:%i' "$file")" || fail DDP_ACCESS; fi
    fi
    printf '%s\000%s\000%s\000' "$kind" "$info" "$name"
done
printf 'END\000'
`,
    inspect: GUARD + shell`
[ -f "$target" ] && [ -r "$target" ] || fail DDP_ACCESS
info="$(stat -c '%s:%Y:%i' "$target")" || fail DDP_ACCESS
hash="$(sha256sum "$target")" || fail DDP_UNSUPPORTED
printf 'DDP2\000%s\000%s\000' "$info" "@{hash%% *}"
`,
    read: GUARD + shell`
[ -f "$target" ] && [ -r "$target" ] || fail DDP_ACCESS
cat "$target" || fail DDP_ACCESS
`,
    prepare: GUARD + shell`
[ -d "$target" ] && [ -w "$target" ] || fail DDP_ACCESS
temp="$target/$4"
[ ! -e "$temp" ] && [ ! -L "$temp" ] || fail DDP_CONFLICT
(set -C; : > "$temp") || fail DDP_ACCESS
printf DDP_READY
`,
    commit: GUARD + shell`
temp="@{target%/*}/$4"; mode="$5"; expected="$6"; uploaded="$7"; size="$8"
[ ! -L "$temp" ] && [ -f "$temp" ] || fail DDP_ACCESS
[ "$(stat -c '%s' "$temp")" = "$size" ] || fail DDP_VERIFY
hash="$(sha256sum "$temp")" || fail DDP_UNSUPPORTED
[ "@{hash%% *}" = "$uploaded" ] || fail DDP_VERIFY
if [ "$mode" = replace ]; then
    [ -f "$target" ] && [ ! -L "$target" ] || fail DDP_CONFLICT
    old="$(sha256sum "$target")" || fail DDP_ACCESS
    [ "@{old%% *}" = "$expected" ] || fail DDP_CONFLICT
    mv -f "$temp" "$target" || fail DDP_ACCESS
else
    [ ! -e "$target" ] && [ ! -L "$target" ] || fail DDP_CONFLICT
    mv -n "$temp" "$target" || fail DDP_ACCESS
    [ ! -e "$temp" ] || fail DDP_CONFLICT
fi
printf DDP_OK
`,
    cleanup: GUARD + shell`
case "$4" in .toolbox-transfer-*) rm -f "$target/$4" || fail DDP_ACCESS;; *) fail DDP_ACCESS;; esac
printf DDP_CLEAN
`
});

export function parsePersistentListing(stdout) {
    const fields = String(stdout).split('\0');
    if (fields.shift() !== 'DDP1' || fields.pop() !== '' || fields.pop() !== 'END') throw fail('protocol_error', '设备未返回有效文件列表，请检查 Android 工具兼容性', 502);
    const truncated = fields.at(-1) === 'TRUNCATED'; if (truncated) fields.pop();
    if (fields.length % 3 || fields.length > 3000) throw fail('protocol_error', '设备文件列表格式或数量无效', 502);
    const entries = [], names = new Set(); let skipped = 0;
    for (let i = 0; i < fields.length; i += 3) {
        const [kind, stamp, name] = fields.slice(i, i + 3);
        if (!['directory', 'file', 'blocked'].includes(kind) || !/^\d+:\d+:\d+$/.test(stamp)) throw fail('protocol_error', '设备文件属性无效', 502);
        try { validatePersistentPath(name, false); if (name.includes('/')) throw new Error(); } catch { skipped++; continue; }
        const [size, modifiedAt] = stamp.split(':').map(Number);
        if (!Number.isSafeInteger(size) || !Number.isSafeInteger(modifiedAt) || names.has(name)) throw fail('protocol_error', '设备文件属性无效', 502);
        names.add(name); entries.push({ name, kind, size, modifiedAt });
    }
    entries.sort((a, b) => (a.kind === 'directory' ? 0 : 1) - (b.kind === 'directory' ? 0 : 1) || a.name.localeCompare(b.name));
    return { entries, truncated, skipped };
}

function remoteError(error) {
    if (['cancelled', 'timeout', 'output_limit', 'device_unavailable', 'not_configured', 'config_error'].includes(error.code)) return error;
    const text = String(error.message);
    if (text.includes('DDP_CONFLICT')) return fail('file_conflict', '目标文件已存在、已变化或已删除，请重新读取后确认', 409);
    if (text.includes('DDP_USER_CHANGED')) return fail('user_changed', 'Android 当前用户已切换，请重新读取应用目录', 409);
    if (text.includes('DDP_LINK')) return fail('unsafe_path', '此路径含符号链接，无法访问或替换', 400);
    if (text.includes('DDP_VERIFY')) return fail('verify_failed', '传送文件的大小或 SHA256 校验失败，未提交替换', 502);
    return fail('persistent_access', '无法访问应用文件：目录可能尚未创建、ADB 权限受限，或设备不支持所需文件命令。请先运行一次 App，并检查手机权限', 409);
}

/** 原始二进制以有界流保存，不用 UTF-8 runner 处理内容。 */
export async function streamPersistentFile(executable, args, file, { signal, maximum = PERSISTENT_MAX_BYTES, timeoutMs = 120000 } = {}) {
    if (signal?.aborted) throw cancelled();
    const child = spawn(executable, args, { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let bytes = 0, stderr = '', processError, timedOut = false;
    const hash = createHash('sha256');
    const abort = () => { child.kill('SIGKILL'); child.stdout.destroy(cancelled()); };
    signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => { timedOut = true; abort(); }, timeoutMs);
    const closed = new Promise(resolveClose => {
        child.once('error', () => { processError = fail('adb_failed', '无法启动 ADB 文件读取', 502); resolveClose(null); });
        child.once('close', resolveClose);
    });
    child.stderr.on('data', chunk => { if (stderr.length < 4096) stderr += chunk.toString('utf8').slice(0, 4096 - stderr.length); });
    const limiter = new Transform({ transform(chunk, _encoding, cb) {
        bytes += chunk.length;
        if (bytes > maximum) cb(fail('file_limit', '文件超过 256 MiB 读取限制', 413));
        else { hash.update(chunk); cb(null, chunk); }
    } });
    try {
        if (signal?.aborted) abort();
        await pipeline(child.stdout, limiter, createWriteStream(file, { flags: 'wx', mode: 0o600 }));
        const code = await closed;
        if (processError) throw processError;
        if (code !== 0) throw fail('adb_failed', stderr, 502);
        return { size: bytes, sha256: hash.digest('hex') };
    } catch (error) {
        child.kill('SIGKILL'); await closed;
        if (timedOut) throw fail('timeout', 'ADB 文件读取超时', 504);
        if (signal?.aborted) throw cancelled();
        throw error;
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}

async function receive(input, file, expected, signal) {
    let bytes = 0; const hash = createHash('sha256'), source = new PassThrough();
    const broken = () => source.destroy(fail('upload_failed', '文件上传中断', 400));
    input.on('error', broken); input.on('aborted', broken);
    try {
        const writing = pipeline(source, new Transform({ transform(chunk, _enc, cb) {
            bytes += chunk.length;
            if (bytes > expected || bytes > PERSISTENT_MAX_BYTES) cb(fail('file_limit', '文件上传大小与声明不符或超过 256 MiB', 413));
            else { hash.update(chunk); cb(null, chunk); }
        } }), createWriteStream(file, { flags: 'wx', mode: 0o600 }), { signal });
        input.pipe(source); await writing;
        if (bytes !== expected) throw fail('upload_failed', '文件上传不完整', 400);
        return hash.digest('hex');
    } finally { input.unpipe(source); input.removeListener('error', broken); input.removeListener('aborted', broken); source.destroy(); input.resume(); }
}

export function createAndroidPersistent({ run, readDevices, executable, binaryReader = streamPersistentFile, temporaryBase = tmpdir(), log = () => {}, timeoutMs = 300000 }) {
    let current;
    async function context(input, signal) {
        if (signal.aborted) throw cancelled();
        if (!(await readDevices(signal)).some(d => d.serial === input.serial && d.state === 'device')) throw fail('device_unavailable', '目标设备离线或未授权，请刷新设备', 409);
        const user = (await run(['-s', input.serial, 'shell', 'am', 'get-current-user'], { signal, timeoutMs: 5000, maxBytes: 1024 })).stdout.trim();
        if (!/^\d{1,5}$/.test(user)) throw fail('persistent_access', '无法确定设备当前 Android 用户', 409);
        if (input.userId !== undefined && input.userId !== Number(user)) throw fail('user_changed', 'Android 当前用户已切换，请重新读取目录', 409);
        const { stdout } = await run(['-s', input.serial, 'shell', 'pm', 'path', '--user', user, input.packageName], { signal, timeoutMs: 5000, maxBytes: 65536 });
        if (!/^package:\//m.test(stdout)) throw fail('app_unavailable', '所选应用未安装在当前 Android 用户中', 409);
        return { root: `/storage/emulated/${Number(user)}/Android/data/${input.packageName}/files`, userId: Number(user) };
    }
    async function remote(input, ctx, script, signal, path = input.path, args = []) {
        try { return await run(['-s', input.serial, 'shell', persistentShellCommand(script, [ctx.root, path, String(ctx.userId), ...args])], { signal, timeoutMs: 30000, maxBytes: 1024 * 1024 }); }
        catch (error) { throw remoteError(error); }
    }
    async function inspect(input, ctx, signal) {
        const { stdout } = await remote(input, ctx, PERSISTENT_SCRIPTS.inspect, signal);
        const match = /^DDP2\0(\d+):(\d+):(\d+)\0([a-f0-9]{64})\0$/.exec(stdout);
        if (!match || !Number.isSafeInteger(Number(match[1]))) throw fail('protocol_error', '文件校验信息无效', 502);
        return { ...ctx, path: input.path, size: Number(match[1]), modifiedAt: Number(match[2]), sha256: match[4] };
    }
    async function operation(input, signal, fn) {
        if (current) throw fail('busy', '另一个应用文件操作正在执行', 409);
        const controller = new AbortController(), abort = () => controller.abort(), item = current = { controller, serial: input.serial };
        signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort();
        let timedOut = false; const timer = setTimeout(() => { timedOut = true; abort(); }, timeoutMs);
        try { return await fn(controller.signal); }
        catch (error) {
            if (timedOut) throw fail('timeout', '应用文件操作超时，请刷新并核对手机文件', 504);
            if (controller.signal.aborted) throw cancelled();
            if (error instanceof AdbError) throw error;
            throw fail('file_failed', '文件处理失败，请检查连接、磁盘空间和权限', 500);
        } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); if (current === item) current = null; }
    }
    return {
        list(input, signal) {
            validateRequest(input);
            return operation(input, signal, async active => {
                const ctx = await context(input, active);
                return { ...ctx, path: input.path, ...parsePersistentListing((await remote(input, ctx, PERSISTENT_SCRIPTS.list, active)).stdout) };
            });
        },
        inspect(input, signal) {
            validateRequest(input, [], true); validatePersistentPath(input.path, false);
            return operation(input, signal, async active => inspect(input, await context(input, active), active));
        },
        read(input, signal, consume) {
            validateRequest(input, ['preview'], true); validatePersistentPath(input.path, false);
            if (input.preview !== undefined && typeof input.preview !== 'boolean') throw fail('invalid_input', '文件读取方式无效');
            return operation(input, signal, async active => {
                let directory;
                try {
                    const ctx = await context(input, active), meta = await inspect(input, ctx, active);
                    if (meta.size > (input.preview ? PERSISTENT_PREVIEW_BYTES : PERSISTENT_MAX_BYTES)) throw fail('file_limit', input.preview ? '文本预览最多 256 KiB，请下载文件查看' : '文件超过 256 MiB 下载限制', 413);
                    directory = await mkdtemp(join(temporaryBase, 'toolbox-persistent-')); const file = join(directory, 'content');
                    const result = await binaryReader(executable(), ['-s', input.serial, 'exec-out', persistentShellCommand(PERSISTENT_SCRIPTS.read, [ctx.root, input.path, String(ctx.userId)])], file, { signal: active, maximum: input.preview ? PERSISTENT_PREVIEW_BYTES : PERSISTENT_MAX_BYTES });
                    if (result.sha256 !== meta.sha256 || result.size !== meta.size) throw fail('file_conflict', '读取期间文件发生变化，请重试', 409);
                    if (active.aborted) throw cancelled();
                    if (!input.preview) return await consume({ ...meta, file, fileName: input.path.split('/').at(-1) });
                    const data = await readFile(file); let text;
                    try { text = new TextDecoder('utf-8', { fatal: true }).decode(data); if (text.includes('\0')) throw new Error(); }
                    catch { throw fail('binary_file', '此文件不是 UTF-8 文本，请下载后使用对应软件查看', 415); }
                    return { ...meta, text };
                } catch (error) { if (error.code === 'adb_failed') throw remoteError(error); throw error; }
                finally { if (directory) await rm(directory, { recursive: true, force: true }).catch(() => log({ action: 'persistent_cleanup', ok: false })); }
            });
        },
        upload(input, stream, signal) {
            validateRequest(input, ['mode', 'size', 'confirm', 'expectedHash'], true); validatePersistentPath(input.path, false);
            if (input.confirm !== true) throw fail('confirmation_required', '请核对设备、应用和目标文件后确认写入');
            if (!['add', 'replace'].includes(input.mode) || !Number.isSafeInteger(input.size) || input.size < 0) throw fail('invalid_input', '文件写入方式或大小无效');
            if (input.size > PERSISTENT_MAX_BYTES) throw fail('file_limit', '文件超过 256 MiB 上传限制', 413);
            if (input.mode === 'replace' ? !/^[a-f0-9]{64}$/.test(input.expectedHash || '') : input.expectedHash !== undefined) throw fail('invalid_input', '替换前请重新读取目标文件的校验信息');
            return operation(input, signal, async active => {
                let directory, ctx, tempName; const parent = input.path.includes('/') ? input.path.slice(0, input.path.lastIndexOf('/')) : '';
                try {
                    ctx = await context(input, active);
                    if (input.mode === 'replace' && (await inspect(input, ctx, active)).sha256 !== input.expectedHash) throw fail('file_conflict', '目标文件已变化，请重新读取后确认', 409);
                    directory = await mkdtemp(join(temporaryBase, 'toolbox-persistent-')); const file = join(directory, 'content');
                    const hash = await receive(stream, file, input.size, active);
                    await context(input, active);
                    tempName = '.toolbox-transfer-' + randomUUID();
                    if ((await remote(input, ctx, PERSISTENT_SCRIPTS.prepare, active, parent, [tempName])).stdout !== 'DDP_READY') throw fail('protocol_error', '设备未确认临时文件准备完成', 502);
                    try { await run(['-s', input.serial, 'push', file, `${ctx.root}/${parent ? parent + '/' : ''}${tempName}`], { signal: active, timeoutMs: 120000, maxBytes: 65536, secrets: [file, directory] }); }
                    catch (error) { throw remoteError(error); }
                    const committed = await remote(input, ctx, PERSISTENT_SCRIPTS.commit, active, input.path, [tempName, input.mode, input.expectedHash || '', hash, String(input.size)]);
                    if (committed.stdout !== 'DDP_OK') throw fail('protocol_error', '未收到文件提交确认，请刷新并核对手机文件', 502);
                    tempName = null;
                    return { message: input.mode === 'replace' ? '文件替换成功' : '文件添加成功', path: input.path, size: input.size, sha256: hash, userId: ctx.userId };
                } finally {
                    if (ctx && tempName) {
                        try { await remote(input, ctx, PERSISTENT_SCRIPTS.cleanup, AbortSignal.timeout(5000), parent, [tempName]); }
                        catch { log({ action: 'persistent_remote_cleanup', ok: false }); }
                    }
                    if (directory) await rm(directory, { recursive: true, force: true }).catch(() => log({ action: 'persistent_cleanup', ok: false }));
                }
            });
        },
        dispose() { current?.controller.abort(); },
        stopDevice(serial) { if (current?.serial === serial) current.controller.abort(); }
    };
}
