// Mirror the official lists (EU additives, FDA Substances Added to Food, IARC,
// Prop 65) into evidence.source_record and log what changed since last time.
//
//   pnpm sources:sync              download each list, then apply it
//   pnpm sources:sync --offline    re-apply the latest local copies (no network)
//   pnpm sources:sync --only=iarc  one source
//   pnpm sources:sync --offline --reparse   re-apply after a parser fix; logs no changes
import { connect } from '../../../packages/db/src/db.js';
import { syncSources } from '../../../packages/evidence/src/sync.js';

const args = process.argv.slice(2);
const offline = args.includes('--offline');
const only = args.find(a => a.startsWith('--only='))?.slice('--only='.length) ?? null;
const reparse = args.includes('--reparse');

const client = await connect();
const results = await syncSources(client, { offline, only, reparse });
await client.end();

for (const r of results) {
  const what = r.error ? `FAILED  ${r.error}`
    : r.unchanged ? `unchanged since last check  (${r.records} records)`
    : r.baseline ? `baseline  ${r.records} records`
    : `${r.records} records  +${r.added} added  ~${r.changed} changed  -${r.removed} removed`;
  console.log(`${r.key.padEnd(15)} ${what}${r.published ? `  · ${r.published}` : ''}  (${(r.ms / 1000).toFixed(1)} s)`);
}
if (results.some(r => r.error)) process.exitCode = 1;
