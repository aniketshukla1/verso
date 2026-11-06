import { readFileSync } from 'node:fs';
import { connect } from '../../db/src/db.js';

const data = JSON.parse(readFileSync('data/evidence/seed.json', 'utf8'));
const client = await connect();
const citationId = new Map();
const missing = [];

await client.query('begin');

for (const c of data.citations) {
  const { rows: [{ id }] } = await client.query(
    `insert into evidence.citation (source_key, title, url, published_on)
     values ($1,$2,$3,$4)
     on conflict (source_key, title) do update set url = excluded.url
     returning id`,
    [c.source_key, c.title, c.url ?? null, c.published_on ?? null]);
  citationId.set(c.key, id);
}

async function ingredientId(slug) {
  const { rows } = await client.query('select id from canon.ingredient where slug = $1', [slug]);
  if (!rows.length) { missing.push(slug); return null; }
  return rows[0].id;
}

let reg = 0;
for (const r of data.regulatory) {
  const iid = await ingredientId(r.ingredient);
  if (!iid) continue;
  await client.query(
    `insert into evidence.regulatory_status
       (ingredient_id, jurisdiction, status, scope, limit_note, effective_from, citation_id)
     values ($1,$2,$3,coalesce($4,'all_food'),$5,$6,$7)
     on conflict (ingredient_id, jurisdiction, scope) do update set
       status = excluded.status, limit_note = excluded.limit_note,
       effective_from = excluded.effective_from, citation_id = excluded.citation_id`,
    [iid, r.jurisdiction, r.status, r.scope ?? null, r.limit_note ?? null,
     r.effective_from ?? null, citationId.get(r.citation)]);
  reg++;
}

let haz = 0;
for (const h of data.hazards) {
  const iid = await ingredientId(h.ingredient);
  if (!iid) continue;
  await client.query(
    `insert into evidence.hazard_finding
       (ingredient_id, body, endpoint, finding, grade, citation_id)
     values ($1,$2,$3,$4,$5,$6)
     on conflict (ingredient_id, body, endpoint) do update set
       finding = excluded.finding, grade = excluded.grade, citation_id = excluded.citation_id`,
    [iid, h.body, h.endpoint, h.finding, h.grade, citationId.get(h.citation)]);
  haz++;
}

// Codex prints ranges as "38.0-43.5", "ND-0.6" or "ND" (not detected). Anything
// else is a transcription error, and a silently misparsed composition range is
// a false published number — so fail the seed rather than guess.
const RANGE = /^(ND|\d+(?:\.\d+)?)(?:-(\d+(?:\.\d+)?))?$/;
function parseRange(text, where) {
  const m = RANGE.exec(text);
  if (!m) throw new Error(`unparseable composition range "${text}" at ${where}`);
  const low = m[1] === 'ND' ? 0 : Number(m[1]);
  const high = m[2] !== undefined ? Number(m[2]) : low;
  if (low > high) throw new Error(`inverted composition range "${text}" at ${where}`);
  return { low, high };
}

let comp = 0;
for (const c of data.composition ?? []) {
  const iid = await ingredientId(c.ingredient);
  if (!iid) continue;
  // declarative, like the canon: the file is the whole truth for this ingredient
  await client.query('delete from evidence.composition where ingredient_id = $1', [iid]);
  for (const [component, rangeText] of Object.entries(c.components)) {
    const { low, high } = parseRange(rangeText, `${c.ingredient} ${component}`);
    await client.query(
      `insert into evidence.composition
         (ingredient_id, component, range_text, low, high, basis, citation_id)
       values ($1,$2,$3,$4,$5,$6,$7)`,
      [iid, component, rangeText, low, high, c.basis, citationId.get(c.citation)]);
    comp++;
  }
}

// Process contaminants: context, never scored. Declarative per ingredient, so a
// row removed from the file is removed here.
let pcRows = 0;
const pcByIngredient = new Map();
for (const r of data.process_contaminants ?? []) {
  pcByIngredient.set(r.ingredient, [...(pcByIngredient.get(r.ingredient) ?? []), r]);
}
for (const [slug, rows] of pcByIngredient) {
  const iid = await ingredientId(slug);
  if (!iid) continue;
  await client.query('delete from evidence.process_contaminant where ingredient_id = $1', [iid]);
  for (const r of rows) {
    if (!citationId.get(r.citation) || !citationId.get(r.limit_citation)) {
      throw new Error(`process contaminant for ${slug} cites an unknown citation`);
    }
    await client.query(
      `insert into evidence.process_contaminant
         (ingredient_id, contaminant, contaminant_cas, finding, citation_id, limit_note, limit_citation_id, context_quotes)
       values ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [iid, r.contaminant, r.cas, r.finding, citationId.get(r.citation), r.limit_note, citationId.get(r.limit_citation),
       r.context_quotes ?? []]);
    pcRows++;
  }
}

await client.query('commit');

const { rows: [s] } = await client.query(`
  select (select count(*) from evidence.citation) as citations,
         (select count(*) from evidence.regulatory_status) as regulatory,
         (select count(*) from evidence.hazard_finding) as hazards,
         (select count(distinct ingredient_id) from evidence.composition) as composed,
         (select count(distinct jurisdiction) from evidence.regulatory_status) as jurisdictions`);
console.log(`evidence seeded: ${s.regulatory} regulatory rows across ${s.jurisdictions} jurisdictions, ` +
            `${s.hazards} hazard findings, composition for ${s.composed} ingredients, ${s.citations} citations`);
if (missing.length) console.warn(`  unknown ingredient slugs (add to data/canon/): ${[...new Set(missing)].join(', ')}`);
await client.end();
