import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { normalise } from '../../shared/src/normalise.js';
import { SOURCES } from './sources/index.js';

// Mirrors the whole-list sources into evidence.source_record, once a day.
//
// Every download is kept as a dated file and hashed. Byte-identical to the last
// one: nothing to do but note that the source was checked. Otherwise the file is
// parsed, compared record by record with the mirror, and every addition,
// change and removal is written to evidence.source_change, which is the content
// lead's feed of what the regulators actually did.

const DIR = 'data/sources';   // relative to the repo root, where the API and tools run
const UA = 'Verso-source-sync/0.1 (ingredient regulatory research)';

// A list that shrinks this much between two downloads is a changed format or a
// truncated file far more often than a mass delisting. Applying it would mark
// hundreds of real listings as removed, so the sync refuses and the last good
// mirror stays in place. (The same rule as the app's saved verdicts: a failed
// refresh never replaces good data.)
const MAX_SHRINK = 0.2;

const sha256 = data => createHash('sha256').update(data).digest('hex');

// Dedupe keys, normalise names for matching, and hash what a user could see.
export function prepare(records) {
  const seen = new Map();
  return records.map(r => {
    const n = (seen.get(r.record_key) ?? 0) + 1;
    seen.set(r.record_key, n);
    const names = [...new Set((r.names ?? [r.name]).filter(Boolean))];
    const rec = {
      record_key: n > 1 ? `${r.record_key}#${n}` : r.record_key,
      name: r.name,
      names_normalised: [...new Set(names.map(normalise).filter(Boolean))],
      cas: [...new Set(r.cas ?? [])],
      e_number: r.e_number ?? null,
      url: r.url ?? null,
      payload: r.payload,
    };
    rec.hash = sha256(JSON.stringify([rec.name, rec.names_normalised, rec.cas, rec.e_number, rec.url, rec.payload]));
    return rec;
  });
}

// existing: Map(record_key -> hash) of records currently listed.
export function planChanges(existing, incoming) {
  const added = [], changed = [], same = [];
  const present = new Set();
  for (const r of incoming) {
    present.add(r.record_key);
    const h = existing.get(r.record_key);
    if (h === undefined) added.push(r);
    else if (h !== r.hash) changed.push(r);
    else same.push(r);
  }
  const removed = [...existing.keys()].filter(k => !present.has(k));
  const refuse = incoming.length === 0 || (existing.size > 0 && incoming.length < existing.size * (1 - MAX_SHRINK));
  return { added, changed, same, removed, refuse };
}

async function download(src) {
  const res = await fetch(src.url, {
    headers: { 'user-agent': UA },
    redirect: 'follow',
    signal: AbortSignal.timeout(180_000),
  });
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

function latestLocal(src, root) {
  const dir = join(root, src.key);
  let files = [];
  try { files = readdirSync(dir).filter(f => f.endsWith(`.${src.ext}`) && !f.includes('.refused.')).sort(); } catch {}
  if (!files.length) throw new Error(`no local copy in ${dir}; run without --offline first`);
  return join(dir, files.at(-1));
}

async function syncOne(client, src, { offline, dir, reparse }) {
  // A download is written to disk only once it has been accepted, so a broken
  // one can never overwrite the day's good copy. A refused one is kept beside
  // it as <date>.refused.<ext>, for whoever has to work out what went wrong.
  let buf, file, keep = () => {}, keepRefused = () => {};
  if (offline) {
    file = latestLocal(src, dir);
    buf = readFileSync(file);
  } else {
    buf = await download(src);
    const stem = join(dir, src.key, new Date().toISOString().slice(0, 10));
    const save = path => { mkdirSync(join(dir, src.key), { recursive: true }); writeFileSync(path, buf); };
    file = `${stem}.${src.ext}`;
    keep = () => save(file);
    keepRefused = () => save(`${stem}.refused.${src.ext}`);
  }
  const digest = sha256(buf);

  const { rows: [prev] } = await client.query(
    `select id, sha256, published, record_count from evidence.source_snapshot
     where source_key = $1 order by id desc limit 1`, [src.key]);

  // Same bytes as last time: the source has not changed. --reparse re-applies
  // it anyway after a parser fix, but logs nothing, because any difference is
  // ours and not the regulator's.
  const sameBytes = prev && prev.sha256 === digest;
  if (sameBytes && !reparse) {
    await client.query('begin');
    try {
      const { rows: [snap] } = await client.query(
        `insert into evidence.source_snapshot
           (source_key, url, sha256, bytes, file_path, published, record_count, unchanged)
         values ($1,$2,$3,$4,$5,$6,$7,true) returning id`,
        [src.key, src.url, digest, buf.length, file, prev.published, prev.record_count]);
      await client.query(
        `update evidence.source_record set last_seen = $2
         where source_key = $1 and removed_in is null`, [src.key, snap.id]);
      await client.query('commit');
    } catch (err) { await client.query('rollback'); throw err; }
    keep();
    return { key: src.key, unchanged: true, records: prev.record_count, published: prev.published, file };
  }

  let parsed;
  try {
    parsed = src.parse(buf);
  } catch (err) {
    keepRefused();
    throw new Error(`refused: the file no longer parses (${err.message}); the last good copy stays.`);
  }
  const incoming = prepare(parsed.records);
  const { rows: current } = await client.query(
    `select record_key, hash, name, payload from evidence.source_record
     where source_key = $1 and removed_in is null`, [src.key]);
  const plan = planChanges(new Map(current.map(r => [r.record_key, r.hash])), incoming);
  if (plan.refuse) {
    keepRefused();
    throw new Error(`refused: ${incoming.length} records now against ${current.length} listed. `
      + 'A changed format or a truncated download is likelier than a mass delisting; the last good copy stays.');
  }

  await client.query('begin');
  try {
    const { rows: [snap] } = await client.query(
      `insert into evidence.source_snapshot
         (source_key, url, sha256, bytes, file_path, published, record_count, added, changed, removed)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
      [src.key, src.url, digest, buf.length, file, parsed.published ?? null, incoming.length,
       plan.added.length, plan.changed.length, plan.removed.length]);

    for (const r of [...plan.added, ...plan.changed]) {
      await client.query(
        `insert into evidence.source_record
           (source_key, record_key, name, names_normalised, cas, e_number, url, payload, hash, first_seen, last_seen)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10)
         on conflict (source_key, record_key) do update set
           name = excluded.name, names_normalised = excluded.names_normalised, cas = excluded.cas,
           e_number = excluded.e_number, url = excluded.url, payload = excluded.payload,
           hash = excluded.hash, last_seen = excluded.last_seen, removed_in = null`,
        [src.key, r.record_key, r.name, r.names_normalised, r.cas, r.e_number, r.url, r.payload, r.hash, snap.id]);
    }
    if (plan.same.length) {
      await client.query(
        `update evidence.source_record set last_seen = $3
         where source_key = $1 and record_key = any($2)`, [src.key, plan.same.map(r => r.record_key), snap.id]);
    }
    if (plan.removed.length) {
      await client.query(
        `update evidence.source_record set removed_in = $3
         where source_key = $1 and record_key = any($2)`, [src.key, plan.removed, snap.id]);
    }

    // The first download is the baseline, not thousands of "added" events.
    if (prev && !sameBytes) {
      const before = new Map(current.map(r => [r.record_key, { name: r.name, payload: r.payload }]));
      const log = (key, change, b, a) => client.query(
        `insert into evidence.source_change (snapshot_id, source_key, record_key, change, before, after)
         values ($1,$2,$3,$4,$5,$6)`, [snap.id, src.key, key, change, b ?? null, a ?? null]);
      for (const r of plan.added) await log(r.record_key, 'added', null, { name: r.name, payload: r.payload });
      for (const r of plan.changed) await log(r.record_key, 'changed', before.get(r.record_key), { name: r.name, payload: r.payload });
      for (const k of plan.removed) await log(k, 'removed', before.get(k), null);
    }
    await client.query('commit');
  } catch (err) { await client.query('rollback'); throw err; }
  keep();

  return {
    key: src.key, records: incoming.length, published: parsed.published ?? null, file,
    added: plan.added.length, changed: plan.changed.length, removed: plan.removed.length, baseline: !prev,
  };
}

// `sources` and `dir` exist for tests; production uses the registry and data/sources.
export async function syncSources(client, { offline = false, only = null, reparse = false, sources = SOURCES, dir = DIR } = {}) {
  const results = [];
  for (const src of sources.filter(s => !only || s.key === only)) {
    const t0 = Date.now();
    try {
      results.push({ ...(await syncOne(client, src, { offline, dir, reparse })), ms: Date.now() - t0 });
    } catch (err) {
      results.push({ key: src.key, error: err.message, ms: Date.now() - t0 });
    }
  }
  return results;
}

// Once a day, from inside the API process. A restart looks at the age of the
// last snapshot first, so restarting the server all day re-downloads nothing.
export function scheduleDailySync(pool, log) {
  const DAY = 24 * 3600_000;
  const run = async () => {
    const client = await pool.connect();
    try {
      for (const r of await syncSources(client)) {
        if (r.error) log.error({ sourceSync: r }, 'source sync failed');
        else log.info({ sourceSync: r }, 'source sync');
      }
    } catch (err) {
      log.error({ err }, 'source sync failed');
    } finally {
      client.release();
    }
  };
  pool.query('select max(retrieved_at) as last from evidence.source_snapshot')
    .then(({ rows: [r] }) => {
      const age = r?.last ? Date.now() - new Date(r.last).getTime() : Infinity;
      setTimeout(() => { run(); setInterval(run, DAY).unref(); }, Math.max(30_000, DAY - age)).unref();
    })
    .catch(err => log.error({ err }, 'source sync not scheduled'));
}
