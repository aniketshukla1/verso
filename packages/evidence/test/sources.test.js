import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, parseLiteral, plainText } from '../src/sources/text.js';
import { parse as parseEu } from '../src/sources/eu.js';
import { parse as parseFda } from '../src/sources/fda.js';
import { parse as parseIarc } from '../src/sources/iarc.js';
import { parse as parseProp65, listDate } from '../src/sources/prop65.js';
import { parseText as parseFssai } from '../src/sources/fssai-oils.js';
import { parseText as parseCodex } from '../src/sources/codex-oils.js';
import { prepare, planChanges } from '../src/sync.js';
import { normalise } from '../../shared/src/normalise.js';

test('CSV: quoted commas, doubled quotes, newlines and a BOM', () => {
  const rows = parseCsv('\uFEFFa,"b, c","say ""hi""","two\nlines"\r\nx,y,z,w\r\n');
  assert.deepEqual(rows, [['a', 'b, c', 'say "hi"', 'two\nlines'], ['x', 'y', 'z', 'w']]);
});

// regression: an inner quote was read as a field opener, turning FDA's
// =T("172.515") into =T(172.515) and every regulation reference with it
test('CSV: a quote inside an unquoted field is a character', () => {
  assert.deepEqual(parseCsv('=T("172.515"),=T("24")\n'), [['=T("172.515")', '=T("24")']]);
});

test('JS literal: unquoted keys, minified booleans, nested arrays', () => {
  const src = 'x={agents:[{name:"A, b: c",cas:["1-11-1"],in_prep:!0,year:2014},{name:\'d\\"e\',ok:!1,n:void 0}]}';
  const { value } = parseLiteral(src, src.indexOf('[') );
  assert.deepEqual(value[0], { name: 'A, b: c', cas: ['1-11-1'], in_prep: true, year: 2014 });
  assert.equal(value[1].name, 'd"e');
  assert.equal(value[1].ok, false);
});

test('plain text: markup and entities stripped', () => {
  assert.equal(plainText('Colours at <em>quantum satis</em>'), 'Colours at quantum satis');
  assert.equal(plainText('&diams; SILICA<br />&diams; E&amp;M'), '♦ SILICA ♦ E&M');
});

const node = (valueIdentifier, value, children = []) => ({ valueIdentifier, value, childrenValues: children });
const euItem = ({ code, type = 'substanceFAD', e, name, uses = [], members = [], note }) => ({
  value: null,
  childrenValues: [
    node('policyItemCode', code),
    node('policyItemSpecs', null, [
      node('policyItemType', type),
      node('displayName', name),
      node('substanceFAD', null, [node('eNumber', e)]),
      ...(note ? [node('policyItemNote', null, [node('policyItemNoteText', note)])] : []),
      ...(members.length ? [node('group', null, members.map(m => node('groupMemberRefs', m)))] : []),
    ]),
    node('conditionsOfUse', null, (uses.length ? uses : [null]).map(u => node('foodCategoryRestriction', null, [
      node('foodCategory', null, [node('foodCategoryId', u ? '1' : null)]),
      node('restriction', null, [node('restrictionType', u ? 'FAD_RT_ML' : null), node('restrictionComment', u)]),
    ]))),
  ],
});

test('EU: authorised for food only through a real food use, direct or via a group', () => {
  const buf = Buffer.from(JSON.stringify([
    euItem({ code: 'P1', e: 'E 127', name: 'Erythrosine', uses: ['only cocktail cherries and candied cherries'] }),
    euItem({ code: 'P2', e: 'E 621', name: 'Monosodium glutamate' }),
    euItem({ code: 'G1', type: 'group', e: 'Group I', name: 'Group I, <em>Additives</em>', uses: ['quantum satis'], members: ['P2'] }),
    // regression: the placeholder use (every field null) made E 171 "authorised"
    euItem({ code: 'P3', e: 'E 171', name: 'Titanium dioxide', note: 'Titanium dioxide is not authorised ... Regulation EU No 2022/63' }),
  ]));
  const by = Object.fromEntries(parseEu(buf).records.map(r => [r.record_key, r]));
  assert.equal(by.P1.e_number, 'E127');
  assert.equal(by.P1.payload.authorisedForFood, true);
  assert.equal(by.P1.payload.uses[0].comment, 'only cocktail cherries and candied cherries');
  assert.equal(by.P2.payload.authorisedForFood, true, 'MSG is authorised through Group I');
  assert.deepEqual(by.P2.payload.groups.map(g => g.name), ['Group I, Additives']);
  assert.equal(by.P3.payload.authorisedForFood, false, 'listed is not authorised');
  assert.equal(by.G1.e_number, null, 'groups carry no E number');
  assert.match(by.P1.url, /\/details\/P1$/);
});

// regression: a food category holding two restrictions was read as one blank use
test('EU: every restriction under a food category is a use', () => {
  const tree = euItem({ code: 'E', e: 'E 127', name: 'Erythrosine', uses: ['only cocktail cherries and candied cherries'] });
  const fcr = tree.childrenValues.find(c => c.valueIdentifier === 'conditionsOfUse').childrenValues[0];
  fcr.childrenValues.push(node('restriction', null, [node('restrictionType', 'FAD_RT_ML'), node('restrictionValue', '150'),
    node('restrictionUnit', 'FAD_RU_MGK'), node('restrictionComment', 'only bigareaux cherries in syrup and in cocktails')]));
  const [r] = parseEu(Buffer.from(JSON.stringify([tree]))).records;
  assert.deepEqual(r.payload.uses.map(u => u.comment),
    ['only cocktail cherries and candied cherries', 'only bigareaux cherries in syrup and in cocktails']);
  assert.equal(r.payload.uses[1].level, '150 mg/kg');
});

test('EU: delisted only by its own number or name, never by a note about another item', () => {
  const buf = Buffer.from(JSON.stringify([
    euItem({ code: 'A', e: 'E 311/ Removed from Union list', name: 'Octyl gallate', uses: ['x'] }),
    euItem({ code: 'B', e: 'E 160b', name: 'Annatto, Bixin, Norbixin/Deleted from the Union List of authorised additives', uses: ['x'] }),
    // regression: this note is about E 160b, and made E 160b(i) "delisted"
    euItem({ code: 'C', e: 'E 160b(i)', name: 'Annatto bixin', uses: ['x'],
      note: 'Annatto, Bixin, Norbixin (E 160b) is deleted from the Union List and is replaced by two separate Food Additives' }),
  ]));
  const by = Object.fromEntries(parseEu(buf).records.map(r => [r.record_key, r]));
  assert.deepEqual([by.A.e_number, by.A.payload.delisted, by.A.payload.authorisedForFood], ['E311', true, false]);
  assert.deepEqual([by.B.name, by.B.payload.delisted], ['Annatto, Bixin, Norbixin', true]);
  assert.deepEqual([by.C.e_number, by.C.payload.delisted, by.C.payload.authorisedForFood], ['E160bi', false, true]);
});

test('FDA: regulation sections by kind, Part 189 prohibitions matchable by bare name', () => {
  const csv = [
    'Downloaded from FDA Substances Added to Food; Last updated 7/28/2026; downloaded 9/22/2026.',
    '',
    '"It is important to note that the inventory is only a partial list of food ingredients. Inclusion in this inventory of information from non-FDA entities does not indicate an FDA approval or evaluation of this use."',
    '',
    'CAS Reg No (or other ID),Substance,Other Names,Used for (Technical Effect),Reg col01,Reg add01,Reg add02,Reg prohibited189,regs Labeling & Standards ,FEMA No',
    '" 7631-86-9"," SILICON DIOXIDE"," &diams; SILICA<br />&diams; InChIKey: VYPSYNLAJGMNEJ"," ANTICAKING AGENT",=T("73.1"),=T("172.480"),=T("182.90"),,"160.105 ,  160.185",',
    '" 100-88-9"," CYCLAMATE--PROHIBITED",," NON-NUTRITIVE SWEETENER",,,,=T("189.135"),,',
  ].join('\n');
  const out = parseFda(Buffer.from(csv, 'latin1'));
  assert.equal(out.published, 'Last updated 2026-07-28');
  assert.match(out.notice, /does not indicate an FDA approval/);
  const [si, cyc] = out.records;
  assert.deepEqual(si.cas, ['7631-86-9']);
  assert.deepEqual(si.payload.cfr, { colour: ['73.1'], additive: ['172.480', '182.90'], prohibited: [], other: ['160.105', '160.185'] });
  assert.ok(si.names.includes('SILICA') && !si.names.some(n => /InChI/.test(n)));
  assert.match(si.url, /id=SILICONDIOXIDE$/);
  assert.deepEqual(cyc.payload.cfr.prohibited, ['189.135']);
  assert.ok(cyc.names.includes('CYCLAMATE'), 'bare name for matching');
});

test('IARC: classifications and cross-references, without executing the file', () => {
  const js = 'var m={last_volume:"142",last_update:"2026-07-23 14:08 (CET)",agents:['
    + '{name:"Aspartame",group:"2B",cas:["22839-47-0"],volume:["134"],year:2024,yeareval:2023},'
    + '{name:"Acetaminophen (see Paracetamol)",cas:["103-90-2"]},'
    + '{name:"<i>Helicobacter pylori</i> (infection with)",group:"1",cas:[],volume:["61","100B"],year:2012,yeareval:2009,comment:"Reaffirmed"}]};';
  const out = parseIarc(Buffer.from(js));
  assert.equal(out.published, 'Last updated 2026-07-23 14:08 (CET), Volumes 1–142');
  const [asp, para, hp] = out.records;
  assert.equal(asp.payload.group, '2B');
  assert.equal(asp.payload.evaluated, '2023');
  assert.equal(para.payload.group, null);
  assert.equal(para.payload.see, 'Paracetamol');
  assert.ok(para.names.includes('Acetaminophen'));
  assert.equal(hp.name, 'Helicobacter pylori (infection with)');
});

test('Prop 65: header found under the preamble, one record per listing', () => {
  assert.equal(listDate('1-Jan-90'), '1990-01-01');
  assert.equal(listDate('31-Jul-26'), '2026-07-31');
  const csv = [
    '\uFEFFSTATE OF CALIFORNIA,,,,,,,,',
    'PROPOSITION 65 LIST OF CARCINOGENS OR REPRODUCTIVE TOXICANTS,,,,,,,,',
    '31-Jul-26,,,,,,,,',
    'Chemical,Type of Toxicity,Listing Mechanism,CAS No.,Date Listed,NSRL or MADL (µg/day)a,,,',
    'Acrylamide,cancer,AB,79-06-1,1-Jan-90,0.2,,,',
    'Acrylamide,"developmental, male",FR,79-06-1,25-Feb-11,140,,,',
    ',,,,,,,,',
  ].join('\r\n');
  const out = parseProp65(Buffer.from(csv));
  assert.equal(out.published, 'List dated 2026-07-31');
  assert.equal(out.records.length, 2);
  assert.deepEqual(out.records.map(r => r.payload.toxicity), ['cancer', 'developmental, male']);
  assert.equal(new Set(out.records.map(r => r.record_key)).size, 2);
});

// Line shapes copied from pdftotext -layout on Chapter 2.2, Version 3.
test('FSSAI: every oil standard in 2.2.1, whatever its amendment marks', () => {
  const text = [
    '                              CHAPTER 2',
    '2.2: FATS, OILS AND FAT EMULSIONS',
    ' 2.2.1       OILS:',
    ' 1.       Coconut oil (naryal ka tel) means the oil expressed from copra',
    '1|Version 3 (04.11.2024)',
    '\f2.        Cotton seed oil (binola ka tel) means the oil extracted from clean,',   // opens a page
    '  [4. Flaxseed or Linseed oil (tisi ka tel) means the oil obtained by process of',
    '   [7. Rapeseed or mustard oil-low erucic acid means the oil obtained from',
    '    [ 8 (1) Description:',
    '',
    '         (i) Olive oil is the oil obtained solely from the fruit of the olive tree (Olea',
    '        (ii) Virgin olive oils are the oils obtained from the fruit of the olive tree',
    '10.          Safflower seed oil (barrey ka tel) means the oil expressed from the',
    '  [16. Refined vegetable oil.-(1) Refined Vegetable Oil means any vegetable oil',
    '   [24. 77[Multi-Source Edible Oil] means an admixture of any two edible',
    '   [32. (1) Moringa oil means the oil obtained by the process of expressing',
    '2.2.2 Interesterified 26[vegetable fat/Oil]: means an edible fatty material that',
    '     [5. Cocoa butter means the fat produced by extraction or expression from cocoa',
  ].join('\n');
  const out = parseFssai(text);
  assert.equal(out.published, 'Version 3 (04.11.2024)');
  const by = Object.fromEntries(out.records.map(r => [r.payload.regulation, r]));
  // regression: an optional footnote mark read "10." as footnote 1 and number 0
  assert.deepEqual(Object.keys(by), ['1', '2', '4', '7', '8', '10', '16', '24', '32'].map(n => `2.2.1(${n})`));
  assert.equal(by['2.2.1(16)'].name, 'Refined vegetable oil');
  assert.equal(by['2.2.1(24)'].name, 'Multi-Source Edible Oil');
  assert.deepEqual(by['2.2.1(8)'].names, ['Olive oil', 'Virgin olive oil']);
  const names = r => r.names.map(normalise);
  assert.ok(['flaxseed oil', 'linseed oil'].every(n => names(by['2.2.1(4)']).includes(n)));
  // regression: canola matched the ordinary rapeseed and mustard oil standard
  assert.ok(names(by['2.2.1(7)']).includes('low erucic acid rapeseed oil'));
  assert.ok(!out.records.some(r => /cocoa/i.test(r.name)), '2.2.2 onwards is not 2.2.1');
});

test('Codex: one definition per paragraph, synonyms from the brackets', () => {
  const text = [
    'Adopted in 1999. Revision: 2001, 2003, 2009. Amendment: 2005, 2011, 2013 and 2015.',
    '2.1   Product definitions',
    '      (Note: synonyms are in brackets immediately following the name of the oil)',
    '      Maize oil (corn oil) is derived from maize germ (the embryos of Zea mays L.).',
    '      Palm olein is the liquid fraction derived from the fractionation of palm oil (described above).',
    '      Rapeseed oil - low erucic acid (low erucic acid turnip rape oil; low erucic acid colza oil; canola oil) is',
    '      produced from low erucic acid oil-bearing seeds of varieties derived from the Brassica napus L., Brassica',
    '      rapa L. and Brassica juncea L., species.',
    '      Safflowerseed oil (safflower oil; carthamus oil; kurdee oil) is derived from safflower seeds (seeds of',
    '      Carthamus tinctorious L.).',
    '      CODEX STAN 210-1999                                                                                            3',
    '2.2   Other definitions',
    '      Virgin oils are obtained, without altering the nature of the oil, by mechanical procedures, e.g. expelling or',
  ].join('\n');
  const out = parseCodex(text);
  assert.equal(out.published, '2015 edition');
  // a wrapped line that starts with a capital ("Carthamus ...") continues the
  // paragraph until it ends with a full stop
  assert.deepEqual(out.records.map(r => r.name), ['Maize oil', 'Palm olein', 'Rapeseed oil - low erucic acid', 'Safflowerseed oil']);
  const lear = out.records[2];
  assert.ok(lear.names.includes('canola oil'));
  assert.match(lear.payload.definition, /is produced from low erucic acid oil-bearing seeds .* species\.$/);
});

test('sync plan: added, changed, removed; a shrunken list is refused', () => {
  const recs = prepare([
    { record_key: 'a', name: 'A', payload: { g: 1 } },
    { record_key: 'b', name: 'B', payload: { g: 2 } },
    { record_key: 'b', name: 'B again', payload: { g: 3 } },   // duplicate key -> b#2
  ]);
  assert.deepEqual(recs.map(r => r.record_key), ['a', 'b', 'b#2']);
  const existing = new Map([['a', recs[0].hash], ['b', 'stale'], ['gone', 'x']]);
  const plan = planChanges(existing, recs);
  assert.deepEqual(plan.added.map(r => r.record_key), ['b#2']);
  assert.deepEqual(plan.changed.map(r => r.record_key), ['b']);
  assert.deepEqual(plan.removed, ['gone']);
  assert.equal(plan.refuse, false);

  const big = new Map(Array.from({ length: 100 }, (_, i) => [`k${i}`, 'h']));
  assert.equal(planChanges(big, recs).refuse, true, 'three records against a hundred is a broken download');
  assert.equal(planChanges(new Map(), []).refuse, true, 'an empty parse is never applied');
});
