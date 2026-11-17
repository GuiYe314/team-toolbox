import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import { isIP } from 'node:net';
import sanitizeHtml from 'sanitize-html';
import { decodeHtml } from './video-page.js';
import { createDocument } from './store.js';
import { fail, array, object, text } from './knowledge-workbench-validation.js';

export function publicIPv4(address) {
    if (isIP(address) !== 4) return false;
    const [a, b, c] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || a === 100 && b >= 64 && b <= 127 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && (b === 168 || b === 0 || b === 2 || b === 88 && c === 99) || a === 198 && (b === 18 || b === 19 || b === 51 && c === 100) || a === 203 && b === 0 && c === 113);
}
export async function clipTarget(value, resolver = lookup) {
    text(value, 2000, false); let url; try { url = new URL(value); } catch { fail('请输入完整HTTPS网页地址'); }
    if (url.protocol !== 'https:' || url.username || url.password || url.port && url.port !== '443' || isIP(url.hostname.replace(/[\[\]]/g, '')) === 6) fail('只支持无凭据的公开HTTPS网页（IPv4）');
    const records = isIP(url.hostname) ? [{ address: url.hostname, family: 4 }] : await resolver(url.hostname, { all: true, family: 4 });
    if (!records.length || records.some(row => !publicIPv4(row.address))) fail('网页地址不能指向本机、内网或保留地址');
    url.hash = ''; return { url, address: records[0].address };
}
function receive(target, signal) {
    return new Promise((resolve, reject) => {
        const req = request(target.url, { signal, family: 4, autoSelectFamily: false, headers: { accept: 'text/html', 'accept-encoding': 'identity', 'user-agent': 'TeamToolbox-Clipper/1.0' }, lookup: (_host, _options, callback) => callback(null, target.address, 4), timeout: 8000 }, res => {
            if ([301, 302, 303, 307, 308].includes(res.statusCode)) { res.resume(); resolve({ redirect: new URL(res.headers.location || '', target.url).href }); return; }
            if (res.statusCode !== 200 || !/^(text\/html|application\/xhtml\+xml)(?:;|$)/i.test(res.headers['content-type'] || '') || res.headers['content-encoding'] && res.headers['content-encoding'] !== 'identity') { res.resume(); reject(new Error('网页不提供可读取的HTML内容')); return; }
            let size = 0; const chunks = [];
            res.on('data', chunk => { size += chunk.length; if (size > 1048576) { req.destroy(new Error('网页超过1MiB限制')); return; } chunks.push(chunk); });
            res.on('error', reject); res.on('end', () => resolve({ html: Buffer.concat(chunks).toString('utf8') }));
        });
        req.on('timeout', () => req.destroy(new Error('网页读取超时'))); req.on('error', reject); req.end();
    });
}
export function clipHtml(html, url) {
    const clean = sanitizeHtml(html, { allowedTags: ['h1', 'h2', 'h3', 'p', 'br', 'li', 'pre', 'blockquote', 'strong', 'em'], allowedAttributes: {}, nonTextTags: ['script', 'style', 'textarea', 'option', 'noscript', 'nav', 'footer', 'header', 'svg', 'form'] });
    const title = decodeHtml(sanitizeHtml((/<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html) || [])[1] || '网页剪藏', { allowedTags: [], allowedAttributes: {} })).trim().slice(0, 100) || '网页剪藏';
    const body = decodeHtml(clean.replace(/<h([123])>/g, (_, level) => '\n' + '#'.repeat(Number(level)) + ' ').replace(/<li>/g, '\n- ').replace(/<br\s*\/?\s*>/g, '\n').replace(/<\/(?:p|h[123]|pre|blockquote|li)>/g, '\n\n').replace(/<[^>]+>/g, '')).replace(/\n{3,}/g, '\n\n').trim().slice(0, 100000);
    if (!body) fail('网页没有可剪藏的文字');
    return { title, content_md: `来源：${url}\n\n${body}`, url };
}
export async function clipWebPage(value, { signal, resolver = lookup, receiver = receive } = {}) {
    const deadline = AbortSignal.any([AbortSignal.timeout(12000), ...(signal ? [signal] : [])]); let url = value;
    for (let hop = 0; hop < 4; hop++) {
        const target = await Promise.race([clipTarget(url, resolver), new Promise((_, reject) => { if (deadline.aborted) reject(new Error('剪藏已取消或超时')); else deadline.addEventListener('abort', () => reject(new Error('剪藏已取消或超时')), { once: true }); })]);
        deadline.throwIfAborted(); const page = await receiver(target, deadline);
        if (page.redirect) { url = page.redirect; continue; }
        return clipHtml(page.html, target.url.href);
    }
    fail('网页跳转次数超过限制');
}
export function importMarkdownFiles(db, input) {
    const files = array(input.files, 500), paths = new Set(); let bytes = 0;
    const prepared = files.map(file => {
        object(file); text(file.path, 600, false); text(file.content, 1048576); bytes += Buffer.byteLength(file.content);
        if (bytes > 8388608 || file.path.includes('\\') || file.path.startsWith('/') || file.path.split('/').some(part => !part || part === '.' || part === '..' || /[:\x00-\x1f]/.test(part)) || !/\.md$/i.test(file.path)) fail('仅支持安全的相对Markdown路径，总量最多8MiB');
        if (paths.has(file.path.normalize('NFKC').toLowerCase())) fail('导入路径重复'); paths.add(file.path.normalize('NFKC').toLowerCase());
        const segments = file.path.replace(/\.md$/i, '').split('/'); if (segments.length > 16 || segments.some(part => part.length > 100)) fail('目录最多16层，每级名称最多100字');
        return { segments, content: file.content };
    });
    return db.transaction(() => {
        let imported = 0, skipped = 0; const mapped = new Map();
        // 父页面的真实md优先于为文件夹创建的空白页。
        const content = new Map(prepared.map(file => [file.segments.join('/'), file.content]));
        for (const file of prepared.sort((a, b) => a.segments.length - b.segments.length)) {
            let parent = null;
            for (let i = 0; i < file.segments.length; i++) {
                const path = file.segments.slice(0, i + 1).join('/');
                if (mapped.has(path)) { parent = mapped.get(path); continue; }
                const existing = db.prepare('SELECT id,is_deleted FROM documents WHERE parent_id IS ? AND title=? ORDER BY id LIMIT 1').get(parent, file.segments[i]);
                if (existing?.is_deleted) fail('同名页面在回收站中，请先恢复或改名再导入');
                if (existing) { parent = existing.id; skipped++; }
                else { parent = createDocument({ connection: db, parent_id: parent, title: file.segments[i], content_md: content.get(path) || '' }).id; imported++; }
                mapped.set(path, parent);
            }
        }
        return { imported, skipped };
    })();
}
export function markdownExportFiles(db) {
    const rows = db.prepare('SELECT id,parent_id,title,content_md FROM documents WHERE is_deleted=0 ORDER BY id LIMIT 501').all();
    if (rows.length > 500) fail('单次Markdown导出最多500篇，请使用内容备份导出完整资料');
    const paths = new Map(), used = new Set(); let size = 0;
    function path(row, trail = new Set()) {
        if (paths.has(row.id)) return paths.get(row.id); if (trail.has(row.id) || trail.size >= 64) fail('页面层级异常，请先整理'); trail.add(row.id);
        const parent = rows.find(p => p.id === row.parent_id), prefix = parent ? path(parent, trail) + '/' : '';
        const name = row.title.replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').replace(/[. ]+$/, '').slice(0, 80) || '笔记'; let result = prefix + name;
        if (used.has(result.normalize('NFKC').toLowerCase())) result += '-' + row.id;
        used.add(result.normalize('NFKC').toLowerCase()); paths.set(row.id, result); return result;
    }
    return rows.map(row => { size += Buffer.byteLength(row.content_md); if (size > 8388608) fail('Markdown导出超过8MiB，请使用完整备份'); return { path: path(row) + '.md', content: row.content_md }; });
}
