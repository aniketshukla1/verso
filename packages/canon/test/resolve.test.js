import test from 'node:test';
import assert from 'node:assert/strict';
import { connect } from '../../db/src/db.js';
import { resolveTerm, resolveDeclaration, clearResolved } from '../src/resolve.js';
import { normalise } from '../../shared/src/normalise.js';

const client = await connect();
test.after(() => client.end());

// A fixture is not a scan: every declaration here is resolved with
// { queue: false }, so none of them reaches the content lead's work queue.
const US = 'Potatoes, Vegetable Oil (Sunflower, Corn, and/or Canola Oil), Salt.';
const IN = 'Potato, Edible Vegetable Oil (Palmolein Oil), Salt, Spices & Condiments.';

test('E numbers, INS numbers and trade names reach the same ingredient', async () => {
  const forms = ['E102', 'E 102', 'INS 102', 'Tartrazine', 'FD&C Yellow No. 5', 'CI 19140'];
  const ids = [];
  for (const f of forms) {
    const hit = await resolveTerm(client, f);
    assert.ok(hit, `${f} should resolve`);
    ids.push(hit.id);
  }
  assert.equal(new Set(ids).size, 1, 'all forms are one ingredient');
});

// regression: this is the claim the whole comparison feature rests on
test('palmolein resolves to palmolein, not to palm oil', async () => {
  const hit = await resolveTerm(client, 'Palmolein Oil');
  assert.equal(hit.slug, 'palmolein');
});

// regression: a generic carrier phrase fuzzy-matched "edible vegetable oil (palm)"
// and invented palm oil on a label that never said it
test('a generic carrier phrase does not invent a specific fat', async () => {
  const hit = await resolveTerm(client, 'Edible Vegetable Oil');
  assert.equal(hit, null, 'must not resolve to palm oil or any other specific fat');
});

test('misspellings still resolve when the word stands alone', async () => {
  const hit = await resolveTerm(client, 'carageenan');
  assert.ok(hit && hit.slug === 'carrageenan');
});

test('the cross-market delta is exactly the true difference', async () => {
  const us = await resolveDeclaration(client, US, { queue: false });
  const ind = await resolveDeclaration(client, IN, { queue: false });
  const usSlugs = new Set(us.matched.map(r => r.slug));
  const inSlugs = new Set(ind.matched.map(r => r.slug));

  // the fat swap is the whole delta; 'spices' differs only because the India
  // label declares one and the US label does not
  assert.deepEqual([...inSlugs].filter(s => !usSlugs.has(s)).sort(), ['palmolein', 'spices']);
  assert.deepEqual([...usSlugs].filter(s => !inSlugs.has(s)).sort(),
    ['canola-oil', 'corn-oil', 'sunflower-oil']);
  assert.ok(!usSlugs.has('palm-oil') && !usSlugs.has('palmolein'), 'no palm fat on the US label');
  // regression: "Corn Oil" must not also report the grain
  assert.ok(!usSlugs.has('maize'), 'a bare fragment of a matched phrase is not a second ingredient');
});

test('only genuinely unknown declaration items reach the work queue', async () => {
  const { unresolved } = await resolveDeclaration(client, US, { queue: false });
  assert.deepEqual(unresolved, [], 'the whole US label now resolves');
  const { unresolved: gaps } = await resolveDeclaration(client,
    'Potatoes, Zorbium Extract, Salt', { queue: false });
  assert.deepEqual(gaps, ['Zorbium Extract'], 'genuine unknowns still surface');
});

// regression: the seasoning list was one item, so Sugar matched and six unknown
// components vanished from both the verdict and the work queue
test('a listed compound ingredient is resolved component by component', async () => {
  const raw = 'NUTRITION INFORMATION (per 100 g) Energy (kcal) 488 INGREDIENTS: Makhana (Fox Nuts - 70%), '
    + 'Edible Vegetable Oil (Sunflower), Seasoning [Maltodextrin, Sugar, Himalayan Salt (1.4%), Black Salt, '
    + 'Spices & Condiments, Tomato Powder, Anticaking Agent (INS 551), Zorbium Extract]. CONTAINS: SULPHITE. '
    + 'MANUFACTURED BY: Alimento Agro Foods Pvt. Ltd., Kota';
  const { matched, unresolved, items } = await resolveDeclaration(client, raw, { queue: false });
  const slugs = matched.map(m => m.slug);
  for (const s of ['makhana', 'sunflower-oil', 'maltodextrin', 'sugar', 'salt', 'black-salt', 'spices', 'silicon-dioxide']) {
    assert.ok(slugs.includes(s), `${s} resolves`);
  }
  assert.deepEqual(unresolved, ['Zorbium Extract'], 'an unknown component surfaces by itself');
  assert.equal(items[0].text, 'Makhana (Fox Nuts)');
  assert.equal(items.length, 3, 'the address and the allergen line are not items');
  const pos = slug => matched.find(m => m.slug === slug).position;
  assert.equal(pos('sugar'), pos('silicon-dioxide'), 'components share their item\'s position');
});

// The first label scanned on a phone: nested flavour lists, a word split across
// a line and an address the list ran into. Every item on it must resolve.
test('the first real scanned label resolves completely', async () => {
  const raw = 'INGREDIENTS: Makhana (Fox Nuts - 70%), Edible Vegetable Oil (Sunflower), Seasoning [Maltodextrin, '
    + 'Sugar, Himalayan Salt (1.4%), Black Salt (1.4%), Flavours [Natural (Spice), Nature Identical (Lemon)], '
    + 'Yellow Chilli, Cinna- mon, Lemon Juice Powder, Hydrolysed Vegetable Protein, Yeast Extract, '
    + 'Flavour Enhancers (INS 627, INS 631), Anticaking Agent (INS 551)]. CONTAINS: SULPHITE MANUFACTURED Alimento Agro Foods';
  const { matched, unresolved } = await resolveDeclaration(client, raw, { queue: false });
  assert.deepEqual(unresolved, []);
  const slugs = matched.map(m => m.slug);
  for (const s of ['chilli', 'cinnamon', 'lemon-juice', 'yeast-extract', 'hydrolysed-vegetable-protein',
    'nature-identical-flavouring', 'silicon-dioxide']) assert.ok(slugs.includes(s), `${s} resolves`);
  assert.equal(matched.filter(m => m.e_number === 'E627' || m.e_number === 'E631').length, 2, 'both flavour enhancers');
});

// regression: DATE came back shifted a day, printing a 2027-01-01 ban as 2026-12-31
test('regulatory dates are exact, not timezone-shifted', async () => {
  const { rows } = await client.query(`
    select r.jurisdiction, r.effective_from
    from evidence.regulatory_status r join canon.ingredient i on i.id = r.ingredient_id
    where i.slug = 'potassium-bromate' and r.jurisdiction = 'US-CA'`);
  assert.equal(rows[0].effective_from, '2027-01-01');
});

test('no evidence row can exist without a citation', async () => {
  await assert.rejects(() => client.query(
    `insert into evidence.hazard_finding (ingredient_id, body, endpoint, finding, grade, citation_id)
     values ((select id from canon.ingredient limit 1), 'TEST', 'test', 'x', 'A', null)`));
});

// regression: the seeder cleared a queued term only when its normalised text was
// itself a synonym, so everything the resolver reaches another way stayed in the
// content lead's queue as work already done. Rolled back: the live queue is untouched.
test('the work queue drops what the resolver now handles, and keeps a copy', async () => {
  const probes = ['Refined Oil (Sunflower)', 'Energy (kcal) 488 INGREDIENTS: Makhana (Fox Nuts - )',
    'Seasoning [Salt, Quizzium Extract]'];
  await client.query('begin');
  try {
    for (const t of probes) {
      await client.query(
        `insert into canon.unresolved_term (normalised, sample_term, hit_count, first_seen, last_seen)
         values ($1, $2, 3, '2026-09-01T00:00:00Z', '2026-09-20T00:00:00Z')`, [normalise(t), t]);
    }
    const cleared = await clearResolved(client);
    assert.deepEqual(
      cleared.filter(c => probes.includes(c.sample_term)).map(c => [c.sample_term, c.resolved_to]),
      [[probes[0], ['sunflower-oil']], [probes[1], ['makhana']]],
      'a bracketed oil and a list after its heading resolve; a partly known item does not');

    const { rows: copies } = await client.query(
      `select sample_term, hit_count, first_seen = '2026-09-01T00:00:00Z' as dated
       from canon.cleared_term where sample_term = any($1) order by id`, [probes]);
    assert.deepEqual(copies.map(r => [r.sample_term, r.hit_count, r.dated]),
      [[probes[0], 3, true], [probes[1], 3, true]], 'a cleared row keeps its history');

    const { rows: [kept] } = await client.query(
      `select hit_count, last_seen = '2026-09-20T00:00:00Z' as untouched
       from canon.unresolved_term where normalised = $1`, [normalise(probes[2])]);
    assert.deepEqual([kept.hit_count, kept.untouched], [3, true], 'the cleanup adds no hits');
  } finally {
    await client.query('rollback');
  }
});
