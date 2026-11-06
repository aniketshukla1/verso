import test from 'node:test';
import assert from 'node:assert/strict';
import { normalise, splitIngredients, splitIngredientGroups } from '../src/normalise.js';
import { productRef, parseProductRef, normaliseGtin } from '../src/product-ref.js';

test('additive codes normalise to one form however they are written', () => {
  assert.equal(normalise('E102'), 'e102');
  assert.equal(normalise('E 102'), 'e102');
  assert.equal(normalise('e-102'), 'e102');
  assert.equal(normalise('INS 102'), 'ins102');
  assert.equal(normalise('E150d'), 'e150d');
  // regression: "E500(ii)" normalised to "e500 ii" and never met "E500ii"
  assert.equal(normalise('E500(ii)'), 'e500ii');
  assert.equal(normalise('INS 160a (ii)'), 'ins160aii');
  assert.equal(normalise('E500ii'), 'e500ii');
});

test('punctuation, case and diacritics collapse', () => {
  assert.equal(normalise('FD&C Yellow No. 5'), 'fd and c yellow no 5');
  assert.equal(normalise('  Sodium   Benzoate '), 'sodium benzoate');
  assert.equal(normalise('Färgämne'), 'fargamne');
});

test('non-Latin scripts survive normalisation', () => {
  assert.equal(normalise('पामोलीन'), 'पामोलीन');
});

// regression: commas inside brackets were splitting the declaration apart
test('nested parentheses are not split on inner commas', () => {
  const groups = splitIngredientGroups('Potatoes, Vegetable Oil (Sunflower, Corn, and/or Canola Oil), Salt.');
  assert.equal(groups.length, 3, 'three top-level declaration items');
  assert.ok(groups[1].includes('Vegetable Oil (Sunflower, Corn, and/or Canola Oil)'));
});

// regression: "Sunflower" and "Corn" lose the head noun stated once at the end
test('an elided head noun is distributed across the list', () => {
  const terms = splitIngredients('Vegetable Oil (Sunflower, Corn, and/or Canola Oil)');
  assert.ok(terms.includes('Sunflower Oil'), 'Sunflower Oil recovered');
  assert.ok(terms.includes('Corn Oil'), 'Corn Oil recovered');
  assert.ok(terms.includes('Canola Oil'));
});

test('parenthetical contents are offered as their own candidates', () => {
  const terms = splitIngredients('Edible Vegetable Oil (Palmolein Oil), Salt');
  assert.ok(terms.includes('Palmolein Oil'));
  assert.ok(terms.includes('Edible Vegetable Oil'));
});

// regression: one bracketed list was one item, so a single match hid every
// unknown component in it
test('brackets: a list is components, a single entry describes the item', () => {
  const [g] = splitIngredientGroups('Seasoning [Maltodextrin, Black Salt (1.4%), Anticaking Agent (INS 551)]');
  assert.deepEqual(g.members.map(m => m[0]), ['Maltodextrin', 'Black Salt', 'Anticaking Agent (INS 551)']);
  assert.ok(g.members[2].includes('INS 551'));
  const [oil] = splitIngredientGroups('Edible Vegetable Oil (Sunflower)');
  assert.equal(oil.members.length, 0);
  assert.ok(oil.includes('Sunflower Oil'), 'the head noun belongs to what it qualifies');
});

// regression: "INGREDIENTS:" stayed glued to the first item, "70%" left
// "Fox Nuts -" behind, and on-device OCR ran on into the address
test('the list starts after its heading, loses quantity debris, stops at the next section', () => {
  const groups = splitIngredientGroups('Energy 488 kcal INGREDIENTS: Makhana (Fox Nuts - 70%), Himalayan Salt (1.4%), Sugar. MANUFACTURED BY: Alimento Agro Foods, Kota');
  assert.deepEqual(groups.map(g => g[0]), ['Makhana (Fox Nuts)', 'Himalayan Salt', 'Sugar']);
});

// regression: "Flavour Enhancers (INS 627, INS 631)" inside a seasoning list
// was reported as unknown although both of its components resolved
test('a component that lists components of its own is judged by them', () => {
  const [g] = splitIngredientGroups('Seasoning [Sugar, Flavour Enhancers (INS 627, INS 631)]');
  const fe = g.members.find(m => m[0] === 'Flavour Enhancers (INS 627, INS 631)');
  assert.equal(fe.listed, true);
  assert.ok(g.members.some(m => m[0] === 'INS 627') && g.members.some(m => m[0] === 'INS 631'));
  assert.equal(g.members.find(m => m[0] === 'Sugar').listed, false);
});

// regression: on-device OCR split "Cinnamon" across a line as "Cinna- mon", and
// dropped the "BY" after "MANUFACTURED", leaking the address into the list
test('a word broken across a line is rejoined, and the list stops at "manufactured"', () => {
  const groups = splitIngredientGroups('Salt, Cinna- mon, Sugar. CONTAINS: SULPHITE MANUFACTURED Alimento Agro Foods, Kota');
  assert.deepEqual(groups.map(g => g[0]), ['Salt', 'Cinnamon', 'Sugar']);
  assert.deepEqual(splitIngredientGroups('Anti-Caking Agent')[0][0], 'Anti-Caking Agent', 'a real hyphen stays');
});

// regression: on-device OCR read "Oil" as "0il", so "Edible Vegeta ble 0il
// (Sunflower)" never produced "Sunflower Oil"
test('O read as 0 and l read as 1 are retried as an extra candidate, never a replacement', () => {
  const terms = splitIngredients('Edible Vegeta ble 0il (Sunflower), Vitamin B1, E150d');
  assert.ok(terms.some(t => t.toLowerCase() === 'sunflower oil'), 'the misread head noun still distributes');
  assert.ok(terms.includes('Edible Vegeta ble 0il (Sunflower)'), 'what was printed stays a candidate');
  assert.ok(terms.includes('Vitamin B1') && terms.includes('E150d'), 'codes are untouched');
});

test('product refs round-trip and never become foreign keys', () => {
  const ref = productRef({ gtin: '08901491101837', market: 'IN' });
  assert.equal(ref, 'gtin:08901491101837@IN');
  assert.deepEqual(parseProductRef(ref), { gtin: '08901491101837', market: 'IN' });
  assert.deepEqual(parseProductRef(productRef({ source: 'openfoodfacts', sourceRef: 'x1', market: 'US' })),
    { source: 'openfoodfacts', sourceRef: 'x1', market: 'US' });
  assert.throws(() => parseProductRef('nonsense'));
});

test('GTINs from different sources normalise to one width', () => {
  assert.equal(normaliseGtin('028400199407'), '00028400199407');
  assert.equal(normaliseGtin('8901491101837'), '08901491101837');
  assert.equal(normaliseGtin('123'), null);
});
