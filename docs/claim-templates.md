# Claim templates

Every sentence the app publishes about a named product or brand comes from a
template in this file. Counsel reviews **templates**, not individual claims —
template review scales to millions of products; per-claim review does not.

A generated claim that does not match a template here does not ship.
`verdict.claim_version.template_id` records which template produced each
published string, so any claim can be reconstructed exactly as it was shown.

## Rules binding every template

1. Every slot is filled from a database row, never from model output.
2. Regulatory claims name the instrument and the date. A rendered claim has two
   parts, `text` (the finding) and `citation` (the instrument and date), and they
   are always displayed together: the split sets reading weight, it never
   permits showing one without the other.
6. Codes never reach a reader. Jurisdictions render as names ("California", not
   "US-CA"), bodies are expanded on first use ("IARC, the World Health
   Organization's cancer agency,"), and dates are written out ("1 January 2027").
3. No template attributes intent, motive, or knowledge to a company.
4. No template uses "causes", "toxic", "poison", "dangerous", or "unsafe".
5. Comparison templates describe what two labels say. They do not characterise
   the company that wrote them.

## Regulatory status

- `reg.banned` — "{ingredient} is not permitted in food in {jurisdiction}."
  Citation: "{instrument} · in force since {date}" (or "{instrument}" when the
  row has no date).
- `reg.warning` — "In {jurisdiction}, food containing {ingredient} must carry
  the label warning: '{warning_text}'." Citation: "{instrument}".
- `reg.restricted` — "{jurisdiction} permits {ingredient} only in {scope}."
  Citation: "{instrument}".
- `reg.pending` — "{jurisdiction} has adopted a ban on {ingredient} taking
  effect {date}. It remains permitted until then." Citation: "{instrument}".

## Hazard findings

- `hazard.classification` — "{body} classifies {ingredient} as {finding}."
  The `finding` slot is verbatim from `evidence.hazard_finding.finding`.
  Nothing may be appended to it. Citation: "{instrument}".
- `hazard.listing` — "{ingredient} appears on California's Proposition 65 list
  of chemicals {finding}." A statutory listing, worded as a listing and never
  as a classification. Citation: "{instrument}".
- `hazard.scope` — appended where the evaluation's basis is narrower than
  dietary exposure: "This evaluation is based on {exposure_route} exposure."

## Source checks

What each official list Verso mirrors daily says about one ingredient
(`packages/verdict/src/checks.js`). Shown under the ingredient, one line per
list, each with its link and the date the list was last checked. Citation for
every one: "{list} · checked {date}".

A lookup that finds nothing says it found nothing ("for this name or CAS
number"). It is never worded as a clean bill of health, and never as a ban:
gelatin appears on labels as "E428" and has no entry on the EU additive list
because the EU regulates it as a food.

- `check.eu.authorised` — "Authorised as a food additive in the European Union,
  as {e_numbers}."
- `check.eu.limited` — "The European Union limits {e_number} to named foods:
  {uses}." The uses are the database's own restriction wording, verbatim.
- `check.eu.no_food_use` — "{e_number} is in the EU additives database without
  any food it is authorised in." Shown with the entry's note, verbatim.
- `check.eu.delisted` — "{e_number} has been removed from the EU list of
  authorised food additives." Shown with the entry's note.
- `check.eu.not_found` — "The EU list of authorised food additives has no entry
  for {e_number}."
- `check.fda.prohibited` — "US federal rules list it among substances
  prohibited from use in human food ({sections})." Part 189's own title.
- `check.fda.regulated` — "Listed in US federal food regulations: {sections}."
  Parts 73, 74, 172, 173, 180, 182 and 184; each section links to the eCFR.
- `check.fda.contact_only` — "Listed in US federal regulations only for
  materials that touch food: {sections}."
- `check.fda.flavouring` / `check.fda.inventory` — "In FDA's inventory of
  substances added to food [as a flavouring], with no FDA regulation cited."
- `check.fda.not_found` — "No entry in FDA's inventory of substances added to
  food for this name or CAS number."
  Every FDA line carries the inventory's own caveat, quoted: inclusion "does not
  indicate an FDA approval or evaluation of this use".
- `check.iarc.classified` — "IARC, the World Health Organization's cancer
  agency, classifies "{agent}" in Group {group}: {group_text}." The agent name
  and the group wording are IARC's, quoted.
- `check.iarc.not_found` — "No IARC classification found for this name or CAS
  number." Shown with IARC's own caveat: "no determination of
  non-carcinogenicity or overall safety should be inferred."
- `check.prop65.listed` — ""{agent}" appears on California's Proposition 65
  list: {type of toxicity}, since {date}." The chemical's name is OEHHA's,
  including any scope in brackets ("airborne, unbound particles of respirable
  size").
- `check.prop65.not_found` — "No Proposition 65 listing found for this name or
  CAS number."
- `check.fssai.standard` — "India's food regulator, FSSAI, has a standard that
  "{name}" sold in India must meet (regulation {regulation})." Regulation 2.2.1
  of the Food Products Standards and Food Additives Regulations, 2011; the name
  is FSSAI's, quoted ("Sun flower seed oil", "Palmolein").
- `check.fssai.not_found` — "No FSSAI oil standard found under this name."
- `check.codex.standard` — "The Codex Alimentarius, the FAO/WHO food standards
  body, has an international standard for "{name}"." From the Standard for Named
  Vegetable Oils, CXS 210-1999; the name is Codex's, quoted.
- `check.codex.not_found` — "No Codex named-oil standard found under this name."
  The two standards are checked for oils, oleins and stearins only: butter and
  cocoa butter have standards in other chapters, and "no oil standard" beside
  them would read as "unregulated". A standard says what an oil must be to be
  sold under that name. It is never worded as a safety finding and never
  scored; it counts as evidence coverage (docs/methodology.md).
- `note.sources` — the footnote under every set of checks: "* Verso does not
  produce this information. Each item is published by the official source linked
  beside it (a regulator, a WHO agency or a court) and was last checked on
  {date}. Verso can't guarantee it; tap an item to read the source." Dated by the
  least recently checked list. Counsel to review before launch.

Three results are findings as well as checks, and also render through the
templates above: a Part 189 prohibition as `reg.banned` for the United States
(citation: the 21 CFR section first, then the inventory and date), an IARC
Group 1, 2A or 2B classification as `hazard.classification`, and a Proposition
65 listing without a bracketed scope as `hazard.listing`. When a curated row
from the same body exists, the curated claim is shown and the automatic check is
not.

## Context

- `context.process_contaminants` — "EFSA, the European Food Safety Authority,
  on contaminants that form when oils such as {ingredient} are refined:
  "{finding}"". The finding is EFSA's, verbatim. Citation: the EFSA opinion.
  Never scored, never a headline (docs/methodology.md, "Process contaminants
  are context"). The contaminants' own classifications render with
  `check.iarc.classified` and `check.prop65.listed`, naming the contaminant,
  never the oil.

## Composition

- `composition.saturated` — "The Codex standard's ranges for each saturated
  fatty acid in {ingredient} add up to {low}–{high}% of its fatty acids."
  Citation: "{instrument}". The range is the sum of the standard's per-acid
  lower and upper limits, rounded outward, and the sentence says it is a sum —
  the standard never prints the total. Composition is context: it never moves
  the score and never headlines a verdict.

## Headlines

The first line of a verdict states the single most decision-relevant finding.
Chosen in `build.js` in this order; the first case that applies wins.

- `headline.acted` — "{count} authorities have acted on {ingredient | count
  ingredients here}." Counts jurisdictions with any status other than permitted.
- `headline.listed` — "{ingredient} is on a health agency's hazard list."
  Grade A and B findings only: IARC Group 3 is "not classifiable", and
  headlining it would upgrade a non-finding into a warning.
- `headline.unreadable` — "Verso could read only {n} of the {total} items on
  this label." / "Verso couldn't identify any of the {total} items on this label."
- `headline.unchecked` — "The official lists Verso checks have no entry for
  {ingredients}." Names up to two ingredients, counts beyond that. (Until 0.3.0
  it read "Verso hasn't checked…", which stopped being true once every
  ingredient was looked up in the mirrored lists.)
- `headline.clear` — "No bans, warnings or hazard listings on record for these
  ingredients." / "…for the {n} ingredients Verso has checked." Always scoped to
  what is on record; never "safe", never "fine".

## Cross-market comparison

The load-bearing templates. Each renders only from rows already present in
`verdict.comparison_delta`.

- `cmp.substitution` — "The {market_a} label lists {ingredient_a}. The
  {market_b} label lists {ingredient_b} in the same position."
- `cmp.absent` — "{ingredient} appears on the {market_a} label and not on the
  {market_b} label."
- `cmp.no_difference` — "The ingredient lists match across {market_a} and
  {market_b}." (Same market: "The two ingredient lists match.")
- `cmp.summary` — the comparison headline: "{count} differences between the
  {label_a} and the {label_b}."
- `cmp.sourced` — always appended: "Compared from {source_a} ({date_a}) and
  {source_b} ({date_b})." Sources are named from an enumerated origin (a
  catalogue source, "a label scanned in Verso", "a Verso test label"), never
  from free text on a request.

How the engine decides (`packages/verdict/src/compare.js`):

- **Substitution** only at the same declaration position, with ingredients of
  the same kind on both sides and nothing unreadable at that position. A list
  shifted by one extra item yields absences, not a guessed substitution.
- **Absence** only when the other label has no unreadable items: any unreadable
  item could be the "missing" ingredient in a spelling the canon lacks.
- Ingredient lists are quoted in label order, with the label's own connective
  ("and/or", "or").

Not permitted, in any form: that a company is "giving", "selling" or
"offering" a worse product to a market; that a difference is deliberate,
cost-driven, or discriminatory; that one formulation is "inferior". The
comparison shows two labels side by side. The reader draws the conclusion, and
the reader is the only one who may.

## Suppression

A comparison below the confidence threshold is not published with a caveat. It
is not published. Hedged language does not lower legal exposure and does lower
trust.

The threshold: at least 80% of the declaration items on **each** label resolve
(`MIN_COMPARE_COVERAGE`). When nothing is confirmable but absences were
withheld, no headline is published either — "they match" would be false and
"they probably match" is a hedge.

## Correction and right of reply

Publicly documented before launch, with a working intake route for
manufacturers. A retracted claim sets `verdict.claim_version.retracted_at`
rather than being deleted — the record of what was shown, and when, is the
point.
