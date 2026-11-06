import pg from 'pg';
import { databaseUrl } from './db.js';

const deadline = Date.now() + 60_000;
for (;;) {
  const c = new pg.Client({ connectionString: databaseUrl() });
  try {
    await c.connect();
    await c.end();
    console.log('database ready');
    process.exit(0);
  } catch (err) {
    await c.end().catch(() => {});
    if (Date.now() > deadline) {
      console.error('database did not become ready:', err.message);
      process.exit(1);
    }
    await new Promise(r => setTimeout(r, 1000));
  }
}
