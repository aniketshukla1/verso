// Assembles a product verdict.
//
// THE ODbL BOUNDARY IS HERE. Layer 1 (product) is read in one query, layers 2-3
// (canon, evidence) in another, and the two results are merged in JavaScript.
// They are never joined in SQL and the merged shape is never written back to
// disk. See CLAUDE.md rule 1 and docs/PLAN.md §04.

import { resolveDeclaration, queueUnresolved } from '../../canon/src/resolve.js';
import { identifyTerms } from '../../canon/src/identify.js';
import { productRef, normaliseGtin } from '../../shared/src/product-ref.js';
import { scoreProduct } from './score.js';
import { evidenceFor, saturatedBound } from './evidence.js';
import { render, regulatoryTemplate, hazardTemplate, humanDate, METHOD_VERSION } from './templates.js';
import { sourceChecks, COVERAGE_SOURCES } from './checks.js';
import { IARC_GROUPS } from '../../evidence/src/sources/iarc.js';

// Which official list speaks for which curated row. A curated finding from the
// same body supersedes the automatic check, so the two never disagree on screen.
const LIST_FOR_JURISDICTION = { EU: 'eu-additives', US: 'fda-substances' };
const LIST_FOR_BODY = { IARC: 'iarc', OEHHA: 'prop65' };

// The three list results that are findings (docs/methodology.md, "Source
// checks"), as rows shaped like curated ones so the score, the headline and
// the screen treat them alike. Everything else a check says is shown, not scored.
function listFinding(check) {
  if (check.source === 'fda-substances' && check.status === 'prohibited') {
    return { kind: 'regulatory', row: {
      jurisdiction: 'US', status: 'banned', scope: 'all_food', note: null, effectiveFrom: null, pending: false,
      // the regulation is the instrument; the inventory is only where Verso found it
      instrument: `${(check.links ?? []).map(l => l.label).join(', ')} · ${check.citation}`,
      sourceUrl: check.links?.[0]?.url ?? check.url, citationId: null, fromList: check.source } };
  }
  if (check.source === 'iarc' && check.status === 'classified' && ['1', '2A', '2B'].includes(check.group)) {
    return { kind: 'hazard', row: {
      body: 'IARC', endpoint: 'carcinogenicity', grade: 'B',
      finding: `Group ${check.group} — ${IARC_GROUPS[check.group].toLowerCase()}`,
      instrument: check.citation, sourceUrl: check.url, citationId: null, fromList: check.source } };
  }
  if (check.source === 'prop65' && check.status === 'listed') {
    const cancer = check.listings.some(l => /cancer/i.test(l.toxicity));
    const repro = check.listings.some(l => /developmental|female|male/i.test(l.toxicity));
    // the list's own title: "chemicals known to the State to cause cancer or reproductive toxicity"
    const finding = `known to the State of California to cause ${[cancer && 'cancer', repro && 'reproductive toxicity'].filter(Boolean).join(' and ')}`;
    return { kind: 'hazard', row: {
      body: 'OEHHA', endpoint: [cancer && 'cancer', repro && 'reproductive toxicity'].filter(Boolean).join(', '), grade: 'A',
      finding, instrument: check.citation, sourceUrl: check.url, citationId: null, fromList: check.source } };
  }
  return null;
}

// --- layer 1, on its own ---
export async function lookupProduct(client, { gtin, market }) {
  if (!gtin) return null;
  const { rows } = await client.query(
    `select p.gtin, p.brand, p.name, p.market, p.ingredients_raw, p.retrieved_at,
            s.name as source_name, s.attribution, s.license
     from product.product p join product.source s on s.id = p.source_id
     where p.gtin = $1 and ($2::text is null or p.market = $2)
     order by (p.market = $2) desc nulls last, p.retrieved_at desc
     limit 1`, [gtin, market ?? null]);
  return rows[0] ?? null;
}

// Most severe first, so "What the record says" opens with what matters most.
// Ingredient order is kept within a rank (Array.prototype.sort is stable).
const CLAIM_ORDER = {
  'reg.banned': 0, 'reg.pending': 1, 'reg.warning': 2, 'reg.restricted': 3,
  'hazard.listing': 4, 'hazard.classification': 5, 'composition.saturated': 7,
  'context.process_contaminants': 8,
};
const claimRank = c => (c.templateId === 'hazard.classification' && c.grade === 'C' ? 6 : CLAIM_ORDER[c.templateId] ?? 9);

// The headline states the single most decision-relevant finding. Deterministic
// and template-rendered like every other published sentence.
function chooseHeadline(ingredients, scored) {
  const acted = ingredients.filter(i => i.regulatory.some(r => r.status !== 'permitted'));
  if (acted.length) {
    const places = new Set(acted.flatMap(i =>
      i.regulatory.filter(r => r.status !== 'permitted').map(r => r.jurisdiction)));
    return render('headline.acted', { places: places.size, ingredients: acted.map(i => i.displayName) });
  }
  // Grade C and D findings never headline: IARC Group 3 is "not classifiable",
  // and leading with it would upgrade a non-finding into a warning.
  const listed = ingredients.filter(i => i.hazards.some(h => h.grade === 'A' || h.grade === 'B'));
  if (listed.length) return render('headline.listed', { ingredients: listed.map(i => i.displayName) });

  if (scored.suppressionCode === 'label_coverage') {
    return render('headline.unreadable', { resolved: scored.resolvedCount, declared: scored.declaredCount });
  }
  if (scored.suppressionCode === 'evidence_coverage') {
    return render('headline.unchecked', { ingredients: scored.unresearched });
  }
  return render('headline.clear', {
    checked: scored.researchedCount, all: scored.unresearched.length === 0 });
}

// Everything Verso can say about these canon ingredients: curated evidence,
// the official-list checks, and the claims both render to. Shared by a verdict
// and the ingredient endpoint, so both explain an ingredient identically.
export async function describeIngredients(client, matched, { now = new Date().toISOString().slice(0, 10) } = {}) {
  const { reg, haz, comp, pc } = await evidenceFor(client, matched.map(m => m.id));
  const { checks, sources } = await sourceChecks(client, matched);
  const contaminantLists = await contaminantClassifications(client, [...pc.values()].flat().map(r => r.contaminant_cas));

  const claims = [];
  const ingredients = matched.map(m => {
    const regulatory = (reg.get(m.id) ?? []).map(r => {
      const pending = !!r.effective_from && r.effective_from > now;
      const tid = regulatoryTemplate(r.status, r.effective_from, now);
      if (tid) {
        claims.push({
          ...render(tid, {
            ingredient: m.display_name, jurisdiction: r.jurisdiction,
            instrument: r.instrument, date: r.effective_from,
            warningText: r.limit_note, scope: r.scope?.replace(/_/g, ' '),
          }, { verbatim: [r.limit_note] }),
          kind: 'regulatory', status: r.status, pending, jurisdiction: r.jurisdiction,
          effectiveFrom: r.effective_from,
          ingredient: m.slug, ingredientName: m.display_name,
          citationId: r.citation_id, sourceUrl: r.url,
        });
      }
      return { jurisdiction: r.jurisdiction, status: r.status, scope: r.scope,
        note: r.limit_note, effectiveFrom: r.effective_from, pending,
        instrument: r.instrument, sourceUrl: r.url, citationId: r.citation_id };
    });

    const hazards = (haz.get(m.id) ?? []).map(h => {
      claims.push({
        ...render(hazardTemplate(h.body),
          { body: h.body, ingredient: m.display_name, finding: h.finding, instrument: h.instrument },
          { verbatim: [h.finding] }),
        kind: 'hazard', body: h.body, grade: h.grade,
        ingredient: m.slug, ingredientName: m.display_name,
        citationId: h.citation_id, sourceUrl: h.url,
      });
      return { body: h.body, endpoint: h.endpoint, finding: h.finding,
        grade: h.grade, instrument: h.instrument, sourceUrl: h.url, citationId: h.citation_id };
    });

    // Composition is context, not a finding against the ingredient: it is
    // shown, cited, and deliberately NOT passed to the score below.
    const saturated = saturatedBound(comp.get(m.id));
    if (saturated) {
      claims.push({
        ...render('composition.saturated', {
          ingredient: m.display_name, low: saturated.low, high: saturated.high,
          instrument: saturated.instrument }),
        kind: 'composition',
        ingredient: m.slug, ingredientName: m.display_name,
        citationId: saturated.citationId, sourceUrl: saturated.sourceUrl,
      });
    }

    // Contaminants that refining forms in this ingredient: EFSA's finding, the
    // EU limit and the contaminants' own IARC and Prop 65 entries. Context only:
    // nothing here reaches the score, the headline or evidence coverage.
    const contaminants = (pc.get(m.id) ?? []).map(r => ({
      contaminant: r.contaminant, cas: r.contaminant_cas, finding: r.finding,
      // further sentences from the same source, verbatim: every statement the app
      // makes about the contaminant is one of these or the finding itself
      quotes: r.context_quotes ?? [],
      instrument: r.instrument, sourceUrl: r.url,
      limit: { note: r.limit_note, instrument: r.limit_instrument, sourceUrl: r.limit_url },
      classifications: contaminantLists.get(r.contaminant_cas) ?? [],
    }));
    for (const finding of new Set(contaminants.map(c => c.finding))) {
      const c = contaminants.find(x => x.finding === finding);
      claims.push({
        ...render('context.process_contaminants', { ingredient: m.display_name, finding, instrument: c.instrument },
          { verbatim: [finding] }),
        kind: 'context', ingredient: m.slug, ingredientName: m.display_name, citationId: null, sourceUrl: c.sourceUrl,
      });
    }

    const all = checks.get(m.id) ?? [];
    const curatedFrom = new Set([
      ...regulatory.filter(r => r.status !== 'permitted').map(r => LIST_FOR_JURISDICTION[r.jurisdiction]),
      ...hazards.map(h => LIST_FOR_BODY[h.body]),
    ]);
    const shown = all.filter(c => !curatedFrom.has(c.source));
    // Named by a model and confirmed by nothing: its checks are shown, and none
    // of them becomes a finding (docs/methodology.md, "Identifying unknown label terms").
    const unverified = !!m.identified && !m.identified.verifiedBy;
    for (const c of shown) {
      const f = unverified ? null : listFinding(c);
      if (!f) continue;
      const common = { ingredient: m.slug, ingredientName: m.display_name, citationId: null, sourceUrl: f.row.sourceUrl, fromList: c.source };
      if (f.kind === 'regulatory') {
        regulatory.push(f.row);
        claims.push({ ...render('reg.banned', { ingredient: m.display_name, jurisdiction: 'US', instrument: f.row.instrument, date: null }),
          kind: 'regulatory', status: 'banned', pending: false, jurisdiction: 'US', effectiveFrom: null, ...common });
      } else {
        hazards.push(f.row);
        claims.push({ ...render(hazardTemplate(f.row.body),
          { body: f.row.body, ingredient: m.display_name, finding: f.row.finding, instrument: f.row.instrument },
          { verbatim: [f.row.finding] }),
          kind: 'hazard', body: f.row.body, grade: f.row.grade, ...common });
      }
    }

    return { slug: m.slug, displayName: m.display_name, eNumber: m.e_number,
      kind: m.kind, rank: m.rank, position: m.position, matchConfidence: m.confidence,
      regulatory, hazards, composition: saturated ? { saturated } : null,
      processContaminants: contaminants,
      checks: shown,
      identified: m.identified ?? null,
      // found on at least one official list: something a regulator has looked at
      listed: !unverified && all.some(c => COVERAGE_SOURCES.has(c.source) && c.status !== 'not_found') };
  });

  return {
    ingredients,
    claims: claims.sort((x, y) => claimRank(x) - claimRank(y)),
    // the lists behind every check, and the footnote that goes under them;
    // dated by the least recently checked list, so it never overstates freshness
    sources,
    note: sources.length ? render('note.sources', { checked: sources.map(x => x.checkedAt).sort()[0] }) : null,
  };
}

// The IARC and Prop 65 entries for contaminants, by CAS number, from the daily
// mirror: rendered with the same templates as an ingredient's own checks.
async function contaminantClassifications(client, casNumbers) {
  const out = new Map();
  const cas = [...new Set(casNumbers)];
  if (!cas.length) return out;
  const { rows } = await client.query(
    `select r.source_key, r.name, r.cas, r.url, r.payload, s.retrieved_at
     from evidence.source_record r
     join lateral (select retrieved_at from evidence.source_snapshot
                   where source_key = r.source_key order by id desc limit 1) s on true
     where r.removed_in is null and r.source_key in ('iarc', 'prop65') and r.cas && $1::text[]`, [cas]);
  for (const r of rows) {
    const checked = new Date(r.retrieved_at).toISOString();
    const rendered = r.source_key === 'iarc'
      ? (r.payload.group && render('check.iarc.classified', { agent: r.name, group: r.payload.group,
          groupText: IARC_GROUPS[r.payload.group], instrument: 'IARC Monographs, List of Classifications', checked },
          { verbatim: [r.name, IARC_GROUPS[r.payload.group]] }))
      : render('check.prop65.listed', { agent: r.name,
          listings: `${r.payload.toxicity}, since ${humanDate(r.payload.listed) ?? r.payload.listed}`,
          instrument: 'Proposition 65 List, OEHHA', checked }, { verbatim: [r.name, r.payload.toxicity] });
    if (!rendered) continue;
    for (const c of r.cas.filter(x => cas.includes(x))) {
      out.set(c, [...(out.get(c) ?? []), { body: r.source_key === 'iarc' ? 'IARC' : 'OEHHA', url: r.url, ...rendered }]);
    }
  }
  return out;
}

// Canon rows for the terms identifyTerms named, placed where the label put them.
async function identifiedIngredients(client, identified, matched) {
  if (!identified.length) return [];
  const { rows } = await client.query(
    'select id, slug, display_name, e_number, kind, origin, verified from canon.ingredient where id = any($1)',
    [[...new Set(identified.map(i => i.row.ingredient_id))]]);
  const byId = new Map(rows.map(r => [r.id, r]));
  const have = new Set(matched.map(m => m.id));
  const out = [];
  for (const it of identified) {
    const r = byId.get(it.row.ingredient_id);
    if (!r || have.has(r.id)) continue;
    have.add(r.id);
    out.push({ ...r, term: it.text, confidence: 'identified', rank: 0, position: it.position,
      identified: { term: it.text, name: it.row.name, verifiedBy: it.row.verified_by, model: it.row.model } });
  }
  return out;
}

// An ingredient created by identification stays marked however it is matched
// later. Its English name is a synonym, so the next scan's resolver finds
// "Nutmeg" directly, and without this it would lose its "identified
// automatically" label and, if unverified, be scored.
async function markAutomatic(client, matched) {
  const ids = matched.filter(m => !m.identified).map(m => m.id);
  if (!ids.length) return matched;
  const { rows } = await client.query(
    `select i.id, i.verified,
            (select d.name from canon.identification d where d.ingredient_id = i.id
             order by d.identified_at desc limit 1) as name,
            (select d.verified_by from canon.identification d where d.ingredient_id = i.id
             order by d.identified_at desc limit 1) as verified_by,
            (select d.model from canon.identification d where d.ingredient_id = i.id
             order by d.identified_at desc limit 1) as model
     from canon.ingredient i where i.id = any($1) and i.origin = 'auto'`, [ids]);
  const auto = new Map(rows.map(r => [r.id, r]));
  return matched.map(m => {
    const a = auto.get(m.id);
    return a ? { ...m, identified: { term: m.term, name: a.name, verifiedBy: a.verified_by ?? (a.verified ? 'cas' : null), model: a.model } } : m;
  });
}

// `identify` names label terms the canon does not know (services/api passes
// the configured model; tests and tools pass nothing, and stay deterministic).
// `queue: false` keeps unresolved items out of the content lead's work queue:
// for tests and demos. POST /v1/verdict never passes it; every real scan queues
// what neither the canon nor identification could settle.
export async function buildVerdict(client, { gtin, market, ingredientsText, today, queue = true, identify }) {
  const now = today ?? new Date().toISOString().slice(0, 10);
  const normGtin = gtin ? normaliseGtin(gtin) : null;

  const product = await lookupProduct(client, { gtin: normGtin, market });

  // The graceful-miss path is the common case outside the EU and US: caller
  // supplied OCR text, we never found the barcode, and the answer must still
  // be real. Supplied text always wins over a stored declaration.
  const declaration = ingredientsText?.trim() || product?.ingredients_raw || null;
  const resolvedFrom = ingredientsText?.trim() ? 'ocr' : product ? 'catalogue' : null;

  if (!declaration) {
    // `code` is for the app to choose the right screen: a barcode we do not
    // know and an empty request need different next steps, not one message.
    return { found: false, productRef: null, resolvedFrom: null,
      code: normGtin ? 'not_in_catalogue' : 'no_text',
      reason: 'no ingredient text: barcode not in catalogue and no OCR text supplied',
      methodVersion: METHOD_VERSION };
  }

  // Not queued yet: a term identification settles is not a gap. Queueing here,
  // before identification, put every identified term back in the queue on each
  // later scan, because an answer from the cache never clears the queue.
  const found = await resolveDeclaration(client, declaration, { queue: false });
  // Terms the canon does not know: answered from canon.identification, or named
  // by a model and checked against trusted identifiers (canon/src/identify.js).
  // The verdict waits a few seconds at most; a slower lookup lands in the cache
  // and `identifying` tells the app to ask again.
  const idr = await identifyTerms(client, found.unresolvedItems, { identify, market, budgetMs: 6_000 });
  const settled = new Set([...idr.identified, ...idr.notIngredient].map(i => i.text));
  const unresolved = found.unresolved.filter(t => !settled.has(t));
  // Straight away, not after the slower work below: a lookup still running in
  // the background deletes its term from the queue when it lands, and must find
  // the row already there.
  if (queue) for (const t of unresolved) await queueUnresolved(client, t);
  const extra = await identifiedIngredients(client, idr.identified, found.matched);
  const matched = (await markAutomatic(client, [...found.matched, ...extra]))
    .sort((a, b) => a.position - b.position || a.rank - b.rank)
    .map((m, rank) => ({ ...m, rank }));
  const { ingredients, claims, sources, note } = await describeIngredients(client, matched, { now });

  const scored = scoreProduct({
    ingredients: ingredients.map(i => ({
      displayName: i.displayName,
      kind: i.kind,
      regulatory: i.regulatory.map(r => ({ ...r, citationId: r.citationId })),
      hazards: i.hazards,
      listed: i.listed,
    })),
    unresolvedCount: unresolved.length,
    market,
  });

  return {
    found: true,
    productRef: product
      ? productRef({ gtin: product.gtin, market: product.market })
      : normGtin && market ? productRef({ gtin: normGtin, market }) : null,
    resolvedFrom,
    market,
    headline: chooseHeadline(ingredients, scored),
    // layer 1 stays clearly labelled and separately attributed
    product: product && {
      name: product.name, brand: product.brand, market: product.market,
      source: product.source_name, license: product.license,
      attribution: product.attribution, retrievedAt: product.retrieved_at,
    },
    ingredients,
    unresolved,
    // still being looked up when the verdict was built; asking again shortly finds them
    identifying: idr.pending,
    claims,
    hazard: scored,
    sources,
    note,
    methodVersion: METHOD_VERSION,
  };
}
