# Crawl System

This doc explains the crawler and library build as they exist today.

Use this as the durable system guide. Historical Crawl 4 planning docs live under [`archive/`](/Users/jonslimak/Projects/omgskills/archive).

## Current Data Tracks

The app data model has two client-compatible tracks:

- Crawl 4 primary: `/data/crawl4/manifest.json`
- v2 fallback: `/data/v2/manifest.json`

Both tracks keep the same required client contract. Crawl 4 may add optional
fields, such as `quality_tier`; v2 deliberately strips Crawl 4-only fields during
promotion. Clients must tolerate optional fields being present or absent.

The fallback exists to reduce rollout risk while Crawl 4 becomes the main library path. It is not a separate product strategy.

Local source artifacts:

- `index/shadow/skills.cutover.shadow.json`
  - Crawl 4 candidate library output
- `index/skills.json`
  - v2 fallback library source
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

Crawl 4 owns the new library policy.

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

The v2 track stays fresh through its existing scrape/publish path and validated
Crawl 4 promotion. It remains independently hosted so clients can fall back when
the Crawl 4 track cannot be loaded.

Do not stop crawling or publishing v2 until fallback retirement is explicitly approved.

### Health and publishing

Health checks should monitor both tracks while fallback exists.

Publish flows should keep one track from breaking the other:

- Crawl 4 failure should not corrupt v2 fallback
- v2 failure still matters while v2 is the fallback
- advisory checks should not block fresh data when blocking validation already passed

## Admission and Trust Model — the three doors

Captured 2026-07-07 as the durable rulebook for how anything enters the system.
Signals fill the library and write proposals; the operator grants trust; only
the operator endorses.

### Door 1 — Library admission (fully automatic)

A skill enters the searchable library when any value-gate arm passes:

- watched-creator repo (registry `watch: true`, flag-gated)
- official / trusted-vendor source
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

Watch is a trust grant: daily new-repo tracking, admission bypass, hotset
slots. Entry process:

- signals write `proposed-creators.json` (gold-basket authorship, skills.sh
  boards, momentum, manual curation)
- operator reviews in editool's proposals panel: **Add watched** or
  **Dismiss** (both recorded in `creators.json` so decisions persist)

Weekly batched review is not a bottleneck: **nothing waits for it.** A hot
skill from an unknown creator enters through Door 1 the same day on its own
merits. Watch only accelerates the creator's *future* repos.

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
| watched creator | admission bypass | — | operator's call |
| stars | normal admission at `500+`; X arm at `50+`; ranking evidence elsewhere | evidence | never |

### The X (Twitter) rule

A tweet counts as a signal only when it passes existing X validation:
minimum engagement (≥50 likes) AND it links to a real repo whose `SKILL.md`
parses. It then becomes an `x-social` discovery candidate. The repo must also
have at least `50` stars and pass the normal clean-mapping, catalog, suppression,
and do-not-crawl checks. X never watches or features a creator.

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

The scheduled Crawl 4 workflow enables `CRAWL4_QUALITY_TIERS=1`.

These implemented behaviors remain explicit opt-ins:

- `CRAWL4_CREATOR_WATCH=1`: creator-watch discovery, admission, and hotset slice
- `CRAWL4_INSTALL_ADMISSION=1`: skills.sh rank/install admission arm
- `CRAWL4_MOMENTUM_PRIORITY=1`: momentum hotset and promotion attention

Local runs without these flags must not be assumed to exercise those paths.

## v2 Fallback Build

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

Important behavior:

- writes are atomic
- checkpoints are written during large runs
- SHA reuse avoids reparsing unchanged `SKILL.md` files
- safety checks prevent catastrophic library shrinkage
- scheduled runs set `V2_POLICY_MODE=observe`, preserving legacy output while
  comparing it with the shared exclusion policy
- each run writes `shadow/v2-policy-diff.shadow.json` and `.md` before publish;
  reports include the source commit, policy digest, migration coverage, reason
  counts, and bounded samples
- each run also writes `shadow/v2-policy-input.shadow.json`, a content-addressed
  compact input snapshot that can reproduce the policy report without crawling
- `root-skill-invalid.json` rejects only a repository-root `SKILL.md` under the
  proposed policy; nested skill paths remain eligible
- enforcement stays blocked until two consecutive scheduled reports are
  reviewed and the mode change is approved separately

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

High-level flow:

1. build Crawl 4 discovery and repo index
2. apply repo and skill overlays
3. run admission and bootstrap
4. run refresh policy for the current cadence
5. apply suppression, catalog, provenance, and final quality-tier policy
6. write shadow outputs
7. validate cutover output

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

Crawl 4 hosted data:

```bash
node scripts/publish-crawl4-data.mjs
```

v2 hosted data:

```bash
OMGSKILLS_DATA_SUBDIR=v2 ./scripts/publish-data.sh
```

Workflow note:

- `shadow-crawl-health` runs the shadow crawl, validates output, publishes v2,
  publishes Crawl 4, appends SHA history, deploys the site, and verifies live
  manifests. Unchanged SHA history reuses its existing hashed asset.
- `promote:cutover` writes validated Crawl 4 records into `index/skills.json` for
  v2 publication while stripping Crawl 4-only `quality_tier`.
- blocking crawl, cutover, publish, deploy, and live-manifest checks must pass;
  rerun-stability remains advisory and has a bounded timeout.

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
- unresolved catalog/repackaged exclusion
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

General pattern for crawler changes:

1. run the new crawler alongside the current fallback track
2. point test/client builds at the new track with fallback
3. monitor quality, freshness, runtime, and workflow health
4. keep fallback crawling and publishing during the transition
5. retire fallback only after sustained confidence and explicit approval

Rollback should be simple:

- switch client default back to v2
- keep Crawl 4 data available for inspection
- do not require rebuilding the crawler to recover

## Commands to Know

```bash
cd /Users/jonslimak/Projects/omgskills/index

# v2 fallback
npm run scrape
npm run scrape:trending
npm run scrape:x
npm run scrape:with-x

# Crawl 4
npm run scrape:shadow
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
npm run crawl4:audit-security -- --limit=100 --offset=0

# Offline policy evidence
npm run policy:replay -- --snapshot <snapshot.json> --output-dir shadow/replay
npm run policy:evidence -- --mode <policy-diff|drift> \
  --first <first-report.json> --second <second-report.json>
```

From the repo root:

```bash
node scripts/publish-crawl4-data.mjs
OMGSKILLS_DATA_SUBDIR=v2 ./scripts/publish-data.sh
```

## Practical Summary

The current system is:

- Crawl 4 is the primary intended library track
- v2 remains the fallback track during transition
- both tracks stay client-compatible but are not byte-for-byte identical
- v2 stays fresh through its existing pipeline and validated Crawl 4 promotion
- Crawl 4 crawler owns the new library policy
- manual curation enters through Crawl 4 and reaches v2 through validated promotion
- quality tiers exist only on the Crawl 4 hosted track
- creator/install/momentum behavior remains opt-in unless explicitly enabled
- X remains a separate feed, not extra rows inside `skills.json`
