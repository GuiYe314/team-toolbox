// 服务器本机的只读端口快照。不接受外部命令、目标地址或进程控制参数。
import { spawn } from 'node:child_process';
import { isIP } from 'node:net';
import { join } from 'node:path';

export const PORT_MAX_ROWS = 5000;
const MAX_BYTES = 2 * 1024 * 1024;
const STATES = ['Closed', 'Listen', 'SynSent', 'SynReceived', 'Established', 'FinWait1', 'FinWait2', 'CloseWait', 'Closing', 'LastAck', 'TimeWait', 'DeleteTCB'];
const PROGRAM = String.raw`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$WarningPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
try {
    $names = @{}
    Get-Process | ForEach-Object { $names[[int]$_.Id] = [string]$_.ProcessName }
    $tcp = @(Get-NetTCPConnection -ErrorAction Stop | Select-Object -First 5001)
    $udp = @(Get-NetUDPEndpoint -ErrorAction Stop | Select-Object -First 5001)
    $rows = @(
        foreach ($item in $tcp) {
            @{ protocol = 'TCP'; localAddress = [string]$item.LocalAddress; localPort = [int]$item.LocalPort
               remoteAddress = [string]$item.RemoteAddress; remotePort = [int]$item.RemotePort
               state = [string]$item.State; pid = [long]$item.OwningProcess; processName = [string]$names[[int]$item.OwningProcess] }
        }
        foreach ($item in $udp) {
            @{ protocol = 'UDP'; localAddress = [string]$item.LocalAddress; localPort = [int]$item.LocalPort
               remoteAddress = ''; remotePort = 0; state = 'Bound'; pid = [long]$item.OwningProcess
               processName = [string]$names[[int]$item.OwningProcess] }
        }
    )
    $result = @{ rows = @($rows | Select-Object -First 5000); truncated = ($rows.Count -gt 5000) }
    [Console]::Out.Write((ConvertTo-Json -InputObject $result -Depth 4 -Compress))
} catch {
    [Console]::Error.WriteLine('Local port snapshot unavailable.')
    exit 1
}
`;

export class PortViewerError extends Error {
    constructor(code, message, status = 503) { super(message); this.code = code; this.status = status; }
}
const cancelled = () => new PortViewerError('cancelled', '端口读取已取消', 499);
const failed = () => new PortViewerError('read_failed', '无法读取本机端口，请稍后重试；系统需支持 Windows NetTCPIP 组件');

function parseSnapshot(text, now) {
    const data = JSON.parse(text.replace(/^\uFEFF/, ''));
    if (!data || !Array.isArray(data.rows) || data.rows.length > PORT_MAX_ROWS || typeof data.truncated !== 'boolean') throw failed();
    const rows = data.rows.map(row => {
        if (!row || !['TCP', 'UDP'].includes(row.protocol) || !isIP(row.localAddress) || typeof row.localAddress !== 'string'
            || ![row.localPort, row.remotePort].every(port => Number.isInteger(port) && port >= 0 && port <= 65535)
            || !Number.isInteger(row.pid) || row.pid < 0 || row.pid > 0xffffffff
            || typeof row.processName !== 'string' || row.processName.length > 256 || /[\x00-\x1f\x7f]/.test(row.processName)) throw failed();
        const state = STATES[Number(row.state) - 1] || (row.state === '100' ? 'Bound' : row.state);
        if (![...STATES, 'Bound'].includes(state) || row.protocol === 'TCP' && !isIP(row.remoteAddress)
            || row.protocol === 'UDP' && (state !== 'Bound' || row.remoteAddress !== '' || row.remotePort !== 0)) throw failed();
        return Object.freeze({ protocol: row.protocol, localAddress: row.localAddress, localPort: row.localPort,
            remoteAddress: row.remoteAddress, remotePort: row.remotePort, state, pid: row.pid, processName: row.processName });
    });
    rows.sort((a, b) => Number(b.state === 'Listen') - Number(a.state === 'Listen') || a.localPort - b.localPort || a.protocol.localeCompare(b.protocol) || a.localAddress.localeCompare(b.localAddress) || a.pid - b.pid);
    return Object.freeze({ state: 'ready', sampledAt: new Date(now()).toISOString(), rows: Object.freeze(rows), truncated: data.truncated });
}

export function createPortViewer({ spawnProcess = spawn, platform = process.platform, env = process.env, now = Date.now,
    timeoutMs = 15000, cacheMs = 2000, log = entry => console.info('[port-viewer]', JSON.stringify(entry)) } = {}) {
    let current = null, cached = null, cachedAt = 0, disposed = false;
    function start() {
        const controller = new AbortController(), operation = { controller, users: 0 };
        current = operation;
        operation.promise = new Promise((resolve, reject) => {
            let child, chunks = [], bytes = 0, stderrBytes = 0, failure, done = false, grace;
            const finish = (error, value) => {
                if (done) return; done = true; clearTimeout(timer); clearTimeout(grace);
                controller.signal.removeEventListener('abort', abort);
                chunks = []; error ? reject(error) : resolve(value);
            };
            const terminate = error => {
                if (done || failure) return; failure = error;
                try { child?.kill(); } catch { /* close或下面的清理时限负责结束等待 */ }
                grace = setTimeout(() => finish(failure), 1000);
            };
            const abort = () => terminate(cancelled());
            const timer = setTimeout(() => terminate(new PortViewerError('timeout', '端口读取超时，请稍后重试')), timeoutMs);
            controller.signal.addEventListener('abort', abort, { once: true });
            try {
                child = spawnProcess(join(env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
                    ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(PROGRAM, 'utf16le').toString('base64')],
                    { windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
                child.once('error', () => { terminate(failed()); finish(failure); });
                child.stdout.on('data', chunk => {
                    if (done || failure) return;
                    bytes += chunk.length;
                    if (bytes > MAX_BYTES) return terminate(new PortViewerError('output_limit', '端口快照超出读取上限，请稍后重试'));
                    chunks.push(Buffer.from(chunk));
                });
                child.stderr.on('data', chunk => { stderrBytes += chunk.length; if (stderrBytes > 8192) terminate(failed()); });
                child.stdout.on('error', () => terminate(failed())); child.stderr.on('error', () => terminate(failed()));
                child.once('close', code => {
                    if (done) return;
                    if (failure) return finish(failure);
                    if (code !== 0) return finish(failed());
                    try { finish(null, parseSnapshot(Buffer.concat(chunks).toString('utf8'), now)); }
                    catch { finish(failed()); }
                });
            } catch { finish(failed()); }
        }).then(value => {
            if (!disposed && !controller.signal.aborted) { cached = value; cachedAt = now(); }
            return value;
        }).catch(error => {
            if (error.code !== 'cancelled') log({ action: 'snapshot', ok: false, code: error.code || 'read_failed' });
            throw error;
        }).finally(() => { if (current === operation) current = null; });
        return operation;
    }
    return {
        async read(signal) {
            if (signal?.aborted) throw cancelled();
            if (disposed) throw new PortViewerError('unavailable', '端口读取服务已关闭');
            if (platform !== 'win32') return { state: 'unsupported', message: '当前仅支持 Windows 本机端口读取', rows: [], sampledAt: null, truncated: false };
            if (cached && now() - cachedAt < cacheMs) return cached;
            if (current?.controller.signal.aborted) throw new PortViewerError('busy', '上次读取正在停止，请稍后重试', 409);
            const operation = current || start(); operation.users++;
            return new Promise((resolve, reject) => {
                let settled = false;
                const finish = (error, value) => {
                    if (settled) return; settled = true; signal?.removeEventListener('abort', abort); operation.users--;
                    if (!operation.users && current === operation) operation.controller.abort();
                    error ? reject(error) : resolve(value);
                };
                const abort = () => finish(cancelled());
                signal?.addEventListener('abort', abort, { once: true });
                operation.promise.then(value => finish(null, value), error => finish(error));
                if (signal?.aborted) abort();
            });
        },
        dispose() { disposed = true; cached = null; current?.controller.abort(); }
    };
}
