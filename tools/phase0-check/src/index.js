// Phase 0 exit-criteria check + an end-to-end proof that the canon resolves
// both sides of a real cross-market pair. Not the Phase 2 comparison pipeline —
// just enough to show the foundation holds.

import { connect } from '../../../packages/db/src/db.js';
import { resolveDeclaration } from '../../../packages/canon/src/resolve.js';

const client = await connect();
const ok = [], bad = [];
const check = (pass, label, detail) => (pass ? ok : bad).push(`${label}${detail ? ` — ${detail}` : ''}`);

// ---- exit criteria ----
const { rows: [m] } = await client.query(`
  select (select count(*) from canon.ingredient) ing,
         (select count(*) from canon.synonym) syn,
         (select count(distinct jurisdiction) from evidence.regulatory_status) juris,
         (select count(*) from evidence.regulatory_status) reg,
         (select count(*) from evidence.hazard_finding) haz,
         (select count(*) from evidence.regulatory_status where citation_id is null) uncited_reg,
         (select count(*) from evidence.hazard_finding where citation_id is null) uncited_haz,
         (select count(*) from canon.ingredient i
            where not exists (select 1 from canon.synonym s where s.ingredient_id = i.id)) no_syn`);

check(Number(m.juris) >= 4, 'Regulatory status across >= 4 jurisdictions', `${m.juris} jurisdictions, ${m.reg} rows`);
check(Number(m.uncited_reg) === 0 && Number(m.uncited_haz) === 0, 'Every evidence row carries a citation');
check(Number(m.no_syn) === 0, 'Every ingredient has at least one synonym');
check(Number(m.ing) >= 400, 'Canon holds >= 400 ingredients', `${m.ing} of 400 — content lead to expand`);

// ---- resolver proof: the real Lay's pair ----
const US_LABEL = 'Potatoes, Vegetable Oil (Sunflower, Corn, and/or Canola Oil), Salt.';
const IN_LABEL = 'Potato, Edible Vegetable Oil (Palmolein Oil), Salt, Spices & Condiments.';

// a check, not a scan: nothing it resolves belongs in the content lead's work queue
const us = await resolveDeclaration(client, US_LABEL, { queue: false });
const ind = await resolveDeclaration(client, IN_LABEL, { queue: false });

const nameOf = r => r.display_name;
console.log('\nRESOLVER PROOF — Lay\'s Classic, two markets\n');
console.log(`  US  matched: ${us.matched.map(nameOf).join(', ') || '(none)'}`);
console.log(`      unresolved: ${us.unresolved.join(' | ') || '(none)'}`);
console.log(`  IN  matched: ${ind.matched.map(nameOf).join(', ') || '(none)'}`);
console.log(`      unresolved: ${ind.unresolved.join(' | ') || '(none)'}`);

const usIds = new Set(us.matched.map(r => r.id));
const inIds = new Set(ind.matched.map(r => r.id));
const onlyIN = ind.matched.filter(r => !usIds.has(r.id));
const onlyUS = us.matched.filter(r => !inIds.has(r.id));

console.log('\n  DETERMINISTIC DELTA');
console.log(`    only in IN: ${onlyIN.map(nameOf).join(', ') || '(none)'}`);
console.log(`    only in US: ${onlyUS.map(nameOf).join(', ') || '(none)'}`);

const palmolein = ind.matched.find(r => r.slug === 'palmolein');
check(!!palmolein, 'India label resolves "Palmolein Oil" to the palmolein entity',
      palmolein ? undefined : 'resolved to something else or missed');
check(!us.matched.some(r => r.slug === 'palmolein' || r.slug === 'palm-oil'),
      'US label contains no palm fat');
check(us.matched.some(r => r.slug === 'sunflower-oil') && us.matched.some(r => r.slug === 'canola-oil'),
      'US label resolves sunflower and canola');

// ---- regulatory lookup for a flagged ingredient ----
const { rows: reg } = await client.query(`
  select i.display_name, r.jurisdiction, r.status, r.effective_from, c.title
  from evidence.regulatory_status r
  join canon.ingredient i on i.id = r.ingredient_id
  join evidence.citation  c on c.id = r.citation_id
  where i.slug = 'potassium-bromate' order by r.jurisdiction`);
console.log('\n  REGULATORY LOOKUP — potassium bromate');
for (const r of reg) {
  const eff = r.effective_from ? ` from ${r.effective_from}` : '';
  console.log(`    ${r.jurisdiction.padEnd(6)} ${r.status.padEnd(15)}${eff}`);
}
check(reg.length >= 4, 'Cross-jurisdiction status resolves for a flagged ingredient', `${reg.length} jurisdictions`);

// ---- report ----
console.log('\nPHASE 0 EXIT CRITERIA\n');
for (const l of ok)  console.log(`  PASS  ${l}`);
for (const l of bad) console.log(`  TODO  ${l}`);
console.log(`\n  ${ok.length} met, ${bad.length} outstanding`);
console.log(`  canon: ${m.ing} ingredients / ${m.syn} synonyms   evidence: ${m.reg} regulatory / ${m.haz} hazard\n`);
await client.end();
