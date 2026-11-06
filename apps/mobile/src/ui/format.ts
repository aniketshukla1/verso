import type { HazardScore } from '../types/verdict';

// Reader-facing names for the codes the API speaks in. Mirrors PLACE in
// packages/verdict/src/templates.js — claims arrive already worded by the
// server; these are only for chips, rows and pickers.
const PLACE: Record<string, { short: string; name: string; inPhrase: string; label: string }> = {
  EU:      { short: 'EU',          name: 'European Union', inPhrase: 'the EU',          label: 'EU' },
  US:      { short: 'US',          name: 'United States',  inPhrase: 'the US',          label: 'US' },
  'US-CA': { short: 'California',  name: 'California',     inPhrase: 'California',      label: 'Californian' },
  IN:      { short: 'India',       name: 'India',          inPhrase: 'India',           label: 'Indian' },
  GB:      { short: 'UK',          name: 'United Kingdom', inPhrase: 'the UK',          label: 'UK' },
  FR:      { short: 'France',      name: 'France',         inPhrase: 'France',          label: 'French' },
  DE:      { short: 'Germany',     name: 'Germany',        inPhrase: 'Germany',         label: 'German' },
  ES:      { short: 'Spain',       name: 'Spain',          inPhrase: 'Spain',           label: 'Spanish' },
  IT:      { short: 'Italy',       name: 'Italy',          inPhrase: 'Italy',           label: 'Italian' },
  NL:      { short: 'Netherlands', name: 'Netherlands',    inPhrase: 'the Netherlands', label: 'Dutch' },
  CA:      { short: 'Canada',      name: 'Canada',         inPhrase: 'Canada',          label: 'Canadian' },
  AU:      { short: 'Australia',   name: 'Australia',      inPhrase: 'Australia',       label: 'Australian' },
};

export const placeShort = (code: string) => PLACE[code]?.short ?? code;
export const placeName = (code: string) => PLACE[code]?.name ?? code;
/** "Scoring for the US", "ban in the EU" — the form that follows a preposition. */
export const placeIn = (code: string) => PLACE[code]?.inPhrase ?? code;
/** "Indian", "US" — qualifies a label: "See the Indian label". */
export const placeLabel = (code: string) => PLACE[code]?.label ?? code;

/** Countries a user can shop in. ISO 3166 alpha-2 only — the API rejects anything else. */
export const MARKETS = ['IN', 'US', 'GB', 'FR', 'DE', 'ES', 'IT', 'NL', 'CA', 'AU']
  .map(code => ({ code, name: placeName(code) }));

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** '2027-01-01' -> '1 Jan 2027'. From the string, never a Date: no timezone drift. */
export function shortDate(iso: string | null | undefined) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : null;
}

/** A local timestamp for "saved on" lines: '14 Sep, 10:42'. */
export function savedAt(ms: number) {
  const d = new Date(ms);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${d.getDate()} ${MONTHS[d.getMonth()]}, ${hh}:${mm}`;
}

export const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const KIND: Record<string, string> = {
  base: 'Basic food', oil_fat: 'Oil or fat', colour: 'Colour', preservative: 'Preservative',
  antioxidant: 'Antioxidant', sweetener: 'Sweetener', emulsifier: 'Emulsifier',
  flavour_enhancer: 'Flavour enhancer', flour_treatment: 'Flour treatment agent',
  thickener: 'Thickener', stabiliser: 'Stabiliser', acidity_regulator: 'Acidity regulator',
  contaminant: 'Process contaminant',
};
export const kindLabel = (kind: string) =>
  KIND[kind] ?? kind.replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase());

/** Short, accurate chip text for a hazard finding. Never paraphrases the finding upward. */
export function hazardChip(body: string, finding: string) {
  if (body === 'OEHHA') return 'PROP 65 LIST';
  const group = /Group\s+(\w+)/i.exec(finding)?.[1];
  if (body === 'IARC' && group) return `IARC GROUP ${group.toUpperCase()}`;
  return body;
}

// What each body is, in its own terms. Shown wherever its acronym is.
export const BODY_ABOUT: Record<string, string> = {
  IARC: "The World Health Organization's cancer agency. Its groups rate how strong the " +
    'evidence is, not the risk at the amounts people eat.',
  OEHHA: "California's Office of Environmental Health Hazard Assessment, which keeps the " +
    'Proposition 65 list.',
  EFSA: 'The European Food Safety Authority, which advises EU regulators.',
  JECFA: 'The joint FAO/WHO expert committee that evaluates food additives.',
};

/** Why there is no number — worded for a reader, not a log line. */
export function withheldReason(h: HazardScore) {
  if (h.suppressionCode === 'label_coverage') {
    return h.resolvedCount === 0
      ? 'Verso couldn’t identify any item on this label, so there is nothing to score.'
      : `Verso could read ${h.resolvedCount} of the ${h.declaredCount} items on this label. ` +
        'A score needs at least half.';
  }
  if (h.suppressionCode === 'evidence_coverage') {
    // Every ingredient is looked up in the official lists; what can be missing
    // is an entry for it on any of them (docs/methodology.md, "Source checks").
    const m = h.assessableCount;
    const lead = h.researchedCount === 0
      ? (m === 1 ? 'None of the official lists Verso checks has an entry for the one ingredient it scores here.'
        : `None of the official lists Verso checks has an entry for any of the ${m} ingredients it scores here.`)
      : `The official lists Verso checks have entries for ${h.researchedCount} of the ${m} ingredients it scores here.`;
    return `${lead} A score needs at least half, so a number now would overstate what’s known.`;
  }
  return h.suppressionReason ?? '';
}
