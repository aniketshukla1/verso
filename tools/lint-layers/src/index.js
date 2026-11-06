// Enforces the ODbL boundary from docs/PLAN.md §04.
//
// The rule: Open Food Facts data (schema `product`) and proprietary data
// (`canon`, `evidence`, `verdict`) may be joined at query time in the
// application layer, but must never be bound together on disk. A foreign key
// or a view spanning the boundary is what turns a *collective* database into a
// *derivative* one, and share-alike attaches to derivatives.
//
// Runs statically (no database needed, for CI) and, if a database is
// reachable, against the live catalog too.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import { databaseUrl } from '../../../packages/db/src/db.js';

const OPEN = 'product';
const PROPRIETARY = ['canon', 'evidence', 'verdict'];
const ALL = [OPEN, ...PROPRIETARY];

const violations = [];
const fail = (rule, detail) => violations.push({ rule, detail });

// ---------- static: migration source ----------
const migDir = 'packages/db/migrations';
const files = readdirSync(migDir).filter(f => f.endsWith('.sql')).sort();

for (const f of files) {
  const sql = readFileSync(join(migDir, f), 'utf8')
    .split('\n')
    .filter(l => !l.trim().startsWith('--'))
    .join('\n');

  // which schema does this file create things in?
  const owns = ALL.filter(s => new RegExp(`create schema if not exists ${s}\\b`).test(sql));

  for (const m of sql.matchAll(/references\s+(\w+)\.(\w+)/gi)) {
    const target = m[1].toLowerCase();
    if (!ALL.includes(target)) continue;
    const crossesBoundary = owns.some(o => (o === OPEN) !== (target === OPEN));
    if (crossesBoundary) {
      fail('FK across ODbL boundary',
        `${f}: schema ${owns.join('/')} has "references ${m[1]}.${m[2]}"`);
    }
  }
}

// citations are mandatory: every citation_id column must be NOT NULL, in every
// migration — evidence tables added after 003 are held to the same rule
for (const f of files) {
  const sql = readFileSync(join(migDir, f), 'utf8');
  for (const m of sql.matchAll(/citation_id\s+bigint\s+(not null\s+)?references/gi)) {
    if (!m[1]) fail('Uncited evidence permitted', `citation_id is nullable in ${f}`);
  }
}

// ---------- live: catalog ----------
let checkedLive = false;
const client = new pg.Client({ connectionString: databaseUrl(), connectionTimeoutMillis: 2500 });
try {
  await client.connect();
  checkedLive = true;

  const fks = await client.query(`
    select cn.conname,
           sn.nspname as src_schema, sc.relname as src_table,
           tn.nspname as tgt_schema, tc.relname as tgt_table
    from pg_constraint cn
    join pg_class     sc on sc.oid = cn.conrelid
    join pg_namespace sn on sn.oid = sc.relnamespace
    join pg_class     tc on tc.oid = cn.confrelid
    join pg_namespace tn on tn.oid = tc.relnamespace
    where cn.contype = 'f'
      and sn.nspname = any($1) and tn.nspname = any($1)
      and (sn.nspname = $2) <> (tn.nspname = $2)`, [ALL, OPEN]);

  for (const r of fks.rows) {
    fail('FK across ODbL boundary',
      `${r.src_schema}.${r.src_table} -> ${r.tgt_schema}.${r.tgt_table} (${r.conname})`);
  }

  const views = await client.query(`
    select distinct vn.nspname as view_schema, v.relname as view_name,
                    rn.nspname as ref_schema
    from pg_depend d
    join pg_rewrite   r  on r.oid = d.objid
    join pg_class     v  on v.oid = r.ev_class
    join pg_namespace vn on vn.oid = v.relnamespace
    join pg_class     rt on rt.oid = d.refobjid
    join pg_namespace rn on rn.oid = rt.relnamespace
    where d.classid = 'pg_rewrite'::regclass
      and d.refclassid = 'pg_class'::regclass
      and v.relkind in ('v','m')
      and rn.nspname = any($1)
      and rt.oid <> v.oid`, [ALL]);

  const byView = new Map();
  for (const r of views.rows) {
    const k = `${r.view_schema}.${r.view_name}`;
    if (!byView.has(k)) byView.set(k, new Set());
    byView.get(k).add(r.ref_schema);
  }
  for (const [view, refs] of byView) {
    if (refs.has(OPEN) && PROPRIETARY.some(s => refs.has(s))) {
      fail('View spans ODbL boundary', `${view} reads ${[...refs].sort().join(' + ')}`);
    }
  }

  await client.end();
} catch {
  await client.end().catch(() => {});
}

// ---------- report ----------
const scope = checkedLive ? 'migration source + live catalog' : 'migration source only (no database reachable)';
if (violations.length === 0) {
  console.log(`layer separation OK — checked ${scope}`);
  console.log(`  open: ${OPEN}   proprietary: ${PROPRIETARY.join(', ')}`);
  process.exit(0);
}
console.error(`layer separation FAILED — ${violations.length} violation(s), checked ${scope}\n`);
for (const v of violations) console.error(`  [${v.rule}]\n    ${v.detail}`);
console.error('\nSee docs/PLAN.md §04. Join across the boundary in the application layer instead.');
process.exit(1);
