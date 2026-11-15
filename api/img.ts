import { dataUrlToBuffer, image } from '../src/server/api';
import { getStore } from '../src/server/store';

// Serves drawings by id. Ids are unguessable (random player id) and versioned (~v) for caching.
export default async function handler(req: any, res: any) {
  const data = await image(getStore(), String(req.query?.id ?? ''));
  const img = data && dataUrlToBuffer(data);
  if (!img) { res.status(404).end(); return; }
  res.setHeader('Content-Type', img.type);
  res.setHeader('Cache-Control', 'private, max-age=86400, immutable');
  res.status(200).send(img.buf);
}
