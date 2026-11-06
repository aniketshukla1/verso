import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connect } from '../../db/src/db.js';
import { syncSources } from '../src/sync.js';

// A throwaway source run twice through the real sync, against the real tables:
// the second run must log exactly what changed, and a truncated file must be
// refused without touching the mirror.
const KEY = 'test-sync-fixture';
const client = await connect();
const dir = mkdtempSync(join(tmpdir(), 'verso-sync-'));
const fixture = {
  key: KEY, ext: 'json', url: 'file://fixture',
  parse: buf => ({
    published: 'fixture',
    records: JSON.parse(buf).map(r => ({ record_key: r.id, name: r.name, names: [r.name], cas: r.cas ?? [], payload: { group: r.group } })),
  }),
};
const write = (day, rows) => {
  mkdirSync(join(dir, KEY), { recursive: true });
  writeFileSync(join(dir, KEY, `${day}.json`), JSON.stringify(rows));
};
const run = () => syncSources(client, { offline: true, sources: [fixture], dir }).then(([r]) => r);
const cleanup = async () => {
  await client.query('delete from evidence.source_change where source_key = $1', [KEY]);
  await client.query('delete from evidence.source_record where source_key = $1', [KEY]);
  await client.query('delete from evidence.source_snapshot where source_key = $1', [KEY]);
};

test.before(cleanup);
test.after(async () => { await cleanup(); await client.end(); rmSync(dir, { recursive: true, force: true }); });

test('a changed list is applied and every difference is logged', async () => {
  const base = Array.from({ length: 10 }, (_, i) => ({ id: `r${i}`, name: `Agent ${i}`, group: '3' }));
  write('2026-01-01', base);
  const first = await run();
  assert.equal(first.baseline, true);
  assert.equal(first.records, 10);

  // one reclassified, one delisted, one new
  const next = base.filter(r => r.id !== 'r9').map(r => (r.id === 'r1' ? { ...r, group: '2B' } : r));
  write('2026-01-02', [...next, { id: 'r10', name: 'Agent 10', group: '1' }]);
  const second = await run();
  assert.deepEqual([second.added, second.changed, second.removed], [1, 1, 1]);

  const { rows } = await client.query(
    `select record_key, change, before->'payload'->>'group' as was, after->'payload'->>'group' as now
     from evidence.source_change where source_key = $1 order by record_key`, [KEY]);
  assert.deepEqual(rows, [
    { record_key: 'r1', change: 'changed', was: '3', now: '2B' },
    { record_key: 'r10', change: 'added', was: null, now: '1' },
    { record_key: 'r9', change: 'removed', was: '3', now: null },
  ]);
  const { rows: [gone] } = await client.query(
    'select removed_in is not null as removed from evidence.source_record where source_key = $1 and record_key = $2', [KEY, 'r9']);
  assert.equal(gone.removed, true, 'a delisted record is kept, marked removed');
});

test('a truncated download is refused and the mirror is untouched', async () => {
  write('2026-01-03', [{ id: 'r0', name: 'Agent 0', group: '3' }]);
  const r = await run();
  assert.match(r.error, /refused/);
  const { rows: [n] } = await client.query(
    'select count(*)::int as listed from evidence.source_record where source_key = $1 and removed_in is null', [KEY]);
  assert.equal(n.listed, 10, 'still the last good list');
});
