import { createContext, useContext, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { go, imgUrl, keys, store, useRoom } from './net';
import { Brand, ConnBanner, Drawing, Timer, pts } from './ui';
import DrawCanvas, { exportImage } from './DrawCanvas';
import type { PlayerView } from '../shared/types';

type Act = (action: string, args?: object) => Promise<any>;
const ActCtx = createContext<Act>(async () => {});
const useAct = () => useContext(ActCtx);

export default function Player({ code }: { code: string }) {
  const creds = useMemo(() => store.get<{ playerId: string; token: string }>(keys.player(code)), [code]);
  const auth = useMemo(() => (creds ? { code, role: 'player' as const, ...creds } : null), [code, creds]);
  const { view: live, error, act } = useRoom(auth);
  const [fatal, setFatal] = useState('');
  useEffect(() => { if (!creds) go(`/j/${code}`); }, [creds, code]);
  useEffect(() => {
    // Auth failures mean the player was removed or the room is gone; network errors only show the banner.
    if (/לזהות|לא מצאנו חדר/.test(error)) { store.del(keys.player(code)); setFatal(error.includes('לזהות') ? 'כבר לא נמצאים בחדר הזה (אולי המנחה הסיר אותך).' : error); }
  }, [error, code]);
  const view = live;

  if (fatal) return (
    <main className="phone"><div className="center"><p className="big">אופס</p><p className="muted">{fatal}</p><button className="btn" onClick={() => go(`/j/${code}`)}>הצטרפות מחדש</button></div></main>
  );
  if (!view) return <main className="phone"><div className="center" aria-busy="true"><img src="/logo.png" alt="" width={64} /><p className="muted">מתחברים…</p></div></main>;

  const { pub, me } = view;
  return (
    <main className="phone">
      <ConnBanner />
      <header className="topbar">
        <Brand />
        <Timer pub={['DRAWING', 'ANSWERING', 'VOTING'].includes(pub.phase) ? pub : null} />
        <span className="me-chip"><bdi>{me.name}</bdi></span>
      </header>
      <div className="stage" aria-live="polite">
        <ActCtx.Provider value={act}><Phase view={view} code={code} /></ActCtx.Provider>
      </div>
      {pub.paused && <div className="paused-overlay" role="status">⏸<br />המשחק בהפסקה קצרה</div>}
    </main>
  );
}

function Waiting({ title, sub, pub }: { title: string; sub?: string; pub: PlayerView['pub'] }) {
  const pending = pub.players.filter((p) => !p.done && p.connected && p.id !== pub.artistId);
  return (
    <div className="center">
      <p className="big">{title}</p>
      {sub && <p className="muted">{sub}</p>}
      {pub.expected > 0 && <p className="muted">ממתינים ל-{pub.expected - pub.submitted}: {pending.map((p) => p.name).join(', ')}</p>}
    </div>
  );
}

function Phase({ view, code }: { view: PlayerView; code: string }) {
  const { pub, me } = view;
  switch (pub.phase) {
    case 'LOBBY':
      return (
        <div className="center">
          <img src="/logo.png" alt="" width={72} height={72} />
          <p className="big">מעולה, נכנסת! 🎉</p>
          <p className="muted">מחכים לשאר החבורה · {pub.players.length} בחדר</p>
          <div className="chips">{pub.players.map((p) => <span key={p.id} className={`chip${p.id === me.playerId ? ' done' : ''}`}><bdi>{p.name}</bdi></span>)}</div>
          <p className="muted" style={{ fontSize: 14 }}>טיפ: כאן לא צריך לדעת לצייר. עדיף אפילו שלא.</p>
        </div>
      );
    case 'DRAWING':
      return me.submittedDrawing ? <Waiting pub={pub} title="יצירת מופת. כנראה. ✓" sub="הציור נשמר. מחכים לאמנים האחרים." /> : <DrawPhase view={view} code={code} />;
    case 'ANSWERING':
      if (me.isArtist) return <ArtistWait pub={pub} text="זה הציור שלך! עכשיו כולם ממציאים מה זה 😏" />;
      return me.canAct ? <AnswerPhase key={pub.drawingIndex} view={view} /> : <Waiting pub={pub} title="התשובה נשלחה ✓" sub={`"${me.myAnswer}"`} />;
    case 'VOTING':
      if (me.isArtist) return <ArtistWait pub={pub} text="רגע האמת: האם יזהו את הציור שלך?" />;
      return me.myVote ? <Waiting pub={pub} title="ההצבעה ננעלה 🗳️" sub="מחכים לשאר המצביעים" /> : <VotePhase key={pub.drawingIndex} view={view} />;
    case 'REVEAL': {
      const r = pub.reveal!;
      const gain = r.gains[me.playerId] ?? 0;
      const myVote = r.options.find((o) => o.voters.includes(me.name));
      const fooled = r.options.filter((o) => o.authors.includes(me.name)).reduce((s, o) => s + o.voters.length, 0);
      return (
        <div className="center">
          <p className="muted">והתשובה האמיתית היא…</p>
          <p className="big" dir="auto">{r.prompt}</p>
          <div className="score-pop">+{pts(gain)}</div>
          <p className="mid">
            {me.isArtist ? (gain ? 'בונוס אמן: רוב המצביעים התבלבלו!' : 'הציור שלך היה ברור מדי 😅')
              : myVote?.isTruth ? 'ניחשת נכון! 🎯' : myVote ? 'נפלת בפח 🙈' : 'לא הספקת להצביע'}
          </p>
          {fooled > 0 && <p className="muted">{fooled} נפלו בתשובה שלך</p>}
        </div>
      );
    }
    case 'ROUND_RESULTS':
    case 'FINAL': {
      const lb = pub.leaderboard ?? [];
      const mine = lb.find((l) => l.playerId === me.playerId);
      const medal = ['🥇', '🥈', '🥉'][mine ? mine.rank - 1 : 9] ?? '';
      return (
        <div className="center" style={{ justifyContent: 'flex-start' }}>
          <p className="muted">{pub.phase === 'FINAL' ? 'המשחק נגמר!' : `סוף סבב ${pub.round}`}</p>
          <p className="big">המקום שלך: {mine?.rank ?? '-'} {medal}</p>
          <div className="rank-list">
            {lb.map((l) => <div key={l.playerId} className={`rank-row${l.playerId === me.playerId ? ' me' : ''}`}><span className="n">{l.rank}</span><span className="name"><bdi>{l.name}</bdi></span><span className="pts">{pts(l.score)}</span></div>)}
          </div>
          {pub.phase === 'FINAL' && <p className="muted">לא בטוח שלמדנו לצייר, אבל בהחלט למדנו משהו על הדמיון שלכם.</p>}
        </div>
      );
    }
    case 'RECAP': {
      const r = pub.recap!;
      const mine = r.slide.kind === 'award' && r.slide.winners.split(/, | ו/).includes(me.name);
      return (
        <div className="center">
          <p className="big">🍿 מסתכלים על המסך הגדול</p>
          <p className="muted">שחזור מצחיק של כל מה שהמצאתם · {r.index + 1}/{r.total}</p>
          {mine && r.slide.kind === 'award' && <p className="mid">{r.slide.emoji} זכית ב"{r.slide.title}"!</p>}
        </div>
      );
    }
    case 'DISCUSSION':
      return <div className="center"><p className="muted">רגע של שיחה 💬</p><p className="big">{pub.question}</p><p className="muted">מסתכלים על המסך הגדול ומדברים. אין חובה לשתף.</p></div>;
  }
}

function ArtistWait({ pub, text }: { pub: PlayerView['pub']; text: string }) {
  return <div className="center"><Drawing src={pub.drawing} small /><p className="mid">{text}</p><p className="muted">{pub.submitted}/{pub.expected} כבר סיימו</p></div>;
}

function DrawPhase({ view, code }: { view: PlayerView; code: string }) {
  const call = useAct();
  const { pub, me } = view;
  const dkey = keys.draft(code, pub.round);
  const latest = useRef<string | null>(store.get<string>(dkey));
  const [saved, setSaved] = useState(!!latest.current);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const timer = useRef<number>();
  const send = () => { if (latest.current) call('player:draft', { image: latest.current }).then(() => setSaved(true)).catch(() => {}); };
  const onChange = (url: string) => {
    latest.current = url; setSaved(false);
    store.set(dkey, url);
    clearTimeout(timer.current);
    timer.current = window.setTimeout(send, 600);
  };
  useEffect(() => () => clearTimeout(timer.current), []);
  const submit = async () => {
    setBusy(true); setErr('');
    const blank = document.createElement('canvas'); blank.width = blank.height = 8;
    const ctx = blank.getContext('2d')!; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 8, 8);
    try { await call('player:submitDrawing', { image: latest.current ?? exportImage(blank) }); store.del(dkey); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <>
      <div className="prompt-card"><small>הביטוי שלך (סודי!)</small><strong dir="auto">{me.prompt}</strong></div>
      <DrawCanvas initial={latest.current ?? imgUrl(me.draft)} onChange={onChange} />
      {err && <div className="err" role="alert">{err}</div>}
      <div className="sticky-actions">
        <button className="btn block" onClick={submit} disabled={busy}>סיימתי לצייר</button>
        <span className="saved" aria-live="polite">{saved ? '✓ הציור נשמר אוטומטית' : 'שומרים…'}</span>
      </div>
    </>
  );
}

function AnswerPhase({ view }: { view: PlayerView }) {
  const call = useAct();
  const { pub } = view;
  const [text, setText] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr(''); setBusy(true);
    try { await call('player:answer', { text }); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <p className="muted" style={{ margin: 0 }}>ציור {pub.drawingIndex + 1} מתוך {pub.drawingCount}</p>
      <Drawing src={pub.drawing} small />
      <label className="field" htmlFor="ans"><span className="mid">מה לעזאזל ניסו לצייר כאן? 🤔</span></label>
      <span className="muted" style={{ fontSize: 14 }}>כתבו משהו שייראה כמו הביטוי האמיתי ויעבוד על כולם.</span>
      <input id="ans" className="input" dir="auto" value={text} onChange={(e) => setText(e.target.value)} maxLength={100} placeholder="למשל: חתול בראיון עבודה" autoComplete="off" enterKeyHint="send" required />
      <span className="counter ltr">{[...text].length}/100</span>
      {err && <div className="err" role="alert">{err}</div>}
      <button className="btn block" disabled={busy || !text.trim()}>שליחה</button>
    </form>
  );
}

function VotePhase({ view }: { view: PlayerView }) {
  const call = useAct();
  const { pub, me } = view;
  const [sel, setSel] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const vote = async () => {
    if (!sel) return;
    setErr(''); setBusy(true);
    try { await call('player:vote', { optionId: sel }); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <>
      <p className="mid">מה התשובה האמיתית?</p>
      <p className="muted" style={{ margin: 0 }}>אחת התשובות נכונה. השאר מנסות לעבוד עליכם.</p>
      <div className="options" role="group" aria-label="אפשרויות הצבעה">
        {pub.options!.map((o, i) => {
          const mine = me.myOptionIds.includes(o.id);
          return <button key={o.id} type="button" className="option" dir="auto" aria-pressed={sel === o.id} disabled={mine} onClick={() => setSel(o.id)}>
            <span className="ltr" style={{ color: 'var(--muted)' }}>{i + 1}.</span> {o.text}{mine ? ' · (שלך)' : ''}
          </button>;
        })}
      </div>
      {err && <div className="err" role="alert">{err}</div>}
      <button className="btn block" disabled={!sel || busy} onClick={vote}>נעילת הצבעה</button>
    </>
  );
}
