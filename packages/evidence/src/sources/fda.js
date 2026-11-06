import { parseCsv, plainText, CAS } from './text.js';

// FDA's Substances Added to Food inventory (formerly EAFUS). It says of itself
// that inclusion "does not indicate an FDA approval": only the 21 CFR sections
// in a row carry legal weight, so the parser keeps them by kind, and Part 189
// (substances prohibited from use in human food) separately.
export const source = {
  key: 'fda-substances',
  body: 'FDA',
  title: 'Substances Added to Food inventory (formerly EAFUS)',
  url: 'https://www.hfpappexternal.fda.gov/scripts/fdcc/cfc/XMLService.cfm?method=downloadxls&set=FoodSubstances',
  home: 'https://www.hfpappexternal.fda.gov/scripts/fdcc/?set=FoodSubstances',
  ext: 'csv',
  parse,
};

// The inventory's detail pages are keyed by the substance name with everything
// but letters and digits removed: "SILICON DIOXIDE" -> id=SILICONDIOXIDE.
const detailUrl = name =>
  `https://www.hfpappexternal.fda.gov/scripts/fdcc/index.cfm?set=FoodSubstances&id=${name.toUpperCase().replace(/[^A-Z0-9]/g, '')}`;

// Excel text formulas (=T("172.515")) wrap most identifiers in the export.
const cell = s => String(s ?? '').replace(/^\s*=T\("(.*)"\)\s*$/s, '$1').trim();

// "Last updated 7/28/2026" -> "2026-07-28"
function usDate(s) {
  const m = /(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s ?? '');
  return m ? `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` : null;
}

export function parse(buf) {
  // Windows-1252, not UTF-8: latin1 is the right decoding for its one high byte.
  const rows = parseCsv(buf.toString('latin1'));
  const h = rows.findIndex(r => /^CAS Reg No/i.test(r[0] ?? ''));
  if (h < 0) throw new Error('FDA: header row "CAS Reg No (or other ID)" not found');
  const head = rows[h].map(c => c.trim());
  const col = name => head.indexOf(name);
  const cols = prefix => head.map((c, i) => (c.startsWith(prefix) ? i : -1)).filter(i => i >= 0);

  const preamble = rows.slice(0, h).map(r => r.join(',').trim()).filter(Boolean);
  const updated = usDate(preamble.find(l => /last updated/i.test(l)));
  const notice = preamble.find(l => /does not indicate an FDA approval/i.test(l)) ?? null;

  const I = {
    id: col('CAS Reg No (or other ID)'), name: col('Substance'), other: col('Other Names'),
    effect: col('Used for (Technical Effect)'), prohibited: col('Reg prohibited189'),
    fema: col('FEMA No'), grasPub: col('GRAS Pub No'), femaStatus: col('FEMA status'), jecfa: col('JECFA Flavor Number'),
  };
  const colourCols = cols('Reg col');
  const additiveCols = cols('Reg add');
  const otherCols = [col('Reg Administrative'), col('regs Labeling & Standards')].filter(i => i >= 0);
  // one cell can hold several sections: "160.105 ,  160.185"
  const pick = (r, idx) => idx.flatMap(i => cell(r[i]).split(/\s*[,;]\s*/)).filter(Boolean);

  const records = [];
  for (const r of rows.slice(h + 1)) {
    const name = plainText(cell(r[I.name]));
    if (!name) continue;
    const id = cell(r[I.id]);
    const others = String(r[I.other] ?? '').split(/<br\s*\/?>/i)
      .map(s => plainText(s).replace(/^♦\s*/, ''))
      .filter(s => s && !/^InChI(Key)?\b/i.test(s));
    // Part 189 entries are named "CYCLAMATE--PROHIBITED": the verbatim name is
    // kept for display, the bare substance name for matching.
    const bare = name.replace(/\s*--\s*PROHIBITED.*$/i, '').trim();
    records.push({
      record_key: `${id}|${name}`,
      name,
      names: [name, bare, ...others],
      cas: CAS.test(id) ? [id] : [],
      url: detailUrl(name),
      payload: {
        id,
        technicalEffect: plainText(cell(r[I.effect])) || null,
        cfr: {
          colour: pick(r, colourCols),
          additive: pick(r, additiveCols),
          prohibited: I.prohibited >= 0 ? pick(r, [I.prohibited]) : [],
          other: pick(r, otherCols),
        },
        fema: cell(r[I.fema]) || null,
        femaStatus: cell(r[I.femaStatus]) || null,
        grasPub: cell(r[I.grasPub]) || null,
        jecfa: cell(r[I.jecfa]) || null,
      },
    });
  }
  return {
    published: updated ? `Last updated ${updated}` : null,
    notice,
    records,
  };
}
