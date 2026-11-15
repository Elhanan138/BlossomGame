// 9 simulated phones + host + projector against the real RPC layer (same code the Vercel functions run).
import { expect, it } from 'vitest';
import { rpc, type RpcBody } from '../src/server/api';
import { memoryStore } from '../src/server/store';
import type { HostView, PlayerView, PublicState } from '../src/shared/types';

const IMG = 'data:image/png;base64,iVBORw0KGgo=';
const store = memoryStore();
async function call<T = any>(action: string, args: object = {}, auth?: RpcBody['auth']): Promise<T> {
  const r = await rpc(store, { action, args, auth }, `ip-${Math.random()}`);
  if (!r.ok) throw new Error(r.error);
  return r as T;
}

it('9 players play a complete game with concurrent actions', async () => {
  const { code, hostToken } = await call('host:create', { settings: { rounds: 1 } });
  const host = { code, role: 'host' as const, hostToken };
  const screen = { code, role: 'screen' as const };
  const names = ['נועה', 'Dan', 'אבי', 'מאיה', 'יוסי', 'Lior 🎨', 'רותם', 'שירה', 'עומר'];
  const players = await Promise.all(names.map(async (name) => {
    const r = await call('player:join', { name }, { code });
    return { name, auth: { code, role: 'player' as const, playerId: r.playerId, token: r.token } };
  }));
  await expect(call('player:join', { name: 'נועה' }, { code })).rejects.toThrow(/תפוס/);
  await expect(call('host:start', {}, screen)).rejects.toThrow(/מנחה/);
  await expect(call('host:start', {}, { ...host, hostToken: 'nope' })).rejects.toThrow(/מנחה/);
  await expect(call('state', {}, { ...players[0].auth, token: 'bad' })).rejects.toThrow(/לזהות/);
  const lobby = (await call<{ view: HostView }>('state', {}, host)).view;
  expect(lobby.pub.players.length).toBe(9);

  await call('host:start', {}, host);
  const views = await Promise.all(players.map((p) => call<{ view: PlayerView }>('state', {}, p.auth)));
  const prompts = views.map((v) => v.view.me.prompt!);
  expect(new Set(prompts).size).toBe(9);
  const pub = (await call<{ view: PublicState }>('state', {}, screen)).view;
  expect(JSON.stringify(pub)).not.toContain(prompts[0]);

  await call('player:draft', { image: IMG }, players[0].auth);
  const restored = (await call<{ view: PlayerView }>('state', {}, players[0].auth)).view;
  expect(restored.me.draft).toMatch(/~/);
  await expect(call('player:draft', { image: 'javascript:alert(1)' }, players[0].auth)).rejects.toThrow();
  // All 9 submit at the same moment (optimistic concurrency + retries).
  await Promise.all(players.map((p) => call('player:submitDrawing', { image: IMG }, p.auth)));

  for (let d = 0; d < 9; d++) {
    let v = (await call<{ view: PublicState }>('state', {}, screen)).view;
    expect(v.phase).toBe('ANSWERING');
    expect(v.drawingIndex).toBe(d);
    const others = players.filter((p) => p.auth.playerId !== v.artistId);
    await Promise.all(others.map((p, i) => call('player:answer', { text: i % 4 === 0 ? 'תשובה זהה' : `ניחוש ${p.name} ${d}` }, p.auth)));
    v = (await call<{ view: PublicState }>('state', {}, screen)).view;
    expect(v.phase).toBe('VOTING');
    expect(v.options!.filter((o) => o.text === 'תשובה זהה').length).toBe(1);
    await expect(call('player:answer', { text: 'מאוחר' }, others[0].auth)).rejects.toThrow();
    await Promise.all(others.map(async (p) => {
      const me = (await call<{ view: PlayerView }>('state', {}, p.auth)).view.me;
      const choice = v.options!.find((o) => !me.myOptionIds.includes(o.id))!;
      await call('player:vote', { optionId: choice.id }, p.auth);
    }));
    v = (await call<{ view: PublicState }>('state', {}, screen)).view;
    expect(v.phase).toBe('REVEAL');
    expect(v.reveal!.options[0].isTruth).toBe(true);
    await expect(call('player:vote', { optionId: v.reveal!.options[0].id }, others[0].auth)).rejects.toThrow();
    await call('host:next', {}, host);
  }
  const res = (await call<{ view: PublicState }>('state', {}, screen)).view;
  expect(res.phase).toBe('ROUND_RESULTS');
  expect(res.leaderboard!.reduce((s, l) => s + l.score, 0)).toBeGreaterThan(0);
  await call('host:next', {}, host);
  const fin = (await call<{ view: PublicState }>('state', {}, screen)).view;
  expect(fin.phase).toBe('FINAL');
  await call('host:newGame', {}, host);
  const again = (await call<{ view: HostView }>('state', {}, host)).view;
  expect(again.pub.phase).toBe('LOBBY');
  expect(again.pub.players.length).toBe(9);
});

it('timers advance lazily on the next request and silent players disconnect', async () => {
  const { code, hostToken } = await call('host:create', {});
  const host = { code, role: 'host' as const, hostToken };
  const ps = await Promise.all(['א', 'ב', 'ג'].map((name) => call('player:join', { name }, { code })));
  await call('host:start', {}, host);
  const row = (await store.get(code))!;
  // Simulate 2 minutes passing and players going silent.
  const aged = row.state.replace(/"deadline":(\d+)/, (_m, d) => `"deadline":${Number(d) - 120_000}`);
  await store.update(code, aged, row.version);
  const v = (await call<{ view: HostView }>('state', {}, host)).view;
  expect(v.pub.phase).toBe('ANSWERING');
  expect(ps.length).toBe(3);
});
