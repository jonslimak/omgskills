# Crawl System

Validated 2026-08-04 against `origin/main` at `2bae217`.

This doc explains the crawler and library build as they exist today.

Use this as the durable system guide. Historical Crawl 4 planning docs live under [`archive/`](/Users/jonslimak/Projects/omgskills/archive).

## Current Data Tracks

Production has three published manifests:

| Track | Manifest | Writer | Purpose |
|---|---|---|---|
| Crawl 4 primary | `/data/crawl4/manifest.json` | Combined Crawl 4 workflow | Preferred current catalog |
| v2 fallback | `/data/v2/manifest.json` | Validated Crawl 4 promotion | Client fallback while Crawl 4 proves sustained health |
| legacy root | `/data/manifest.json` | Nightly v2 scraper | Compatibility for older clients and consumers |

The primary and fallback tracks keep the same required client contract. Crawl 4
may add optional fields such as `quality_tier`; promotion strips Crawl 4-only
fields before publishing v2. Clients must tolerate optional fields being present
or absent.

The v2 fallback and legacy root track are transition infrastructure, not
separate product strategies. Do not retire either without explicit approval and
the adoption, health, and rollback checks in `aug.md`.

Local source artifacts:

- `index/shadow/skills.cutover.shadow.json`
  - Crawl 4 candidate library output
- `index/skills.json`
  - shared validated catalog staging file; written by the v2 scraper or Crawl 4
    promotion depending on the serialized workflow
- `index/trending.json`
  - v2 trending metadata
- `index/x-trending.json`
  - X/Twitter feed rows for the X tab

Important:

- the X tab reads `x-trending.json`
- X rows are not appended into `skills.json`
- Crawl 4 hosted output is generated from shadow/cutover artifacts

## Crawler Responsibilities

### Crawl 4

Crawl 4 owns primary catalog discovery, admission, refresh, and quality logic.
Cross-track exclusions and creator policy come from the shared policy layer.

It should focus on:

- high-value and trending skills
- clean repo-to-skill mapping
- broad freshness through weekly cheap checks
- bounded expensive refresh work
- catalog-like unresolved content exclusion
- manual curation when an operator intentionally adds a skill
- creator-first trust through the creator registry
- durable duplicate/source suppression
- final-output quality tiers for editorial and web use

### v2 fallback

The v2 fallback is built from validated Crawl 4 promotion and independently
hosted so clients can recover when the Crawl 4 track cannot be loaded. The
nightly v2 scraper still maintains the legacy root track.

Do not stop publishing either compatibility track until its retirement is
explicitly approved.

### Health and publishing

Health checks should monitor all three published manifests while compatibility
tracks exist.

All production data writers use the `app-data-writers` concurrency group, sync
to current `origin/main`, validate policy, capture last-known-good publication
state, and run the publication-impact gate before commit or deployment.

Publish flows keep one track from breaking another:

- Crawl 4 failure should not corrupt v2 fallback
- v2 or root failure still matters while those compatibility tracks exist
- advisory checks should not block fresh data when blocking validation already passed
- structural live verification failure restores the prior deploy only when the
  failed candidate is still the live deploy

Use `deploy.md` for deployment, receipt, rollback, and pipeline-health
operations.

## Admission and Trust Model — the three doors

Captured 2026-07-07 as the durable rulebook for how anything enters the system.
Signals fill the library and write proposals; the operator grants trust; only
the operator endorses.

### Door 1 — Library admission (fully automatic)

A skill enters the searchable library when any value-gate arm passes:

- watched-creator repo (registry `watch: true`, flag-gated)
- official, trusted-vendor, or trusted-creator source
- gold-basket or manual include
- install arm when enabled: skills.sh all-time rank `<=1000` or installs `>=4000`
- validated X discovery when the repo has `50+` stars
- normal discovery when the repo has `500+` stars

Plus always: clean-mapping gate, catalog/provenance policy, not on do-not-crawl,
and not individually suppressed. Unresolved catalog/repackaged rows are excluded
from maintained output.

No human review. The library is the wide base; a mediocre skill entering is
cheap. Correction happens through the removal lists (do-not-crawl,
suppressed-skills), not through pre-review.

### Door 2 — Watch (machine proposes, operator ratifies)

Watch is a discovery and prioritization grant: daily new-repo tracking,
flag-gated admission, and hotset slots. Entry process:

- signals write `proposed-creators.json` (gold-basket authorship, skills.sh
  boards, momentum, manual curation)
- operator reviews in editool's proposals panel: **Add watched** or
  **Dismiss** (both recorded in `creators.json` so decisions persist)

Weekly batched review is not a bottleneck: **nothing waits for it.** A hot
skill from an unknown creator enters through Door 1 the same day on its own
merits. Watch only accelerates the creator's *future* repos.

Registry fields have separate meanings:

- `roles: ["vendor"]` or `roles: ["creator"]` grants a trusted value signal
  when a repository is otherwise discovered
- `watch: true` enables the creator-watch lane only when
  `CRAWL4_CREATOR_WATCH=1`
- `featured: true` controls editorial endorsement and requires `watch: true`;
  it does not independently admit catalog rows
- aliases normalize old or alternate handles to one registry owner

### Door 3 — Featured (fully human)

Public endorsement: creator profiles, collections. Granted only by the
operator (editool / `creators.json` `featured: true`, which implies `watch`).
No signal ever auto-features anyone.

### What each signal is allowed to do

| Signal | Door 1 (library) | Door 2 (watch) | Door 3 (featured) |
|---|---|---|---|
| skills.sh installs/rank | admits a skill above threshold | proposal evidence | never |
| skills.sh board movement (momentum) | refresh priority only | proposal evidence | never |
| X validated mention + `50+` repo stars | admits through the X arm | corroborating evidence at most | never |
| gold-basket / curation | admits through trusted/manual value arm | strong proposal evidence | operator's call |
| trusted vendor/creator role | admits a discovered clean repo | operator-managed | operator's call |
| watched creator | flag-gated discovery and admission | operator-managed | operator's call |
| featured creator | no independent admission effect | implies watch | operator only |
| stars | normal admission at `500+`; X arm at `50+`; ranking evidence elsewhere | evidence | never |

### The X (Twitter) rule

A tweet counts as a signal only when it passes existing X validation: English
text, minimum engagement (at least 50 likes), and a link to a real repo whose
`SKILL.md` parses. It then becomes an `x-social` discovery candidate. The repo
must also have at least `50` stars and pass the normal clean-mapping, catalog,
suppression, and do-not-crawl checks. X never watches or features a creator.

## Shared Policy Inputs And Precedence

`index/scraper/policy/` is the shared loader, validator, reason vocabulary, and
digest implementation used by both crawler tracks and Editool. Authoritative
inputs include:

- `seeds/creators.json`
- `seeds/official-repos.json` and `seeds/manual-include-repos.json`
- `seeds/do-not-crawl.json` and `seeds/suppressed-skills.json`
- `seeds/repo-overrides.json`, `seeds/catalog-repos.json`, and
  `seeds/provenance-overrides.json`
- `seeds/root-skill-invalid.json`, which affects only a v2 repository-root
  `SKILL.md`; eligible nested skills remain allowed

Scheduled data workflows run:

```bash
cd /Users/jonslimak/Projects/omgskills/index
npm run policy:validate -- --profile scheduled-data
```

Malformed policy and ownership conflicts block scheduled data work. Stale
editorial references remain advisory there so editorial drift cannot stop fresh
catalog data; collection publishing and Editool use stricter profiles.

Effective admission precedence is deny-first:

1. do-not-crawl owner or repository
2. explicit repository exclusion
3. known-catalog or explicit non-original provenance
4. skill-level suppression; bootstrap skips a suppressed candidate and tries
   the next deterministic candidate
5. manual, official, trusted, gold-basket, creator-watch, X, stars, or install
   value signals

Generated reports include stable reason codes, the source commit, and the
effective-policy digest. Generated reports and crawler output are evidence, not
authoring surfaces.

## Crawl 4 Policy Summary

Crawl 4 is intentionally selective.

Main behavior:

- daily priority focuses on high-value hotset repos
- active daily deep-refresh hotset is `50`
- hotset order is official (`12`), gold basket (`10`), trusted vendor (`8`),
  watched creator (up to `8` when enabled), momentum (up to `5` when enabled),
  then a skill-focused stars fill
- stars fill prefers watched owners when enabled, multi-skill repos, and skill-focused repo names
- non-daily repos receive weekly cheap repo-meta checks
- weekly cheap-check target is `ceil(eligible non-daily repos / 7)`
- cheap-triggered deep refresh is capped at `150` repos per combined run
- changed repos over the cap are deferred without advancing their observed update
- repo 404s are quarantined from future weekly coverage
- high-star `SKILL.md` discovery is weekly-gated
- scheduled high-star discovery uses `500+` stars and samples up to `50` repos
- discovery is not admission
- new repos must pass value and clean-mapping gates
- unresolved catalog/repackaged skills are excluded from maintained output
- manual curation is supported through `/curate` and `crawl4:add-skill`

### Active and opt-in behavior

The scheduled Crawl 4 writer uses:

- `CRAWL4_POLICY_PRECEDENCE=admission`
- `CRAWL4_QUALITY_TIERS=1`

Admission mode applies the shared deny-first rules to new repository admission.
Repo-state and quality-tier policy differences are still reported rather than
enforced. Report-only runs use `observe`; full `enforce` is not active.

These implemented behaviors remain explicit opt-ins:

- `CRAWL4_CREATOR_WATCH=1`: creator-watch discovery, admission, and hotset slice
- `CRAWL4_INSTALL_ADMISSION=1`: skills.sh rank/install admission arm
- `CRAWL4_MOMENTUM_PRIORITY=1`: momentum hotset and promotion attention

Local runs without these flags must not be assumed to exercise those paths.
Roll out remaining flags one at a time through the replay, report-only, and
scheduled-canary process in `aug.md`.

## v2 Scraper And Legacy Root Track

Entrypoint:

- [`index/scraper/build.ts`](/Users/jonslimak/Projects/omgskills/index/scraper/build.ts)

Run with:

```bash
cd /Users/jonslimak/Projects/omgskills/index
npm run scrape
```

What it does:

1. backs up `skills.json`
2. loads existing `skills.json`
3. loads `sha-cache.json`
4. fetches discovery sources
5. merges candidates
6. enriches candidates into validated `Skill` records
7. carries forward still-valid older skills
8. atomically rewrites `skills.json`

The nightly production workflow runs at `03:00 UTC`, enforces shared policy,
and publishes the legacy root manifest. The combined Crawl 4 workflow may later
replace `skills.json` through validated promotion before publishing the separate
v2 fallback manifest. Both writers are serialized.

Important behavior:

- writes are atomic
- checkpoints are written during large runs
- SHA reuse avoids reparsing unchanged `SKILL.md` files
- safety checks prevent catastrophic library shrinkage
- scheduled production runs set `V2_POLICY_MODE=enforce`
- manual report-only observation sets `V2_POLICY_MODE=observe` and uses
  `--dry-run`, leaving the catalog and caches unchanged
- each run writes `shadow/v2-policy-diff.shadow.json` and `.md` before publish;
  reports include the source commit, policy digest, migration coverage, reason
  counts, and bounded samples
- each run also writes `shadow/v2-policy-input.shadow.json`, a content-addressed
  compact input snapshot that can reproduce the policy report without crawling
- `root-skill-invalid.json` rejects only a repository-root `SKILL.md` under the
  active policy; nested skill paths remain eligible
- legacy exclusion constants remain only to build comparison and migration
  evidence; they do not control enforced production output
- production stops starting new enrichment after a 300-minute soft deadline,
  carries forward the existing catalog for deferred candidates, and records
  processed/deferred counts and estimated completion in the job summary
- GitHub requests use a 30-second timeout so a hung request cannot consume the
  full six-hour workflow limit

## Crawl 4 Build

Entrypoint:

- [`index/scraper/new-crawl/build-shadow.ts`](/Users/jonslimak/Projects/omgskills/index/scraper/new-crawl/build-shadow.ts)

Main commands:

```bash
cd /Users/jonslimak/Projects/omgskills/index
npm run scrape:shadow
npm run promote:cutover
npm run test:shadow-guard
```

The combined production workflow runs at `06:00 UTC` and `12:00 UTC` with a
three-hour job limit. Manual report-only mode does not publish or deploy.

High-level flow:

1. build Crawl 4 discovery and repo index
2. canonicalize admission candidates through current GitHub repository identity
3. apply repo and skill overlays
4. run admission and bootstrap
5. run refresh policy for the current cadence
6. apply suppression, catalog, provenance, and final quality-tier policy
7. record admission outcomes after refresh
8. write and validate shadow/cutover output

Repository canonicalization runs before admission so renamed aliases do not
appear as new repositories. It checks at most 25 admission candidates per run,
rewrites skill IDs and URLs to the canonical owner/repo, merges aliases into an
existing canonical record when possible, and defers candidates on lookup error
or cap exhaustion instead of admitting uncertain identity.

If a newly admitted trusted-creator repository has no usable bootstrap path,
Crawl 4 may inspect its repository tree and try up to 10 deterministic nested
`SKILL.md` candidates. Every fallback candidate still passes suppression,
catalog, provenance, and other admission policy.

Important shadow artifacts:

- `index/shadow/skills.cutover.shadow.json`
- `index/shadow/skill-signals.cutover.shadow.json`
- `index/shadow/repo-index.shadow.json`
- `index/shadow/skills.overlay.json`
- `index/shadow/shadow-report.json`
- `index/shadow/shadow-summary.md`
- `index/shadow/policy-precedence-input.shadow.json`
- `index/shadow/policy-precedence.shadow.json`
- `index/shadow/policy-precedence.shadow.md`

Combined runs persist repo and non-baseline skill overlays. Quality tiers are
never persisted in overlays; they are recomputed from current policy at final
cutover.

The precedence report distinguishes:

- **eligible:** proposed policy accepted the repository
- **applied:** admission created a library repository entry
- **persisted:** final refresh retained at least one publishable skill
- **dropped:** refresh left no publishable skill, so cleanup removed the empty
  repository

An eligible or applied candidate is not proof of a catalog addition; production
proof requires a persisted result in the final repo index and cutover output.

### Policy observation and replay

Policy input snapshots contain only the facts needed by the existing v2 and
Crawl 4 evaluators. The snapshot ID hashes the complete policy-relevant fact
set, excluding capture and refresh timestamps. Snapshots and reports are
generated evidence, not policy inputs or authoring surfaces.

Replay is local, deterministic, and network-free:

```bash
cd /Users/jonslimak/Projects/omgskills/index
npm run policy:replay -- \
  --snapshot shadow/policy-precedence-input.shadow.json \
  --output-dir shadow/replay
```

Use `shadow/v2-policy-input.shadow.json` for the v2 track. A snapshot older than
72 hours remains valid for regression testing, but the command warns and the
evidence verifier will not count it toward rollout readiness.

Evidence comparisons have two explicit modes:

```bash
# Same facts, changed policy.
npm run policy:evidence -- --mode policy-diff \
  --first <before-report.json> --second <after-report.json>

# Same policy, changed catalog facts.
npm run policy:evidence -- --mode drift \
  --first <first-report.json> --second <second-report.json> --require-ready
```

`policy-diff` requires the same snapshot ID and different policy digests.
`drift` requires the same digest and different snapshot IDs. Identical inputs
are rejected as a no-op. For v2, migration coverage is complete only when the
existing P1.5 audit reports `enforcementReady: true`.

The manual `policy-observation` GitHub workflow runs either or both tracks and
uploads snapshots plus reports. It checks once at startup for an active
production data writer, then stays read-only. It cannot commit, publish, deploy,
or occupy the `app-data-writers` lock. A writer that starts later may safely
overlap because the observation has no production write path.

Manual evidence shortens development feedback, but it does not eliminate live
validation. After two fresh independent observations pass under one policy
digest, run one normal scheduled canary before changing an enforcement flag.

### Discovery and bounded backfill

Normal combined runs keep broad discovery bounded. The weekly high-star lane
accepts only direct skill paths:

- `SKILL.md`
- `.claude/skills/**/SKILL.md`
- `.agents/skills/**/SKILL.md`
- `skills/**/SKILL.md`

The trusted-creator nested bootstrap fallback described above is a narrow
recovery path for a newly admitted trusted repository, not another broad
discovery lane.

The operator-only backfill mode can sample up to `250` repos and admit at most
`50` new repos per run. It reuses normal admission, bootstrap, catalog, and
cutover validation rather than creating a second ingestion path.

## Skill Identity Contract

`skill_md_sha` is a Git blob SHA-1 over the exact raw `SKILL.md` bytes:

```text
SHA1("blob " + byteLength + NUL + rawBytes)
```

The crawler hashes bytes before UTF-8 decoding. It performs no newline,
whitespace, Unicode, frontmatter, or Markdown normalization. The macOS client
uses the same algorithm for local files.

Identity layers stay separate:

- `skill_md_sha` identifies one exact file version
- skill ID identifies one catalog record and remains stable
- canonical attribution chooses a preferred record among exact copies
- logical equivalence groups related Claude/Codex variants without merging them

The published `shaHistory` side asset retains `shaToSkillIds` for compatibility.
Canonical attribution is an additive `canonicalBySha` annotation; it does not
replace the existing multi-ID map or rewrite skill IDs.

Current identity/duplicate behavior:

- exact-SHA duplicate clusters are generated as shadow metadata
- durable skill removals live in `seeds/suppressed-skills.json`
- blocked owners/repos live in `seeds/do-not-crawl.json`
- known catalogs live in `seeds/catalog-repos.json` and cannot win canonical selection by stars
- canonical publication is limited to validated high-confidence same-repository
  mappings; malformed or stale annotations fail publication

## Quality, Snippets, and Safety Audits

Crawl 4 publishes one optional quality tier per maintained skill:

- `curated`: gold-basket skill, manual curation, or original skill from a featured creator
- `creator`: original skill from an official repo, watched creator, or trusted vendor
- `validated`: the remaining maintained library, including known catalog-classified rows that remain eligible

Known catalog policy takes precedence over creator trust. Tier values are
validated at cutover. Promotion strips `quality_tier` before writing the v2
fallback source.

`readme_snippet` is optional and capped at `1,000` characters. It is derived from
already-fetched `SKILL.md` content, starting at the first real Markdown content
section. The targeted web-library snippet backfill runs weekly on combined cadence
or manually with `--force-web-library-snippets`; it does not add a separate repo
README fetch.

Security screening is an operator-only, read-only audit over `curated` and
`creator` skills. It reports static risk patterns and fetch/path coverage. It does
not grant trust, block admission, suppress skills, or modify published data.

## Publishing Data Tracks

Legacy root data:

```bash
./scripts/publish-data.sh
```

Crawl 4 hosted data:

```bash
node scripts/publish-crawl4-data.mjs
```

v2 hosted data:

```bash
OMGSKILLS_DATA_SUBDIR=v2 ./scripts/publish-data.sh
```

Workflow note:

- every writer validates the `scheduled-data` policy profile and captures a
  committed last-known-good publication baseline before generation
- `shadow-crawl-health` runs admission-mode Crawl 4, validates output, promotes
  cutover, publishes v2 and Crawl 4, appends SHA history, checks publication
  impact, commits generated data, builds one combined site artifact, deploys,
  and verifies live manifests
- `promote:cutover` writes validated Crawl 4 records into `index/skills.json` for
  v2 publication while stripping Crawl 4-only `quality_tier`.
- unchanged SHA history reuses its existing hashed asset
- publication impact blocks missing assets, stale manifests, or unexpected
  shrink unless a reviewed manual dispatch supplies both the override flag and
  a reason; scheduled jobs never add an override automatically
- the production deploy helper fetches and checks current `origin/main`, records
  the previous Netlify deploy, verifies the combined live surface, and restores
  the prior deploy only if structural verification fails while its candidate is
  still live
- blocking crawl, cutover, publish, deploy, and live-manifest checks must pass;
  rerun stability and stale editorial references remain advisory where fresh
  catalog publication must continue

This section is intentionally high-level. Use [`deploy.md`](/Users/jonslimak/Projects/omgskills/deploy.md) for Mac release and site deployment details.

## Trending and X

Trending entrypoint:

- [`index/scraper/build-trending.ts`](/Users/jonslimak/Projects/omgskills/index/scraper/build-trending.ts)

Run with:

```bash
cd /Users/jonslimak/Projects/omgskills/index
npm run scrape:trending
```

X enrichment entrypoints:

- [`index/scraper/collect-x-skill-tweets.ts`](/Users/jonslimak/Projects/omgskills/index/scraper/collect-x-skill-tweets.ts)
- [`index/scraper/merge-x-skill-tweets.ts`](/Users/jonslimak/Projects/omgskills/index/scraper/merge-x-skill-tweets.ts)
- [`index/scraper/run-x-enrichment.ts`](/Users/jonslimak/Projects/omgskills/index/scraper/run-x-enrichment.ts)

Run with:

```bash
cd /Users/jonslimak/Projects/omgskills/index
npm run scrape:x
npm run scrape:with-x
```

Important:

- X enrichment is optional
- missing X credentials skips cleanly unless `X_STRICT=1`
- X enrichment writes the separate X feed
- normal library crawls should not erase the X feed unless `x-trending.json` is rebuilt

## Manual Curation

Manual curation is a Crawl 4 operator path.

Use `/curate` in Codex or run:

```bash
cd /Users/jonslimak/Projects/omgskills/index
npm run crawl4:add-skill -- <github-skill-md-url>
```

Manual curation can bypass normal discovery/value rules, but it cannot bypass:

- valid `SKILL.md` parsing
- clean GitHub fetch
- do-not-crawl or explicit repository exclusion
- skill-level suppression
- known-catalog or non-original provenance exclusion
- cutover validation

Manual curation should not hand-edit production `skills.json`.

Curated additions enter through Crawl 4. They reach v2 only through the normal
validated promotion path.

Removal uses the existing durable operator path:

```bash
npm run crawl4:remove-repo -- owner/repo
npm run crawl4:removal-audit
```

Use skill-level suppression for duplicate rows and repo/owner blocks only when
the source itself should not be crawled again.

## Change Principles

Use these principles for future crawler changes:

- keep the client schema stable unless explicitly approved
- prefer shadow/test output before replacing public behavior
- keep fallback healthy during transitions
- make expensive refresh work bounded
- treat discovery and admission as separate steps
- keep catalogs as hints, not authoritative library entries
- avoid letting advisory checks block fresh data when blocking validation already passed

## Transition Strategy

Current rollout state:

- scheduled v2 enforces shared policy
- scheduled Crawl 4 enforces admission precedence only
- repo-state and quality-tier precedence changes remain observation-only
- creator-watch, momentum, and install-admission flags remain disabled
- one persisted new-repository admission is still required as the final P1
  production proof

Track remaining rollout decisions in `aug.md`. For future crawler changes:

1. run the new crawler alongside the current fallback track
2. point test/client builds at the new track with fallback
3. monitor quality, freshness, runtime, and workflow health
4. keep compatibility writers and fallback publication healthy during the
   transition
5. retire fallback only after sustained confidence and explicit approval

Rollback should be simple:

- switch client default back to v2
- keep Crawl 4 data available for inspection
- do not require rebuilding the crawler to recover

## Commands to Know

```bash
cd /Users/jonslimak/Projects/omgskills/index

# v2 scraper / legacy root
npm run scrape
npm run scrape:trending
npm run scrape:x
npm run scrape:with-x
V2_POLICY_MODE=observe npm run scrape -- --dry-run

# Crawl 4
npm run scrape:shadow
CRAWL4_POLICY_PRECEDENCE=admission CRAWL4_QUALITY_TIERS=1 npm run scrape:shadow
npm run promote:cutover
npm run test:shadow-guard

# Optional Crawl 4 behavior
CRAWL4_CREATOR_WATCH=1 npm run scrape:shadow
CRAWL4_INSTALL_ADMISSION=1 npm run scrape:shadow
CRAWL4_MOMENTUM_PRIORITY=1 npm run scrape:shadow
CRAWL4_QUALITY_TIERS=1 npm run scrape:shadow

# Bounded operator runs
npm run scrape:shadow -- --cadence=combined --only-high-star-backfill
npm run scrape:shadow -- --cadence=combined --force-web-library-snippets

# Manual curation
npm run crawl4:add-skill -- <github-skill-md-url>
npm run crawl4:remove-repo -- owner/repo

# Read-only audits
npm run crawl4:removal-audit
npm run crawl4:audit-canonical-commits
npm run crawl4:validate-canonical-policy
npm run crawl4:audit-security -- --limit=100 --offset=0

# Shared policy
npm run policy:validate -- --profile scheduled-data

# Offline policy evidence
npm run policy:replay -- --snapshot <snapshot.json> --output-dir shadow/replay
npm run policy:evidence -- --mode <policy-diff|drift> \
  --first <first-report.json> --second <second-report.json>
```

From the repo root:

```bash
node scripts/publish-crawl4-data.mjs
OMGSKILLS_DATA_SUBDIR=v2 ./scripts/publish-data.sh
./scripts/publish-data.sh
```

## Practical Summary

The current system is:

- Crawl 4 is the primary intended library track
- v2 remains the fallback track during transition
- the legacy root track remains for compatibility with older consumers
- Crawl 4 and v2 stay client-compatible but are not byte-for-byte identical
- the nightly v2 scraper publishes legacy root data; validated Crawl 4
  promotion publishes the v2 fallback
- Crawl 4 owns primary discovery/admission while both crawler paths consume
  shared exclusion and creator policy
- scheduled v2 enforces shared exclusions; scheduled Crawl 4 applies shared
  precedence to admission only
- manual curation enters through Crawl 4 and reaches v2 through validated promotion
- quality tiers exist only on the Crawl 4 hosted track
- creator/install/momentum behavior remains opt-in unless explicitly enabled
- X remains a separate feed, not extra rows inside `skills.json`
