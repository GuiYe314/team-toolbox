// 本地 unstyled 适配，复用工具箱主题；不加载第二套图标或在线主题。
export function primeVueOptions() {
    const styles = getComputedStyle(document.documentElement), z = name => Number(styles.getPropertyValue(name).trim());
    return {
    unstyled: true,
    ripple: false,
    locale: {
        emptyMessage: '暂无可选项', emptyFilterMessage: '没有匹配的选项',
        emptySearchMessage: '没有匹配的选项', searchMessage: '找到 {0} 个选项',
        selectionMessage: '已选择 {0} 项', emptySelectionMessage: '尚未选择',
        aria: { close: '关闭', selectAll: '选择全部', unselectAll: '取消全选', listLabel: '可选项目' },
    },
    // 由 CSS tokens 提供；overlay 要高于已有 body 弹窗。
    zIndex: { modal: z('--z-modal'), overlay: z('--z-ui-overlay'), menu: z('--z-ui-overlay'), tooltip: z('--z-ui-tooltip') },
    pt: {
        toggleswitch: { root: { class: 'ui-switch' } },
        inputtext: { root: { class: 'input' } },
        button: { root: { class: 'btn' } },
    },
    };
}
