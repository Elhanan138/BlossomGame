import { getStore } from '../src/server/store';

// Health check, including a real database round-trip.
export default async function handler(_req: any, res: any) {
  try {
    const rooms = await getStore().countActive(24 * 3600_000);
    res.status(200).json({ ok: true, db: process.env.DATABASE_URL ? 'neon' : 'memory', activeRooms: rooms });
  } catch (e) {
    res.status(500).json({ ok: false, error: (e as Error).message });
  }
}
