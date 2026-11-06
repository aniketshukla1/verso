# Scoring methodology

Versioned and public. This document is the cheapest credibility available to
this product, and the first thing a serious journalist or a brand's counsel
will ask for. It is criticisable on purpose.

**Version:** `0.2.0-draft` — Phase 0. Not yet applied to any published score.
Claim wording is versioned separately as `METHOD_VERSION` (0.3.0) in
`packages/verdict/src/templates.js`; the score code as `SCORE_VERSION` (0.2.0)
in `score.js`. 0.2.0 adds source checks (below); 0.2.1 counts an oil's FSSAI or
Codex standard as evidence coverage. The deductions are unchanged.

## Two scores, never one

Additive hazard and nutritional quality are different questions resting on
different evidence. Merging them into a single figure is how scoring systems
lose credibility. The app shows both, labelled, and never averages them.

## Evidence tiers

| Tier | What qualifies | Weight | How it is shown |
|------|----------------|--------|-----------------|
| A | Regulatory status: banned, not authorised, restricted, or warning-required in a named jurisdiction | Drives the headline | Flat fact with citation and effective date |
| B | Authoritative classification: IARC group, ADI exceeded, NTP or OEHHA finding | Strong input | In the body's own words, never upgraded |
| C | Peer-reviewed literature, graded by design and replication | Context only | Narrative below the fold, with study count |
| D | Emerging, contested, animal-only at implausible doses, single-study | **Zero** | Only behind "contested evidence", clearly labelled |

Tier D never moves a score. Not when the finding is alarming, not when it would
make good marketing. That is the whole point of having tiers.

## How the number is read

The score starts at 100 and only goes down: 100 means nothing on record against
the ingredients Verso has checked, not that a product is healthy. The app shows
it as "58/100" beside that sentence, and never labels it a safety score.

| Evidence | Home market | Elsewhere |
|----------|-------------|-----------|
| Banned or not authorised | −25 | −12 |
| Warning label required | −10 | −5 |
| Restricted to named uses | −4 | −4 |
| Ban adopted, not yet in force | half of the above | half |
| Tier A finding (e.g. Prop 65 listing) | −10 | −10 |
| Tier B classification (e.g. IARC 2A/2B) | −6 | −6 |
| Tier C | −2 | −2 |

No single ingredient can take off more than 30. Every deduction is itemised in
`hazard.byIngredient` (after the cap) and `hazard.items` (each row), and the
app renders both — so 100 minus the listed lines is the score, visibly.

## Source checks

Every resolved ingredient is looked up in the official lists Verso mirrors
daily: the EU Food Additives Database, FDA's Substances Added to Food inventory,
IARC's List of Classifications and California's Proposition 65 list. Matching is
by E number (EU), then CAS number, then exact name; never fuzzy, because a wrong
match attaches another substance's findings to this one.

Three results are findings and score exactly like the curated rows they
resemble:

| List result | Treated as | Why it is safe to score |
|-------------|------------|-------------------------|
| FDA: 21 CFR Part 189 (prohibited from use in human food) | Tier A, banned in the US | An explicit prohibition in regulation |
| IARC Group 1, 2A or 2B | Tier B classification | The body's own classification, quoted |
| Proposition 65 listing (no bracketed scope) | Tier A finding | A statutory listing |

Everything else a list says is shown, cited and dated, and never scored:

- **No entry found**, on any list. FDA calls its inventory "a partial list";
  IARC says of unclassified agents that "no determination of
  non-carcinogenicity or overall safety should be inferred"; gelatin ("E428")
  has no entry on the EU additive list because the EU regulates it as a food.
- **Removed from the EU list.** Old codes stay on labels after the EU renumbers:
  E 160b was deleted and replaced by E 160b(i) and (ii), which are authorised.
- **In the EU database with no authorised food use**, and **authorised only in
  named foods.** Context for the reader; the curated rows carry the claims.
- **IARC Group 3**, "not classifiable": a non-finding.
- **A Proposition 65 listing with a scope in brackets**, e.g. titanium dioxide
  "(airborne, unbound particles of respirable size)". It is quoted with its
  scope, and not scored: a listing about breathing a dust is not a finding
  about eating it.

A curated row from the same body always wins: the automatic check is hidden and
nothing is counted twice.

An ingredient counts as researched for evidence coverage if it has a curated
row, **an entry on at least one of these lists**, or, for an oil, a product
standard (below). Four empty lookups do not
count: an additive no list has heard of must not score 100.

Oils are also looked up in two product standards: India's (FSSAI, regulation
2.2.1 of the Food Products Standards and Food Additives Regulations, 2011) and
the Codex Standard for Named Vegetable Oils (CXS 210-1999). Matching is by the
oil's names, allowing for the standards' spellings ("Sun flower seed oil",
"Soya bean oil"), and the most specific standard wins: canola is the low erucic
acid rapeseed standard, not the ordinary one. A standard says what an oil must
be to be sold under its name. It is not a safety evaluation, so it is shown and
cited and never scored. It **does** count as evidence coverage: a regulator has
a written position on exactly that oil, which is more than an entry in FDA's
inventory. Before 0.2.1 it did not, and a fried snack whose oils were all
standardised still had its score withheld for "no list entry".

## Identifying unknown label terms

A label term the canon does not know ("Hing", "Amchur", "Ajinomoto") is named
by a model on the spot, once, and the answer is kept in `canon.identification`
for every later scan (`packages/canon/src/identify.js`). The model only names
the substance. What it proposes counts as confirmed only when something Verso
already trusts agrees:

| Confirmed by | When |
|--------------|------|
| E number | The canon's name for the proposed E number, taken from the EU list, matches the model's name. A made-up E number names another substance and is refused. |
| CAS number | The canon, or an official list, holds the proposed CAS number under a matching name |
| Canon name | The model's standard name is already an ingredient Verso knows |

Anything else becomes a new ingredient marked **identified automatically** and
unconfirmed. It is shown with its official-list checks, labelled as such, and
**never scored**: none of its checks becomes a finding, and it does not count
toward evidence coverage. An unresolved term is still better than a guessed
one; an identification a user can see, check and discount is better than both.
The terms a model calls "not an ingredient" (addresses, nutrition text) leave
the "couldn't identify" list, and the answer stays reviewable in the table.

## Process contaminants are context

Refining vegetable oils forms two contaminants, glycidyl fatty acid esters and
3-MCPD esters. EFSA reported in 2016 that "the highest levels of GE, as well as
3-MCPD and 2-MCPD (including esters) were found in palm oils and palm fats,
followed by other oils and fats", and Regulation (EU) 2023/915 sets maximum
levels for both (Annex I, 5.3 and 5.4). Glycidol is IARC Group 2A and 3-MCPD
Group 2B; both are on the Proposition 65 list.

Palm oil and palmolein carry this as context (`evidence.process_contaminant`):
EFSA's finding quoted, the EU limit in the regulation's terms, and the
contaminants' own IARC and Prop 65 entries read live from the mirrored lists.
It is shown and cited, and it is **never a deduction, never evidence coverage
and never a headline**. The label names the oil, not the contaminant. The rest
is EFSA's, quoted in the app beside the link (`context_quotes`): the
substances "form during food processing, in particular, when refining vegetable
oils at high temperatures (approx. 200°C)"; they were found highest in palm,
"followed by other oils and fats"; and "levels of GE in palm oils and fats
halved between 2010 and 2015, due to voluntary measures taken by producers".
Palm oil is legal in the United States and the European Union, and Verso never
says otherwise.

## Composition never scores

Compositional ranges (`evidence.composition`, e.g. the saturated fatty acids in
palm olein under Codex) describe what a substance is. They are shown, cited, and
excluded from both the deduction and evidence coverage: counting them as
coverage would let an oil-only label score 100 on the strength of a fat profile.

## When a score is withheld

- **Label coverage** below 50%: too little of the label resolved to say anything.
- **Evidence coverage** below 50%: of the ingredients an additive regime has an
  opinion about (everything except base foods), too few have been checked
  against bans and hazard lists. The app names the unchecked ones.

The findings that do exist are still shown in full.

## Rules the copy must hold to

- **Never say "causes".** Say what the regulator did, what the body classified,
  what the study found. The user draws the conclusion.
- **Never upgrade a classification.** IARC Group 2B is "possibly carcinogenic
  to humans". It is not "linked to cancer" and it is not "a carcinogen".
- **Carry the scope of the finding.** The IARC titanium dioxide evaluation rests
  on inhalation exposure. Saying so is not a hedge; omitting it is an error.
- **Dose is part of the fact.** "Contains titanium dioxide" and "contains
  titanium dioxide at 40% of the ADI per serving" are different statements.
- **Distinguish the substance actually used.** Native carrageenan is IARC Group
  3; degraded carrageenan (poligeenan) is Group 2B and is not a permitted food
  additive. Reporting the second as the first is a false claim.

## Open questions for Phase 1

- Weighting between regulatory status and hazard grade within the headline
  number, and whether the headline should be a number at all rather than a band.
- Whether jurisdiction weighting is defensible: should a ban in the user's own
  market count for more than a ban elsewhere? It is more useful and less
  neutral.
- How ADI-relative exposure enters the score when use-level data exists for
  some ingredients and not others, without penalising the well-documented.
