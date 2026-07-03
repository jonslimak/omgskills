# Next — Work Order

Suggested implementation sequence across the active workstreams, as of 2026-07-03.

The underlying logic: **foundation → content → surfaces → enrichment**. Settle the data track, create the curation data, ship the surfaces that read it, then layer identity on top. The one deliberate inversion: web library jumps ahead of identity/groups because SEO value compounds with time and nothing else on the list is time-sensitive.

## Status correction

Crawl 4 Stage B is already shipped — release clients default to Crawl 4 primary with v2 fallback (`defaultDataMode = .crawl4PrimaryWithV2Fallback`, no debug split). We are effectively in the Stage C public trial. `crawl-4.md` and `crawl4-task.md` still describe Stage B as the open gate and need a doc sync.

---

## 1. Crawl 4 Stage C doc sync + publish safety

- monitor health/workflows across trial runs (several days)
- record keep / tune / block per run
- update `crawl-4.md` / `crawl4-task.md` to reflect Stage B shipped, and fold in the crawler obligations created by the newer docs:
  - **skill ID stability invariant** — IDs are a cross-system contract (editorial, groups, web URLs); never rename or recycle without a migration story (`web-library.md` audit finding 1)
  - **manifest preservation rule** — crawler publish owns its own assets but must preserve foreign manifest entries (`collections` now; sha history index later)
  - **upcoming publish assets** — sha history index and cross-agent equivalence clusters (`identity.md`), both shadow-first when built
  - **document the `skill_md_sha` computation** (normalization + algorithm) so the client can compute it identically (`identity.md` step 1)
- v2 retirement (Stage D) stays a later, separate decision

Active prerequisite before #2/#3:

- confirm/update Crawl 4 publish scripts so they preserve foreign manifest entries instead of overwriting them
- add a lightweight ID-stability guard or test if the current ID generation path has an obvious hook
- record the contract in the Crawl 4 docs even if the first guard is doc-only

After the safety check lands, Stage C monitoring continues passively while building #2 and #3.

Why first in the list: everything below touches either the publish path or the published data. New manifest assets (collections, sha index, equivalence clusters) should land on a settled primary track, one at a time, and crawler publishes must not wipe assets owned by other layers.

## 2. Editorial MVP

Plan: [`editorial.md`](editorial.md)

- `index/curations/collections.json` + `publish:collections` script
- client: `Collection.swift`, `CollectionPageView`, empty-search entry points, author-link interception
- seed: 3 author pages (OpenAI, Anthropic, Cursor) + Starter Pack + Design Essentials

Why now: smallest scoped project on the list, zero schema risk, immediately visible in the product. It should land before the web library because it produces the creator/collection data that makes the strongest SEO pages worth shipping.

## 3. Web library Phase 1 (~2K pages)

Plan: [`web-library.md`](web-library.md)

- `scripts/build-web-library.mjs` — skill + profile pages for the curated head (trending, gold basket, top authors)
- deploy wiring into `prepare-netlify-site-deploy.mjs` and both publish workflows
- sitemaps, canonicals, JSON-LD, Search Console registration
- exact Phase 1 inclusion rule should be decided before implementation: trending + gold basket + featured authors + a fixed top-author/top-skill cap

Why this early: SEO compounds with time — indexing takes months to ramp, and every month the pages don't exist is growth that doesn't come back. No client dependency, so it parallelizes with #2.

## 4. Identity — exact resolution ladder + sha history index

Plan: [`identity.md`](identity.md)

- client: ladder steps 1–3 (install provenance, git inspection, content-hash match) — all exact, no UX
- crawler: append-only `sha → skill id` index as a small manifest asset
- measure what share of installed skills resolves before deciding on the fuzzy confirm-once UX

Why before skill groups ship: groups are the first consumer. Resolution feeds `catalog_skill_id` on sync, so groups launch catalog-aware instead of full of unresolved rows.

## 5. Ship the skill groups portal

- apply the concrete MVP fixes listed in the `skillgroup.md` alignment addendum (on the branch): legacy-manifest read in `portal-catalog-search.mts`, `stableKey` fallback, `catalogSkillId` population from #4, matching-rule spec extraction
- the legacy-manifest fix is independent and can land on the branch any time before merge
- merge `codex/skillgroups-mvp`, launch at `app.omgskills.com`
- synced skills arrive resolved thanks to #4
- public groups become a future SEO layer (web library Phase 3)

Do not move this ahead of #4 unless we deliberately accept a launch with more unresolved synced skills.

## 6. Later pile

- fuzzy confirm-once resolution UX — only if #4 measurements justify it
- cross-agent equivalence clusters in Crawl 4 publishing — shadow-first, like every crawler change
- web library Phase 2 — full ~50K pages (config change off Phase 1)
- editorial post-MVP expansion — the extended creator/company/topic lists in `editorial.md`
- Stage D — v2 fallback retirement, plus legacy root manifest retirement
- public skill group pages, tag/topic browse pages, app deep links
