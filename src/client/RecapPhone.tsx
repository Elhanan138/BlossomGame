import { useState } from 'react';
import type { RecapSlide } from '../shared/types';
import { Drawing } from './ui';

/** Self-paced comedy recap on the phone, opened from the final leaderboard. */
export default function RecapPhone({ slides, onClose }: { slides: RecapSlide[]; onClose: () => void }) {
  const [i, setI] = useState(0);
  const s = slides[i];
  return (
    <section className="recap-phone" aria-label="הסיכום המצחיק">
      <div className="recap-phone-head">
        <span className="muted">{i + 1}/{slides.length}</span>
        <button type="button" className="btn ghost sm" onClick={onClose}>חזרה לטבלה</button>
      </div>
      <div className="recap-phone-card" key={i} aria-live="polite">
        {s.kind === 'intro' && (
          <>
            <p className="big">{s.title}</p>
            <p className="muted">{s.text}</p>
            <p className="mid" style={{ color: 'var(--g-ink)' }}>{s.stat}</p>
          </>
        )}
        {s.kind === 'drawing' && (
          <>
            <p className="muted" style={{ margin: 0 }}>ציור {s.step} מתוך {s.steps} · מאת <bdi>{s.artist}</bdi></p>
            <Drawing src={s.image} small />
            <p className="muted" style={{ margin: 0 }}>מה שבאמת היה צריך להיות פה:</p>
            <p className="mid" dir="auto" style={{ color: 'var(--g-ink)' }}>{s.prompt}</p>
            <ol className="recap-phone-lines">
              {s.lines.map((l, k) => (
                <li key={k}><span dir="auto">{l.text}</span>{l.fooled && <small>{l.fooled}: {l.voters.join(', ')}</small>}</li>
              ))}
            </ol>
            <p className="recap-phone-caption">{s.caption}</p>
          </>
        )}
        {s.kind === 'award' && (
          <>
            <span className="recap-phone-emoji" aria-hidden="true">{s.emoji}</span>
            <p className="muted" style={{ margin: 0 }}>הפרס הוא…</p>
            <p className="big">{s.title}</p>
            <p className="recap-phone-winner" dir="rtl">{s.winners}</p>
            <p className="muted">{s.line}</p>
            {s.quote && <p className="recap-phone-quote" dir="auto">{s.quote}</p>}
          </>
        )}
      </div>
      <div className="recap-phone-nav">
        <button type="button" className="btn ghost" onClick={() => setI(i - 1)} disabled={i === 0}>→ הקודם</button>
        {i < slides.length - 1
          ? <button type="button" className="btn" onClick={() => setI(i + 1)}>הבא ←</button>
          : <button type="button" className="btn warm" onClick={onClose}>סיימתי 🏆</button>}
      </div>
    </section>
  );
}
