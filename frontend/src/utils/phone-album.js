export const ALBUM_ACCEPT = 'image/*,video/*,.heic,.heif,.mov,.m4v,.livp';
const EXTENSIONS = /\.(jpe?g|png|gif|webp|bmp|avif|heic|heif|livp|mp4|mov|m4v|webm)$/i;
export function albumFileId() {
    return [...crypto.getRandomValues(new Uint8Array(16))].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
export function parseAlbumLink(hash) {
    const match = /^#([a-f0-9]{32})\.([a-f0-9]{48})$/.exec(hash || '');
    return match ? { id: match[1], uploadToken: match[2] } : null;
}
export function albumUploadUrl(origin, session) {
    const url = new URL(origin);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('接收地址无效');
    return `${url.origin}/phone-album#${session.id}.${session.uploadToken}`;
}
export function albumFileError(file, limits) {
    if (!EXTENSIONS.test(file.name)) return '不支持此格式，请选择照片或视频';
    if (!file.size) return '文件内容为空';
    if (file.size > limits.fileBytes) return '单个文件不能超过 1 GiB';
    return '';
}
export function albumSize(value) {
    if (!Number.isFinite(value) || value <= 0) return '0 B';
    const units = ['B', 'KiB', 'MiB', 'GiB'], power = Math.min(3, Math.floor(Math.log(value) / Math.log(1024)));
    return `${(value / 1024 ** power).toFixed(power ? 1 : 0)} ${units[power]}`;
}
