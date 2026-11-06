// Pulls products from Open Food Facts into LAYER 1 ONLY.
//
// ODbL attribution is stored on the source row and travels with every record
// out of the API. This tool must never write to canon, evidence or verdict.
//
// Usage: node tools/off-ingest/src/index.js <gtin> [<gtin> ...]

import { connect } from '../../../packages/db/src/db.js';
import { normaliseGtin } from '../../../packages/shared/src/product-ref.js';

const UA = 'verso/0.1 (Phase 1 ingest; contact: engineering)';
const FIELDS = 'code,product_name,brands,ingredients_text,countries_tags,lang';

const gtins = process.argv.slice(2);
if (!gtins.length) { console.error('usage: off-ingest <gtin> [<gtin> ...]'); process.exit(1); }

const client = await connect();
await client.query(
  `insert into product.source (id, name, license, license_url, attribution, share_alike)
   values ('openfoodfacts','Open Food Facts','ODbL-1.0',
           'https://opendatacommons.org/licenses/odbl/1-0/',
           'Product data from Open Food Facts, licensed under ODbL 1.0', true)
   on conflict (id) do nothing`);

const marketOf = tags => {
  const map = { india: 'IN', 'united-states': 'US', france: 'FR', 'united-kingdom': 'GB',
                germany: 'DE', spain: 'ES', italy: 'IT', indonesia: 'ID', brazil: 'BR' };
  for (const t of tags ?? []) {
    const key = t.replace(/^en:/, '');
    if (map[key]) return map[key];
  }
  return null;
};

let stored = 0, missed = 0;
for (const raw of gtins) {
  const gtin = normaliseGtin(raw);
  if (!gtin) { console.log(`  skip   ${raw} (not a valid GTIN)`); missed++; continue; }

  const res = await fetch(
    `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(raw)}.json?fields=${FIELDS}`,
    { headers: { 'User-Agent': UA } });
  const body = res.ok ? await res.json() : null;

  if (body?.status !== 1 || !body.product) { console.log(`  miss   ${raw} not in Open Food Facts`); missed++; continue; }
  const p = body.product;
  const market = marketOf(p.countries_tags);
  if (!market) { console.log(`  skip   ${raw} (no market we map yet: ${(p.countries_tags||[]).join(',')})`); missed++; continue; }

  await client.query(
    `insert into product.product
       (source_id, source_ref, market, gtin, brand, name, ingredients_raw, retrieved_at)
     values ('openfoodfacts',$1,$2,$3,$4,$5,$6, now())
     on conflict (source_id, source_ref, market) do update set
       brand = excluded.brand, name = excluded.name,
       ingredients_raw = excluded.ingredients_raw, retrieved_at = excluded.retrieved_at`,
    [p.code ?? raw, market, gtin, p.brands ?? null,
     p.product_name || '(unnamed)', p.ingredients_text ?? null]);
  console.log(`  store  ${gtin} ${market}  ${p.product_name || '(unnamed)'}`);
  stored++;
  await new Promise(r => setTimeout(r, 350));
}
console.log(`\n${stored} stored, ${missed} not stored`);
await client.end();
