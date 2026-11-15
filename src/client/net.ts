import { io, type Socket } from 'socket.io-client';
import { useEffect, useState } from 'react';
import type { ClientToServer, ServerToClient } from '../shared/types';

export const socket: Socket<ServerToClient, ClientToServer> = io({ transports: ['websocket', 'polling'], reconnectionDelayMax: 3000 });

/** Emit with ack; resolves on ok, rejects with the server's Hebrew error message. */
export function call<T = {}>(ev: keyof ClientToServer, args: object = {}): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('אין תגובה מהשרת. בודקים חיבור…')), 10000);
    (socket.emit as any)(ev, args, (r: any) => {
      clearTimeout(t);
      r?.ok ? resolve(r) : reject(new Error(r?.error ?? 'שגיאה לא צפויה'));
    });
  });
}

/** Run `attach` now and after every reconnect (server forgets socket membership). */
export function useAttach(attach: () => void, deps: unknown[]) {
  useEffect(() => {
    if (socket.connected) attach();
    socket.on('connect', attach);
    return () => { socket.off('connect', attach); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

export function useConnected() {
  const [c, setC] = useState(socket.connected);
  useEffect(() => {
    const on = () => setC(true), off = () => setC(false);
    socket.on('connect', on); socket.on('disconnect', off);
    return () => { socket.off('connect', on); socket.off('disconnect', off); };
  }, []);
  return c;
}

export function useEvent<K extends keyof ServerToClient>(ev: K): Parameters<ServerToClient[K]>[0] | null {
  const [v, setV] = useState<any>(null);
  useEffect(() => {
    const h = (x: any) => { if (x && typeof x === 'object' && 'serverNow' in (x.pub ?? x)) clock.sync((x.pub ?? x).serverNow); setV(x); };
    socket.on(ev, h as any);
    return () => { socket.off(ev, h as any); };
  }, [ev]);
  return v;
}

// Server-clock offset so timers agree across devices.
export const clock = {
  offset: 0,
  sync(serverNow: number) { this.offset = serverNow - Date.now(); },
  now() { return Date.now() + this.offset; },
};

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
