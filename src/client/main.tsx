import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import Landing from './Landing';
import Player from './Player';
import Host from './Host';
import ScreenView from './ScreenView';
import { useRoom } from './net';
import { useMemo } from 'react';
import { Brand, ConnBanner } from './ui';

function Screen({ code }: { code: string }) {
  const auth = useMemo(() => ({ code, role: 'screen' as const }), [code]);
  const { view: pub, error: err } = useRoom(auth);
  useEffect(() => {
    // Keep the projector awake when supported.
    (navigator as any).wakeLock?.request?.('screen').catch(() => {});
  }, []);
  if (!pub) return <div className="screen"><Brand /><p className="screen-sub">{err || 'מתחברים לחדר…'}</p></div>;
  return <><ConnBanner /><ScreenView pub={pub} /></>;
}

function App() {
  const [path, setPath] = useState(location.pathname);
  useEffect(() => { const h = () => setPath(location.pathname); addEventListener('popstate', h); return () => removeEventListener('popstate', h); }, []);
  const [, route, raw = ''] = path.split('/');
  const code = raw.toUpperCase();
  useEffect(() => { document.title = route === 'screen' ? `Blossom · ${code}` : 'Blossom · משחק ציורים וניחושים'; }, [route, code]);
  switch (route) {
    case 'play': return <Player key={code} code={code} />;
    case 'host': return <Host key={code} code={code} />;
    case 'screen': return <Screen key={code} code={code} />;
    case 'j': return <Landing key={code} code={code} />;
    default: return <Landing />;
  }
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
