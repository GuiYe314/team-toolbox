import { mkdtemp, readdir, lstat, realpath, rm } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { join, basename, dirname, extname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { appRoot, fields, problem, detectExecutable, executablePath, executableSource, runIntegrationProcess } from './integration-common.js';
import { resolveVideo, listResolvers } from './video-resolvers.js';

const MiB = 1024 * 1024;
const commonArgs = ['--ignore-config', '--no-plugin-dirs', '--no-playlist', '--no-warnings', '--no-cache-dir', '--socket-timeout', '20', '--retries', '1', '--extractor-retries', '1'];
// 新版yt-dlp的EJS解析复用当前Node，不依赖用户PATH或自动获取远程组件。
const runtimeArgs = tools => tools.version.slice(0, 10) >= '2025.11.12' ? ['--no-js-runtimes', '--js-runtimes', `node:${process.execPath}`, '--no-remote-components'] : [];
const mediaExtensions = new Set(['.mp4', '.webm', '.mkv', '.mov', '.m4a', '.mp3', '.ogg', '.opus', '.flv', '.avi', '.wav']);

export function videoUrl(value) {
    if (typeof value !== 'string' || value.length > 2048 || /[\s\x00-\x1f\\]/.test(value)) throw problem('invalid_url', '请输入单个完整的视频网页链接');
    let url;
    try { url = new URL(value); } catch { throw problem('invalid_url', '视频链接格式无效'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || /^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[)/i.test(url.hostname) || url.hostname.endsWith('.local')) throw problem('invalid_url', '只支持公开 HTTP/HTTPS 视频网页链接');
    url.hash = '';
    return url.href;
}

export function videoChoices(info, hasFfmpeg) {
    const formats = Array.isArray(info.formats) ? info.formats.slice(0, 3000) : [];
    const heights = [...new Set(formats.filter(f => f && f.vcodec && f.vcodec !== 'none' && (hasFfmpeg || f.acodec && f.acodec !== 'none')).map(f => f.height).filter(h => Number.isInteger(h) && h >= 100 && h <= 8640))].sort((a, b) => b - a).slice(0, 8);
    const choices = heights.map(height => ({ id: `video-${height}`, label: `${height}p${hasFfmpeg ? ' · 合并为 MP4' : ' · 含音轨格式'}`, args: hasFfmpeg ? ['-f', `bv*[height<=${height}]+ba/b[height<=${height}]`, '--merge-output-format', 'mp4'] : ['-f', `b[height<=${height}]`] }));
    if (!choices.length) choices.push({ id: 'video-best', label: hasFfmpeg ? '最佳画质 · MP4' : '最佳含音轨格式', args: hasFfmpeg ? ['-f', 'bv*+ba/b', '--merge-output-format', 'mp4'] : ['-f', 'b'] });
    if (hasFfmpeg) choices.push({ id: 'audio-mp3', label: '仅音频 · MP3', args: ['-f', 'ba/b', '-x', '--audio-format', 'mp3', '--audio-quality', '0'] });
    return choices;
}

export function createYoinksService({ config, runner = runIntegrationProcess, detector = detectExecutable, componentRoot = appRoot, temporaryRoot = tmpdir(), now = Date.now, retentionMs = 10 * 60 * 1000, maxFileBytes = 1024 * MiB, downloadTimeoutMs = 15 * 60 * 1000 } = {}) {
    const probes = new Map(), results = new Map();
    let active = null, disposed = false;
    async function tools() {
        const value = await config.read();
        const ytDlpPath = await detector('ytDlp', value.ytDlpPath, { root: componentRoot }).catch(() => '');
        const ffmpegPath = await detector('ffmpeg', value.ffmpegPath, { root: componentRoot }).catch(() => '');
        return { ytDlpPath, ffmpegPath, configuredYtDlpPath: value.ytDlpPath, configuredFfmpegPath: value.ffmpegPath,
            ytDlpSource: executableSource('ytDlp', ytDlpPath, value.ytDlpPath, { root: componentRoot }), ffmpegSource: executableSource('ffmpeg', ffmpegPath, value.ffmpegPath, { root: componentRoot }), ready: !!ytDlpPath, ffmpegReady: !!ffmpegPath };
    }
    async function exclusive(signal, work) {
        if (disposed) throw problem('closed', '服务正在关闭', 503);
        if (active) throw problem('busy', '另一个视频操作正在执行，请先取消或等待完成', 409);
        const controller = new AbortController();
        const operation = { controller, done: null };
        active = operation;
        const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
        operation.done = Promise.resolve().then(() => { if (combined.aborted) throw problem('cancelled', '操作已取消', 499); return work(combined); });
        try { return await operation.done; } finally { if (active === operation) active = null; }
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
    async function configure(body, signal) {
        fields(body, ['ytDlpPath', 'ffmpegPath']);
        if (typeof body.ytDlpPath !== 'string' || typeof body.ffmpegPath !== 'string') throw problem('invalid_input', '请填写组件路径，留空将使用自动检测');
        return exclusive(signal, async combined => {
            const ytDlpPath = body.ytDlpPath ? await executablePath(body.ytDlpPath, 'ytDlp') : '';
            const ffmpegPath = body.ffmpegPath ? await executablePath(body.ffmpegPath, 'ffmpeg') : '';
            const detected = { ytDlpPath: await detector('ytDlp', ytDlpPath, { root: componentRoot }), ffmpegPath: await detector('ffmpeg', ffmpegPath, { root: componentRoot }) };
            // 允许保存空配置，明确保留未安装状态；用户指定的文件必须通过版本检查。
            if (detected.ytDlpPath) await checkTools(detected, combined);
            else if (ffmpegPath) {
                const r = await runner(ffmpegPath, ['-version'], { signal: combined, timeout: 10000, maxBytes: 65536 });
                if (r.code !== 0 || !/^ffmpeg version /m.test(r.stdout)) throw problem('invalid_executable', 'ffmpeg 版本检测失败');
            }
            if (combined.aborted) throw problem('cancelled', '操作已取消', 499);
            await config.update({ ytDlpPath, ffmpegPath }); probes.clear();
            return tools();
        });
    }
    async function resolvers() {
        return { resolvers: await listResolvers() };
    }
    async function analyze(body, signal) {
        fields(body, ['url', 'resolverId']); const url = videoUrl(body.url);
        const forcedResolverId = body.resolverId === undefined ? '' : body.resolverId;
        if (typeof forcedResolverId !== 'string' || forcedResolverId.length > 64) throw problem('invalid_input', '解析方案编号无效');
        return exclusive(signal, async combined => {
            const value = await checkTools(await tools(), combined);
            // 统一链接解析：按优先级依次尝试所有方案，某个失败自动交给下一个。
            const chain = await resolveVideo(url, {
                runner, tools: value, signal: combined, commonArgs, runtimeArgs, videoChoices,
                validateUrl: videoUrl, forcedResolverId, now: Date.now,
                childSignal: ms => AbortSignal.any([combined, AbortSignal.timeout(ms)])
            });
            for (const [id, item] of probes) if (now() - item.createdAt > 5 * 60000) probes.delete(id);
            while (probes.size >= 4) probes.delete(probes.keys().next().value);
            const id = randomUUID(), info = chain.info;
            probes.set(id, { url: info.mediaUrl, title: info.title, choices: info.choices, tools: value, resolverId: chain.resolver.id, createdAt: now() });
            return { id, title: info.title, uploader: info.uploader, duration: info.duration,
                choices: info.choices.map(({ id: choiceId, label }) => ({ id: choiceId, label })),
                ffmpegReady: !!value.ffmpegPath, resolvedBy: chain.resolver, attempts: chain.attempts };
        });
    }
    async function removeResult(id) {
        const result = results.get(id);
        if (!result) return { removed: true };
        clearTimeout(result.timer); result.expired = true;
        if (!result.readers) { await rm(result.directory, { recursive: true, force: true }); results.delete(id); }
        return { removed: true };
    }
    async function download(body, signal, emit = () => {}) {
        fields(body, ['probeId', 'choiceId']);
        const probe = probes.get(body.probeId);
        if (!probe || now() - probe.createdAt > 5 * 60000) throw problem('expired', '视频信息已过期，请重新分析', 410);
        const choice = probe.choices.find(item => item.id === body.choiceId);
        if (!choice) throw problem('invalid_choice', '请选择本次分析提供的下载格式');
        return exclusive(signal, async combined => {
            await checkTools(probe.tools, combined);
            for (const [id, item] of results) if (item.expired || item.expiresAt <= now()) await removeResult(id);
            if (results.size >= 3) throw problem('result_limit', '请先清理已有下载结果，再开始新的下载（最多保留三项）', 409);
            const directory = await mkdtemp(join(temporaryRoot, 'toolbox-yoinks-'));
            const sizeController = new AbortController();
            const operationSignal = AbortSignal.any([combined, sizeController.signal]);
            let retained = false, reportedFile = '', checking = false, sizeFailure = false;
            const monitor = setInterval(async () => {
                if (checking) return; checking = true;
                try {
                    let bytes = 0;
                    for (const name of (await readdir(directory)).slice(0, 100)) bytes += (await lstat(join(directory, name))).size;
                    if (bytes > maxFileBytes * 2) { sizeFailure = true; sizeController.abort(); }
                } catch { /* 文件合并或清理期间可能瞬时消失 */ }
                finally { checking = false; }
            }, 1000);
            monitor.unref?.();
            try {
                emit({ type: 'start', message: '正在下载，完成后可能需要合并或转换' });
                const args = [...commonArgs, ...runtimeArgs(probe.tools), ...choice.args, '--no-simulate', '--newline', '--no-quiet', '--progress', '--progress-delta', '0.5', '--max-filesize', String(maxFileBytes), '--progress-template', 'download:TOOLBOX_PROGRESS|%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.speed)s|%(progress.eta)s', '--print', 'after_move:TOOLBOX_FILE|%(filepath)s', '-o', join(directory, 'media.%(ext)s')];
                if (probe.tools.ffmpegPath) args.push('--ffmpeg-location', probe.tools.ffmpegPath);
                args.push('--', choice.url || probe.url);
                const output = await runner(probe.tools.ytDlpPath, args, { signal: operationSignal, timeout: downloadTimeoutMs, maxBytes: 2 * MiB, cwd: directory, onLine: line => {
                    if (line.startsWith('TOOLBOX_FILE|')) reportedFile = line.slice('TOOLBOX_FILE|'.length).trim();
                    if (line.startsWith('TOOLBOX_PROGRESS|')) {
                        const numbers = line.split('|').slice(1).map(value => Number(value));
                        const safe = index => Number.isFinite(numbers[index]) && numbers[index] >= 0 ? numbers[index] : null;
                        emit({ type: 'progress', downloaded: safe(0), total: safe(1), speed: safe(2), eta: safe(3) });
                    }
                } });
                if (operationSignal.aborted) throw problem('cancelled', '下载已取消', 499);
                if (output.code !== 0) throw problem('download_failed', '视频下载或转换失败，请检查网络、网站限制、组件版本及 ffmpeg', 502);
                const path = resolve(reportedFile || directory);
                if (dirname(path) !== resolve(directory) || !/^media\.[a-z0-9]+$/i.test(basename(path)) || !mediaExtensions.has(extname(path).toLowerCase())) throw problem('invalid_output', '下载未生成受支持的完整媒体文件', 502);
                const stat = await lstat(path);
                if (!stat.isFile() || stat.isSymbolicLink() || await realpath(path) !== path || stat.size <= 0 || stat.size > maxFileBytes) throw problem('file_limit', '下载文件为空、无效或超过 1 GiB 上限', 502);
                const id = randomUUID(), expiresAt = now() + retentionMs;
                const name = (probe.title.replace(/[\x00-\x1f<>:"/\\|?*]/g, '_').replace(/[. ]+$/, '').slice(0, 100) || 'video') + extname(path);
                const result = { id, path, directory, name, size: stat.size, expiresAt, readers: 0, streams: new Set(), expired: false };
                result.timer = setTimeout(() => { removeResult(id).catch(() => {}); }, retentionMs); result.timer.unref?.();
                results.set(id, result); retained = true;
                const reply = { type: 'done', id, name, size: stat.size, expiresAt, downloadUrl: `/api/integrations/yoinks/results/${id}/file` };
                emit(reply); return reply;
            } catch (error) {
                if (sizeFailure) throw problem('file_limit', '下载临时文件超过大小上限，已停止并清理', 413);
                throw error;
            } finally { clearInterval(monitor); if (!retained) await rm(directory, { recursive: true, force: true }); }
        });
    }
    async function openResult(id) {
        const result = results.get(id);
        if (!result || result.expired || result.expiresAt <= now()) { if (result) await removeResult(id); throw problem('expired', '下载结果已清理或过期，请重新下载', 410); }
        const stat = await lstat(result.path);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== result.size || await realpath(result.path) !== result.path) throw problem('invalid_output', '下载文件已发生变化，请重新下载', 410);
        result.readers++;
        const stream = createReadStream(result.path);
        result.streams.add(stream);
        stream.once('close', () => { result.readers--; result.streams.delete(stream); if (result.expired) removeResult(id).catch(() => {}); });
        return { stream, name: result.name, size: result.size };
    }
    async function dispose() {
        disposed = true; active?.controller.abort();
        await active?.done?.catch(() => {});
        probes.clear();
        for (const result of results.values()) for (const stream of result.streams) stream.destroy();
        await Promise.allSettled([...results.keys()].map(removeResult));
    }
    return { tools, resolvers, configure, analyze, download, openResult, removeResult, dispose };
}
