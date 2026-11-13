import test from 'node:test';
import assert from 'node:assert/strict';
import { problem } from './integration-common.js';
import { resolveVideo } from './video-resolvers.js';
import { extractMedia, fileChoices, heightHint, hlsChoices, normalizePageUrl, parseHlsMaster, pageTitle, refererArgs } from './video-page.js';

const PAGE = 'https://bad.news/t/6588976';

function context(overrides = {}) {
    return {
        runner: async () => ({ code: 1, stdout: '', stderr: '' }),
        tools: { ytDlpPath: 'yt-dlp', ffmpegPath: 'ffmpeg', version: '2025.11.12' },
        signal: new AbortController().signal,
        commonArgs: ['--ignore-config'],
        runtimeArgs: () => [],
        videoChoices: () => [{ id: 'video-720', label: '720p', args: ['-f', 'b'] }],
        validateUrl: value => {
            const url = new URL(value);
            if (!['http:', 'https:'].includes(url.protocol) || ['127.0.0.1', 'localhost'].includes(url.hostname)) throw problem('invalid_url', '地址不被允许');
            return url.href;
        },
        childSignal: ms => AbortSignal.timeout(ms),
        now: () => 0,
        forcedResolverId: '',
        ...overrides
    };
}

const response = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, headers: { get: () => null }, text: async () => body });

test('识别 bad.news 的 data-source + data-type，并还原转义地址', () => {
    const html = `<div><video class="player" data-type="m3u8" data-source="https:\\/\\/cdn.example.com\\/v\\/index.m3u8?token=1&amp;e=2" poster="/p.jpg"></video></div>`;
    const media = extractMedia(html, PAGE);
    assert.equal(media.length, 1);
    assert.equal(media[0].kind, 'hls');
    assert.equal(media[0].url, 'https://cdn.example.com/v/index.m3u8?token=1&e=2');
});

test('非 video 标签上的 data-source 也能识别', () => {
    const media = extractMedia('<div class="player" data-source="https://cdn.example.com/v/a.mp4" data-poster="/x.jpg"></div>', PAGE);
    assert.deepEqual(media.map(item => item.url), ['https://cdn.example.com/v/a.mp4']);
});

test('多视频页面按帖子号取当前视频，不把推荐视频当成正文', () => {
    const html = `
        <video class="my-videos" data-id="111" data-type="mp4" data-source="https://cdn.example.com/recommend-1.mp4"></video>
        <video class="my-videos" data-id="6588976" data-type="m3u8" data-source="https://cdn.example.com/topic/index.m3u8"></video>
        <video class="my-videos" data-id="222" data-type="mp4" data-source="https://cdn.example.com/recommend-2.mp4"></video>`;
    const media = extractMedia(html, PAGE, { topicId: '6588976' });
    assert.deepEqual(media.map(item => item.url), ['https://cdn.example.com/topic/index.m3u8']);
    // 没有提供帖子号时保持原样，避免影响其他站点。
    assert.equal(extractMedia(html, PAGE).length, 3);
    // 帖子号对不上任何视频时退回全部候选，不因为规则太严而解析不了。
    assert.equal(extractMedia(html, PAGE, { topicId: '999' }).length, 3);
});

test('帖子页只在正文播放器里给出清晰度列表时，解析出多个清晰度', async () => {
    const html = `
        <video data-id="6588976" data-type="mp4" data-source="https://cdn.example.com/recommend.mp4"></video>
        <video data-id="6588976" data-type="m3u8" data-source="https://cdn.example.com/topic/master.m3u8"></video>`;
    const master = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=900000,RESOLUTION=1280x720\n720/index.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=2200000,RESOLUTION=1920x1080\n1080/index.m3u8';
    const result = await resolveVideo(PAGE, context({
        fetchImpl: async url => response(String(url).endsWith('.m3u8') ? master : html)
    }));
    assert.equal(result.resolver.id, 'bad-news');
    assert.equal(result.info.mediaUrl, 'https://cdn.example.com/topic/master.m3u8');
    assert.deepEqual(result.info.choices.map(item => item.id), ['hls-1080', 'hls-720', 'audio-mp3']);
});

test('识别 video / source / og:video / 协议相对地址，并带上清晰度提示', () => {
    const html = `
        <meta property="og:video" content="//cdn.example.com/share/1080p.mp4" />
        <video src="/media/clip_720p.mp4"></video>
        <source src="https://cdn.example.com/media/clip_480p.mp4" label="480p" />`;
    const media = extractMedia(html, PAGE);
    assert.deepEqual(media.map(item => item.kind), ['file', 'file', 'file']);
    assert.deepEqual(media.map(item => item.height), [720, 480, 1080]);
    assert.equal(media[0].url, 'https://bad.news/media/clip_720p.mp4');
    assert.equal(media[2].url, 'https://cdn.example.com/share/1080p.mp4');
});

test('识别内嵌第三方播放器并交给 yt-dlp', () => {
    const media = extractMedia('<iframe src="https://www.youtube.com/embed/abc123"></iframe>', PAGE);
    assert.deepEqual(media, [{ url: 'https://www.youtube.com/embed/abc123', kind: 'embed', label: '', height: 0 }]);
});

test('解析 HLS 主清单的分辨率、带宽与音轨分组', () => {
    const playlist = `#EXTM3U
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="中文",URI="audio/zh.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=900000,RESOLUTION=640x360,AUDIO="aud"
360/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=5200000,RESOLUTION=1920x1080,FRAME-RATE=30,AUDIO="aud"
1080/index.m3u8`;
    const { variants, audio } = parseHlsMaster(playlist, 'https://cdn.example.com/hls/master.m3u8');
    assert.deepEqual(variants.map(item => item.height), [360, 1080]);
    assert.equal(variants[1].url, 'https://cdn.example.com/hls/1080/index.m3u8');
    assert.equal(variants[1].bandwidth, 5200000);
    assert.equal(variants[1].fps, 30);
    assert.equal(variants[1].audioGroup, 'aud');
    assert.equal(audio.get('aud'), 'https://cdn.example.com/hls/audio/zh.m3u8');
});

test('主清单生成按高度排序的清晰度选项，并带 referer 与 -f 选择器', () => {
    const choices = hlsChoices([{ height: 360, bandwidth: 900000 }, { height: 1080, bandwidth: 5200000 }, { height: 1080, bandwidth: 6000000 }], { pageUrl: PAGE });
    assert.deepEqual(choices.map(item => item.id), ['hls-1080', 'hls-360']);
    assert.match(choices[0].label, /^1080p · 6\.0 Mbps · HLS/);
    assert.deepEqual(choices[0].args, ['--referer', PAGE, '-f', 'bv*[height<=1080]+ba/b[height<=1080]', '--merge-output-format', 'mp4']);
});

test('没有分辨率信息时退回单一「原始清晰度」选项', () => {
    assert.deepEqual(hlsChoices([], { pageUrl: PAGE }), [{ id: 'hls-auto', label: '原始清晰度 · HLS', args: ['--referer', PAGE] }]);
});

test('页面直接给多个文件时按已知清晰度排序，单个文件额外提供 MP3', () => {
    const many = fileChoices([{ url: 'https://cdn.example.com/a.mp4', height: 360 }, { url: 'https://cdn.example.com/b.mp4', height: 1080 }], { pageUrl: PAGE });
    assert.deepEqual(many.map(item => item.id), ['file-1', 'file-2']);
    assert.match(many[0].label, /^1080p/);
    const single = fileChoices([{ url: 'https://cdn.example.com/a.mp4' }], { pageUrl: PAGE });
    assert.deepEqual(single.map(item => item.id), ['file-1', 'audio-mp3']);
    assert.equal(single[1].url, 'https://cdn.example.com/a.mp4');
});

test('清晰度提示与页面标题只做保守猜测', () => {
    assert.equal(heightHint('clip_1080p.mp4'), 1080);
    assert.equal(heightHint('1920x1080'), 1080);
    assert.equal(heightHint('hd720'), 720);
    assert.equal(heightHint('clip.mp4'), 0);
    assert.equal(pageTitle('<html><head><title> 中文 &amp; 标题 </title></head></html>'), '中文 & 标题');
});

test('bad.news 的 ajax 下载入口换回公开话题页', () => {
    assert.equal(normalizePageUrl('https://bad.news/ajax/download?tid=6588976'), 'https://bad.news/t/6588976');
    assert.equal(normalizePageUrl('https://bad.news/t/6588976'), 'https://bad.news/t/6588976');
    assert.equal(normalizePageUrl('https://example.com/ajax/download?tid=6588976'), 'https://example.com/ajax/download?tid=6588976');
});

test('bad.news 页面：主清单可用 yt-dlp 读格式时直接给出该页面的清晰度', async () => {
    const html = '<html><head><title>话题 6588976</title></head><body><video data-source="https://cdn.example.com/hls/master.m3u8" data-type="m3u8"></video></body></html>';
    const calls = [];
    const result = await resolveVideo(PAGE, context({
        fetchImpl: async url => { calls.push(url); return response(html); },
        runner: async (file, args) => {
            calls.push(args.join(' '));
            if (args.includes('--dump-single-json')) return { code: 0, stdout: JSON.stringify({ title: '话题视频', formats: [] }), stderr: '' };
            return { code: 1, stdout: '', stderr: '' };
        }
    }));
    assert.equal(result.resolver.id, 'bad-news');
    // 页面标题比通用提取器给出的 ID 更有意义，优先用页面标题。
    assert.equal(result.info.title, '话题 6588976');
    assert.equal(result.info.mediaUrl, 'https://cdn.example.com/hls/master.m3u8');
    assert.deepEqual(result.info.choices.map(item => item.url), ['https://cdn.example.com/hls/master.m3u8']);
    assert.ok(calls.some(call => call.includes('--referer')));
});

test('bad.news 页面：yt-dlp 读不了清单时自己解析变体，仍能选清晰度', async () => {
    const html = '<html><head><title>话题</title></head><body><video data-source="https://cdn.example.com/hls/master.m3u8" data-type="m3u8"></video></body></html>';
    const playlist = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=1280x720\n720.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=2400000,RESOLUTION=1920x1080\n1080.m3u8';
    const result = await resolveVideo(PAGE, context({
        fetchImpl: async url => response(url.endsWith('.m3u8') ? playlist : html)
    }));
    assert.equal(result.resolver.id, 'bad-news');
    assert.deepEqual(result.info.choices.map(item => item.id).slice(0, 2), ['hls-1080', 'hls-720']);
    assert.match(result.info.choices[0].label, /1080p/);
    assert.equal(result.attempts.find(item => item.id === 'bad-news').status, 'ok');
});

test('bad.news 页面只有 mp4 时给原始清晰度并附上防盗链 Referer', async () => {
    const html = '<video data-source="https://cdn.example.com/v/6588976.mp4" data-type="mp4"></video>';
    const result = await resolveVideo(PAGE, context({ fetchImpl: async () => response(html) }));
    assert.equal(result.resolver.id, 'bad-news');
    assert.equal(result.info.mediaUrl, 'https://cdn.example.com/v/6588976.mp4');
    assert.deepEqual(result.info.choices.map(item => item.id), ['file-1', 'audio-mp3']);
    assert.deepEqual(result.info.choices[0].args, ['--referer', PAGE]);
});

test('页面没有媒体地址时 bad-news 失败并说明原因', async () => {
    const html = '<html><body>登录后可见</body></html>';
    await assert.rejects(resolveVideo('https://bad.news/t/1', context({ fetchImpl: async () => response(html), forcedResolverId: 'bad-news' })), error => {
        assert.equal(error.code, 'all_resolvers_failed');
        assert.match(error.attempts[0].message, /没有找到视频地址/);
        return true;
    });
});

test('页面声明 no-referrer 时不给下载器加 Referer', async () => {
    const html = '<html><head><meta name="referrer" content="no-referrer"><title>话题</title></head><body><video data-source="https://cdn.other.com/v/6588976.mp4" data-type="mp4"></video></body></html>';
    const result = await resolveVideo(PAGE, context({ fetchImpl: async () => response(html) }));
    assert.equal(result.resolver.id, 'bad-news');
    // bad.news 这类站点的 CDN 收到站内 Referer 会 403，必须按页面策略不带。
    assert.deepEqual(result.info.choices[0].args, []);
});

test('页面声明 same-origin 且媒体跨站时不带 Referer，同站仍带', () => {
    const html = '<meta name="referrer" content="same-origin">';
    assert.deepEqual(refererArgs('https://cdn.other.com/a.mp4', 'https://bad.news/t/1', html), []);
    assert.deepEqual(refererArgs('https://v.bad.news/a.mp4', 'https://bad.news/t/1', html), ['--referer', 'https://bad.news/t/1']);
    // 没声明策略时保持原行为，兼容需要防盗链 Referer 的站点。
    assert.deepEqual(refererArgs('https://cdn.other.com/a.mp4', 'https://bad.news/t/1', ''), ['--referer', 'https://bad.news/t/1']);
});

test('非 bad.news 的普通网页由「网页媒体提取」兜底并列出文件', async () => {
    const html = '<video src="https://cdn.example.com/clip.mp4"></video>';
    const result = await resolveVideo('https://example.com/post/1', context({ fetchImpl: async () => response(html) }));
    assert.equal(result.resolver.id, 'page-media');
    assert.equal(result.info.mediaUrl, 'https://cdn.example.com/clip.mp4');
    const skipped = result.attempts.filter(item => item.status === 'skipped').map(item => item.id);
    assert.ok(skipped.includes('direct-media'));
});
