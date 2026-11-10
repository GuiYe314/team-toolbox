/** 局域网 HTTP 没有 Clipboard API 时，使用用户点击触发的浏览器复制。 */
export async function copyText(text) {
    if (navigator.clipboard?.writeText) {
        try { await navigator.clipboard.writeText(text); return; } catch { /* 尝试兼容复制 */ }
    }
    const previous = document.activeElement;
    const selection = typeof previous?.selectionStart === 'number' ? [previous.selectionStart, previous.selectionEnd] : null;
    const area = document.createElement('textarea');
    area.value = text; area.readOnly = true; area.tabIndex = -1; area.className = 'clipboard-source';
    document.body.append(area);
    try {
        area.focus({ preventScroll: true }); area.select();
        if (!document.execCommand('copy')) throw new Error('浏览器未允许复制，请手动选择内容复制');
    } finally {
        area.remove(); previous?.focus({ preventScroll: true });
        if (selection) previous.setSelectionRange(...selection);
    }
}
