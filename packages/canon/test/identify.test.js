import test from 'node:test';
import assert from 'node:assert/strict';
import { connect } from '../../db/src/db.js';
import { identifyTerms, canonE, sameSubstance } from '../src/identify.js';

// A fake model stands in for the real one: the rules under test are what Verso
// does with a proposal, not what a model happens to say today. Every term and
// every created name starts "Verso Test" so cleanup cannot touch real rows.
const client = await connect();
const cleanup = async () => {
  await client.query(`delete from canon.identification where normalised like 'verso test%'`);
  await client.query(`delete from canon.ingredient where slug like 'auto-verso-test%'`);
};
test.before(cleanup);
test.after(async () => { await cleanup(); await client.end(); });

const fake = proposals => {
  const calls = [];
  const identify = async terms => {
    calls.push(terms);
    return { model: 'fake', items: terms.map(t => ({ term: t, ...proposals[t] })) };
  };
  return { identify, calls };
};
const items = texts => texts.map((text, position) => ({ position, text }));

test('E numbers and names normalise the way the canon writes them', () => {
  assert.equal(canonE('E 621'), 'E621');
  assert.equal(canonE('INS 500(ii)'), 'E500ii');
  assert.equal(canonE('621'), 'E621');
  assert.equal(canonE('glutamate'), null);
  assert.ok(sameSubstance('monosodium glutamate', ['Monosodium glutamate (MSG)']));
  assert.ok(!sameSubstance('pickling lime', ['Calcium ascorbate']));
});

test('an E number is accepted only when the canon names that number the same', async () => {
  const { identify } = fake({
    'Verso Test Ajinomoto': { name: 'monosodium glutamate', kind: 'additive', e_number: 'E621' },
    // the local model's real mistake: amchur as "pickling lime", E302 invented
    'Verso Test Amchur': { name: 'verso test pickling lime', kind: 'food', e_number: 'E302' },
  });
  const out = await identifyTerms(client, items(['Verso Test Ajinomoto', 'Verso Test Amchur']), { identify });
  const by = Object.fromEntries(out.identified.map(i => [i.text, i.row]));

  const msg = by['Verso Test Ajinomoto'];
  assert.deepEqual([msg.outcome, msg.verified_by], ['matched', 'e_number']);
  const { rows: [e621] } = await client.query(`select id from canon.ingredient where e_number = 'E621'`);
  assert.equal(msg.ingredient_id, e621.id);

  const lime = by['Verso Test Amchur'];
  assert.deepEqual([lime.outcome, lime.verified_by], ['created', null], 'new, and unverified');
  const { rows: [e302] } = await client.query(`select id from canon.ingredient where e_number = 'E302'`);
  assert.notEqual(lime.ingredient_id, e302?.id, 'never attached to the invented E number');
  const { rows: [made] } = await client.query('select origin, verified, kind from canon.ingredient where id = $1', [lime.ingredient_id]);
  assert.deepEqual(made, { origin: 'auto', verified: false, kind: 'base' });
});

test('"not an ingredient" is kept apart, and every answer is cached', async () => {
  const { identify, calls } = fake({ 'Verso Test Kota': { name: 'Kota', kind: 'not_an_ingredient' } });
  const first = await identifyTerms(client, items(['Verso Test Kota']), { identify });
  assert.deepEqual(first.notIngredient.map(i => i.text), ['Verso Test Kota']);
  const again = await identifyTerms(client, items(['Verso Test Kota', 'Verso Test Ajinomoto']), { identify });
  assert.equal(calls.length, 1, 'both answers came from canon.identification');
  assert.equal(again.identified.length, 1);
  assert.equal(again.notIngredient.length, 1);
});

test('a slow model does not hold up the verdict, and its answer lands in the cache', async () => {
  let release;
  const gate = new Promise(r => { release = r; });
  const identify = async terms => {
    await gate;
    return { model: 'fake', items: terms.map(t => ({ term: t, name: 'verso test slow spice', kind: 'food' })) };
  };
  const out = await identifyTerms(client, items(['Verso Test Slow']), { identify, budgetMs: 30 });
  assert.deepEqual(out.pending, ['Verso Test Slow']);
  assert.equal(out.identified.length, 0);

  release();
  for (let i = 0; i < 50; i++) {
    const { rowCount } = await client.query(`select 1 from canon.identification where normalised = 'verso test slow'`);
    if (rowCount) break;
    await new Promise(r => setTimeout(r, 20));
  }
  const later = await identifyTerms(client, items(['Verso Test Slow']), { identify: () => { throw new Error('asked twice'); } });
  assert.equal(later.identified[0].row.name, 'verso test slow spice');
});

test('nutrition figures and addresses are never sent to the model', async () => {
  const { identify, calls } = fake({});
  await identifyTerms(client, items(['Energy (kcal) 488 Protein (g) 8.0 Total Fat (g) 22.4 Fibre 5.5 Sugar 4.0 Sodium 910']), { identify });
  assert.equal(calls.length, 0);
});
