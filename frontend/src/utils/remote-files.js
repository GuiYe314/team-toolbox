export const remoteProtocols = [{ label: 'SFTP · SSH 加密', value: 'sftp' }, { label: 'FTPS · 显式 TLS', value: 'ftps' }, { label: 'FTP · 明文', value: 'ftp' }];
export const defaultPort = protocol => protocol === 'sftp' ? 22 : 21;
export const parentRemotePath = path => path.replace(/\/+$/, '').replace(/\/[^/]*$/, '') || '/';
export function validateRemoteFiles(files) {
    if (!files.length || files.length > 100) return '每批请选择1～100个文件';
    if (files.some(file => file.size > 1024 ** 3)) return '单文件上限为1GiB';
    if (files.reduce((sum, file) => sum + file.size, 0) > 4 * 1024 ** 3) return '每批总大小上限为4GiB';
    if (files.some(file => !file.name || file.name.length > 180 || /[\/\\\x00-\x1f\x7f]/.test(file.name))) return '文件名过长或含有不支持的字符';
    if (new Set(files.map(file => file.name)).size !== files.length) return '同一批次不能选择同名文件，请分别上传';
    return '';
}
export function remoteBytes(bytes) {
    if (!Number.isFinite(bytes)) return '—';
    if (bytes < 1024) return `${bytes} B`;
    const unit = Math.min(3, Math.floor(Math.log(bytes) / Math.log(1024)));
    return `${(bytes / 1024 ** unit).toFixed(1)} ${['B', 'KiB', 'MiB', 'GiB'][unit]}`;
}
export const remoteState = state => ({ waiting: '等待', transferring: '传输中', success: '完成', failed: '失败', cancelled: '已停止' })[state] || state;
