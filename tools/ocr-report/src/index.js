// Summarise real-world OCR quality from the API log.
//
// Usage: node tools/ocr-report/src/index.js [/tmp/verso-api.log]
//
// The number that matters is the resolve rate: what fraction of the declaration
// items ML Kit produced could be matched to a canonical ingredient. A low rate
// is ambiguous on its own — it could be bad OCR or a thin canon — so the
// unresolved terms are listed too. Garbled strings mean OCR; clean names we do
// not know mean the canon needs expanding.
import { readFileSync } from 'node:fs';

const file = process.argv[2] ?? '/tmp/verso-api.log';
const scans = [];
for (const line of readFileSync(file, 'utf8').split('\n')) {
  if (!line.startsWith('{')) continue;
  try {
    const d = JSON.parse(line);
    if (d.scan) scans.push(d.scan);
  } catch { /* not our line */ }
}

if (!scans.length) {
  console.log('No scans logged yet. Scan a label with the app, then re-run.');
  process.exit(0);
}

const rate = scans.reduce((a, s) => a + s.resolveRate, 0) / scans.length;
console.log(`\nSCANS: ${scans.length}   mean resolve rate: ${(rate * 100).toFixed(0)}%\n`);

for (const [i, s] of scans.entries()) {
  console.log(`${String(i + 1).padStart(2)}. ${s.market}  ${String(s.chars).padStart(4)} chars  ` +
              `${s.matched} matched / ${s.unresolvedCount} unresolved  (${(s.resolveRate * 100).toFixed(0)}%)`);
  console.log(`    read: ${s.text.replace(/\s+/g, ' ').slice(0, 150)}`);
  if (s.unresolved.length) console.log(`    missed: ${s.unresolved.join(' | ')}`);
  console.log();
}

const missed = {};
for (const s of scans) for (const u of s.unresolved) missed[u] = (missed[u] ?? 0) + 1;
const top = Object.entries(missed).sort((a, b) => b[1] - a[1]).slice(0, 15);
if (top.length) {
  console.log('MOST-MISSED TERMS — garbled means OCR, clean means the canon is thin:');
  for (const [term, n] of top) console.log(`  ${String(n).padStart(3)}x  ${term}`);
}
