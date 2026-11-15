import { useState, type FormEvent } from 'react';
import { call, go, keys, store } from './net';
import { Brand } from './ui';

const Doodle = ({ d, style }: { d: string; style: React.CSSProperties }) => (
  <div className="doodle" style={style} aria-hidden="true">
    <svg width="96" height="80" viewBox="0 0 96 80" fill="none" stroke="#14251B" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>
  </div>
);

export default function Landing({ code: initialCode = '' }: { code?: string }) {
  const [name, setName] = useState('');
  const [code, setCode] = useState(initialCode.toUpperCase());
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const saved = code.length === 6 ? store.get<{ playerId: string }>(keys.player(code)) : null;

  const join = async (e: FormEvent) => {
    e.preventDefault();
    setErr(''); setBusy(true);
    try {
      const c = code.trim().toUpperCase();
      const r = await call<{ playerId: string; token: string }>('player:join', { code: c, name });
      store.set(keys.player(c), { playerId: r.playerId, token: r.token });
      go(`/play/${c}`);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const host = async () => {
    setErr(''); setBusy(true);
    try {
      const r = await call<{ code: string; hostToken: string }>('host:create', {});
      store.set(keys.host(r.code), r.hostToken);
      go(`/host/${r.code}`);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <main className="landing">
      <div className="landing-inner">
        <section className="hero">
          <Brand />
          <h1>מציירים גרוע.<br />צוחקים <em>בגדול.</em></h1>
          <p>משחק הציורים והניחושים של Blossom. כל אחד מצייר ביטוי מטורף, כולם ממציאים מה זה, ומנסים לעבוד אחד על השני.</p>
          <ul className="steps" aria-label="איך משחקים">
            <li>✏️ מציירים</li><li>🤔 ממציאים</li><li>🗳️ מצביעים</li><li>🏆 צוחקים</li>
          </ul>
          <div className="doodles">
            <Doodle d="M30 50c0-14 8-26 18-26s18 12 18 26-8 22-18 22-18-8-18-22zM42 40h1M54 40h1M42 56c4 4 8 4 12 0" style={{ insetInlineStart: 0, top: 10, ['--rot' as string]: '-4deg', transform: 'rotate(-4deg)' }} />
            <Doodle d="M12 64 48 12l36 52zM40 44h16M48 30v28" style={{ insetInlineStart: 140, top: 40, animationDelay: '1s', ['--rot' as string]: '5deg', transform: 'rotate(5deg)' }} />
            <Doodle d="M20 60c10-30 46-30 56 0M30 50l-6 14M66 50l6 14M40 30a8 8 0 1 0 16 0 8 8 0 1 0-16 0" style={{ insetInlineStart: 280, top: 0, animationDelay: '2s' }} />
          </div>
        </section>

        <form className="card join-card" onSubmit={join} aria-labelledby="join-title">
          <h2 id="join-title">{initialCode ? 'הוזמנת למשחק! 🎉' : 'מצטרפים למשחק'}</h2>
          <p className="muted" style={{ margin: 0 }}>בלי הרשמה ובלי אפליקציה. רק שם וקוד.</p>
          <label className="field">איך לקרוא לך?
            <input className="input" dir="auto" value={name} onChange={(e) => setName(e.target.value)} maxLength={20} placeholder="שם או כינוי" autoComplete="nickname" autoFocus={!!initialCode} required />
          </label>
          <label className="field">קוד החדר
            <input className="input code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} maxLength={6} placeholder="ABC123" inputMode="text" autoCapitalize="characters" autoComplete="off" required />
          </label>
          {err && <div className="err" role="alert">{err}</div>}
          <button className="btn block" disabled={busy || !name.trim() || code.length !== 6}>יאללה, מצטרפים!</button>
          {saved && <button type="button" className="btn ghost block" onClick={() => go(`/play/${code}`)}>חזרה למשחק שלי</button>}
          <div className="divider">מנחים את המשחק?</div>
          <button type="button" className="btn warm block" onClick={host} disabled={busy}>פתיחת משחק חדש</button>
        </form>
      </div>
    </main>
  );
}
