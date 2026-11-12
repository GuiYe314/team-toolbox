// 只读 Windows 网卡累计计数；不下载测试文件，不修改网络或收集连接内容。
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';

const MAX_LINE_BYTES = 128 * 1024;
const MAX_COUNTER = (1n << 64n) - 1n;
const PROGRAM = String.raw`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$WarningPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
try {
    while ($true) {
        $adapters = @(Get-NetAdapter -ErrorAction Stop | Sort-Object ifIndex | Select-Object -First 64)
        $statistics = @{}
        Get-NetAdapterStatistics -ErrorAction Stop | ForEach-Object { $statistics[$_.Name] = $_ }
        $time = [Diagnostics.Stopwatch]::GetTimestamp() * 1000.0 / [Diagnostics.Stopwatch]::Frequency
        $rows = @(foreach ($adapter in $adapters) {
            $stats = $statistics[$adapter.Name]
            if ($null -eq $stats) { continue }
            @{
                id = [string]$adapter.InterfaceGuid
                name = [string]$adapter.Name
                description = [string]$adapter.InterfaceDescription
                connected = ([string]$adapter.Status -eq 'Up')
                virtual = -not [bool]$adapter.HardwareInterface
                linkSpeedBps = [double]$adapter.ReceiveLinkSpeed
                received = [string]$stats.ReceivedBytes
                sent = [string]$stats.SentBytes
            }
        })
        [Console]::Out.WriteLine((ConvertTo-Json -InputObject @{ timeMs = $time; adapters = $rows } -Depth 4 -Compress))
        [Console]::Out.Flush()
        Start-Sleep -Milliseconds 1000
    }
} catch {
    [Console]::Error.WriteLine('Network adapter counters unavailable.')
    exit 1
}
`;

function counter(value) {
    if (typeof value !== 'string' || !/^\d{1,20}$/.test(value)) throw new Error('invalid_counter');
    const result = BigInt(value);
    if (result > MAX_COUNTER) throw new Error('invalid_counter');
    return result;
}

function label(value, max, required = false) {
    if (typeof value !== 'string' || value.length > max || /[\x00-\x1f\x7f]/.test(value) || required && !value.trim()) throw new Error('invalid_label');
    return value;
}

function parseSample(line) {
    const data = JSON.parse(line);
    if (!Number.isFinite(data.timeMs) || data.timeMs < 0 || !Array.isArray(data.adapters) || data.adapters.length > 64) throw new Error('invalid_sample');
    const ids = new Set();
    const adapters = data.adapters.map(item => {
        const id = label(item.id, 80, true).toLowerCase();
        if (ids.has(id) || typeof item.connected !== 'boolean' || typeof item.virtual !== 'boolean' || !Number.isFinite(item.linkSpeedBps) || item.linkSpeedBps < 0) throw new Error('invalid_adapter');
        ids.add(id);
        return { id, name: label(item.name, 128, true), description: label(item.description, 256),
            connected: item.connected, virtual: item.virtual, linkSpeedBps: item.linkSpeedBps,
            received: counter(item.received), sent: counter(item.sent) };
    });
    return { timeMs: data.timeMs, adapters };
}

/** 一个实例供全部页面共享；无页面请求十秒后释放本轮进程。 */
export function createNetworkSpeedMonitor({
    platform = process.platform, spawnProcess = spawn,
    clock = () => performance.now(), wallNow = () => new Date().toISOString(),
    setTimer = setInterval, clearTimer = clearInterval,
    log = entry => console.warn('[network-speed]', JSON.stringify(entry))
} = {}) {
    let child = null, guard = null, disposed = false, previous = null;
    let lastRequested = 0, startedAt = 0, receivedAt = null, retryAt = 0;
    let buffer = '', stderrBytes = 0, sampleId = 0, epoch = 0, sampledAt = null, adapters = [];
    let state = platform === 'win32' ? 'idle' : 'unsupported';
    let message = platform === 'win32' ? '等待开始采样' : '实时网速目前支持 Windows 服务器电脑';

    function stop(nextState) {
        const owned = child;
        child = null;
        if (guard !== null) clearTimer(guard);
        guard = null; previous = null; receivedAt = null; buffer = '';
        state = nextState;
        if (owned) { try { owned.kill(); } catch { /* 进程已退出时无需重复终止。 */ } }
    }
    function fail(code) {
        stop('error'); retryAt = clock() + 5000;
        message = '无法读取网卡计数，将自动重试；请检查 Windows 网卡与 PowerShell 是否可用';
        try { log({ event: 'collector_failed', code }); } catch { /* 日志不可影响主服务。 */ }
    }
    function accept(line) {
        const sample = parseSample(line);
        const intervalMs = previous ? sample.timeMs - previous.timeMs : 0;
        const old = new Map(previous?.adapters.map(item => [item.id, item]) || []);
        adapters = sample.adapters.map(item => {
            const before = old.get(item.id);
            let downloadBytes = null, uploadBytes = null;
            if (item.connected && before?.connected && intervalMs >= 100 && intervalMs <= 10000
                && item.received >= before.received && item.sent >= before.sent) {
                const rx = item.received - before.received, tx = item.sent - before.sent;
                if (rx <= BigInt(Number.MAX_SAFE_INTEGER) && tx <= BigInt(Number.MAX_SAFE_INTEGER)) {
                    downloadBytes = Number(rx); uploadBytes = Number(tx);
                }
            }
            item.counterEpoch = downloadBytes === null ? ++epoch : before.counterEpoch;
            return { id: item.id, name: item.name, description: item.description, connected: item.connected,
                receivedBytes: item.received.toString(), sentBytes: item.sent.toString(),
                counterTimeMs: sample.timeMs, counterEpoch: item.counterEpoch,
                virtual: item.virtual, linkSpeedBps: item.linkSpeedBps, intervalMs: downloadBytes === null ? null : intervalMs,
                downloadBytes, uploadBytes,
                downloadBps: downloadBytes === null ? null : downloadBytes * 1000 / intervalMs,
                uploadBps: uploadBytes === null ? null : uploadBytes * 1000 / intervalMs };
        });
        previous = sample; receivedAt = clock(); sampledAt = wallNow(); sampleId++;
        state = adapters.length ? 'ready' : 'empty';
        message = adapters.length ? '' : '未找到可读取计数的网卡，请检查服务器网络适配器';
    }
    function start() {
        state = 'starting'; message = '正在读取网卡，首次采样需要几秒…';
        previous = null; receivedAt = null; startedAt = clock(); stderrBytes = 0; buffer = '';
        let owned;
        try {
            const executable = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
            owned = spawnProcess(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(PROGRAM, 'utf16le').toString('base64')],
                { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
            child = owned;
        } catch { fail('start_failed'); return; }
        owned.stdout.setEncoding('utf8');
        owned.stdout.on('data', chunk => {
            if (child !== owned) return;
            buffer += chunk;
            let newline;
            while ((newline = buffer.indexOf('\n')) !== -1) {
                const raw = buffer.slice(0, newline);
                buffer = buffer.slice(newline + 1);
                if (Buffer.byteLength(raw) > MAX_LINE_BYTES) { fail('output_limit'); return; }
                const line = raw.replace(/^\uFEFF/, '').trim();
                if (line) { try { accept(line); } catch { fail('invalid_output'); return; } }
            }
            if (Buffer.byteLength(buffer) > MAX_LINE_BYTES) fail('output_limit');
        });
        owned.stderr.on('data', chunk => {
            if (child !== owned) return;
            stderrBytes += chunk.length;
            if (stderrBytes > 8192) fail('stderr_limit');
        });
        for (const stream of [owned.stdout, owned.stderr]) stream.on('error', () => { if (child === owned) fail('stream_failed'); });
        owned.once('error', () => { if (child === owned) fail('process_failed'); });
        owned.once('close', () => { if (child === owned) fail('process_exited'); });
        guard = setTimer(() => {
            if (clock() - lastRequested >= 10000) { stop('idle'); message = '等待页面重新采样'; }
            else if (clock() - (receivedAt ?? startedAt) >= (receivedAt === null ? 15000 : 8000)) fail('sample_timeout');
        }, 1000);
        guard.unref?.();
    }
    function snapshot() {
        if (!disposed && platform === 'win32') {
            lastRequested = clock();
            if (!child && clock() >= retryAt) start();
        }
        const ageMs = receivedAt === null ? null : Math.max(0, clock() - receivedAt);
        const stale = (state === 'ready' || state === 'empty') && ageMs > 5000;
        const fresh = state === 'ready' && !stale;
        return { state: stale ? 'stale' : state, message: stale ? '采样暂时中断，等待恢复…' : message,
            sampleId, sampledAt, ageMs, pollAfterMs: 1000,
            adapters: adapters.map(item => fresh ? { ...item } : { ...item, downloadBps: null, uploadBps: null, downloadBytes: null, uploadBytes: null, intervalMs: null }) };
    }
    function dispose() { if (disposed) return; disposed = true; stop('stopped'); message = '采样已停止'; }
    return { snapshot, dispose };
}
