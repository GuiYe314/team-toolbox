// Markdown 渲染：marked 解析 + sanitize-html 白名单净化（防存储型 XSS）
// 依据 docs/ARCHITECTURE.md 第 7 节：默认转义 HTML、仅白名单语法。

import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';

// marked 选项：禁止 HTML 直通，强制走代码块/行内代码；同步 API
marked.setOptions({
    gfm: true,
    breaks: false,
    // 解析器对原文里的 HTML 标签做转义：marked v14 通过 sanitizer 选项关闭内置转义，
    // 交由 sanitize-html 统一白名单控制；输入按普通 Markdown 处理。
});

// sanitize-html 白名单：仅放行常见排版标签与有限属性
const sanitizeOptions = {
    allowedTags: [
        'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
        'p', 'br', 'hr',
        'ul', 'ol', 'li',
        'strong', 'em', 'del', 'ins',
        'blockquote',
        'pre', 'code',
        'table', 'thead', 'tbody', 'tr', 'th', 'td',
        'a', 'img'
    ],
    allowedAttributes: {
        a: ['href', 'title', 'rel'],
        img: ['src', 'alt', 'title'],
        code: ['class'],     // 允许 language-* 由前端高亮时附加
        pre: ['class'],
        th: ['align'],
        td: ['align']
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    // 强制外链加 rel，防止 tabnabbing/opener
    transformTags: {
        a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer' }, true)
    },
    // 不允许 style、script 等危险内容
    disallowedTagsMode: 'discard'
};

/**
 * 把 Markdown 原文渲染为安全 HTML。
 * @param {string} md Markdown 原文
 * @returns {string} 已净化的 HTML
 */
export function renderMarkdown(md) {
    if (!md) return '';
    const rawHtml = marked.parse(md);
    return sanitizeHtml(rawHtml, sanitizeOptions);
}