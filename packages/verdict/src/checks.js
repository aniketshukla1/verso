// Source checks: what each official list says about an ingredient, looked up
// in the daily mirror (evidence.source_record, packages/evidence/src/sync.js).
//
// Matching is deliberately narrow. The EU list is searched by E number only;
// the others by CAS number first and exact name second (English synonyms, whole
// string). A fuzzy match here would attach another substance's ban or hazard
// listing to this one, which is the worst error this product can make.
//
// Every check carries its source link and the date the list was last checked.
// Only three results are findings in the scoring sense (docs/methodology.md,
// "Source checks"): a US Part 189 prohibition, an IARC Group 1, 2A or 2B
// classification, and a Proposition 65 listing. Everything else is shown and
// never scored: "no entry found" is a lookup result, not a verdict.

import { normalise } from '../../shared/src/normalise.js';
import { IARC_GROUPS } from '../../evidence/src/sources/iarc.js';
import { SOURCES } from '../../evidence/src/sources/index.js';
import { render, humanDate, joinList } from './templates.js';

const SOURCE = Object.fromEntries(SOURCES.map(s => [s.key, s]));
// The lists whose entries count as evidence for the score (docs/methodology.md).
// An oil's FSSAI or Codex standard counts: it is a regulator saying what that
// oil must be to be sold as food, which is more than an entry in FDA's
// inventory, and it still never deducts. Without it every fried snack's oils
// read "no list entry" and its score was withheld.
export const COVERAGE_SOURCES = new Set(['eu-additives', 'fda-substances', 'iarc', 'prop65', 'fssai-oils', 'codex-oils']);

const INSTRUMENT = {
  'fssai-oils': 'FSSAI Food Products Standards, regulation 2.2.1 (Oils)',
  'codex-oils': 'Codex Standard for Named Vegetable Oils, CXS 210-1999',
  'eu-additives': 'EU Food Additives Database (Regulation (EC) No 1333/2008, Annex II)',
  'fda-substances': 'FDA Substances Added to Food inventory',
  iarc: 'IARC Monographs, List of Classifications',
  prop65: 'Proposition 65 List, OEHHA',
};

// Quoted from the sources themselves; shown beside the checks they qualify.
export const CAVEATS = {
  'fda-substances': 'FDA: "Inclusion in this inventory of information from non-FDA entities does not '
    + 'indicate an FDA approval or evaluation of this use."',
  iarc: 'IARC: "For agents that have not been classified, no determination of non-carcinogenicity '
    + 'or overall safety should be inferred."',
};

// 21 CFR parts by what they govern: substances used in food itself, and
// materials that only touch it (packaging, equipment). Part 189 is prohibition.
const DIRECT = new Set(['73', '74', '172', '173', '180', '182', '184']);
const CONTACT = new Set(['174', '175', '176', '177', '178', '181', '186']);
const partOf = section => String(section).split('.')[0];
const ecfr = section => ({ label: `21 CFR ${section}`, url: `https://www.ecfr.gov/current/title-21/section-${section}` });
const SHOW_SECTIONS = 6;

const GROUP_ORDER = { 1: 0, '2A': 1, '2B': 2, 3: 3 };
const uniq = xs => [...new Set(xs)];

// CAS matches first; a name match only when no CAS number matched.
function pick(records, ident) {
  const byCas = records.filter(r => r.cas.some(c => ident.cas.includes(c)));
  if (byCas.length) return { hits: byCas, via: 'CAS number' };
  const byName = records.filter(r => r.names_normalised.some(n => ident.names.includes(n)));
  return { hits: byName, via: byName.length ? 'name' : null };
}

function euCheck(ident, records, meta) {
  if (!ident.e) return null;   // a base food: the EU additive list does not apply
  const eu = records.filter(r => r.source_key === 'eu-additives');
  const exact = eu.filter(r => r.e_number === ident.e);
  // "E960" on a label: the EU now lists E960a to E960d
  const hits = exact.length ? exact : eu.filter(r => /^E\d+/.exec(r.e_number)?.[0] === ident.e);
  const slots = { instrument: INSTRUMENT['eu-additives'], checked: meta?.retrieved_at };
  // "E 311/REMOVED FROM UNION LIST" -> "E 311": the removal is what the sentence says
  const shown = r => (r.payload.eNumber ?? r.e_number).replace(/\s*\/.*$/, '');

  if (!hits.length) {
    return { status: 'not_found', url: SOURCE['eu-additives'].home, ...render('check.eu.not_found', { eNumber: ident.e, ...slots }) };
  }
  const authorised = hits.filter(r => r.payload.authorisedForFood);
  if (authorised.length) {
    const one = authorised.length === 1 ? authorised[0] : null;
    // Authorised only in a few named foods, with no group authorisation:
    // erythrosine, "only cocktail cherries and candied cherries".
    const limited = one && !one.payload.groups.some(g => g.uses > 0)
      && one.payload.uses.length <= 3 && one.payload.uses.every(u => u.comment);
    if (limited) {
      const uses = one.payload.uses.map(u => u.comment);
      return { status: 'limited', url: one.url, matchedAs: one.name,
        ...render('check.eu.limited', { eNumber: shown(one), uses: uses.join('; '), ...slots }, { verbatim: uses }) };
    }
    return { status: 'authorised', url: authorised[0].url, matchedAs: authorised.map(r => r.name).join('; '),
      ...render('check.eu.authorised', { eNumbers: joinList(authorised.map(shown)), ...slots }) };
  }
  const r = hits[0];
  const delisted = hits.every(h => h.payload.delisted);
  return { status: delisted ? 'delisted' : 'no_food_use', url: r.url, matchedAs: r.name, note: r.payload.note ?? null,
    ...render(delisted ? 'check.eu.delisted' : 'check.eu.no_food_use', { eNumber: shown(r), ...slots }) };
}

function fdaCheck(ident, records, meta) {
  const { hits, via } = pick(records.filter(r => r.source_key === 'fda-substances'), ident);
  const slots = { instrument: INSTRUMENT['fda-substances'], checked: meta?.retrieved_at };
  const caveat = CAVEATS['fda-substances'];
  if (!hits.length) {
    return { status: 'not_found', url: SOURCE['fda-substances'].home, caveat, ...render('check.fda.not_found', slots) };
  }
  const cfr = key => uniq(hits.flatMap(r => r.payload.cfr[key] ?? []));
  const all = uniq([...cfr('colour'), ...cfr('additive'), ...cfr('other')]);
  const prohibited = cfr('prohibited');
  const direct = all.filter(x => DIRECT.has(partOf(x)));
  const contact = all.filter(x => CONTACT.has(partOf(x)));
  const base = { url: hits[0].url, matchedAs: hits[0].name, via, caveat };
  const listed = xs => `21 CFR ${xs.slice(0, SHOW_SECTIONS).join(', ')}${xs.length > SHOW_SECTIONS ? ' and others' : ''}`;

  if (prohibited.length) {
    return { ...base, status: 'prohibited', links: prohibited.map(ecfr),
      ...render('check.fda.prohibited', { sections: listed(prohibited), ...slots }) };
  }
  if (direct.length) {
    return { ...base, status: 'regulated', links: direct.slice(0, SHOW_SECTIONS).map(ecfr),
      ...render('check.fda.regulated', { sections: listed(direct), ...slots }) };
  }
  if (contact.length) {
    return { ...base, status: 'contact_only', links: contact.slice(0, SHOW_SECTIONS).map(ecfr),
      ...render('check.fda.contact_only', { sections: listed(contact), ...slots }) };
  }
  const flavour = hits.some(r => r.payload.fema);
  return { ...base, status: flavour ? 'flavouring' : 'inventory',
    ...render(flavour ? 'check.fda.flavouring' : 'check.fda.inventory', slots) };
}

function iarcCheck(ident, records, meta) {
  const iarc = records.filter(r => r.source_key === 'iarc');
  const { hits: found, via } = pick(iarc, ident);
  // "Acetaminophen (see Paracetamol)" points at the classified entry
  const hits = found.flatMap(r => (r.payload.see
    ? iarc.filter(t => t.payload.group && t.names_normalised.includes(normalise(r.payload.see)))
    : [r])).filter(r => r.payload.group);
  const slots = { instrument: INSTRUMENT.iarc, checked: meta?.retrieved_at };
  if (!hits.length) {
    return { status: 'not_found', url: SOURCE.iarc.home, caveat: CAVEATS.iarc, ...render('check.iarc.not_found', slots) };
  }
  const h = [...hits].sort((a, b) => GROUP_ORDER[a.payload.group] - GROUP_ORDER[b.payload.group])[0];
  const groupText = IARC_GROUPS[h.payload.group];
  const vols = h.payload.volumes.length ? `Monographs volume${h.payload.volumes.length > 1 ? 's' : ''} ${h.payload.volumes.join(', ')}` : null;
  return { status: 'classified', group: h.payload.group, url: h.url, matchedAs: h.name, via,
    detail: [vols, h.payload.evaluated && `evaluated ${h.payload.evaluated}`].filter(Boolean).join(', ') || null,
    ...render('check.iarc.classified', { agent: h.name, group: h.payload.group, groupText, ...slots },
      { verbatim: [h.name, groupText] }) };
}

function prop65Check(ident, records, meta) {
  const p65 = records.filter(r => r.source_key === 'prop65');
  let { hits, via } = pick(p65, ident);
  // Some listings name the substance with a scope in brackets and no CAS
  // number: "Titanium dioxide (airborne, unbound particles of respirable size)".
  // Shown in OEHHA's words, scope and all, and never scored: a listing about
  // breathing dust is not a finding about eating it (docs/methodology.md).
  let scoped = false;
  if (!hits.length) {
    hits = p65.filter(r => ident.terms.some(t => r.name.toLowerCase().startsWith(`${t.toLowerCase()} (`)));
    scoped = hits.length > 0;
    via = scoped ? 'name, with the listing\'s scope' : null;
  }
  // "List dated 2026-07-31" -> "list dated 31 July 2026", like every other date on screen
  const dated = meta?.published?.replace(/\d{4}-\d{2}-\d{2}/, d => humanDate(d)).replace(/^L/, 'l');
  const slots = { instrument: `${INSTRUMENT.prop65}${dated ? ` (${dated})` : ''}`, checked: meta?.retrieved_at };
  if (!hits.length) {
    return { status: 'not_found', url: SOURCE.prop65.home, ...render('check.prop65.not_found', slots) };
  }
  const agent = hits[0].name;
  const same = hits.filter(r => r.name === agent);
  const listings = same.map(r => `${r.payload.toxicity}, since ${humanDate(r.payload.listed) ?? r.payload.listed}`).join('; ');
  return { status: scoped ? 'listed_scoped' : 'listed', url: hits[0].url, matchedAs: agent, via,
    listings: same.map(r => ({ toxicity: r.payload.toxicity, listed: r.payload.listed })),
    ...render('check.prop65.listed', { agent, listings, ...slots },
      { verbatim: [agent, ...same.map(r => r.payload.toxicity)] }) };
}

// One oil, many spellings: FSSAI's "Sun flower seed oil" and "Soyabean oil",
// Codex's "Palm olein" and "Cottonseed oil", the canon's "sunflower oil".
// Compared only between oils, so dropping "seed" cannot merge an oil with a seed.
const oilKey = s => normalise(s).replace(/soya/g, 'soy').replace(/seed/g, '').replace(/[^\p{L}]/gu, '');

// FSSAI regulation 2.2.1 and CXS 210 cover oils and palm fractions. Butter and
// cocoa butter have standards elsewhere, and "no oil standard" beside them
// would read as "unregulated", so they get no line from these lists at all.
const namedOil = ident => ident.kind === 'oil_fat' && /oil|olein|stearin/.test(ident.display);

function standardCheck(key) {
  return (ident, records, meta) => {
    if (!namedOil(ident)) return null;
    const list = records.filter(r => r.source_key === key);
    const keys = new Set([...ident.names, ...ident.terms].map(oilKey).filter(Boolean));
    // The most specific standard wins: one naming the ingredient's own name,
    // then an exact name over a respelled one, then the longest name matched.
    // Canola's names include "rapeseed oil"; the low erucic acid standard is
    // still the one that describes it, and ordinary rapeseed oil's is not.
    const score = r => Math.max(-1, ...r.names_normalised.map(n => {
      const exact = ident.names.includes(n);
      if (!exact && !keys.has(oilKey(n))) return -1;
      return (n === ident.display ? 1000 : 0) + (exact ? 100 : 0) + n.split(' ').length;
    }));
    const hits = list.map(r => [score(r), r]).filter(([s]) => s >= 0).sort((a, b) => b[0] - a[0]).map(([, r]) => r);
    const edition = meta?.published ? ` (${meta.published})` : '';
    const slots = { instrument: `${INSTRUMENT[key]}${edition}`, checked: meta?.retrieved_at };
    const t = key === 'fssai-oils' ? 'fssai' : 'codex';
    if (!hits.length) return { status: 'not_found', url: SOURCE[key].home, ...render(`check.${t}.not_found`, slots) };
    const h = hits[0];
    return { status: 'standard', url: h.url, matchedAs: h.name,
      ...render(`check.${t}.standard`, { name: h.name, regulation: h.payload.regulation, ...slots }, { verbatim: [h.name] }) };
  };
}

const CHECKERS = [['eu-additives', euCheck], ['fda-substances', fdaCheck], ['iarc', iarcCheck], ['prop65', prop65Check],
  ['fssai-oils', standardCheck('fssai-oils')], ['codex-oils', standardCheck('codex-oils')]];

// matched: canon ingredients as resolveDeclaration returns them ({ id, ... }).
// Returns { checks: Map(ingredientId -> [check]), sources: [{ key, body, title, home, published, checkedAt }] }.
export async function sourceChecks(client, matched) {
  const checks = new Map(matched.map(m => [m.id, []]));
  if (!matched.length) return { checks, sources: [] };

  const { rows: idents } = await client.query(
    `select i.id, i.e_number, i.cas_number, i.kind, i.display_name,
            array_remove(array_agg(distinct s.normalised) filter
              (where s.lang = 'en' and s.kind in ('common', 'iupac', 'abbrev', 'trade')), null) as names,
            array_remove(array_agg(distinct s.term) filter (where s.kind = 'cas'), null) as cas,
            array_remove(array_agg(distinct s.term) filter (where s.lang = 'en' and s.kind in ('common', 'iupac')), null) as terms
     from canon.ingredient i left join canon.synonym s on s.ingredient_id = i.id
     where i.id = any($1) group by i.id`, [matched.map(m => m.id)]);
  const byId = new Map(idents.map(r => [r.id, {
    e: r.e_number, kind: r.kind, display: normalise(r.display_name), names: r.names ?? [], terms: r.terms ?? [], cas: uniq([r.cas_number, ...(r.cas ?? [])].filter(Boolean)),
  }]));
  const ids = [...byId.values()];

  const { rows: records } = await client.query(
    `select source_key, record_key, name, names_normalised, cas, e_number, url, payload
     from evidence.source_record
     where removed_in is null and source_key not in ('fssai-oils', 'codex-oils') and (
       (source_key = 'eu-additives' and e_number is not null
         and (e_number = any($1::text[]) or substring(e_number from '^E[0-9]+') = any($1::text[])))
       or (source_key <> 'eu-additives' and (cas && $2::text[] or names_normalised && $3::text[])))`,
    [uniq(ids.map(i => i.e).filter(Boolean)), uniq(ids.flatMap(i => i.cas)), uniq(ids.flatMap(i => i.names))]);

  // Named-oil standards are small lists matched by oil name, not CAS: all rows,
  // and only when the label has an oil.
  if (ids.some(namedOil)) {
    const { rows } = await client.query(
      `select source_key, record_key, name, names_normalised, cas, e_number, url, payload
       from evidence.source_record where removed_in is null and source_key in ('fssai-oils', 'codex-oils')`);
    records.push(...rows);
  }

  // Prop 65 listings scoped in brackets ("Titanium dioxide (airborne ...)")
  const likeEscape = t => t.replace(/[\\%_]/g, c => `\\${c}`);
  const scopedPatterns = uniq(ids.flatMap(i => i.terms)).map(t => `${likeEscape(t)} (%`);
  if (scopedPatterns.length) {
    const { rows } = await client.query(
      `select source_key, record_key, name, names_normalised, cas, e_number, url, payload
       from evidence.source_record where source_key = 'prop65' and removed_in is null and name ilike any($1)`, [scopedPatterns]);
    records.push(...rows.filter(r => !records.some(x => x.source_key === r.source_key && x.record_key === r.record_key)));
  }

  const see = uniq(records.filter(r => r.source_key === 'iarc' && r.payload.see).map(r => normalise(r.payload.see)));
  if (see.length) {
    const { rows } = await client.query(
      `select source_key, record_key, name, names_normalised, cas, e_number, url, payload
       from evidence.source_record where source_key = 'iarc' and removed_in is null and names_normalised && $1`, [see]);
    records.push(...rows.filter(r => !records.some(x => x.record_key === r.record_key)));
  }

  const { rows: snaps } = await client.query(
    `select distinct on (source_key) source_key, retrieved_at, published
     from evidence.source_snapshot order by source_key, id desc`);
  // pg hands timestamptz back as a Date; every consumer here wants the ISO
  // string (humanDate reads "2026-09-22..." and prints nothing for a Date).
  const meta = new Map(snaps.map(s => [s.source_key, { ...s, retrieved_at: new Date(s.retrieved_at).toISOString() }]));

  const used = new Set();
  for (const m of matched) {
    const ident = byId.get(m.id);
    if (!ident) continue;
    for (const [key, check] of CHECKERS) {
      if (!meta.has(key)) continue;   // never synced: saying "no entry" would be a lie
      const c = check(ident, records, meta.get(key));
      if (!c) continue;
      used.add(key);
      checks.get(m.id).push({ source: key, body: SOURCE[key].body, checkedAt: meta.get(key).retrieved_at,
        published: meta.get(key).published, ...c });
    }
  }

  const sources = [...used].map(key => ({
    key, body: SOURCE[key].body, title: SOURCE[key].title, home: SOURCE[key].home,
    published: meta.get(key).published, checkedAt: meta.get(key).retrieved_at,
  }));
  return { checks, sources };
}
