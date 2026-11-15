import type { PublicState } from '../shared/types';
import { Brand, Drawing, QR, Timer, joinUrl, pts } from './ui';

const PHASE_HINT: Record<string, string> = {
  DRAWING: 'כולם מציירים בטלפון את הביטוי הסודי שלהם',
  ANSWERING: 'כתבו בטלפון מה לדעתכם צויר כאן',
  VOTING: 'בחרו בטלפון: איזו תשובה היא האמיתית?',
};

/** Projector-safe view: renders only PublicState (never secrets before reveal). */
export default function ScreenView({ pub }: { pub: PublicState }) {
  const progress = pub.drawingCount ? <span>ציור {pub.drawingIndex + 1} מתוך {pub.drawingCount} · סבב {pub.round}/{pub.settings.rounds}</span> : null;
  const timed = ['DRAWING', 'ANSWERING', 'VOTING', 'REVEAL', 'ROUND_RESULTS', 'DISCUSSION'].includes(pub.phase);
  return (
    <div className="screen">
      <header className="screen-head">
        <Brand />
        {pub.paused && <span className="paused-badge">⏸ הפסקה</span>}
        {timed && <Timer pub={pub} />}
      </header>
      <Body pub={pub} progress={progress} />
    </div>
  );
}

function Body({ pub, progress }: { pub: PublicState; progress: React.ReactNode }) {
  switch (pub.phase) {
    case 'LOBBY':
      return (
        <>
          <div className="join-panel">
            <QR text={joinUrl(pub.code)} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
              <h1 className="screen-title">סורקים ומצטרפים!</h1>
              <p className="screen-sub">או נכנסים לכתובת והקוד:</p>
              <span className="join-url">{location.host}</span>
              <span className="room-code">{pub.code}</span>
            </div>
          </div>
          <div className="status-line"><span>הצטרפו {pub.players.length} · אפשר 3–12 משתתפים</span></div>
          <div className="chips">{pub.players.map((p) => <span key={p.id} className="chip done"><bdi>{p.name}</bdi></span>)}</div>
        </>
      );
    case 'DRAWING':
      return (
        <>
          <h1 className="screen-title">✏️ זמן ציור!</h1>
          <p className="screen-sub">{PHASE_HINT.DRAWING}. כאן לא צריך לדעת לצייר. עדיף אפילו שלא.</p>
          <div className="center"><div className="chips">{pub.players.map((p) => <span key={p.id} className={`chip${p.done ? ' done' : ''}${p.connected ? '' : ' off'}`}>{p.done ? '✓ ' : ''}<bdi>{p.name}</bdi></span>)}</div></div>
          <div className="status-line"><span>הגישו {pub.submitted}/{pub.expected}</span><span>סבב {pub.round}/{pub.settings.rounds}</span></div>
        </>
      );
    case 'ANSWERING':
      return (
        <>
          <div className="screen-body">
            <Drawing src={pub.drawing} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16, justifyContent: 'center', flex: 1 }}>
              <h1 className="screen-title">מה לעזאזל ניסו לצייר כאן? 🤔</h1>
              <p className="screen-sub">{PHASE_HINT.ANSWERING}. רק הדמיון יודע.</p>
              <p className="screen-sub">שלחו {pub.submitted}/{pub.expected}</p>
            </div>
          </div>
          <div className="status-line">{progress}</div>
        </>
      );
    case 'VOTING':
      return (
        <>
          <h1 className="screen-title">אחת נכונה. השאר מנסות לעבוד עליכם.</h1>
          <div className="screen-body">
            <div style={{ height: '100%', maxWidth: '38%' }}><Drawing src={pub.drawing} /></div>
            <div className="answers">{pub.options!.map((o, i) => <div key={o.id} className="answer"><span className="num ltr">{i + 1}</span><span dir="auto">{o.text}</span></div>)}</div>
          </div>
          <div className="status-line"><span>הצביעו {pub.submitted}/{pub.expected}</span>{progress}</div>
        </>
      );
    case 'REVEAL': {
      const r = pub.reveal!;
      const voted = r.options.reduce((s, o) => s + o.voters.length, 0);
      const fooled = r.options.filter((o) => !o.isTruth).reduce((s, o) => s + o.voters.length, 0);
      return (
        <>
          <p className="screen-sub">והתשובה האמיתית היא…</p>
          <p className="reveal-truth" dir="auto">{r.prompt}</p>
          <div className="screen-body">
            <div style={{ height: '100%', maxWidth: '30%' }}><Drawing src={pub.drawing} /></div>
            <div className="answers">
              {r.options.map((o) => (
                <div key={o.id} className={`answer${o.isTruth ? ' truth' : ''}`}>
                  <span dir="auto">{o.isTruth ? '✓ ' : ''}{o.text}</span>
                  <span className="meta">
                    {o.isTruth ? `צייר/ה: ${pub.artistName ?? ''}` : o.house ? 'תשובת בית 🏠' : `נכתב ע״י ${o.authors.join(', ')}`}<br />
                    {o.voters.length ? `${o.isTruth ? 'צדקו' : 'נפלו'}: ${o.voters.join(', ')}` : 'אף אחד'}
                  </span>
                </div>
              ))}
            </div>
          </div>
          <div className="status-line"><span>{voted ? `${fooled} מתוך ${voted} נפלו בפח` : 'אף אחד לא הצביע'}</span>{progress}</div>
        </>
      );
    }
    case 'ROUND_RESULTS':
      return (
        <>
          <h1 className="screen-title">טבלת המובילים · סוף סבב {pub.round}</h1>
          <div className="board">
            {pub.leaderboard!.map((l, i) => {
              const mv = l.prevRank == null ? 0 : l.prevRank - l.rank;
              return (
                <div key={l.playerId} className="board-row" style={{ animationDelay: `${i * 0.06}s` }}>
                  <span className="ltr">{l.rank}</span><bdi>{l.name}</bdi>
                  <span className={`move ${mv > 0 ? 'up' : mv < 0 ? 'down' : ''}`}>{mv > 0 ? `▲${mv}` : mv < 0 ? `▼${-mv}` : ''}{l.gained ? <span className="gain"> +{pts(l.gained)}</span> : null}</span>
                  <span className="pts">{pts(l.score)}</span>
                </div>
              );
            })}
          </div>
          <p className="screen-sub" style={{ textAlign: 'center' }}>{funny(pub)}</p>
        </>
      );
    case 'DISCUSSION':
      return <><p className="screen-sub" style={{ textAlign: 'center' }}>רגע של שיחה 💬 אין חובה לשתף</p><p className="question">{pub.question}</p></>;
    case 'FINAL': {
      const lb = pub.leaderboard!;
      const top = [lb[1], lb[0], lb[2]];
      const h = pub.highlights;
      return (
        <>
          <h1 className="screen-title" style={{ textAlign: 'center' }}>והמנצחים הם… 🎉</h1>
          <div className="screen-body">
            <div className="podium">
              {top.map((l, i) => l && <div key={l.playerId} className={['p2', 'p1', 'p3'][i]}><span className="medal">{['🥈', '🥇', '🥉'][i]}</span><bdi>{l.name}</bdi><span className="ltr" style={{ fontSize: '.7em' }}>{pts(l.score)}</span></div>)}
            </div>
            {h && (h.mostFooling || h.bestLie) && (
              <div className="highlights">
                {h.mostFooling && <div className="hl"><span>הציור הכי מבלבל ({h.mostFooling.wrong} טעו)</span><img src={h.mostFooling.drawing} alt={h.mostFooling.prompt} /><strong dir="auto">{h.mostFooling.prompt}</strong><span>מאת <bdi>{h.mostFooling.artist}</bdi></span></div>}
                {h.bestLie && <div className="hl"><span>התשובה הכי מטעה ({h.bestLie.fooled} נפלו)</span><strong dir="auto">"{h.bestLie.text}"</strong><span>מאת <bdi>{h.bestLie.authors.join(', ')}</bdi></span></div>}
              </div>
            )}
          </div>
          <p className="screen-sub" style={{ textAlign: 'center' }}>לא בטוח שלמדנו לצייר, אבל בהחלט למדנו משהו על הדמיון שלכם.</p>
        </>
      );
    }
  }
}

function funny(pub: PublicState) {
  const lead = pub.leaderboard?.[0];
  if (!lead || !lead.score) return 'כולם עדיין מתחממים 🔥';
  const lines = [
    `לא ברור אם ${lead.name} גאון/ית או פשוט יודע/ת לבלבל אנשים.`,
    `${lead.name} בראש. מישהו פה מסתיר כישרון.`,
    `${lead.name} מוביל/ה. נראה מי יעז לעקוף.`,
  ];
  return lines[pub.round % lines.length];
}
