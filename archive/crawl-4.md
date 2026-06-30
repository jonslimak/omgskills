# Crawl Strategy v4

Historical note: this was the active Crawl 4 strategy/planning doc during implementation. The current crawl system guide is [`crawl.md`](/Users/jonslimak/Projects/omgskills/crawl.md).

This doc is the concrete implementation plan that follows [`crawl-3.md`](/Users/jonslimak/Projects/omgskills/crawl-3.md).

The goal is to tighten the current crawler, not rebuild it.

Production safety is a first-order constraint.

This plan should change crawler decision logic, not production data contracts.

Crawl 4 evolved during implementation.

The current source of truth is the implemented shadow behavior plus this updated design.

Older bucketed-preview and rolling-TTL-only language should not be treated as current policy.

## Operating goal

Crawl 4 should become the primary client data track.

It should generate a complete library output that can be inspected through shadow/cutover artifacts and served from `/data/crawl4/manifest.json`.

During Stage B, public clients can default to Crawl 4 while keeping `/data/v2/manifest.json` as the active fallback.

This rollout should not require a client-facing schema or data-contract change.

## What stays the same

The current crawler architecture stays in place.

Repo states stay:

- `core`
- `rising`
- `library`

Discovery lanes stay:

- `fast`
- `periodic`
- `background`

The current Crawl 4 shadow/cutover/publish flow stays:

- `scrape:shadow`
- `promote:cutover`
- `test:shadow-guard`
- publish Crawl 4

The fallback v2 publishing flow stays active while clients can roll back to v2:

- `skills.json`
- `trending.json`
- `x-trending.json`

This plan is not a repo-state rewrite, crawler rewrite, or production data-contract rewrite.

## What we will actually change

### 1. Official seed tightening

Refine the current official/trusted seed layer so relevant official upstream repos are grouped into practical Tier 1-like and Tier 2-like buckets through seeds and overrides.

This should be done through the existing seed/override system, not through hardcoded one-off logic spread across the crawler.

### 2. Derived tier classification

Add Tier 1 / Tier 2 as **derived operating classifications** based on:

- resolved upstream repo
- repo stars
- official seed membership

Tier 1 / Tier 2 are working classifications used in selection and reporting only. They are not a new stored production field.

This implementation should **not** add a new persistent `tier` field unless it becomes absolutely necessary.

Tiering should be computed where it is needed:

- prioritization
- reporting
- rising selection

### 3. Daily priority preview redesign

The proposed daily-priority preview is now a simple additive scored model.

Current cap split:

- active daily deep-refresh hotset remains `40` repos
- Stage B proposed preview hotset is `50` repos for better recall

It uses only:

- official Tier 1
- official Tier 2
- gold basket
- trusted vendor
- derived Tier 1
- derived Tier 2
- momentum
- simple star buckets

This remains preview logic until Stage B is explicitly approved.

### 4. Shadow refresh-policy redesign

Keep daily priority as the deep-refresh hotset.

For non-daily repos, use weekly cheap repo-meta checks:

- cheap check compares repo `lastUpdated` vs persisted top-skill `last_updated`
- deep refresh runs only when the cheap check indicates change
- cheap-triggered deep refresh is capped at `150` repos per combined run
- changed repos over the cap are deferred, not forgotten
- deferred repos keep their prior `lastObservedRepoUpdatedAt`, so they remain eligible later
- daily hotset refresh is not affected by the cheap-triggered cap
- weekly coverage is measured by attempted cheap checks
- repo-missing checks count as coverage attempts and are reported separately

High-star `SKILL.md` discovery is weekly-gated and does not run on every combined crawl.

This keeps weekly library coverage realistic without deep-refreshing everything.

### 5. Head coverage reporting

Add reporting that makes head coverage measurable:

- missing Tier 1 upstream repos
- missing Tier 2 upstream repos
- unresolved catalog entries
- rising repos promoted from `skills.sh`
- rising repos promoted from validated X

The report should be based on discovered upstream repos, not on trying to estimate all skills on GitHub.

### 6. Validated X reuse

Reuse validated X outputs as an input to rising logic.

This implementation should:

- let validated X influence repo freshness and rising selection
- avoid making live X crawling a hard dependency of main crawl success

The main crawl should remain stable when X is unavailable.

### 7. Library admission policy

Discovery is not admission.

New repos enter the maintained library only after:

- a value gate passes:
  - manual include
  - official seed
  - trusted vendor
  - gold basket
  - `500+` stars
- bootstrap proves clean mapping

Manual include is crawler-only config and does not bypass bootstrap.

Failed admissions are cleaned up after bootstrap and final repo-index reconciliation.

The temporary admission-validation flag was removed after proof.

## What this plan will not do

This implementation will not:

- rebuild the crawler architecture
- replace the current repo-state model
- change production app data formats unless absolutely forced
- add new app/library contracts
- reduce valid baseline library coverage just because ranking, priority, or shortlist logic changed
- ingest `browse.sh` in this implementation
- expand catalog-first discovery
- try to estimate all skills on GitHub

This plan is intentionally narrow.

## Source policy

The effective source order for this implementation is:

1. official
2. upstream GitHub + stars
3. `skills.sh`
4. validated X
5. `registry` / `awesome`
6. background discovery sources
7. catalogs later

Important rules:

- catalogs are hints, not truth
- unresolved catalogs do not count toward head coverage
- `browse.sh` is aligned with the strategy, but deferred from this build plan

## Operating rules

This implementation should follow these rules:

- Tier 1 / Tier 2 are operating classifications, not stored schema in this implementation
- importance is assigned at the upstream repo level
- repo states remain operational behavior only
- freshness comes from:
  - selective `rising`
  - daily hotset deep refresh
  - weekly attempted cheap repo-meta coverage for non-daily repos
- ranking and promotion logic may change monitoring behavior, but they should not remove valid existing library skills unless a skill fails validation or an explicit pruning policy is introduced
- production publishing should continue using validated cutover results only

## Success criteria

This plan succeeds when:

- current production outputs remain unchanged in structure
- head coverage becomes measurable
- official repos are handled more intentionally
- rising-skill logic uses `skills.sh` and validated X more clearly
- weekly non-daily refresh coverage becomes measurable and explainable
- catalogs stop driving importance directly
- the crawler becomes easier to reason about without becoming more brittle

## Locked defaults

The following defaults should be treated as the starting policy for implementation:

### Tier 1

- relevant official upstream repos
- plus upstream repos `>= 50k` stars

### Tier 2

- relevant official upstream repos not already in Tier 1
- plus upstream repos `10k–50k` stars

### Other defaults

- no persistent `tier` field in this implementation
- `browse.sh` excluded from this implementation
- validated X reused as optional input, not hard dependency
- production app/library contracts unchanged unless absolutely necessary

## Verification

When this plan is implemented, verify:

- no production JSON contract changes
- official seed changes affect prioritization/classification only
- Tier 1 / Tier 2 are derived from upstream repo truth
- validated X can influence `rising` without making the main crawl depend on X availability
- a missing-head report can be generated from discovered upstream repos

## Assumptions

- [`crawl-3.md`](/Users/jonslimak/Projects/omgskills/crawl-3.md) remains the strategy document
- this archived doc was the original build plan
- the next implementation wave should be minimal and production-safe
- separating strategy from implementation reduces ambiguity during build work

## Concrete implementation plan

This section turns the strategy above into the actual rollout sequence.

The implementation should happen in stages so we can run Crawl 4 publicly while keeping v2 as a real fallback path.

### Stage A: build and verify Crawl 4 in shadow

Stage A now has two shadow-only tracks:

1. selection/reporting preview
2. shadow refresh-policy redesign

This stage should build and verify the complete Crawl 4 policy in shadow:

- add curated official seed coverage
- derive Tier 1 / Tier 2 classifications from:
  - upstream repo
  - repo stars
  - official seed membership
- compute proposed daily priority and proposed promotion shortlist side by side with current logic
- use the scored daily-priority preview
- reuse validated X artifacts if they already exist
- treat missing validated X artifacts as a warning, not a failure
- add head-coverage reporting to shadow outputs
- keep daily priority as the deep-refresh hotset
- add weekly cheap repo-meta coverage for all non-daily repos
- deep refresh non-daily repos only when cheap checks indicate change
- count attempted cheap checks as weekly coverage
- report repo-missing checks separately from successful repo-meta reads

This stage should **not** change:

- production outputs
- production contracts
- cutover / publish / deploy behavior

### Stage B: Crawl 4 primary with v2 fallback

Stage B should make Crawl 4 the primary client data track.

Stage B does not retire v2.

After Stage A verification and churn review are complete, Stage B should:

- point the release client at `/data/crawl4/manifest.json` first
- fall back to `/data/v2/manifest.json` on fetch, parse, or validation failure
- keep the legacy `scrape` / v2 publishing path active
- keep weekly cheap-check coverage and capped cheap-triggered refresh as the Crawl 4 refresh policy
- keep catalog and admission safeguards active

Rollback means switching the client default back to v2. It should not require rebuilding Crawl 4.

### Stage C: public Crawl 4 primary trial

After Stage B, monitor public clients using Crawl 4 primary for several days.

During the trial:

- run Crawl 4 regularly through the shadow/cutover/publish path
- keep v2 crawling and publishing as the fallback
- inspect the Crawl 4 output library after each run
- test client fallback behavior against v2
- record whether each run is keep, tune, or block

Output-library inspection should include:

- compare Crawl 4 vs current library counts
- review the top `50` hotset
- review newly admitted repos
- review missing or removed important repos
- spot-check app-consumable cutover files
- confirm new additions are not dominated by obvious junk

### Stage D: v2 fallback retirement decision

Only after the public Crawl 4 primary trial is accepted, decide whether v2 fallback can be retired.

Until then, keep v2 crawling, publishing, and monitored.

### Client fallback requirements

The client rollout should:

- try `/data/crawl4/manifest.json` first
- fall back to `/data/v2/manifest.json` on manifest fetch, asset fetch, parse, or validation failure
- preserve the same client-facing data schema
- make rollback a client default/config change, not a crawler rebuild

Health should monitor:

- Crawl 4 primary freshness
- v2 fallback freshness
- publish/deploy validity for both tracks

### Planned implementation details

#### 1. Internal seed and classification layer

Add one internal seed file:

- `index/seeds/official-repos.json`

Suggested shape:

```json
{
  "tier1": ["owner/repo"],
  "tier2": ["owner/repo"]
}
```

Use it to extend the trusted-seed loader with internal-only sets for:

- `officialTier1Repos`
- `officialTier2Repos`

Add one small internal helper to derive repo class:

- Tier 1 = curated official Tier 1 OR `>= 50k` stars
- Tier 2 = curated official Tier 2 OR `10k–50k` stars
- otherwise long tail

This remains a derived internal classification only.

Do **not** add a new stored production `tier` field.

#### 2. Preview reporting

Stage A should add a preview block to shadow reporting only.

The preview should include:

- `tierCounts`
- `missingTier1Repos`
- `missingTier2Repos`
- `unresolvedCatalogRepos`
- `momentumRepoSources`
- `currentDailyPriorityRepos`
- `proposedDailyPriorityRepos`
- `dailyPriorityAdded`
- `dailyPriorityRemoved`
- `currentShortlistRepos`
- `proposedShortlistRepos`
- `shortlistAdded`
- `shortlistRemoved`

This preview data should live in `shadow-report.json` and `shadow-summary.md` only.

#### 3. Proposed selection rules

The current proposed daily-priority preview is a simple additive scored model.

It proposes a `50` repo hotset for Stage B review. The active crawler still deep-refreshes the current `40` repo hotset until Stage B is explicitly approved.

The score uses:

- official Tier 1
- official Tier 2
- gold basket
- trusted vendor
- derived Tier 1
- derived Tier 2
- momentum
- simple star buckets

This remains preview-only unless Stage B approves activating it.

The current preview shortlist / rising rules are source-aware:

- official: always eligible
- `skills.sh` or validated X: `>= 100` stars
- `registry` / `awesome`: `>= 250` stars
- `topics` / `code` / `social` / `aggregators`: `>= 500` stars

Momentum should be defined exactly as:

- `skills.sh` momentum:
  - repo appears in the current `skills.sh` discovery results for the run
- validated X momentum:
  - repo appears in the current validated X artifact
- if both apply:
  - the repo still counts once in the preview ranking
  - the preview report may still note both sources
- `momentum` is a derived selection/reporting signal only
- `momentum` is not stored in production outputs

Validated X should come from existing artifacts only.

The main shadow crawl must not depend on live X crawling.

#### 4. Shadow refresh-policy rules

The current shadow refresh design is:

- daily priority = hotset deep refresh
- non-daily repos = weekly attempted cheap repo-meta checks
- cheap check compares repo `lastUpdated` against persisted top-skill `last_updated`
- deep refresh runs for:
  - daily hotset repos
  - non-daily repos flagged as changed by cheap check
- cheap-triggered deep refresh is capped at `150` repos per combined run
- changed repos over the cap are deferred and remain eligible later because their prior `lastObservedRepoUpdatedAt` is preserved
- high-star `SKILL.md` discovery is weekly-gated, not part of every combined crawl

Shadow-only repo state tracks `lastCheapCheckedAt` to make this coverage deterministic.

Repo-missing cheap checks count as attempted coverage and are reported separately.

Failed admissions are cleaned up after bootstrap and after final repo-index reconciliation.

Manual include seeds are crawler-only config and are empty by default.

The first run after enabling this design was expected to be heavier because of backlog burn-down.

The rerun-stability verifier now uses **refresh replay only**:

- it records refresh/enrich IO once
- then replays that refresh data for the two comparison builds
- discovery stays live in the verifier seed build

### Validation and rollout

#### Stage A validation

Stage A implementation is mostly complete.

Remaining Stage A work is final safety-gate confirmation and output-library inspection.

Run:

- `npm run scrape:shadow`
- `npm run test:shadow-guard`
- `npx tsx scraper/new-crawl/verify-rerun-stability.ts`
- `npx tsx scraper/new-crawl/verify-steady-state-acceptance.ts`

Verify:

- no production-facing JSON contract changes
- scored preview and refresh redesign remain shadow-only
- shadow report contains the new preview block
- preview output is deterministic across reruns
- missing X artifact only produces a warning
- first combined run completes once to burn down the initial cheap-check backlog
- steady-state verifier exits `0`
- repo-missing and unresolved-path churn are reviewed

#### Stage B validation

After Stage A review passes, and only after churn tuning is accepted, enable Crawl 4 primary with v2 fallback and run:

- `npm run scrape:shadow`
- `npm run test:shadow-guard`
- `npx tsx scraper/new-crawl/verify-rerun-stability.ts`
- manual `workflow_dispatch` of `shadow-crawl-health`

Verify:

- cutover validation still passes
- Crawl 4 output library is published to `/data/crawl4`
- v2 fallback is still published to `/data/v2`
- client can load Crawl 4 first and fall back to v2
- publish/deploy validation does not change client-facing data contracts
- `/health/` remains green for both primary and fallback health
- `skills.json`, `trending.json`, and `x-trending.json` shapes are unchanged
- behavior differences are limited to approved Crawl 4 policy decisions

#### Stage C validation

During the public Crawl 4 primary trial, verify:

- safety gates pass across trial runs
- Crawl 4 remains acceptable versus v2 fallback
- the release client works against Crawl 4 output
- fallback to v2 works when Crawl 4 is unavailable or invalid
- v2 scrape/publish remains healthy while it is the fallback
- runtime and API pressure remain acceptable

#### Stage D validation

Before retiring v2 fallback, verify:

- the public Crawl 4 primary trial has been accepted
- rollback to v2 has not been needed for a sustained period
- v2 retirement has a separate approval
- no client-facing schema drift was introduced

### Acceptance rule

Do not activate Stage B until Stage A preview has shown:

- stable rerun behavior
- no production contract drift
- no cutover validation regression
- no publish/deploy regression in the manual validation path
- useful missing-head reporting
- curated Tier 1 / Tier 2 coverage report that looks correct
- manual review of added/removed daily-priority and shortlist samples with no obvious bad promotions
- one full backlog burn-down run completes
- one follow-up run shows steady-state cheap-check behavior
- steady-state acceptance passes:
- hard fail if cheap-check attempts are more than `25%` away from weekly eligible target
  - hard fail if cheap-triggered deep refresh ratio is `>20%`
  - hard fail if cheap-triggered refresh cap does not hold at `<=150`
  - hard fail if `runRefresh` is `>60m`
  - hard fail if empty `library-admission` repos are `>0`
  - warning if cheap-check attempts are `15-25%` away from weekly eligible target
  - warning if cheap-triggered deep refresh ratio is `10-20%`
  - changed repos deferred by the cap are expected when changed volume is high
  - warning if `runRefresh` is `45-60m`
- repo-missing and unresolved-path churn are reviewed
