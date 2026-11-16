// Types shared by server and client. The server is the single source of truth;
// clients receive role-specific, sanitized "views" and send intents.

export type GamePhase =
  | 'LOBBY'
  | 'DRAWING'
  | 'ANSWERING'
  | 'VOTING'
  | 'REVEAL'
  | 'ROUND_RESULTS'
  | 'DISCUSSION'
  | 'RECAP'
  | 'FINAL';

export type GameMode = 'regular' | 'team';

export interface ScoringRules {
  correctGuess: number;
  perFooled: number;
  artistBonus: number;
}

export interface GameSettings {
  rounds: number; // 1..3
  drawSeconds: number; // 30..180
  answerSeconds: number; // 15..120
  voteSeconds: number; // 10..90
  revealSeconds: number; // 5..30
  resultsSeconds: number; // 5..60
  mode: GameMode;
  autoAdvance: boolean;
  scoring: ScoringRules;
}

export const DEFAULT_SETTINGS: GameSettings = {
  rounds: 1,
  drawSeconds: 90,
  answerSeconds: 45,
  voteSeconds: 30,
  revealSeconds: 10,
  resultsSeconds: 15,
  mode: 'regular',
  autoAdvance: true,
  scoring: { correctGuess: 1000, perFooled: 500, artistBonus: 250 },
};

export const LIMITS = {
  minPlayers: 3,
  maxPlayers: 12,
  nameMax: 20,
  answerMax: 100,
  drawingMaxBytes: 600_000,
};

export interface PublicPlayer {
  id: string;
  name: string;
  score: number;
  connected: boolean;
  done: boolean; // submitted in current phase (drawing/answer/vote)
}

export interface VoteOption {
  id: string;
  text: string;
}

export interface RevealOption {
  id: string;
  text: string;
  isTruth: boolean;
  authors: string[]; // names; empty for truth/house decoys
  house: boolean;
  voters: string[]; // names
}

export interface ScoreLine {
  playerId: string;
  name: string;
  score: number;
  gained: number;
  rank: number;
  prevRank: number | null;
}

export type RecapSlide =
  | { kind: 'intro'; title: string; text: string; stat: string }
  | { kind: 'drawing'; step: number; steps: number; image: string | null; artist: string; prompt: string; lines: { text: string; fooled: string | null; voters: string[] }[]; caption: string }
  | { kind: 'award'; emoji: string; title: string; winners: string; line: string; quote?: string };

export interface FinalHighlights {
  mostFooling: { drawing: string; prompt: string; artist: string; wrong: number } | null;
  bestLie: { text: string; authors: string[]; fooled: number } | null;
}

// What every viewer of a room may see (projector-safe: no secrets before reveal).
export interface PublicState {
  code: string;
  phase: GamePhase;
  paused: boolean;
  deadline: number | null; // server epoch ms
  remainingMs: number | null; // when paused
  serverNow: number;
  settings: GameSettings;
  round: number; // 1-based
  drawingIndex: number; // 0-based within round
  drawingCount: number;
  players: PublicPlayer[];
  artistId: string | null;
  artistName: string | null;
  drawing: string | null; // data URL of the drawing being discussed
  options: VoteOption[] | null; // in VOTING
  reveal: { prompt: string; options: RevealOption[]; gains: Record<string, number> } | null;
  leaderboard: ScoreLine[] | null; // ROUND_RESULTS / FINAL
  question: string | null; // DISCUSSION
  highlights: FinalHighlights | null; // FINAL
  recap: { index: number; total: number; slide: RecapSlide } | null; // RECAP
  recapAll: RecapSlide[] | null; // FINAL: whole recap, browsable on phones
  expected: number; // how many submissions this phase expects
  submitted: number;
}

export interface PlayerPrivate {
  playerId: string;
  name: string;
  prompt: string | null; // own prompt during DRAWING
  draft: string | null; // last saved draft (for restore)
  submittedDrawing: boolean;
  isArtist: boolean; // owner of the current drawing
  myAnswer: string | null;
  myOptionIds: string[]; // options authored by me (can't vote for them)
  myVote: string | null;
  canAct: boolean; // expected to act in this phase
}

export interface PlayerView {
  pub: PublicState;
  me: PlayerPrivate;
}

export interface HostView {
  pub: PublicState;
  estimateMinutes: number;
}

export type Ack<T = {}> = (res: ({ ok: true } & T) | { ok: false; error: string }) => void;

export interface ClientToServer {
  'host:create': (a: { settings?: Partial<GameSettings> }, ack: Ack<{ code: string; hostToken: string }>) => void;
  'host:attach': (a: { code: string; hostToken: string }, ack: Ack) => void;
  'host:settings': (a: { settings: Partial<GameSettings> }, ack: Ack) => void;
  'host:start': (a: {}, ack: Ack) => void;
  'host:pause': (a: { paused: boolean }, ack: Ack) => void;
  'host:next': (a: {}, ack: Ack) => void;
  'host:skipDrawing': (a: {}, ack: Ack) => void;
  'host:addTime': (a: { seconds: number }, ack: Ack) => void;
  'host:kick': (a: { playerId: string }, ack: Ack) => void;
  'host:end': (a: {}, ack: Ack) => void;
  'host:newGame': (a: {}, ack: Ack) => void;
  'screen:attach': (a: { code: string }, ack: Ack) => void;
  'player:join': (a: { code: string; name: string }, ack: Ack<{ playerId: string; token: string }>) => void;
  'player:resume': (a: { code: string; playerId: string; token: string }, ack: Ack) => void;
  'player:draft': (a: { image: string }, ack: Ack) => void;
  'player:submitDrawing': (a: { image: string }, ack: Ack) => void;
  'player:answer': (a: { text: string }, ack: Ack) => void;
  'player:vote': (a: { optionId: string }, ack: Ack) => void;
}

export interface ServerToClient {
  'state:player': (v: PlayerView) => void;
  'state:host': (v: HostView) => void;
  'state:screen': (v: PublicState) => void;
  kicked: () => void;
}
