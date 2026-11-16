// 只接收本地 Excalidraw 图形/内嵌位图，不载入外部 iframe 或任意资源 URL。
export function validateBoard(value) {
    if (!value || value.type !== 'excalidraw' || !Array.isArray(value.elements) || value.elements.length > 5000) throw new Error('不是有效的 Excalidraw 文件，或超过5000个元素');
    if (value.elements.some(element => !element || typeof element.id !== 'string' || element.type === 'embeddable' || typeof element.link === 'string' && element.link && !/^https?:\/\//i.test(element.link))) throw new Error('图纸包含不支持的嵌入或链接');
    const files = value.files || {};
    if (typeof files !== 'object' || Array.isArray(files) || Object.keys(files).length > 100) throw new Error('图纸的内嵌图片数量无效');
    for (const file of Object.values(files)) if (!file || typeof file.dataURL !== 'string' || !/^data:image\/(png|jpeg|webp|gif);base64,[a-z\d+/=]+$/i.test(file.dataURL) || file.dataURL.length > 16 * 1024 ** 2) throw new Error('图纸仅支持受大小限制的内嵌位图');
    return { elements: value.elements, files, appState: { viewBackgroundColor: typeof value.appState?.viewBackgroundColor === 'string' && /^#[a-f\d]{6}$/i.test(value.appState.viewBackgroundColor) ? value.appState.viewBackgroundColor : undefined } };
}
