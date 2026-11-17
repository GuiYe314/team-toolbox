async function request(method, path, body, signal) {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15000);
    const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    try {
        const res = await fetch('/api/quick-calculations' + path, {
            method, signal: combined,
            headers: { 'X-Toolbox-Calculation': '1', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
            body: body === undefined ? undefined : JSON.stringify(body)
        });
        const result = await res.json();
        if (!res.ok) throw new Error(result.message || '快速计算操作失败，请重试');
        return result;
    } catch (error) {
        if (signal?.aborted) throw error;
        if (controller.signal.aborted) throw new Error('操作超时，请重试；保存操作可先刷新方案列表核实');
        if (error instanceof TypeError) throw new Error('无法连接工具箱，请检查服务后重试');
        throw error;
    } finally { clearTimeout(timer); }
}
export const calculationApi = {
    preview: (value, signal) => request('POST', '/preview', value, signal),
    list: signal => request('GET', '', undefined, signal),
    save: (value, signal) => request('POST', '', value, signal),
    remove: (id, signal) => request('DELETE', `/${id}?confirm=1`, undefined, signal)
};
