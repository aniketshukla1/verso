# Verso — build plan

Full designed version, with the competitive analysis and roadmap detail:
https://claude.ai/code/artifact/50db529e-f896-40dd-995f-5d1103e979ed

Mobile only — iOS + Android via Expo. No web app, no desktop app.

## Positioning

Yuka has ~80M users doing barcode → 0-100 health score. That market is taken.
Three things nobody does well:

1. **Jurisdiction** — not "this additive is risky" but "this additive is illegal
   in 27 countries and you are holding it". A regulatory fact with a citation is
   both more defensible and more persuasive than a wellness opinion.
2. **Litigation** — active class actions attached to the ingredient in your hand.
3. **The formulation gap** — same brand, same product, different country,
   different recipe, shown side by side. This is the headline feature.

The third is the company. A health score is an opinion and opinions are
commoditised; a verified difference between two labels is a fact that implicates
a named company in a decision about a specific market. More valuable, and more
dangerous — which is why §04 and §08 are built around it.

## Validated cases

- **Lay's** — US lists sunflower/corn/canola; India lists palmolein. Reported
  through 2024; PepsiCo India began trialling a sunflower-palmolein blend in
  May 2024. `tools/phase0-check` resolves both labels and produces this delta.
- **Nestlé Cerelac** — Public Eye / IBFAN (2024) reported added sugar in
  India, Africa and parts of Asia against zero-added-sugar European versions.

Both were found by journalists doing manual one-product-at-a-time comparison,
over years. Nothing watches for this continuously.

## §04 Architecture — four layers, deliberately not merged

| Layer | Schema | Ownership |
|-------|--------|-----------|
| 1 Product | `product` | Open Food Facts (ODbL), USDA FDC, licensed feeds |
| 2 Ingredient Canon | `canon` | Proprietary — the hardest and most defensible asset |
| 3 Evidence | `evidence` | Proprietary — every row carries a citation |
| 4 Verdict | `verdict` | Proprietary, derived, reproducible from 2 and 3 |

Layer 1 and layers 2-4 are joined **at query time in the application layer**,
and the join is never written back as a merged table. Structured this way the
estate reads as a *collective* database rather than a *derivative* one, which is
what keeps ODbL share-alike off the proprietary data. Enforced by
`pnpm lint:layers`. Have counsel confirm the reading before commercial launch —
this is engineering guidance, not a legal opinion.

**Stack:** Expo + react-native-vision-camera + ML Kit Text Recognition v2
on-device; Fastify + TypeScript; Postgres + pgvector; BullMQ on Redis; Claude
(Sonnet for bulk extraction, Opus for comparison synthesis); S3/R2 for label
images, which are evidence.

## §06 Comparison pipeline

1. Resolve identity → brand, product, market, GTIN
2. Check cache (comparisons are expensive to build, near-static once built)
3. Hunt counterparts — OFF country subdomains, USDA FDC, then the brand's own
   regional sites, which are the highest-quality source that exists
4. Extract with vision + structured output; discard anything off-schema
5. **Diff deterministically** — both lists normalised through the canon and
   compared by code. The model never decides what the difference is.
6. **Explain within a fence** — prose only about deltas the engine found,
   citing only evidence rows that already exist
7. Score confidence; below threshold, suppress rather than hedge
8. Cache and watch for reformulation

Steps 5-6 are the whole legal posture. Splitting the work means every published
claim traces to two ingredient lists and two source artifacts.

## §08 Top risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Defamation / trade libel | Critical | Evidence-linked claims, the step-5 fence, versioned claim snapshots, right of reply, counsel review of templates not claims |
| Model-invented differences | Critical | Deterministic diff, strict schemas, suppression below threshold, sampled human audit |
| ODbL contamination | High | Layer separation from day one |
| Cold-start coverage | High | Graceful-miss analysis + contribution loop; scan-to-useful-answer is the north star |
| OCR on real packaging | High | Guided multi-shot capture, on-device frame rejection, server vision fallback |

## Phases

| Phase | Weeks | Exit criterion |
|-------|-------|----------------|
| 0 Foundations | 1-6 | 400 ingredients canonicalised; regulatory status in 4 jurisdictions; measured barcode hit rate per region |
| 1 Scan & verdict | 5-14 | Scan-to-useful-answer >85% on the test basket; <2.5s to first useful pixel |
| 2 Formulation gap | 13-22 | 200 verified comparisons; zero fabricated differences in audit; counsel signed off on rendered output |
| 3 Litigation & personalisation | 21-30 | Docket verification on 100% of published items; day-30 retention above Phase 1 baseline |
| 4 Monetise & scale | 29-40 | Positive unit economics per active user |

## Team

Mobile ×2, backend ×2, data/ML ×1, **regulatory content lead ×1**, designer ×1,
product ×1, fractional counsel ×0.5.

The content lead has no engineering content and is the role most likely to be
cut. Cutting it is how the differentiator decays into stale trivia within two
quarters, silently.

## Business model

Freemium: scanning and the basic verdict free forever. Subscription unlocks
cross-market comparisons, litigation tracking, watchlist alerts, history.

**No affiliate revenue on recommendations** — the moment you take a cut of the
alternative you suggest, every verdict is compromised. Institutional licensing
of the Evidence Layer is the second business hiding inside the first.
