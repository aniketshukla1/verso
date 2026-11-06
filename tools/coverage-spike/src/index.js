// PHASE 0 COVERAGE SPIKE
//
// Measures the real barcode hit rate against Open Food Facts per market. This
// number decides how much of Phase 1 is OCR work: the plan assumes coverage is
// thin outside the EU/US, and this is where that assumption gets tested rather
// than asserted.
//
// Usage: pnpm spike:coverage [--sample data/spike/basket.json]

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';

const UA = 'verso-coverage-spike/0.1 (Phase 0 measurement; contact: engineering)';
const OFF = 'https://world.openfoodfacts.org/api/v2/product';
const argSample = process.argv.includes('--sample')
  ? process.argv[process.argv.indexOf('--sample') + 1] : 'data/spike/basket.json';

if (!existsSync(argSample)) {
  console.error(`no basket at ${argSample}`);
  console.error('Create one: [{"gtin":"...","market":"IN","label":"Lay\'s Classic Salted 52g"}, ...]');
  console.error('Populate it by scanning a real shelf — 60 products per market is enough to be decisive.');
  process.exit(1);
}

const basket = JSON.parse(readFileSync(argSample, 'utf8'));
const byMarket = new Map();
const sleep = ms => new Promise(r => setTimeout(r, ms));

for (const item of basket) {
  const m = item.market;
  if (!byMarket.has(m)) byMarket.set(m, { total: 0, found: 0, withIngredients: 0, misses: [] });
  const bucket = byMarket.get(m);
  bucket.total++;

  let payload = null;
  try {
    const res = await fetch(`${OFF}/${encodeURIComponent(item.gtin)}.json?fields=code,product_name,brands,ingredients_text,countries_tags`,
      { headers: { 'User-Agent': UA } });
    if (res.ok) payload = await res.json();
  } catch (err) {
    bucket.misses.push({ ...item, reason: `network: ${err.message}` });
    await sleep(350);
    continue;
  }

  if (payload?.status === 1 && payload.product) {
    bucket.found++;
    const ing = (payload.product.ingredients_text || '').trim();
    if (ing.length > 10) bucket.withIngredients++;
    else bucket.misses.push({ ...item, reason: 'found but no usable ingredient text' });
  } else {
    bucket.misses.push({ ...item, reason: 'not in Open Food Facts' });
  }
  await sleep(350);   // be a good citizen against a nonprofit API
}

const pct = (n, d) => d ? `${((n / d) * 100).toFixed(0)}%` : 'n/a';
console.log('\nOPEN FOOD FACTS COVERAGE\n');
console.log('market  sampled  barcode hit  usable ingredients');
console.log('------  -------  -----------  ------------------');
const report = {};
for (const [market, b] of [...byMarket].sort()) {
  console.log(`${market.padEnd(6)}  ${String(b.total).padStart(7)}  ${pct(b.found, b.total).padStart(11)}  ${pct(b.withIngredients, b.total).padStart(18)}`);
  report[market] = { sampled: b.total, found: b.found, withIngredients: b.withIngredients, misses: b.misses };
}

const totals = [...byMarket.values()].reduce((a, b) =>
  ({ total: a.total + b.total, found: a.found + b.found, withIngredients: a.withIngredients + b.withIngredients }),
  { total: 0, found: 0, withIngredients: 0 });
console.log('------  -------  -----------  ------------------');
console.log(`ALL     ${String(totals.total).padStart(7)}  ${pct(totals.found, totals.total).padStart(11)}  ${pct(totals.withIngredients, totals.total).padStart(18)}`);
console.log('\nThe third column is the real number: a barcode hit with no ingredient text');
console.log('still forces the OCR path. Phase 1 sizing follows from it.\n');

mkdirSync('tools/coverage-spike/out', { recursive: true });
const out = `tools/coverage-spike/out/coverage-${new Date().toISOString().slice(0, 10)}.json`;
writeFileSync(out, JSON.stringify({ ranAt: new Date().toISOString(), totals, byMarket: report }, null, 2));
console.log(`written ${out}`);
