# Verso

Mobile food-label scanner. Scan a package anywhere in the world; get what is in
it, where those ingredients are banned, who is being sued over them, and whether
the same brand sells a different formulation in another market.

*Verso* is the reverse side of a printed page. The ingredient panel is on the
back of the pack — the name means "read the back". It points without accusing,
which is deliberate: see `docs/naming.md` and `docs/claim-templates.md`.

Full plan: `docs/PLAN.md`. Mobile only — iOS + Android via Expo. No web app.

## Two rules that are not negotiable

**1. Never merge Open Food Facts data with our own data on disk.**

`product` is ODbL-licensed. `canon`, `evidence` and `verdict` are ours, and the
curated data is CC BY-NC 4.0 (`data/LICENSE`); the code is MIT. Share-alike
attaches to a *derivative* database, so the two sides are joined at request
time in the application layer and never bound together in storage:

- no foreign key crossing between `product` and the other three schemas
- no view or materialized view reading both sides
- layers 3 and 4 refer to products by the opaque `product_ref` text
  (`packages/shared/src/product-ref.js`), never by FK

`pnpm lint:layers` enforces this against the migration source and the live
catalog. If it fails, fix the schema — do not weaken the linter.

**2. A model never decides what differs between two products.**

The comparison pipeline computes deltas deterministically in code after
normalising both ingredient lists through the canon. A model may only write
prose about rows that already exist in `verdict.comparison_delta`, citing only
rows that already exist in `evidence.*`. It may never introduce a difference, a
health claim, or a motive.

This is why `evidence.regulatory_status.citation_id` and
`evidence.hazard_finding.citation_id` are `NOT NULL`: a claim without a source
cannot be inserted.

## Layout

```
packages/db          migrations (one file per layer) + runner
packages/shared      normalise.js (label text -> match key), product-ref.js (the boundary)
packages/canon       ingredient canon: seeder + resolver; identify.js names unknown label terms
                     on demand (canon.identification), confirmed against E/CAS numbers
packages/evidence    regulatory status, hazard findings, litigation: seeder; sources/ parses the
                     official lists and sync.js mirrors them daily (evidence.source_record)
packages/verdict     score.js (methodology), templates.js (claim templates), build.js,
                     compare.js (the deterministic cross-market diff — rule 2 lives here)
services/api         Fastify: POST /v1/verdict, POST /v1/compare, POST /v1/ocr,
                     GET /v1/products, GET /v1/unresolved
apps/mobile          Expo app: guided capture, offline cache, verdict UI
site/                the website (plain HTML, CSS, JS), published to GitHub Pages by
                     .github/workflows/pages.yml; its phone loops are filmed from the real app
tools/lint-layers    enforces rule 1
tools/off-ingest     Open Food Facts -> LAYER 1 ONLY
tools/coverage-spike measures real barcode hit rate per market
tools/verdict-demo   eyeball verdict output without running the app
tools/phase0-check   Phase 0 exit criteria + end-to-end resolver proof
tools/dev-up         one command for the whole stack, pinned to the Mac's Bonjour name
tools/ocr-report     real-world OCR quality from the API log (resolve rate, missed terms)
tools/brand          renders the app icon + splash from code; rationale in docs/brand.md
tools/source-sync    downloads the EU additives, FDA, IARC and Prop 65 lists and the FSSAI and
                     Codex oil standards; logs every change
data/canon           ingredient + synonym source of truth (JSON, declarative)
data/evidence        regulatory, hazard, composition + process-contaminant source of truth
                     (JSON, every row cited)
```

`packages/verdict/src/templates.js` is the executable form of
`docs/claim-templates.md`, and `score.js` of `docs/methodology.md`. Change the
docs and the code together or they are both lies.

## Working on it

```bash
pnpm db:up && pnpm migrate && pnpm seed
pnpm check        # lint:layers + tests + phase 0 criteria
pnpm sources:sync # re-download the official lists; --offline re-applies local copies
```

The FSSAI and Codex standards are PDFs, read with `pdftotext`: `brew install poppler`.
The API re-runs the sync once a day when `VERSO_SOURCE_SYNC=daily`. Downloads land
in `data/sources/<source>/<date>.<ext>` (gitignored) and only once accepted; a
list that shrinks by more than a fifth is refused and kept as `.refused.`.

`data/canon/*.json` is declarative: the seeder deletes and reinserts each
ingredient's synonyms, so removing a term from the file removes it from the
database. Re-run `pnpm seed` after any edit. The seed then clears every queued
term the resolver now handles from `canon.unresolved_term`, and copies each one to
`canon.cleared_term` along with what it resolved to.

## Things that have already bitten

- **A database behind the migrations hangs the test run.** A missing table fails
  a `test.before` hook, the pg client is never closed, and `node --test` waits
  forever with no output. On a fresh or old Docker volume run `pnpm migrate &&
  pnpm seed && pnpm sources:sync --offline`, and `pnpm ingest 3017620422003
  5449000000996` for the two catalogue fixtures, before `pnpm check`.
- **Read DATE as a string.** `pg.types.setTypeParser(1082, ...)` is set in
  `packages/db/src/db.js`. Without it a ban effective 2027-01-01 prints as
  2026-12-31. Regulatory dates are published facts; they do not drift.
- **Palmolein is not palm oil.** They are separate canon entities on purpose —
  the India/US Lay's comparison turns on exactly that distinction. The seeder
  warns on synonym clashes; treat a clash as a curation bug, not noise.
- **Do not let a generic carrier phrase resolve to a specific fat.** "Edible
  Vegetable Oil" must resolve to nothing rather than to palm oil. Multi-word
  synonyms only fuzzy-match when every one of their words appears on the label.
- **Keep `\p{M}` in the normaliser's character class.** Devanagari vowel signs
  are Unicode marks; stripping them destroys Hindi label text.
- **A score is withheld when evidence coverage is thin.** Without that gate a
  product full of additives nobody has researched scores 100, which a user reads
  as "this is fine". Withholding the number is not withholding the facts — the
  ingredients and their citations still render.
- **A bare fragment of a matched phrase is not a second ingredient.** "Corn Oil"
  generates the candidate "Corn"; reporting both claims the product contains
  maize as well as corn oil. Suppressed per declaration item in `resolve.js`.
- **A fixture is not a scan.** Every unresolved item is queued in
  `canon.unresolved_term`, and the tests run against the live database, so
  "Zorbium Extract" (104 hits) topped the content lead's queue. Tests, demos and
  checks pass `queue: false` to `resolveDeclaration`, `buildVerdict` and
  `compareLabels`; the API never does. A label posted to the running API by hand
  is queued like a phone scan: check it with `tools/verdict-demo` instead.
- **The forbidden-word guard constrains our voice, not our citations.** Prop 65's
  own wording is "known to the State of California to cause cancer". Pass
  regulator quotations to `render()` as `verbatim` so the guard skips them.
- **Catalogue ingredient text arrives in the market's language.** Open Food Facts
  is deepest in Europe, so the catalogue path resolves worst exactly where it
  hits most. Synonyms carry a `lang`; keep adding them.
- **A foreground colour that never changes is a bug in a themed palette.**
  `ctaText` hardcoded `#fff` over `t.accent`; the dark accent is a light
  periwinkle, so the primary button read at 2.4:1 — the capture CTA and the
  verdict CTA both. Accents carry an `onAccent` in `theme.ts`; pair them.
  Muted tokens need the same care: `ink3` cleared 4.5:1 on the dark ground
  and missed it on paper, so every footnote in light mode was under-contrast.
- **Composition is context, never a score input.** `evidence.composition` (Codex
  fatty-acid ranges) is shown and cited but excluded from deductions AND from
  evidence coverage — counting it as coverage would let an oil-only label score
  100 on the strength of a fat profile.
- **A failed refresh must never replace a saved verdict.** The offline cache
  existed but an error screen overwrote it on every network failure, so it
  failed exactly when there was no signal. `App.tsx` `resolveScan` keeps the
  saved result and marks it as saved.
- **An onLayout added to a reused View never fires.** The Scan screen's loading
  placeholder and its measured wrapper are both a root `View`, so React reused
  the node and the handler was attached after layout — no event on web or
  Fabric, so the guide box never drew. The wrapper carries `key="preview"`.
- **Xcode 27 enforces the user-script sandbox.** The generated project sets
  `ENABLE_USER_SCRIPT_SANDBOXING = YES`; Xcode 26 ignored it, Xcode 27 does not,
  and React Native's bundle phase writes `ip.txt` into the .app undeclared —
  "Sandbox: bash deny(1) file-write-data .../Verso.app/ip.txt".
  `plugins/withUserScriptSandboxingOff.js` turns it off for the app target.
- **"ld: framework 'X' not found" with the folder present means a missing
  binary.** After the macOS 27 update, large binaries inside `ios/Pods`
  (MLKitTextRecognitionCommon, React.xcframework) had been deleted while their
  headers remained. Check with `ls Pods/X/Frameworks/X.framework`; the fix is
  `rm -rf ios/Pods && pod install`, which restores from the CocoaPods cache.
- **iOS 27 requires the UIScene life cycle.** An app built with the iOS 27 SDK
  that creates its window in the app delegate traps at launch —
  EXC_BREAKPOINT in `_UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption`,
  before any JS loads, so Metro never sees a request. Expo SDK 57's template
  predates this. `plugins/withSceneLifecycle.js` adds the scene manifest and a
  SceneDelegate that owns the window; it throws at prebuild if AppDelegate.swift
  stops matching the template, rather than shipping a launch crash.
- **Listed is not authorised.** The EU additives database still carries titanium
  dioxide (E 171), removed from food by Regulation (EU) 2022/63, and every item
  has a placeholder condition of use whose fields are all null. Counting that
  placeholder made E 171 "authorised for food". A use exists only when it names
  a food category (`packages/evidence/src/sources/eu.js`).
- **FDA's inventory is not an approval list.** Substances Added to Food says of
  itself that inclusion "does not indicate an FDA approval". Only the 21 CFR
  sections in a row carry legal weight; Part 189 is the list of substances
  prohibited from human food, and its entries are named "CYCLAMATE--PROHIBITED".
- **A debug build finds Metro by the Mac's IP, baked in at build time.** React
  Native writes `ipconfig getifaddr en0` into `ip.txt`; the Mac moved from
  home Wi-Fi to the iPhone hotspot and back within an hour, and each move left
  the installed app unable to load. `plugins/withMetroBonjourHost.js` writes the
  Bonjour name (`<LocalHostName>.local`) instead, which works on any network
  and over USB. Free-team signing also expires every 7 days: rebuild weekly.
- **Palm oil is not banned anywhere Verso checks.** It is legal and widely used
  in US and EU packaged food. What the record supports is context: EFSA found
  the highest levels of two refining contaminants in palm oils and fats, and the
  EU caps them. That is shown with citations as `evidence.process_contaminant`
  and never scored. A "banned" or "hazardous" label on the oil would be false.
- **Wikidata is not an ingredient identifier.** Its public API throttled a burst
  of 14 searches, took 34 s for 12 run one at a time, returned "Besan" as a
  French city and knew no Indian name at all (hing, amchur, moth dal). A model
  named all thirteen terms of a real label correctly; the E/CAS checks in
  `identify.js` are what stop its mistakes (a small local model invented E302
  for MSG).
- **An automatically identified ingredient must stay marked on direct matches.**
  Its English name becomes a synonym, so the next scan's resolver finds
  "Nutmeg" without a lookup; `build.js` `markAutomatic` re-attaches the
  "identified automatically" label, which also keeps it out of the score.
- **Canola is not ordinary rapeseed oil.** Its synonyms include "rapeseed oil",
  so a name match gave it FSSAI's rapeseed and mustard oil standard (2.2.1(6))
  instead of the low erucic acid one (2.2.1(7)). `standardCheck` in
  `checks.js` ranks candidates, most specific first; keep it that way.
- **An oil standard counts as checked; a fat profile does not.** FSSAI 2.2.1 and
  Codex CXS 210 say what an oil must be to be sold under its name, so a match is
  evidence coverage (`COVERAGE_SOURCES`). It never deducts and is never worded
  as a safety finding. Composition stays out of coverage: a fatty-acid range
  says nothing about whether any regulator accepts the oil.
- **`prebuild --clean` fails with ENOTEMPTY when Finder has `ios/` open** —
  Finder recreates `.DS_Store` mid-delete. Close the Finder window, or
  `rm -rf ios` and run `expo prebuild` without `--clean`.

