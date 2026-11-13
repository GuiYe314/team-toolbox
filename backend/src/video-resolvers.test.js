import test from 'node:test';
import assert from 'node:assert/strict';
import { problem } from './integration-common.js';
import { resolveVideo, listResolvers, registerResolver } from './video-resolvers.js';

const PAGE = 'https://example.com/watch?v=abc';

function context(overrides = {}) {
    return {
        runner: async () => ({ code: 1, stdout: '', stderr: '' }), // 内置 yt-dlp 方案默认失败
        tools: { ytDlpPath: 'yt-dlp', ffmpegPath: 'ffmpeg', version: '2025.11.12' },
        signal: new AbortController().signal,
        commonArgs: ['--ignore-config'],
        runtimeArgs: () => [],
        videoChoices: () => [{ id: 'video-720', label: '720p', args: ['-f', 'b'] }],
        validateUrl: value => {
            const url = new URL(value);
            if (!['http:', 'https:'].includes(url.protocol) || ['127.0.0.1', 'localhost', '10.0.0.1'].includes(url.hostname)) throw problem('invalid_url', '地址不被允许');
            return url.href;
        },
        childSignal: ms => AbortSignal.timeout(ms),
        now: () => 0,
        forcedResolverId: '',
        ...overrides
    };
}

function resolver(id, priority, work, name = id) {
    return { id, name, description: `测试方案 ${id}`, priority, match: () => true, resolve: work };
}

function ok(url = PAGE, extra = {}) {
    return { title: '测试视频', uploader: '作者', duration: 12, mediaUrl: url,
        choices: [{ id: 'best', label: '最佳画质', args: [] }], ffmpegReady: true, ...extra };
}

test('列出内置解析方案且按优先级排序', async () => {
    const list = await listResolvers();
    const ids = list.map(item => item.id);
    assert.ok(ids.includes('direct-media') && ids.includes('ytdlp') && ids.includes('ytdlp-generic'));
    assert.ok(list.every(item => item.builtin === true));
    assert.deepEqual([...list].sort((a, b) => a.priority - b.priority).map(item => item.id), ids);
});

test('前一个方案失败后自动降级到下一个方案，并返回尝试明细', async t => {
    const undo = [registerResolver(resolver('test-fail-a', 1, async () => { throw problem('resolver_failed', '故意失败', 502); })),
        registerResolver(resolver('test-ok-b', 2, async url => ok(url)))];
    t.after(() => undo.forEach(fn => fn()));
    const result = await resolveVideo(PAGE, context());
    assert.equal(result.resolver.id, 'test-ok-b');
    assert.equal(result.info.title, '测试视频');
    assert.deepEqual(result.attempts.map(item => [item.id, item.status]), [['test-fail-a', 'failed'], ['test-ok-b', 'ok']]);
    assert.equal(result.attempts[0].message, '故意失败');
});

test('所有方案都失败时抛出带 attempts 的错误，且不泄露上游原始错误', async t => {
    const undo = registerResolver(resolver('test-fail-c', 1, async () => { throw new Error('secret-stderr-token'); }));
    t.after(() => undo());
    await assert.rejects(resolveVideo(PAGE, context()), error => {
        assert.equal(error.code, 'all_resolvers_failed');
        assert.ok(Array.isArray(error.attempts) && error.attempts.length >= 3);
        assert.ok(error.attempts.some(item => item.status === 'skipped'));
        assert.ok(!JSON.stringify(error.attempts).includes('secret-stderr-token'));
        return true;
    });
});

test('指定 resolverId 时只运行该方案', async t => {
    const undo = registerResolver(resolver('test-only', 1, async url => ok(url)));
    t.after(() => undo());
    const result = await resolveVideo(PAGE, context({ forcedResolverId: 'test-only' }));
    assert.equal(result.resolver.id, 'test-only');
    assert.equal(result.attempts.length, 1);
    await assert.rejects(resolveVideo(PAGE, context({ forcedResolverId: 'not-exist' })), error => error.code === 'unknown_resolver');
});

test('解析方案返回内网地址时判为失败并继续降级', async t => {
    const undo = [registerResolver(resolver('test-unsafe', 1, async () => ok('http://127.0.0.1/secret.mp4'))),
        registerResolver(resolver('test-safe', 2, async url => ok(url)))];
    t.after(() => undo.forEach(fn => fn()));
    const result = await resolveVideo(PAGE, context());
    assert.equal(result.resolver.id, 'test-safe');
    assert.equal(result.attempts[0].status, 'failed');
    assert.match(result.attempts[0].message, /地址不被允许/);
});

test('直链媒体方案跳过网页解析，直接产出可下载格式', async () => {
    const url = 'https://cdn.example.com/clip.mp4';
    const result = await resolveVideo(url, context({ forcedResolverId: 'direct-media', fetchImpl: async () => ({ ok: true, status: 200 }) }));
    assert.equal(result.resolver.id, 'direct-media');
    assert.equal(result.info.mediaUrl, url);
    assert.deepEqual(result.info.choices.map(item => item.id), ['direct-file']);
    assert.equal(result.info.title, 'clip.mp4');
});

test('非法格式编号与返回空格式的方案被判为失败', async t => {
    const undo = [registerResolver(resolver('test-bad-choice', 1, async () => ok(PAGE, { choices: [{ id: 'bad id!', label: 'x', args: [] }] }))),
        registerResolver(resolver('test-empty', 2, async () => ok(PAGE, { choices: [] }))),
        registerResolver(resolver('test-recover', 3, async url => ok(url)))];
    t.after(() => undo.forEach(fn => fn()));
    const result = await resolveVideo(PAGE, context());
    assert.equal(result.resolver.id, 'test-recover');
    assert.deepEqual(result.attempts.slice(0, 2).map(item => item.status), ['failed', 'failed']);
});
