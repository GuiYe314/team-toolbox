import { mkdirSync, readFileSync, writeFileSync, renameSync, unlinkSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { appRoot } from './integration-common.js';
import { MediaToolError } from './media-tool-error.js';
import { videoOptions } from './video-options.js';

const unity = { width: 1920, height: 1080, fps: 30, crf: 22, preset: 'medium', profile: 'main', level: '4.1', sampleRate: 48000, channels: 2 };
export const BUILTIN_VIDEO_PRESETS = [
    ['unity-1080', 'Unity · 1080p / 30fps', 'MP4 · H.264 Main 4.1 · AAC双声道48kHz，需在目标平台试播', unity],
    ['unity-720', 'Unity · 720p / 30fps', '适合移动端的较小视频，需在目标平台试播', { ...unity, width: 1280, height: 720 }],
    ['balanced', '通用 · 均衡压制', '720p上限 · CRF 24 · 快速编码', { width: 1280, height: 720, crf: 24, preset: 'fast' }],
    ['quality', '通用 · 高画质', '1080p上限 · CRF 20 · 中等编码速度', { width: 1920, height: 1080, crf: 20, preset: 'medium' }],
    ['small', '通用 · 小体积', '720p / 30fps · CRF 30 · AAC 96kbps', { width: 1280, height: 720, fps: 30, crf: 30, audioBitrate: 96 }]
].map(([id, name, description, options]) => Object.freeze({ id, name, description, builtin: true, options: Object.freeze(videoOptions(options, { template: true })) }));
const idPattern = /^preset-[0-9a-f-]{36}$/;
const revisionPattern = /^[0-9a-f-]{36}$/;
function fail(message, status = 400) { throw new MediaToolError(message, status); }
function validFields(input, allowed) {
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !allowed.includes(key))) fail('模板字段无效');
}
function validate(input) {
    if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 40 || /[\x00-\x1f\x7f]/.test(input.name)) fail('模板名称请输入1～40个可见字符');
    return { name: input.name.trim(), options: videoOptions(input.options, { template: true }) };
}
export function createVideoPresets({ file = join(appRoot, 'data', 'video-presets.json') } = {}) {
    function read() {
        try {
            if (statSync(file).size > 128 * 1024) throw new Error('size');
            const data = JSON.parse(readFileSync(file, 'utf8'));
            validFields(data, ['version', 'items']);
            if (data.version !== 1 || !Array.isArray(data.items) || data.items.length > 50) throw new Error('format');
            const ids = new Set(), names = new Set(BUILTIN_VIDEO_PRESETS.map(item => item.name.toLowerCase()));
            return data.items.map(item => {
                validFields(item, ['id', 'revision', 'name', 'options']);
                if (!idPattern.test(item.id) || !revisionPattern.test(item.revision) || ids.has(item.id)) throw new Error('id');
                const value = validate(item), key = value.name.toLowerCase();
                if (names.has(key)) throw new Error('duplicate');
                ids.add(item.id); names.add(key);
                return { id: item.id, revision: item.revision, ...value };
            });
        } catch (error) {
            if (error.code === 'ENOENT') return [];
            fail('转码模板配置无法读取，请检查服务器data/video-presets.json；原文件未覆盖', 503);
        }
    }
    function write(items) {
        const temporary = `${file}.${randomUUID()}.tmp`;
        try {
            mkdirSync(dirname(file), { recursive: true });
            writeFileSync(temporary, JSON.stringify({ version: 1, items }), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
            renameSync(temporary, file);
        } catch { fail('模板保存失败，请检查工具箱数据目录权限；当前参数仍保留', 503); }
        finally { try { unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') fail('模板临时文件清理失败，请检查数据目录权限', 503); } }
    }
    function find(items, id, revision) {
        if (!idPattern.test(id)) fail('内置模板只读或模板编号无效');
        const current = items.find(item => item.id === id);
        if (!current) fail('模板已删除，请刷新列表', 404);
        if (current.revision !== revision) fail('模板已在其他页面更新，请刷新模板列表后重试；当前参数仍保留', 409);
        return current;
    }
    return {
        list() { return [...BUILTIN_VIDEO_PRESETS, ...read().map(item => ({ ...item, builtin: false }))]; },
        save(input, id) {
            validFields(input, id ? ['name', 'options', 'revision'] : ['name', 'options']);
            const value = validate(input), items = read();
            if (id) find(items, id, input.revision);
            else if (items.length >= 50) fail('最多保存50个模板，请先删除不再使用的模板');
            const names = [...items, ...BUILTIN_VIDEO_PRESETS];
            if (names.some(item => item.id !== id && item.name.toLowerCase() === value.name.toLowerCase())) fail('已有同名模板，请换一个名称');
            const record = { id: id || 'preset-' + randomUUID(), revision: randomUUID(), ...value };
            write(id ? items.map(item => item.id === id ? record : item) : [...items, record]);
            return { ...record, builtin: false };
        },
        remove(id, input) {
            validFields(input, ['confirm', 'revision']);
            if (input.confirm !== true) fail('请确认删除此模板');
            const items = read(); find(items, id, input.revision); write(items.filter(item => item.id !== id));
        }
    };
}
