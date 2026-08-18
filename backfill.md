# Crawl 4 Trusted-Creator Backfill

## Goal

Backfill missing skills from approved creators quickly, then keep approved coverage fresh through bounded weekly maintenance.

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

### Run bounded maintenance

```bash
cd index
npm run crawl4:creator-backfill -- --maintain --limit=125
```

Maintenance builds a fresh plan and applies at most `125` candidates through the same planner, enrichment, policy, and persistence paths. It exits successfully without writes when GitHub core quota is below `3,500`, and it does not change normal daily Crawl 4 behavior.

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

Status: complete and live-validated on 2026-08-10. The first bounded batch processed the full reviewed plan without transient failures.

- [x] add `crawl4:creator-backfill -- --apply`
- [x] process `125` attempts by default with a hard maximum of `150`
- [x] reconcile the plan against current overlays and policy before enrichment
- [x] record added, existing, policy-skipped, stable-failed, and transient-failed outcomes
- [x] persist resumable progress in `shadow/creator-backfill.apply.json`
- [x] let stable failures advance without blocking later candidates
- [x] keep transient failures retryable
- [x] preserve the scheduled crawler's GitHub quota reserve
- [x] validate and write successful additions transactionally in batches of `10`
- [x] never publish automatically

Completion gate:

- apply tests pass
- repeated runs are idempotent
- interrupted or rate-limited runs can resume safely
- new repos enter `library`; existing repo state remains unchanged
- cutover validation passes

### B5. Pilot backfill campaign

Status: complete and validated on 2026-08-10. The reviewed plan contained `85` candidates across `3` creators. Apply added `78`, skipped `5` existing exact-SHA duplicates, recorded `2` stable invalid-frontmatter failures, and had `0` policy or transient failures. A subsequent normal combined crawl preserved the exact `78` IDs in both cutover and the skill overlay; cutover validation passed and all `467` shadow-guard tests passed.

Addition review:

- all `78` additions have valid descriptions, install commands, paths, authors, and `original` provenance
- no unresolved catalog/repackaged content or exact-SHA duplicate remains in the additions
- `74` are clear keeps
- `4` highly personal/project-specific skills remain optional manual-review items: `davidondrej/autogit:.agents/skills/npm-publish`, `davidondrej/skills:skills/ops-and-setup/read-prod-database`, `davidondrej/skills:skills/research-and-web/fireflies-transcript`, and `mattpocock/course-video-manager:.claude/skills/document-ai-hero-api`

- [x] build a plan for `emilkowalski`, `mattpocock`, and `davidondrej`
- [x] review grouped plan counts before applying
- [x] apply one bounded batch
- [x] inspect added, skipped, and failed samples
- [x] review additions through Crawl 4 output
- [x] run one normal combined Crawl 4 crawl
- [x] confirm overlay persistence and safety gates
- [x] keep publishing deferred as a separate explicit action

Completion gate:

- additions are useful and policy-compliant
- no catalog or blocked content enters cutover output
- a normal combined crawl preserves the additions
- production and v2 remain unchanged until explicit publish/cutover action

### B6. Weekly creator coverage maintenance

Status: implemented and live-validated on 2026-08-14.

- [x] add `crawl4:creator-backfill -- --maintain --limit=125`
- [x] rebuild a fresh plan before each maintenance apply
- [x] reuse the existing planner, bounded apply, enrichment, and policy paths
- [x] skip cleanly before plan or apply when GitHub core quota is below `3,500`
- [x] treat an empty plan as a clean success
- [x] schedule maintenance for Sunday at `06:00 UTC`
- [x] keep the Sunday `12:00 UTC` and all other runs unchanged
- [x] add manual `creator_coverage=true` workflow dispatch support
- [x] upload plan, apply progress, and maintenance logs as workflow artifacts
- [x] run one manual production-writer validation with `creator_coverage=true`
- [x] confirm the normal guard, promote, publish, deploy, and live verification path completes

Completion gate:

- a manual maintenance run completes without bypassing quota or policy guards
- zero candidates or low quota exits cleanly
- real additions, if any, remain capped at `125`
- cutover validation and published-data verification pass
- ordinary Crawl 4 runs remain unchanged

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
- maintenance rechecks quota between planning and applying
- maintenance treats an empty fresh plan as success
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

Completed on 2026-08-10:

1. Built and reviewed the `85`-candidate plan for `emilkowalski`, `mattpocock`, and `davidondrej`.
2. Applied the complete bounded queue: `78` added, `5` existing, `2` stable failures.
3. Reviewed the resulting additions and confirmed no catalog or exact-SHA duplicate leakage.

Validation completed on 2026-08-10:

1. A normal combined Crawl 4 crawl preserved all `78` additions in cutover and the skill overlay.
2. Cutover validation passed and all `467` shadow-guard tests passed.
3. Production and hosted data were not changed. Publishing remains a separate explicit action.

## Front-Loaded Coverage Campaign

Status: complete. The trusted-creator backlog was cleared through bounded operator batches; weekly coverage now handles later maintenance.

The read-only plan generated on 2026-08-10 found:

- `13` approved creators
- `571` repositories inspected
- `981` discovered `SKILL.md` files
- `657` missing candidates
- `565` policy/existing-state exclusions
- `0` repositories requiring additional review

The largest candidate groups are:

- `wshobson`: `118`
- `mengto`: `114`
- `googleworkspace`: `74`
- `steipete`: `62`
- `intellectronica`: `50`
- `coreyhaines31`: `49`
- `trailofbits`: `49`

No candidate path matched the current fixture, test, benchmark, template, asset, or internal-directory warning patterns. This does not replace post-enrichment quality review.

### Execution result

The resumable plan was processed through bounded batches:

- `657` final candidate outcomes
- `424` added
- `231` already existing
- `2` stable failures
- `0` policy skips
- `0` transient failures
- `0` pending candidates

### Finalization

Completed:

1. Ran a normal combined Crawl 4 crawl to verify overlay persistence.
2. Passed cutover validation, shadow safety gates, and publication-impact review.
3. Promoted the accepted cutover through the shared `index/skills.json` baseline in commit `e73beb3`.
4. Published and verified both Crawl 4 and v2 through the normal shared path.

Crawl 4 and v2 currently share the promoted `index/skills.json` baseline. A Crawl 4-only manual publish would be temporary and could be overwritten by the next scheduled workflow, so final campaign publication must use the normal shared path.

The initial backlog is cleared. Weekly creator coverage now reuses the same planner/apply path to discover and admit future skills.

### Manual creator intake and coverage

New creators use one reviewed sequence. Publication remains separate:

1. Plan and apply `creator:intake`, then commit the creator registry change.
2. Run `crawl4:creator-backfill -- --plan --creators=handle,...` and review the plan.
3. Run bounded `--apply` batches until only temporary failures remain.
4. Run `--retry-transient` to retry only temporary failures.
5. Run `--verify`; it fails unless every discovered `SKILL.md` is added, already present, policy-rejected, or invalid.

Manual apply and verification fail if the source commit, effective policy, or creator registry changed after planning. The final JSON and Markdown reports are written under `index/shadow/`. No command in this sequence publishes collections or deploys the site.

## Current Weekly Coverage

Status: complete and operational as of 2026-08-18.

Current registry state:

- all `74` featured creators have a reviewed coverage decision
- `13` use full coverage
- `60` use selected-repository coverage
- `nousresearch` is intentionally deferred because `hermes-agent` mixes original skills with attributed third-party ports
- `0` featured creators remain undecided

The maintenance job runs Sunday at `06:00 UTC`, is capped at `125`, and keeps manual operator backfill available for deliberate campaigns. It does not create a separate enrichment path.

Final coverage review completed on 2026-08-18:

- added selected coverage for `garrytan`, `paperclipai`, `othmanadi`, and `onepixelaway`
- excluded test, optional, catalog, development, release, and tool-specific mirror paths
- a read-only plan inspected `337` `SKILL.md` files across `13` repositories
- `27` clean candidates remain for normal bounded maintenance
- `310` paths were already present or excluded by reviewed policy
- `0` repositories require additional review

Live validation completed on 2026-08-14 in `shadow-crawl-health` run `31808260924`:

- `239` fresh candidates planned
- `125` candidates processed
- `2` skills added
- `122` already existing
- `1` stable `missing-frontmatter` failure
- `0` policy skips and `0` transient failures
- `114` candidates deferred for later bounded maintenance
- quota guard, cutover validation, both data publishes, deploy, and live manifest verification passed
- both added skills were verified in hosted Crawl 4 and v2 data
- follow-up `pipeline-health` run `31811251121` passed and restored health to `OK`

The backfill project is complete. Future work is routine operation:

1. Let weekly maintenance process the remaining bounded queue, or run the same maintenance command manually when immediate coverage is useful.
2. Revisit `nousresearch` only after provenance-aware path review can distinguish original Hermes skills from third-party ports.
