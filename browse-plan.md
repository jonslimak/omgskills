# browse.sh investigation

## Summary

`browse.sh` looks useful as a **secondary discovery source** for omgskills.

It does **not** look like a good source of truth.

Best use:
- discover candidate skills
- capture method metadata like `api`, `browser`, `fetch`, `cli`, `mcp`
- optionally prioritize the more official / validated subset

## What it is

`browse.sh` is a public skill catalog with:
- human UI: `https://browse.sh/`
- compact catalog: `https://browse.sh/llms.txt`
- expanded catalog: `https://browse.sh/llms-full.txt`
- per-skill markdown: `https://browse.sh/skills/{domain}/{task}.md`

It is broader than browser automation. It includes:
- browser
- api
- fetch
- cli
- mcp

## Key findings

### Catalog size

- `llms.txt` currently exposes **351** skill links
- `llms-full.txt` yielded **336** parseable records in a quick parser pass

Use **351** as the better top-line library count.

### Crawlability

Good:
- predictable public URLs
- public `llms.txt`
- public `llms-full.txt`
- public markdown per skill

Weak:
- no obvious stable public search API for catalog discovery
- no clear sitemap-based export path found
- some data is easier to read from the agent surfaces than from the main UI

### Canonicality / provenance

Mixed.

The catalog often includes:
- target website/domain
- method metadata
- skill description
- sometimes a GitHub-looking source path

But this should still be treated as an aggregator layer, not ground truth.

### Quality / reliability

Risks observed:
- duplicate or near-duplicate skill variants
- uneven quality
- pending or draft-like entries
- possible drift between UI and agent surfaces

## Useful filters

### Official-ish

The strongest signal found is:
- `partner: true`

Count found in parseable `llms-full.txt` slice:
- **8** partner entries

This is the closest thing to “official”.

### Validated

The broader quality signal is:
- `verified: true`

Counts found in parseable `llms-full.txt` slice:
- **191** verified
- **138** unverified
- **7** missing

This should be treated as:
- stronger than raw catalog entries
- not the same thing as official

### Recommendation on filtering

If we ever ingest this source:
1. first prioritize `partner: true`
2. then allow `verified: true`
3. defer everything else unless we explicitly want long-tail discovery

## Recommendation

Use `browse.sh` as a **secondary discovery feed only**.

Do not ingest it as a canonical source.

Best posture:
- crawl it
- normalize it
- mark all records as provisional
- dedupe aggressively
- only trust important records after separate validation

## Short parser proposal

### Goal

Build a small, low-risk parser that can harvest `browse.sh` without coupling us to the UI.

### Proposed inputs

Primary inputs:
- `https://browse.sh/llms.txt`
- `https://browse.sh/llms-full.txt`

Optional follow-up:
- `https://browse.sh/skills/{domain}/{task}.md`

### Proposed flow

1. fetch `llms.txt`
2. extract all skill markdown URLs
3. fetch each `.md`
4. parse front matter fields such as:
   - `name`
   - `title`
   - `description`
   - `website`
   - `category`
   - `tags`
   - `status`
   - `partner`
   - `verified`
   - `recommended_method`
   - `updated`
   - `source`
5. store normalized records under source = `browse.sh`
6. filter or score using:
   - `partner`
   - `verified`
   - `status`
7. dedupe by:
   - `website`
   - normalized task name
   - high-overlap title/description

### Suggested v1 import rules

Include only records where:
- `status == launched` when present
- and either:
  - `partner == true`
  - or `verified == true`

Exclude for v1:
- draft / pending entries
- records missing a stable markdown page
- obvious duplicates

### Suggested stored fields

- `source = browse.sh`
- `source_url`
- `skill_url`
- `website`
- `task_slug`
- `title`
- `description`
- `category`
- `tags`
- `recommended_method`
- `verified`
- `partner`
- `status`
- `updated_at`
- `raw_markdown`

## Final recommendation

Do not work on ingestion yet.

When we revisit it, the right first step is:
- a tiny parser against `llms.txt` + per-skill `.md`
- scoped only to `partner: true` and `verified: true`
