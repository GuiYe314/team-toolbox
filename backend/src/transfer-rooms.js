import { randomBytes, timingSafeEqual } from 'node:crypto';

export class TransferError extends Error { constructor(message, status = 400) { super(message); this.status = status; } }
const token = () => randomBytes(32).toString('base64url');
const equal = (a, b) => typeof a === 'string' && typeof b === 'string' && /^[A-Za-z0-9_-]{43}$/.test(a) && /^[A-Za-z0-9_-]{43}$/.test(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
export function createTransferRooms({ now = Date.now, ttl = 30 * 60_000 } = {}) {
    const rooms = new Map();
    function sweep() { for (const [id, room] of rooms) if (room.expiresAt <= now() || now() - room.lastSeen > 60_000) rooms.delete(id); }
    function read(id) { sweep(); const room = rooms.get(id); if (!room) throw new TransferError('互传房间已关闭或过期，请重新扫码', 410); return room; }
    function auth(id, ticket) { const room = read(id); const side = equal(ticket, room.owner) ? 'owner' : room.joined && equal(ticket, room.guest) ? 'guest' : ''; if (!side) throw new TransferError('互传票据无效', 403); room.lastSeen = now(); return { room, side }; }
    function event(room, target, kind, payload) {
        if (room.events.length >= 256) throw new TransferError('信令数量超过限制，请重新创建房间', 429);
        room.events.push({ id: ++room.sequence, target, kind, payload });
    }
    return {
        create() {
            sweep(); if (rooms.size >= 16) throw new TransferError('互传房间已满，请稍后重试', 409);
            const room = { id: randomBytes(12).toString('hex'), owner: token(), invite: token(), guest: token(), joined: false, lastSeen: now(), expiresAt: now() + ttl, sequence: 0, events: [] }; rooms.set(room.id, room);
            return { id: room.id, ticket: room.owner, invite: room.invite, expiresAt: room.expiresAt };
        },
        join(id, invite) { const room = read(id); if (!equal(invite, room.invite)) throw new TransferError('扫码邀请无效', 403); if (room.joined) throw new TransferError('房间已有另一端加入，请创建新房间', 409); room.joined = true; room.invite = ''; room.lastSeen = now(); event(room, 'owner', 'joined', null); return { id, ticket: room.guest, expiresAt: room.expiresAt }; },
        poll(id, ticket, after = 0) {
            const { room, side } = auth(id, ticket);
            if (!Number.isSafeInteger(after) || after < 0 || after > room.sequence) throw new TransferError('信令游标无效');
            // 清除已由接收端确认的消息，避免空轮询将候选无限保留。
            room.events = room.events.filter(item => item.target !== side || item.id > after);
            return { events: room.events.filter(item => item.target === side && item.id > after).map(({ target, ...item }) => item), sequence: room.sequence, joined: room.joined, expiresAt: room.expiresAt };
        },
        signal(id, ticket, kind, payload) {
            const { room, side } = auth(id, ticket), target = side === 'owner' ? 'guest' : 'owner';
            if (!room.joined) throw new TransferError('另一端尚未加入', 409);
            if (!['offer', 'answer', 'ice'].includes(kind)) throw new TransferError('信令类型无效');
            if (kind === 'offer' && side !== 'owner' || kind === 'answer' && side !== 'guest') throw new TransferError('信令方向无效');
            if (!payload || typeof payload !== 'object' || Array.isArray(payload) || Buffer.byteLength(JSON.stringify(payload)) > 32 * 1024) throw new TransferError('信令内容过长或无效');
            if (kind !== 'ice' && (payload.type !== kind || typeof payload.sdp !== 'string' || !payload.sdp.startsWith('v=0'))) throw new TransferError('连接描述无效');
            if (kind === 'ice' && (typeof payload.candidate !== 'string' || payload.candidate.length > 2048 || !payload.candidate.startsWith('candidate:'))) throw new TransferError('网络候选无效');
            event(room, target, kind, payload); return { ok: true };
        },
        close(id, ticket) { const { room, side } = auth(id, ticket); if (side === 'owner') rooms.delete(id); else { event(room, 'owner', 'left', null); room.guest = ''; } return { ok: true }; },
        dispose() { rooms.clear(); },
        get size() { sweep(); return rooms.size; }
    };
}
