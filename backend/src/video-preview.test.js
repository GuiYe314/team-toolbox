import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { buildPreviewArgs, ffmpegProxyArgs, formatSelector, headerArgs, headersFromArgs, pickStreams, sanitizeHeaders, spawnPreview } from './video-preview.js';

test('请求头只保留安全字段，换行与非法值直接丢弃', () => {
    const headers = sanitizeHeaders({ Referer: 'https://a.com/t/1', 'User-Agent': 'Mozilla/5.0', Bad: 'x\r\nInjected: 1', 'bad key': 'v', Empty: '', Long: 'x'.repeat(2000), Num: 5 });
    assert.deepEqual(headers, { Referer: 'https://a.com/t/1', 'User-Agent': 'Mozilla/5.0' });
    assert.deepEqual(headerArgs({}), []);
    assert.deepEqual(headerArgs({ Referer: 'https://a.com' }), ['-headers', 'Referer: https://a.com\r\n']);
});

test('ffmpeg 代理按输入协议选择选项，socks5 转成 http 形式', () => {
    assert.deepEqual(ffmpegProxyArgs('https://cdn.a.com/x.m3u8', 'http://127.0.0.1:7897'), ['-https_proxy', 'http://127.0.0.1:7897']);
    assert.deepEqual(ffmpegProxyArgs('http://cdn.a.com/x.mp4', 'http://127.0.0.1:7897'), ['-http_proxy', 'http://127.0.0.1:7897']);
    assert.deepEqual(ffmpegProxyArgs('https://cdn.a.com/x.mp4', 'socks5://127.0.0.1:7897'), ['-https_proxy', 'http://127.0.0.1:7897']);
    assert.deepEqual(ffmpegProxyArgs('https://cdn.a.com/x.mp4', ''), []);
    assert.deepEqual(ffmpegProxyArgs('https://cdn.a.com/x.mp4', 'ftp://127.0.0.1:1'), []);
});

test('预览参数必须实时转封装成可边读边播的 fMP4 管道', () => {
    const args = buildPreviewArgs({ inputs: ['https://cdn.a.com/master.m3u8'], headers: { Referer: 'https://a.com/t/1' } });
    assert.deepEqual(args.slice(0, 4), ['-hide_banner', '-loglevel', 'error', '-nostdin']);
    assert.ok(args.indexOf('-headers') < args.indexOf('-i'));
    assert.deepEqual(args.slice(args.indexOf('-map'), args.indexOf('-c')), ['-map', '0:v:0?', '-map', '0:a:0?']);
    assert.deepEqual(args.slice(-7), ['-c', 'copy', '-movflags', 'frag_keyframe+empty_moov+default_base_moof', '-f', 'mp4', 'pipe:1']);
    assert.equal(args.filter(item => item === '-i').length, 1);
});

test('音视频分离的直链用两条输入，音轨取第二条，并从指定秒数开始', () => {
    const args = buildPreviewArgs({ inputs: ['https://v.a.com/1.mp4', 'https://a.a.com/2.m4a'], headers: {}, startSeconds: 42.7 });
    assert.equal(args.filter(item => item === '-i').length, 2);
    assert.deepEqual(args.slice(args.indexOf('-map'), args.indexOf('-c')), ['-map', '0:v:0?', '-map', '0:a:0?', '-map', '1:a:0?']);
    assert.deepEqual(args.slice(args.indexOf('-ss'), args.indexOf('-ss') + 2), ['-ss', '42']);
    // -ss 必须紧贴首个 -i 之前，否则 ffmpeg 会按输出侧 seek，管道场景下等不到画面。
    assert.equal(args[args.indexOf('-ss') + 2], '-i');
});

test('预览拒绝空地址与非 http 协议，避免被当作本地文件读取', () => {
    assert.throws(() => buildPreviewArgs({ inputs: [] }));
    assert.throws(() => buildPreviewArgs({ inputs: ['file:///c:/x.mp4'] }));
    assert.throws(() => buildPreviewArgs({ inputs: ['https://a.com/1', 'https://a.com/2', 'https://a.com/3'] }));
});

test('yt-dlp 直链挑选：视频在前、音频在后，并合并请求头', () => {
    const streams = pickStreams({ requested_downloads: [
        { url: 'https://a.a.com/audio.m4a', vcodec: 'none', acodec: 'mp4a', http_headers: { 'User-Agent': 'UA' } },
        { url: 'https://v.a.com/video.mp4', vcodec: 'avc1', acodec: 'none', http_headers: { Referer: 'https://a.com/' } }
    ] });
    assert.deepEqual(streams.inputs, ['https://v.a.com/video.mp4', 'https://a.a.com/audio.m4a']);
    assert.equal(streams.headers.Referer, 'https://a.com/');
    assert.equal(streams.headers['User-Agent'], 'UA');
    assert.deepEqual(pickStreams({ url: 'https://v.a.com/single.mp4', vcodec: 'avc1' }).inputs, ['https://v.a.com/single.mp4']);
    assert.equal(pickStreams({ requested_downloads: [{ url: 'file:///c:/x' }] }), null);
    assert.equal(pickStreams(null), null);
});

test('格式选择器从 yt-dlp 参数里提取，缺省回退最佳格式', () => {
    assert.equal(formatSelector(['-f', 'bv*[height<=720]+ba/b[height<=720]', '--merge-output-format', 'mp4']), 'bv*[height<=720]+ba/b[height<=720]');
    assert.equal(formatSelector(['--format=ba/b', '-x']), 'ba/b');
    assert.equal(formatSelector(['-f', '--x']), 'b');
    assert.equal(formatSelector([]), 'b');
});

test('Referer 与自定义头从 yt-dlp 参数转成请求头', () => {
    const headers = headersFromArgs(['--referer', 'https://a.com/t/1', '--user-agent', 'UA', '--add-header', 'Accept-Language:zh-CN', '-f', 'b']);
    assert.deepEqual(headers, { Referer: 'https://a.com/t/1', 'User-Agent': 'UA', 'Accept-Language': 'zh-CN' });
    assert.deepEqual(headersFromArgs(['--referer']), {});
    assert.deepEqual(headersFromArgs(undefined), {});
});

test('预览进程：stdout 交给播放器，stop 会终止进程', () => {
    const killed = [];
    const stream = Readable.from([Buffer.from('fmp4')]);
    const stderr = new Readable({ read() {} });
    const child = { stdout: stream, stderr, kill(signal) { killed.push(signal); }, on() {}, once() {} };
    const handle = spawnPreview({ command: 'ffmpeg.exe', args: ['-i', 'x'], spawnImpl: () => child });
    assert.equal(handle.stream, stream);
    handle.stop(); handle.stop();
    assert.deepEqual(killed, ['SIGKILL']);
    assert.equal(typeof handle.errorText(), 'string');
});
