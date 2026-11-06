// Mirrors the responses of services/api (POST /v1/verdict, POST /v1/compare,
// GET /v1/products). Kept hand-written rather than generated so the app has no
// build-time dependency on the server package.

export type RegStatus =
  | 'banned' | 'not_authorised' | 'restricted' | 'warning_required' | 'permitted';

export interface RegulatoryRow {
  jurisdiction: string;
  status: RegStatus;
  scope: string | null;
  note: string | null;
  effectiveFrom: string | null;
  pending: boolean;
  instrument: string;
  sourceUrl: string | null;
  /** Set when the row comes from an official-list check rather than curation. */
  fromList?: string;
}

export interface HazardRow {
  body: string;
  endpoint: string;
  finding: string;
  grade: 'A' | 'B' | 'C' | 'D';
  instrument: string;
  sourceUrl: string | null;
  fromList?: string;
}

/**
 * What one official list says about an ingredient (packages/verdict/src/checks.js).
 * `text` and `citation` come from a claim template; the citation ends with the
 * date the list was last checked.
 */
export interface SourceCheck {
  source: 'eu-additives' | 'fda-substances' | 'iarc' | 'prop65';
  body: string;
  status: string;
  templateId: string;
  text: string;
  citation?: string;
  url: string | null;
  /** 21 CFR sections, each linking to the eCFR. */
  links?: { label: string; url: string }[];
  /** The list's own note on this entry, verbatim. */
  note?: string | null;
  /** The list's own caveat about what an entry (or no entry) means, quoted. */
  caveat?: string;
  detail?: string | null;
  matchedAs?: string;
  checkedAt: string;
  published: string | null;
}

export interface SourceInfo {
  key: string; body: string; title: string; home: string;
  published: string | null; checkedAt: string;
}

export interface SaturatedBound {
  low: number;
  high: number;
  basis?: string;
  instrument?: string;
  sourceUrl?: string | null;
}

/**
 * A contaminant that refining forms in an ingredient (palm oil: glycidyl esters,
 * 3-MCPD). Context only, never scored: the label names the oil, not the contaminant.
 */
export interface ProcessContaminant {
  contaminant: string;
  cas: string;
  /** Verbatim from the cited source (EFSA). */
  finding: string;
  /** Further sentences from the same source, verbatim. */
  quotes: string[];
  instrument: string;
  sourceUrl: string | null;
  limit: { note: string; instrument: string; sourceUrl: string | null };
  /** The contaminant's own IARC and Prop 65 entries, rendered by claim templates. */
  classifications: { body: string; text: string; citation?: string; url: string | null }[];
}

export interface Ingredient {
  slug: string;
  displayName: string;
  eNumber: string | null;
  kind: string;
  rank: number;
  position: number;
  matchConfidence: 'exact' | 'fuzzy' | 'identified';
  /**
   * Set when the label's term was unknown and a model named it
   * (packages/canon/src/identify.js). `verifiedBy` null: confirmed by nothing
   * official, so it is shown and never scored.
   */
  identified?: { term: string; name: string | null; verifiedBy: 'e_number' | 'cas' | 'canon_name' | null; model: string } | null;
  regulatory: RegulatoryRow[];
  hazards: HazardRow[];
  /** Context, never scored: see docs/methodology.md "Composition never scores". */
  composition: { saturated: SaturatedBound } | null;
  processContaminants?: ProcessContaminant[];
  /** Optional: verdicts cached on the phone before the lists were mirrored have none. */
  checks?: SourceCheck[];
  /** On at least one official list. */
  listed?: boolean;
}

/** A rendered template: `text` and `citation` are always shown together. */
export interface Rendered {
  templateId: string;
  text: string;
  citation?: string;
}

export interface Claim extends Rendered {
  kind: 'regulatory' | 'hazard' | 'composition' | 'context';
  status?: RegStatus;
  pending?: boolean;
  jurisdiction?: string;
  effectiveFrom?: string | null;
  body?: string;
  grade?: string;
  ingredient: string;
  ingredientName: string;
  sourceUrl: string | null;
}

export interface ScoreItem {
  tier: string;
  ingredient: string;
  points: number;
  reason: string;
  source: 'regulatory' | 'hazard';
  status?: RegStatus;
  jurisdiction?: string;
  pending?: boolean;
  home?: boolean;
  body?: string;
  endpoint?: string;
  finding?: string;
}

export interface HazardScore {
  score: number | null;
  suppressed: boolean;
  suppressionReason: string | null;
  suppressionCode: 'label_coverage' | 'evidence_coverage' | null;
  confidence: 'low' | 'medium' | 'high';
  labelCoverage: number;
  evidenceCoverage: number;
  assessableCount: number;
  researchedCount: number;
  resolvedCount: number;
  declaredCount: number;
  unresearched: string[];
  deducted: number;
  items: ScoreItem[];
  byIngredient: { ingredient: string; points: number; uncapped: number }[];
  cap: number;
  version: string;
}

export interface Verdict {
  found: true;
  productRef: string | null;
  resolvedFrom: 'catalogue' | 'ocr';
  market: string;
  headline: Rendered;
  /** Layer 1 — ODbL. `attribution` MUST be rendered wherever this is shown. */
  product: {
    name: string; brand: string | null; market: string;
    source: string; license: string; attribution: string; retrievedAt: string;
  } | null;
  ingredients: Ingredient[];
  unresolved: string[];
  claims: Claim[];
  hazard: HazardScore;
  /** Terms still being looked up when this verdict was built; asking again shortly finds them. */
  identifying?: string[];
  sources?: SourceInfo[];
  /** The footnote under the checks: Verso does not produce this information. */
  note?: Rendered | null;
  methodVersion: string;
}

export interface VerdictMiss {
  found: false;
  code?: 'not_in_catalogue' | 'no_text';
  reason: string;
  methodVersion: string;
}

export type VerdictResult = Verdict | VerdictMiss;

// --- comparison ---

export interface CompareIngredient {
  slug: string;
  displayName: string;
  kind: string;
  saturated: { low: number; high: number } | null;
}

export interface CompareSideOut {
  market: string;
  label: string;
  origin: 'scan' | 'sample' | 'catalogue';
  source: string;
  date: string;
  product: { name: string; brand: string | null; license: string; attribution: string } | null;
  coverage: number;
  items: { position: number; text: string; ingredients: CompareIngredient[] }[];
  unresolved: string[];
}

export interface CompareDelta {
  type: 'substitution' | 'only_a' | 'only_b';
  position: number;
  a: CompareIngredient[];
  b: CompareIngredient[];
  claim: Rendered;
}

export interface Comparison {
  found: true;
  suppressed: boolean;
  suppressionCode?: 'coverage' | 'unconfirmed';
  unreadableSide?: 'a' | 'b';
  headline: Rendered | null;
  a: CompareSideOut;
  b: CompareSideOut;
  deltas: CompareDelta[];
  claims: Rendered[];
  sourced: Rendered;
  compositionSource: { instrument: string; sourceUrl: string | null } | null;
  withheld: number;
  methodVersion: string;
}

export interface CatalogueProduct {
  gtin: string;
  market: string;
  brand: string | null;
  name: string;
  hasIngredients: boolean;
  source: string;
  attribution: string;
  license: string;
}
