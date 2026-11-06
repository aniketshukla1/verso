// Cross-market comparison: two labels, one deterministic diff.
//
// CLAUDE.md rule 2 lives here. Both declarations are normalised through the
// canon and compared by code — no model decides what differs. Every sentence is
// rendered through a cmp.* template from a delta this file computed, and says
// what the two labels list, never why they differ (docs/claim-templates.md).

import { resolveDeclaration } from '../../canon/src/resolve.js';
import { normaliseGtin } from '../../shared/src/product-ref.js';
import { lookupProduct } from './build.js';
import { evidenceFor, saturatedBound } from './evidence.js';
import { render, marketLabel, joinList, METHOD_VERSION } from './templates.js';

// A comparison is shown only when Verso can read nearly all of both labels.
// Below this it is not shown with a caveat — it is not shown ("Suppression" in
// claim-templates.md). Stricter than the score gate, because naming a
// difference between two products is the most consequential thing Verso says.
export const MIN_COMPARE_COVERAGE = 0.8;

// Enumerated, not caller-supplied: a source is named from what Verso knows
// about where the text came from, never from a free-text field on the request.
const ORIGIN = { scan: 'a label scanned in Verso', sample: 'a Verso test label' };

const connector = text =>
  /and\s*\/\s*or/i.test(text) ? 'and/or' : /\bor\b/i.test(text) ? 'or' : 'and';

// a, b: resolveDeclaration() output. Pure — no database, no model.
export function diffLabels(a, b) {
  const idsA = new Set(a.matched.map(m => m.id));
  const idsB = new Set(b.matched.map(m => m.id));
  const onlyA = a.matched.filter(m => !idsB.has(m.id));
  const onlyB = b.matched.filter(m => !idsA.has(m.id));
  const unreadableA = new Set(a.unresolvedItems.map(u => u.position));
  const unreadableB = new Set(b.unresolvedItems.map(u => u.position));

  const deltas = [];
  const paired = new Set();
  let withheld = 0;

  // Substitution: at one declaration position each label lists ingredients the
  // other lacks, of the same kinds, with nothing unreadable at that position on
  // either side. "Same position" is literal: a list shifted by one extra item
  // yields absences rather than a substitution, which errs toward saying less.
  const positions = [...new Set(onlyA.map(m => m.position))].sort((x, y) => x - y);
  for (const p of positions) {
    const as = onlyA.filter(m => m.position === p);
    const bs = onlyB.filter(m => m.position === p);
    if (!bs.length || unreadableA.has(p) || unreadableB.has(p)) continue;
    const kindsA = new Set(as.map(m => m.kind));
    const kindsB = new Set(bs.map(m => m.kind));
    if (kindsA.size !== kindsB.size || [...kindsA].some(k => !kindsB.has(k))) continue;
    deltas.push({ type: 'substitution', position: p, a: as, b: bs });
    for (const m of [...as, ...bs]) paired.add(m);
  }

  // Absence: claimable only when the OTHER label has no unreadable items. Any
  // one of those could be the "missing" ingredient, written in a way the canon
  // does not know yet — so the absence is withheld, not hedged.
  for (const m of onlyA) {
    if (paired.has(m)) continue;
    if (b.unresolvedItems.length) { withheld++; continue; }
    deltas.push({ type: 'only_a', position: m.position, a: [m], b: [] });
  }
  for (const m of onlyB) {
    if (paired.has(m)) continue;
    if (a.unresolvedItems.length) { withheld++; continue; }
    deltas.push({ type: 'only_b', position: m.position, a: [], b: [m] });
  }

  deltas.sort((x, y) => x.position - y.position);
  return { deltas, withheld };
}

const isoDay = v => (v instanceof Date ? v.toISOString().slice(0, 10)
  : /^\d{4}-\d{2}-\d{2}/.test(String(v ?? '')) ? String(v).slice(0, 10) : null);

async function loadSide(client, side, today, queue) {
  const text = side.ingredientsText?.trim();
  const product = text ? null
    : await lookupProduct(client, { gtin: side.gtin ? normaliseGtin(side.gtin) : null, market: side.market });
  const declaration = text || product?.ingredients_raw || null;
  if (!declaration) return null;

  const resolved = await resolveDeclaration(client, declaration, { queue });
  const items = resolved.items.length;
  return {
    market: side.market,
    origin: product ? 'catalogue' : ORIGIN[side.origin] ? side.origin : 'scan',
    source: product ? product.source_name : ORIGIN[side.origin] ?? ORIGIN.scan,
    date: product ? isoDay(product.retrieved_at) : isoDay(side.date) ?? today,
    product: product && { name: product.name, brand: product.brand,
      license: product.license, attribution: product.attribution },
    resolved,
    coverage: items ? (items - resolved.unresolvedItems.length) / items : 0,
  };
}

// `queue: false` is for tests and demos, as in buildVerdict.
export async function compareLabels(client, { a, b, today, queue = true }) {
  const now = today ?? new Date().toISOString().slice(0, 10);
  const [A, B] = [await loadSide(client, a, now, queue), await loadSide(client, b, now, queue)];
  if (!A || !B) {
    return { found: false, code: 'no_text', side: !A ? 'a' : 'b',
      reason: 'no ingredient text for one of the labels', methodVersion: METHOD_VERSION };
  }

  const sameMarket = A.market === B.market;
  const labelA = sameMarket ? 'first label' : `${marketLabel(A.market)} label`;
  const labelB = sameMarket ? 'second label' : `${marketLabel(B.market)} label`;

  const ids = [...new Set([...A.resolved.matched, ...B.resolved.matched].map(m => m.id))];
  const { comp } = await evidenceFor(client, ids);
  const outIngredient = m => {
    const sat = saturatedBound(comp.get(m.id));
    return { slug: m.slug, displayName: m.display_name, kind: m.kind,
      saturated: sat && { low: sat.low, high: sat.high } };
  };
  const anyComposition = ids.map(id => saturatedBound(comp.get(id))).find(Boolean);

  const sideOut = (S, label) => ({
    market: S.market, label,
    origin: S.origin, source: S.source, date: S.date, product: S.product,
    coverage: Number(S.coverage.toFixed(2)),
    items: S.resolved.items.map(it => ({
      position: it.position, text: it.text,
      ingredients: S.resolved.matched.filter(m => m.position === it.position).map(outIngredient),
    })),
    unresolved: S.resolved.unresolved,
  });
  const base = {
    found: true, methodVersion: METHOD_VERSION,
    a: sideOut(A, labelA), b: sideOut(B, labelB),
    sourced: render('cmp.sourced', { sourceA: A.source, dateA: A.date, sourceB: B.source, dateB: B.date }),
    compositionSource: anyComposition
      ? { instrument: anyComposition.instrument, sourceUrl: anyComposition.sourceUrl } : null,
  };

  if (A.coverage < MIN_COMPARE_COVERAGE || B.coverage < MIN_COMPARE_COVERAGE) {
    return { ...base, suppressed: true, suppressionCode: 'coverage',
      unreadableSide: A.coverage < MIN_COMPARE_COVERAGE ? 'a' : 'b',
      headline: null, deltas: [], claims: [], withheld: 0 };
  }

  const { deltas, withheld } = diffLabels(A.resolved, B.resolved);
  const itemText = (S, p) => S.resolved.items.find(i => i.position === p)?.text ?? '';
  const names = (ms, S, p) => joinList(
    [...ms].sort((x, y) => x.rank - y.rank).map(m => m.display_name), connector(itemText(S, p)));

  const outDeltas = deltas.map(d => {
    const claim = d.type === 'substitution'
      ? render('cmp.substitution', { labelA, labelB,
          ingredientsA: names(d.a, A, d.position), ingredientsB: names(d.b, B, d.position) })
      : d.type === 'only_a'
        ? render('cmp.absent', { ingredient: d.a[0].display_name, labelA, labelB })
        : render('cmp.absent', { ingredient: d.b[0].display_name, labelA: labelB, labelB: labelA });
    return { type: d.type, position: d.position,
      a: d.a.map(outIngredient), b: d.b.map(outIngredient), claim };
  });

  if (!outDeltas.length && withheld) {
    // Nothing confirmable, but not provably identical either. Saying "they
    // match" would be false and "they probably match" is a hedge; say nothing.
    return { ...base, suppressed: true, suppressionCode: 'unconfirmed',
      headline: null, deltas: [], claims: [], withheld };
  }

  return {
    ...base,
    suppressed: false,
    headline: outDeltas.length
      ? render('cmp.summary', { labelA, labelB, differences: outDeltas.length })
      : render('cmp.no_difference', { marketA: A.market, marketB: B.market }),
    deltas: outDeltas,
    claims: outDeltas.map(d => d.claim),
    withheld,
  };
}
