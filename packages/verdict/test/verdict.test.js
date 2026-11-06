import test from 'node:test';
import assert from 'node:assert/strict';
import { connect } from '../../db/src/db.js';
import { buildVerdict } from '../src/build.js';
import { scoreProduct } from '../src/score.js';
import { render, regulatoryTemplate, hazardTemplate, FORBIDDEN, templateIds, humanDate } from '../src/templates.js';
import { saturatedBound } from '../src/evidence.js';

const client = await connect();
test.after(() => client.end());

// A fixture is not a scan: every verdict here is built with queue: false, so
// none of them reaches the content lead's work queue. The queue's own test,
// which builds one verdict the way POST /v1/verdict does, rolls back.
const BROMATED = 'Enriched Flour, Water, Potassium Bromate, Calcium Propionate, Salt.';
const LAYS_IN = 'Potato, Edible Vegetable Oil (Palmolein Oil), Salt, Spices & Condiments.';

test('a barcode miss still yields a real verdict from OCR text', async () => {
  const v = await buildVerdict(client, { gtin: '8901234567890', market: 'IN', ingredientsText: BROMATED, queue: false });
  assert.equal(v.found, true);
  assert.equal(v.resolvedFrom, 'ocr');
  assert.ok(v.ingredients.some(i => i.slug === 'potassium-bromate'));
});

test('no barcode and no OCR text is an honest miss, not an empty verdict', async () => {
  const v = await buildVerdict(client, { gtin: '9999999999999', market: 'IN', queue: false });
  assert.equal(v.found, false);
  assert.match(v.reason, /no ingredient text/);
});

test('supplied OCR text overrides a stale catalogue declaration', async () => {
  const v = await buildVerdict(client, {
    gtin: '3017620422003', market: 'FR', ingredientsText: BROMATED, queue: false });
  assert.equal(v.resolvedFrom, 'ocr');
  assert.ok(v.ingredients.some(i => i.slug === 'potassium-bromate'));
});

test('a ban not yet in force is reported as pending, never as in force', async () => {
  const v = await buildVerdict(client, { market: 'US', ingredientsText: BROMATED, today: '2026-09-01', queue: false });
  const ca = v.ingredients.find(i => i.slug === 'potassium-bromate')
    .regulatory.find(r => r.jurisdiction === 'US-CA');
  assert.equal(ca.pending, true);
  const claim = v.claims.find(c => c.jurisdiction === 'US-CA');
  assert.equal(claim.templateId, 'reg.pending');
  assert.match(claim.text, /remains permitted until then/);
});

test('the same ban after its effective date is reported as in force', () => {
  assert.equal(regulatoryTemplate('banned', '2027-01-01', '2026-09-01'), 'reg.pending');
  assert.equal(regulatoryTemplate('banned', '2027-01-01', '2027-06-01'), 'reg.banned');
  assert.equal(regulatoryTemplate('permitted', null), null);
});

// regression: the score read 100 for a product full of additives we simply had
// not researched, which a user reads as "this is fine"
test('a score is withheld when evidence covers too little of the label', () => {
  const s = scoreProduct({ market: 'IN', unresolvedCount: 0, ingredients: [
    { displayName: 'Sugar', kind: 'base', regulatory: [], hazards: [] },
    { displayName: 'Palm Oil', kind: 'oil_fat', regulatory: [], hazards: [] },
    { displayName: 'Lecithin', kind: 'emulsifier', regulatory: [], hazards: [] },
  ]});
  assert.equal(s.score, null);
  assert.equal(s.suppressed, true);
  assert.match(s.suppressionReason, /evidence covers only 0 of 2/);
});

test('base foods do not count against evidence coverage', () => {
  const s = scoreProduct({ market: 'IN', unresolvedCount: 0, ingredients: [
    { displayName: 'Sugar', kind: 'base', regulatory: [], hazards: [] },
    { displayName: 'Salt',  kind: 'base', regulatory: [], hazards: [] },
    { displayName: 'Tartrazine', kind: 'colour',
      regulatory: [{ jurisdiction: 'EU', status: 'warning_required' }], hazards: [] },
  ]});
  assert.equal(s.evidenceCoverage, 1);
  assert.equal(s.score, 95);
});

test('a home-market ban costs more than the same ban abroad', () => {
  const row = m => scoreProduct({ market: m, unresolvedCount: 0, ingredients: [
    { displayName: 'X', kind: 'colour', hazards: [],
      regulatory: [{ jurisdiction: 'IN', status: 'banned' }] }]});
  assert.ok(row('IN').deducted > row('US').deducted);
});

test('tier D evidence never moves the score', () => {
  const s = scoreProduct({ market: 'IN', unresolvedCount: 0, ingredients: [
    { displayName: 'X', kind: 'colour', regulatory: [],
      hazards: [{ grade: 'D', body: 'blog', endpoint: 'x' }] }]});
  assert.equal(s.deducted, 0);
});

test('a mostly unreadable label is not scored at all', () => {
  const s = scoreProduct({ market: 'IN', unresolvedCount: 9, ingredients: [
    { displayName: 'Tartrazine', kind: 'colour', hazards: [],
      regulatory: [{ jurisdiction: 'IN', status: 'banned' }] }]});
  assert.equal(s.score, null);
  assert.match(s.suppressionReason, /1 of 10 declared items/);
});

test('every template refuses forbidden words in our own voice', () => {
  assert.throws(() => render('reg.banned', {
    ingredient: 'X causes cancer', jurisdiction: 'EU', instrument: 'i', date: null }),
    /forbidden term/);
});

// regression: the guard blocked quoting Prop 65's own statutory wording
test('a verbatim regulator quotation is exempt from the voice guard', () => {
  const verbatim = 'known to the State of California to cause cancer';
  const c = render('hazard.listing', { ingredient: 'Potassium Bromate', finding: verbatim },
    { verbatim: [verbatim] });
  assert.match(c.text, /Proposition 65/);
  assert.equal(hazardTemplate('OEHHA'), 'hazard.listing');
  assert.equal(hazardTemplate('IARC'), 'hazard.classification');
});

test('no claim rendered from real data contains a forbidden word in our voice', async () => {
  const v = await buildVerdict(client, { market: 'US', ingredientsText: BROMATED, queue: false });
  for (const c of v.claims) {
    const scaffold = c.text.toLowerCase()
      .replace(/known to the state of california to cause cancer/g, '');
    for (const w of FORBIDDEN) assert.ok(!scaffold.includes(w), `"${w}" in: ${c.text}`);
  }
  assert.ok(v.claims.length > 0);
});

test('every template id is reachable and documented', () => {
  const ids = templateIds();
  for (const id of ['reg.banned','reg.pending','reg.warning','reg.restricted',
                    'hazard.classification','hazard.listing', 'composition.saturated',
                    'headline.acted', 'headline.listed', 'headline.unreadable', 'headline.unchecked',
                    'headline.clear', 'cmp.substitution', 'cmp.absent', 'cmp.no_difference',
                    'cmp.summary', 'cmp.sourced',
                    'check.eu.authorised', 'check.eu.limited', 'check.eu.no_food_use', 'check.eu.delisted',
                    'check.eu.not_found', 'check.fda.prohibited', 'check.fda.regulated', 'check.fda.contact_only',
                    'check.fda.flavouring', 'check.fda.inventory', 'check.fda.not_found', 'check.iarc.classified',
                    'check.iarc.not_found', 'check.prop65.listed', 'check.prop65.not_found', 'note.sources',
                    'check.fssai.standard', 'check.fssai.not_found', 'check.codex.standard',
                    'check.codex.not_found', 'context.process_contaminants']) {
    assert.ok(ids.includes(id), `${id} missing`);
  }
});

test('layer 1 attribution travels with every catalogue verdict', async () => {
  const v = await buildVerdict(client, { gtin: '3017620422003', market: 'FR', queue: false });
  assert.equal(v.product.license, 'ODbL-1.0');
  assert.match(v.product.attribution, /Open Food Facts/);
});

// regression: claim text printed ISO dates ("effective 2027-01-01") and began
// "the United States has adopted…" with a lowercase article
test('dates read as people write them, and sentences start with a capital', () => {
  assert.equal(humanDate('2027-01-01'), '1 January 2027');
  assert.equal(humanDate('2022-08-07'), '7 August 2022');
  const c = render('reg.pending', {
    ingredient: 'Erythrosine', jurisdiction: 'US', instrument: 'FDA order', date: '2027-01-15' });
  assert.equal(c.text,
    'The United States has adopted a ban on Erythrosine taking effect 15 January 2027. It remains permitted until then.');
  assert.equal(c.citation, 'FDA order');
});

test('a claim keeps its instrument, as a citation separate from the finding', async () => {
  const v = await buildVerdict(client, { market: 'US', ingredientsText: BROMATED, today: '2026-09-01', queue: false });
  const eu = v.claims.find(c => c.templateId === 'reg.banned' || (c.kind === 'regulatory' && c.jurisdiction === 'EU'));
  assert.ok(eu.citation && /1333\/2008/.test(eu.citation), 'the instrument travels with the claim');
  assert.ok(!eu.text.includes('('), 'the finding is not interrupted by the legal reference');
  for (const c of v.claims) assert.ok(c.citation, `every claim is cited: ${c.text}`);
});

test('the headline states the finding, not a product name', async () => {
  const bread = await buildVerdict(client, { market: 'US', ingredientsText: BROMATED, today: '2026-09-01', queue: false });
  assert.equal(bread.headline.templateId, 'headline.acted');
  assert.match(bread.headline.text, /^Three authorities have acted on Potassium Bromate\.$/);

  const lays = await buildVerdict(client, { market: 'IN', ingredientsText: LAYS_IN, queue: false });
  assert.equal(lays.headline.templateId, 'headline.clear', 'palmolein has FSSAI and Codex standards');

  const flavoured = await buildVerdict(client, { market: 'IN', ingredientsText: 'Potato, Salt, Natural Flavouring.', queue: false });
  assert.equal(flavoured.headline.templateId, 'headline.unchecked');
  // regression: "hasn't checked" became false once every ingredient was checked
  // against the mirrored lists; what is missing is an entry on any of them
  assert.equal(flavoured.headline.text, 'The official lists Verso checks have no entry for Natural Flavouring.');
});

// regression: palmolein rendered exactly like salt — no claim, no chip, nothing
test('palmolein carries a cited composition range, and it never touches the score', async () => {
  const v = await buildVerdict(client, { market: 'IN', ingredientsText: LAYS_IN, queue: false });
  const palm = v.ingredients.find(i => i.slug === 'palmolein');
  assert.deepEqual([palm.composition.saturated.low, palm.composition.saturated.high], [42, 52]);
  const claim = v.claims.find(c => c.kind === 'composition' && c.ingredient === 'palmolein');
  assert.match(claim.text, /add up to 42–52% of its fatty acids/);
  assert.match(claim.citation, /CODEX STAN 210-1999/);
  // composition is context: nothing is deducted for it, and on its own it is
  // not evidence coverage. Palmolein counts as checked through its standards.
  assert.ok(!v.hazard.items.some(it => it.ingredient === 'Palmolein'));
  assert.ok(palm.listed && palm.checks.some(c => c.status === 'standard'));
  const profileOnly = { ...palm, checks: [], listed: false };
  assert.equal(scoreProduct({ ingredients: [profileOnly], market: 'IN' }).suppressionCode, 'evidence_coverage');
});

test('a saturated-fat bound is the sum of the standard ranges, rounded outward', () => {
  const rows = [
    { component: 'C16:0', low: 38.0, high: 43.5, basis: '%' },
    { component: 'C18:0', low: 3.5, high: 5.0, basis: '%' },
    { component: 'C18:1', low: 39.8, high: 46.0, basis: '%' },   // unsaturated: ignored
  ];
  assert.deepEqual([saturatedBound(rows).low, saturatedBound(rows).high], [41, 49]);
  assert.equal(saturatedBound([{ component: 'C12:0', low: 60, high: 70 }, { component: 'C14:0', low: 20, high: 40 }]).high, 100);
  assert.equal(saturatedBound([]), null);
});

test('per-ingredient deductions add up to the score exactly', () => {
  const s = scoreProduct({ market: 'IN', unresolvedCount: 0, ingredients: [
    { displayName: 'Bromate', kind: 'flour_treatment', hazards: [{ grade: 'A', body: 'OEHHA', endpoint: 'c' }, { grade: 'B', body: 'IARC', endpoint: 'c' }],
      regulatory: [{ jurisdiction: 'IN', status: 'banned' }, { jurisdiction: 'EU', status: 'not_authorised' }] },
    { displayName: 'Tartrazine', kind: 'colour', hazards: [],
      regulatory: [{ jurisdiction: 'EU', status: 'warning_required' }] },
  ]});
  assert.equal(s.byIngredient.reduce((a, b) => a + b.points, 0), s.deducted);
  assert.equal(s.byIngredient[0].points, 30);
  assert.equal(s.byIngredient[0].uncapped, 53);
  assert.equal(s.score, 100 - s.deducted);
});

test('headline and composition templates keep to the voice rules', () => {
  const samples = [
    render('headline.acted', { places: 1, ingredients: ['Tartrazine'] }),
    render('headline.acted', { places: 4, ingredients: ['A', 'B'] }),
    render('headline.listed', { ingredients: ['BHA'] }),
    render('headline.unreadable', { resolved: 0, declared: 6 }),
    render('headline.unchecked', { ingredients: ['Sodium Benzoate', 'TBHQ', 'MSG'] }),
    render('headline.clear', { checked: 3, all: false }),
    render('composition.saturated', { ingredient: 'Palmolein', low: 42, high: 52, instrument: 'Codex' }),
  ];
  assert.equal(samples[0].text, 'One authority has acted on Tartrazine.');
  assert.equal(samples[1].text, 'Four authorities have acted on two ingredients here.');
  assert.equal(samples[3].text, "Verso couldn't identify any of the six items on this label.");
  for (const c of samples) for (const w of FORBIDDEN) assert.ok(!c.text.toLowerCase().includes(w), `"${w}" in ${c.text}`);
});

test('a barcode miss says which miss it was', async () => {
  const miss = await buildVerdict(client, { gtin: '9999999999999', market: 'IN', queue: false });
  assert.equal(miss.code, 'not_in_catalogue');
});

// regression: "palm kernel oil" was a synonym of palm oil. Harmless until
// composition data arrived — then a lauric fat printed palm oil's fat profile.
test('palm kernel oil is its own fat, with its own composition', async () => {
  const v = await buildVerdict(client, { market: 'FR', ingredientsText: 'Sugar, Palm Kernel Oil, Palm Oil.', queue: false });
  const kernel = v.ingredients.find(i => i.slug === 'palm-kernel-oil');
  const palm = v.ingredients.find(i => i.slug === 'palm-oil');
  assert.ok(kernel && palm, 'both fats resolve, separately');
  assert.ok(kernel.composition.saturated.low >= 70, 'lauric fat: mostly saturated');
  assert.ok(palm.composition.saturated.high < 60);
});

// --- source checks: the mirrored official lists, per ingredient ---

const CHECKED = 'Sugar, Silicon Dioxide, Cyclamate, BHA, Zorbium Extract.';

test('every checked ingredient carries a sourced, dated result from each list', async () => {
  const v = await buildVerdict(client, { market: 'US', ingredientsText: CHECKED, queue: false });
  const si = v.ingredients.find(i => i.slug === 'silicon-dioxide');
  const by = Object.fromEntries(si.checks.map(c => [c.source, c]));
  assert.equal(by['eu-additives'].status, 'authorised');
  assert.match(by['eu-additives'].url, /food-additives\/search\/details\/POL-FAD-/);
  assert.equal(by['fda-substances'].status, 'regulated');
  assert.ok(by['fda-substances'].links.some(l => l.url === 'https://www.ecfr.gov/current/title-21/section-172.480'));
  assert.equal(by.iarc.status, 'classified');
  assert.equal(by.iarc.group, '3');
  assert.equal(by.prop65.status, 'not_found');
  for (const c of si.checks) {
    assert.ok(c.url && c.checkedAt, `${c.source} links and dates its result`);
    assert.match(c.citation, /· checked \d{1,2} [A-Z][a-z]+ \d{4}$/);
  }
  assert.equal(si.hazards.length, 0, 'IARC Group 3, "not classifiable", is shown and never scored');
  assert.match(v.note.text, /^\* Verso does not produce this information\./);
  assert.deepEqual(v.sources.map(x => x.key).sort(), ['eu-additives', 'fda-substances', 'iarc', 'prop65']);
});

test('a Part 189 prohibition is a US ban, scored and claimed like a curated one', async () => {
  const v = await buildVerdict(client, { market: 'US', ingredientsText: CHECKED, queue: false });
  const cyc = v.ingredients.find(i => i.slug === 'cyclamate');
  const ban = cyc.regulatory.find(r => r.fromList === 'fda-substances');
  assert.deepEqual([ban.jurisdiction, ban.status], ['US', 'banned']);
  assert.match(ban.sourceUrl, /section-189\.135$/);
  const claim = v.claims.find(c => c.ingredient === 'cyclamate' && c.kind === 'regulatory');
  assert.equal(claim.text, 'Cyclamate is not permitted in food in the United States.');
  assert.match(claim.citation, /21 CFR 189\.135/);
  assert.ok(v.hazard.items.some(i => i.ingredient === 'Cyclamate' && i.points === 25), 'a home-market ban');
  // the same list says the EU authorises it: the jurisdiction gap, from sources
  assert.equal(cyc.checks.find(c => c.source === 'eu-additives').status, 'authorised');
});

// regression guard: curated IARC and Prop 65 rows exist for BHA; the automatic
// checks from the same bodies must not appear beside them or count twice
test('a curated finding supersedes the automatic check from the same body', async () => {
  const v = await buildVerdict(client, { market: 'US', ingredientsText: CHECKED, queue: false });
  const bha = v.ingredients.find(i => i.slug === 'bha');
  assert.ok(!bha.checks.some(c => c.source === 'iarc' || c.source === 'prop65'));
  assert.equal(bha.hazards.filter(h => h.body === 'IARC').length, 1);
  assert.ok(bha.hazards.every(h => !h.fromList));
});

test('an additive no list has an entry for is not scored on empty lookups', () => {
  const unknown = { displayName: 'E999x', kind: 'colour', regulatory: [], hazards: [], listed: false };
  assert.equal(scoreProduct({ ingredients: [unknown], market: 'US' }).suppressionCode, 'evidence_coverage');
  const known = { ...unknown, listed: true };
  assert.equal(scoreProduct({ ingredients: [known], market: 'US' }).score, 100);
});

test('no source check says anything forbidden in our own voice', async () => {
  const v = await buildVerdict(client, { market: 'IN', ingredientsText: CHECKED, queue: false });
  for (const c of v.ingredients.flatMap(i => i.checks)) {
    const ours = c.text.toLowerCase().replace(/"[^"]*"/g, '').replace(/:[^.]*\./, '.');
    for (const w of FORBIDDEN) assert.ok(!ours.includes(w), `"${w}" in: ${c.text}`);
  }
});

// Two product standards for oils: what an oil must be to be sold under its
// name. Shown and cited, and evidence coverage; never a finding.
const OILS = 'Palmolein, Canola Oil, Butter, Salt, Monosodium Glutamate.';
const standards = (v, slug) => Object.fromEntries(v.ingredients.find(i => i.slug === slug).checks
  .filter(c => c.source === 'fssai-oils' || c.source === 'codex-oils').map(c => [c.source, c]));

test('a named oil is looked up in the FSSAI and Codex standards', async () => {
  const v = await buildVerdict(client, { market: 'IN', ingredientsText: OILS, queue: false });
  const p = standards(v, 'palmolein');
  assert.equal(p['fssai-oils'].text,
    'India\'s food regulator, FSSAI, has a standard that "Palmolein" sold in India must meet (regulation 2.2.1(20)).');
  assert.equal(p['codex-oils'].matchedAs, 'Palm olein');
  for (const c of Object.values(p)) {
    assert.equal(c.status, 'standard');
    assert.match(c.citation, /· checked \d{1,2} [A-Z][a-z]+ \d{4}$/);
  }
  // butter's standard is in another chapter: "no oil standard" would read as
  // "unregulated", so fats that are not oils get no line from these lists
  for (const slug of ['butter', 'salt', 'msg']) assert.deepEqual(standards(v, slug), {}, slug);
  assert.ok(['fssai-oils', 'codex-oils'].every(k => v.sources.some(s => s.key === k)));
});

// regression: canola's names include "rapeseed oil", and the ordinary
// rapeseed and mustard oil standard (2.2.1(6)) was picked for it
test('the most specific standard wins: canola is low erucic acid rapeseed', async () => {
  const v = await buildVerdict(client, { market: 'IN', ingredientsText: OILS, queue: false });
  const c = standards(v, 'canola-oil');
  assert.equal(c['fssai-oils'].matchedAs, 'Rapeseed or mustard oil-low erucic acid');
  assert.equal(c['codex-oils'].matchedAs, 'Rapeseed oil - low erucic acid');
});

// regression: a fried snack's oils all read "no list entry", so its score was
// withheld although every one of them has an FSSAI and a Codex standard
test('an oil standard counts as checked, and never deducts', async () => {
  const snack = 'Bengal Gram Flour, Edible Vegetable Oil (Palmolein, Cottonseed Oil, Corn Oil), Salt, Turmeric.';
  const v = await buildVerdict(client, { market: 'IN', ingredientsText: snack, queue: false });
  const p = v.ingredients.find(i => i.slug === 'palmolein');
  assert.ok(p.checks.every(c => !['eu-additives', 'iarc', 'prop65'].includes(c.source) || c.status === 'not_found'));
  assert.equal(p.listed, true, 'on no hazard list, and standardised in India and by Codex');
  assert.ok(![...p.regulatory, ...p.hazards].some(r => r.fromList === 'fssai-oils' || r.fromList === 'codex-oils'));
  assert.deepEqual(v.hazard.unresearched, []);
  assert.notEqual(v.hazard.suppressionCode, 'evidence_coverage');
  assert.equal(v.hazard.items.length, 0, 'nothing deducted for a standard');
});

// --- the content lead's work queue ---

// POST /v1/verdict builds every scan without `queue`, so its unknown items must
// keep reaching canon.unresolved_term. Rolled back: the probe leaves no trace.
test('a scan queues its unknown items and a fixture does not', async () => {
  const hits = async () => (await client.query(
    `select hit_count from canon.unresolved_term where normalised = 'zorbium extract'`)).rows[0]?.hit_count ?? 0;
  await client.query('begin');
  try {
    const before = await hits();
    await buildVerdict(client, { market: 'US', ingredientsText: CHECKED, queue: false });
    assert.equal(await hits(), before, 'a fixture leaves the queue alone');
    await buildVerdict(client, { market: 'US', ingredientsText: CHECKED });
    assert.equal(await hits(), before + 1, 'a scan is queued');
  } finally {
    await client.query('rollback');
  }
});

// regression: every unknown item was queued before identification ran, and an
// answer from the cache never clears the queue, so each scan put identified
// terms back ("Potato Flakes" reached 6 hits). Rolled back like the test above.
test('a scan queues only what identification leaves unsettled', async () => {
  const hits = async n => (await client.query(
    'select hit_count from canon.unresolved_term where normalised = $1', [n])).rows[0]?.hit_count ?? 0;
  await client.query('begin');
  try {
    await client.query(
      `insert into canon.identification (normalised, term, outcome, ingredient_id, model)
       values ('quizzium gum', 'Quizzium Gum', 'matched', (select id from canon.ingredient where slug = 'sugar'), 'test')`);
    const before = [await hits('quizzium gum'), await hits('zorbium extract')];
    const v = await buildVerdict(client, { market: 'IN', ingredientsText: 'Salt, Quizzium Gum, Zorbium Extract' });
    assert.deepEqual(v.unresolved, ['Zorbium Extract']);
    assert.deepEqual([await hits('quizzium gum'), await hits('zorbium extract')], [before[0], before[1] + 1],
      'the identified term stays out of the queue; the unknown one is queued');
  } finally {
    await client.query('rollback');
  }
});

// --- identification of label terms the canon does not know ---

test('an unknown term is identified, marked as such, and never scored while unverified', async () => {
  const cleanup = async () => {
    await client.query(`delete from canon.identification where normalised like 'verso test%'`);
    await client.query(`delete from canon.ingredient where slug like 'auto-verso-test%'`);
  };
  await cleanup();
  try {
    const calls = [];
    const identify = async terms => {
      calls.push(terms);
      return { model: 'fake', items: terms.map(term => ({ term, name: 'verso test asafoetida', kind: 'food' })) };
    };
    const v = await buildVerdict(client, { market: 'IN', ingredientsText: 'Salt, Verso Test Hingx', queue: false, identify });
    const hing = v.ingredients.find(i => i.identified);
    assert.ok(hing, 'the unknown term joins the ingredients');
    assert.deepEqual([hing.identified.term, hing.identified.verifiedBy, hing.matchConfidence],
      ['Verso Test Hingx', null, 'identified']);
    assert.deepEqual(v.unresolved, [], 'no longer "couldn\'t identify"');
    assert.deepEqual(v.identifying, []);
    assert.ok(!v.hazard.items.some(i => i.ingredient === hing.displayName), 'unverified: nothing scored');

    // the second scan is answered from the cache, and still marked
    const again = await buildVerdict(client, { market: 'IN', ingredientsText: 'Salt, Verso Test Hingx', queue: false, identify });
    assert.equal(calls.length, 1);
    assert.ok(again.ingredients.find(i => i.slug === hing.slug)?.identified, 'still marked on a direct match');
  } finally {
    await cleanup();
  }
});

// --- process contaminants: context, never a finding against the oil ---

test('palm oils carry EFSA\'s contaminant finding, quoted and cited, and it never scores', async () => {
  const v = await buildVerdict(client, { market: 'IN', ingredientsText: 'Potato, Edible Vegetable Oil (Palmolein), Salt', queue: false });
  const palm = v.ingredients.find(i => i.slug === 'palmolein');
  assert.deepEqual(palm.processContaminants.map(p => p.cas).sort(), ['556-52-5', '96-24-2']);
  const ge = palm.processContaminants.find(p => p.cas === '556-52-5');
  assert.match(ge.finding, /^The highest levels of GE, as well as 3-MCPD and 2-MCPD \(including esters\) were found in palm oils and palm fats/);
  assert.match(ge.sourceUrl, /10\.2903\/j\.efsa\.2016\.4426$/);
  assert.match(ge.limit.note, /1 000 μg\/kg/);
  assert.match(ge.limit.sourceUrl, /CELEX:32023R0915$/);
  // every explanatory statement is EFSA's own sentence, not a paraphrase
  assert.ok(ge.quotes.some(q => q.startsWith('The substances form during food processing, in particular, when refining vegetable oils')));
  assert.ok(ge.quotes.some(q => /halved between 2010 and 2015/.test(q)));
  assert.ok(!palm.processContaminants.find(p => p.cas === '96-24-2').quotes.some(q => /halved/.test(q)), 'the GE sentence stays with GE');
  assert.ok(ge.classifications.some(k => k.body === 'IARC' && /Group 2A: Probably carcinogenic to humans/.test(k.text)));
  assert.ok(ge.classifications.some(k => k.body === 'OEHHA' && /since 1 July 1990/.test(k.text)));

  const claim = v.claims.find(c => c.kind === 'context' && c.ingredient === 'palmolein');
  assert.match(claim.text, /^EFSA, the European Food Safety Authority, on contaminants that form when oils such as palmolein are refined: “/);
  for (const w of FORBIDDEN) assert.ok(!claim.text.toLowerCase().replace(/“[^”]*”/, '').includes(w), `"${w}" in our voice`);

  assert.ok(!v.hazard.items.some(i => i.ingredient === 'Palmolein'), 'context is never a deduction');
  assert.equal(palm.hazards.length, 0, 'and never a hazard finding against the oil');
  assert.notEqual(v.headline.templateId, 'headline.listed', 'and never the headline');

  const sun = (await buildVerdict(client, { market: 'IN', ingredientsText: 'Sunflower Oil, Salt', queue: false }))
    .ingredients.find(i => i.slug === 'sunflower-oil');
  assert.deepEqual(sun.processContaminants, [], 'EFSA named palm; other oils are not tagged');
});
