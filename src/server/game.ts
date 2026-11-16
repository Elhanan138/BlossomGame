import { randomBytes, randomInt } from 'node:crypto';
import { PROMPTS, TEAM_QUESTIONS } from './prompts';
import {
  DEFAULT_SETTINGS, LIMITS,
  type FinalHighlights, type GamePhase, type GameSettings, type HostView, type PlayerPrivate,
  type PublicState, type RecapSlide, type RevealOption, type ScoreLine,
} from '../shared/types';

const validRef = (r: unknown) => (typeof r === 'string' && r.length > 0 && r.length < 400 ? r : fail('הציור לא תקין'));
export class GameError extends Error {}
const fail = (msg: string): never => { throw new GameError(msg); };

export const token = () => randomBytes(16).toString('hex');
export function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = randomInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
import { normalize } from './normalize';
import { buildRecap, slideSeconds, type HistoryEntry } from './recap';
export { normalize };
const clamp = (v: unknown, lo: number, hi: number, d: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
};
export function sanitizeSettings(s: Partial<GameSettings> = {}, base: GameSettings = DEFAULT_SETTINGS): GameSettings {
  const sc: Partial<GameSettings['scoring']> = s.scoring ?? {};
  return {
    rounds: clamp(s.rounds ?? base.rounds, 1, 3, base.rounds),
    drawSeconds: clamp(s.drawSeconds ?? base.drawSeconds, 30, 180, base.drawSeconds),
    answerSeconds: clamp(s.answerSeconds ?? base.answerSeconds, 15, 120, base.answerSeconds),
    voteSeconds: clamp(s.voteSeconds ?? base.voteSeconds, 10, 90, base.voteSeconds),
    revealSeconds: clamp(s.revealSeconds ?? base.revealSeconds, 5, 30, base.revealSeconds),
    resultsSeconds: clamp(s.resultsSeconds ?? base.resultsSeconds, 5, 60, base.resultsSeconds),
    mode: s.mode === 'team' || s.mode === 'regular' ? s.mode : base.mode,
    autoAdvance: typeof s.autoAdvance === 'boolean' ? s.autoAdvance : base.autoAdvance,
    scoring: {
      correctGuess: clamp(sc.correctGuess ?? base.scoring.correctGuess, 0, 10000, 1000),
      perFooled: clamp(sc.perFooled ?? base.scoring.perFooled, 0, 10000, 500),
      artistBonus: clamp(sc.artistBonus ?? base.scoring.artistBonus, 0, 10000, 250),
    },
  };
}
export function validName(raw: unknown): string {
  const name = String(raw ?? '').replace(/[\u0000-\u001F\u007F<>]/g, '').replace(/\s+/g, ' ').trim();
  if (!name) fail('צריך לכתוב שם או כינוי');
  if ([...name].length > LIMITS.nameMax) fail(`השם ארוך מדי (עד ${LIMITS.nameMax} תווים)`);
  return name;
}
export function validImage(img: unknown): string {
  if (typeof img !== 'string' || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(img)) fail('הציור לא תקין');
  if ((img as string).length > LIMITS.drawingMaxBytes) fail('הציור גדול מדי');
  return img as string;
}

interface Player { id: string; name: string; token: string; score: number; connected: boolean }
interface Drawing { artistId: string; prompt: string; image: string | null; skipped: boolean }
interface Option { id: string; text: string; norm: string; isTruth: boolean; house: boolean; authorIds: string[] }

export interface Clock { now(): number; set(fn: () => void, ms: number): unknown; clear(h: unknown): void }
const realClock: Clock = { now: Date.now, set: (fn, ms) => setTimeout(fn, ms), clear: (h) => clearTimeout(h as NodeJS.Timeout) };

export class Room {
  hostToken = token();
  settings: GameSettings;
  phase: GamePhase = 'LOBBY';
  paused = false;
  deadline: number | null = null;
  remainingMs: number | null = null;
  players = new Map<string, Player>();
  round = 0;
  drawings: Drawing[] = [];
  drawingIndex = 0;
  drafts = new Map<string, string>();
  submittedDrawings = new Set<string>();
  answers = new Map<string, { text: string; norm: string }>();
  options: Option[] = [];
  votes = new Map<string, string>();
  reveal: PublicState['reveal'] = null;
  leaderboard: ScoreLine[] | null = null;
  question: string | null = null;
  highlights: FinalHighlights | null = null;
  lastActivity: number;
  seen: Record<string, number> = {};
  private usedPrompts = new Set<string>();
  private usedQuestions = new Set<string>();
  private roundStartScores = new Map<string, number>();
  private prevRanks = new Map<string, number>();
  history: HistoryEntry[] = [];
  recapSlides: RecapSlide[] = [];
  recapIndex = 0;
  private timer: unknown = null;

  constructor(public code: string, settings?: Partial<GameSettings>, public onChange: () => void = () => {}, public clock: Clock = realClock) {
    this.settings = sanitizeSettings(settings);
    this.lastActivity = clock.now();
  }

  // ---------- helpers ----------
  private touch() { this.lastActivity = this.clock.now(); }
  private changed() { this.touch(); this.onChange(); }
  get artist(): Drawing | undefined {
    return ['ANSWERING', 'VOTING', 'REVEAL'].includes(this.phase) ? this.drawings[this.drawingIndex] : undefined;
  }
  private connected() { return [...this.players.values()].filter((p) => p.connected); }
  private player(id: string) { return this.players.get(id) ?? fail('המשתתף לא נמצא בחדר'); }
  /** Players expected to act in the current phase. */
  expectedIds(): string[] {
    const artistId = this.artist?.artistId;
    switch (this.phase) {
      case 'DRAWING': return this.connected().map((p) => p.id);
      case 'ANSWERING':
      case 'VOTING': return this.connected().filter((p) => p.id !== artistId).map((p) => p.id);
      default: return [];
    }
  }
  private doneSet(): Set<string> {
    if (this.phase === 'DRAWING') return this.submittedDrawings;
    if (this.phase === 'ANSWERING') return new Set(this.answers.keys());
    if (this.phase === 'VOTING') return new Set(this.votes.keys());
    return new Set();
  }
  private allDone() {
    const exp = this.expectedIds();
    const done = this.doneSet();
    return exp.length > 0 && exp.every((id) => done.has(id));
  }
  private setTimer(seconds: number | null) {
    if (this.timer) this.clock.clear(this.timer);
    this.timer = null;
    this.remainingMs = null;
    this.deadline = seconds == null ? null : this.clock.now() + seconds * 1000;
    if (this.deadline != null && this.paused) { this.remainingMs = seconds! * 1000; this.deadline = null; }
    this.arm();
  }
  private arm() {
    if (this.timer) this.clock.clear(this.timer);
    this.timer = null;
    if (this.deadline == null || this.paused) return;
    const phase = this.phase, round = this.round, idx = this.drawingIndex;
    this.timer = this.clock.set(() => {
      this.timer = null;
      if (this.phase === phase && this.round === round && this.drawingIndex === idx && !this.paused) this.endPhase();
    }, Math.max(0, this.deadline - this.clock.now()));
  }
  private autoSeconds(s: number) { return this.settings.autoAdvance ? s : null; }
  /** Serverless mode: apply any deadlines that passed since the last request. */
  tick() {
    for (let i = 0; i < 20 && !this.paused && this.deadline != null && this.clock.now() >= this.deadline; i++) this.endPhase();
  }
  /** Serverless presence: players are connected if seen recently. */
  applyPresence(seen: Record<string, number>, windowMs = 15000) {
    const now = this.clock.now();
    let changed = false;
    for (const p of this.players.values()) {
      const c = now - (seen[p.id] ?? 0) < windowMs;
      if (c !== p.connected) { p.connected = c; changed = true; }
    }
    if (changed && !this.paused && this.allDone()) this.endPhase();
  }
  serialize(): string {
    const { onChange, clock, timer, ...data } = this as any;
    return JSON.stringify(data, (_k, v) => (v instanceof Map ? { __map: [...v] } : v instanceof Set ? { __set: [...v] } : v));
  }
  static deserialize(json: string, clock: Clock): Room {
    const data = JSON.parse(json, (_k, v) => (v && typeof v === 'object' && '__map' in v ? new Map(v.__map) : v && typeof v === 'object' && '__set' in v ? new Set(v.__set) : v));
    const r = Object.assign(Object.create(Room.prototype), data) as Room;
    Object.assign(r, { clock, onChange: () => {}, timer: null });
    return r;
  }
  dispose() { if (this.timer) this.clock.clear(this.timer); this.timer = null; }

  // ---------- players ----------
  addPlayer(rawName: unknown) {
    if (this.phase !== 'LOBBY') fail('המשחק כבר התחיל. אפשר להצטרף במשחק הבא');
    if (this.players.size >= LIMITS.maxPlayers) fail('החדר מלא');
    const name = validName(rawName);
    const norm = normalize(name) || name;
    if ([...this.players.values()].some((p) => (normalize(p.name) || p.name) === norm)) fail('השם הזה כבר תפוס, אולי להוסיף אות?');
    const p: Player = { id: token().slice(0, 12), name, token: token(), score: 0, connected: true };
    this.players.set(p.id, p);
    this.changed();
    return p;
  }
  auth(playerId: unknown, tok: unknown): Player {
    const p = this.players.get(String(playerId));
    if (!p || typeof tok !== 'string' || p.token !== tok) fail('לא הצלחנו לזהות אותך בחדר הזה');
    return p!;
  }
  setConnected(id: string, connected: boolean) {
    const p = this.players.get(id);
    if (!p || p.connected === connected) return;
    p.connected = connected;
    if (!this.paused && this.allDone()) return this.endPhase();
    this.changed();
  }
  kick(id: string) {
    if (this.phase !== 'LOBBY') fail('אפשר להסיר משתתפים רק לפני תחילת המשחק');
    this.player(id);
    this.players.delete(id);
    this.changed();
  }
  updateSettings(s: Partial<GameSettings>) {
    if (this.phase !== 'LOBBY') fail('אפשר לשנות הגדרות רק לפני תחילת המשחק');
    this.settings = sanitizeSettings(s, this.settings);
    this.changed();
  }

  // ---------- flow ----------
  start() {
    if (this.phase !== 'LOBBY') fail('המשחק כבר התחיל');
    if (this.connected().length < LIMITS.minPlayers) fail(`צריך לפחות ${LIMITS.minPlayers} משתתפים מחוברים`);
    for (const p of this.players.values()) p.score = 0;
    this.round = 0;
    this.history = []; this.recapSlides = []; this.prevRanks.clear();
    this.startRound();
  }
  private pickPrompts(n: number): string[] {
    let pool = PROMPTS.filter((p) => !this.usedPrompts.has(p));
    if (pool.length < n + 3) { this.usedPrompts.clear(); pool = [...PROMPTS]; }
    const picked = shuffle(pool).slice(0, n);
    picked.forEach((p) => this.usedPrompts.add(p));
    return picked;
  }
  private startRound() {
    this.round++;
    const ps = [...this.players.values()];
    const prompts = this.pickPrompts(ps.length);
    this.drawings = ps.map((p, i) => ({ artistId: p.id, prompt: prompts[i], image: null, skipped: false }));
    this.drafts.clear();
    this.submittedDrawings.clear();
    this.roundStartScores = new Map(ps.map((p) => [p.id, p.score]));
    this.drawingIndex = 0;
    this.phase = 'DRAWING';
    this.setTimer(this.settings.drawSeconds);
    this.changed();
  }
  saveDraft(pid: string, img: unknown) {
    if (this.phase !== 'DRAWING' || this.submittedDrawings.has(pid)) return;
    this.player(pid);
    this.drafts.set(pid, validRef(img));
    this.touch();
  }
  submitDrawing(pid: string, img: unknown) {
    if (this.phase !== 'DRAWING') fail('זמן הציור הסתיים');
    this.player(pid);
    if (this.submittedDrawings.has(pid)) fail('הציור כבר הוגש');
    this.drafts.set(pid, validRef(img));
    this.submittedDrawings.add(pid);
    if (this.allDone()) this.endPhase(); else this.changed();
  }
  submitAnswer(pid: string, raw: unknown) {
    if (this.phase !== 'ANSWERING') fail('זמן כתיבת התשובות הסתיים');
    const d = this.artist!;
    if (d.artistId === pid) fail('זה הציור שלך, הפעם רק צופים 😉');
    this.player(pid);
    const text = String(raw ?? '').replace(/[\u0000-\u001F\u007F]/g, '').replace(/\s+/g, ' ').trim();
    if (!text) fail('אי אפשר לשלוח תשובה ריקה');
    if ([...text].length > LIMITS.answerMax) fail(`עד ${LIMITS.answerMax} תווים`);
    const norm = normalize(text) || text;
    if (norm === normalize(d.prompt)) fail('וואו, זה בדיוק הביטוי המקורי! נסו לכתוב משהו אחר כדי לעבוד על השאר');
    this.answers.set(pid, { text, norm });
    if (this.allDone()) this.endPhase(); else this.changed();
  }
  vote(pid: string, optionId: unknown) {
    if (this.phase !== 'VOTING') fail('ההצבעה הסתיימה');
    if (this.artist!.artistId === pid) fail('בעל הציור לא מצביע');
    this.player(pid);
    if (this.votes.has(pid)) fail('כבר הצבעת');
    const opt = this.options.find((o) => o.id === optionId) ?? fail('האפשרות לא קיימת');
    if (opt.authorIds.includes(pid)) fail('אי אפשר להצביע לתשובה שכתבת');
    this.votes.set(pid, opt.id);
    if (this.allDone()) this.endPhase(); else this.changed();
  }

  /** Finish the current phase (timer expiry, everyone done, or host "next"). */
  endPhase() {
    switch (this.phase) {
      case 'LOBBY': return this.start();
      case 'DRAWING': return this.endDrawing();
      case 'ANSWERING': return this.endAnswering();
      case 'VOTING': return this.endVoting();
      case 'REVEAL': return this.nextDrawing();
      case 'ROUND_RESULTS': return this.afterResults();
      case 'DISCUSSION': return this.afterDiscussion();
      case 'RECAP': return this.recapIndex + 1 < this.recapSlides.length ? this.showSlide(this.recapIndex + 1) : this.final();
      case 'FINAL': return;
    }
  }
  private endDrawing() {
    for (const d of this.drawings) d.image = this.drafts.get(d.artistId) ?? null;
    this.drafts.clear();
    this.drawings = shuffle(this.drawings);
    this.drawingIndex = 0;
    this.startAnswering();
  }
  private startAnswering() {
    this.answers.clear(); this.votes.clear(); this.options = []; this.reveal = null;
    this.phase = 'ANSWERING';
    this.setTimer(this.settings.answerSeconds);
    this.changed();
  }
  private endAnswering() {
    const d = this.artist!;
    const truth: Option = { id: '', text: d.prompt, norm: normalize(d.prompt), isTruth: true, house: false, authorIds: [] };
    const fakes = new Map<string, Option>();
    for (const [pid, a] of this.answers) {
      const ex = fakes.get(a.norm);
      if (ex) ex.authorIds.push(pid);
      else fakes.set(a.norm, { id: '', text: a.text, norm: a.norm, isTruth: false, house: false, authorIds: [pid] });
    }
    const opts = [truth, ...fakes.values()];
    // Guarantee a real choice even when few answers came in.
    if (opts.length < 3) {
      const taken = new Set(opts.map((o) => o.norm));
      for (const p of shuffle(PROMPTS)) {
        if (opts.length >= 3) break;
        if (taken.has(normalize(p)) || this.drawings.some((x) => x.prompt === p)) continue;
        opts.push({ id: '', text: p, norm: normalize(p), isTruth: false, house: true, authorIds: [] });
      }
    }
    this.options = shuffle(opts).map((o, i) => ({ ...o, id: `o${i + 1}` }));
    this.votes.clear();
    this.phase = 'VOTING';
    this.setTimer(this.settings.voteSeconds);
    this.changed();
  }
  private endVoting() {
    const d = this.artist!;
    const sc = this.settings.scoring;
    const gains: Record<string, number> = {};
    const add = (id: string, n: number) => { if (this.players.has(id)) gains[id] = (gains[id] ?? 0) + n; };
    let wrong = 0;
    for (const [voter, oid] of this.votes) {
      const o = this.options.find((x) => x.id === oid)!;
      if (o.isTruth) add(voter, sc.correctGuess);
      else { wrong++; o.authorIds.forEach((a) => add(a, sc.perFooled)); }
    }
    if (this.votes.size > 0 && wrong * 2 >= this.votes.size) add(d.artistId, sc.artistBonus);
    for (const [id, n] of Object.entries(gains)) this.players.get(id)!.score += n;
    const name = (id: string) => this.players.get(id)?.name ?? 'משתתף שעזב';
    const options: RevealOption[] = this.options.map((o) => ({
      id: o.id, text: o.text, isTruth: o.isTruth, house: o.house,
      authors: o.authorIds.map(name),
      voters: [...this.votes].filter(([, v]) => v === o.id).map(([p]) => name(p)),
    }));
    // Truth first, then most-voted lies.
    options.sort((a, b) => Number(b.isTruth) - Number(a.isTruth) || b.voters.length - a.voters.length);
    this.reveal = { prompt: d.prompt, options, gains };
    this.history.push({
      round: this.round, image: d.image, prompt: d.prompt, artist: name(d.artistId),
      answers: options.filter((o) => !o.isTruth && !o.house).map((o) => ({ text: o.text, authors: o.authors, voters: o.voters })),
      correct: options.find((o) => o.isTruth)?.voters ?? [],
      missed: this.expectedIds().filter((id) => !this.votes.has(id)).map(name),
    });
    this.phase = 'REVEAL';
    this.setTimer(this.autoSeconds(this.settings.revealSeconds));
    this.changed();
  }
  private nextDrawing() {
    this.drawingIndex++;
    while (this.drawingIndex < this.drawings.length && this.drawings[this.drawingIndex].skipped) this.drawingIndex++;
    if (this.drawingIndex < this.drawings.length) this.startAnswering();
    else this.roundResults();
  }
  skipDrawing() {
    if (!['ANSWERING', 'VOTING', 'REVEAL'].includes(this.phase)) fail('אין כרגע ציור לדלג עליו');
    this.drawings[this.drawingIndex].skipped = true;
    this.nextDrawing();
  }
  private ranking(): ScoreLine[] {
    const ps = [...this.players.values()].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, 'he'));
    return ps.map((p) => {
      const rank = 1 + ps.filter((q) => q.score > p.score).length;
      return { playerId: p.id, name: p.name, score: p.score, gained: p.score - (this.roundStartScores.get(p.id) ?? 0), rank, prevRank: this.prevRanks.get(p.id) ?? null };
    });
  }
  private roundResults() {
    this.leaderboard = this.ranking();
    this.leaderboard.forEach((l) => this.prevRanks.set(l.playerId, l.rank));
    this.phase = 'ROUND_RESULTS';
    this.reveal = null;
    this.setTimer(this.autoSeconds(this.settings.resultsSeconds));
    this.changed();
  }
  private afterResults() {
    if (this.settings.mode === 'team') {
      const pool = TEAM_QUESTIONS.filter((q) => !this.usedQuestions.has(q));
      this.question = shuffle(pool.length ? pool : TEAM_QUESTIONS)[0];
      this.usedQuestions.add(this.question);
      this.phase = 'DISCUSSION';
      this.setTimer(this.autoSeconds(60));
      this.changed();
    } else this.afterDiscussion();
  }
  private afterDiscussion() {
    this.question = null;
    if (this.round < this.settings.rounds) this.startRound();
    else this.finish();
  }
  /** End of game: comedy recap of everyone's interpretations first (if any), then the podium. */
  finish() {
    if (this.phase === 'LOBBY') fail('המשחק עוד לא התחיל');
    if (this.phase === 'RECAP' || this.phase === 'FINAL') return this.final();
    this.recapSlides = buildRecap(this.history);
    if (!this.recapSlides.length) return this.final();
    this.reveal = null; this.question = null; this.options = [];
    this.phase = 'RECAP';
    this.showSlide(0);
  }
  private showSlide(i: number) {
    this.recapIndex = Math.max(0, Math.min(i, this.recapSlides.length - 1));
    this.setTimer(slideSeconds(this.recapSlides[this.recapIndex]));
    this.changed();
  }
  prevSlide() {
    if (this.phase !== 'RECAP') fail('אין כרגע סיכום להציג');
    this.showSlide(this.recapIndex - 1);
  }
  private final() {
    this.leaderboard = this.ranking().map((l) => ({ ...l, gained: 0 }));
    const wrongOf = (h: HistoryEntry) => h.answers.reduce((n, a) => n + a.voters.length, 0);
    const most = this.history.filter((h) => h.image).sort((a, b) => wrongOf(b) - wrongOf(a))[0];
    const lie = this.history.flatMap((h) => h.answers).sort((a, b) => b.voters.length - a.voters.length)[0];
    this.highlights = {
      mostFooling: most && wrongOf(most) > 0 ? { drawing: most.image!, prompt: most.prompt, artist: most.artist, wrong: wrongOf(most) } : null,
      bestLie: lie && lie.voters.length ? { text: lie.text, authors: lie.authors, fooled: lie.voters.length } : null,
    };
    this.phase = 'FINAL';
    this.reveal = null; this.question = null; this.options = [];
    this.setTimer(null);
    this.changed();
  }
  newGame() {
    this.setTimer(null);
    this.phase = 'LOBBY';
    this.paused = false;
    this.round = 0; this.drawings = []; this.leaderboard = null; this.highlights = null;
    for (const p of this.players.values()) p.score = 0;
    for (const p of [...this.players.values()]) if (!p.connected) this.players.delete(p.id);
    this.changed();
  }
  setPaused(paused: boolean) {
    if (paused === this.paused) return;
    if (paused) {
      this.remainingMs = this.deadline != null ? Math.max(0, this.deadline - this.clock.now()) : null;
      this.deadline = null;
      this.paused = true;
    } else {
      this.paused = false;
      if (this.remainingMs != null) this.deadline = this.clock.now() + this.remainingMs;
      this.remainingMs = null;
    }
    this.arm();
    this.changed();
  }
  addTime(seconds: number) {
    const ms = clamp(seconds, 5, 120, 15) * 1000;
    if (this.paused && this.remainingMs != null) this.remainingMs += ms;
    else if (this.deadline != null) { this.deadline += ms; this.arm(); }
    else fail('אין טיימר פעיל');
    this.changed();
  }

  // ---------- views ----------
  publicState(): PublicState {
    const d = this.artist;
    const done = this.doneSet();
    const exp = this.expectedIds();
    const showDrawing = d && ['ANSWERING', 'VOTING', 'REVEAL'].includes(this.phase);
    return {
      code: this.code, phase: this.phase, paused: this.paused,
      deadline: this.deadline, remainingMs: this.remainingMs, serverNow: this.clock.now(),
      settings: this.settings, round: this.round, drawingIndex: this.drawingIndex,
      drawingCount: this.drawings.length,
      players: [...this.players.values()].map((p) => ({ id: p.id, name: p.name, score: p.score, connected: p.connected, done: done.has(p.id) })),
      artistId: d?.artistId ?? null,
      artistName: d ? this.players.get(d.artistId)?.name ?? null : null,
      drawing: showDrawing ? d!.image : null,
      options: this.phase === 'VOTING' ? this.options.map((o) => ({ id: o.id, text: o.text })) : null,
      reveal: this.phase === 'REVEAL' ? this.reveal : null,
      leaderboard: ['ROUND_RESULTS', 'FINAL'].includes(this.phase) ? this.leaderboard : null,
      question: this.phase === 'DISCUSSION' ? this.question : null,
      highlights: this.phase === 'FINAL' ? this.highlights : null,
      recap: this.phase === 'RECAP' && this.recapSlides.length ? { index: this.recapIndex, total: this.recapSlides.length, slide: this.recapSlides[this.recapIndex] } : null,
      expected: exp.length,
      submitted: exp.filter((id) => done.has(id)).length,
    };
  }
  playerPrivate(pid: string): PlayerPrivate {
    const p = this.player(pid);
    const d = this.artist;
    const own = this.drawings.find((x) => x.artistId === pid);
    const isArtist = d?.artistId === pid;
    return {
      playerId: p.id, name: p.name,
      prompt: this.phase === 'DRAWING' ? own?.prompt ?? null : isArtist && this.phase !== 'REVEAL' ? d!.prompt : null,
      draft: this.phase === 'DRAWING' ? this.drafts.get(pid) ?? null : null,
      submittedDrawing: this.submittedDrawings.has(pid),
      isArtist,
      myAnswer: this.answers.get(pid)?.text ?? null,
      myOptionIds: this.options.filter((o) => o.authorIds.includes(pid)).map((o) => o.id),
      myVote: this.votes.get(pid) ?? null,
      canAct: this.expectedIds().includes(pid) && !this.doneSet().has(pid),
    };
  }
  hostView(): HostView {
    const s = this.settings;
    const n = Math.max(this.players.size, LIMITS.minPlayers);
    const perRound = s.drawSeconds + n * (s.answerSeconds + s.voteSeconds + s.revealSeconds + 4) + s.resultsSeconds + (s.mode === 'team' ? 60 : 0);
    return { pub: this.publicState(), estimateMinutes: Math.ceil((perRound * s.rounds) / 60) };
  }
}
