import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, readdir, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { get as httpGet } from 'node:http';
import express from 'express';
import { createIntegrationConfig, localBaseUrl, executablePath, detectExecutable, bundledExecutable, runIntegrationProcess, problem } from './integration-common.js';
import { createYoinksService, videoUrl } from './yoinks.js';
import { createFreeLlmService, validateChat } from './freellmapi.js';
import { createArtcraftService } from './artcraft.js';
import { registerIntegrationApi, requireLocalIntegrationRequest } from './integration-api.js';

const fail = code => error => error.code === code;
const key = 'freellmapi-test-only-never-real';
async function fixture(t) {
    const root = await mkdtemp(join(tmpdir(), 'tt-integrations-test-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const file = join(root, 'settings.json'), config = createIntegrationConfig(file);
    return { root, file, config };
}
async function videoFixture(t, overrides = {}) {
    const f = await fixture(t), calls = [], paths = { ytDlp: join(f.root, 'yt-dlp.exe'), ffmpeg: join(f.root, 'ffmpeg.exe') };
    for (const path of Object.values(paths)) await writeFile(path, 'test component');
    const runner = async (file, args, options) => {
        calls.push({ file, args, options });
        if (args.includes('--version')) return { code: 0, stdout: '2026.10.22\n', stderr: '' };
        if (args.includes('-version')) return { code: 0, stdout: 'ffmpeg version test\n', stderr: '' };
        if (args.includes('--dump-single-json')) return { code: 0, stdout: JSON.stringify({ title: '测试 / 视频', uploader: '测试作者', duration: 60, formats: [{ height: 1080, vcodec: 'avc1', acodec: 'none' }, { height: 720, vcodec: 'avc1', acodec: 'aac' }] }), stderr: '' };
        const filePath = args[args.indexOf('-o') + 1].replace('%(ext)s', args.includes('mp3') ? 'mp3' : 'mp4');
        await writeFile(filePath, Buffer.alloc(128, 1));
        options.onLine('TOOLBOX_PROGRESS|64|128|100|1'); options.onLine('TOOLBOX_FILE|' + filePath);
        return { code: 0, stdout: '', stderr: '' };
    };
    const service = createYoinksService({ config: f.config, runner, detector: async (kind, path) => path || paths[kind], temporaryRoot: f.root, ...overrides });
    t.after(() => service.dispose());
    return { ...f, paths, calls, runner, service };
}
function sse(text = '你好') {
    return `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { total_tokens: 12 } })}\n\ndata: [DONE]\n\n`;
}
async function freeFixture(t, options = {}) {
    const f = await fixture(t), calls = [];
    const service = createFreeLlmService({ config: f.config, fetchImpl: async (url, request) => {
        calls.push({ url, ...request });
        if (url.includes('/models?')) return Response.json({ data: [{ id: 'auto' }, { id: 'local-text', owned_by: 'custom' }, { id: 'blocked', execution_status: 'exhausted' }, { id: 'picture', type: 'image' }] });
        return new Response(sse(), { headers: { 'Content-Type': 'text/event-stream' } });
    }, ...options });
    t.after(() => service.dispose());
    await service.configure({ baseUrl: 'http://127.0.0.1:3001/v1', key });
    return { ...f, service, calls };
}
test('本机设置原子保存、并发合并且不允许落盘额外密钥字段', async t => {
    const { config, file } = await fixture(t);
    await Promise.all([config.update({ ytDlpPath: 'a' }), config.update({ artcraftPath: 'b' })]);
    assert.equal((await config.read()).ytDlpPath, 'a'); assert.equal((await config.read()).artcraftPath, 'b');
    await assert.rejects(config.update({ key }), fail('invalid_input'));
    assert.ok(!(await readFile(file, 'utf8')).includes(key));
});
test('设置损坏时不覆盖旧文件', async t => {
    const { config, file } = await fixture(t); await writeFile(file, '{broken');
    await assert.rejects(config.update({ artcraftPath: '' }), fail('config_error'));
    assert.equal(await readFile(file, 'utf8'), '{broken');
});
test('FreeLLMAPI 地址只接受回环和固定 v1 路径', () => {
    assert.equal(localBaseUrl('http://localhost:31415'), 'http://localhost:31415/v1');
    for (const url of ['https://example.com/v1', 'http://192.168.1.2/v1', 'file:///v1', 'http://user:pass@localhost/v1', 'http://localhost/api', 'http://localhost/v1?q=secret', 'http://localhost/#x', 'http://localhost:0/v1', 'http://localhost\\evil/v1']) assert.throws(() => localBaseUrl(url), fail('invalid_url'));
});
test('可执行文件必须是明确的本机文件，不接受脚本和自由参数', async t => {
    const { root } = await fixture(t), path = join(root, 'ArtCraft.exe'); await writeFile(path, 'test');
    assert.equal((await executablePath(path, 'artcraft')).toLowerCase(), path.toLowerCase());
    for (const value of ['ArtCraft.exe', 'C:\\tools\\evil.cmd', path + ' --exec', '\\\\server\\ArtCraft.exe', path + ':stream']) await assert.rejects(executablePath(value, 'artcraft'));
});
test('真实进程执行保持参数字面值、不启用 Shell 并捕获输出', async () => {
    const literal = 'a & echo $(secret) | <input>';
    const result = await runIntegrationProcess(process.execPath, ['-e', 'process.stdout.write(process.argv[1]);process.stderr.write("err")', literal]);
    assert.equal(result.code, 0); assert.equal(result.stdout, literal); assert.equal(result.stderr, 'err');
});

test('本产品内置组件优先于PATH，明确自定义路径仍优先且损坏覆盖不静默回退', { skip: process.platform !== 'win32' || process.arch !== 'x64' }, async t => {
    const { root } = await fixture(t), folder = join(root, 'path-tools'), home = join(root, 'home');
    const bundled = bundledExecutable('ytDlp', { root }), custom = join(folder, 'yt-dlp.exe');
    await mkdir(join(root, 'vendor/media/win32-x64'), { recursive: true }); await mkdir(folder);
    await writeFile(bundled, 'isolated bundled fixture'); await writeFile(custom, 'isolated external fixture');
    const options = { root, home, env: { PATH: folder } };
    assert.equal((await detectExecutable('ytDlp', '', options)).toLowerCase(), bundled.toLowerCase());
    assert.equal((await detectExecutable('ytDlp', custom, options)).toLowerCase(), custom.toLowerCase());
    await assert.rejects(detectExecutable('ytDlp', join(root, 'missing/yt-dlp.exe'), options));
    await rm(bundled); assert.equal((await detectExecutable('ytDlp', '', options)).toLowerCase(), custom.toLowerCase());
    await rm(custom); assert.equal(await detectExecutable('ytDlp', '', options), '');
    assert.equal(bundledExecutable('ytDlp', { platform: 'linux' }), '');
});
test('真实进程超时、取消及输出上限都终止执行', async () => {
    await assert.rejects(runIntegrationProcess(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { timeout: 80 }), fail('timeout'));
    const controller = new AbortController(); controller.abort();
    await assert.rejects(runIntegrationProcess(process.execPath, ['-e', 'process.exit(99)'], { signal: controller.signal }), fail('cancelled'));
    const inFlight = new AbortController();
    await assert.rejects(runIntegrationProcess(process.execPath, ['-e', 'console.log("ready");setInterval(()=>{},1000)'], { signal: inFlight.signal, onLine: line => { if (line === 'ready') inFlight.abort(); } }), fail('cancelled'));
    await assert.rejects(runIntegrationProcess(process.execPath, ['-e', 'process.stdout.write("x".repeat(10000))'], { maxBytes: 128 }), fail('output_limit'));
});
test('视频 URL 拒绝本机、凭据、非网页协议及参数注入', () => {
    assert.equal(videoUrl('https://example.com/watch?v=abc#comment'), 'https://example.com/watch?v=abc');
    for (const value of ['--exec evil', 'file:///C:/a', 'http://127.0.0.1/a', 'http://2130706433/', 'http://10.0.0.2/a', 'http://[::1]/a', 'https://a:b@example.com/', 'https://example.com/\n--exec']) assert.throws(() => videoUrl(value), fail('invalid_url'));
});
test('Yoinks 探测使用固定参数，网页只收到可选 ID 与精简元数据', async t => {
    const { service, calls } = await videoFixture(t);
    const info = await service.analyze({ url: 'https://example.com/video' });
    assert.equal(info.title, '测试 / 视频'); assert.deepEqual(info.choices.map(x => x.id), ['video-1080', 'video-720', 'audio-mp3']);
    assert.ok(info.choices.every(x => !('args' in x)));
    const probe = calls.find(x => x.args.includes('--dump-single-json'));
    assert.ok(probe.args.includes('--ignore-config')); assert.ok(probe.args.includes('--no-plugin-dirs')); assert.ok(probe.args.includes('--no-playlist')); assert.deepEqual(probe.args.slice(-2), ['--', 'https://example.com/video']);
    assert.ok(probe.args.includes('--no-remote-components')); assert.ok(probe.args.includes('--no-js-runtimes'));
    assert.equal(probe.args[probe.args.indexOf('--js-runtimes') + 1], `node:${process.execPath}`);
    await assert.rejects(service.analyze({ url: 'https://example.com/video', args: ['--exec'] }), fail('invalid_input'));
});
test('没有 ffmpeg 时只提供含音轨视频，不冒充可提取 MP3', async t => {
    const { service, paths } = await videoFixture(t, { detector: async kind => kind === 'ytDlp' ? paths.ytDlp : '' });
    const info = await service.analyze({ url: 'https://example.com/video' });
    assert.equal(info.ffmpegReady, false); assert.deepEqual(info.choices.map(x => x.id), ['video-720']);
});
test('组件设置校验版本，成功后保留本机路径', async t => {
    const { service, config, paths } = await videoFixture(t);
    await service.configure({ ytDlpPath: paths.ytDlp, ffmpegPath: paths.ffmpeg });
    assert.equal((await config.read()).ytDlpPath.toLowerCase(), paths.ytDlp.toLowerCase());
});
test('组件文件丢失时仍可读取并修改已存路径', async t => {
    const { service, config } = await videoFixture(t, { detector: async () => { throw problem('missing_executable', 'missing'); } });
    await config.update({ ytDlpPath: 'missing' });
    assert.equal((await service.tools()).configuredYtDlpPath, 'missing'); assert.equal((await service.tools()).ready, false);
});
test('视频成功必须有真实非空文件，进度与结果分离且文件可领取和清理', async t => {
    const { service, calls, root } = await videoFixture(t), events = [];
    const info = await service.analyze({ url: 'https://example.com/video' });
    const result = await service.download({ probeId: info.id, choiceId: 'audio-mp3' }, undefined, event => events.push(event));
    assert.deepEqual(events.map(x => x.type), ['start', 'progress', 'done']); assert.equal(result.size, 128); assert.ok(result.name.endsWith('.mp3')); assert.ok(!result.name.includes('/'));
    const download = calls.find(x => x.args.includes('--no-simulate'));
    assert.ok(download.args.includes('--max-filesize')); assert.deepEqual(download.args.slice(-2), ['--', 'https://example.com/video']);
    const file = await service.openResult(result.id); let size = 0; for await (const chunk of file.stream) size += chunk.length;
    assert.equal(size, 128); await service.removeResult(result.id);
    await assert.rejects(service.openResult(result.id), fail('expired')); assert.ok(!(await readdir(root)).some(name => name.startsWith('toolbox-yoinks-')));
});
test('视频探测过期和自由格式参数被拒绝', async t => {
    let clock = 0;
    const { service } = await videoFixture(t, { now: () => clock });
    const info = await service.analyze({ url: 'https://example.com/video' });
    await assert.rejects(service.download({ probeId: info.id, choiceId: '--exec' }), fail('invalid_choice'));
    await assert.rejects(service.download({ probeId: info.id, choiceId: 'video-720', path: 'C:/other' }), fail('invalid_input'));
    clock = 300001; await assert.rejects(service.download({ probeId: info.id, choiceId: 'video-720' }), fail('expired'));
});
test('视频下载失败不暴露原始 stderr，临时目录被回收', async t => {
    let original;
    const f = await videoFixture(t, { runner: (...args) => args[1].includes('--no-simulate') ? { code: 1, stderr: 'secret-link-token', stdout: '' } : original(...args) }); original = f.runner;
    const info = await f.service.analyze({ url: 'https://example.com/video' });
    await assert.rejects(f.service.download({ probeId: info.id, choiceId: 'video-720' }), error => error.code === 'download_failed' && !error.message.includes('secret'));
    assert.ok(!(await readdir(f.root)).some(name => name.startsWith('toolbox-yoinks-')));
});
test('取消在途视频下载会释放独占锁并清理临时目录', async t => {
    let original, entered;
    const ready = new Promise(resolve => { entered = resolve; });
    const f = await videoFixture(t, { runner: (file, args, options) => {
        if (!args.includes('--no-simulate')) return original(file, args, options);
        entered(); return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(problem('cancelled', 'cancelled', 499)), { once: true }));
    } }); original = f.runner;
    const info = await f.service.analyze({ url: 'https://example.com/video' }), controller = new AbortController();
    const pending = f.service.download({ probeId: info.id, choiceId: 'video-720' }, controller.signal); await ready;
    await assert.rejects(f.service.analyze({ url: 'https://example.com/video' }), fail('busy'));
    controller.abort(); await assert.rejects(pending, fail('cancelled'));
    assert.ok(!(await readdir(f.root)).some(name => name.startsWith('toolbox-yoinks-')));
    assert.ok((await f.service.analyze({ url: 'https://example.com/video' })).id);
});
test('外部文件路径不能作为下载结果，超限文件也不能领取', async t => {
    for (const invalid of ['outside', 'oversize']) {
        let original;
        const f = await videoFixture(t, { maxFileBytes: 100, runner: async (file, args, options) => {
            if (!args.includes('--no-simulate')) return original(file, args, options);
            if (invalid === 'outside') { options.onLine('TOOLBOX_FILE|' + join(f.root, 'outside.mp4')); return { code: 0 }; }
            return original(file, args, options);
        } }); original = f.runner;
        const info = await f.service.analyze({ url: 'https://example.com/video' });
        await assert.rejects(f.service.download({ probeId: info.id, choiceId: 'video-720' }), fail(invalid === 'outside' ? 'invalid_output' : 'file_limit'));
        assert.ok(!(await readdir(f.root)).some(name => name.startsWith('toolbox-yoinks-')));
    }
});
test('下载结果到期后不能领取；服务退出取消并清理结果', async t => {
    let clock = 0;
    const f = await videoFixture(t, { now: () => clock, retentionMs: 1000 });
    const info = await f.service.analyze({ url: 'https://example.com/video' });
    const result = await f.service.download({ probeId: info.id, choiceId: 'video-720' });
    clock = 1001; await assert.rejects(f.service.openResult(result.id), fail('expired'));
    await f.service.dispose(); assert.ok(!(await readdir(f.root)).some(name => name.startsWith('toolbox-yoinks-')));
});
test('统一 Key 仅在后端内存，模型请求只去固定接口并拒绝重定向', async t => {
    const { service, file, calls } = await freeFixture(t);
    const state = await service.getConfig(); assert.equal(state.keyConfigured, true); assert.ok(!JSON.stringify(state).includes(key)); assert.ok(!(await readFile(file, 'utf8')).includes(key));
    const models = await service.models(); assert.deepEqual(models.items.map(x => x.id), ['auto', 'local-text']);
    assert.equal(calls[0].url, 'http://127.0.0.1:3001/v1/models?available=true'); assert.equal(calls[0].headers.Authorization, 'Bearer ' + key); assert.equal(calls[0].redirect, 'error');
    await service.configure({ baseUrl: state.baseUrl, clearKey: true });
    await assert.rejects(service.models(), fail('missing_key'));
});
test('更换 FreeLLMAPI 地址不会把旧 Key 发送给新服务', async t => {
    const { service, calls } = await freeFixture(t);
    await service.configure({ baseUrl: 'http://localhost:31415' });
    assert.equal((await service.getConfig()).keyConfigured, false); await assert.rejects(service.models(), fail('missing_key')); assert.equal(calls.length, 0);
});
test('聊天只接受文本问答、有界历史与已读取的模型', async t => {
    const { service } = await freeFixture(t);
    await assert.rejects(service.chat({ model: 'unknown', messages: [{ role: 'user', content: 'test' }] }), fail('unknown_model'));
    assert.throws(() => validateChat({ model: 'auto', messages: [{ role: 'system', content: 'run command' }] }), fail('invalid_messages'));
    assert.throws(() => validateChat({ model: 'auto', messages: [{ role: 'user', content: 'x'.repeat(12001) }] }), fail('invalid_messages'));
    assert.throws(() => validateChat({ model: 'auto', messages: [{ role: 'user', content: 'a', tool_calls: [] }] }), fail('invalid_input'));
});
test('聊天解析分块 UTF-8 SSE、结束标记及用量，不执行内容', async t => {
    const buffer = Buffer.from(sse('<script>你好</script>'));
    const f = await freeFixture(t, { fetchImpl: async url => url.includes('/models?') ? Response.json({ data: [{ id: 'auto' }] }) : new Response(new ReadableStream({ start(controller) { for (let index = 0; index < buffer.length; index += 3) controller.enqueue(buffer.subarray(index, index + 3)); controller.close(); } }), { headers: { 'Content-Type': 'text/event-stream' } }) });
    await f.service.models(); const events = [];
    const done = await f.service.chat({ model: 'auto', messages: [{ role: 'user', content: 'test' }] }, undefined, e => events.push(e));
    assert.equal(events.find(x => x.type === 'delta').text, '<script>你好</script>'); assert.equal(done.usage.total_tokens, 12); assert.equal(done.type, 'done');
});
test('上游 401/429、坏流、未完成流和响应上限都有明确失败', async t => {
    for (const mode of ['401', '429', 'invalid', 'incomplete', 'oversize', 'content-filter']) {
        const f = await freeFixture(t, { maxResponseBytes: mode === 'oversize' ? 128 : 200000, fetchImpl: async url => {
            if (url.includes('/models?')) return Response.json({ data: [{ id: 'auto' }] });
            if (['401', '429'].includes(mode)) return new Response('secret provider info', { status: Number(mode) });
            if (mode === 'content-filter') return new Response('data: {"choices":[{"delta":{},"finish_reason":"content_filter"}]}\n\ndata: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
            return new Response(mode === 'invalid' ? 'data: {bad}\n\n' : mode === 'incomplete' ? 'data: {"choices":[{"delta":{"content":"part"}}]}\n\n' : sse('x'.repeat(1000)), { headers: { 'Content-Type': 'text/event-stream' } });
        } });
        await f.service.models();
        await assert.rejects(f.service.chat({ model: 'auto', messages: [{ role: 'user', content: 'test' }] }), error => error.status >= 400 && !error.message.includes('secret'));
    }
});
test('聊天取消和超时会传递取消信号，忙碌期间不能更换 Key', async t => {
    for (const timeout of [false, true]) {
        let entered, cancelled = false; const ready = new Promise(resolve => { entered = resolve; });
        const f = await freeFixture(t, { timeoutMs: timeout ? 40 : 5000, fetchImpl: async (url, options) => {
            if (url.includes('/models?')) return Response.json({ data: [{ id: 'auto' }] });
            return new Response(new ReadableStream({ start(controller) { options.signal.addEventListener('abort', () => { cancelled = true; controller.error(new DOMException('abort', 'AbortError')); }, { once: true }); entered(); } }), { headers: { 'Content-Type': 'text/event-stream' } });
        } });
        await f.service.models(); const controller = new AbortController();
        const pending = f.service.chat({ model: 'auto', messages: [{ role: 'user', content: 'test' }] }, controller.signal); await ready;
        await assert.rejects(f.service.configure({ baseUrl: 'http://localhost:31415', key }), fail('busy'));
        if (!timeout) controller.abort();
        await assert.rejects(pending, fail(timeout ? 'timeout' : 'cancelled')); assert.equal(cancelled, true);
    }
});
test('ArtCraft 只能确认启动保存路径，无自由命令，连续点击被限制', async t => {
    const { config } = await fixture(t), launched = [];
    let clock = 100;
    const service = createArtcraftService({ config, validator: async path => path, launcher: async path => launched.push(path), now: () => clock });
    await service.configure({ path: 'C:/apps/ArtCraft.exe' });
    await assert.rejects(service.launch({ confirm: false }), fail('confirmation_required'));
    await assert.rejects(service.launch({ confirm: true, args: ['--exec'] }), fail('invalid_input'));
    assert.equal((await service.launch({ confirm: true })).requested, true); assert.deepEqual(launched, ['C:/apps/ArtCraft.exe']);
    await assert.rejects(service.launch({ confirm: true }), fail('busy')); clock += 5001;
    await service.launch({ confirm: true }); assert.equal(launched.length, 2);
});
test('ArtCraft 不存在或启动失败时不报告应用就绪', async t => {
    const { config } = await fixture(t), service = createArtcraftService({ config, validator: async () => { throw problem('missing_executable', 'missing'); } });
    assert.equal((await service.getConfig()).available, false);
    await assert.rejects(service.launch({ confirm: true }), fail('missing_dependency'));
    await config.update({ artcraftPath: 'missing' }); assert.equal((await service.getConfig()).available, false);
    await assert.rejects(service.launch({ confirm: true }), fail('missing_executable'));
    const failed = createArtcraftService({ config, validator: async path => path, launcher: async () => { throw problem('launch_failed', '启动失败', 500); } });
    await assert.rejects(failed.launch({ confirm: true }), fail('launch_failed')); assert.equal((await failed.getConfig()).lastLaunch, null);
});

async function apiFixture(t, service) {
    const app = express(), logs = []; app.use(express.json()); registerIntegrationApi(app, { service, log: entry => logs.push(entry) });
    const server = await new Promise(resolve => { const value = app.listen(0, '127.0.0.1', () => resolve(value)); });
    t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
    const url = `http://127.0.0.1:${server.address().port}/api/integrations`;
    return { logs, url, request: (path, options = {}) => fetch(url + path, options), post: (path, body = {}, headers = {}) => fetch(url + path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Toolbox-Integration': '1', ...headers }, body: JSON.stringify(body) }) };
}
test('本机 API 拒绝外部 Host/Origin、跨站和缺少专用头，转发头无法绕过', async t => {
    const { request, post, url } = await apiFixture(t, { freellmapi: { getConfig: async () => ({ baseUrl: 'local' }), configure: async () => ({}) } });
    assert.equal((await request('/freellmapi/config')).status, 200);
    const wrongHost = await new Promise((resolve, reject) => { httpGet(url + '/freellmapi/config', { headers: { Host: 'evil.example', 'X-Forwarded-Host': 'localhost' } }, response => { response.resume(); resolve(response.statusCode); }).on('error', reject); });
    assert.equal(wrongHost, 403);
    for (const headers of [{ Origin: 'https://evil.example' }, { 'Sec-Fetch-Site': 'cross-site' }]) assert.equal((await request('/freellmapi/config', { headers })).status, 403, JSON.stringify(headers));
    assert.equal((await request('/freellmapi/config?url=other')).status, 403);
    assert.equal((await request('/artcraft/launch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 403);
    assert.equal((await post('/artcraft/launch', {}, { 'Content-Type': 'text/plain' })).status, 403);
    let status;
    requireLocalIntegrationRequest({ socket: { remoteAddress: '192.168.1.2' }, headers: { host: 'localhost' }, get: () => undefined }, { status(code) { status = code; return this; }, json() {} }, () => assert.fail('LAN request accepted'));
    assert.equal(status, 403);
});
test('流式 API 返回逐条结果、文件安全附件头，不把 Key/文本写日志', async t => {
    const { post, request, logs } = await apiFixture(t, { freellmapi: { chat: async (_body, _signal, emit) => { emit({ type: 'delta', text: 'answer-secret' }); emit({ type: 'done' }); } }, yoinks: { openResult: async () => ({ stream: Readable.from(['test']), name: '中文.mp4', size: 4 }) } });
    const result = await post('/freellmapi/chat', { key, prompt: 'secret-question' }); assert.ok(result.headers.get('content-type').includes('application/x-ndjson')); assert.ok((await result.text()).includes('"done"'));
    const file = await request('/yoinks/results/id/file'); assert.equal(await file.text(), 'test'); assert.ok(file.headers.get('content-disposition').includes("filename*=UTF-8''")); assert.equal(file.headers.get('cache-control'), 'no-store');
    assert.ok(!JSON.stringify(logs).includes('secret')); assert.ok(!JSON.stringify(logs).includes(key));
});
test('流开始后的错误明确返回错误事件，内部异常不泄露', async t => {
    const { post, logs } = await apiFixture(t, { freellmapi: { chat: async (_body, _signal, emit) => { emit({ type: 'delta', text: 'part' }); throw new Error('sensitive internal path'); } } });
    const response = await post('/freellmapi/chat'); const text = await response.text();
    assert.ok(text.includes('"type":"error"')); assert.ok(!text.includes('sensitive')); assert.ok(!JSON.stringify(logs).includes('sensitive'));
});
