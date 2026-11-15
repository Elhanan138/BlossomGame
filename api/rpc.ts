import { rpc } from '../src/server/api';
import { getStore } from '../src/server/store';

// Vercel Serverless Function: all game actions and state polling.
export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') { res.status(405).json({ ok: false, error: 'POST only' }); return; }
  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body ?? {};
  const ip = String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() || 'unknown';
  const result = await rpc(getStore(), body, ip);
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json(result);
}
