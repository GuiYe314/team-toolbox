import { MediaToolError } from './media-tool-error.js';

export const VIDEO_KEYS = Object.freeze(['mode', 'width', 'height', 'fps', 'rateControl', 'crf', 'bitrate', 'preset', 'profile', 'level', 'audio', 'audioBitrate', 'sampleRate', 'channels', 'subtitleMode']);
const fail = message => { throw new MediaToolError(message); };
function numeric(value, min, max, fallback, integer = false) {
    if (value === undefined || value === '') return fallback;
    if (!['number', 'string'].includes(typeof value) || !Number.isFinite(Number(value)) || Number(value) < min || Number(value) > max || (integer && !Number.isInteger(Number(value)))) fail(`参数应在 ${min}～${max} 之间`);
    return Number(value);
}
function choice(value, values, fallback) {
    if (value === undefined) return fallback;
    if (!values.includes(value)) fail('视频选项不在支持范围内');
    return value;
}
export function videoOptions(value = {}, { template = false } = {}) {
    const allowed = template ? VIDEO_KEYS : [...VIDEO_KEYS, 'start', 'duration'];
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key))) fail('视频处理选项无效');
    const mode = choice(value.mode, ['compress', 'trim', 'mp4', 'mp3', 'gif'], 'compress');
    const result = {
        mode,
        width: numeric(value.width, 0, 3840, mode === 'gif' ? 480 : 1280, true),
        height: numeric(value.height, 0, 2160, 0, true),
        fps: choice(value.fps, [0, 10, 15, 24, 25, 30, 50, 60], mode === 'gif' ? 10 : 0),
        rateControl: choice(value.rateControl, ['quality', 'bitrate'], 'quality'),
        crf: numeric(value.crf, 18, 38, 26, true),
        bitrate: numeric(value.bitrate, 100, 50000, 4000, true),
        preset: choice(value.preset, ['ultrafast', 'superfast', 'veryfast', 'faster', 'fast', 'medium', 'slow', 'slower', 'veryslow'], 'veryfast'),
        profile: choice(value.profile, ['auto', 'baseline', 'main', 'high'], 'auto'),
        level: choice(value.level, ['auto', '3.1', '4.0', '4.1', '5.1'], 'auto'),
        audio: choice(value.audio, ['aac', 'none'], 'aac'),
        audioBitrate: choice(value.audioBitrate, [64, 96, 128, 160, 192, 256, 320], 128),
        sampleRate: choice(value.sampleRate, [0, 44100, 48000], 0),
        channels: choice(value.channels, [0, 1, 2], 0),
        subtitleMode: choice(value.subtitleMode, ['none', 'burn'], 'none')
    };
    if ((result.width && result.width < 160) || (result.height && result.height < 120)) fail('最大宽度至少160，最大高度至少120；0表示不限制');
    if (['mp3', 'gif'].includes(mode) && result.subtitleMode !== 'none') fail('字幕烧录仅支持MP4视频输出');
    if (!template) {
        result.start = numeric(value.start, 0, 86400, 0);
        result.duration = numeric(value.duration, 0.1, 7200, undefined);
    }
    return result;
}

export function videoArguments(input, output, options, subtitle = '') {
    const o = videoOptions(options);
    if (o.subtitleMode === 'burn' && !['subtitle.srt', 'subtitle.ass'].includes(subtitle)) fail('请选择本次使用的SRT或ASS字幕文件');
    const args = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-protocol_whitelist', 'file,pipe', '-max_alloc', '268435456'];
    if (o.start) args.push('-ss', String(o.start));
    args.push('-format_whitelist', 'mov,matroska,webm,avi,mpegts,mpeg,mpegvideo', '-i', input);
    if (o.duration && o.mode !== 'gif') args.push('-t', String(o.duration));
    if (o.mode === 'mp3') {
        args.push('-map', '0:a:0', '-vn', '-c:a', 'libmp3lame', '-b:a', `${o.audioBitrate}k`);
        if (o.sampleRate) args.push('-ar', String(o.sampleRate));
        if (o.channels) args.push('-ac', String(o.channels));
    } else {
        // 两边均为偶数，不放大，保持宽高比；兼容奇数尺寸输入。
        const width = o.width || 3840, height = o.height || 2160;
        const filters = [`scale=w='min(${width},iw)':h='min(${height},ih)':force_original_aspect_ratio=decrease:force_divisible_by=2`, 'setsar=1'];
        if (o.mode === 'gif') {
            filters.unshift(`fps=${o.fps || 10}`);
            args.push('-t', String(Math.min(o.duration || 10, 30)), '-an', '-vf', filters.join(','), '-loop', '0');
        } else {
            // -ss位于输入前，烧录字幕要加回原始时间，再恢复输出从0开始。
            if (o.subtitleMode === 'burn') filters.push(`setpts=PTS+${o.start}/TB`, `subtitles=filename=${subtitle}`, 'setpts=PTS-STARTPTS');
            if (o.fps) filters.push(`fps=${o.fps}`);
            args.push('-map', '0:v:0', '-vf', filters.join(','), '-c:v', 'libx264', '-preset', o.preset);
            if (o.rateControl === 'quality') args.push('-crf', String(o.crf));
            else args.push('-b:v', `${o.bitrate}k`, '-maxrate', `${Math.round(o.bitrate * 1.5)}k`, '-bufsize', `${o.bitrate * 2}k`);
            if (o.profile !== 'auto') args.push('-profile:v', o.profile);
            if (o.level !== 'auto') args.push('-level:v', o.level);
            args.push('-pix_fmt', 'yuv420p');
            if (o.audio === 'none') args.push('-an');
            else {
                args.push('-map', '0:a:0?', '-c:a', 'aac', '-b:a', `${o.audioBitrate}k`);
                if (o.sampleRate) args.push('-ar', String(o.sampleRate));
                if (o.channels) args.push('-ac', String(o.channels));
            }
            args.push('-movflags', '+faststart');
        }
    }
    args.push('-threads', '2', '-fs', String(256 * 1024 ** 2), output);
    return args;
}
