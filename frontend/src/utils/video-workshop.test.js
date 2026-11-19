import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VIDEO_DEFAULTS, templateOptions, applyVideoPreset, videoSummary } from './video-workshop.js';
test('模板复用隔离本次裁剪时间及文件，参数快照不受后续编辑影响', () => {
    const form = { ...VIDEO_DEFAULTS, start: 50, duration: 5, file: 'private.mp4', subtitle: 'private.srt' };
    const saved = templateOptions(form); form.crf = 38;
    assert.equal(saved.crf, VIDEO_DEFAULTS.crf); assert.ok(!('start' in saved) && !('file' in saved) && !('subtitle' in saved));
    const applied = applyVideoPreset(saved); assert.equal(applied.start, 0); assert.equal(applied.duration, '');
    assert.match(videoSummary(applied), /H.264/); assert.match(videoSummary({ ...applied, rateControl: 'bitrate', bitrate: 2000 }), /2000 kbps/);
});
