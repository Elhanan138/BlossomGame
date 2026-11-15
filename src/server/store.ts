import { neon } from '@neondatabase/serverless';

/** Persistence for rooms (small JSON with optimistic versioning) and drawings (separate rows). */
export interface Store {
  get(code: string): Promise<{ state: string; version: number } | null>;
  create(code: string, state: string): Promise<boolean>;
  update(code: string, state: string, version: number): Promise<boolean>;
  putImage(id: string, room: string, data: string): Promise<void>;
  getImage(id: string): Promise<string | null>;
  countActive(sinceMs: number): Promise<number>;
  cleanup(olderThanMs: number): Promise<void>;
}

export const SCHEMA = [
  `create table if not exists rooms (code text primary key, version integer not null, state text not null, updated_at timestamptz not null default now())`,
  `create table if not exists images (id text primary key, room text not null, data text not null, updated_at timestamptz not null default now())`,
  `create index if not exists images_room_idx on images (room)`,
  `create index if not exists rooms_updated_idx on rooms (updated_at)`,
];

export function memoryStore(): Store {
  const rooms = new Map<string, { state: string; version: number; at: number }>();
  const images = new Map<string, { room: string; data: string }>();
  return {
    async get(code) { const r = rooms.get(code); return r ? { state: r.state, version: r.version } : null; },
    async create(code, state) { if (rooms.has(code)) return false; rooms.set(code, { state, version: 1, at: Date.now() }); return true; },
    async update(code, state, version) {
      const r = rooms.get(code);
      if (!r || r.version !== version) return false;
      rooms.set(code, { state, version: version + 1, at: Date.now() });
      return true;
    },
    async putImage(id, room, data) { images.set(id, { room, data }); },
    async getImage(id) { return images.get(id)?.data ?? null; },
    async countActive(since) { return [...rooms.values()].filter((r) => Date.now() - r.at < since).length; },
    async cleanup(older) {
      for (const [c, r] of rooms) if (Date.now() - r.at > older) { rooms.delete(c); for (const [i, im] of images) if (im.room === c) images.delete(i); }
    },
  };
}

export function neonStore(url: string): Store {
  const sql = neon(url);
  return {
    async get(code) {
      const rows = await sql`select state, version from rooms where code = ${code}`;
      return rows[0] ? { state: rows[0].state as string, version: rows[0].version as number } : null;
    },
    async create(code, state) {
      const rows = await sql`insert into rooms (code, version, state) values (${code}, 1, ${state}) on conflict do nothing returning code`;
      return rows.length === 1;
    },
    async update(code, state, version) {
      const rows = await sql`update rooms set state = ${state}, version = version + 1, updated_at = now() where code = ${code} and version = ${version} returning code`;
      return rows.length === 1;
    },
    async putImage(id, room, data) {
      await sql`insert into images (id, room, data) values (${id}, ${room}, ${data}) on conflict (id) do update set data = excluded.data, updated_at = now()`;
    },
    async getImage(id) {
      const rows = await sql`select data from images where id = ${id}`;
      return (rows[0]?.data as string) ?? null;
    },
    async countActive(since) {
      const rows = await sql`select count(*)::int as n from rooms where updated_at > now() - make_interval(secs => ${since / 1000})`;
      return rows[0].n as number;
    },
    async cleanup(older) {
      const secs = older / 1000;
      await sql`delete from images where room in (select code from rooms where updated_at < now() - make_interval(secs => ${secs}))`;
      await sql`delete from rooms where updated_at < now() - make_interval(secs => ${secs})`;
    },
  };
}

let cached: Store | null = null;
export function getStore(): Store {
  if (!cached) cached = process.env.DATABASE_URL ? neonStore(process.env.DATABASE_URL) : memoryStore();
  return cached;
}
