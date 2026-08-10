# Crawl 4 Trusted-Creator Backfill

## Goal

Backfill missing skills from approved creators quickly, without waiting for weekly crawls or changing production data.

The backfill should run in bounded batches of `125` candidates and reuse the normal Crawl 4 enrichment, policy, overlay, and cutover-validation paths.

## Coverage Policy

Store reviewed coverage decisions in `index/seeds/creators.json`.

For a creator whose public skill repositories are broadly trusted:

```json
{
  "handle": "emilkowalski",
  "watch": true,
  "skillCoverage": "all"
}
```

For a large or mixed account where only specific repositories are approved:

```json
{
  "handle": "googleworkspace",
  "watch": true,
  "skillCoverage": "selected",
  "skillRepos": ["googleworkspace/cli"]
}
```

Rules:

- `all` scans active, non-fork repositories owned by the creator.
- `selected` scans only repositories listed in `skillRepos`.
- no coverage setting preserves existing behavior.
- coverage requires `watch: true`.
- creator aliases resolve to the canonical registry handle.
- repositories with more than `150` `SKILL.md` files require explicit `skillRepos` approval.

Watching a creator remains separate from comprehensive coverage. `watch` controls ongoing creator monitoring; `skillCoverage` explicitly approves broader intake.

The registry schema, shared policy validation, and editool must be updated together. `formatCreators` must preserve `skillCoverage` and `skillRepos`; otherwise saving the Creators tab would silently remove reviewed coverage decisions. Validation must enforce:

- `skillCoverage` is `all` or `selected`
- `selected` requires at least one valid `owner/repo` entry in `skillRepos`
- coverage requires `watch: true`
- editool save round-trips the new fields without formatting churn

## Operator Commands

Use one operator command with separate planning and apply modes.

### Build the plan

```bash
cd index
npm run crawl4:creator-backfill -- --plan
```

Planning should:

- enumerate configured creators and repositories
- inspect repository trees directly instead of relying on truncated GitHub code search
- find exact files named `SKILL.md` at any depth
- canonicalize redirected repository names
- compare repo and path against baseline, cutover, and overlays
- exclude do-not-crawl repositories, catalog repositories, and suppressed skills before counting candidates
- report candidate counts grouped by creator and repository for operator review
- write `index/shadow/creator-backfill.plan.json`
- make no library changes

Unexpected repository counts must be reviewed before apply. The `150`-file guard is not sufficient by itself; grouped counts should expose suspicious repositories that fall just below it.

### Apply the next batch

```bash
cd index
npm run crawl4:creator-backfill -- --apply
```

Apply behavior:

- process the next `125` candidates
- enforce a hard maximum of `150`
- use deterministic creator, repo, and path ordering
- skip candidates already present
- stop cleanly on GitHub rate limiting
- record added, skipped, stable-failed, and transient-failed outcomes
- allow consecutive batches without waiting for the weekly crawler

The generated plan tracks campaign progress, but the Crawl 4 overlays remain authoritative. Rebuilding a plan must safely skip completed skills.

Healthy skip counts are expected. Some selected repositories are already largely indexed, and some skills may already be classified as catalog-like or suppressed.

## GitHub Quota Safety

Planning and applying both consume GitHub API quota. They must reuse the existing quota guard with a backfill-specific reserve.

- require approximately `3,500` requests remaining before starting either phase
- preserve at least the scheduled crawler's `2,000`-request reserve
- stop cleanly if quota pressure or rate limiting appears during a phase
- persist already validated batch progress before exiting safely
- never weaken the scheduled crawler's quota guard

The exact threshold may be tuned after measuring the first campaign, but operator backfills must not starve scheduled production crawls.

## Shared Enrichment Path

Do not build a second skill parser or enrichment implementation.

Extract and reuse the persistence behavior already used by `crawl4:add-skill`. Each candidate must pass through:

- stable skill-ID generation
- `enrichCandidate(...)`
- provenance resolution
- do-not-crawl policy
- catalog policy
- suppressed-skill policy
- shadow skill and repo overlays
- cutover validation

The batch path must support adding multiple skills to an already-maintained repository.

Backfilled entries must use the distinct source/reason `creator-backfill`. This provides an audit trail for removal reports and lets publication-impact reporting explain a large admission batch without forensic reconstruction.

## Persistence and Safety

Each successful batch updates atomically:

- `index/shadow/skills.overlay.json`
- `index/shadow/repo-index.overlay.json`
- `index/shadow/skills.cutover.shadow.json`
- `index/shadow/repo-index.shadow.json`

The operator mode must not automatically:

- publish Crawl 4 data
- modify production `index/skills.json`
- modify v2 data
- run unrelated discovery
- run weekly cheap checks
- run the daily hotset refresh

Stable parse or policy failures should not block later candidates. Transient failures should remain retryable.

Post-backfill behavior:

- a new backfilled repo enters `library`; an existing repo keeps its current state
- backfilled repos receive normal weekly cheap-check coverage
- backfill does not grant `core`, `rising`, or daily-hotset priority
- the operator path works while `CRAWL4_CREATOR_WATCH` is disabled because it uses the manual overlay path

## Initial Reviewed Coverage

### Full creator coverage

- `emilkowalski`
- `mattpocock`
- `davidondrej`
- `coreyhaines31`
- `jeffallan`
- `steipete`
- `mengto`
- `intellectronica`

### Selected repositories

- `googleworkspace/cli`
- `wshobson/agents`
- `phuryn/pm-skills`
- `trailofbits/skills`
- `danielmiessler/lifeos`

### Deferred pending repository-level review

- `anthropics`
- `microsoft`
- `openai`
- `get-convex`
- `composiohq`
- `xixu-me`
- `posthog`
- `paperclipai`
- `dotnet`
- `automattic`
- `google`
- `facebook`
- `flutter`
- `cursor`

These larger or mixed accounts may contain internal tooling, fixtures, plugin bundles, or catalogs. They should use selected-repository coverage after review.

## Implementation Checklist

Implement and verify each task separately. Do not begin the next task until the current task's tests pass.

### B1. Registry and editool safety

Status: complete and validated on 2026-08-10.

- [x] add `skillCoverage` and `skillRepos` to the creator registry type
- [x] add shared validation for coverage mode, repo format, and watch requirement
- [x] update editool creator formatting to preserve both fields
- [x] verify editool save round-trips coverage decisions without formatting churn
- [x] store the 8 reviewed full-coverage and 5 selected-repository decisions
- [x] keep crawler behavior unchanged

Completion gate:

- registry and editool tests pass
- an editool save cannot remove coverage fields
- no shadow or production data changes

### B2. Read-only backfill planner

Status: complete and validated on 2026-08-10. The reviewed plan found `85` candidates across `3` creators; exact-SHA checks remain required during apply.

- [x] add `crawl4:creator-backfill -- --plan`
- [x] enumerate approved creators and repositories
- [x] inspect repository trees for exact `SKILL.md` filenames at any depth
- [x] canonicalize redirected repository names
- [x] exclude existing, suppressed, catalog, and do-not-crawl candidates
- [x] apply the large-repository review guard
- [x] report candidate counts by creator and repository
- [x] run the GitHub quota preflight
- [x] write only `shadow/creator-backfill.plan.json`

Completion gate:

- planner tests pass
- generated ordering and counts are deterministic
- no library, overlay, cutover, or production files change
- operator reviews unexpected creator/repository counts

### B3. Shared batch persistence helper

Status: complete and validated on 2026-08-10.

- [x] extract reusable shadow persistence from `crawl4:add-skill`
- [x] support multiple skills in the same existing repository
- [x] preserve existing repository state
- [x] set `creator-backfill` source/reason for backfill additions
- [x] skip exact-SHA backfill duplicates before persistence
- [x] validate the complete proposed cutover before guarded transactional writes
- [x] keep `crawl4:add-skill` behavior unchanged

Completion gate:

- manual-add regression tests pass
- batch persistence tests pass
- a validation failure produces no partial shadow writes
- publication/removal reports can identify `creator-backfill`

### B4. Bounded apply runner

- add `crawl4:creator-backfill -- --apply`
- process `125` attempts by default with a hard maximum of `150`
- reconcile the plan against current overlays before every batch
- record added, existing, policy-skipped, stable-failed, and transient-failed outcomes
- let stable failures advance without blocking later candidates
- keep transient failures retryable
- preserve the scheduled crawler's GitHub quota reserve
- never publish automatically

Completion gate:

- apply tests pass
- repeated runs are idempotent
- interrupted or rate-limited runs can resume safely
- new repos enter `library`; existing repo state remains unchanged
- cutover validation passes

### B5. Pilot backfill campaign

- build a plan for `emilkowalski`, `mattpocock`, and `davidondrej`
- review grouped plan counts before applying
- apply one `125`-candidate batch
- inspect added, skipped, and failed samples
- review additions through Crawl 4 output or the test client
- run one normal combined Crawl 4 crawl
- confirm overlay persistence and safety gates
- publish only after explicit review

Completion gate:

- additions are useful and policy-compliant
- no catalog or blocked content enters cutover output
- a normal combined crawl preserves the additions
- production and v2 remain unchanged until explicit publish/cutover action

### Later: weekly creator coverage

Only after B1-B5 are validated:

- reuse the same planner/apply helpers in a bounded weekly run
- do not create separate weekly enrichment logic
- choose the weekly cap from measured runtime and quota usage
- keep manual operator backfill available for deliberate campaigns

## Tests

Add focused tests for:

- `all` and `selected` registry validation
- editool formatting preserves coverage fields byte-stably
- editool and shared policy validation reject invalid coverage settings
- alias-aware creator matching
- exact arbitrary-depth `SKILL.md` discovery
- exclusion of forks, archived repositories, blocked repositories, and catalogs
- exclusion of suppressed skills during planning
- grouped creator/repository plan counts
- skipping existing repo/path pairs
- adding multiple skills to an existing repository
- deterministic ordering and batch limits
- quota preflight protects the scheduled crawler reserve
- idempotent repeated runs
- stable failures not blocking later candidates
- transient failures remaining retryable
- atomic writes after successful cutover validation
- `creator-backfill` source/reason is persisted and reported
- new repos enter `library` while existing repo state is preserved
- unchanged normal Crawl 4 behavior

Run:

```bash
cd index
npm run typecheck
npx tsx --test scraper/new-crawl/creator-backfill.test.ts
npm run test:shadow-guard
```

## First Validation Campaign

1. Build a plan for `emilkowalski`, `mattpocock`, and `davidondrej`.
2. Apply one `125`-candidate batch.
3. Inspect added, skipped, and failed samples.
4. Review the additions in Crawl 4 output or the test client.
5. Continue approved batches until the reviewed queue is empty.
6. Run one normal combined Crawl 4 crawl to confirm overlay persistence.
7. Run shadow safety gates.
8. Publish Crawl 4 only after final review.

## Future Weekly Coverage

After the manual campaign is validated, the same shared planner/apply helper can power a bounded weekly creator-coverage run. Do not add separate weekly enrichment logic.
