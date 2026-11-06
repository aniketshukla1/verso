import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect } from './db.js';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
const client = await connect();

await client.query(`
  create table if not exists public.schema_migration (
    filename    text primary key,
    applied_at  timestamptz not null default now()
  )`);

const { rows } = await client.query('select filename from public.schema_migration');
const done = new Set(rows.map(r => r.filename));
const files = readdirSync(dir).filter(f => f.endsWith('.sql')).sort();

let applied = 0;
for (const f of files) {
  if (done.has(f)) { console.log(`  skip  ${f}`); continue; }
  const sql = readFileSync(join(dir, f), 'utf8');
  try {
    await client.query('begin');
    await client.query(sql);
    await client.query('insert into public.schema_migration (filename) values ($1)', [f]);
    await client.query('commit');
    console.log(`  apply ${f}`);
    applied++;
  } catch (err) {
    await client.query('rollback');
    console.error(`\nFAILED ${f}\n  ${err.message}`);
    await client.end();
    process.exit(1);
  }
}
console.log(applied ? `\n${applied} migration(s) applied` : '\nup to date');
await client.end();
