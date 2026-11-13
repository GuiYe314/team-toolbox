import { readdir, lstat, realpath, rm, mkdir, rename, copyFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { join, basename, dirname, extname, resolve, isAbsolute } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { randomUUID, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { appRoot, fields, problem, detectExecutable, executablePath, executableSource, runIntegrationProcess } from './integration-common.js';
import { resolveVideo, listResolvers } from './video-resolvers.js';
import { createProxyFetch, normalizeProxy, proxyArgs, readSystemProxy, resolveProxy } from './video-proxy.js';

const MiB = 1024 * 1024;
const baseArgs = ['--ignore-config', '--no-plugin-dirs', '--no-playlist', '--no-warnings', '--no-cache-dir', '--socket-timeout', '20', '--retries', '1', '--extractor-retries', '1'];
// 代理放在基础参数里统一注入：Node 的 fetch 与 yt-dlp 都不读系统代理，缺了它内外网行为会和浏览器不一致。
const commonArgsFor = proxy => [...baseArgs, ...proxyArgs(proxy)];
// 新版yt-dlp的EJS解析复用当前Node，不依赖用户PATH或自动获取远程组件。
const runtimeArgs = tools => tools.version.slice(0, 10) >= '2025.11.12' ? ['--no-js-runtimes', '--js-runtimes', `node:${process.execPath}`, '--no-remote-components'] : [];
const mediaExtensions = new Set(['.mp4', '.webm', '.mkv', '.mov', '.m4a', '.mp3', '.ogg', '.opus', '.flv', '.avi', '.wav']);
const activeStates = new Set(['queued', 'running']);
const progressTemplate = 'download:TOOLBOX_PROGRESS|%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.speed)s|%(progress.eta)s';

export function videoUrl(value) {
    if (typeof value !== 'string' || value.length > 2048 || /[\s\x00-\x1f\\]/.test(value)) throw problem('invalid_url', '请输入单个完整的视频网页链接');
    let url;
    try { url = new URL(value); } catch { throw problem('invalid_url', '视频链接格式无效'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || /^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[)/i.test(url.hostname) || url.hostname.endsWith('.local')) throw problem('invalid_url', '只支持公开 HTTP/HTTPS 视频网页链接');
    url.hash = '';
    return url.href;
}

export function videoChoices(info, hasFfmpeg) {
    const formats = (Array.isArray(info.formats) ? info.formats.slice(0, 3000) : []).filter(item => item && typeof item === 'object');
    // vcodec 缺失（部分 HLS 清单）不代表没有画面，按可用处理；明确 none 的才是纯音频。
    const usable = formats.filter(item => !item.vcodec || item.vcodec !== 'none');
    const heights = [...new Set(usable.filter(item => hasFfmpeg || item.acodec && item.acodec !== 'none').map(item => item.height).filter(h => Number.isInteger(h) && h >= 100 && h <= 8640))].sort((a, b) => b - a).slice(0, 8);
    const choices = heights.map(height => {
        const best = usable.filter(item => item.height === height).sort((a, b) => (Number(b.tbr) || 0) - (Number(a.tbr) || 0))[0] || {};
        const fps = Number(best.fps);
        return { id: `video-${height}`, label: `${height}p${fps >= 50 ? Math.round(fps) : ''}${hasFfmpeg ? ' · 合并为 MP4' : ' · 含音轨格式'}`, args: hasFfmpeg ? ['-f', `bv*[height<=${height}]+ba/b[height<=${height}]`, '--merge-output-format', 'mp4'] : ['-f', `b[height<=${height}]`] };
    });
    if (!choices.length) choices.push({ id: 'video-best', label: hasFfmpeg ? '最佳画质 · MP4' : '最佳含音轨格式', args: hasFfmpeg ? ['-f', 'bv*+ba/b', '--merge-output-format', 'mp4'] : ['-f', 'b'] });
    if (hasFfmpeg) choices.push({ id: 'audio-mp3', label: '仅音频 · MP3', args: ['-f', 'ba/b', '-x', '--audio-format', 'mp3', '--audio-quality', '0'] });
    return choices;
}

/** 用资源管理器定位文件；失败不影响下载结果。 */
export function revealFile(path) {
    const [command, args] = process.platform === 'win32' ? ['explorer.exe', [`/select,${path}`]]
        : process.platform === 'darwin' ? ['open', ['-R', path]] : ['xdg-open', [dirname(path)]];
    try {
        const child = spawn(command, args, { windowsHide: true, shell: false, detached: true, stdio: 'ignore' });
        child.on('error', () => {});
        child.unref();
    } catch { /* 没有桌面环境时忽略 */ }
}

function deferred() {
    let resolveTask, rejectTask;
    const promise = new Promise((ok, fail) => { resolveTask = ok; rejectTask = fail; });
    // 任务式调用方不一定会等待结果，这里先兜住拒绝，避免未处理拒绝拖垮进程。
    promise.catch(() => {});
    return { promise, resolve: resolveTask, reject: rejectTask };
}

function safeName(title, extension) {
    const stem = String(title || '').replace(/[\x00-\x1f<>:"/\\|?*]/g, '_').replace(/[. ]+$/g, '').trim().slice(0, 100) || 'video';
    return stem + extension;
}

async function directoryBytes(directory) {
    try {
        let bytes = 0;
        for (const name of (await readdir(directory)).slice(0, 200)) {
            try { bytes += (await lstat(join(directory, name))).size; } catch { /* 合并期间可能瞬时消失 */ }
        }
        return bytes;
    } catch { return 0; }
}

async function uniquePath(directory, name) {
    const extension = extname(name), stem = basename(name, extension);
    for (let index = 1; index < 100; index++) {
        const candidate = join(directory, index === 1 ? name : `${stem} (${index})${extension}`);
        try { await lstat(candidate); } catch { return candidate; }
    }
    return join(directory, `${stem} (${Date.now()})${extension}`);
}

async function moveFile(source, target) {
    try { await rename(source, target); return; }
    catch (error) { if (!['EXDEV', 'EPERM', 'EACCES'].includes(error.code)) throw error; }
    // 跨盘时退回复制 + 删除，并校验字节数一致。
    await copyFile(source, target);
    const from = await lstat(source), to = await lstat(target);
    if (from.size !== to.size) { await rm(target, { force: true }); throw problem('save_failed', '复制到下载目录后大小不一致，已保留临时文件', 500); }
    await rm(source, { force: true });
}

export function createYoinksService({ config, runner = runIntegrationProcess, detector = detectExecutable, fetchImpl = globalThis.fetch, proxyResolver = resolveProxy, fetchFactory = createProxyFetch, componentRoot = appRoot, temporaryRoot = tmpdir(), cacheRoot = '', defaultDownloadDir = join(homedir(), 'Downloads'), now = Date.now, retentionMs = 10 * 60 * 1000, maxConcurrent = 3, stallMs = 5 * 60 * 1000, taskLimit = 50, pruneMs = 24 * 60 * 60 * 1000, reveal = revealFile } = {}) {
    const cacheDirectory = cacheRoot || join(temporaryRoot, 'toolbox-video-cache');
    const probes = new Map(), results = new Map(), jobs = new Map(), waiting = [], active = new Set();
    let analyzing = false, disposed = false;

    async function tools() {
        const value = await config.read();
        // 设置里保存的路径可能已经被删掉或换了盘：此时退回内置组件与 PATH 检测，而不是把功能判死。
        const detect = async (kind, configured) => {
            try { return await detector(kind, configured, { root: componentRoot }); }
            catch { return configured ? detector(kind, '', { root: componentRoot }).catch(() => '') : ''; }
        };
        const ytDlpPath = await detect('ytDlp', value.ytDlpPath);
        const ffmpegPath = await detect('ffmpeg', value.ffmpegPath);
        const stillConfigured = (file, configured) => file && configured && file.toLowerCase() === configured.toLowerCase() ? configured : '';
        return { ytDlpPath, ffmpegPath, configuredYtDlpPath: value.ytDlpPath, configuredFfmpegPath: value.ffmpegPath, configuredProxy: value.proxy || '',
            ytDlpSource: executableSource('ytDlp', ytDlpPath, stillConfigured(ytDlpPath, value.ytDlpPath), { root: componentRoot }),
            ffmpegSource: executableSource('ffmpeg', ffmpegPath, stillConfigured(ffmpegPath, value.ffmpegPath), { root: componentRoot }),
            // 保存的路径失效时告诉界面，避免用户以为设置还在生效。
            staleYtDlpPath: !!value.ytDlpPath && !stillConfigured(ytDlpPath, value.ytDlpPath),
            staleFfmpegPath: !!value.ffmpegPath && !stillConfigured(ffmpegPath, value.ffmpegPath),
            ready: !!ytDlpPath, ffmpegReady: !!ffmpegPath };
    }
    /** 组件状态 + 本次真正生效的代理（configured / env / system / none），供界面提示。 */
    async function status() {
        const value = await tools();
        const proxy = await proxyResolver({ configured: value.configuredProxy });
        const detectedProxy = await readSystemProxy().catch(() => '');
        const stored = await config.read();
        return { ...value, proxy: proxy.url, proxySource: proxy.source, detectedProxy,
            configuredDownloadDir: stored.downloadDir || '', downloadDir: stored.downloadDir || defaultDownloadDir,
            parallel: Math.max(1, maxConcurrent) };
    }
    async function checkTools(value, signal) {
        if (!value.ytDlpPath) throw problem('missing_dependency', '下载引擎缺失，请使用包含内置组件的完整工具箱，或在组件设置中选择已有 yt-dlp');
        const version = await runner(value.ytDlpPath, ['--ignore-config', '--version'], { signal, timeout: 10000, maxBytes: 65536 });
        if (version.code !== 0 || !/^\d{4}\.\d{2}\.\d{2}/.test(version.stdout.trim())) throw problem('invalid_executable', 'yt-dlp 版本检测失败，请选择官方组件');
        if (value.ffmpegPath) {
            const ffmpeg = await runner(value.ffmpegPath, ['-version'], { signal, timeout: 10000, maxBytes: 65536 });
            if (ffmpeg.code !== 0 || !/^ffmpeg version /m.test(ffmpeg.stdout)) throw problem('invalid_executable', 'ffmpeg 版本检测失败');
        }
        return { ...value, version: version.stdout.trim().slice(0, 80) };
    }
    /** 保存目录：留空时用系统「下载」文件夹。 */
    async function resolveDownloadDir() {
        const stored = await config.read();
        if (!stored.downloadDir) return defaultDownloadDir;
        if (!isAbsolute(stored.downloadDir) || /[\x00-\x1f"<>|?*]/.test(stored.downloadDir)) throw problem('invalid_path', '下载目录无效，请在组件设置里重新填写完整路径', 400);
        return stored.downloadDir;
    }
    function downloadDirValue(raw) {
        if (raw === undefined) return undefined;
        if (typeof raw !== 'string') throw problem('invalid_input', '下载目录必须是文本');
        const value = raw.trim().replace(/[\\/]+$/, '');
        if (!value) return '';
        if (value.length > 1024 || /[\x00-\x1f"<>|?*]/.test(value) || !isAbsolute(value) || /^[\\/]{2}/.test(value)) throw problem('invalid_path', '请填写完整的本机文件夹路径，例如 D:\\视频');
        return value;
    }
    async function configure(body, signal) {
        fields(body, ['ytDlpPath', 'ffmpegPath', 'proxy', 'downloadDir']);
        if (typeof body.ytDlpPath !== 'string' || typeof body.ffmpegPath !== 'string') throw problem('invalid_input', '请填写组件路径，留空将使用自动检测');
        // proxy 省略表示「不改动」，空字符串表示「不用代理」。
        const rawProxy = body.proxy === undefined ? null : body.proxy;
        if (rawProxy !== null && typeof rawProxy !== 'string') throw problem('invalid_input', '代理地址必须是文本');
        const proxy = rawProxy === null || !rawProxy.trim() ? '' : normalizeProxy(rawProxy);
        if (rawProxy !== null && rawProxy.trim() && !proxy) throw problem('invalid_proxy', '代理地址无效，请填写 http://127.0.0.1:7897 这样的地址', 400);
        const downloadDir = downloadDirValue(body.downloadDir);
        // 目录可以还不存在，这里先建出来并确认可写，避免下载完成后才发现放不进去。
        if (downloadDir) {
            try { await mkdir(downloadDir, { recursive: true }); } catch { throw problem('invalid_path', '下载目录无法创建或不可写，请换一个位置', 400); }
        }
        const ytDlpPath = body.ytDlpPath ? await executablePath(body.ytDlpPath, 'ytDlp') : '';
        const ffmpegPath = body.ffmpegPath ? await executablePath(body.ffmpegPath, 'ffmpeg') : '';
        const detected = { ytDlpPath: await detector('ytDlp', ytDlpPath, { root: componentRoot }), ffmpegPath: await detector('ffmpeg', ffmpegPath, { root: componentRoot }) };
        // 允许保存空配置，明确保留未安装状态；用户指定的文件必须通过版本检查。
        if (detected.ytDlpPath) await checkTools(detected, signal);
        else if (ffmpegPath) {
            const r = await runner(ffmpegPath, ['-version'], { signal, timeout: 10000, maxBytes: 65536 });
            if (r.code !== 0 || !/^ffmpeg version /m.test(r.stdout)) throw problem('invalid_executable', 'ffmpeg 版本检测失败');
        }
        if (signal?.aborted) throw problem('cancelled', '操作已取消', 499);
        await config.update({ ytDlpPath, ffmpegPath, ...(rawProxy === null ? {} : { proxy }), ...(downloadDir === undefined ? {} : { downloadDir }) });
        probes.clear();
        return status();
    }
    async function resolvers() {
        return { resolvers: await listResolvers() };
    }
    async function analyze(body, signal) {
        if (disposed) throw problem('closed', '服务正在关闭', 503);
        if (analyzing) throw problem('busy', '上一次解析还在进行，请稍候', 409);
        fields(body, ['url', 'resolverId']); const url = videoUrl(body.url);
        const forcedResolverId = body.resolverId === undefined ? '' : body.resolverId;
        if (typeof forcedResolverId !== 'string' || forcedResolverId.length > 64) throw problem('invalid_input', '解析方案编号无效');
        analyzing = true;
        // 调用方可能不带取消信号；解析链内部统一用真实 AbortSignal，避免 AbortSignal.any 收到 undefined。
        const combined = signal || new AbortController().signal;
        try {
            const value = await checkTools(await tools(), combined);
            const proxy = await proxyResolver({ configured: value.configuredProxy });
            const http = await fetchFactory(proxy.url, { globalFetch: fetchImpl });
            // 统一链接解析：按优先级依次尝试所有方案，某个失败自动交给下一个。
            const chain = await resolveVideo(url, {
                runner, tools: value, signal: combined, commonArgs: commonArgsFor(proxy.url), runtimeArgs, videoChoices, fetchImpl: http,
                validateUrl: videoUrl, forcedResolverId, now: Date.now,
                childSignal: ms => AbortSignal.any([combined, AbortSignal.timeout(ms)])
            });
            for (const [id, item] of probes) if (now() - item.createdAt > 5 * 60000) probes.delete(id);
            while (probes.size >= 6) probes.delete(probes.keys().next().value);
            const id = randomUUID(), info = chain.info;
            probes.set(id, { url: info.mediaUrl, title: info.title, choices: info.choices, tools: value, proxy: proxy.url, resolverId: chain.resolver.id, createdAt: now() });
            return { id, title: info.title, uploader: info.uploader, duration: info.duration,
                choices: info.choices.map(({ id: choiceId, label }) => ({ id: choiceId, label })),
                ffmpegReady: !!value.ffmpegPath, resolvedBy: chain.resolver, attempts: chain.attempts, proxy: proxy.url, proxySource: proxy.source };
        } finally { analyzing = false; }
    }

    function taskView(task) {
        return { id: task.id, title: task.title, choiceId: task.choiceId, choiceLabel: task.choiceLabel, state: task.state,
            createdAt: task.createdAt, startedAt: task.startedAt || null, finishedAt: task.finishedAt || null,
            progress: task.progress, resumed: task.resumed || 0, error: task.error, result: task.result };
    }
    function planFor(body) {
        fields(body, ['probeId', 'choiceId']);
        const probe = probes.get(body.probeId);
        if (!probe || now() - probe.createdAt > 5 * 60000) throw problem('expired', '视频信息已过期，请重新分析', 410);
        const choice = probe.choices.find(item => item.id === body.choiceId);
        if (!choice) throw problem('invalid_choice', '请选择本次分析提供的下载格式');
        return { url: probe.url, title: probe.title, choice, tools: probe.tools, proxy: probe.proxy };
    }
    function pruneJobs() {
        const cutoff = now() - pruneMs;
        for (const [id, task] of jobs) {
            if (!activeStates.has(task.state) && task.finishedAt && task.finishedAt < cutoff && !results.has(id)) jobs.delete(id);
        }
        while (jobs.size > taskLimit) {
            const idle = [...jobs.values()].filter(task => !activeStates.has(task.state)).sort((a, b) => a.createdAt - b.createdAt)[0];
            if (!idle) break;
            jobs.delete(idle.id);
        }
    }
    function createJob(plan) {
        const id = randomUUID();
        const cacheKey = createHash('sha256').update(`${plan.url}\n${plan.choice.id}`).digest('hex').slice(0, 24);
        const task = { id, plan, cacheKey, title: plan.title, choiceId: plan.choice.id, choiceLabel: plan.choice.label,
            state: 'queued', createdAt: now(), startedAt: 0, finishedAt: 0, progress: null, resumed: 0,
            error: null, result: null, controller: new AbortController(), subscribers: new Set(), ...deferred() };
        jobs.set(id, task);
        waiting.push(task);
        pruneJobs();
        queueMicrotask(pump);
        return task;
    }
    function startTask(body) {
        if (disposed) throw problem('closed', '服务正在关闭', 503);
        return taskView(createJob(planFor(body)));
    }
    function pump() {
        if (disposed) return;
        const limit = Math.max(1, maxConcurrent);
        while (active.size < limit && waiting.length) {
            const task = waiting.shift();
            if (task.state !== 'queued') continue;
            void runTask(task);
        }
    }
    async function runTask(task) {
        task.state = 'running'; task.startedAt = now(); active.add(task.id);
        const signal = task.controller.signal, directory = join(cacheDirectory, task.cacheKey);
        const emit = event => { for (const listener of [...task.subscribers]) { try { listener(event); } catch { /* 订阅方异常不影响下载 */ } } };
        let stalled = false, lastActivity = now();
        const stalledProblem = () => problem('stalled', '下载长时间没有进展，已暂停；重新开始时从断点继续', 504);
        // 不再限制总时长和文件体积，但「长时间没有任何字节变化」仍然收尾，避免卡死任务占着并发位。
        const watchdog = setInterval(() => { if (now() - lastActivity > stallMs) { stalled = true; task.controller.abort(); } }, Math.max(1000, Math.min(5000, Math.floor(stallMs / 4) || 1000)));
        watchdog.unref?.();
        try {
            const checked = await checkTools(task.plan.tools, signal);
            await mkdir(directory, { recursive: true });
            task.resumed = await directoryBytes(directory);
            emit({ type: 'start', resumed: task.resumed, message: task.resumed > 0 ? '检测到未完成文件，将从断点继续下载' : '正在下载，完成后可能需要合并或转换' });
            const args = [...commonArgsFor(task.plan.proxy), ...runtimeArgs(checked), ...task.plan.choice.args,
                '--continue', '--no-simulate', '--newline', '--no-quiet', '--progress', '--progress-delta', '0.5',
                '--progress-template', progressTemplate,
                '--print', 'after_move:TOOLBOX_FILE|%(filepath)s', '-o', join(directory, 'media.%(ext)s')];
            if (checked.ffmpegPath) args.push('--ffmpeg-location', checked.ffmpegPath);
            args.push('--', task.plan.choice.url || task.plan.url);
            let reportedFile = '';
            const output = await runner(checked.ytDlpPath, args, { signal, timeout: 0, maxBytes: 4 * MiB, cwd: directory, onLine: line => {
                lastActivity = now();
                if (line.startsWith('TOOLBOX_FILE|')) { reportedFile = line.slice('TOOLBOX_FILE|'.length).trim(); return; }
                if (!line.startsWith('TOOLBOX_PROGRESS|')) return;
                const numbers = line.split('|').slice(1).map(value => Number(value));
                const safe = index => Number.isFinite(numbers[index]) && numbers[index] >= 0 ? numbers[index] : null;
                const progress = { downloaded: safe(0), total: safe(1), speed: safe(2), eta: safe(3) };
                task.progress = progress; emit({ type: 'progress', ...progress });
            } });
            if (signal.aborted) throw stalled ? stalledProblem() : problem('cancelled', '下载已取消，再次开始会从断点继续', 499);
            if (output.code !== 0) throw stalled ? stalledProblem() : problem('download_failed', '视频下载或转换失败，请检查网络、网站限制、组件版本及 ffmpeg', 502);
            const path = resolve(reportedFile || directory);
            if (dirname(path) !== resolve(directory) || !/^media\.[a-z0-9]+$/i.test(basename(path)) || !mediaExtensions.has(extname(path).toLowerCase())) throw problem('invalid_output', '下载未生成受支持的完整媒体文件', 502);
            const stat = await lstat(path);
            if (!stat.isFile() || stat.isSymbolicLink() || await realpath(path) !== path || stat.size <= 0) throw problem('file_limit', '下载文件为空或无效，已保留临时文件', 502);
            task.result = await deliver(task, path, directory, stat.size);
            task.state = 'done'; task.finishedAt = now();
            emit({ type: 'done', ...task.result });
            task.resolve(task.result);
        } catch (error) {
            // 看门狗触发时进程被中断，报错是 cancelled，这里换回更准确的「长时间无进展」。
            const failure = stalled ? stalledProblem() : error;
            // 体积或时长不再设限：失败/取消都保留已下载分片，下次同一链接继续。
            task.state = failure?.code === 'cancelled' || failure?.code === 'stalled' ? 'cancelled' : 'failed';
            task.finishedAt = now();
            task.error = { code: failure?.code || 'internal_error', message: failure?.message || '下载失败' };
            emit({ type: 'error', ...task.error });
            task.reject(failure);
        } finally {
            clearInterval(watchdog); active.delete(task.id); pump();
        }
    }
    /** 成功后落到下载目录；放不进去时保留临时文件，仍可从浏览器另存。 */
    async function deliver(task, source, directory, size) {
        const extension = extname(source), name = safeName(task.title, extension);
        let savedPath = '', saveError = '';
        try {
            const target = await resolveDownloadDir();
            await mkdir(target, { recursive: true });
            const destination = await uniquePath(target, name);
            await moveFile(source, destination);
            savedPath = destination;
        } catch (error) {
            saveError = error?.code === 'invalid_path' ? error.message : '自动保存到下载目录失败，请检查目录权限或磁盘空间';
        }
        const result = { id: task.id, name: savedPath ? basename(savedPath) : name, size, path: savedPath || source, savedTo: savedPath, saved: !!savedPath, saveError,
            downloadUrl: `/api/integrations/yoinks/results/${task.id}/file` };
        const entry = { path: result.path, directory, size, name: result.name, owned: !savedPath, expiresAt: now() + retentionMs, readers: 0, streams: new Set(), expired: false };
        results.set(task.id, entry);
        entry.timer = setTimeout(() => { removeResult(task.id).catch(() => {}); }, retentionMs); entry.timer.unref?.();
        if (savedPath) await rm(directory, { recursive: true, force: true }).catch(() => {});
        return result;
    }
    async function removeResult(id) {
        const entry = results.get(id);
        if (!entry) return { removed: true };
        clearTimeout(entry.timer); entry.expired = true;
        // 已保存到下载目录的文件不属于临时产物，只取消登记。
        if (!entry.readers && entry.owned) await rm(entry.directory, { recursive: true, force: true }).catch(() => {});
        results.delete(id);
        return { removed: true };
    }
    async function openResult(id) {
        const entry = results.get(id);
        if (!entry || entry.expired || entry.expiresAt <= now()) { if (entry) await removeResult(id); throw problem('expired', '下载结果已清理或过期，请重新下载', 410); }
        const stat = await lstat(entry.path);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== entry.size || await realpath(entry.path) !== entry.path) throw problem('invalid_output', '下载文件已发生变化，请重新下载', 410);
        entry.readers++;
        const stream = createReadStream(entry.path);
        entry.streams.add(stream);
        stream.once('close', () => { entry.readers--; entry.streams.delete(stream); if (entry.expired) removeResult(id).catch(() => {}); });
        return { stream, name: entry.name, size: entry.size };
    }
    function subscribe(task, emit) {
        if (!emit) return () => {};
        task.subscribers.add(emit);
        return () => task.subscribers.delete(emit);
    }
    /** 兼容旧的单次下载调用：加入队列并等待结果。 */
    async function download(body, signal, emit = () => {}) {
        const task = createJob(planFor(body));
        const unsubscribe = subscribe(task, emit);
        const abort = () => { if (activeStates.has(task.state)) cancelTask(task.id); };
        if (signal) { if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true }); }
        try { return await task.promise; }
        finally { unsubscribe(); signal?.removeEventListener('abort', abort); }
    }
    function cancelTask(id) {
        const task = jobs.get(id);
        if (!task) throw problem('not_found', '下载任务不存在或已清理', 404);
        if (!activeStates.has(task.state)) return taskView(task);
        if (task.state === 'queued') {
            const index = waiting.indexOf(task); if (index >= 0) waiting.splice(index, 1);
            task.state = 'cancelled'; task.finishedAt = now();
            task.error = { code: 'cancelled', message: '下载已取消' };
            task.reject(problem('cancelled', '下载已取消', 499));
        } else task.controller.abort();
        return taskView(task);
    }
    function retryTask(id) {
        const task = jobs.get(id);
        if (!task) throw problem('not_found', '下载任务不存在或已清理', 404);
        if (activeStates.has(task.state)) throw problem('busy', '该任务还在进行中，请先取消', 409);
        if (disposed) throw problem('closed', '服务正在关闭', 503);
        return taskView(createJob(task.plan));
    }
    async function removeTask(id) {
        const task = jobs.get(id);
        if (task) {
            const index = waiting.indexOf(task); if (index >= 0) waiting.splice(index, 1);
            if (task.state === 'running') task.controller.abort();
            if (task.state === 'queued') { task.state = 'cancelled'; task.reject(problem('cancelled', '下载已取消', 499)); }
            jobs.delete(id);
        }
        await removeResult(id).catch(() => {});
        return { removed: true };
    }
    async function revealTask(id) {
        const entry = results.get(id), task = jobs.get(id);
        const path = entry?.path || task?.result?.path;
        if (!path) throw problem('not_found', '还没有可打开的文件', 404);
        reveal(path);
        return { opened: true, path };
    }
    async function cacheInfo() {
        try {
            const names = (await readdir(cacheDirectory)).slice(0, 200);
            let bytes = 0;
            for (const name of names) bytes += await directoryBytes(join(cacheDirectory, name));
            return { bytes, count: names.length };
        } catch { return { bytes: 0, count: 0 }; }
    }
    async function clearCache() {
        const busy = new Set([...active].map(id => jobs.get(id)?.cacheKey).filter(Boolean));
        try {
            for (const name of await readdir(cacheDirectory)) {
                if (busy.has(name)) continue;
                await rm(join(cacheDirectory, name), { recursive: true, force: true }).catch(() => {});
            }
        } catch { /* 缓存目录不存在时无需清理 */ }
        return cacheInfo();
    }
    async function listTasks() {
        const stored = await config.read();
        return { tasks: [...jobs.values()].sort((a, b) => b.createdAt - a.createdAt).slice(0, taskLimit).map(taskView),
            parallel: Math.max(1, maxConcurrent), running: active.size, queued: waiting.length,
            downloadDir: stored.downloadDir || defaultDownloadDir, configuredDownloadDir: stored.downloadDir || '',
            cache: await cacheInfo() };
    }
    function getTask(id) {
        const task = jobs.get(id);
        if (!task) throw problem('not_found', '下载任务不存在或已清理', 404);
        return taskView(task);
    }
    async function dispose() {
        disposed = true;
        waiting.length = 0;
        for (const task of jobs.values()) {
            if (!activeStates.has(task.state)) continue;
            task.controller.abort();
            task.reject(problem('cancelled', '服务正在关闭', 503));
        }
        await Promise.allSettled([...active].map(id => jobs.get(id)?.promise).filter(Boolean));
        probes.clear();
        for (const entry of results.values()) for (const stream of entry.streams) stream.destroy();
        await Promise.allSettled([...results.keys()].map(removeResult));
        jobs.clear();
    }
    return { tools, status, resolvers, configure, analyze, download, startTask, listTasks, getTask,
        cancelTask, retryTask, removeTask, revealTask, cacheInfo, clearCache, openResult, removeResult, dispose };
}
