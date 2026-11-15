// Real Socket.IO server + 9 real clients: full game, reconnect, double vote, late answers.
import { afterAll, beforeAll, expect, it } from 'vitest';
import { io as connect, type Socket } from 'socket.io-client';
import type { AddressInfo } from 'node:net';
import { createGameServer } from '../src/server/index';
import type { HostView, PlayerView, PublicState } from '../src/shared/types';

const IMG = 'data:image/png;base64,iVBORw0KGgo=';
let srv: ReturnType<typeof createGameServer>;
let url = '';
const sockets: Socket[] = [];

beforeAll(async () => {
  srv = createGameServer();
  await new Promise<void>((r) => srv.http.listen(0, r));
  url = `http://localhost:${(srv.http.address() as AddressInfo).port}`;
});
afterAll(() => { sockets.forEach((s) => s.close()); srv.close(); srv.http.close(); });

const client = () => { const s = connect(url, { transports: ['websocket'], forceNew: true }); sockets.push(s); return s; };
const call = <T = any>(s: Socket, ev: string, a: object = {}) =>
  new Promise<T>((res, rej) => s.emit(ev, a, (r: any) => (r.ok ? res(r) : rej(new Error(r.error)))));
function tracker<T>(s: Socket, ev: string) {
  const t = { last: null as T | null, waiters: [] as [(v: T) => boolean, (v: T) => void][] };
  s.on(ev, (v: T) => { t.last = v; t.waiters = t.waiters.filter(([p, r]) => (p(v) ? (r(v), false) : true)); });
  return {
    get: () => t.last!,
    until: (p: (v: T) => boolean) => new Promise<T>((r, rej) => {
      if (t.last && p(t.last)) return r(t.last);
      t.waiters.push([p, r]);
      setTimeout(() => rej(new Error(`timeout waiting on ${ev}`)), 5000);
    }),
  };
}

it('9 players play a complete game in real time', async () => {
  const host = client();
  const hostState = tracker<HostView>(host, 'state:host');
  const { code, hostToken } = await call(host, 'host:create', { settings: { rounds: 1 } });
  expect(code).toMatch(/^[A-Z0-9]{6}$/);

  const screen = client();
  const screenState = tracker<PublicState>(screen, 'state:screen');
  await call(screen, 'screen:attach', { code });

  const names = ['נועה', 'Dan', 'אבי', 'מאיה', 'יוסי', 'Lior 🎨', 'רותם', 'שירה', 'עומר'];
  const players = await Promise.all(names.map(async (name) => {
    const s = client();
    const st = tracker<PlayerView>(s, 'state:player');
    const auth = await call(s, 'player:join', { code, name });
    return { s, st, name, ...auth };
  }));
  await expect(call(client(), 'player:join', { code, name: 'נועה' })).rejects.toThrow(/תפוס/);
  await expect(call(client(), 'host:start')).rejects.toThrow(/מנחה/);
  await expect(call(client(), 'host:attach', { code, hostToken: 'nope' })).rejects.toThrow();
  await hostState.until((v) => v.pub.players.length === 9);

  await call(host, 'host:start');
  await Promise.all(players.map((p) => p.st.until((v) => v.pub.phase === 'DRAWING' && !!v.me.prompt)));
  const prompts = players.map((p) => p.st.get().me.prompt!);
  expect(new Set(prompts).size).toBe(9);
  expect(JSON.stringify(screenState.get())).not.toContain(prompts[0]);

  // Player 0 drops mid-drawing after saving a draft, then resumes with its token.
  await call(players[0].s, 'player:draft', { image: IMG });
  players[0].s.disconnect();
  await hostState.until((v) => v.pub.players.some((p) => p.id === players[0].playerId && !p.connected));
  const re = client();
  const reSt = tracker<PlayerView>(re, 'state:player');
  await expect(call(re, 'player:resume', { code, playerId: players[0].playerId, token: 'bad' })).rejects.toThrow();
  await call(re, 'player:resume', { code, playerId: players[0].playerId, token: players[0].token });
  const restored = await reSt.until((v) => v.pub.phase === 'DRAWING');
  expect(restored.me.draft).toBe(IMG);
  expect(restored.me.prompt).toBe(prompts[0]);
  players[0] = { ...players[0], s: re, st: reSt };

  await Promise.all(players.map((p) => call(p.s, 'player:submitDrawing', { image: IMG })));
  await expect(call(players[1].s, 'player:submitDrawing', { image: IMG })).rejects.toThrow();

  for (let d = 0; d < 9; d++) {
    const v = await screenState.until((x) => x.phase === 'ANSWERING' && x.drawingIndex === d);
    expect(v.drawing).toBe(IMG);
    const others = players.filter((p) => p.playerId !== v.artistId);
    // Everyone answers concurrently.
    await Promise.all(others.map((p, i) => call(p.s, 'player:answer', { text: i % 4 === 0 ? 'תשובה זהה' : `ניחוש ${p.name} ${d}` })));
    const voting = await screenState.until((x) => x.phase === 'VOTING' && x.drawingIndex === d);
    await expect(call(others[0].s, 'player:answer', { text: 'מאוחר מדי' })).rejects.toThrow();
    expect(voting.options!.filter((o) => o.text === 'תשובה זהה').length).toBe(1);
    await Promise.all(others.map(async (p) => {
      const me = (await p.st.until((x) => x.pub.phase === 'VOTING' && x.pub.drawingIndex === d)).me;
      const choice = voting.options!.find((o) => !me.myOptionIds.includes(o.id))!;
      await call(p.s, 'player:vote', { optionId: choice.id });
    }));
    const rev = await screenState.until((x) => x.phase === 'REVEAL' && x.drawingIndex === d);
    expect(rev.reveal!.options[0].isTruth).toBe(true);
    await expect(call(others[0].s, 'player:vote', { optionId: voting.options![0].id })).rejects.toThrow();
    await call(host, 'host:next');
  }
  const results = await screenState.until((x) => x.phase === 'ROUND_RESULTS');
  expect(results.leaderboard!.length).toBe(9);
  const total = results.leaderboard!.reduce((s, l) => s + l.score, 0);
  expect(total).toBeGreaterThan(0);
  await call(host, 'host:next');
  const fin = await screenState.until((x) => x.phase === 'FINAL');
  expect(fin.highlights).toBeTruthy();

  // Host refresh: reattach with token and start a new game with the same players.
  const host2 = client();
  const h2 = tracker<HostView>(host2, 'state:host');
  await call(host2, 'host:attach', { code, hostToken });
  await call(host2, 'host:newGame');
  const lobby = await h2.until((v) => v.pub.phase === 'LOBBY');
  expect(lobby.pub.players.length).toBe(9);
  expect(lobby.pub.players.every((p) => p.score === 0)).toBe(true);
}, 30000);
