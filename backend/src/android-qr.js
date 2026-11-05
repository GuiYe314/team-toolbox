import { randomBytes, randomUUID } from 'node:crypto';
import { AdbError, parseDevices, parseMdns } from './android-adb-protocol.js';

const activeStates = new Set(['waiting', 'pairing', 'connecting']);
const hostOf = (endpoint) => endpoint.split(':')[0];
const matchesGuid = (name, guid) => !!guid && (name === guid || name.startsWith(guid + '-') || name.startsWith(guid + '.'));

/** Android 原生扫码配对会话。只有本机页面主动轮询时才调用 ADB。 */
export function createAndroidQrPairing({ run, now = Date.now, log = () => {} }) {
    let current = null;
    let expiryTimer;
    const snapshot = (session) => ({ id: session.id, state: session.state, expiresAt: session.expiresAt, message: session.message, devices: session.devices, warning: session.warning || '' });
    function finish(session, state, message) {
        session.state = state; session.message = message; session.password = '';
        session.controller.abort();
        clearTimeout(expiryTimer);
        return snapshot(session);
    }
    function expire(session) {
        return finish(session, 'expired', session.paired ? '配对成功，但等待连接超时。请搜索连接服务或输入手机连接地址。' : '二维码已过期，请重新生成后扫码');
    }
    function get(id) {
        if (!current || current.id !== id) throw new AdbError('invalid_session', '扫码会话不存在，请重新生成二维码', 409);
        if (activeStates.has(current.state) && now() >= current.expiresAt) expire(current);
        return current;
    }
    const discover = async (signal) => parseMdns((await run(['mdns', 'services'], { signal, timeoutMs: 8000 })).stdout);
    const devices = async (signal) => parseDevices((await run(['devices', '-l'], { signal, timeoutMs: 8000 })).stdout);
    function targetConnected(list, session, targets) {
        return list.some((item) => item.connection === 'wireless' && item.state === 'device' &&
            (matchesGuid(item.serial, session.guid) || targets.some((target) => item.serial === target.endpoint || item.serial === `${target.name}._adb-tls-connect._tcp`)));
    }

    return {
        async start(signal) {
            // 在显示二维码之前检查配置和 ADB 可用性，不把无效配置伪装为等待扫码。
            await run(['version'], { signal, timeoutMs: 10000 });
            if (signal?.aborted) throw new AdbError('cancelled', '扫码操作已取消', 499);
            if (current) finish(current, 'cancelled', '已重新生成二维码');
            const session = current = {
                id: randomUUID(), name: 'studio-toolbox-' + randomBytes(10).toString('hex'), password: randomBytes(16).toString('hex'),
                expiresAt: now() + 120000, state: 'waiting', message: '等待手机扫码…', controller: new AbortController(),
                paired: false, endpoint: '', guid: '', devices: null
            };
            expiryTimer = setTimeout(() => { if (activeStates.has(session.state)) expire(session); }, 120000);
            expiryTimer.unref?.();
            return { ...snapshot(session), payload: `WIFI:T:ADB;S:${session.name};P:${session.password};;` };
        },
        cancel(id) {
            const session = get(id);
            if (activeStates.has(session.state)) return finish(session, 'cancelled', '已取消扫码连接');
            return snapshot(session);
        },
        invalidate() { if (current) finish(current, 'cancelled', 'ADB 配置变化，扫码会话已取消'); current = null; },
        async poll(id, signal) {
            const session = get(id);
            if (!activeStates.has(session.state)) return snapshot(session);
            const operationSignal = signal ? AbortSignal.any([signal, session.controller.signal]) : session.controller.signal;
            const alive = () => {
                get(id);
                if (operationSignal.aborted) throw new AdbError('cancelled', '扫码操作已取消', 499);
            };
            const secret = session.password;
            try {
                const services = await discover(operationSignal);
                alive();
                if (session.state === 'waiting') {
                    const matches = services.filter((item) => item.kind === 'pairing' && item.name.replace(/\.$/, '') === session.name);
                    if (!matches.length) return snapshot(session);
                    if (matches.length !== 1) throw new AdbError('ambiguous_service', '发现多个同名配对服务，请重新生成二维码');
                    session.state = 'pairing'; session.endpoint = matches[0].endpoint;
                    const result = await run(['pair', session.endpoint], { signal: operationSignal, input: secret + '\n', secrets: [secret], timeoutMs: 15000 });
                    alive();
                    if (!/Successfully paired to\s+/i.test(result.stdout)) throw new AdbError('adb_failed', '扫码配对失败，请重新生成二维码后再试', 502);
                    session.guid = /\[guid=([A-Za-z0-9_.-]{1,255})\]/i.exec(result.stdout)?.[1] || '';
                    session.paired = true; session.password = ''; session.state = 'connecting';
                    session.message = '配对成功，正在连接手机…';
                    return snapshot(session);
                }

                const sameHost = services.filter((item) => item.kind === 'connect' && hostOf(item.endpoint) === hostOf(session.endpoint));
                const guidTargets = sameHost.filter((item) => matchesGuid(item.name, session.guid));
                const targets = guidTargets.length ? guidTargets : sameHost;
                session.devices = await devices(operationSignal);
                alive();
                if (targetConnected(session.devices, session, targets.length === 1 ? targets : [])) return finish(session, 'connected', '扫码配对并连接成功');
                if (targets.length !== 1) {
                    session.message = targets.length ? '配对成功，但同一地址有多个连接服务，请取消后手动选择连接。' : '配对成功，等待手机发布连接服务…';
                    return snapshot(session);
                }
                const result = await run(['connect', targets[0].endpoint], { signal: operationSignal, timeoutMs: 10000 });
                alive();
                if (!/\b(?:already )?connected to\s+/i.test(result.stdout)) throw new AdbError('adb_failed', '手机已配对，但无线连接失败，请检查手机当前连接地址', 502);
                try { session.devices = await devices(operationSignal); }
                catch (error) {
                    alive();
                    session.devices = null; session.warning = '连接成功，但设备列表刷新失败，请手动刷新。';
                    return finish(session, 'connected', '扫码配对并连接成功');
                }
                alive();
                if (targetConnected(session.devices, session, targets)) return finish(session, 'connected', '扫码配对并连接成功');
                session.message = '已发送连接请求，等待设备就绪…';
                return snapshot(session);
            } catch (error) {
                if (!activeStates.has(session.state)) return snapshot(session);
                if (operationSignal.aborted) return finish(session, 'cancelled', '扫码操作已取消');
                log({ action: 'qr_pairing', ok: false, code: error instanceof AdbError ? error.code : 'adb_failed' });
                const safeMessage = String(error.message || 'ADB 操作失败').replaceAll(secret || '\u0000', '[已隐藏]').slice(0, 1500);
                return finish(session, 'failed', `${session.paired ? '手机已配对，后续连接失败：' : '扫码连接失败：'}${safeMessage}`);
            }
        }
    };
}
