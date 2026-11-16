export function parsePageSelection(value, pageCount) {
    if (!Number.isInteger(pageCount) || pageCount < 1 || pageCount > 2000) throw new Error('PDF 页数无效或超过2000页');
    if (typeof value !== 'string' || value.length > 4000) throw new Error('页码范围过长');
    if (!value.trim()) return Array.from({ length: pageCount }, (_, index) => index);
    const pages = [], seen = new Set();
    for (const part of value.split(/[,，]/)) {
        const match = /^\s*(\d+)(?:\s*-\s*(\d+))?\s*$/.exec(part);
        if (!match) throw new Error('页码格式示例：1-3,5,8');
        const start = Number(match[1]), end = Number(match[2] || match[1]);
        if (start < 1 || end < start || end > pageCount) throw new Error(`页码必须在1～${pageCount}以内，范围从小到大`);
        for (let page = start; page <= end; page++) if (!seen.has(page)) { pages.push(page - 1); seen.add(page); }
    }
    return pages;
}
export async function buildPdf(files, options = {}, { signal, onProgress } = {}) {
    if (!files?.length || files.length > 30) throw new Error('请选择1～30个文件');
    if (files.some(file => !file.size || file.size > 64 * 1024 ** 2) || files.reduce((sum, file) => sum + file.size, 0) > 128 * 1024 ** 2) throw new Error('每个文件最多64MiB，全部文件最多128MiB');
    const { PDFDocument, degrees, StandardFonts, rgb } = await import('pdf-lib');
    const output = await PDFDocument.create(), imageMode = options.mode === 'images', font = options.watermark ? await output.embedFont(StandardFonts.Helvetica) : null;
    if (options.watermark && (!/^[\x20-\x7e]{1,80}$/.test(options.watermark))) throw new Error('PDF 水印请输入最多80个英文字母、数字或英文符号');
    const check = () => { if (signal?.aborted) throw new DOMException('处理已停止', 'AbortError'); };
    for (let index = 0; index < files.length; index++) {
        check(); const file = files[index], bytes = await file.arrayBuffer(); check();
        if (imageMode) {
            if (!/\.(png|jpe?g)$/i.test(file.name)) throw new Error('图片转 PDF 支持 JPG 和 PNG');
            const image = /\.png$/i.test(file.name) ? await output.embedPng(bytes) : await output.embedJpg(bytes);
            if (image.width * image.height > 32 * 1024 ** 2) throw new Error('单张图片不能超过3200万像素');
            const scale = Math.min(1, 595 / image.width, 842 / image.height), page = output.addPage([image.width * scale, image.height * scale]);
            page.drawImage(image, { x: 0, y: 0, width: page.getWidth(), height: page.getHeight() });
        } else {
            let source;
            try { source = await PDFDocument.load(bytes, { updateMetadata: false }); } catch { throw new Error(`${file.name} 无法读取，可能已加密或文件损坏`); }
            const indices = parsePageSelection(options.pages || '', source.getPageCount());
            if (output.getPageCount() + indices.length > 2000) throw new Error('输出 PDF 最多2000页');
            for (const page of await output.copyPages(source, indices)) { check(); output.addPage(page); }
        }
        onProgress?.(index + 1, files.length);
        await new Promise(resolve => setTimeout(resolve, 0));
    }
    for (const page of output.getPages()) {
        check(); const rotation = Number(options.rotation || 0);
        if (![0, 90, 180, 270].includes(rotation)) throw new Error('旋转角度无效');
        if (rotation) page.setRotation(degrees((page.getRotation().angle + rotation) % 360));
        if (options.watermark) page.drawText(options.watermark, { x: 24, y: Math.max(24, page.getHeight() / 2), font, size: Math.min(28, Math.max(8, (page.getWidth() - 48) / Math.max(options.watermark.length, 1))), color: rgb(0.45, 0.45, 0.45), opacity: 0.35, rotate: degrees(25) });
    }
    const result = await output.save(); check(); return new Blob([result], { type: 'application/pdf' });
}
