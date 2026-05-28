# Crawl Task

## Goal

Build the new crawl system in shadow mode before any production cutover.

The new system should add repo-level monitoring and richer skill signals without disrupting the current production crawl or shrinking the open library.

Production remains:

- `index/skills.json` as the canonical broad skill library
- `index/trending.json` as the skills.sh metadata view
- `index/x-trending.json` as the X/Twitter feed

Do not replace the production crawl, production manifest, or app behavior until cutover is explicitly approved.

Production safety is the top constraint:

- do not break the current production crawl
- do not break production publish
- do not break app refresh behavior
- do not allow shadow work to mutate production assets

## Current Status

Completed shadow foundation work:

- Phase 1 shadow scaffold is in place
- production write guards and guard tests are in place
- shadow output contract is in place
- Phase 2 repo registry and seed loading are in place
- provisional repo states are active: `library | rising | core`
- shadow provenance foundation is in place
- author vs publisher modeling is in place
- `openclaw/skills` path-aware parser is active
- `neversight/learn-skills.dev` path-aware parser is active
- daily priority selector is extracted and covered by deterministic shadow tests
- promotion candidate reporting is active
- promotion shortlist is active with shadow-only caps:
  - `trustedVendor: 5`
  - `goldBasket: 3`
  - `periodic: 8`
  - `background: 4`
- shadow-only shortlist promotion into `rising` is active:
  - top `3` shortlist repos
  - `combined` runs only
  - `library -> rising` only

Implementation reference commits:

- `cdba8a1` shadow scaffold
- `d8ff071` repo registry and seeds
- `f56cab8` provenance normalization
- `aee5997` openclaw parser precedence cleanup
- `9d7888d` NeverSight parser
- `1e8d12d` daily priority selector tests
- `58dd38b` promotion candidate reporting
- `3c877cb` promotion candidate shortlist
- `546a960` promotion shortlist cap tuning
- simple shadow promotion into rising is implemented

Next active crawler phase:

- **Phase 3 Discovery Cadence**
- provenance cleanup is not the active phase unless it blocks Phase 3 or Phase 4 work

Decision note:

- provenance architecture is required for the new crawl
- exhaustive attribution cleanup is **not** required before crawler implementation continues
- the crawler can move forward as long as provenance fields, parser hooks, and shadow reporting exist
- provenance cleanup should improve data over time without blocking the rebuild

## Current Crawl Baseline

Current production entrypoint:

```bash
cd index
npm run scrape
```

Actual implementation:

- `index/scraper/build.ts`
- `index/scraper/enrich.ts`
- `index/scraper/sources/*`

Current discovery sources:

- `topics`
- `code`
- `aggregators`
- `social`
- `registry`
- `skillssh`
- `awesome`
- `official`

Current production safety behavior:

- backs up `skills.json`
- loads existing skills and carries forward undiscovered old skills
- strips stale X rows from the main library load path
- uses `sha-cache.json` to avoid reparsing unchanged `SKILL.md`
- uses `negative-cache.json` for stable failures
- writes atomically through temp file then rename
- checkpoints during long runs
- refuses to overwrite if output drops below 80% of previous count
- supports debug outputs through `--output-suffix=debug`
- supports source, repo, author, id-prefix, candidate, and enrichment limits

Current data publishing already supports optional overlays:

- `index/skill-signals.json`
- `index/author-signals.json`

Important current app constraint:

- the app refresh path reads `skills`, `trending`, and `xTrending`
- it does not currently consume `skillSignals`
- the current library should be treated as inherited state, not trusted truth
- current author attribution and old inclusion decisions may be wrong and must not become future policy by default
- installed-skill repo linkage is currently inferred, not explicitly persisted

## Phase 1: Shadow Mode

Add a separate new-crawl entrypoint that cannot overwrite production files.

### Phase 1 hard rules

- write only to `index/shadow/*`
- do not write production `index/skills.json`
- do not write production `index/skill-signals.json`
- do not write production `site/data/manifest.json`
- do not publish internal shadow outputs
- keep production `npm run scrape` unchanged
- shadow mode is allowed to model library inclusion differently from production, but only in shadow outputs

Required behavior:

- write only shadow outputs
- never write `index/skills.json`
- never write `index/skill-signals.json`
- never write `site/data/manifest.json`
- never publish internal shadow state
- keep production `npm run scrape` unchanged

Suggested files:

- `index/scraper/new-crawl/build-shadow.ts`
- `index/shadow/`

Required shadow outputs:

- `index/shadow/repo-index.shadow.json`
- `index/shadow/skills.shadow.json`
- `index/shadow/skill-signals.shadow.json`
- `index/shadow/shadow-report.json`
- `index/shadow/shadow-summary.md`
- candidate counts by source
- monitored repo count by state
- library growth candidates
- ranking differences against current `skills.json`
- runtime by stage and source
- promotion and demotion decisions
- stale or invalid removal candidates

Verification:

```bash
cd index
npm run typecheck
```

Run a shadow debug crawl and confirm only `index/shadow/*` changed.

## Phase 2: Repo Registry

Introduce an internal repo registry as the new crawl control plane.

Use repo as the crawl and monitoring unit.
Use skill as the ranking and discovery unit.

Repo states:

- `library`
- `rising`
- `core`

Registry fields should include:

- repo full name
- repo URL
- state
- discovered sources
- skill ids found in the repo
- last seen
- last refreshed
- stars
- repo freshness
- trust signals
- promotion reasons
- stale or invalid state

Phase 1 rule:

- repo state stays internal
- do not add repo-tier fields to the app `Skill` model
- do not add repo state to `skills.json`

Trusted creator and vendor inputs must come from one explicit internal seed source.

Suggested seed files:

- `index/seeds/trusted-creators.json`
- `index/seeds/trusted-vendors.json`
- optional locked include/exclude lists for repo overrides

Phase 1 rule:

- trusted creator logic must not depend only on the current gold basket
- manual seeds and locks must exist even if automatic trust expansion is added later
- current `skills.json` should seed the initial repo registry
- existing library repos should be the starting monitored candidates before broad rediscovery adds more

## Phase 3: Discovery Cadence

Split discovery into three shadow cadence lanes.

Fast sources:

- `official`
- trusted creator repo checks
- trusted vendor repo checks
- monitored repo checks

Periodic sources:

- `skillssh`
- `awesome`
- `registry`

Background sources:

- `topics`
- `code`
- `social`
- `aggregators`

Rules:

- broad discovery still grows the open library
- `awesome` and `registry` are periodic baseline-maintenance sources, not fast-lane sources
- background discovery should not dominate fast-lane runtime
- fast-lane discovery should focus on higher-signal changing inputs
- fast, periodic, and background source sets should be independently runnable in shadow mode
- shadow reports should show what periodic and background sources contribute beyond the fast lane
- long and broad crawls should start from the current library, not from zero
- broad discovery should add to and correct the inherited library, not rebuild it from scratch
- catalog and distribution repos can still be discovered and monitored, but repo stars alone must not over-promote their child skills in later product-facing scoring

## Phase 4: Enrichment Policy

Use two enrichment levels.

Library enrichment:

- cheap validity checks
- stars
- repo freshness
- source carry-forward where safe
- minimal metadata refresh

Phase 1 clarification:

- current production still uses a `5-star` floor
- shadow mode should explicitly test the `new-crawl` assumption that any valid skill can enter the library
- shadow reports should show:
  - valid skills below 5 stars
  - how many would enter the library under the new model
  - whether any of those are trusted-creator or official-vendor repos

Monitored enrichment for `rising` and `core`:

- fetch and parse `SKILL.md`
- refresh skill metadata
- refresh repo metadata
- recompute state
- recompute scores
- record promotion and demotion reasons

Product-facing scoring rule for later phases:

- repo stars can contribute to monitoring priority
- repo stars alone must not make every child skill in a catalog or distribution repo look top-tier
- later score layers must separate:
  - crawl priority at repo level
  - product emphasis at skill/creator level
- catalog child skills need additional proof beyond repo stars, such as:
  - provenance quality
  - installs
  - trending momentum
  - external validation
  - curation signals

Preserve current production safety ideas:

- SHA-based reuse
- negative cache for stable failures
- atomic writes
- explicit count comparisons
- carry-forward unless content is proven invalid or stale

Baseline and carry-forward rules:

- load current `skills.json` first as the inherited library baseline
- refresh known library repos before treating undiscovered content as removed
- classify shadow results into:
  - carried forward
  - corrected
  - newly discovered
  - stale or invalid candidates
- keep existing valid skills unless the new crawl has evidence they are bad or stale

Define stale conservatively for shadow evaluation:

- archived or deleted repo: immediate removal candidate
- missing `SKILL.md`: removal candidate only after `3` confirmed runs over at least `14` days
- repeated validation failure: removal candidate only after `3` confirmed failures
- inactivity alone is not enough unless paired with invalidity evidence

## Phase 5A: Provenance Foundation

The provenance foundation is already in place in shadow mode and should support continued crawler work without requiring exhaustive cleanup first.

Core rule:

- skill author matters more than repo owner
- `authorHandle` should mean best-known skill author
- repo owner should move to a separate publisher concept

Required provenance fields:

- `authorHandle`
- `publisherHandle`
- `publisherRepo`
- `upstreamRepo`
- `provenanceType`
- optional `authorConfidence`

Minimum `provenanceType` values:

- `original`
- `catalog`
- `repackaged`
- `mirrored`
- `unknown`

Already in place:

- shadow-only provenance fields
- catalog and distribution repo seed support
- provenance override support
- parser hook architecture
- `openclaw/skills` path-aware parser
- `neversight/learn-skills.dev` path-aware parser
- shadow attribution reporting
- separation of skill author from publisher or repo owner
- upstream repo capture when known

Fallback attribution order:

1. explicit metadata in the skill
2. upstream repo or imported source metadata
3. trusted override mapping
4. repo owner only when there is no evidence of repackaging

Hard rules:

- do not auto-attribute every child skill in a catalog repo to the repo owner
- do not discard a library entry just because author is unknown
- unknown provenance is better than wrong provenance

Required shadow outputs:

- count of author and publisher mismatches
- count of catalog skills
- count of unknown-author skills
- attribution confidence summary
- examples where production author differs from shadow author
- known bad attribution cases inherited from the current library

## Phase 5B: Provenance Cleanup Backlog

This is a deferred parallel backlog, not the current critical path for the crawler rebuild.

Deferred work:

- long-tail manual override cleanup
- additional collection-specific parsers
- one-off author corrections
- collection-by-collection polish
- removal of conservative repo-level overrides only after parser coverage proves they are redundant

Rule:

- provenance cleanup continues only for blocker-level issues or high-leverage patterned collections
- otherwise it stays out of the critical path for the crawler rebuild

Do not block crawler progress on cleanup:

- bad attribution should be contained rather than spreading
- future cleanup should improve shadow data without requiring schema changes
- the crawler rebuild should continue once provenance foundations are stable

## Phase 6: Installed Skill Receipts

Add a minimal install receipt system for omgskills-managed installs.

Purpose:

- preserve the exact link between an installed skill and the library item it came from
- preserve repo and path mapping even if crawl metadata changes later
- improve installed-skill attribution and repo mapping without relying only on inference

Scope rules:

- only future omgskills-managed installs require receipts
- existing installs continue to use current inference fallback
- do not block the new crawl on perfect historical backfill

Minimum receipt fields:

- `skillId`
- `repoURL`
- `skillRelativePath`
- `target`
- `installedAt`

Recommended additional fields:

- `publisherRepo`
- `authorHandle`
- `publisherHandle`

Required tasks:

- write a receipt when omgskills installs a skill
- read receipts when scanning installed skills
- fall back to current symlink and git inference when no receipt exists
- include receipt-backed vs inferred installed counts in validation output

## Phase 7: Scores and Signals

Keep `skills.json` canonical and broad.

Add new computed product-facing fields through `skill-signals.json`, not `skills.json`.

New optional signal fields:

- `libraryScore`
- `monitoredScore`
- `isRising`
- `isCore`

Score intent:

- `libraryScore` supports basic search/order quality
- `monitoredScore` supports ranking, recommendations, and curation for `rising` and `core`

Suggested monitored score inputs:

- installs
- stars
- momentum
- freshness
- creator trust
- external validation
- curation signals

Phase 1 app rule:

- no app ranking or search rewrite
- app behavior stays unchanged until scores are validated

Phase 1 file rule:

- shadow mode writes `index/shadow/skill-signals.shadow.json`
- production `index/skill-signals.json` stays unchanged until explicit cutover approval

## Phase 8: Validation and Reports

Create shadow reports that make old-vs-new comparison easy.

Required report checks:

- current skill count vs shadow projected count
- current skill count vs shadow projected count split by:
  - 5+ stars
  - below 5 stars
- carried-forward count from the inherited library baseline
- corrected inherited-library count
- newly discovered count
- new candidate count by source
- carried-forward count
- monitored set size by state
- top ranking differences
- author attribution differences
- catalog repo attribution examples
- receipt-backed installed mappings vs inferred mappings
- gold basket coverage
- trusted creator coverage
- rising detection examples
- stale or invalid removal candidates
- runtime and API cost by stage

Reports should clearly separate:

- production facts
- shadow recommendations
- cutover blockers
- temporary differences caused by production's current 5-star floor vs the new shadow library model

## Cutover Criteria

Do not cut over until the shadow system proves:

- long-tail coverage is preserved
- `skills.json` does not shrink unexpectedly
- top-skill usefulness is better or equal
- monitored-set quality is better
- author attribution is materially more accurate
- future omgskills installs retain durable installed-to-library mappings
- rising skills are detected quickly
- gold basket coverage is strong
- trusted creator coverage is strong
- runtime and API cost are acceptable
- removal behavior is limited to bad or stale content
- production publish and app refresh remain stable
- shadow `skill-signals` fields are stable enough to promote into production later
- the current production crawl still runs successfully and unchanged during shadow rollout
- shadow execution cannot interfere with normal production runs

Cutover requires explicit approval.

## Implementation Checklist

- [x] Add shadow crawl entrypoint
- [x] Add shadow output directory
- [x] Add repo registry model
- [x] Load existing `skills.json` as baseline
- [ ] Build daily high-signal discovery path
- [ ] Build weekly broad discovery path
- [x] Implement repo state assignment
- [ ] Implement light library enrichment
- [ ] Implement deep monitored enrichment
- [x] Detect catalog and distribution repos
- [x] Add publisher vs author provenance fields
- [x] Add attribution override inputs
- [x] Add shadow attribution report
- [ ] Add install receipt model for future omgskills installs
- [ ] Add receipt lookup in installed-skill scanning
- [ ] Add inferred-vs-receipt mapping validation
- [ ] Compute `libraryScore`
- [ ] Compute `monitoredScore`
- [ ] Extend `skill-signals.json` generation
- [ ] Add shadow comparison report
- [ ] Add verification for no production file writes
- [ ] Add cutover checklist output

Provenance foundation:

- [x] Add shadow-only provenance fields
- [x] Add catalog repo seed support
- [x] Add provenance override support
- [x] Add parser hook architecture
- [x] Add `openclaw/skills` path-aware parser
- [x] Add `neversight/learn-skills.dev` path-aware parser
- [x] Add provenance tests

Deferred provenance cleanup:

- [ ] Audit remaining conservative repo-level provenance overrides
- [ ] Add next high-leverage parser only when pattern quality is clear
- [ ] Maintain a backlog of collection cleanup candidates outside the crawler critical path
- [ ] Continue long-tail manual override cleanup only for blocker-level issues

## Verification Commands

Typecheck:

```bash
cd index
npm run typecheck
```

Production debug crawl still works:

```bash
cd index
npm run scrape:debug
```

Published data still validates after normal publish:

```bash
./scripts/publish-data.sh
node scripts/verify-published-data.mjs
```

Additional validation cases:

- a normal one-author repo keeps the correct `authorHandle`
- a catalog repo child skill does not inherit repo owner by default
- a repackaged skill records both `authorHandle` and `publisherHandle`
- an unknown upstream author stays searchable without fake attribution
- shadow reports show production vs shadow author differences
- a future omgskills install keeps repo and skill mapping through a receipt
- an existing install without a receipt still resolves through inference fallback

Manual shadow checks:

- confirm shadow crawl writes only shadow files
- confirm `skills.json` is unchanged by shadow crawl
- compare current and shadow skill counts
- confirm `skill-signals.json` entries match existing skill ids
- confirm internal shadow outputs are not added to the production manifest

## Assumptions

- This doc is the execution guide for the new crawl build.
- The current production crawl remains source of truth.
- Phase 1 prioritizes safety and observability over product changes.
- `skill-signals.json` is the first app-facing extension point.
- Internal repo state remains private until the new crawl is proven.

## Phased Implementation Plan

`crawl-task.md` should be executed in 5 phases with hard test gates.

Key rule:

- do **not** try to build repo registry, new discovery cadence, new enrichment, and new scores all at once
- first prove the shadow scaffold is safe
- then add one decision layer at a time

Repo note:

- the current strategy doc is at repo root as `new-crawl` without `.md`
- future task references should use that exact path unless it is renamed later

### Phase 1 — Shadow Scaffold And Safety Guardrails

Build only the non-destructive shell of the new system.

Changes:

- add `index/scraper/new-crawl/build-shadow.ts`
- add `index/shadow/` output directory
- make shadow run load current `skills.json` as baseline
- make shadow run write only:
  - `repo-index.shadow.json`
  - `skills.shadow.json`
  - `skill-signals.shadow.json`
  - `shadow-report.json`
  - `shadow-summary.md`
- add a hard output guard so shadow mode aborts if it tries to write:
  - `index/skills.json`
  - `index/skill-signals.json`
  - `site/data/manifest.json`

Tests:

- `npm run typecheck`
- shadow run with current inputs
- assert only `index/shadow/*` changed
- production `npm run scrape:debug` still works unchanged
- normal `./scripts/publish-data.sh` + `node scripts/verify-published-data.mjs` still pass

### Phase 2 — Repo Registry And Seed Inputs

Introduce the new control plane, but keep it internal.

Changes:

- define internal repo registry shape
- add seed files for:
  - trusted creators
  - trusted vendors
  - optional include/exclude overrides
- build repo aggregation from current skill library + discovered candidates
- assign internal repo state:
  - `library`
  - `rising`
  - `core`
- keep all repo state out of:
  - app `Skill`
  - `skills.json`
  - manifest

Tests:

- registry builds from current library without app/data contract changes
- repo state assignment is deterministic
- trusted creator logic works even if gold basket is unchanged or missing
- shadow report includes monitored counts by state
- no production asset diffs outside `index/shadow/*`

### Phase 3 — Split Discovery Cadence In Shadow

Move from one broad daily discovery model to the new tiered cadence, but only in shadow.

Changes:

- build daily high-signal discovery path:
  - `official`
  - `skillssh`
  - `awesome`
  - `registry`
  - monitored repos / trusted creators checks
- build weekly/background broad discovery path:
  - `topics`
  - `code`
  - `social`
  - `aggregators`
- make both independently runnable in shadow
- shadow reports must show:
  - candidate counts by source
  - candidates found only by weekly sources
  - promotion candidates originating from weekly sources
  - promotion shortlist for review, capped to:
    - `trustedVendor: 5`
    - `goldBasket: 3`
    - `periodic: 8`
    - `background: 4`
  - shadow-only auto-promotion from shortlist, capped to:
    - top `3`
    - `combined` runs only
    - `library -> rising`

Tests:

- daily-only shadow run succeeds
- weekly-only shadow run succeeds
- combined shadow run succeeds
- reports clearly distinguish daily vs weekly source contribution
- daily runtime is materially lower than current broad daily scrape
- broad discovery still surfaces library-growth candidates
- combined shadow run can promote up to `3` shortlist repos into `rising`
- combined shadow run should report promoted repos with:
  - prior state
  - new state
  - shortlist reason
- daily priority selector tests prove:
  - bucket caps
  - priority order
  - dedupe across buckets
  - stars fill behavior
  - skipped monitored count

### Phase 4 — Light vs Deep Enrichment

Implement the new value-based enrichment policy in shadow.

Changes:

- **library enrichment**
  - validity
  - stars
  - freshness
  - light metadata
- **monitored enrichment**
  - full `SKILL.md`
  - full repo metadata
  - state recomputation
  - scoring inputs
- preserve current production safety ideas in shadow:
  - SHA reuse
  - negative cache
  - carry-forward
  - conservative stale detection
- explicitly model the current production 5-star floor as a comparison point, not a shadow constraint
- shadow reports must show:
  - valid skills below 5 stars
  - how many new library entries the open-library model would admit
  - which of those are trusted/vendor repos

Tests:

- unchanged repos reuse cached data correctly
- stable failures hit negative cache correctly
- stale removal candidates only appear under the defined conservative rules
- shadow library does not collapse vs current baseline
- shadow report separates:
  - invalid removals
  - stale candidates
  - low-star-but-valid library additions

### Phase 5 — Scores, Signals, And Comparison Readiness

Add the app-facing future signal layer, but keep it shadow-only.

Changes:

- compute:
  - `libraryScore`
  - `monitoredScore`
  - `isRising`
  - `isCore`
- write them only to `index/shadow/skill-signals.shadow.json`
- do not touch production `index/skill-signals.json`
- add ranking comparison output:
  - current top skills
  - shadow top skills
  - score deltas
  - gold basket coverage
  - trusted creator coverage
  - rising detection examples

Tests:

- every shadow signal entry maps to an existing skill id
- no change to app ranking/search behavior
- monitored score is computed only where intended
- comparison report makes old-vs-new ranking differences explicit
- shadow scores are stable enough across runs to support future cutover

## Test Gates Before Any Cutover Work

Do not move beyond shadow validation until all are true:

- production crawl still runs unchanged
- production publish and manifest remain unchanged
- shadow outputs never leak into `site/data`
- library coverage is preserved or improved
- no harmful shrinkage is happening
- trusted creator and gold basket coverage stay strong
- rising detection is measurably better
- daily runtime/cost is lower or at least more predictable
- shadow `skill-signals` are internally consistent and useful

## Additional Assumptions

- `new-crawl` is the crawl strategy source of truth.
- `new-data.md` is the app/data-contract source of truth.
- Phase 1 should not mutate any production app-facing data.
- Repo state remains internal throughout shadow mode.
- Production `skill-signals.json` should remain untouched until explicit cutover approval.
