import { normalise } from '../../shared/src/normalise.js';

// Label terms the canon does not know, identified on demand (canon.identification).
//
// A model proposes what each unknown term is. Nothing it says is taken on its
// word where a trusted identifier exists to check it against:
//
//   1. an E number counts only if the canon's name for that number (from the EU
//      list) matches the model's name: a hallucinated E number names another
//      substance, and a small local model did exactly that in testing
//   2. a CAS number counts only if the canon holds it under a matching name
//   3. otherwise the model's standard name must already be a canon name
//
// Anything else becomes a new ingredient marked automatic and unverified. It is
// shown as "identified automatically" with its list checks, and never scored
// (docs/methodology.md, "Identifying unknown label terms"). A CAS number joins
// such an ingredient only when an official list holds it under a matching name.
//
// Every answer is kept, including "not an ingredient", so a term is looked up
// once and every later scan resolves it from the table.

const CAS = /^\d{2,7}-\d{2}-\d$/;
const KIND = { food: 'base', flavouring: 'other', vitamin_mineral: 'other', additive: 'other' };
const OUTCOMES = new Set(['matched', 'created', 'not_ingredient']);

// "E 621", "INS 621", "621" -> "E621"; "E500(ii)" -> "E500ii": the canon's form
export function canonE(raw) {
  const m = /^(?:e|ins)?\s*(\d{3,4}[a-z]?)\s*(?:\(\s*([ivx]+)\s*\)|([ivx]+))?$/i.exec(String(raw ?? '').trim());
  return m ? `E${m[1].toLowerCase()}${(m[2] ?? m[3] ?? '').toLowerCase()}` : null;
}

// Two names for one substance: the same words, or one name's words all inside
// the other's ("monosodium glutamate" / "Monosodium glutamate (MSG)").
export function sameSubstance(name, candidates) {
  const a = new Set(normalise(name).split(' ').filter(Boolean));
  if (!a.size) return false;
  return candidates.some(c => {
    const b = new Set(normalise(c).split(' ').filter(Boolean));
    if (!b.size) return false;
    const [small, big] = a.size <= b.size ? [a, b] : [b, a];
    return [...small].every(t => big.has(t));
  });
}

async function one(client, sql, params) {
  const { rows } = await client.query(sql, params);
  return rows[0] ?? null;
}

const namesOf = `array(select s.term from canon.synonym s where s.ingredient_id = i.id) as names`;

async function createIngredient(client, { name, kind, cas, verified, term }) {
  const slug = `auto-${normalise(name).replace(/\s+/g, '-')}`.slice(0, 60);
  const display = name.charAt(0).toUpperCase() + name.slice(1);
  const { rows: [r] } = await client.query(
    `insert into canon.ingredient (slug, display_name, kind, cas_number, function, origin, verified)
     values ($1, $2, $3, $4, $5, 'auto', $6)
     on conflict (slug) do update set slug = excluded.slug
     returning id`,
    [slug, display, kind, cas, `Identified automatically from the label term "${term}".`, verified]);
  // Its English name, so the official lists can be checked by name. The seeder
  // never touches these rows: they are in no data/canon file.
  const n = normalise(name);
  if (n) {
    await client.query(
      `insert into canon.synonym (ingredient_id, term, normalised, lang, kind)
       values ($1, $2, $3, 'en', 'common') on conflict (normalised, lang) do nothing`, [r.id, name, n]);
  }
  return r.id;
}

// One term and the model's proposal for it -> a canon.identification row.
async function place(client, term, p, model) {
  const row = {
    normalised: normalise(term), term, model, outcome: 'unknown', ingredient_id: null, verified_by: null,
    name: p?.name?.trim() || null, kind: p?.kind ?? null, e_number: p?.e_number ?? null, cas: p?.cas ?? null,
  };
  if (!row.name) return row;
  if (p.kind === 'not_an_ingredient') return { ...row, outcome: 'not_ingredient' };

  const e = canonE(p.e_number);
  if (e) {
    const ing = await one(client, `select i.id, i.display_name, ${namesOf} from canon.ingredient i where i.e_number = $1`, [e]);
    if (ing && sameSubstance(row.name, [ing.display_name, ...ing.names])) {
      return { ...row, outcome: 'matched', ingredient_id: ing.id, verified_by: 'e_number' };
    }
  }

  if (CAS.test(p.cas ?? '')) {
    const ing = await one(client,
      `select i.id, i.display_name, ${namesOf} from canon.ingredient i
       where i.cas_number = $1
          or exists (select 1 from canon.synonym s where s.ingredient_id = i.id and s.kind = 'cas' and s.term = $1)
       limit 1`, [p.cas]);
    if (ing && sameSubstance(row.name, [ing.display_name, ...ing.names])) {
      return { ...row, outcome: 'matched', ingredient_id: ing.id, verified_by: 'cas' };
    }
  }

  const byName = await one(client,
    `select ingredient_id as id from canon.synonym where normalised = $1 limit 1`, [normalise(row.name)]);
  if (byName) return { ...row, outcome: 'matched', ingredient_id: byName.id, verified_by: 'canon_name' };

  let cas = null;
  if (CAS.test(p.cas ?? '')) {
    const { rows } = await client.query(
      `select name from evidence.source_record where removed_in is null and $1 = any(cas)`, [p.cas]);
    if (rows.some(r => sameSubstance(row.name, [r.name]))) cas = p.cas;
  }
  const id = await createIngredient(client, {
    name: row.name, kind: KIND[p.kind] ?? 'other', cas, verified: Boolean(cas), term });
  return { ...row, outcome: 'created', ingredient_id: id, verified_by: cas ? 'cas' : null };
}

async function saveAll(client, terms, answer) {
  const proposals = new Map((answer?.items ?? []).map(p => [normalise(p?.term ?? ''), p]));
  const saved = new Map();
  for (const term of terms) {
    const p = proposals.get(normalise(term));
    if (!p) continue;   // skipped by the model: asked again next time
    const r = await place(client, term, p, answer.model ?? 'unknown');
    await client.query(
      `insert into canon.identification
         (normalised, term, outcome, ingredient_id, name, kind, e_number, cas, verified_by, model)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       on conflict (normalised) do update set
         term = excluded.term, outcome = excluded.outcome, ingredient_id = excluded.ingredient_id,
         name = excluded.name, kind = excluded.kind, e_number = excluded.e_number, cas = excluded.cas,
         verified_by = excluded.verified_by, model = excluded.model, identified_at = now()`,
      [r.normalised, r.term, r.outcome, r.ingredient_id, r.name, r.kind, r.e_number, r.cas, r.verified_by, r.model]);
    saved.set(r.normalised, r);
  }
  // an identified term is no longer a gap in the content lead's queue
  const done = [...saved.values()].filter(r => OUTCOMES.has(r.outcome)).map(r => r.normalised);
  if (done.length) await client.query('delete from canon.unresolved_term where normalised = any($1)', [done]);
  return saved;
}

// items: [{ position, text }], the declaration items the resolver could not match.
// identify(terms, ctx) -> { model, items: [{ term, name, kind, e_number, cas }] }.
// A lookup slower than `budgetMs` does not hold up the verdict: it finishes in
// the background and the next scan finds the answer here.
export async function identifyTerms(client, items, { identify, market, budgetMs = 12_000 } = {}) {
  const out = { identified: [], notIngredient: [], pending: [] };
  // A panel of nutrition figures or an address is not an ingredient name, and
  // not worth a model's time: on-device OCR hands over hundreds of characters of it.
  const plausible = t => t.length <= 80 && (t.match(/\d/g) ?? []).length <= 6;
  const keyed = items.filter(it => plausible(it.text))
    .map(it => ({ ...it, key: normalise(it.text) })).filter(it => it.key);
  if (!keyed.length) return out;

  const { rows } = await client.query(
    'select * from canon.identification where normalised = any($1)', [[...new Set(keyed.map(i => i.key))]]);
  const known = new Map(rows.map(r => [r.normalised, r]));

  const missing = [...new Map(keyed.filter(i => !known.has(i.key)).map(i => [i.key, i.text])).values()];
  if (missing.length && identify) {
    const job = Promise.resolve()
      .then(() => identify(missing, { market }))
      .then(answer => (answer ? saveAll(client, missing, answer) : new Map()))
      .catch(() => new Map());
    const fresh = await Promise.race([job, new Promise(r => setTimeout(() => r(null), budgetMs).unref?.())]);
    if (fresh) for (const [k, r] of fresh) known.set(k, r);
    else out.pending = missing;
  }

  for (const it of keyed) {
    const r = known.get(it.key);
    if (!r) continue;
    if (r.outcome === 'not_ingredient') out.notIngredient.push(it);
    else if ((r.outcome === 'matched' || r.outcome === 'created') && r.ingredient_id) out.identified.push({ ...it, row: r });
  }
  return out;
}
