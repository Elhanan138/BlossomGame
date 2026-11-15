import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { clock, useConnected } from './net';
import type { PublicState } from '../shared/types';

export const Brand = ({ name = 'Blossom' }: { name?: string }) => (
  <div className="brandmark"><img src="/logo.png" alt="" width={40} height={40} /><span className="ltr">{name}</span></div>
);

export function useRemaining(pub: PublicState | null) {
  const [, tick] = useState(0);
  useEffect(() => { const i = setInterval(() => tick((x) => x + 1), 250); return () => clearInterval(i); }, []);
  if (!pub) return null;
  if (pub.paused) return pub.remainingMs;
  if (pub.deadline == null) return null;
  return Math.max(0, pub.deadline - clock.now());
}

export function Timer({ pub }: { pub: PublicState | null }) {
  const ms = useRemaining(pub);
  if (ms == null) return null;
  const s = Math.ceil(ms / 1000);
  const label = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  return (
    <span className={`timer${s <= 10 && !pub?.paused ? ' low' : ''}`} role="timer" aria-label={`נותרו ${s} שניות`}>
      {pub?.paused ? '⏸ ' : ''}{label}
    </span>
  );
}

export function QR({ text, className = 'qr' }: { text: string; className?: string }) {
  const [src, setSrc] = useState('');
  useEffect(() => { QRCode.toDataURL(text, { margin: 0, width: 512, color: { dark: '#14251B' } }).then(setSrc).catch(() => setSrc('')); }, [text]);
  return <div className={className}>{src && <img src={src} alt={`קוד QR להצטרפות: ${text}`} />}</div>;
}

export function ConnBanner() {
  const ok = useConnected();
  const [show, setShow] = useState(false);
  useEffect(() => { if (ok) { setShow(false); return; } const t = setTimeout(() => setShow(true), 1500); return () => clearTimeout(t); }, [ok]);
  return show ? <div className="conn-banner" role="status">החיבור נפל, מתחברים מחדש…</div> : null;
}

export function Drawing({ src, small }: { src: string | null; small?: boolean }) {
  return src
    ? <img className={`drawing-img${small ? ' small' : ''}`} src={src} alt="הציור שעל הפרק" />
    : <div className="blank-drawing">הקנבס נשאר ריק. אמנות מינימליסטית במיטבה 🖼️</div>;
}

export const joinUrl = (code: string) => `${location.origin}/j/${code}`;
export const pts = (n: number) => n.toLocaleString('he-IL');
