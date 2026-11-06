import { plainText } from './text.js';

// The EU Food Additives Database on the Food and Feed Information Portal: the
// Union list of Regulation (EC) No 1333/2008, Annex II, as the Commission
// maintains it. The portal's own backend serves the whole list as one JSON.
export const source = {
  key: 'eu-additives',
  body: 'European Commission',
  title: 'Union list of food additives, Regulation (EC) No 1333/2008 Annex II (EU Food Additives Database)',
  url: 'https://ec.europa.eu/food/food-feed-portal/backend/api/policy-items?foodDomain=fin&authorisationType=fad_auth',
  home: 'https://ec.europa.eu/food/food-feed-portal/screen/food-additives/search',
  ext: 'json',
  parse,
};

const detailUrl = code => `https://ec.europa.eu/food/food-feed-portal/screen/food-additives/search/details/${code}`;

const RESTRICTION = { FAD_RT_QS: 'quantum satis', FAD_RT_ML: 'maximum level' };
const UNIT = { FAD_RU_MGK: 'mg/kg', FAD_RU_MGL: 'mg/l' };

const list = x => (x == null ? [] : Array.isArray(x) ? x : [x]);

// The portal's JSON is a generic value tree: every node is
// { valueIdentifier, value, childrenValues }. Fold it into plain objects; a
// repeated identifier becomes an array (leaves are never arrays themselves).
function fold(node) {
  const o = {};
  for (const c of node.childrenValues ?? []) {
    const v = c.childrenValues?.length ? fold(c) : c.value;
    const k = c.valueIdentifier;
    o[k] = !(k in o) ? v : Array.isArray(o[k]) ? [...o[k], v] : [o[k], v];
  }
  return o;
}

function latestEdit(node, max = '') {
  if (node.lastModificationDate > max) max = node.lastModificationDate;
  for (const c of node.childrenValues ?? []) max = latestEdit(c, max);
  return max;
}

// "E 551" -> "E551", "E 500(ii)" -> "E500ii": the canon's form. An annotated
// number ("E 311/ Removed from Union list") keeps its number; anything else in
// the field ("E 334 – 337 and E 354:") is not one additive's number.
const E_RAW = /^E\s*(\d{3,4}[a-z]?)(?:\s*\(\s*([ivx]+)\s*\))?\s*(?:\/.*)?$/i;
const eNumber = raw => {
  const m = E_RAW.exec(String(raw ?? '').trim());
  return m ? `E${m[1].toLowerCase()}${(m[2] ?? '').toLowerCase()}` : null;
};

// Delisted additives stay in the database, marked on their own number or name:
// "E 311/ Removed from Union list", "Calcium sorbate/Deleted from the Union
// list". Only those two fields count. Notes mention OTHER items' deletions:
// annatto bixin's note says E 160b "is deleted from the Union List and is
// replaced by" it, and reading that as its own delisting called an additive
// with 26 authorised uses unauthorised.
const DELISTED = /\/\s*(removed|deleted) from (the )?union list/i;
const stripDelisted = s => s.replace(/\s*\/\s*(removed|deleted) from (the )?union list.*$/i, '').trim();

function readItem(tree) {
  const o = fold(tree);
  const spec = o.policyItemSpecs ?? {};
  // Items with no conditions of use still carry one placeholder whose every
  // field is null. Counting it made titanium dioxide "authorised for food";
  // a use exists only when it names a food category.
  // One food category can carry several restrictions (erythrosine: 200 mg/kg
  // "only cocktail cherries and candied cherries", 150 mg/kg "only bigareaux
  // cherries in syrup"). Each is a use; reading only one blanked 301 of them.
  const uses = list(o.conditionsOfUse?.foodCategoryRestriction)
    .filter(u => u?.foodCategory?.foodCategoryId)
    .flatMap(u => (list(u.restriction).length ? list(u.restriction) : [{}]).map(r => {
      const unit = UNIT[r.restrictionUnit] ?? r.restrictionUnit ?? '';
      return {
        type: RESTRICTION[r.restrictionType] ?? r.restrictionType ?? null,
        level: r.restrictionValue ? `${plainText(r.restrictionValue)}${unit && !/[a-z]\/[a-z]/i.test(r.restrictionValue) ? ` ${unit}` : ''}` : null,
        comment: plainText(r.restrictionComment) || null,
      };
    }));
  return {
    code: o.policyItemCode,
    group: spec.policyItemType === 'group',
    eRaw: spec.substanceFAD?.eNumber ?? null,
    ins: spec.substanceFAD?.insNumber ?? null,
    name: plainText(spec.displayName || spec.identifyingName),
    identifying: plainText(spec.identifyingName),
    synonyms: list(spec.substanceFAD?.synonyms).flatMap(s => plainText(s).split(/\s*;\s*/)).filter(Boolean),
    members: list(spec.group?.groupMemberRefs),
    note: plainText(spec.policyItemNote?.policyItemNoteText) || null,
    message: plainText(spec.policyItemMessage?.policyItemMessageText) || null,
    uses,
    laws: list(o.legislationWrapper?.legislation)
      .map(l => ({ act: plainText(l.legislationText) || null, title: plainText(l.legislationTitle) || null, url: l.eurlexLink || null }))
      .filter(l => l.act || l.title),
  };
}

export function parse(buf) {
  const trees = JSON.parse(buf.toString('utf8'));
  if (!Array.isArray(trees)) throw new Error('EU: expected an array of policy items');
  const items = trees.map(readItem);

  const groupsOf = new Map();   // member code -> the groups listing it
  for (const g of items.filter(i => i.group)) {
    for (const m of g.members) groupsOf.set(m, [...(groupsOf.get(m) ?? []), g]);
  }

  const records = items.map(i => {
    const groups = groupsOf.get(i.code) ?? [];
    const viaGroups = groups.filter(g => g.uses.length);
    const delisted = [i.eRaw, i.name].some(t => DELISTED.test(t ?? ''));
    const name = stripDelisted(i.name);
    return {
      record_key: i.code,
      name,
      names: [name, stripDelisted(i.identifying), ...i.synonyms],
      cas: [],
      e_number: i.group ? null : eNumber(i.eRaw),
      url: detailUrl(i.code),
      payload: {
        type: i.group ? 'group' : 'substance',
        eNumber: i.eRaw,
        ins: i.ins,
        // Authorised for food only when the Union list gives it a food use,
        // directly or through a group that has one. Being listed is not enough:
        // titanium dioxide (E 171) is still in the database, with no food uses
        // and a note that it is not authorised, under Regulation (EU) 2022/63.
        authorisedForFood: !delisted && (i.uses.length > 0 || viaGroups.length > 0),
        delisted,
        groups: groups.map(g => ({ code: g.code, name: g.name, uses: g.uses.length })),
        uses: i.uses,
        note: i.note,
        message: i.message,
        laws: i.laws,
      },
    };
  });

  const edited = trees.reduce((max, t) => latestEdit(t, max), '').slice(0, 10);
  return { published: edited ? `Entries last edited ${edited}` : null, records };
}
