import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, readdir, rm, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import express from 'express';
import { createVideoPresets, BUILTIN_VIDEO_PRESETS } from './video-presets.js';
import { registerVideoPresetsApi } from './video-presets-api.js';
import { videoOptions, videoArguments } from './video-options.js';
import { processVideo, validateSubtitle } from './media-tools.js';
import { registerMediaToolsApi } from './media-tools-api.js';
import { bundledExecutable, runIntegrationProcess } from './integration-common.js';

async function temp(t) { const root = await mkdtemp(join(tmpdir(), 'tt-video-workshop-test-')); t.after(() => rm(root, { recursive: true, force: true })); return root; }
test('视频选项拒绝注入、自由路径、非标类型和越界，老请求仍兼容', () => {
    for (const input of [{ preset: 'fast -i http://x' }, { profile: '-y' }, { level: '7' }, { fps: 29.97 }, { audio: 'copy' }, { subtitleMode: 'http://x' }, { subtitle: 'C:/x' }, { bitrate: 0 }, { width: true }, { width: 1 }, { height: 10 }, { crf: null }, { channels: 8 }, { sampleRate: 123 }, { rateControl: 'custom' }]) assert.throws(() => videoOptions(input));
    assert.equal(videoOptions({ mode: 'compress', width: 640, crf: 24 }).width, 640);
    assert.throws(() => videoOptions({ start: 1 }, { template: true }));
    assert.throws(() => videoOptions({ mode: 'mp3', subtitleMode: 'burn' }));
});
test('Unity与码率/静音/字幕参数准确，字幕路径固定且截取按原时间轴', () => {
    const preset = BUILTIN_VIDEO_PRESETS.find(item => item.id === 'unity-1080');
    const args = videoArguments('input', 'output.mp4', { ...preset.options, start: 2, subtitleMode: 'burn' }, 'subtitle.srt');
    for (const [key, expected] of [['-profile:v', 'main'], ['-level:v', '4.1'], ['-pix_fmt', 'yuv420p'], ['-ar', '48000'], ['-ac', '2']]) assert.equal(args[args.indexOf(key) + 1], expected);
    assert.match(args[args.indexOf('-vf') + 1], /setpts=PTS\+2\/TB,subtitles=filename=subtitle.srt,setpts=PTS-STARTPTS,fps=30/);
    assert.throws(() => videoArguments('x', 'y', { subtitleMode: 'burn' }, '../a.srt'));
    const bitrate = videoArguments('x', 'y', { rateControl: 'bitrate', bitrate: 2000, audio: 'none' });
    assert.ok(!bitrate.includes('-crf') && bitrate.includes('-an')); assert.equal(bitrate[bitrate.indexOf('-b:v') + 1], '2000k');
});
test('模板保存、改名、重建服务读取、版本冲突及确认删除', async t => {
    const root = await temp(t), file = join(root, 'video-presets.json'), service = createVideoPresets({ file });
    assert.equal(service.list().length, 5);
    const initial = service.save({ name: '我的Unity设置', options: BUILTIN_VIDEO_PRESETS[0].options });
    assert.equal(createVideoPresets({ file }).list().at(-1).name, '我的Unity设置');
    const updated = service.save({ name: '改名Unity', options: { ...initial.options, crf: 20 }, revision: initial.revision }, initial.id);
    assert.notEqual(updated.revision, initial.revision);
    assert.throws(() => service.save({ name: '旧参数', options: {}, revision: initial.revision }, initial.id), { status: 409 });
    assert.throws(() => service.remove(initial.id, { confirm: false, revision: updated.revision }));
    assert.throws(() => service.remove(initial.id, { confirm: true, revision: initial.revision }), { status: 409 });
    service.remove(initial.id, { confirm: true, revision: updated.revision });
    assert.equal(service.list().length, 5); assert.deepEqual(await readdir(root), ['video-presets.json']);
});
test('内置只读、同名与数量限制；损坏时不覆盖原配置，不保存文件或裁剪时间', async t => {
    const root = await temp(t), file = join(root, 'presets.json'), service = createVideoPresets({ file });
    assert.throws(() => service.save({ name: 'x', options: {} }, 'unity-1080'));
    assert.throws(() => service.save({ name: BUILTIN_VIDEO_PRESETS[0].name, options: {} }));
    for (const input of [{ name: 'a', options: { start: 2 } }, { name: 'a', options: { subtitleFile: 'a.srt' } }, { name: 'a', options: {}, filename: 'private.mp4' }, { name: 'x'.repeat(41), options: {} }]) assert.throws(() => service.save(input));
    for (let i = 0; i < 50; i++) service.save({ name: `模板${i}`, options: {} });
    assert.throws(() => service.save({ name: '超限', options: {} }));
    const bytes = '{damaged'; await writeFile(file, bytes);
    assert.throws(() => service.list(), { status: 503 }); assert.throws(() => service.save({ name: '安全', options: {} }), { status: 503 });
    assert.equal(await readFile(file, 'utf8'), bytes);
});
test('模板真实HTTP保护、8KiB、错误恢复及并发旧版本拒绝', async t => {
    const root = await temp(t), app = express(), service = createVideoPresets({ file: join(root, 'presets.json') });
    registerVideoPresetsApi(app, { service }); app.use(express.json({ limit: '16mb' }));
    const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
    t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
    const base = `http://127.0.0.1:${server.address().port}/api/video-presets`, headers = { 'X-Toolbox-Media': '1', 'Content-Type': 'application/json' };
    assert.equal((await fetch(base)).status, 403);
    assert.equal((await fetch(base, { headers: { ...headers, Origin: 'https://foreign.invalid' } })).status, 403);
    assert.equal((await fetch(base + '?x=1', { headers })).status, 400);
    assert.equal((await fetch(base, { method: 'POST', headers, body: JSON.stringify({ name: 'x'.repeat(9000) }) })).status, 413);
    const created = await fetch(base, { method: 'POST', headers, body: JSON.stringify({ name: 'HTTP模板', options: {} }) }); assert.equal(created.status, 201);
    const item = (await created.json()).item;
    const updated = await fetch(base + '/' + item.id, { method: 'PUT', headers, body: JSON.stringify({ name: 'HTTP改名', options: {}, revision: item.revision }) }); assert.equal(updated.status, 200);
    assert.equal((await fetch(base + '/' + item.id, { method: 'PUT', headers, body: JSON.stringify({ name: '过时', options: {}, revision: item.revision }) })).status, 409);
    const list = await fetch(base, { headers }); assert.equal(list.headers.get('cache-control'), 'no-store'); assert.equal((await list.json()).items.at(-1).name, 'HTTP改名');
});
const SRT = '1\n00:00:00,000 --> 00:00:03,000\nVISIBLE SUBTITLE\n';
test('字幕UTF-8、格式、附件、大小与行限校验', async t => {
    const root = await temp(t), file = join(root, 'subtitle.srt');
    await writeFile(file, SRT); await validateSubtitle(file, 'subtitle.srt');
    for (const [text, name] of [[Buffer.from([0xff, 0xfe]), 'subtitle.srt'], ['plain text', 'subtitle.srt'], ['\u0000' + SRT, 'subtitle.srt'], ['[Script Info]\n[Fonts]\n[Events]\nDialogue: x', 'subtitle.ass'], ['a'.repeat(9000) + SRT, 'subtitle.srt']]) {
        await writeFile(file, text); await assert.rejects(validateSubtitle(file, name));
    }
});
test('视频与字幕真实multipart、固定路径、拒绝重复/额外/缺失，取消清理两文件', async t => {
    const app = express(), directories = []; let calls = 0;
    const service = registerMediaToolsApi(app, { log: () => {}, videoProcessor: async file => {
        calls++; directories.push(file.directory); assert.equal(file.subtitle, 'subtitle.srt'); assert.equal(await readFile(join(file.directory, file.subtitle), 'utf8'), SRT);
        const output = join(file.directory, 'out.mp4'); await writeFile(output, 'fixture'); return { output, name: 'result.mp4', type: 'video/mp4' };
    } });
    const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
    t.after(async () => { await service.dispose(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
    const url = `http://127.0.0.1:${server.address().port}/api/media-tools/video`;
    for (const [mode, expected] of [['good', 200], ['missing', 400], ['duplicate', 400], ['extra', 400], ['invalid', 400], ['unused', 400]]) {
        const form = new FormData(); form.append('options', JSON.stringify({ subtitleMode: mode === 'unused' ? 'none' : 'burn' })); form.append('file', new Blob(['video']), 'video.mp4');
        if (mode !== 'missing') form.append('subtitle', new Blob([mode === 'invalid' ? 'bad' : SRT]), 'private filename.srt');
        if (mode === 'duplicate') form.append('subtitle', new Blob([SRT]), 'duplicate.srt');
        if (mode === 'extra') form.append('path', 'C:/private');
        const result = await fetch(url, { method: 'POST', headers: { 'X-Toolbox-Media': '1' }, body: form }); assert.equal(result.status, expected, mode); await result.arrayBuffer();
    }
    assert.equal(calls, 1); await service.dispose(); assert.ok(directories.every(path => !existsSync(path)));
});
const ffmpeg = bundledExecutable('ffmpeg'), ffprobe = ffmpeg.replace(/ffmpeg\.exe$/i, 'ffprobe.exe');
test('真实FFmpeg验证Unity编码、码率静音、帧率尺寸、faststart及SRT/ASS烧录', { skip: !existsSync(ffmpeg) }, async t => {
    const root = await temp(t), input = join(root, 'input.mp4');
    await runIntegrationProcess(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=black:s=320x240:r=15:d=1', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', input]);
    const original = await readFile(input);
    async function encode(folder, options, subtitle) {
        const directory = join(root, folder); await mkdir(directory);
        if (subtitle) await writeFile(join(directory, subtitle.name), subtitle.text);
        return processVideo({ directory, input, name: 'synthetic.mp4', options, subtitle: subtitle?.name }, new AbortController().signal, { executable: ffmpeg });
    }
    const plain = await encode('unity', BUILTIN_VIDEO_PRESETS[0].options);
    const probe = JSON.parse((await runIntegrationProcess(ffprobe, ['-v', 'error', '-show_streams', '-of', 'json', plain.output])).stdout);
    const v = probe.streams.find(s => s.codec_type === 'video'), a = probe.streams.find(s => s.codec_type === 'audio');
    assert.equal(v.codec_name, 'h264'); assert.equal(v.profile, 'Main'); assert.equal(v.level, 41); assert.equal(v.pix_fmt, 'yuv420p'); assert.equal(v.r_frame_rate, '30/1'); assert.equal(v.width, 320); assert.equal(v.height, 240);
    assert.equal(a.codec_name, 'aac'); assert.equal(a.sample_rate, '48000'); assert.equal(a.channels, 2);
    const bytes = await readFile(plain.output); assert.ok(bytes.indexOf('moov') < bytes.indexOf('mdat'));
    const silent = await encode('silent', { rateControl: 'bitrate', bitrate: 800, width: 160, height: 120, fps: 24, audio: 'none' });
    const streams = JSON.parse((await runIntegrationProcess(ffprobe, ['-v', 'error', '-show_streams', '-of', 'json', silent.output])).stdout).streams;
    assert.equal(streams.length, 1); assert.equal(streams[0].width, 160); assert.equal(streams[0].r_frame_rate, '24/1');
    const ass = '[Script Info]\nScriptType: v4.00+\nPlayResX: 320\nPlayResY: 240\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,Arial,24,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,1,0,2,10,10,20,1\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:00.00,0:00:03.00,Default,,0,0,0,,VISIBLE SUBTITLE\n';
    for (const [name, text] of [['subtitle.srt', SRT.replace('00:00:00,000 --> 00:00:03,000', '00:00:00,600 --> 00:00:00,900')], ['subtitle.ass', ass.replace('0:00:00.00,0:00:03.00', '0:00:00.60,0:00:00.90')]]) {
        const burnt = await encode(name, { ...BUILTIN_VIDEO_PRESETS[0].options, start: 0.6, duration: 0.3, subtitleMode: 'burn' }, { name, text });
        // 实际解码一帧为灰度像素，黑底出现白色字幕，不能只检查编码命令。
        const frame = join(root, name + '.raw');
        await runIntegrationProcess(ffmpeg, ['-v', 'error', '-y', '-i', burnt.output, '-frames:v', '1', '-pix_fmt', 'gray', '-f', 'rawvideo', frame]);
        const pixels = await readFile(frame); assert.ok(pixels.filter(n => n > 180).length > 20, name + '字幕应出现在实际输出画面');
    }
    assert.deepEqual(await readFile(input), original);
});
