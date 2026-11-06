// Executable form of docs/methodology.md.
//
// Every deduction is itemised and traceable to an evidence row. There is no
// opaque term in this function: if a point comes off, the user can be shown
// exactly which regulation or classification took it off.

export const SCORE_VERSION = '0.2.1';

// Tier A — regulatory status. Drives the headline, per methodology.
// "Home" is the market the user is standing in; a ban there is more relevant
// than a ban elsewhere, though both are shown.
const REG = {
  banned:         { home: 25, away: 12 },
  not_authorised: { home: 25, away: 12 },
  warning_required: { home: 10, away: 5 },
  restricted:     { home: 4,  away: 4 },
  permitted:      { home: 0,  away: 0 },
};

// Tier B/C — authoritative classification. Tier D is absent on purpose:
// contested evidence never moves the number, however alarming it reads.
const HAZARD = { A: 10, B: 6, C: 2, D: 0 };

const PER_INGREDIENT_CAP = 30;   // one substance may not sink an entire product

export function scoreProduct({ ingredients, unresolvedCount = 0, market }) {
  // Fail loudly rather than scoring quietly wrong: with no market every ban is
  // treated as foreign, which reads as a materially safer product.
  if (!market) throw new Error('scoreProduct requires a market');

  const items = [];
  const byIngredient = [];
  let deducted = 0;

  for (const ing of ingredients) {
    let own = 0;
    const label = ing.displayName;

    for (const r of ing.regulatory ?? []) {
      const band = REG[r.status];
      if (!band) continue;
      const home = r.jurisdiction === market || r.jurisdiction.startsWith(`${market}-`);
      let points = home ? band.home : band.away;
      if (r.pending) points = Math.round(points / 2);   // adopted but not yet in force
      if (points === 0) continue;
      own += points;
      items.push({ tier: 'A', ingredient: label, points,
        reason: `${r.status} in ${r.jurisdiction}${r.pending ? ' (pending)' : ''}`,
        // structured as well as worded, so the app can explain a deduction in
        // the reader's language instead of printing "banned in US-CA"
        source: 'regulatory', status: r.status, jurisdiction: r.jurisdiction,
        pending: !!r.pending, home, citationId: r.citationId });
    }

    for (const h of ing.hazards ?? []) {
      const points = HAZARD[h.grade] ?? 0;
      if (points === 0) continue;
      own += points;
      items.push({ tier: h.grade === 'A' ? 'A' : h.grade === 'B' ? 'B' : 'C',
        ingredient: label, points, reason: `${h.body}: ${h.endpoint}`,
        source: 'hazard', body: h.body, endpoint: h.endpoint, finding: h.finding,
        citationId: h.citationId });
    }

    const counted = Math.min(own, PER_INGREDIENT_CAP);
    if (own > 0) byIngredient.push({ ingredient: label, points: counted, uncapped: own });
    deducted += counted;
  }

  const total = ingredients.length + unresolvedCount;
  const labelCoverage = total === 0 ? 0 : ingredients.length / total;

  // An ingredient we can assess is one an additive regime has an opinion about.
  // Sugar and salt carry no additive evidence and never will; counting them as
  // "covered" would flatter the number.
  // "Researched" means a curated row, or an entry on at least one official
  // list Verso mirrors (`listed`). Merely having looked is not enough: an
  // additive no list has heard of must not score 100 on the strength of four
  // empty lookups.
  const assessable = ingredients.filter(i => i.kind !== 'base');
  const withEvidence = assessable.filter(
    i => (i.regulatory?.length ?? 0) > 0 || (i.hazards?.length ?? 0) > 0 || i.listed === true);
  const evidenceCoverage = assessable.length === 0 ? 1 : withEvidence.length / assessable.length;

  // Two independent ways to be wrong, so two gates.
  //
  //   labelCoverage  — how much of the label we could read at all
  //   evidenceCoverage — how much of what we read we actually know anything about
  //
  // The second gate is the one that matters commercially: without it a product
  // full of additives we have not yet researched scores 100 and reads to the
  // user as "this is fine". Withholding the NUMBER is not withholding the
  // FACTS — resolved ingredients and their evidence are still returned in full.
  // suppressionReason is the log/test wording; suppressionCode plus the counts
  // below are what a screen words for a reader.
  let suppressionReason = null;
  let suppressionCode = null;
  if (labelCoverage < 0.5) {
    suppressionCode = 'label_coverage';
    suppressionReason = `only ${ingredients.length} of ${total} declared items resolved`;
  } else if (evidenceCoverage < 0.5) {
    suppressionCode = 'evidence_coverage';
    suppressionReason = `evidence covers only ${withEvidence.length} of ` +
      `${assessable.length} assessable ingredients`;
  }

  const score = suppressionReason ? null : Math.max(0, 100 - deducted);
  const confidence = suppressionReason ? 'low'
    : (labelCoverage >= 0.8 && evidenceCoverage >= 0.8) ? 'high' : 'medium';

  return {
    score,
    suppressed: score === null,
    suppressionReason,
    suppressionCode,
    confidence,
    labelCoverage: Number(labelCoverage.toFixed(2)),
    evidenceCoverage: Number(evidenceCoverage.toFixed(2)),
    assessableCount: assessable.length,
    researchedCount: withEvidence.length,
    resolvedCount: ingredients.length,
    declaredCount: total,
    unresearched: assessable.filter(i => !withEvidence.includes(i)).map(i => i.displayName),
    deducted,
    items: items.sort((a, b) => b.points - a.points),
    // per ingredient, after the cap — these add up to `deducted` exactly, so a
    // screen can show 100 minus each line and land on the score
    byIngredient: byIngredient.sort((a, b) => b.points - a.points),
    cap: PER_INGREDIENT_CAP,
    version: SCORE_VERSION,
  };
}
