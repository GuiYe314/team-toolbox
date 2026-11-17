import { Marked } from 'marked';
import sanitizeHtml from 'sanitize-html';
import { renderMarkdown } from './markdown.js';

const normalize = value => String(value).normalize('NFKC').trim().toLowerCase();
const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const parser = new Marked();
export function noteOutline(md) {
    return parser.lexer(md).filter(token => token.type === 'heading').map((token, index) => ({ id: `h-${index}`, text: token.text, depth: token.depth }));
}
function wikiTokens(md) {
    const found = [];
    // Marked owns code/fence parsing. Only ordinary inline text is examined.
    parser.walkTokens(parser.lexer(md), token => {
        if (token.type !== 'text' || token.tokens?.length) return;
        for (const match of token.text.matchAll(/(!?)\[\[([^\]\n]{1,300})\]\]/g)) found.push({ embed: !!match[1], raw: match[2] });
    });
    return found;
}
export function parseReference(raw) {
    const [target, ...label] = raw.split('|'), hash = target.indexOf('#');
    return { note: (hash < 0 ? target : target.slice(0, hash)).trim(), anchor: hash < 0 ? '' : target.slice(hash + 1).trim(), label: label.join('|').trim() || target };
}
export function resolveReference(raw, notes, currentId) {
    const parsed = parseReference(raw), key = normalize(parsed.note);
    const candidates = !key ? notes.filter(n => n.id === currentId) : notes.lookup ? notes.lookup.get(key) || [] : /^id:\d+$/.test(key) ? notes.filter(n => n.id === Number(key.slice(3))) : notes.filter(n => normalize(n.path) === key || normalize(n.title) === key);
    return { ...parsed, status: candidates.length === 1 ? 'resolved' : candidates.length ? 'ambiguous' : 'missing', candidates, target: candidates.length === 1 ? candidates[0] : null };
}
export function buildKnowledgeIndex(db) {
    const rows = db.prepare('SELECT id,title,parent_id,version,updated_at FROM documents WHERE is_deleted=0 ORDER BY id LIMIT 2001').all();
    let truncated = rows.length > 2000, bytes = 0; const selected = rows.slice(0, 2000), byId = new Map(selected.map(n => [n.id, n]));
    const notes = selected.map(row => {
        const names = [row.title], visited = new Set([row.id]); let parent = byId.get(row.parent_id);
        while (parent && !visited.has(parent.id) && visited.size < 64) { visited.add(parent.id); names.unshift(parent.title); parent = byId.get(parent.parent_id); }
        const meta = db.prepare('SELECT data,version FROM kb_note_meta WHERE document_id=?').get(row.id);
        return { ...row, path: names.join('/'), meta: meta ? { ...JSON.parse(meta.data), version: meta.version } : { databaseId: null, values: {}, version: 0 } };
    });
    const content = new Map(), edges = [], unresolved = [];
    const lookup = new Map();
    for (const note of notes) for (const key of new Set([normalize(note.path), normalize(note.title), 'id:' + note.id])) {
        if (!lookup.has(key)) lookup.set(key, []); lookup.get(key).push(note);
    }
    Object.defineProperty(notes, 'lookup', { value: lookup });
    for (const note of notes) {
        const md = db.prepare('SELECT content_md FROM documents WHERE id=?').get(note.id).content_md;
        bytes += Buffer.byteLength(md); if (bytes > 8388608) { truncated = true; continue; }
        content.set(note.id, md); note.snippet = md.replace(/[#*_`\[\]]/g, '').slice(0, 140);
        for (const item of wikiTokens(md).slice(0, 300)) {
            if (item.raw.startsWith('block:')) continue;
            const link = resolveReference(item.raw, notes, note.id);
            if (link.target) { if (edges.length < 10000) edges.push({ from: note.id, to: link.target.id, embed: item.embed, anchor: link.anchor }); else truncated = true; }
            else if (unresolved.length < 1000) unresolved.push({ from: note.id, reference: item.raw, status: link.status });
        }
    }
    return { notes, edges, unresolved, truncated, content };
}
export function remapWikiNoteIds(md, docMap) {
    return parser.lexer(md).map(token => {
        if (['code', 'html'].includes(token.type)) return token.raw;
        return token.raw.replace(/(`+)([\s\S]*?)\1|(!?\[\[)id:(\d+)(?=[#|\]])/g, (raw, code, _body, prefix, id) => code ? raw : docMap.has(Number(id)) ? `${prefix}id:${docMap.get(Number(id))}` : `${prefix}missing-id:${id}`);
    }).join('');
}
function fragment(md, anchor) {
    if (!anchor) return md.slice(0, 60000);
    const tokens = parser.lexer(md);
    if (anchor.startsWith('^')) { const token = tokens.find(t => (t.raw || '').trimEnd().endsWith(anchor)); return token ? token.raw.trimEnd().slice(0, -anchor.length).trimEnd() : null; }
    const index = tokens.findIndex(t => t.type === 'heading' && normalize(t.text) === normalize(anchor));
    if (index < 0) return null;
    let end = index + 1; while (end < tokens.length && !(tokens[end].type === 'heading' && tokens[end].depth <= tokens[index].depth)) end++;
    return tokens.slice(index, end).map(t => t.raw).join('').slice(0, 60000);
}
export function renderKnowledgeNote(db, note, index = buildKnowledgeIndex(db)) {
    const outline = noteOutline(note.content_md), outgoing = [], backlinks = index.edges.filter(e => e.to === note.id).map(e => index.notes.find(n => n.id === e.from));
    const linkedFrom = new Set(backlinks.map(n => n.id));
    const mentions = index.notes.filter(n => n.id !== note.id && !linkedFrom.has(n.id) && (index.content.get(n.id) || '').replace(/```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`]*`/g, '').includes(note.title));
    let heading = 0, embedBudget = 240000;
    const md = new Marked({ extensions: [{
        name: 'knowledgeWiki', level: 'inline', start: src => src.search(/!?\[\[/),
        tokenizer(src) { const match = /^(!?)\[\[([^\]\n]{1,300})\]\]/.exec(src); return match ? { type: 'knowledgeWiki', raw: match[0], embed: !!match[1], reference: match[2] } : undefined; },
        renderer(token) {
            if (token.reference.startsWith('block:') && token.embed) {
                const id = token.reference.slice(6), row = /^[0-9a-f-]{36}$/i.test(id) && db.prepare("SELECT data FROM kb_entries WHERE id=? AND kind='block'").get(id);
                if (!row) return '<span class="kb-broken">同步块不存在</span>';
                const body = JSON.parse(row.data).content; embedBudget -= body.length;
                return embedBudget < 0 ? '<span>嵌入内容达到上限</span>' : `<span class="kb-embed">${renderMarkdown(body)}</span>`;
            }
            const link = resolveReference(token.reference, index.notes, note.id); outgoing.push({ reference: token.reference, status: link.status, candidates: link.candidates.map(n => ({ id: n.id, path: n.path })) });
            if (!link.target) return `<span class="kb-broken" title="${link.status === 'ambiguous' ? '名称重复，请使用完整路径或id:编号' : '笔记不存在'}">${escape(link.label)}（${link.status === 'ambiguous' ? '重名' : '缺失'}）</span>`;
            const target = link.target, targetMd = index.content.get(target.id) ?? db.prepare('SELECT content_md FROM documents WHERE id=? AND is_deleted=0').get(target.id)?.content_md;
            const targetOutline = noteOutline(targetMd || '');
            const anchorId = link.anchor.startsWith('^') ? 'b-' + link.anchor.slice(1) : targetOutline.find(h => normalize(h.text) === normalize(link.anchor))?.id;
            const href = `/kb/workbench?note=${target.id}${anchorId ? '&anchor=' + encodeURIComponent(anchorId) : ''}`;
            if (!token.embed) return `<a href="${escape(href)}" data-note-id="${target.id}" data-anchor="${escape(anchorId || '')}">${escape(link.label)}</a>`;
            const body = fragment(targetMd || '', link.anchor); embedBudget -= (body || '').length;
            return `<span class="kb-embed"><a href="${escape(href)}" data-note-id="${target.id}">${escape(target.title)}</a>${body === null ? '<span class="kb-broken">引用的标题或块不存在</span>' : embedBudget < 0 ? '<span>嵌入内容达到上限</span>' : renderMarkdown(body)}</span>`;
        }
    }, {
        name: 'knowledgeCallout', level: 'block', start: src => src.indexOf(':::'),
        tokenizer(src) { const match = /^:::(toggle|callout)\s+([^\n]{1,100})\n([\s\S]*?)\n:::(?:\n|$)/.exec(src); return match ? { type: 'knowledgeCallout', raw: match[0], kind: match[1], title: match[2], body: match[3] } : undefined; },
        renderer(token) { const inner = renderMarkdown(token.body); return token.kind === 'toggle' ? `<details><summary>${escape(token.title)}</summary>${inner}</details>` : `<aside class="kb-callout"><strong>${escape(token.title)}</strong>${inner}</aside>`; }
    }], renderer: {
        heading(token) { return `<h${token.depth} id="h-${heading++}">${this.parser.parseInline(token.tokens)}</h${token.depth}>`; },
        paragraph(token) { const html = this.parser.parseInline(token.tokens), match = /\s+\^([a-zA-Z0-9_-]{1,40})\s*$/.exec(token.text); return `<p${match ? ` id="b-${match[1]}"` : ''}>${match ? html.replace(/\s+\^[a-zA-Z0-9_-]{1,40}\s*$/, '') : html}</p>`; }
    } });
    const html = sanitizeHtml(md.parse(note.content_md || ''), {
        allowedTags: [...sanitizeHtml.defaults.allowedTags, 'img', 'details', 'summary', 'aside', 'span'],
        allowedAttributes: { a: ['href', 'title', 'data-note-id', 'data-anchor'], img: ['src', 'alt', 'title'], '*': ['class', 'id'], th: ['align'], td: ['align'] },
        allowedSchemes: ['http', 'https', 'mailto'], allowProtocolRelative: false,
        transformTags: { a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer' }, true) }
    });
    return { html, outline, outgoing, backlinks: [...new Map(backlinks.map(n => [n.id, { id: n.id, path: n.path }])).values()], mentions: mentions.slice(0, 100).map(n => ({ id: n.id, path: n.path })), truncated: index.truncated };
}
