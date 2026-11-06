// Executable form of docs/claim-templates.md.
//
// Every published sentence about a named product comes from here. Slots are
// filled from database rows only — never from model output. A claim that does
// not come from a template in this file does not ship, and the template id is
// recorded on verdict.claim_version so any claim can be reconstructed.
//
// A rendered claim has two parts that are always shown together: `text`, the
// finding in plain words, and `citation`, the instrument (and date) behind it.
// They are split so the finding reads at reading weight and the legal reference
// at footnote weight — never so that either can be shown without the other.

export const METHOD_VERSION = '0.3.0';

// `name` reads inside a sentence, `short` fits a chip, `label` qualifies a
// label ("the Indian label"). Readers do not think in ISO codes: "US-CA" on a
// consumer screen was a design-review finding, not a style preference.
const PLACE = {
  EU:      { name: 'the European Union', short: 'EU',          label: 'EU' },
  US:      { name: 'the United States',  short: 'US',          label: 'US' },
  'US-CA': { name: 'California',         short: 'California',  label: 'Californian' },
  IN:      { name: 'India',              short: 'India',       label: 'Indian' },
  GB:      { name: 'the United Kingdom', short: 'UK',          label: 'UK' },
  FR:      { name: 'France',             short: 'France',      label: 'French' },
  DE:      { name: 'Germany',            short: 'Germany',     label: 'German' },
  ES:      { name: 'Spain',              short: 'Spain',       label: 'Spanish' },
  IT:      { name: 'Italy',              short: 'Italy',       label: 'Italian' },
  NL:      { name: 'the Netherlands',    short: 'Netherlands', label: 'Dutch' },
  CA:      { name: 'Canada',             short: 'Canada',      label: 'Canadian' },
  AU:      { name: 'Australia',          short: 'Australia',   label: 'Australian' },
};

export const jurisdictionName = j => PLACE[j]?.name ?? j;
export const marketLabel = m => PLACE[m]?.label ?? m;

// Acronyms are how regulators talk, not how readers do. Each expansion is the
// body's own description of itself.
const BODY = {
  IARC: "IARC, the World Health Organization's cancer agency,",
  EFSA: 'EFSA, the European Food Safety Authority,',
  JECFA: 'JECFA, the joint FAO/WHO expert committee on food additives,',
  NTP: 'the US National Toxicology Program',
};

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];

// '2027-01-01' -> '1 January 2027'. Parsed from the string, never via Date:
// a Date lands at local midnight and can print the day before. Regulatory
// dates are published facts (see CLAUDE.md, "Read DATE as a string").
export function humanDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ''));
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : null;
}

// "EU Food Additives Database · checked 22 September 2026"
const checkedCitation = (instrument, checked) => (checked ? `${instrument} · checked ${humanDate(checked)}` : instrument);

const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const count = n => (n <= 10 ? WORDS[n] : String(n));
const cap = s => (s ? s[0].toUpperCase() + s.slice(1) : s);

export function joinList(names, conj = 'and') {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} ${conj} ${names[names.length - 1]}`;
}

// Forbidden anywhere in generated output. Asserted by the test suite against
// every rendered claim, so a careless template edit fails the build.
export const FORBIDDEN = [
  'causes', 'toxic', 'poison', 'poisonous', 'dangerous', 'unsafe',
  'inferior', 'deliberate', 'cheaper for', 'gets away with',
];

const T = {
  // --- regulatory status ---
  'reg.banned': ({ ingredient, jurisdiction, instrument, date }) => ({
    text: `${ingredient} is not permitted in food in ${jurisdictionName(jurisdiction)}.`,
    citation: date ? `${instrument} · in force since ${humanDate(date)}` : instrument,
  }),

  'reg.pending': ({ ingredient, jurisdiction, instrument, date }) => ({
    text: `${cap(jurisdictionName(jurisdiction))} has adopted a ban on ${ingredient} taking effect ` +
      `${humanDate(date)}. It remains permitted until then.`,
    citation: instrument,
  }),

  'reg.warning': ({ ingredient, jurisdiction, instrument, warningText }) => ({
    text: `In ${jurisdictionName(jurisdiction)}, food containing ${ingredient} must carry the ` +
      `label warning: '${warningText}'.`,
    citation: instrument,
  }),

  'reg.restricted': ({ ingredient, jurisdiction, instrument, scope }) => ({
    text: `${cap(jurisdictionName(jurisdiction))} permits ${ingredient} only in ${scope}.`,
    citation: instrument,
  }),

  // --- hazard findings ---
  'hazard.classification': ({ body, ingredient, finding, instrument }) => ({
    text: `${cap(BODY[body] ?? body)} classifies ${ingredient} as ${finding}.`,
    citation: instrument,
  }),

  // A statutory listing is not a scientific classification and must not be
  // worded as one. Prop 65 lists chemicals; IARC classifies them.
  'hazard.listing': ({ ingredient, finding, instrument }) => ({
    text: `${ingredient} appears on California's Proposition 65 list of chemicals ${finding}.`,
    citation: instrument,
  }),

  // --- composition ---
  // The range is a sum of the standard's per-fatty-acid ranges, and the
  // sentence says so: the standard itself never prints this total.
  'composition.saturated': ({ ingredient, low, high, instrument }) => ({
    text: `The Codex standard's ranges for each saturated fatty acid in ${ingredient} add up to ` +
      `${low}–${high}% of its fatty acids.`,
    citation: instrument,
  }),

  // --- source checks: what each official list says, looked up in the daily
  // mirror (evidence.source_record) by E number, CAS number or exact name.
  // A lookup that finds nothing says it found nothing: it is never worded as a
  // clean bill of health, and never as a ban either (gelatin is "E428" on
  // labels and has no entry on the EU additive list, because the EU treats it
  // as a food).
  'check.eu.authorised': ({ eNumbers, instrument, checked }) => ({
    text: `Authorised as a food additive in the European Union, as ${eNumbers}.`,
    citation: checkedCitation(instrument, checked),
  }),

  'check.eu.limited': ({ eNumber, uses, instrument, checked }) => ({
    text: `The European Union limits ${eNumber} to named foods: ${uses}.`,
    citation: checkedCitation(instrument, checked),
  }),

  'check.eu.no_food_use': ({ eNumber, instrument, checked }) => ({
    text: `${eNumber} is in the EU additives database without any food it is authorised in.`,
    citation: checkedCitation(instrument, checked),
  }),

  'check.eu.delisted': ({ eNumber, instrument, checked }) => ({
    text: `${eNumber} has been removed from the EU list of authorised food additives.`,
    citation: checkedCitation(instrument, checked),
  }),

  'check.eu.not_found': ({ eNumber, instrument, checked }) => ({
    text: `The EU list of authorised food additives has no entry for ${eNumber}.`,
    citation: checkedCitation(instrument, checked),
  }),

  // Part 189's own title: "Substances prohibited from use in human food".
  'check.fda.prohibited': ({ sections, instrument, checked }) => ({
    text: `US federal rules list it among substances prohibited from use in human food (${sections}).`,
    citation: checkedCitation(instrument, checked),
  }),

  'check.fda.regulated': ({ sections, instrument, checked }) => ({
    text: `Listed in US federal food regulations: ${sections}.`,
    citation: checkedCitation(instrument, checked),
  }),

  'check.fda.contact_only': ({ sections, instrument, checked }) => ({
    text: `Listed in US federal regulations only for materials that touch food: ${sections}.`,
    citation: checkedCitation(instrument, checked),
  }),

  'check.fda.flavouring': ({ instrument, checked }) => ({
    text: "In FDA's inventory of substances added to food as a flavouring, with no FDA regulation cited.",
    citation: checkedCitation(instrument, checked),
  }),

  'check.fda.inventory': ({ instrument, checked }) => ({
    text: "In FDA's inventory of substances added to food, with no FDA regulation cited.",
    citation: checkedCitation(instrument, checked),
  }),

  'check.fda.not_found': ({ instrument, checked }) => ({
    text: "No entry in FDA's inventory of substances added to food for this name or CAS number.",
    citation: checkedCitation(instrument, checked),
  }),

  // IARC's own agent name and group wording, both quoted.
  'check.iarc.classified': ({ agent, group, groupText, instrument, checked }) => ({
    text: `${cap(BODY.IARC)} classifies "${agent}" in Group ${group}: ${groupText}.`,
    citation: checkedCitation(instrument, checked),
  }),

  'check.iarc.not_found': ({ instrument, checked }) => ({
    text: 'No IARC classification found for this name or CAS number.',
    citation: checkedCitation(instrument, checked),
  }),

  // A statutory listing, worded as one (see hazard.listing). The chemical's
  // name is OEHHA's, scope included: "(airborne, unbound particles ...)".
  'check.prop65.listed': ({ agent, listings, instrument, checked }) => ({
    text: `"${agent}" appears on California's Proposition 65 list: ${listings}.`,
    citation: checkedCitation(instrument, checked),
  }),

  'check.prop65.not_found': ({ instrument, checked }) => ({
    text: 'No Proposition 65 listing found for this name or CAS number.',
    citation: checkedCitation(instrument, checked),
  }),

  // Product standards: what a named oil must be to be sold as that oil. Not a
  // safety evaluation, and never worded as one. The oil's name is the body's.
  'check.fssai.standard': ({ name, regulation, instrument, checked }) => ({
    text: `India's food regulator, FSSAI, has a standard that "${name}" sold in India must meet (regulation ${regulation}).`,
    citation: checkedCitation(instrument, checked),
  }),

  'check.fssai.not_found': ({ instrument, checked }) => ({
    text: 'No FSSAI oil standard found under this name.',
    citation: checkedCitation(instrument, checked),
  }),

  'check.codex.standard': ({ name, instrument, checked }) => ({
    text: `The Codex Alimentarius, the FAO/WHO food standards body, has an international standard for "${name}".`,
    citation: checkedCitation(instrument, checked),
  }),

  'check.codex.not_found': ({ instrument, checked }) => ({
    text: 'No Codex named-oil standard found under this name.',
    citation: checkedCitation(instrument, checked),
  }),

  // Under every list of checked sources.
  'note.sources': ({ checked }) => ({
    text: '* Verso does not produce this information. Each item is published by the official source ' +
      'linked beside it (a regulator, a WHO agency or a court) and was last checked on ' +
      `${humanDate(checked)}. Verso can't guarantee it; tap an item to read the source.`,
  }),

  // --- context: contaminants that form when an ingredient is processed ---
  // Never a finding against the ingredient and never scored: the label names the
  // oil, not the contaminant. EFSA's words, quoted.
  'context.process_contaminants': ({ ingredient, finding, instrument }) => ({
    text: `EFSA, the European Food Safety Authority, on contaminants that form when oils such as ` +
      `${ingredient.toLowerCase()} are refined: “${finding}”`,
    citation: instrument,
  }),

  // --- headlines: the top line of a verdict states the finding, never a mood ---
  // Which case applies is decided in build.js; each template words only its own.
  'headline.acted': ({ places, ingredients }) => ({
    text: `${cap(count(places))} ${places === 1 ? 'authority has' : 'authorities have'} acted on ` +
      `${ingredients.length === 1 ? ingredients[0] : `${count(ingredients.length)} ingredients here`}.`,
  }),

  'headline.listed': ({ ingredients }) => ({
    text: ingredients.length === 1
      ? `${ingredients[0]} is on a health agency's hazard list.`
      : `${cap(count(ingredients.length))} ingredients here are on health agencies' hazard lists.`,
  }),

  'headline.unreadable': ({ resolved, declared }) => ({
    text: resolved === 0
      ? `Verso couldn't identify any of the ${count(declared)} items on this label.`
      : `Verso could read only ${count(resolved)} of the ${count(declared)} items on this label.`,
  }),

  // Verso does check every ingredient against its lists; what is missing is an
  // entry for it on any of them. Saying "hasn't checked" became false the day
  // the lists were mirrored.
  'headline.unchecked': ({ ingredients }) => ({
    text: ingredients.length <= 2
      ? `The official lists Verso checks have no entry for ${joinList(ingredients)}.`
      : `The official lists Verso checks have no entry for ${count(ingredients.length)} ingredients here.`,
  }),

  'headline.clear': ({ checked, all }) => ({
    text: all
      ? 'No bans, warnings or hazard listings on record for these ingredients.'
      : `No bans, warnings or hazard listings on record for the ${count(checked)} ingredients Verso has checked.`,
  }),

  // --- cross-market comparison: rendered only from deltas the diff engine found ---
  'cmp.substitution': ({ labelA, labelB, ingredientsA, ingredientsB }) => ({
    text: `The ${labelA} lists ${ingredientsA}. The ${labelB} lists ${ingredientsB} in the same position.`,
  }),

  'cmp.absent': ({ ingredient, labelA, labelB }) => ({
    text: `${ingredient} appears on the ${labelA} and not on the ${labelB}.`,
  }),

  'cmp.no_difference': ({ marketA, marketB }) => ({
    text: marketA === marketB
      ? 'The two ingredient lists match.'
      : `The ingredient lists match across ${jurisdictionName(marketA)} and ${jurisdictionName(marketB)}.`,
  }),

  'cmp.summary': ({ labelA, labelB, differences }) => ({
    text: `${cap(count(differences))} ${differences === 1 ? 'difference' : 'differences'} between ` +
      `the ${labelA} and the ${labelB}.`,
  }),

  'cmp.sourced': ({ sourceA, dateA, sourceB, dateB }) => ({
    text: `Compared from ${sourceA} (${humanDate(dateA)}) and ${sourceB} (${humanDate(dateB)}).`,
  }),
};

// Bodies that publish statutory lists rather than scientific classifications.
export const hazardTemplate = body => (body === 'OEHHA' ? 'hazard.listing' : 'hazard.classification');

// `verbatim` lists slot values quoted directly from a regulator or monograph.
// The forbidden-word check constrains OUR editorial voice; it must not stop us
// quoting a regulator accurately. Prop 65's own wording is "known to the State
// of California to cause cancer" — refusing to print that would be absurd, but
// writing "causes cancer" in our own words would be a false claim. The citation
// is an instrument's own title, so it is not scanned either.
export function render(templateId, slots, { verbatim = [] } = {}) {
  const fn = T[templateId];
  if (!fn) throw new Error(`unknown claim template: ${templateId}`);
  const { text, citation = null } = fn(slots);

  let scan = text.toLowerCase();
  for (const v of verbatim) {
    if (v) scan = scan.split(String(v).toLowerCase()).join(' ');
  }
  const hit = FORBIDDEN.find(w => scan.includes(w));
  if (hit) throw new Error(`template ${templateId} produced forbidden term "${hit}" outside a verbatim citation: ${text}`);
  return citation ? { templateId, text, citation } : { templateId, text };
}

export const templateIds = () => Object.keys(T);

// Choose the template for a regulatory row. A ban with a future effective date
// is pending, not in force — saying otherwise would be a false claim.
export function regulatoryTemplate(status, effectiveFrom, today = new Date().toISOString().slice(0, 10)) {
  if (status === 'banned' || status === 'not_authorised') {
    return effectiveFrom && effectiveFrom > today ? 'reg.pending' : 'reg.banned';
  }
  if (status === 'warning_required') return 'reg.warning';
  if (status === 'restricted') return 'reg.restricted';
  return null;   // 'permitted' generates no claim
}
