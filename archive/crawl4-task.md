# Crawl v4 Task Status

Historical note: this was the Crawl 4 implementation/status checklist. The current crawl system guide is [`crawl.md`](/Users/jonslimak/Projects/omgskills/crawl.md).

Crawl 4 evolved during implementation.

The current source of truth is [`crawl.md`](/Users/jonslimak/Projects/omgskills/crawl.md). This archived status doc should be treated as historical context.

Older bucketed-preview and rolling-TTL-only notes should not be treated as current policy.

Crawl 4 is moving from shadow/test into the primary client data track.

The rollout model is Crawl 4 primary with v2 fallback.

Public clients should load `/data/crawl4/manifest.json` first and fall back to `/data/v2/manifest.json` if Crawl 4 fails to load or validate.

The v2 crawler/publish path stays active while it is the fallback.

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
- reopen tuning only if the public Crawl 4 primary trial exceeds runtime/API thresholds

### Library admission proof

Done.

- manual include seed is crawler-only config and is empty by default
- manual include satisfies the value gate only
- clean mapping still requires successful bootstrap
- failed admissions are cleaned up after bootstrap and final repo-index reconciliation
- the temporary admission-validation flag was removed after proof

### Crawl 4 client test toggle

Done.

- macOS client can switch between production v2 and Crawl 4 data
- Crawl 4 uses separate cache files
- local shadow fallback works for testing before hosted Crawl 4 data is fresh
- catalog/repackaged collection-like results are demoted in search, not removed

### Crawl 4 hosted publish path

Done.

- `shadow-crawl-health` publishes Crawl 4 data to `/data/crawl4`
- v2 publish remains active at `/data/v2`
- both tracks use the same client-facing data shape

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

### Latest Crawl 4 output check

Done.

Latest local shadow output, checked at `2026-06-23T15:47:52.704Z`:

- `shadowSkillOverlayWrittenCount`: `5`
- `bootstrappedRepoCount`: `0`
- `catalogAdmissionCount`: `0`
- `bootstrapFailedRepoCount`: `2`
- `bootstrapSkippedRepoCount`: `179`
- cutover validation: passed

The current `+5` Crawl 4 skills persisted across a full combined cycle:

- `huashu-design`
- `anysearch`
- `ai-avatar-video`
- `mmx-cli`
- `solana-dev`

### Latest live rollout signal

Latest checked live state on `2026-06-29`:

- `shadow-crawl-health`: success
- live health: OK
- live v2 and live Crawl 4 skills assets currently match
- live skill count: `50,488`
- unresolved catalog/repackaged in live v2: `0`
- `sickn33/antigravity-awesome-skills` in live v2: `0`
- `verify-rerun-stability`: still advisory-only and drifted on provenance

Current interpretation:

- blocking publish gates are passing
- rerun-stability remains useful but should not block fresh data
- legacy `scrape` remains important while v2 is the fallback

## Pending decision gates

### Library admission / growth policy

Defined for v1, but not fully validated at backfill scale.

Current v1 policy:

- discovery is not admission
- value gate: manual include, official seed, trusted vendor, gold basket, or `500+` stars
- clean gate: successful bootstrap / clean mapping
- catalog-like unresolved repos stay out
- manual include does not bypass clean mapping

Still open:

- whether `500+` stars is the right value threshold after a real backfill sample
- whether the first bounded backfill has acceptable quality
- whether newly admitted repos should default to `library` only, with `rising` decided separately

This should be validated before finalizing Crawl 4 as the long-term crawler policy.

### Bounded backfill trial

Still open.

Run a bounded admission/bootstrap pass before any larger growth push:

- cap admitted/bootstrap candidates at `50`
- use the existing v1 admission policy
- inspect all newly admitted skills for quality
- confirm catalog-like repos do not leak into maintained output
- rerun one normal combined crawl to confirm persistence
- only then decide whether to repeat another bounded batch

### Stage B: Crawl 4 primary with v2 fallback

Current rollout gate.

Decision:

- release clients should default to Crawl 4
- clients must fall back to v2 on Crawl 4 fetch/parse/validation failure
- v2 scrape/publish remains active
- health must treat Crawl 4 primary and v2 fallback as separate responsibilities

This is not v2 retirement.

### Public Crawl 4 primary trial acceptance

Still open:

- safety gates pass across trial runs
- Crawl 4 output library remains acceptable versus v2 fallback
- release client works against Crawl 4 output
- fallback to v2 works when Crawl 4 is unavailable or invalid
- no client-facing schema drift
- runtime and API pressure are acceptable

### v2 fallback retirement

Later decision.

Do not retire v2 until:

- Crawl 4 has run as public primary for a sustained period
- fallback has not been needed for normal operation
- legacy `scrape` failures no longer affect rollback safety
- a separate retirement decision is approved

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

Done for v1; reopen only if public primary runs exceed runtime/API thresholds:

- repo-missing quarantine
- unresolved-path visibility
- weekly high-star discovery gate
- cheap-triggered refresh cap

## Next work

Recommended order:

1. update docs for Crawl 4 primary + v2 fallback rollout
2. update client default/fallback behavior
3. keep v2 scrape and publish alive while fallback exists
4. monitor health/workflows for several days
5. fix or downgrade any legacy `scrape` failures that make v2 fallback unreliable
6. decide later whether v2 fallback can be retired

## What is no longer current

The following older ideas should not be treated as the current Crawl 4 plan:

- bucketed daily-priority preview as the chosen final direction
- trusted-vendor bucket micro-tuning as the main path
- rolling deep-refresh TTL/cap policy as the long-term refresh design
- assumption that Stage B is ready immediately after preview review

## Acceptance checkpoint before more behavior changes

Before any additional refresh-policy work or v2 fallback retirement:

- one full `combined` backlog burn-down run completes
- one follow-up `combined` run shows steady-state behavior
- library admission / growth policy is explicitly defined
- steady-state acceptance criteria are explicitly defined
- no production JSON contract drift
- no cutover validation regression
- repo-missing and unresolved-path churn are reviewed
- Crawl 4 primary and v2 fallback health are both understood
- docs stay aligned with the implemented shadow design
