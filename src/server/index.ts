import express from 'express';
import { createServer } from 'node:http';
import { randomInt } from 'node:crypto';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Server, type Socket } from 'socket.io';
import { GameError, Room } from './game.js';
import type { ClientToServer, ServerToClient } from '../shared/types.js';

const PORT = Number(process.env.PORT ?? 3000);
const MAX_ROOMS = Number(process.env.MAX_ROOMS ?? 300);
const ROOM_TTL_MS = Number(process.env.ROOM_TTL_MINUTES ?? 240) * 60_000;
const ORIGINS = (process.env.CLIENT_ORIGIN ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a);

export function createGameServer() {
  const app = express();
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    next();
  });
  const rooms = new Map<string, Room>();
  app.get('/healthz', (_req, res) => res.json({ ok: true, rooms: rooms.size, uptime: Math.round(process.uptime()) }));

  const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../dist/client');
  if (existsSync(dist)) {
    app.use(express.static(dist, { index: false, maxAge: '1h' }));
    app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  const http = createServer(app);
  const io = new Server<ClientToServer, ServerToClient>(http, {
    maxHttpBufferSize: 1_000_000,
    cors: ORIGINS.length ? { origin: ORIGINS } : undefined,
    pingInterval: 10_000,
    pingTimeout: 8_000,
  });

  const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const newCode = () => {
    for (;;) {
      const c = Array.from({ length: 6 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
      if (!rooms.has(c)) return c;
    }
  };

  // ---- broadcasting (coalesced per tick) ----
  const pending = new Set<string>();
  const broadcast = (code: string) => {
    if (pending.has(code)) return;
    pending.add(code);
    setImmediate(() => {
      pending.delete(code);
      const room = rooms.get(code);
      if (!room) return;
      io.to(`${code}:host`).emit('state:host', room.hostView());
      io.to(`${code}:screen`).emit('state:screen', room.publicState());
      const pub = room.publicState();
      for (const id of io.sockets.adapter.rooms.get(`${code}:players`) ?? []) {
        const s = io.sockets.sockets.get(id);
        const pid = s?.data.playerId as string | undefined;
        if (s && pid && room.players.has(pid)) s.emit('state:player', { pub, me: room.playerPrivate(pid) });
      }
    });
  };
  const playerSockets = (code: string, pid: string) =>
    [...(io.sockets.adapter.rooms.get(`${code}:players`) ?? [])].map((id) => io.sockets.sockets.get(id)).filter((s) => s?.data.playerId === pid);

  // ---- cleanup of idle rooms ----
  const sweeper = setInterval(() => {
    const now = Date.now();
    for (const [code, room] of rooms) {
      const idle = now - room.lastActivity;
      const anyone = (io.sockets.adapter.rooms.get(code)?.size ?? 0) > 0;
      if (idle > ROOM_TTL_MS || (!anyone && idle > 30 * 60_000)) { room.dispose(); rooms.delete(code); log('room expired', code); }
    }
  }, 60_000);
  sweeper.unref();

  // ---- rate limiting ----
  const createLog = new Map<string, number[]>();
  const allowCreate = (ip: string) => {
    const now = Date.now();
    const arr = (createLog.get(ip) ?? []).filter((t) => now - t < 10 * 60_000);
    if (arr.length >= 15) return false;
    arr.push(now); createLog.set(ip, arr);
    return true;
  };

  io.on('connection', (socket: Socket<ClientToServer, ServerToClient>) => {
    let bucket = 40, last = Date.now();
    const limited = () => {
      const now = Date.now();
      bucket = Math.min(40, bucket + ((now - last) / 1000) * 20); last = now;
      if (bucket < 1) return true;
      bucket--; return false;
    };
    const ip = (socket.handshake.headers['x-forwarded-for'] as string | undefined)?.split(',')[0].trim() || socket.handshake.address;

    // Wrap a handler: validates ack, rate-limits, maps GameError to a user-facing message.
    function on<E extends keyof ClientToServer>(ev: E, fn: (a: any) => object | void) {
      socket.on(ev as any, (arg: any, ack: any) => {
        const reply = typeof ack === 'function' ? ack : () => {};
        if (limited()) return reply({ ok: false, error: 'יותר מדי פעולות, נסו שוב בעוד רגע' });
        try {
          reply({ ok: true, ...(fn(arg && typeof arg === 'object' ? arg : {}) ?? {}) });
        } catch (e) {
          if (e instanceof GameError) return reply({ ok: false, error: e.message });
          log('error', ev, e);
          reply({ ok: false, error: 'משהו השתבש בשרת, נסו שוב' });
        }
      });
    }
    const roomOf = (code: unknown) => rooms.get(String(code ?? '').toUpperCase().trim()) ?? (() => { throw new GameError('לא מצאנו חדר עם הקוד הזה'); })();
    const hostRoom = () => {
      const r = socket.data.role === 'host' ? rooms.get(socket.data.code) : undefined;
      if (!r) throw new GameError('אין הרשאת מנחה');
      return r;
    };
    const me = () => {
      const r = socket.data.role === 'player' ? rooms.get(socket.data.code) : undefined;
      if (!r || !r.players.has(socket.data.playerId)) throw new GameError('צריך להצטרף לחדר קודם');
      return { room: r, pid: socket.data.playerId as string };
    };
    const attach = (room: Room, role: 'host' | 'screen' | 'player', playerId?: string) => {
      for (const r of socket.rooms) if (r !== socket.id) socket.leave(r);
      socket.data = { role, code: room.code, playerId };
      socket.join([room.code, `${room.code}:${role === 'player' ? 'players' : role}`]);
      broadcast(room.code);
    };

    on('host:create', (a) => {
      if (rooms.size >= MAX_ROOMS) throw new GameError('השרת עמוס כרגע, נסו שוב מאוחר יותר');
      if (!allowCreate(ip)) throw new GameError('נפתחו יותר מדי חדרים, נסו שוב בעוד כמה דקות');
      const code = newCode();
      const room = new Room(code, a.settings);
      room.onChange = () => broadcast(code);
      rooms.set(code, room);
      attach(room, 'host');
      log('room created', code);
      return { code, hostToken: room.hostToken };
    });
    on('host:attach', (a) => {
      const room = roomOf(a.code);
      if (a.hostToken !== room.hostToken) throw new GameError('אין הרשאת מנחה לחדר הזה');
      attach(room, 'host');
    });
    on('host:settings', (a) => hostRoom().updateSettings(a.settings ?? {}));
    on('host:start', () => hostRoom().start());
    on('host:pause', (a) => hostRoom().setPaused(!!a.paused));
    on('host:next', () => hostRoom().endPhase());
    on('host:skipDrawing', () => hostRoom().skipDrawing());
    on('host:addTime', (a) => hostRoom().addTime(Number(a.seconds)));
    on('host:kick', (a) => {
      const room = hostRoom();
      const pid = String(a.playerId);
      room.kick(pid);
      for (const s of playerSockets(room.code, pid)) { s!.emit('kicked'); s!.leave(`${room.code}:players`); s!.data = {}; }
    });
    on('host:end', () => hostRoom().finish());
    on('host:newGame', () => hostRoom().newGame());
    on('screen:attach', (a) => attach(roomOf(a.code), 'screen'));

    on('player:join', (a) => {
      const room = roomOf(a.code);
      const p = room.addPlayer(a.name);
      attach(room, 'player', p.id);
      log('join', room.code, room.players.size);
      return { playerId: p.id, token: p.token };
    });
    on('player:resume', (a) => {
      const room = roomOf(a.code);
      const p = room.auth(a.playerId, a.token);
      attach(room, 'player', p.id);
      room.setConnected(p.id, true);
    });
    on('player:draft', (a) => { const { room, pid } = me(); room.saveDraft(pid, a.image); });
    on('player:submitDrawing', (a) => { const { room, pid } = me(); room.submitDrawing(pid, a.image); });
    on('player:answer', (a) => { const { room, pid } = me(); room.submitAnswer(pid, a.text); });
    on('player:vote', (a) => { const { room, pid } = me(); room.vote(pid, a.optionId); });

    socket.on('disconnect', () => {
      const { role, code, playerId } = socket.data ?? {};
      if (role !== 'player') return;
      const room = rooms.get(code);
      if (room && playerSockets(code, playerId).length === 0) room.setConnected(playerId, false);
    });
  });

  return { app, http, io, rooms, close: () => { clearInterval(sweeper); rooms.forEach((r) => r.dispose()); io.close(); } };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const { http } = createGameServer();
  http.listen(PORT, () => log(`Blossom server on :${PORT}`));
  const stop = () => { log('shutting down'); http.close(() => process.exit(0)); setTimeout(() => process.exit(0), 3000).unref(); };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}
