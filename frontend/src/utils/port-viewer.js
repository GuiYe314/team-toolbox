export const portStateLabels = Object.freeze({ Listen: '监听中', Bound: '已绑定', Established: '已连接', Closed: '已关闭',
    SynSent: '等待连接', SynReceived: '连接握手', FinWait1: '等待关闭 1', FinWait2: '等待关闭 2', CloseWait: '等待应用关闭',
    Closing: '正在关闭', LastAck: '最后确认', TimeWait: '等待回收', DeleteTCB: '正在删除' });

export function portEndpoint(address, port) { return address.includes(':') ? `[${address}]:${port}` : `${address}:${port}`; }

export function filterPorts(rows, { protocol = 'all', scope = 'listening', query = '', port = '' } = {}) {
    const keyword = query.trim().toLocaleLowerCase(), exactPort = String(port).trim();
    if (exactPort && (!/^\d{1,5}$/.test(exactPort) || Number(exactPort) > 65535)) return [];
    return rows.filter(row => (protocol === 'all' || row.protocol === protocol)
        && (scope === 'all' || row.protocol === 'UDP' || row.state === 'Listen')
        && (!exactPort || row.localPort === Number(exactPort))
        && (!keyword || [row.processName, String(row.pid), row.localAddress, row.remoteAddress, String(row.localPort), String(row.remotePort)]
            .some(value => value.toLocaleLowerCase().includes(keyword))));
}

export function validatePortSnapshot(data) {
    if (!data || !['ready', 'unsupported'].includes(data.state) || !Array.isArray(data.rows) || data.rows.length > 5000
        || typeof data.truncated !== 'boolean' || data.state === 'ready' && !Number.isFinite(Date.parse(data.sampledAt))
        || data.state === 'unsupported' && (data.rows.length || typeof data.message !== 'string')
        || data.rows.some(row => !row || !['TCP', 'UDP'].includes(row.protocol) || !Object.hasOwn(portStateLabels, row.state)
            || ![row.localAddress, row.remoteAddress, row.processName].every(value => typeof value === 'string' && value.length <= 256 && !/[\x00-\x1f\x7f]/.test(value))
            || ![row.localPort, row.remotePort].every(port => Number.isInteger(port) && port >= 0 && port <= 65535)
            || !Number.isInteger(row.pid) || row.pid < 0 || row.pid > 0xffffffff)) throw new Error('端口快照格式无效，请重试');
    return data;
}
