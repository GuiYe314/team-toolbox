// 资源类型元数据：图标、文案、可预览性、筛选分组。
//
// 为什么集中在这里而不是散在各组件：
//   「GLB 用什么图标」「哪些类型能预览」这两个问题会在列表、网格、
//   详情、预览弹窗、上传队列五处被问到。散着写必然出现同一个 GLB
//   在列表里是立方体、在详情里是文件图标的不一致。
//
// 类型枚举必须与后端 asset-storage.js 的 ASSET_TYPE 严格一致。

/** 资产类型 → 元数据。图标是 Lucide 路径（24 视图 / 无填充），与全局 .icon 同风格。 */
export const ASSET_TYPES = {
    image: {
        label: '图片',
        icon: 'image',
        paths: [
            'M4 4.5h16v15H4z',
            'M4 15.5l4.5-4.5 3.5 3.5 3-3 5 5',
            'M9 9.5a1.2 1.2 0 1 1 0-2.4 1.2 1.2 0 0 1 0 2.4z'
        ]
    },
    video: {
        label: '视频',
        icon: 'video',
        paths: [
            'M3 6.5h12v11H3z',
            'M15 10.5l6-3.5v10l-6-3.5z'
        ]
    },
    audio: {
        label: '音频',
        icon: 'audio',
        paths: ['M9 18V6l10-2v12', 'M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0z', 'M19 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z']
    },
    model: {
        label: '3D 模型',
        icon: 'cube',
        paths: [
            'M12 3.2 20 7.4v9.2l-8 4.2-8-4.2V7.4z',
            'M12 11.6 20 7.4',
            'M12 11.6v9.2',
            'M12 11.6 4 7.4'
        ]
    },
    pdf: {
        label: 'PDF',
        icon: 'file-text',
        paths: ['M14 3.5H6.8A1.8 1.8 0 0 0 5 5.3v13.4a1.8 1.8 0 0 0 1.8 1.8h10.4a1.8 1.8 0 0 0 1.8-1.8V8.5z', 'M13.8 3.6v4.2H19', 'M8.6 13.4h6.8', 'M8.6 16.6h4.4']
    },
    markdown: {
        label: 'Markdown',
        icon: 'file-code',
        paths: ['M14 3.5H6.8A1.8 1.8 0 0 0 5 5.3v13.4a1.8 1.8 0 0 0 1.8 1.8h10.4a1.8 1.8 0 0 0 1.8-1.8V8.5z', 'M13.8 3.6v4.2H19', 'M8.4 16.4v-4.2l2 2.2 2-2.2v4.2']
    },
    text: {
        label: '文本 / 代码',
        icon: 'file-text',
        paths: ['M14 3.5H6.8A1.8 1.8 0 0 0 5 5.3v13.4a1.8 1.8 0 0 0 1.8 1.8h10.4a1.8 1.8 0 0 0 1.8-1.8V8.5z', 'M13.8 3.6v4.2H19', 'M8.6 13h6.8', 'M8.6 16.4h4.6']
    },
    archive: {
        label: '压缩包',
        icon: 'archive',
        paths: [
            'M3.5 6.5h17v4h-17z',
            'M5 10.5v8.5a1.5 1.5 0 0 0 1.5 1.5h11a1.5 1.5 0 0 0 1.5-1.5v-8.5',
            'M10 14.2h4'
        ]
    },
    other: {
        label: '其他',
        icon: 'file',
        paths: ['M14 3.5H6.8A1.8 1.8 0 0 0 5 5.3v13.4a1.8 1.8 0 0 0 1.8 1.8h10.4a1.8 1.8 0 0 0 1.8-1.8V8.5z', 'M13.8 3.6v4.2H19']
    }
};

/** 类型筛选栏的排列顺序（按使用频率，不是字母序）。 */
export const TYPE_FILTER_ORDER = [
    'all', 'image', 'video', 'audio', 'model',
    'pdf', 'markdown', 'text', 'archive', 'other'
];

/** 状态枚举（与后端 asset-store.js 的 ASSET_STATUS 一致）。 */
export const ASSET_STATUS = {
    draft: { label: '草稿', tone: 'neutral' },
    published: { label: '已发布', tone: 'success' },
    deprecated: { label: '已废弃', tone: 'warning' }
};

export const STATUS_FILTER_ORDER = ['all', 'draft', 'published', 'deprecated'];

/** 排序选项（与后端 SORT_COLUMNS 白名单一致）。 */
export const SORT_OPTIONS = [
    { value: 'updated_at', label: '更新时间' },
    { value: 'created_at', label: '创建时间' },
    { value: 'name', label: '名称' },
    { value: 'size', label: '大小' },
    { value: 'version', label: '版本' }
];

/** 操作类型 → 中文（操作记录 Tab 与详情里用）。 */
export const ACTION_LABELS = {
    upload: '上传',
    create_version: '创建版本',
    publish: '发布',
    unpublish: '取消发布',
    restore: '恢复版本',
    delete_version: '删除版本',
    rename: '重命名',
    move: '移动',
    delete: '移入回收站',
    add_tags: '添加标签',
    update: '更新信息'
};

/** 取类型元数据；未知类型退化为 other，绝不抛错（脏数据不该让整页崩）。 */
export function typeMeta(type) {
    return ASSET_TYPES[type] || ASSET_TYPES.other;
}

/** 类型的中文标签。 */
export function typeLabel(type) {
    return typeMeta(type).label;
}

/**
 * 字节体积 → 人类可读。
 * 用 1024 进制并保留一位小数；小于 1KB 显示字节数。
 */
export function formatSize(bytes) {
    const n = Number(bytes);
    if (!Number.isFinite(n) || n <= 0) return '0 B';
    if (n < 1024) return `${n} B`;
    const units = ['KB', 'MB', 'GB', 'TB'];
    let v = n / 1024;
    let i = 0;
    while (v >= 1024 && i < units.length - 1) {
        v /= 1024;
        i++;
    }
    return `${v.toFixed(v >= 100 ? 0 : 1)} ${units[i]}`;
}

/** ISO 时间 → 相对时间（列表里比绝对时间更好扫读）。 */
export function formatRelative(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso);
    // 后端存的是 UTC（datetime('now')），补 Z 才能正确解析
    const t = new Date(d.getTime());
    const diff = Date.now() - t.getTime();
    const min = Math.floor(diff / 60000);
    if (min < 1) return '刚刚';
    if (min < 60) return `${min} 分钟前`;
    const hour = Math.floor(min / 60);
    if (hour < 24) return `${hour} 小时前`;
    const day = Math.floor(hour / 24);
    if (day < 30) return `${day} 天前`;
    const mon = Math.floor(day / 30);
    if (mon < 12) return `${mon} 个月前`;
    return `${Math.floor(mon / 12)} 年前`;
}

/** ISO 时间 → 绝对时间（详情页用）。 */
export function formatDateTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso);
    return d.toLocaleString('zh-CN', {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit'
    });
}

/** 预览状态文案（预览管线）。 */
export const PREVIEW_STATUS_LABELS = {
    none: '未生成',
    pending: '等待生成',
    processing: '正在生成',
    ready: '预览已就绪',
    failed: '预览生成失败'
};

/**
 * 判断某类型在浏览器内是否有预览器。
 * 与后端 asset-storage.js 的 isViewableType 保持一致 ——
 * 前端据此决定「预览」按钮是否可用，后端据实际文件存在性兜底。
 */
export function hasPreviewProvider(type) {
    return ['image', 'video', 'audio', 'model', 'pdf', 'markdown', 'text'].includes(type);
}