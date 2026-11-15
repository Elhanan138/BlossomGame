import { useCallback, useEffect, useRef, useState } from 'react';
import type { HostView, PlayerView, PublicState } from '../shared/types';

// HTTP transport for serverless hosting (Vercel). Clients poll ~1/s; the server
// applies timers on every request, so state stays consistent across devices.

export type Auth = { code: string; role: 'host' | 'player' | 'screen'; hostToken?: string; playerId?: string; token?: string };
type ViewOf<R extends Auth['role']> = R extends 'host' ? HostView : R extends 'player' ? PlayerView : PublicState;

let online = true;
const listeners = new Set<(v: boolean) => void>();
const setOnline = (v: boolean) => { if (v !== online) { online = v; listeners.forEach((l) => l(v)); } };

/** POST an action; resolves on ok, rejects with the server's Hebrew error message. */
export async function rpc<T = any>(action: string, args: object = {}, auth?: Auth): Promise<T> {
  let res: Response;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 10000);
    res = await fetch('/api/rpc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, args, auth }), signal: ctrl.signal });
    clearTimeout(t);
  } catch {
    setOnline(false);
    throw new Error('אין חיבור לשרת. בודקים שוב…');
  }
  setOnline(true);
  const r = await res.json().catch(() => ({ ok: false, error: 'תגובה לא תקינה מהשרת' }));
  if (!r.ok) throw new Error(r.error);
  if (r.view) { const pub = r.view.pub ?? r.view; if (pub?.serverNow) clock.sync(pub.serverNow); }
  return r;
}

/** Poll the room view for a role; `act` runs an action and applies the returned view immediately. */
export function useRoom<R extends Auth['role']>(auth: Auth & { role: R } | null, interval = 1000) {
  const [view, setView] = useState<ViewOf<R> | null>(null);
  const [error, setError] = useState('');
  const authRef = useRef(auth);
  authRef.current = auth;
  const gen = useRef(0); // bumps on every action so stale in-flight polls are dropped

  useEffect(() => {
    if (!auth) return;
    let alive = true, timer = 0;
    const tick = async () => {
      const g = gen.current;
      try { const r = await rpc('state', {}, authRef.current!); if (alive && g === gen.current) { setView(r.view); setError(''); } }
      catch (e) { if (alive) setError((e as Error).message); }
      if (alive) timer = window.setTimeout(tick, document.hidden ? interval * 3 : interval);
    };
    tick();
    const wake = () => { if (!document.hidden) { clearTimeout(timer); tick(); } };
    document.addEventListener('visibilitychange', wake);
    return () => { alive = false; clearTimeout(timer); document.removeEventListener('visibilitychange', wake); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth?.code, auth?.role, auth?.playerId]);

  const act = useCallback(async <T = any>(action: string, args: object = {}) => {
    const r = await rpc<T & { view: ViewOf<R> }>(action, args, authRef.current!);
    gen.current++;
    setView(r.view);
    return r;
  }, []);
  return { view, error, act };
}

export function useOnline() {
  const [v, setV] = useState(online);
  useEffect(() => { listeners.add(setV); return () => { listeners.delete(setV); }; }, []);
  return v;
}

// Server-clock offset so timers agree across devices.
export const clock = {
  offset: 0,
  sync(serverNow: number) { this.offset = serverNow - Date.now(); },
  now() { return Date.now() + this.offset; },
};

export const imgUrl = (ref: string | null | undefined) => (ref ? `/api/img?id=${encodeURIComponent(ref)}` : null);

export const store = {
  get<T>(k: string): T | null { try { return JSON.parse(localStorage.getItem(k) ?? 'null'); } catch { return null; } },
  set(k: string, v: unknown) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
  del(k: string) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};
export const keys = {
  player: (code: string) => `blossom:player:${code}`,
  host: (code: string) => `blossom:host:${code}`,
  draft: (code: string, round: number) => `blossom:draft:${code}:${round}`,
};

export function go(path: string) {
  history.pushState(null, '', path);
  dispatchEvent(new PopStateEvent('popstate'));
}
