// Local / container server: same handlers as the Vercel functions, plus static client.
import express from 'express';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { dataUrlToBuffer, image, rpc } from './api';
import { getStore } from './store';

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));
app.post('/api/rpc', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json(await rpc(getStore(), req.body, req.ip));
});
app.get('/api/img', async (req, res) => {
  const data = await image(getStore(), String(req.query.id ?? ''));
  const img = data && dataUrlToBuffer(data);
  if (!img) return res.status(404).end();
  res.type(img.type).setHeader('Cache-Control', 'private, max-age=86400, immutable');
  res.send(img.buf);
});
app.get('/api/healthz', (_req, res) => res.json({ ok: true, db: !!process.env.DATABASE_URL }));
const dist = path.resolve('dist/client');
if (existsSync(dist)) {
  app.use(express.static(dist, { index: false }));
  app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}
const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => console.log(`Blossom on :${port} (${process.env.DATABASE_URL ? 'Neon' : 'in-memory'} store)`));
