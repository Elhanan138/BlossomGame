import { useEffect, useRef, useState } from 'react';
import { go, keys, store, useRoom } from './net';
import { useMemo } from 'react';
import { Brand, ConnBanner, QR, Timer, joinUrl } from './ui';
import ScreenView from './ScreenView';
import type { GameSettings, HostView } from '../shared/types';

const PHASE_LABEL: Record<string, string> = {
  LOBBY: 'לובי', DRAWING: 'ציור', ANSWERING: 'המצאת תשובות', VOTING: 'הצבעה', REVEAL: 'חשיפה',
  ROUND_RESULTS: 'תוצאות סבב', DISCUSSION: 'שאלת שיחה', RECAP: 'סיכום מצחיק', FINAL: 'סיום',
};

export default function Host({ code }: { code: string }) {
  const hostToken = store.get<string>(keys.host(code));
  const auth = useMemo(() => (hostToken ? { code, role: 'host' as const, hostToken } : null), [code, hostToken]);
  const { view, error, act: run } = useRoom(auth);
  const [actErr, setErr] = useState('');
  const err = actErr || error;
  const act = (ev: string, a: object = {}) => { setErr(''); run(ev, a).catch((e) => setErr(e.message)); };

  if (!hostToken || (err && !view)) return (
    <main className="host"><Brand /><div className="card"><p className="mid">אין הרשאת מנחה לחדר הזה מהדפדפן הזה.</p><p className="muted">{err}</p><button className="btn" onClick={() => go('/')}>חזרה למסך הראשי</button></div></main>
  );
  if (!view) return <main className="host"><Brand /><p className="muted">מתחברים לחדר…</p></main>;
  const { pub } = view;

  return (
    <main className="host">
      <ConnBanner />
      <header className="host-head">
        <Brand />
        <div className="controls" style={{ alignItems: 'center' }}>
          <span className="tag">חדר <span className="ltr">{code}</span></span>
          <span className="tag wait">שלב: {PHASE_LABEL[pub.phase]}</span>
          <a className="btn ghost sm" href={`/screen/${code}`} target="_blank" rel="noopener">פתיחת מסך הקרנה ↗</a>
        </div>
      </header>
      {err && <div className="err" role="alert">{err}</div>}
      {pub.phase === 'LOBBY' ? <Lobby view={view} act={act} /> : <InGame view={view} act={act} />}
    </main>
  );
}

type Act = (ev: string, a?: object) => void;

function Lobby({ view, act }: { view: HostView; act: Act }) {
  const { pub } = view;
  const s = pub.settings;
  const set = (patch: Partial<GameSettings>) => act('host:settings', { settings: patch });
  const connected = pub.players.filter((p) => p.connected).length;
  const sel = (label: string, key: keyof GameSettings, opts: number[], unit = 'שנ׳') => (
    <label className="field">{label}
      <select className="select" value={s[key] as number} onChange={(e) => set({ [key]: Number(e.target.value) })}>
        {opts.map((o) => <option key={o} value={o}>{o} {unit}</option>)}
      </select>
    </label>
  );
  return (
    <div className="host-grid">
      <section className="card" aria-labelledby="set-h">
        <h2 id="set-h">הגדרות משחק</h2>
        <div className="settings">
          <div className="field full">מספר סבבים
            <div className="seg" role="group" aria-label="מספר סבבים">{[1, 2, 3].map((n) => <button key={n} type="button" aria-pressed={s.rounds === n} onClick={() => set({ rounds: n })}>{n}</button>)}</div>
          </div>
          {sel('זמן ציור', 'drawSeconds', [60, 75, 90, 120, 150])}
          {sel('זמן המצאת תשובה', 'answerSeconds', [30, 45, 60, 90])}
          {sel('זמן הצבעה', 'voteSeconds', [20, 30, 45, 60])}
          {sel('זמן חשיפה', 'revealSeconds', [6, 10, 15, 20])}
          <div className="field full">מצב משחק
            <div className="seg" role="group" aria-label="מצב משחק">
              <button type="button" aria-pressed={s.mode === 'regular'} onClick={() => set({ mode: 'regular' })}>רגיל</button>
              <button type="button" aria-pressed={s.mode === 'team'} onClick={() => set({ mode: 'team' })}>גיבוש (עם שאלות שיחה)</button>
            </div>
          </div>
          <label className="switch full"><input type="checkbox" checked={s.autoAdvance} onChange={(e) => set({ autoAdvance: e.target.checked })} />מעבר אוטומטי אחרי חשיפה ותוצאות</label>
        </div>
        <div className="estimate" style={{ marginTop: 14 }}><span>משך משוער ל-{Math.max(pub.players.length, 3)} משתתפים</span><b>~{view.estimateMinutes} דק׳</b></div>
      </section>

      <section className="card" aria-labelledby="pl-h" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
          <QR text={joinUrl(pub.code)} className="qr-sm" />
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <h2 id="pl-h" style={{ margin: 0 }}>משתתפים ({pub.players.length}/12)</h2>
            <p className="muted" style={{ margin: 0 }}>הציגו את מסך ההקרנה. המשתתפים סורקים את ה-QR או נכנסים לקישור:</p>
            <div className="linkbox"><code>{joinUrl(pub.code)}</code><CopyBtn text={joinUrl(pub.code)} /></div>
          </div>
        </div>
        <ul className="plist">
          {pub.players.length === 0 && <li className="muted">עוד אף אחד לא הצטרף…</li>}
          {pub.players.map((p) => (
            <li key={p.id}>
              <span className={`dot${p.connected ? '' : ' off'}`} aria-hidden="true" />
              <span className="name"><bdi>{p.name}</bdi></span>
              {!p.connected && <span className="tag off">מנותק/ת</span>}
              <button className="btn danger sm" onClick={() => act('host:kick', { playerId: p.id })} aria-label={`הסרת ${p.name}`}>הסרה</button>
            </li>
          ))}
        </ul>
        <button className="btn block" disabled={connected < 3} onClick={() => act('host:start')}>{connected < 3 ? `צריך עוד ${3 - connected} משתתפים` : `מתחילים! (${connected} משתתפים)`}</button>
      </section>
    </div>
  );
}

function CopyBtn({ text }: { text: string }) {
  const [ok, setOk] = useState(false);
  return <button className="btn ghost sm" onClick={() => navigator.clipboard?.writeText(text).then(() => { setOk(true); setTimeout(() => setOk(false), 1500); }).catch(() => {})}>{ok ? 'הועתק ✓' : 'העתקה'}</button>;
}

function Preview({ pub }: { pub: HostView['pub'] }) {
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.4);
  useEffect(() => {
    const ro = new ResizeObserver(([e]) => setScale(e.contentRect.width / 1600));
    if (box.current) ro.observe(box.current);
    return () => ro.disconnect();
  }, []);
  return <div className="preview" ref={box} aria-label="תצוגה מקדימה של מסך ההקרנה"><div className="screen-scale" style={{ transform: `scale(${scale})`, transformOrigin: 'top right', width: 1600, height: 900, position: 'absolute', top: 0, right: 0 }}><ScreenView pub={pub} /></div></div>;
}

function InGame({ view, act }: { view: HostView; act: Act }) {
  const { pub } = view;
  const [confirmEnd, setConfirmEnd] = useState(false);
  const pct = pub.expected ? Math.round((pub.submitted / pub.expected) * 100) : 0;
  const inDrawing = ['ANSWERING', 'VOTING', 'REVEAL'].includes(pub.phase);
  const waiting = pub.players.filter((p) => !p.done && p.connected && p.id !== pub.artistId && ['DRAWING', 'ANSWERING', 'VOTING'].includes(pub.phase));
  return (
    <div className="host-grid">
      <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <h2 style={{ margin: 0 }}>{PHASE_LABEL[pub.phase]}{pub.round ? ` · סבב ${pub.round}/${pub.settings.rounds}` : ''}</h2>
          <Timer pub={pub} />
        </div>
        {pub.recap && <p className="muted" style={{ margin: 0 }}>שקף {pub.recap.index + 1} מתוך {pub.recap.total}</p>}
        {inDrawing && <p className="muted" style={{ margin: 0 }}>ציור {pub.drawingIndex + 1} מתוך {pub.drawingCount} · של <bdi>{pub.artistName}</bdi></p>}
        {pub.expected > 0 && (
          <>
            <div className="progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${pct}%` }} /></div>
            <p className="muted" style={{ margin: 0 }}>סיימו {pub.submitted}/{pub.expected}{waiting.length ? ` · ממתינים ל: ${waiting.map((p) => p.name).join(', ')}` : ''}</p>
          </>
        )}
        {pub.phase === 'FINAL' ? (
          <div className="controls">
            <button className="btn" onClick={() => act('host:newGame')}>משחק חדש עם אותה חבורה</button>
          </div>
        ) : (
          <div className="controls">
            <button className="btn sm" onClick={() => act('host:pause', { paused: !pub.paused })}>{pub.paused ? '▶ המשך' : '⏸ השהיה'}</button>
            <button className="btn ghost sm" onClick={() => act('host:next')}>⏭ לשלב הבא</button>
            {(pub.deadline || pub.remainingMs) && <button className="btn ghost sm" onClick={() => act('host:addTime', { seconds: 15 })}>+15 שנ׳</button>}
            {inDrawing && <button className="btn ghost sm" onClick={() => act('host:skipDrawing')}>דילוג על הציור</button>}
            {pub.phase === 'RECAP' && <button className="btn ghost sm" onClick={() => act('host:prev')}>⏮ שקף קודם</button>}
            {pub.phase === 'RECAP' && <button className="btn warm sm" onClick={() => act('host:end')}>לפודיום 🏆</button>}
            {pub.phase === 'RECAP' ? null : confirmEnd
              ? <span className="confirm">לסיים עכשיו?<button className="btn danger sm" onClick={() => { setConfirmEnd(false); act('host:end'); }}>כן, לסיים</button><button className="btn ghost sm" onClick={() => setConfirmEnd(false)}>ביטול</button></span>
              : <button className="btn danger sm" onClick={() => setConfirmEnd(true)}>סיום משחק</button>}
          </div>
        )}
        <ul className="plist" aria-label="מצב המשתתפים">
          {[...pub.players].sort((a, b) => b.score - a.score).map((p) => (
            <li key={p.id}>
              <span className={`dot${p.connected ? '' : ' off'}`} aria-hidden="true" />
              <span className="name"><bdi>{p.name}</bdi></span>
              {!p.connected ? <span className="tag off">מנותק/ת</span> : p.id === pub.artistId ? <span className="tag wait">הצייר/ת</span> : p.done ? <span className="tag">סיים/ה ✓</span> : null}
              <span className="ltr" style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>{p.score.toLocaleString('he-IL')}</span>
            </li>
          ))}
        </ul>
      </section>
      <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <Preview pub={pub} />
        <p className="muted" style={{ margin: 0, fontSize: 14 }}>כך נראה מסך ההקרנה עכשיו. המשחק מתקדם לבד, הכפתורים כאן רק למקרה הצורך.</p>
      </section>
    </div>
  );
}
