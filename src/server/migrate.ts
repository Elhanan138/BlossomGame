import { neon } from '@neondatabase/serverless';
import { SCHEMA } from './store';

const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL is required'); process.exit(1); }
const sql = neon(url);
(async () => {
  for (const q of SCHEMA) await sql.query(q);
  console.log('Schema ready');
})();
