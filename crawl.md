# Crawl System

This doc explains the crawler and library build as they exist today.

Use this as the durable system guide. Historical Crawl 4 planning docs live under [`archive/`](/Users/jonslimak/Projects/omgskills/archive).

## Current Data Tracks

The app data model now has two compatible tracks:

- Crawl 4 primary: `/data/crawl4/manifest.json`
- v2 fallback: `/data/v2/manifest.json`

Both tracks should keep the same client-facing data shape.

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

### v2 fallback

The v2 crawler keeps fallback data fresh while clients can still fall back to v2.

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
- install arm: skills.sh installs/rank above threshold (T2.2)
- normal discovery + remaining star/value checks

Plus always: clean-mapping gate, catalog/repackaged exclusion, not on
do-not-crawl, not suppressed.

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
| X validated mention | discovery candidate only, no bypass | corroborating evidence at most | never |
| gold-basket / curation | — | strong proposal evidence | operator's call |
| watched creator | admission bypass | — | operator's call |
| stars | tie-breaker/evidence, no longer the gate | evidence | never |

### The X (Twitter) rule

A tweet counts as a signal only when it passes existing X validation:
minimum engagement (≥50 likes) AND it links to a real repo whose `SKILL.md`
parses. It then earns exactly one thing — a discovery candidate that goes
through normal Door 1 admission. X never admits by itself, never watches a
creator, never features anyone.

## Crawl 4 Policy Summary

Crawl 4 is intentionally selective.

Main behavior:

- daily priority focuses on high-value hotset repos
- proposed Stage B hotset is `50` repos
- active daily deep-refresh hotset is `50`
- non-daily repos receive weekly cheap repo-meta checks
- cheap-triggered deep refresh is capped at `150` repos per combined run
- high-star `SKILL.md` discovery is weekly-gated
- discovery is not admission
- new repos must pass value and clean-mapping gates
- unresolved catalog/repackaged skills are excluded from maintained output
- manual curation is supported through `/curate` and `crawl4:add-skill`

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
5. write shadow outputs
6. validate cutover output

Important shadow artifacts:

- `index/shadow/skills.cutover.shadow.json`
- `index/shadow/skill-signals.cutover.shadow.json`
- `index/shadow/repo-index.shadow.json`
- `index/shadow/skills.overlay.json`
- `index/shadow/shadow-report.json`
- `index/shadow/shadow-summary.md`

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

- `shadow-crawl-health` runs the shadow crawl, validates output, publishes v2, publishes Crawl 4, deploys the site, and verifies live manifests.

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

# Manual curation
npm run crawl4:add-skill -- <github-skill-md-url>
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
- both tracks must stay client-compatible
- v2 crawler keeps fallback data fresh
- Crawl 4 crawler owns the new library policy
- manual curation feeds Crawl 4, not v2
- X remains a separate feed, not extra rows inside `skills.json`
