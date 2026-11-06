import { normalise, splitIngredientGroups } from '../../shared/src/normalise.js';

// Resolve one label term to a canonical ingredient.
// Exact synonym match first; trigram similarity only as a fallback, and only
// above a threshold — a wrong ingredient match produces a wrong regulatory
// claim, so an unresolved term is strictly better than a guessed one.
export async function resolveTerm(client, term, { minSimilarity = 0.62 } = {}) {
  const norm = normalise(term);
  if (!norm) return null;

  const exact = await client.query(
    `select i.id, i.slug, i.display_name, i.e_number, i.kind, s.kind as match_kind
     from canon.synonym s join canon.ingredient i on i.id = s.ingredient_id
     where s.normalised = $1 limit 1`, [norm]);
  if (exact.rowCount) return { ...exact.rows[0], confidence: 'exact', term };

  const fuzzy = await client.query(
    `select i.id, i.slug, i.display_name, i.e_number, i.kind, s.kind as match_kind,
            s.normalised as syn_normalised, similarity(s.normalised, $1) as sim
     from canon.synonym s join canon.ingredient i on i.id = s.ingredient_id
     where s.normalised % $1
     order by sim desc limit 5`, [norm]);

  const labelTokens = new Set(norm.split(' '));
  for (const cand of fuzzy.rows) {
    if (cand.sim < minSimilarity) break;
    // Reject a synonym that carries qualifying tokens the label does not:
    // "edible vegetable oil" must NOT match "edible vegetable oil (palm)".
    // The missing word is the entire identity of the substance.
    const synTokens = cand.syn_normalised.split(' ');
    if (synTokens.length > 1) {
      // every word of a multi-word synonym must actually appear on the label
      if (synTokens.some(t => !labelTokens.has(t))) continue;
    } else if (labelTokens.size > 1) {
      continue;   // a one-word synonym may not fuzzy-match a whole phrase
    }
    const { syn_normalised, ...hit } = cand;
    return { ...hit, confidence: 'fuzzy', term };
  }

  return null;
}

// One label term nothing could settle, into the content lead's work queue.
// Exported for buildVerdict, which queues only after identification has run.
export async function queueUnresolved(client, term) {
  const norm = normalise(term);
  if (!norm) return;
  await client.query(
    `insert into canon.unresolved_term (normalised, sample_term)
     values ($1,$2)
     on conflict (normalised) do update
       set hit_count = canon.unresolved_term.hit_count + 1, last_seen = now()`,
    [norm, term]);
}

// Resolve a whole declaration. One declaration item may legitimately yield
// several ingredients ("Vegetable Oil (Sunflower, Corn and/or Canola Oil)"),
// and an item that lists its components ("Seasoning [Maltodextrin, Sugar,
// Black Salt]") is judged component by component: each unknown component is a
// gap in its own right, and one known component no longer hides the others.
//
// `position` is the index of the declaration item an ingredient came from. It is
// what a cross-market comparison aligns on: "Vegetable Oil (Sunflower, Corn,
// and/or Canola Oil)" is ONE position holding three ingredients, so rank alone
// cannot say that two labels put different oils in the same place.
//
// Every unresolved item is queued in canon.unresolved_term, the content lead's
// work queue, and only a real scan belongs there. Tests, demos and checks pass
// `queue: false`: their fixtures otherwise outrank every real gap in the queue.
export async function resolveDeclaration(client, raw, { queue = true } = {}) {
  const matched = new Map();
  const unresolved = [];
  const items = [];            // every declaration item as written, in label order
  const unresolvedItems = [];  // the unresolved ones, with where they sat
  let rank = 0;

  // One candidate list: resolve every candidate, then drop bare fragments of a
  // phrase that also matched. "Corn Oil" generates the candidate "Corn", which
  // resolves to the grain; reporting both would claim the product contains
  // maize as well as corn oil. It does not.
  async function resolveList(candidates) {
    const hits = [];
    for (const term of candidates) {
      const hit = await resolveTerm(client, term);
      if (hit) hits.push({ hit, tokens: new Set(normalise(term).split(' ')) });
    }
    return hits.filter(({ tokens }) => !hits.some(other =>
      other.tokens !== tokens &&
      other.tokens.size > tokens.size &&
      [...tokens].every(t => other.tokens.has(t))));
  }

  // Rank in the order the label wrote them. Candidates are generated
  // longest-phrase-first, so "Sunflower, Corn, and/or Canola Oil" would
  // otherwise rank Canola first, and a comparison sentence would then quote
  // the label out of order.
  function place(kept, text, position) {
    const words = normalise(text).split(' ');
    const at = ({ hit }) => {
      const i = words.indexOf(normalise(hit.term).split(' ')[0]);
      return i < 0 ? Infinity : i;
    };
    for (const { hit } of [...kept].sort((x, y) => at(x) - at(y))) {
      if (!matched.has(hit.id)) matched.set(hit.id, { ...hit, rank: rank++, position });
    }
  }

  async function miss(text, position) {
    unresolved.push(text);               // the declaration item as written
    unresolvedItems.push({ position, text });
    if (queue) await queueUnresolved(client, text);
  }

  for (const [position, group] of splitIngredientGroups(raw).entries()) {
    items.push({ position, text: group[0] });
    const kept = await resolveList(group);
    place(kept, group[0], position);
    for (const member of group.members ?? []) {
      const k = await resolveList(member);
      place(k, member[0], position);
      if (k.length === 0 && !member.listed) await miss(member[0], position);
    }
    // An item whose components are listed is judged by them: "Seasoning"
    // itself being unknown is not a gap. Otherwise nothing matched means the
    // item itself is unknown.
    if (kept.length === 0 && !(group.members ?? []).length) await miss(group[0], position);
  }
  return { matched: [...matched.values()], unresolved, items, unresolvedItems };
}

// Clear from the work queue every term the resolver now handles; the seeder runs
// this after each change to the canon. Each row is copied to canon.cleared_term
// by the statement that deletes it.
//
// The queue keeps an item's text, not the label it came from, so a row is read
// as a declaration of its own, the way a scan reads text today, with
// `queue: false`: a cleanup must never add hits. It is cleared when nothing in it
// is left unresolved, which includes text that no longer yields an item at all.
//
// Three rows are nutrition-panel OCR that ran on into "INGREDIENTS: Makhana
// (Fox Nuts - )" and resolve only through that tail. They count. The splitter
// now starts a declaration after its heading (declarationText in normalise.js),
// so the same text in a scan today yields Makhana and queues nothing. The panel
// before the heading was never canon work, since no ingredient name resolves a
// nutrition table; it was queued before the splitter learned to cut there.
export async function clearResolved(client) {
  const { rows } = await client.query('select id, sample_term from canon.unresolved_term order by id');
  const cleared = [];
  for (const row of rows) {
    const { matched, unresolved } = await resolveDeclaration(client, row.sample_term, { queue: false });
    if (unresolved.length) continue;
    const { rows: [copy] } = await client.query(
      `with gone as (delete from canon.unresolved_term where id = $1 returning *)
       insert into canon.cleared_term
         (unresolved_id, normalised, sample_term, hit_count, first_seen, last_seen, resolved_to)
       select id, normalised, sample_term, hit_count, first_seen, last_seen, $2::text[] from gone
       returning sample_term, hit_count, resolved_to`,
      [row.id, matched.map(m => m.slug)]);
    if (copy) cleared.push(copy);   // none if another process cleared it first
  }
  return cleared;
}
