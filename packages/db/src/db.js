import pg from 'pg';
import { readFileSync, existsSync } from 'node:fs';

// DATE (oid 1082) as a plain string. Parsed into a JS Date it lands at local
// midnight, and .toISOString() then shifts it a day — which would have printed
// a ban effective 2027-01-01 as 2026-12-31. Regulatory dates are facts we
// publish; they do not get to drift by a timezone.
pg.types.setTypeParser(1082, v => v);

export function databaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  if (existsSync('.env')) {
    const m = readFileSync('.env', 'utf8').match(/^DATABASE_URL=(.+)$/m);
    if (m) return m[1].trim();
  }
  return 'postgres://verso:verso@localhost:55432/verso';
}

// One-off client for scripts, seeders and migrations. These run transactions
// (`begin` / `commit`), which need a single dedicated connection — a pool would
// scatter the statements across different backends and silently break them.
export async function connect() {
  const client = new pg.Client({ connectionString: databaseUrl() });
  // Without this, a dropped connection emits an unhandled 'error' event and
  // takes the whole process down. Postgres restarting should not kill the API.
  client.on('error', err => console.error('pg client error:', err.message));
  await client.connect();
  return client;
}

let poolRef = null;

// Long-running services use the pool: it reconnects on its own, so a database
// restart or an idle timeout is survivable rather than fatal.
export function pool() {
  if (!poolRef) {
    poolRef = new pg.Pool({
      connectionString: databaseUrl(),
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });
    poolRef.on('error', err => console.error('pg pool error:', err.message));
  }
  return poolRef;
}
