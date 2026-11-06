// Eyeball verdict output across all four entry paths without running the app.
import { connect } from '../../../packages/db/src/db.js';
import { buildVerdict } from '../../../packages/verdict/src/build.js';

const db = await connect();
async function show(label, args) {
  // a demo, not a scan: its labels stay out of the content lead's work queue
  const v = await buildVerdict(db, { ...args, queue: false });
  console.log(`\n=== ${label} ===`);
  if (!v.found) { console.log(`  NOT FOUND — ${v.reason}`); return; }
  console.log(`  resolvedFrom: ${v.resolvedFrom}   ref: ${v.productRef}`);
  if (v.product) console.log(`  product: ${v.product.brand} — ${v.product.name}  [${v.product.license}]`);
  console.log(`  matched: ${v.ingredients.map(i => i.displayName).join(', ') || '(none)'}`);
  console.log(`  unresolved: ${v.unresolved.length} item(s)`);
  const h = v.hazard;
  console.log(`  score: ${h.suppressed ? `SUPPRESSED — ${h.suppressionReason}` : h.score}` +
              `   confidence ${h.confidence}   label ${h.labelCoverage}   evidence ${h.evidenceCoverage}` +
              `   deducted ${h.deducted}`);
  for (const it of h.items.slice(0, 4)) console.log(`     -${String(it.points).padStart(2)}  [${it.tier}] ${it.ingredient}: ${it.reason}`);
  for (const c of v.claims.slice(0, 5)) console.log(`     (${c.templateId}) ${c.text}`);
}

await show('barcode hit, catalogue product', { gtin: '3017620422003', market: 'FR' });
await show('GRACEFUL MISS — unknown barcode + OCR panel (IN)', {
  gtin: '8901234567890', market: 'IN',
  ingredientsText: 'Refined Wheat Flour, Edible Vegetable Oil (Palmolein Oil), Sugar, ' +
    'Colour (INS 102), Preservative (INS 211), Antioxidant (INS 319), ' +
    'Flavour Enhancer (INS 621), Salt.' });
await show('OCR only, bromated bread (US)', { market: 'US',
  ingredientsText: 'Enriched Flour, Water, Potassium Bromate, Azodicarbonamide, ' +
    'Calcium Propionate, Soy Lecithin, Salt.' });
await show('nothing to go on', { gtin: '9999999999999', market: 'IN' });
await db.end();
