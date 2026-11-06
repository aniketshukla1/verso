import test from 'node:test';
import assert from 'node:assert/strict';
import { connect } from '../../db/src/db.js';
import { compareLabels, diffLabels } from '../src/compare.js';
import { FORBIDDEN } from '../src/templates.js';

const client = await connect();
test.after(() => client.end());

// A fixture is not a scan: every comparison here runs with queue: false, so
// none of its labels reaches the content lead's work queue.
const US = 'Potatoes, Vegetable Oil (Sunflower, Corn, and/or Canola Oil), Salt.';
const IN = 'Potato, Edible Vegetable Oil (Palmolein Oil), Salt, Spices & Condiments.';
const side = (market, ingredientsText, extra = {}) =>
  ({ market, ingredientsText, origin: 'sample', date: '2026-09-14', ...extra });

// The headline feature, end to end: two labels in, only true differences out.
test("the Lay's India / US comparison finds the oil swap and nothing invented", async () => {
  const out = await compareLabels(client, { a: side('IN', IN), b: side('US', US), queue: false });
  assert.equal(out.suppressed, false);
  assert.equal(out.headline.text, 'Two differences between the Indian label and the US label.');

  const [swap, spices] = out.deltas;
  assert.equal(swap.type, 'substitution');
  assert.deepEqual(swap.a.map(i => i.slug), ['palmolein']);
  assert.deepEqual(swap.b.map(i => i.slug).sort(), ['canola-oil', 'corn-oil', 'sunflower-oil']);
  // quoted in the label's own order, with the label's own "and/or"
  assert.equal(swap.claim.text,
    'The Indian label lists Palmolein. The US label lists Sunflower Oil, Corn Oil and/or Canola Oil in the same position.');
  assert.deepEqual([swap.a[0].saturated.low, swap.a[0].saturated.high], [42, 52]);

  assert.equal(spices.type, 'only_a');
  assert.equal(spices.claim.text, 'Spices appears on the Indian label and not on the US label.');
  assert.equal(out.sourced.text,
    'Compared from a Verso test label (14 September 2026) and a Verso test label (14 September 2026).');
});

test('no comparison sentence breaks the voice rules', async () => {
  const out = await compareLabels(client, { a: side('IN', IN), b: side('US', US), queue: false });
  for (const c of [out.headline, out.sourced, ...out.claims]) {
    for (const w of FORBIDDEN) assert.ok(!c.text.toLowerCase().includes(w), `"${w}" in ${c.text}`);
    assert.ok(!/cheap|worse|better|healthier|quality/i.test(c.text), `a comparison may not characterise: ${c.text}`);
  }
});

test('identical labels in two markets say they match', async () => {
  const out = await compareLabels(client, { a: side('IN', US), b: side('US', US), queue: false });
  assert.equal(out.deltas.length, 0);
  assert.equal(out.headline.templateId, 'cmp.no_difference');
  assert.equal(out.headline.text, 'The ingredient lists match across India and the United States.');
});

// An unreadable item could BE the "missing" ingredient, spelled a way the canon
// does not know. Claiming absence then would be a fabricated difference.
test('an absence is withheld when the other label has unreadable text', () => {
  const m = (id, slug, kind, position) => ({ id, slug, display_name: slug, kind, rank: position, position });
  const a = { matched: [m(1, 'potato', 'base', 0), m(2, 'spices', 'base', 1)], unresolvedItems: [], items: [] };
  const b = { matched: [m(1, 'potato', 'base', 0)], unresolvedItems: [{ position: 1, text: 'Mashala' }], items: [] };
  const { deltas, withheld } = diffLabels(a, b);
  assert.equal(deltas.length, 0);
  assert.equal(withheld, 1);
});

test('a list shifted by one item yields absences, never a guessed substitution', () => {
  const m = (id, slug, kind, position) => ({ id, slug, display_name: slug, kind, rank: position, position });
  const a = { matched: [m(1, 'potato', 'base', 0), m(2, 'palmolein', 'oil_fat', 1)], unresolvedItems: [] };
  const b = { matched: [m(1, 'potato', 'base', 0), m(3, 'salt', 'base', 1), m(4, 'sunflower-oil', 'oil_fat', 2)], unresolvedItems: [] };
  const { deltas } = diffLabels(a, b);
  assert.ok(deltas.every(d => d.type !== 'substitution'));
  assert.deepEqual(deltas.map(d => d.type).sort(), ['only_a', 'only_b', 'only_b']);
});

test('a mostly unreadable label is not compared at all', async () => {
  const out = await compareLabels(client, {
    a: side('IN', IN), b: side('US', 'Xyzzy, Plugh, Frobnitz, Potatoes, Salt'), queue: false });
  assert.equal(out.suppressed, true);
  assert.equal(out.suppressionCode, 'coverage');
  assert.equal(out.deltas.length, 0);
  assert.equal(out.headline, null);
});
