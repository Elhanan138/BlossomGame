import { useEffect, useRef, useState, type PointerEvent as RPE } from 'react';

// Fixed internal resolution: survives resize/rotation, stays crisp on high-DPR phones.
const SIZE = 800;
type Tool = 'brush' | 'marker' | 'eraser' | 'fill' | 'line' | 'circle' | 'rect';
const COLORS = ['#14251B', '#FFFFFF', '#8A9A90', '#E5484D', '#FF7A45', '#F5B400', '#00AA5B', '#0E7C66', '#2F7DE1', '#7B5CD6', '#E86FB0', '#8B5A2B'];
const COLOR_NAMES = ['שחור', 'לבן', 'אפור', 'אדום', 'כתום', 'צהוב', 'ירוק', 'ירוק כהה', 'כחול', 'סגול', 'ורוד', 'חום'];
const SIZES = [4, 10, 20, 36];
const SIZE_NAMES = ['דק', 'בינוני', 'עבה', 'עבה מאוד'];
const ic = (d: string) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>;
const TOOLS: { id: Tool; label: string; icon: JSX.Element }[] = [
  { id: 'brush', label: 'מכחול', icon: ic('M4 20c2 0 4-1 4-3a2 2 0 0 0-4 0c0 1-1 2-2 2M8 15 19 4a1.4 1.4 0 0 1 2 2L10 17') },
  { id: 'marker', label: 'טוש שקוף', icon: ic('M4 20h6M14 4l6 6-9 9H5v-6z') },
  { id: 'eraser', label: 'מחק', icon: ic('M7 21h10M5 14l8-8 6 6-7 7H8zM9 10l6 6') },
  { id: 'fill', label: 'דלי מילוי', icon: ic('M4 11 11 4l7 7-7 7zM18 11c1 2 2 3 2 4a2 2 0 0 1-4 0c0-1 1-2 2-4M4 11h14') },
  { id: 'line', label: 'קו ישר', icon: ic('M5 19 19 5') },
  { id: 'circle', label: 'עיגול', icon: ic('M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z') },
  { id: 'rect', label: 'מלבן', icon: ic('M4 5h16v14H4z') },
];

function hexToRgb(h: string) { const n = parseInt(h.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; }

function floodFill(ctx: CanvasRenderingContext2D, sx: number, sy: number, hex: string) {
  const img = ctx.getImageData(0, 0, SIZE, SIZE);
  const d = img.data;
  const [r, g, b] = hexToRgb(hex);
  const i0 = (sy * SIZE + sx) * 4;
  const t = [d[i0], d[i0 + 1], d[i0 + 2]];
  if (Math.abs(t[0] - r) + Math.abs(t[1] - g) + Math.abs(t[2] - b) < 8) return;
  const match = (i: number) => Math.abs(d[i] - t[0]) + Math.abs(d[i + 1] - t[1]) + Math.abs(d[i + 2] - t[2]) < 90;
  const seen = new Uint8Array(SIZE * SIZE);
  const stack = [sx, sy];
  while (stack.length) {
    const y = stack.pop()!, x0 = stack.pop()!;
    let x = x0;
    while (x >= 0 && !seen[y * SIZE + x] && match((y * SIZE + x) * 4)) x--;
    x++;
    let up = false, down = false;
    for (; x < SIZE && !seen[y * SIZE + x] && match((y * SIZE + x) * 4); x++) {
      const p = y * SIZE + x, i = p * 4;
      seen[p] = 1; d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255;
      if (y > 0) { const m = !seen[p - SIZE] && match(i - SIZE * 4); if (m && !up) stack.push(x, y - 1); up = m; }
      if (y < SIZE - 1) { const m = !seen[p + SIZE] && match(i + SIZE * 4); if (m && !down) stack.push(x, y + 1); down = m; }
    }
  }
  // Slight dilation pass would blur edges; anti-aliased edges are acceptable for a party game.
  ctx.putImageData(img, 0, 0);
}

export function exportImage(c: HTMLCanvasElement) {
  let q = 0.82, url = c.toDataURL('image/jpeg', q);
  while (url.length > 550_000 && q > 0.3) { q -= 0.15; url = c.toDataURL('image/jpeg', q); }
  return url;
}

export default function DrawCanvas({ initial, onChange }: { initial: string | null; onChange: (url: string) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [tool, setTool] = useState<Tool>('brush');
  const [color, setColor] = useState(COLORS[0]);
  const [size, setSize] = useState(1);
  const [confirmClear, setConfirmClear] = useState(false);
  const [, rerender] = useState(0);
  const st = useRef({ undo: [] as ImageData[], redo: [] as ImageData[], pointer: -1, start: { x: 0, y: 0 }, last: { x: 0, y: 0 }, snap: null as ImageData | null, pts: [] as { x: number; y: number }[] });
  const ctx = () => ref.current!.getContext('2d', { willReadFrequently: true })!;

  useEffect(() => {
    const c = ctx();
    c.fillStyle = '#fff'; c.fillRect(0, 0, SIZE, SIZE);
    if (initial) { const im = new Image(); im.onload = () => { c.drawImage(im, 0, 0, SIZE, SIZE); onChange(exportImage(ref.current!)); }; im.src = initial; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const commit = () => { rerender((x) => x + 1); onChange(exportImage(ref.current!)); };
  const pushUndo = () => { const s = st.current; s.undo.push(ctx().getImageData(0, 0, SIZE, SIZE)); if (s.undo.length > 25) s.undo.shift(); s.redo = []; };
  const pos = (e: { clientX: number; clientY: number }) => {
    const r = ref.current!.getBoundingClientRect();
    return { x: Math.min(SIZE - 1, Math.max(0, ((e.clientX - r.left) / r.width) * SIZE)), y: Math.min(SIZE - 1, Math.max(0, ((e.clientY - r.top) / r.height) * SIZE)) };
  };
  const style = (c: CanvasRenderingContext2D) => {
    c.lineCap = 'round'; c.lineJoin = 'round'; c.globalAlpha = 1;
    c.strokeStyle = tool === 'eraser' ? '#fff' : color;
    c.lineWidth = SIZES[size] * (tool === 'eraser' ? 1.8 : tool === 'marker' ? 2.2 : 1);
    if (tool === 'marker') c.globalAlpha = 0.45;
  };
  const shape = (c: CanvasRenderingContext2D, p: { x: number; y: number }) => {
    const s = st.current;
    c.putImageData(s.snap!, 0, 0);
    style(c);
    c.beginPath();
    if (tool === 'marker') { s.pts.forEach((q, i) => (i ? c.lineTo(q.x, q.y) : c.moveTo(q.x, q.y))); }
    else if (tool === 'line') { c.moveTo(s.start.x, s.start.y); c.lineTo(p.x, p.y); }
    else if (tool === 'circle') { c.ellipse((s.start.x + p.x) / 2, (s.start.y + p.y) / 2, Math.abs(p.x - s.start.x) / 2 + 0.5, Math.abs(p.y - s.start.y) / 2 + 0.5, 0, 0, Math.PI * 2); }
    else if (tool === 'rect') { c.rect(s.start.x, s.start.y, p.x - s.start.x, p.y - s.start.y); }
    c.stroke();
    c.globalAlpha = 1;
  };

  const down = (e: RPE<HTMLCanvasElement>) => {
    const s = st.current;
    if (s.pointer !== -1 || (e.pointerType === 'mouse' && e.button !== 0)) return;
    e.preventDefault();
    setConfirmClear(false);
    const p = pos(e), c = ctx();
    pushUndo();
    if (tool === 'fill') { floodFill(c, Math.floor(p.x), Math.floor(p.y), color); commit(); return; }
    ref.current!.setPointerCapture(e.pointerId);
    s.pointer = e.pointerId; s.start = p; s.last = p; s.pts = [p];
    if (tool === 'brush' || tool === 'eraser') { style(c); c.beginPath(); c.moveTo(p.x, p.y); c.lineTo(p.x + 0.01, p.y); c.stroke(); }
    else s.snap = c.getImageData(0, 0, SIZE, SIZE);
  };
  const move = (e: RPE<HTMLCanvasElement>) => {
    const s = st.current;
    if (e.pointerId !== s.pointer) return;
    const c = ctx();
    const evs = (e.nativeEvent as PointerEvent).getCoalescedEvents?.() ?? [e.nativeEvent];
    if (tool === 'brush' || tool === 'eraser') {
      style(c); c.beginPath(); c.moveTo(s.last.x, s.last.y);
      for (const ev of evs.length ? evs : [e.nativeEvent]) { const p = pos(ev); c.lineTo(p.x, p.y); s.last = p; }
      c.stroke();
    } else {
      const p = pos(e);
      if (tool === 'marker') s.pts.push(...(evs.length ? evs : [e.nativeEvent]).map(pos));
      shape(c, p);
    }
  };
  const up = (e: RPE<HTMLCanvasElement>) => {
    const s = st.current;
    if (e.pointerId !== s.pointer) return;
    s.pointer = -1; s.snap = null; s.pts = [];
    commit();
  };
  const undo = () => { const s = st.current, u = s.undo.pop(); if (!u) return; s.redo.push(ctx().getImageData(0, 0, SIZE, SIZE)); ctx().putImageData(u, 0, 0); commit(); };
  const redo = () => { const s = st.current, r = s.redo.pop(); if (!r) return; s.undo.push(ctx().getImageData(0, 0, SIZE, SIZE)); ctx().putImageData(r, 0, 0); commit(); };
  const clear = () => {
    if (!confirmClear) { setConfirmClear(true); return; }
    pushUndo(); const c = ctx(); c.fillStyle = '#fff'; c.fillRect(0, 0, SIZE, SIZE); setConfirmClear(false); commit();
  };

  return (
    <div className="draw">
      <div className="canvas-wrap">
        <canvas ref={ref} width={SIZE} height={SIZE} aria-label="אזור ציור. ציירו עם האצבע או העכבר" role="img"
          onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onContextMenu={(e) => e.preventDefault()} />
      </div>
      <div className="toolbar" role="toolbar" aria-label="כלי ציור">
        {TOOLS.map((t) => <button key={t.id} type="button" className="tool" aria-pressed={tool === t.id} aria-label={t.label} title={t.label} onClick={() => setTool(t.id)}>{t.icon}</button>)}
      </div>
      <div className="row2">
        <div className="sizes" role="group" aria-label="עובי קו">
          {SIZES.map((s, i) => <button key={s} type="button" className="size" aria-pressed={size === i} aria-label={SIZE_NAMES[i]} onClick={() => setSize(i)}><i style={{ width: 4 + i * 5, height: 4 + i * 5 }} /></button>)}
        </div>
        <div className="history">
          <button type="button" className="tool size" onClick={undo} disabled={!st.current.undo.length} aria-label="ביטול פעולה">{ic('M9 14 4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3')}</button>
          <button type="button" className="tool size" onClick={redo} disabled={!st.current.redo.length} aria-label="ביצוע מחדש">{ic('m15 14 5-5-5-5M20 9H9a5 5 0 0 0 0 10h3')}</button>
          <button type="button" className="tool size" onClick={clear} aria-label={confirmClear ? 'לחצו שוב לאישור ניקוי' : 'ניקוי הציור'} style={confirmClear ? { background: 'var(--danger)', color: '#fff' } : undefined}>{confirmClear ? '?' : ic('M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13')}</button>
        </div>
      </div>
      <div className="palette" role="group" aria-label="צבעים">
        {COLORS.map((c, i) => <button key={c} type="button" className="swatch" style={{ background: c }} aria-pressed={color === c} aria-label={COLOR_NAMES[i]} onClick={() => { setColor(c); if (tool === 'eraser') setTool('brush'); }} />)}
      </div>
    </div>
  );
}
