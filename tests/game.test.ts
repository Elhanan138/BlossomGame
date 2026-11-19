import { describe, expect, it } from 'vitest';
import { Room, normalize, type Clock } from '../src/server/game';

const IMG = 'data:image/png;base64,iVBORw0KGgo=';
function fakeClock() {
  let t = 0;
  const timers: { at: number; fn: () => void; id: number }[] = [];
  let id = 0;
  const clock: Clock = {
    now: () => t,
    set: (fn, ms) => { timers.push({ at: t + ms, fn, id: ++id }); return id; },
    clear: (h) => { const i = timers.findIndex((x) => x.id === h); if (i >= 0) timers.splice(i, 1); },
  };
  const advance = (ms: number) => {
    t += ms;
    for (;;) {
      timers.sort((a, b) => a.at - b.at);
      const next = timers[0];
      if (!next || next.at > t) break;
      timers.shift(); next.fn();
    }
  };
  return { clock, advance };
}
function setup(n = 4, settings = {}) {
  const c = fakeClock();
  const room = new Room('TEST01', settings, () => {}, c.clock);
  const ps = Array.from({ length: n }, (_, i) => room.addPlayer(`שחקן ${i + 1}`));
  return { room, ps, ...c };
}
const nonArtists = (room: Room, ps: { id: string }[]) => ps.filter((p) => p.id !== room.artist!.artistId);

describe('lobby', () => {
  it('rejects duplicate names, empty names and too few players', () => {
    const { room } = setup(1);
    expect(() => room.addPlayer('שחקן 1')).toThrow(/תפוס/);
    expect(() => room.addPlayer('  ')).toThrow();
    expect(() => room.start()).toThrow(/לפחות 2/);
  });
  it('two players can play a full game: real choice in every vote, recap, podium', () => {
    const { room, ps } = setup(2);
    room.start();
    ps.forEach((p) => room.submitDrawing(p.id, IMG));
    for (let d = 0; d < 2; d++) {
      expect(room.phase).toBe('ANSWERING');
      const [guesser] = nonArtists(room, ps);
      room.submitAnswer(guesser.id, `ניחוש ${d}`);
      expect(room.phase).toBe('VOTING');
      const choices = room.options.filter((o) => !o.authorIds.includes(guesser.id));
      expect(choices.length).toBeGreaterThanOrEqual(2); // truth + house decoy
      room.vote(guesser.id, choices.find((o) => o.isTruth)!.id);
      expect(room.phase).toBe('REVEAL');
      room.endPhase();
    }
    expect(room.phase).toBe('ROUND_RESULTS');
    room.endPhase();
    expect(room.phase).toBe('RECAP');
    room.finish();
    expect(room.phase).toBe('FINAL');
    expect(room.players.get(ps[0].id)!.score).toBe(1000);
    expect(room.players.get(ps[1].id)!.score).toBe(1000);
  });
  it('closes the room once started', () => {
    const { room } = setup(3);
    room.start();
    expect(() => room.addPlayer('מאוחר')).toThrow(/התחיל/);
  });
});

describe('full round', () => {
  it('runs drawing → answers → voting → reveal with correct scoring and secrecy', () => {
    const { room, ps } = setup(4);
    room.start();
    expect(room.phase).toBe('DRAWING');
    const prompts = ps.map((p) => room.playerPrivate(p.id).prompt);
    expect(new Set(prompts).size).toBe(4);
    expect(JSON.stringify(room.publicState())).not.toContain(prompts[0]!);
    ps.forEach((p) => room.submitDrawing(p.id, IMG));
    expect(room.phase).toBe('ANSWERING');

    const artistId = room.artist!.artistId;
    const truth = room.drawings[0].prompt;
    expect(JSON.stringify(room.publicState())).not.toContain(truth);
    expect(() => room.submitAnswer(artistId, 'x')).toThrow();
    const [a, b, c] = nonArtists(room, ps);
    expect(() => room.submitAnswer(a.id, truth)).toThrow(/המקורי/);
    expect(() => room.submitAnswer(a.id, '')).toThrow(/ריקה/);
    room.submitAnswer(a.id, 'שקר אחד');
    room.submitAnswer(b.id, 'שקר  אחד!'); // duplicate after normalization → merged
    room.submitAnswer(c.id, 'שקר שני');
    expect(room.phase).toBe('VOTING');
    expect(room.options.length).toBe(3);
    const lie1 = room.options.find((o) => o.text === 'שקר אחד')!;
    const truthOpt = room.options.find((o) => o.isTruth)!;
    expect(() => room.vote(a.id, lie1.id)).toThrow(/שכתבת/);
    room.vote(a.id, truthOpt.id);
    expect(() => room.vote(a.id, truthOpt.id)).toThrow(/כבר/);
    room.vote(b.id, room.options.find((o) => o.text === 'שקר שני')!.id);
    room.vote(c.id, lie1.id);
    expect(room.phase).toBe('REVEAL');
    const score = (id: string) => room.players.get(id)!.score;
    expect(score(a.id)).toBe(1000 + 500); // correct + fooled c
    expect(score(b.id)).toBe(500); // co-author of lie1, fooled c
    expect(score(c.id)).toBe(500); // fooled b
    expect(score(artistId)).toBe(250); // 2 of 3 wrong
  });

  it('auto-submits drafts / blanks at timeout, adds decoys, and finishes all rounds', () => {
    const { room, ps, advance } = setup(3, { rounds: 2 });
    room.start();
    room.saveDraft(ps[0].id, IMG);
    advance(90_000);
    expect(room.phase).toBe('ANSWERING');
    expect(room.drawings.find((d) => d.artistId === ps[0].id)!.image).toBe(IMG);
    expect(room.drawings.find((d) => d.artistId === ps[1].id)!.image).toBeNull();
    advance(45_000); // nobody answers
    expect(room.phase).toBe('VOTING');
    expect(room.options.length).toBe(3); // truth + 2 house decoys
    for (let i = 0; i < 200 && room.phase !== 'FINAL'; i++) advance(60_000);
    expect(room.phase).toBe('FINAL');
    expect(room.round).toBe(2);
    expect(room.publicState().leaderboard!.length).toBe(3);
  });
});

describe('host controls', () => {
  it('pause freezes the timer, add time extends, skip drawing moves on', () => {
    const { room, ps, advance } = setup(3);
    room.start();
    advance(30_000);
    room.setPaused(true);
    advance(500_000);
    expect(room.phase).toBe('DRAWING');
    expect(room.remainingMs).toBe(60_000);
    room.addTime(15);
    room.setPaused(false);
    advance(74_000);
    expect(room.phase).toBe('DRAWING');
    advance(1_000);
    expect(room.phase).toBe('ANSWERING');
    room.skipDrawing();
    expect(room.drawingIndex).toBe(1);
    room.finish();
    expect(room.phase).toBe('FINAL');
    room.newGame();
    expect(room.phase).toBe('LOBBY');
    expect(room.players.size).toBe(3);
    expect(ps.every((p) => room.players.get(p.id)!.score === 0)).toBe(true);
  });

  it('disconnected players do not block progress', () => {
    const { room, ps } = setup(3);
    room.start();
    room.setConnected(ps[2].id, false);
    room.submitDrawing(ps[0].id, IMG);
    room.submitDrawing(ps[1].id, IMG);
    expect(room.phase).toBe('ANSWERING');
  });
});

it('normalize ignores punctuation, spacing and niqqud', () => {
  expect(normalize('  שָׁלוֹם,   עולם!! ')).toBe(normalize('שלום עולם'));
});

describe('recap', () => {
  it('tells the story through the interpretations and hands out awards', async () => {
    const { buildRecap } = await import('../src/server/recap');
    const slides = buildRecap([
      { round: 1, image: 'x', prompt: 'פינגווין מאחר לפגישה', artist: 'נועה', correct: ['Dan'], missed: [],
        answers: [{ text: 'פינגווין בפגישה', authors: ['אבי'], voters: ['מאיה', 'יוסי'] }, { text: 'מלצר בפאניקה', authors: ['מאיה', 'יוסי'], voters: [] }] },
      { round: 1, image: 'y', prompt: 'בננה שעושה יוגה', artist: 'אבי', correct: [], missed: [],
        answers: [{ text: 'ירח עייף שמחפש כרית נוחה במיוחד לנמנום', authors: ['נועה'], voters: ['Dan', 'מאיה'] }] },
    ], () => 0);
    const json = JSON.stringify(slides);
    expect(slides[0].kind).toBe('intro');
    expect(slides.filter((s) => s.kind === 'drawing').length).toBe(2);
    for (const t of ['פינגווין בפגישה', 'מלצר בפאניקה', 'ירח עייף', 'השקרן', 'התמים', 'עין הנשר', 'פיקאסו', 'גדולים חושבים', 'פרס כמעט', 'הרומן הקצר']) expect(json).toContain(t);
    expect(buildRecap([])).toEqual([]);
  });
});
