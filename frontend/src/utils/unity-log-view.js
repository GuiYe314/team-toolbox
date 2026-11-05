const header = /^(\d{4}-\d\d-\d\dT\S+)\s+\[(Log|Warning|Error|Assert|Exception)\]\s*(?:\[thread:([^\]]+)\]\s*)?(.*)$/;
export function parseUnityLogs(text) {
    const entries = []; let current;
    for (const line of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
        const match = line.match(header);
        if (match) { current = { id: entries.length, time: match[1], level: match[2], thread: match[3] || '', message: match[4], detail: line }; entries.push(current); }
        else if (current) current.detail += '\n' + line;
        else if (line.trim()) { current = { id: 0, time: '', level: 'Log', thread: '', message: line, detail: line }; entries.push(current); }
    }
    return entries;
}
export function filterUnityLogs(entries, level, keyword) {
    const query = keyword.trim().toLocaleLowerCase();
    return entries.filter(entry => (level === 'all' || ['Error', 'Assert', 'Exception'].includes(entry.level) || level === 'warning' && entry.level === 'Warning')
        && (!query || entry.detail.toLocaleLowerCase().includes(query)));
}
export function formatLogBytes(bytes) {
    return bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KiB` : `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}
