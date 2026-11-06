// Label text -> canonical match key.
//
// Real labels write the same substance as "E102", "E 102", "INS 102", "(102)",
// "FD&C Yellow No. 5" and "Colour (Tartrazine)". Everything that goes into
// canon.synonym.normalised and everything looked up against it passes here.

const CODE_PREFIX = /\b(e|ins)\s+(\d+[a-z]*)\b/g;
// "E 500(ii)" arrives here as "e500 ii": the Roman sub-number is part of the
// code, and the canon writes it joined ("E500ii").
const CODE_SUBNUMBER = /\b(e|ins)(\d+[a-z]?)\s+([ivx]{1,4})\b/g;

export function normalise(term) {
  return String(term)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')      // strip Latin combining marks only
    .normalize('NFC')                     // recompose: Indic vowel signs are marks,
    .toLowerCase()                        // not decoration, and must survive
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, ' ')  // \p{M} keeps मात्रा, nukta, etc.
    .trim()
    .replace(/\s+/g, ' ')
    .replace(CODE_PREFIX, '$1$2')         // "e 102" -> "e102", "ins 102" -> "ins102"
    .replace(CODE_SUBNUMBER, '$1$2$3');   // "e500 ii" -> "e500ii"
}

// Split a raw ingredient declaration into candidate terms.
//
// Real declarations nest and elide. "Vegetable Oil (Sunflower, Corn, and/or
// Canola Oil)" must not be split on the commas inside the bracket, and the
// head noun "Oil" is stated once but belongs to all three items.

const HEAD_NOUNS = new Set(['oil','oils','fat','fats','syrup','powder','extract','flour','starch','solids']);

// Form modifiers describe how a substance was processed, not which substance it
// is. "LACTOSERUM en poudre" is whey; stripping the modifier gives the resolver
// a second, better candidate.
const FORM_MODIFIERS = /\b(en poudre|in powder|powdered|powder|dried|dehydrated|concentrated|concentrate|refined|edible|pure)\b/gi;

// Quantity declarations are not ingredients. Without this, "cacao maigre 7,4%"
// leaves "7,4%" behind as a term and the content lead's queue fills with noise.
// NB: a trailing \b never matches after "%", which is not a word character.
const QUANTITY = /\b\d+([.,]\d+)?\s*(%|mg|kg|ml|g|l)(?![\p{L}\d])/giu;

// Phrases that appear inside ingredient declarations but are not ingredients:
// allergen advice, dietary claims, and list headers. Every real label has them.
const NON_INGREDIENT = [
  /^ingredients?$/i, /^ingr[ée]dients?$/i, /^zutaten$/i, /^ingredientes$/i,
  /^sans\s+\w+/i, /^\w+\s*[- ]?free$/i, /^gluten[- ]?free$/i,
  /^may\s+contain/i, /^contains\b/i, /^peut\s+contenir/i, /^kann\s+.*enthalten/i,
  /^allergy\s+advice/i, /^allerg/i, /^traces?\s+(of|de)\b/i,
  /^best\s+before/i, /^storage/i, /^produced\s+in/i, /^made\s+in/i,
];
const isLabelClaim = t => NON_INGREDIENT.some(re => re.test(t.trim()));

const isNoise = t => !/\p{L}/u.test(t) || t.replace(/[^\p{L}]/gu, '').length < 2;

function splitTopLevel(text) {
  const out = [];
  let depth = 0, cur = '';
  for (const ch of text) {
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth = Math.max(0, depth - 1);
    if (depth === 0 && (ch === ',' || ch === ';')) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out.map(s => s.trim()).filter(Boolean);
}

// "Sunflower, Corn, and/or Canola Oil" -> the trailing head noun is distributed
// back over the bare items, so each resolves as a substance in its own right.
function expandList(inner) {
  const items = inner.split(/,|\band\/or\b|\band\b|\bor\b|&/i).map(s => s.trim()).filter(Boolean);
  const out = [...items];
  if (items.length > 1) {
    const lastTokens = items[items.length - 1].split(/\s+/);
    const head = lastTokens[lastTokens.length - 1];
    if (lastTokens.length > 1 && HEAD_NOUNS.has(head.toLowerCase())) {
      for (const it of items.slice(0, -1)) {
        if (!new RegExp(`\\b${head}\\b`, 'i').test(it)) out.push(`${it} ${head}`);
      }
    }
  }
  return out;
}

// A declaration usually sits under a heading and, from on-device OCR, runs on
// into the rest of the panel: "... Tomato Powder. MANUFACTURED BY: Alimento
// Agro Foods ... NUTRITION INFORMATION ..." arrives as one string. The list
// starts after its heading and stops at the next section of the pack.
const LIST_HEADING = /(?:^|[^\p{L}])(?:ingredients?|ingr[ée]dients?|zutaten|ingredientes|ingredienti|सामग्री|अवयव)\s*[:：]\s*/iu;
// "Manufactured" alone, not only "manufactured by": on-device OCR drops the
// "BY" often enough ("Sulphite MANUFACTURED") to leak the address in.
const NEXT_SECTION = /\b(?:nutrition(?:al)?\s+(?:information|facts|value)|manufactured|marketed\s+by|mfd\.?\s+by|mkd\.?\s+by|packed\s+by|brand\s+owned|best\s+before|use\s+by|fssai|lic\.?\s*no|customer\s+care|net\s+(?:wt|weight|quantity)|allergen\s+information)\b/i;

function declarationText(raw) {
  // A word broken across a line, as OCR returns it: "Cinna- mon". Only a
  // lowercase continuation, so a real hyphen before a capital is left alone.
  let s = String(raw).replace(/(\p{L})-\s+(\p{Ll})/gu, '$1$2');
  const heading = LIST_HEADING.exec(s);
  if (heading) s = s.slice(heading.index + heading[0].length);
  const end = s.search(NEXT_SECTION);
  return end > 0 ? s.slice(0, end) : s;
}

// What a removed quantity leaves behind: "Makhana (Fox Nuts - 70%)" becomes
// "Makhana (Fox Nuts - )", "Himalayan Salt (1.4%)" becomes "Himalayan Salt ( )".
function tidy(s) {
  return s.replace(QUANTITY, ' ')
    .replace(/\s*[-–:]\s*(?=[)\]])/g, '')   // a dash or colon stranded before a closing bracket
    .replace(/[([]\s*[)\]]/g, ' ')           // brackets left empty
    .replace(/\s*[-–]\s*$/, '')              // a dash stranded at the end
    .replace(/\.$/, '')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,;])/g, '$1')
    .trim();
}

// The contents of each top-level bracket pair, however deeply nested, and a
// bracket left open to the end (real labels have them).
function bracketGroups(text) {
  const out = [];
  let depth = 0, start = -1;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '(' || ch === '[') { if (depth++ === 0) start = i + 1; }
    else if ((ch === ')' || ch === ']') && depth > 0 && --depth === 0) out.push(text.slice(start, i));
  }
  if (depth > 0) out.push(text.slice(start));
  return out;
}

// The text outside every bracket: "Seasoning [Maltodextrin, Salt (1.4%)]" -> "Seasoning".
function outside(text) {
  let s = text, prev;
  do { prev = s; s = s.replace(/[([][^()[\]]*[)\]]/g, ' '); } while (s !== prev);
  return s.replace(/[()[\]]/g, ' ').replace(/\s+/g, ' ').trim();
}

const headNoun = text => {
  const last = String(text).trim().split(/\s+/).at(-1) ?? '';
  return HEAD_NOUNS.has(last.toLowerCase()) ? last : null;
};

// On-device OCR reads O as 0 and l as 1 inside words: "Edible Vegeta ble 0il
// (Sunflower)", "0i1". Mapping them back is offered as an EXTRA candidate, never
// a replacement, and codes are left alone, so "Vitamin B1", "E150d" and
// "INS 551" still reach the resolver exactly as printed.
function ocrVariant(s) {
  return s.replace(/[\p{L}\d]+/gu, tok => {
    if (!/\p{L}/u.test(tok) || !/[01]/.test(tok)) return tok;
    // an additive code has three or four digits (E150d, INS 500ii); "0il" is not one
    if (/^(?:e|ins)?\d{3,4}[a-z]{0,4}$/i.test(tok)) return tok;
    return tok.replace(/0/g, 'o').replace(/1/g, 'l');
  });
}

// Candidates for one declaration entry, and its components when it lists them.
//
// Brackets mean two different things on labels. A list of two or more is the
// entry's components: "Seasoning [Maltodextrin, Sugar, Black Salt]" contains
// all three, each resolved and, if unknown, reported on its own; lumping them
// together let one match (Sugar) hide the rest. A single entry says what the
// entry is ("Edible Vegetable Oil (Palmolein)", "Makhana (Fox Nuts)"), so it
// stays a candidate for the entry itself. A head noun stated once belongs to
// what it qualifies: "Vegetable Oil (Sunflower)" is sunflower oil.
function entry(text, inherited = null, variant = true) {
  const clean = tidy(text);
  if (!clean || isNoise(clean) || isLabelClaim(clean)) return null;
  const out = [clean];
  const fixed = variant ? ocrVariant(text) : text;
  if (fixed !== text) out.push(...(entry(fixed, inherited, false)?.candidates ?? []));

  const destripped = clean.replace(FORM_MODIFIERS, ' ').replace(/\s+/g, ' ').trim();
  if (destripped && destripped !== clean) out.push(destripped);

  // "emulsifiants: lecithines" / "colorants: E102, E110" — the class name is
  // on the left of the colon, the actual substances on the right. Ubiquitous
  // on European labels and the reason a whole panel can resolve to nothing.
  const afterColon = clean.includes(':') ? clean.slice(clean.indexOf(':') + 1).trim() : null;
  const body = afterColon || clean;
  if (afterColon) out.push(afterColon);

  const head = outside(body);
  if (head && head !== body) out.push(head, ...expandList(head));
  else out.push(...expandList(body));
  if (inherited && head && !new RegExp(`\\b${inherited}\\b`, 'i').test(head)) out.push(`${head} ${inherited}`);

  const noun = headNoun(head) ?? inherited;
  const members = [];
  for (const inner of bracketGroups(body)) {
    const parts = splitTopLevel(inner).map(x => x.replace(/^(?:and\/or|and|or|&)\s+/i, '').trim()).filter(Boolean);
    if (parts.length >= 2) {
      const listNoun = headNoun(outside(parts.at(-1))) ?? noun;
      for (const x of parts) {
        const e = entry(x, listNoun);
        // A component that lists components of its own ("Flavour Enhancers
        // (INS 627, INS 631)") is judged by them, exactly like a top-level item.
        if (e) members.push(Object.assign(e.candidates, { listed: e.members.length > 0 }), ...e.members);
      }
    } else if (parts.length === 1) {
      const e = entry(parts[0], noun);
      if (e) { out.push(...e.candidates); members.push(...e.members); }
    }
  }
  const candidates = [...new Set(out.map(t => t.trim()).filter(t => t && !isNoise(t)))];
  return candidates.length ? { candidates, members } : null;
}

// Candidates grouped by the top-level declaration item they came from; each
// group's `members` holds its listed components, each a candidate list of its
// own. Grouping matters downstream: within one candidate list, one match
// supersedes the rest, which then must not pollute the work queue.
export function splitIngredientGroups(raw) {
  if (!raw) return [];
  const groups = [];
  // a full stop inside a declaration ends the list: "vanilline. Sans gluten"
  // is one ingredient followed by a marketing claim, not one ingredient.
  const parts = splitTopLevel(declarationText(raw)).flatMap(p => p.split(/\.\s+/));
  for (const part of parts) {
    const e = entry(part);
    if (e) groups.push(Object.assign(e.candidates, { members: e.members }));
  }
  return groups;
}

export function splitIngredients(raw) {
  return [...new Set(splitIngredientGroups(raw).flatMap(g => [...g, ...g.members.flat()]))];
}
