import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { connect } from '../../db/src/db.js';
import { normalise } from '../../shared/src/normalise.js';
import { clearResolved } from './resolve.js';

const dir = 'data/canon';
const client = await connect();
let ing = 0, syn = 0, clash = 0;

await client.query('begin');
// Curated files first, generated ones last: a synonym belongs to whichever file
// claims it first, and a hand-curated entry must never lose a term to a
// generated one (tools/canon-from-sources).
const isGenerated = f => f.endsWith('.generated.json');
const files = readdirSync(dir).filter(f => f.endsWith('.json'))
  .sort((x, y) => isGenerated(x) - isGenerated(y) || x.localeCompare(y));
for (const file of files) {
  const rows = JSON.parse(readFileSync(join(dir, file), 'utf8'));
  for (const r of rows) {
    const { rows: [{ id }] } = await client.query(
      `insert into canon.ingredient (slug, display_name, kind, ins_number, e_number, cas_number, function, notes)
       values ($1,$2,$3,$4,$5,$6,$7,$8)
       on conflict (slug) do update set
         display_name = excluded.display_name, kind = excluded.kind,
         ins_number = excluded.ins_number, e_number = excluded.e_number,
         cas_number = excluded.cas_number, function = excluded.function
       returning id`,
      [r.slug, r.display_name, r.kind, r.ins ?? null, r.e ?? null, r.cas ?? null, r.function, r.notes ?? null]);
    ing++;

    // data/canon is the source of truth: drop this ingredient's existing
    // synonyms so a removed term in the file is a removed term in the database.
    await client.query('delete from canon.synonym where ingredient_id = $1', [id]);

    for (const s of r.synonyms) {
      const [term, kind = 'common', lang = 'en'] = s.split('|');
      const norm = normalise(term);
      if (!norm) continue;
      const res = await client.query(
        `insert into canon.synonym (ingredient_id, term, normalised, lang, kind)
         values ($1,$2,$3,$4,$5)
         on conflict (normalised, lang) do nothing
         returning id`,
        [id, term.trim(), norm, lang, kind]);
      if (res.rowCount) syn++;
      else {
        // a normalised term already owned by a DIFFERENT ingredient is a real
        // curation bug — two substances cannot share a label string.
        const { rows: [owner] } = await client.query(
          `select i.slug from canon.synonym s join canon.ingredient i on i.id = s.ingredient_id
           where s.normalised = $1 and s.lang = $2`, [norm, lang]);
        if (owner && owner.slug !== r.slug) {
          console.warn(`  CLASH "${term}" -> ${norm}: claimed by ${owner.slug}, also listed under ${r.slug}`);
          clash++;
        }
      }
    }
  }
}
// The resolver matches on normalised text without knowing the label's language,
// so the same string meaning two different substances across languages is a
// real ambiguity, not a harmless duplicate.
const { rows: crossLang } = await client.query(
  `select s.normalised, count(distinct s.ingredient_id) n,
          string_agg(distinct i.slug, ', ') slugs
   from canon.synonym s join canon.ingredient i on i.id = s.ingredient_id
   group by s.normalised having count(distinct s.ingredient_id) > 1`);
for (const r of crossLang) {
  console.warn(`  CROSS-LANG CLASH "${r.normalised}" maps to ${r.n} ingredients: ${r.slugs}`);
  clash++;
}

// Terms the canon has since learned are no longer gaps. Without this the
// content lead's queue keeps showing work that is already done. Matching a
// term's normalised text against the synonyms missed everything the resolver
// reaches another way (a bracketed oil, a split word, a component list), so the
// resolver itself decides.
const cleared = await clearResolved(client);
for (const c of cleared) {
  const term = c.sample_term.length > 60 ? `${c.sample_term.slice(0, 57)}...` : c.sample_term;
  const hits = `${c.hit_count} hit${c.hit_count === 1 ? '' : 's'}`;
  console.log(`  cleared "${term}" (${hits}) -> ${c.resolved_to.join(', ') || 'no item'}`);
}
if (cleared.length) console.log(`  cleared ${cleared.length} resolved term(s) from the work queue; copies in canon.cleared_term`);

await client.query('commit');

const { rows: [c] } = await client.query(
  `select (select count(*) from canon.ingredient) as ingredients,
          (select count(*) from canon.synonym)    as synonyms,
          (select count(*) from canon.ingredient where e_number is not null) as with_e`);
console.log(`canon seeded: ${c.ingredients} ingredients, ${c.synonyms} synonyms (${c.with_e} carry an E number)`);
if (clash) console.log(`${clash} synonym clash(es) — resolve in data/canon/ before relying on the resolver`);
await client.end();
