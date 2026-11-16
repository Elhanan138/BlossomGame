// End-of-game comedy recap, built from everyone's interpretations during the game.
// Pure function: history in, slides out. Templates are Hebrew, workplace-safe, gender-neutral where possible.
import type { RecapSlide } from '../shared/types';
import { normalize } from './normalize';

export interface HistoryAnswer { text: string; authors: string[]; voters: string[] }
export interface HistoryEntry {
  round: number;
  image: string | null;
  prompt: string;
  artist: string;
  answers: HistoryAnswer[]; // player-written interpretations (no house decoys)
  correct: string[]; // who guessed the real prompt
  missed: string[]; // eligible voters who didn't vote
}

type Rng = () => number;
const pick = <T,>(arr: T[], rng: Rng) => arr[Math.floor(rng() * arr.length)];
const fill = (t: string, v: Record<string, string | number>) => t.replace(/\{(\w+)\}/g, (_, k) => String(v[k] ?? ''));
const list = (names: string[]) => (names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} ו${names[names.length - 1]}`);

const LINE = [
  'לפי {who}, זה בבירור "{text}"',
  '{who} הסתכל/ה על זה וראה/תה "{text}"',
  'בעיניים של {who}: "{text}"',
  '{who} היה/תה בטוח/ה במאה אחוז: "{text}"',
  'הגרסה של {who}: "{text}"',
  '{who} הגיש/ה לבית המשפט את הפרשנות "{text}"',
  'ואז הגיע/ה {who} עם "{text}"',
];
const FOOLED = ['{n} קנו את זה', '{n} האמינו בלב שלם', '{n} נפלו בפח'];
const FOOLED_ONE = ['נפל/ה בפח', 'קנה/תה את זה', 'האמין/ה בלב שלם'];
const plural = (n: number, one: string, many: string) => (n === 1 ? one : `${n} ${many}`);
const TWINS = 'ו-{who} כתבו בדיוק אותו דבר. טלפתיה או העתקה? לא נדע לעולם.';
const CAPTION_NOBODY = [
  'אף אחד לא זיהה. {artist}, זה לא אתם, זה הקנבס. כנראה.',
  'אפס ניחושים נכונים. {artist} המציא/ה כאן ז\'אנר חדש באמנות.',
  'הביטוי האמיתי ישב שם כל הזמן, ואף אחד לא בחר בו. כולם, תתביישו.',
];
const CAPTION_ALL = [
  'כולם זיהו מיד. {artist}, ציור ברור מדי זה כמעט רמאות.',
  'הצלחה מסחררת לאמנות הריאליסטית. הדמיון של כולם יצא להפסקה.',
];
const CAPTION_MIXED = [
  'רק {correct} זיהו נכון. השאר יצאו לטיול בעולם הדמיון.',
  '{correct} לא נפלו בפח. כל הכבוד, אבל קצת משעמם.',
  'הפרשנות של {topWho} גנבה את ההצגה. {artist}, סליחה.',
];
const INTRO = [
  'רגע לפני הפודיום, בואו נזכר מה באמת קרה פה.',
  'לפני שמכריזים על המנצחים: שחזור של כל הדברים שהמצאתם.',
];

function stats(history: HistoryEntry[]) {
  const s = new Map<string, { fooled: number; fell: number; correct: number; artFooled: number; wrote: number }>();
  const get = (n: string) => { if (!s.has(n)) s.set(n, { fooled: 0, fell: 0, correct: 0, artFooled: 0, wrote: 0 }); return s.get(n)!; };
  for (const h of history) {
    const wrongVotes = h.answers.reduce((a, x) => a + x.voters.length, 0);
    get(h.artist).artFooled += wrongVotes;
    h.correct.forEach((c) => get(c).correct++);
    for (const a of h.answers) {
      a.authors.forEach((w) => { get(w).fooled += a.voters.length; get(w).wrote++; });
      a.voters.forEach((v) => get(v).fell++);
    }
  }
  return s;
}

function top(s: ReturnType<typeof stats>, key: 'fooled' | 'fell' | 'correct' | 'artFooled') {
  const max = Math.max(0, ...[...s.values()].map((v) => v[key]));
  if (max <= 0) return null;
  return { names: [...s].filter(([, v]) => v[key] === max).map(([n]) => n), value: max };
}

/** How close an interpretation got to the real prompt (shared words), without being exact. */
function closeness(answer: string, prompt: string) {
  const a = new Set(normalize(answer).split(' ').filter((w) => w.length > 1));
  const p = normalize(prompt).split(' ').filter((w) => w.length > 1);
  if (!p.length) return 0;
  return p.filter((w) => a.has(w)).length / p.length;
}

export function buildRecap(history: HistoryEntry[], rng: Rng = Math.random): RecapSlide[] {
  const slides: RecapSlide[] = [];
  if (!history.length) return slides;
  const totalAnswers = history.reduce((n, h) => n + h.answers.reduce((m, a) => m + a.authors.length, 0), 0);
  slides.push({ kind: 'intro', title: 'מה לעזאזל קרה פה? 🎬', text: pick(INTRO, rng), stat: `${history.length} ציורים · ${totalAnswers} פרשנויות מומצאות` });

  // Story: the drawings with the richest interpretations (max 6), in the order they were played.
  const ranked = history.map((h, i) => ({ h, i, score: h.answers.length * 2 + h.answers.reduce((n, a) => n + a.voters.length, 0) }));
  const chosen = ranked.filter((x) => x.h.answers.length > 0).sort((a, b) => b.score - a.score).slice(0, 6).sort((a, b) => a.i - b.i);
  chosen.forEach(({ h }, k) => {
    const answers = [...h.answers].sort((a, b) => a.voters.length - b.voters.length).slice(-5); // most convincing last
    const lines = answers.map((a) => {
      const who = list(a.authors);
      const text = a.authors.length > 1 ? `${a.authors[0]} ${fill(TWINS, { who: list(a.authors.slice(1)) })} "${a.text}"` : fill(pick(LINE, rng), { who, text: a.text });
      return { text, fooled: a.voters.length === 1 ? pick(FOOLED_ONE, rng) : a.voters.length ? fill(pick(FOOLED, rng), { n: a.voters.length }) : null, voters: a.voters };
    });
    const topAns = [...h.answers].sort((a, b) => b.voters.length - a.voters.length)[0];
    const eligible = h.correct.length + h.answers.reduce((n, a) => n + a.voters.length, 0);
    const caption = h.correct.length === 0
      ? fill(pick(CAPTION_NOBODY, rng), { artist: h.artist })
      : h.correct.length === eligible
        ? fill(pick(CAPTION_ALL, rng), { artist: h.artist })
        : fill(pick(CAPTION_MIXED, rng), { correct: list(h.correct), topWho: list(topAns.authors), artist: h.artist });
    slides.push({ kind: 'drawing', step: k + 1, steps: chosen.length, image: h.image, artist: h.artist, prompt: h.prompt, lines, caption });
  });

  // Awards, all derived from interpretations and votes.
  const s = stats(history);
  const award = (emoji: string, title: string, winners: string[] | null, line: string, quote?: string) => {
    if (winners?.length) slides.push({ kind: 'award', emoji, title, winners: list(winners), line, quote });
  };
  const liar = top(s, 'fooled');
  const bestLie = history.flatMap((h) => h.answers.map((a) => ({ ...a, prompt: h.prompt }))).sort((a, b) => b.voters.length - a.voters.length)[0];
  award('🎭', 'השקרן/ית הכי משכנע/ת', liar?.names ?? null, `עבד/ה על ${plural(liar?.value ?? 0, 'אדם אחד', 'אנשים')} לאורך הערב. בבקשה לא להתמודד לראשות ועד העובדים.`,
    bestLie?.voters.length ? `"${bestLie.text}" (בעצם זה היה "${bestLie.prompt}")` : undefined);
  const naive = top(s, 'fell');
  award('🐣', 'התמים/ה של הערב', naive?.names ?? null, `האמין/ה ל${naive?.value === 1 ? '' : '-'}${plural(naive?.value ?? 0, 'פרשנות מומצאת אחת', 'פרשנויות מומצאות')}. לב טהור, עיניים פחות.`);
  const eagle = top(s, 'correct');
  award('🦅', 'עין הנשר', eagle?.names ?? null, `זיהה/תה את הביטוי האמיתי ${plural(eagle?.value ?? 0, 'פעם אחת', 'פעמים')}, למרות כל הניסיונות לבלבל.`);
  const picasso = top(s, 'artFooled');
  award('🎨', 'פיקאסו של הבלבול', picasso?.names ?? null, `הציורים שלו/ה גרמו ל${picasso?.value === 1 ? '' : '-'}${plural(picasso?.value ?? 0, 'ניחוש שגוי אחד', 'ניחושים שגויים')}. זו לא טעות, זה סגנון.`);
  const twins = history.flatMap((h) => h.answers.filter((a) => a.authors.length > 1).map((a) => ({ ...a })))[0];
  if (twins) award('👯', 'גדולים חושבים אותו דבר', twins.authors, `כתבו בנפרד, בדיוק את אותה תשובה: "${twins.text}"`);
  const near = history.flatMap((h) => h.answers.map((a) => ({ a, h, c: closeness(a.text, h.prompt) })))
    .filter((x) => x.c > 0 && x.c < 1).sort((x, y) => y.c - x.c)[0];
  if (near) award('🤏', 'פרס כמעט', near.a.authors, 'היה/תה במרחק נגיעה מהאמת, ובחר/ה לברוח ממנה.', `"${near.a.text}" מול "${near.h.prompt}"`);
  const novel = history.flatMap((h) => h.answers).sort((a, b) => b.text.length - a.text.length)[0];
  if (novel && novel.text.length >= 25) award('📜', 'פרס הרומן הקצר', novel.authors, `${[...novel.text].length} תווים על ציור של כמה קווים. כבוד.`, `"${novel.text}"`);
  return slides;
}

/** Seconds to show a slide: enough time to read every line and laugh. */
export const slideSeconds = (s: RecapSlide) => (s.kind === 'drawing' ? Math.min(20, 6 + s.lines.length * 2.2) : s.kind === 'award' ? 7 : 6);
