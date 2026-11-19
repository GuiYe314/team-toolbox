export const VIDEO_DEFAULTS = Object.freeze({ mode: 'compress', width: 1280, height: 720, fps: 0, rateControl: 'quality', crf: 24, bitrate: 4000, preset: 'fast', profile: 'auto', level: 'auto', audio: 'aac', audioBitrate: 128, sampleRate: 0, channels: 0, subtitleMode: 'none' });
export function templateOptions(options) {
    return Object.fromEntries(Object.keys(VIDEO_DEFAULTS).map(key => [key, options[key]]));
}
export function applyVideoPreset(options) { return { ...VIDEO_DEFAULTS, ...templateOptions(options), start: 0, duration: '' }; }
export function videoSummary(options) {
    if (options.mode === 'mp3') return `MP3 · ${options.audioBitrate} kbps`;
    if (options.mode === 'gif') return `GIF · ${options.fps || 10} fps`;
    const quality = options.rateControl === 'bitrate' ? `${options.bitrate} kbps` : `CRF ${options.crf}`;
    return `MP4 · H.264 · ${quality} · ${options.width || '原宽'} × ${options.height || '原高'} 上限 · ${options.fps ? options.fps + ' fps' : '原帧率'} · ${options.audio === 'none' ? '静音' : 'AAC'}`;
}
export async function videoPresetRequest(path = '', { method = 'GET', body, signal } = {}) {
    const response = await fetch('/api/video-presets' + path, {
        method, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000),
        headers: { 'X-Toolbox-Media': '1', ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {})
    });
    const value = await response.json();
    if (!response.ok) throw new Error(value.message || '模板操作失败，请重试');
    return value;
}
