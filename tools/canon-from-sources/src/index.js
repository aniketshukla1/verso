// Generate canon entries for every EU additive the curated canon lacks, so any
// E or INS number on a label resolves. Writes data/canon/eu-additives.generated.json,
// which the seeder loads after the curated files: a curated entry always wins.
//
//   pnpm canon:generate && pnpm seed
//
// Reads the latest local copies in data/sources (pnpm sources:sync first). The
// output is committed, so seeding never depends on a download.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { normalise } from '../../../packages/shared/src/normalise.js';
import { parse as parseEu } from '../../../packages/evidence/src/sources/eu.js';
import { parse as parseFda } from '../../../packages/evidence/src/sources/fda.js';

const OUT = 'data/canon/eu-additives.generated.json';
const latest = (key, ext) => {
  const dir = join('data/sources', key);
  const f = readdirSync(dir).filter(n => n.endsWith(`.${ext}`) && !n.includes('.refused.')).sort().at(-1);
  if (!f) throw new Error(`no local copy of ${key}; run pnpm sources:sync`);
  return readFileSync(join(dir, f));
};

const curated = readdirSync('data/canon')
  .filter(f => f.endsWith('.json') && !f.endsWith('.generated.json'))
  .flatMap(f => JSON.parse(readFileSync(join('data/canon', f), 'utf8')));
const curatedE = new Set(curated.map(r => r.e).filter(Boolean));
const curatedSlugs = new Set(curated.map(r => r.slug));
const curatedTerms = new Set(curated.flatMap(r => r.synonyms.map(s => normalise(s.split('|')[0]))));

// FDA enrichment, by exact name only and only when unambiguous: a wrong CAS
// number would attach another substance's hazard listings to this one.
const fdaByName = new Map();
for (const r of parseFda(latest('fda-substances', 'csv')).records) {
  for (const n of new Set(r.names.map(normalise))) fdaByName.set(n, [...(fdaByName.get(n) ?? []), r]);
}
const fdaMatch = name => {
  const hits = [...new Map((fdaByName.get(normalise(name)) ?? []).map(r => [r.record_key, r])).values()];
  return hits.length === 1 ? hits[0] : null;
};

// The E-number system's conventional ranges. A display grouping, and what the
// comparison engine requires to call two items a substitution; an approximate
// kind errs toward reporting absences instead, which says less, not more.
function kindOf(e) {
  const n = parseInt(e.slice(1), 10);
  if (n >= 100 && n < 200) return 'colour';
  if ((n >= 200 && n < 260) || (n >= 280 && n < 300)) return 'preservative';
  if (n >= 300 && n < 322) return 'antioxidant';
  if (n === 322) return 'emulsifier';
  if (n >= 420 && n <= 422) return 'humectant';
  if ((n >= 400 && n < 430) || (n >= 440 && n < 470 && ![442, 444, 445].includes(n)) || (n >= 1400 && n < 1500)) return 'stabiliser';
  if (n >= 430 && n < 500) return 'emulsifier';
  if ((n >= 260 && n < 280) || (n >= 323 && n < 400) || (n >= 500 && n < 530)) return 'acidity_regulator';
  if (n >= 530 && n < 580) return 'anticaking';
  if (n >= 600 && n < 700) return 'flavour_enhancer';
  if (n >= 920 && n < 930) return 'flour_treatment';
  if (n >= 950 && n < 970) return 'sweetener';
  return 'other';
}

const slugify = s => normalise(s).replace(/\s+/g, '-').replace(/[^\p{L}\p{N}-]/gu, '').slice(0, 60);
// FDA lists every technical effect a substance has under any regulation. The
// first is the primary one; the whole list reads as a string of claims.
const primaryEffect = s => {
  const first = String(s ?? '').split(',')[0].trim().toLowerCase();
  return first ? `${first.charAt(0).toUpperCase()}${first.slice(1)}.` : null;
};

const eu = parseEu(latest('eu-additives', 'json'));
const out = [];
const slugs = new Set(curatedSlugs);
let skipped = 0;
for (const r of eu.records.filter(r => r.e_number && r.payload.type === 'substance').sort((a, b) => a.e_number.localeCompare(b.e_number, 'en', { numeric: true }))) {
  if (curatedE.has(r.e_number) || out.some(o => o.e === r.e_number)) { skipped++; continue; }
  const ins = r.e_number.slice(1);                   // INS numbering follows the EU's
  const sub = /^(\d+[a-z]?)([ivx]+)$/.exec(ins);     // "500ii" is written "500(ii)" too
  const numberForms = [ins, ...(sub ? [`${sub[1]}(${sub[2]})`] : [])];
  const names = [...new Set([r.name, ...(r.names ?? [])].filter(Boolean))];
  const fda = fdaMatch(r.name);
  let slug = slugify(r.name) || r.e_number.toLowerCase();
  if (slugs.has(slug)) slug = `${slug}-${r.e_number.toLowerCase()}`;
  slugs.add(slug);

  const synonyms = new Set([
    ...names.filter(n => !curatedTerms.has(normalise(n))).map(n => `${n}|common`),
    ...numberForms.map(f => `E${f}|e_number`),
    ...numberForms.map(f => `INS ${f}|ins_number`),
    ...(fda?.cas[0] ? [`${fda.cas[0]}|cas`] : []),
  ]);
  out.push({
    slug,
    display_name: r.name,
    kind: kindOf(r.e_number),
    ins,
    e: r.e_number,
    cas: fda?.cas[0] ?? null,
    function: primaryEffect(fda?.payload.technicalEffect) ?? `Food additive, ${r.e_number} in the EU.`,
    notes: `Generated from the EU Food Additives Database (${r.url})${fda ? `; CAS and function from FDA Substances Added to Food, matched by exact name (${fda.name})` : ''}.`,
    synonyms: [...synonyms],
  });
}

writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n');
console.log(`${OUT}: ${out.length} additives (${out.filter(o => o.cas).length} with CAS from FDA); ${skipped} already curated`);
