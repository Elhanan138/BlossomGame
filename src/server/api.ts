import { randomInt } from 'node:crypto';
import { GameError, Room, validImage, type Clock } from './game';
import type { Store } from './store';

const MAX_ROOMS = Number(process.env.MAX_ROOMS ?? 300);
const ROOM_TTL_MS = Number(process.env.ROOM_TTL_MINUTES ?? 240) * 60_000;
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const newCode = () => Array.from({ length: 6 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
const fail = (m: string): never => { throw new GameError(m); };

export type Role = 'host' | 'player' | 'screen';
export interface RpcBody {
  action: string;
  args?: Record<string, any>;
  auth?: { code?: string; role?: Role; hostToken?: string; playerId?: string; token?: string };
}
export type RpcResult = { ok: true; view?: unknown; [k: string]: unknown } | { ok: false; error: string };

// Best-effort per-instance rate limit (serverless instances are short-lived; DB caps rooms globally).
const hits = new Map<string, number[]>();
function limited(key: string, max: number, windowMs: number) {
  const now = Date.now();
  const arr = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  arr.push(now);
  hits.set(key, arr);
  if (hits.size > 5000) hits.clear();
  return arr.length > max;
}

function view(room: Room, role: Role, pid?: string) {
  if (role === 'host') return room.hostView();
  if (role === 'player' && pid) return { pub: room.publicState(), me: room.playerPrivate(pid) };
  return room.publicState();
}

export async function rpc(store: Store, body: RpcBody, ip = 'local'): Promise<RpcResult> {
  try {
    const action = String(body?.action ?? '');
    const args = body?.args && typeof body.args === 'object' ? body.args : {};
    const auth = body?.auth && typeof body.auth === 'object' ? body.auth : {};
    if (limited(ip, 240, 60_000)) fail('יותר מדי פעולות, נסו שוב בעוד רגע');

    if (action === 'host:create') {
      if (limited(`create:${ip}`, 15, 10 * 60_000)) fail('נפתחו יותר מדי חדרים, נסו שוב בעוד כמה דקות');
      if (Math.random() < 0.2) await store.cleanup(ROOM_TTL_MS).catch(() => {});
      if ((await store.countActive(ROOM_TTL_MS)) >= MAX_ROOMS) fail('השרת עמוס כרגע, נסו שוב מאוחר יותר');
      const now = Date.now();
      const clock: Clock = { now: () => now, set: () => null, clear: () => {} };
      for (let i = 0; i < 5; i++) {
        const room = new Room(newCode(), args.settings, () => {}, clock);
        if (await store.create(room.code, room.serialize())) return { ok: true, code: room.code, hostToken: room.hostToken, view: room.hostView() };
      }
      fail('לא הצלחנו לפתוח חדר, נסו שוב');
    }

    const code = String(auth.code ?? args.code ?? '').toUpperCase().trim();
    if (!/^[A-Z0-9]{6}$/.test(code)) fail('קוד החדר צריך להיות 6 תווים');
    const role: Role = action === 'player:join' ? 'player' : auth.role === 'host' || auth.role === 'player' ? auth.role : 'screen';

    for (let attempt = 0; attempt < 12; attempt++) {
      if (attempt) await new Promise((r) => setTimeout(r, 10 + Math.random() * 40 * attempt));
      const row = await store.get(code);
      if (!row) fail('לא מצאנו חדר עם הקוד הזה');
      const now = Date.now();
      const room = Room.deserialize(row!.state, { now: () => now, set: () => null, clear: () => {} });
      room.seen ??= {};
      let pid: string | undefined;
      let extra: Record<string, unknown> = {};

      if (role === 'host' && auth.hostToken !== room.hostToken) fail('אין הרשאת מנחה לחדר הזה');
      if (role === 'player' && action !== 'player:join') {
        pid = room.auth(auth.playerId, auth.token).id;
        if (now - (room.seen[pid] ?? 0) > 5000) room.seen[pid] = now;
      }
      room.applyPresence(room.seen);
      room.tick();

      if (action.startsWith('host:') && role !== 'host') fail('אין הרשאת מנחה');
      switch (action) {
        case 'state': break;
        case 'host:settings': room.updateSettings(args.settings ?? {}); break;
        case 'host:start': room.start(); break;
        case 'host:pause': room.setPaused(!!args.paused); break;
        case 'host:next': room.endPhase(); break;
        case 'host:skipDrawing': room.skipDrawing(); break;
        case 'host:addTime': room.addTime(Number(args.seconds)); break;
        case 'host:kick': room.kick(String(args.playerId)); delete room.seen[String(args.playerId)]; break;
        case 'host:end': room.finish(); break;
        case 'host:prev': room.prevSlide(); break;
        case 'host:newGame': room.newGame(); break;
        case 'player:join': {
          const p = room.addPlayer(args.name);
          room.seen[p.id] = now;
          pid = p.id;
          extra = { playerId: p.id, token: p.token };
          break;
        }
        case 'player:draft':
        case 'player:submitDrawing': {
          if (room.phase !== 'DRAWING') fail('זמן הציור הסתיים');
          const data = validImage(args.image);
          const id = `${code}.r${room.round}.${pid}`;
          if (attempt === 0) await store.putImage(id, code, data);
          const ref = `${id}~${now.toString(36)}`;
          if (action === 'player:draft') room.saveDraft(pid!, ref); else room.submitDrawing(pid!, ref);
          break;
        }
        case 'player:answer': room.submitAnswer(pid!, args.text); break;
        case 'player:vote': room.vote(pid!, args.optionId); break;
        default: fail('פעולה לא מוכרת');
      }

      const next = room.serialize();
      if (next !== row!.state && !(await store.update(code, next, row!.version))) continue; // concurrent write → retry on fresh state
      return { ok: true, ...extra, view: view(room, role, pid) };
    }
    return fail('עומס רגעי, נסו שוב');
  } catch (e) {
    if (e instanceof GameError) return { ok: false, error: e.message };
    console.error('rpc error', e);
    return { ok: false, error: 'משהו השתבש בשרת, נסו שוב' };
  }
}

/** Image ids look like CODE.rN.playerId~version; the version only busts caches. */
export async function image(store: Store, ref: string): Promise<string | null> {
  const id = String(ref ?? '').split('~')[0];
  if (!/^[A-Z0-9]{6}\.r\d+\.[a-f0-9]{12}$/.test(id)) return null;
  return store.getImage(id);
}

export function dataUrlToBuffer(data: string) {
  const m = /^data:(image\/[a-z]+);base64,(.*)$/.exec(data);
  return m ? { type: m[1], buf: Buffer.from(m[2], 'base64') } : null;
}
