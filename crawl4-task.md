# Crawl v4 Task Status

Crawl 4 evolved during implementation.

The current source of truth is the implemented shadow behavior plus [`crawl-4.md`](/Users/jonslimak/Projects/omgskills/crawl-4.md).

Older bucketed-preview and rolling-TTL-only notes should not be treated as current policy.

Crawl 4 should become a complete runnable shadow crawler track.

Its output library should be generated, inspected, and tested while public clients stay on the current production library/crawler until a separate explicit cutover decision.

## Done

### A1 — Official repo seed source

Done.

- curated official repo seed file exists
- seed loading exposes:
  - `officialTier1Repos`
  - `officialTier2Repos`

### A2 — Derived tier classification

Done.

- Tier 1 / Tier 2 / long tail are derived internally
- no persistent production `tier` field was added

### A3 — Momentum classification

Done.

- momentum is derived from:
  - `skills.sh`
  - validated X artifact
- missing X artifact is warning-only

### A4 — Preview reporting

Done.

Shadow reporting now includes:

- tier counts
- missing Tier 1 / Tier 2 repos
- unresolved catalog repos
- momentum repo sample/counts
- current vs proposed daily priority
- current vs proposed shortlist

### A5 — Proposed selection preview

Done, but the design changed from the original bucket plan.

What shipped:

- proposed daily priority is now a **scored preview model**
- proposed Stage B preview hotset is `50` repos
- active daily deep-refresh hotset remains `40` repos
- shortlist preview remains side-by-side reporting
- no production behavior was changed

### Shadow refresh redesign

Done.

What shipped:

- daily priority remains the deep-refresh hotset
- all non-daily repos get weekly **cheap repo-meta checks**
- deep refresh now runs for:
  - daily hotset repos
  - cheap-check repos flagged as changed

This is shadow-only behavior and does not change production JSON contracts.

### Churn tuning

Done.

- repo-missing churn is quarantined/excluded from weekly cheap coverage
- unresolved-path churn has current-run visibility in the shadow summary
- high-star `SKILL.md` discovery is weekly-gated to avoid daily search pressure
- cheap-triggered deep refresh is capped at `150` repos per combined run
- reopen tuning only if the parallel trial exceeds runtime/API thresholds

### Library admission proof

Done.

- manual include seed is crawler-only config and is empty by default
- manual include satisfies the value gate only
- clean mapping still requires successful bootstrap
- failed admissions are cleaned up after bootstrap and final repo-index reconciliation
- the temporary admission-validation flag was removed after proof

## Current verification

### Backlog burn-down

Done.

- one full `combined` shadow crawl completed
- weekly cheap-check backlog was populated
- daily hotset refresh and cheap-triggered refresh both ran
- cutover validation passed

### Steady-state follow-up after refresh cap

Done.

Latest accepted capped run, checked at `2026-06-22T16:06:04.035Z`:

- `runRefresh`: about `8.4m`
- `cheapReposChecked`: `1315`
- `monitoredDeepRefreshed`: `39`
- `cheapTriggeredRefreshCandidateCount`: `413`
- `cheapTriggeredRefreshDeferredCount`: `263`
- `cheapTriggeredDeepRefreshed`: `139`
- `staleInvalidCandidateCount`: `25`
- repo missing: `13`
- skill file missing: `11`
- validation failed: `1`
- empty admitted repos: `0`
- cutover validation: passed

Notes:

- `cheapReposChecked` now means attempted cheap checks, not only successful repo-meta reads.
- repo-missing cheap checks count as coverage attempts and are reported separately.
- changed repos deferred by the `150` cap keep their prior `lastObservedRepoUpdatedAt`, so they remain eligible later.
- high-star `SKILL.md` discovery is skipped on normal non-weekly combined runs.
- `verify-rerun-stability.ts` uses refresh replay only; discovery remains live in the verifier seed run.

### Next verification

Before any Stage B activation, run:

- `npm run scrape:shadow`
- `npm run test:shadow-guard`
- `npx tsx scraper/new-crawl/verify-rerun-stability.ts`
- `npx tsx scraper/new-crawl/verify-steady-state-acceptance.ts`

This should confirm:

- the complete Crawl 4 shadow crawler can run end to end
- the Crawl 4 output library can be inspected/tested independently
- public clients remain on the current production library/crawler
- cheap-check attempts are near weekly target
- cheap-triggered refresh ratio is not a hard fail
- repo-missing / unresolved-path churn is understood
- no production contract drift
- no cutover validation regression

## Pending decision gates

### Library admission / growth policy

Still open:

- what qualifies a discovered repo to enter the maintained library
- what qualifies a repo to become `rising`
- what stays out of the long tail even if discovered

This should be decided before finalizing Crawl 4 as the long-term crawler policy.

Decision inputs should include:

- source quality
- mapping quality / clean skill-path resolution
- stars / trust / official signals
- momentum / trending signals

### Stage B complete crawler policy decision

Still open:

- whether the complete Crawl 4 policy should enter the parallel trial
- whether the scored `50` repo hotset should replace the active `40` repo hotset
- whether weekly cheap checks and cheap-triggered refresh are accepted long term
- whether library admission/growth rules are accepted
- whether output-library inspection is good enough to keep public clients safely on current data until cutover

This should be decided only after:

- backlog burn-down verification
- steady-state review
- no cutover / contract regressions

### Parallel trial acceptance

Still open:

- safety gates pass across trial runs
- Crawl 4 output library is better or acceptable versus current production data
- test client works against Crawl 4 output
- no client-facing schema drift
- runtime and API pressure are acceptable

### Long-term refresh-policy decision

Provisionally accepted:

- weekly cheap-check coverage is the preferred long-term refresh model
- cheap-triggered refresh capping is implemented at `150` per combined run

### Steady-state acceptance criteria

Defined for v1.

Hard fail:

- cheap-check attempts are more than `25%` away from weekly eligible target
- cheap-triggered deep refresh ratio is `>20%`
- cheap-triggered refresh cap does not hold at `<=150`
- `runRefresh` is `>60 min`
- empty `library-admission` repos are `>0`
- required shadow report fields are missing

Warnings only:

- cheap-check attempts are `15-25%` away from weekly eligible target
- cheap-triggered deep refresh ratio is `10-20%`
- `runRefresh` is `45-60 min`

Pass:

- no hard failures
- `npm run test:shadow-guard` passes
- `npx tsx scraper/new-crawl/verify-rerun-stability.ts` passes
- `npx tsx scraper/new-crawl/verify-steady-state-acceptance.ts` exits `0`

### Tuning decisions

Done for v1; reopen only if parallel-trial runs exceed runtime/API thresholds:

- repo-missing quarantine
- unresolved-path visibility
- weekly high-star discovery gate
- cheap-triggered refresh cap

## Next work

Recommended order:

1. run safety gates if needed
2. inspect/test the Crawl 4 output library
3. set up/test a client version pointed at Crawl 4 output
4. run Crawl 4 in parallel for a few days
5. decide whether the complete Crawl 4 policy is ready for regular runs
6. only later decide any public/client cutover

## What is no longer current

The following older ideas should not be treated as the current Crawl 4 plan:

- bucketed daily-priority preview as the chosen final direction
- trusted-vendor bucket micro-tuning as the main path
- rolling deep-refresh TTL/cap policy as the long-term refresh design
- assumption that Stage B is ready immediately after preview review

## Acceptance checkpoint before more behavior changes

Before any new Stage B activation or additional refresh-policy work:

- one full `combined` backlog burn-down run completes
- one follow-up `combined` run shows steady-state behavior
- library admission / growth policy is explicitly defined
- steady-state acceptance criteria are explicitly defined
- no production JSON contract drift
- no cutover validation regression
- repo-missing and unresolved-path churn are reviewed
- docs stay aligned with the implemented shadow design
