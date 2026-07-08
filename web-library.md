# Web Library

This doc covers two things:

1. An audit of how skill data is managed across our four systems today
2. A plan for the missing piece — a public web representation of the skill library

The goal of the web library is SEO and discovery: ~50,000 skill pages that make the library searchable on the web, drive traffic to the app, and act as a marketing surface. It should be built without adding a new data track or duplicating the library.

---

## Part 1 — Data audit

### The four systems

| System | Data home | Format | Status |
|---|---|---|---|
| Crawler (Crawl 4 + v2) | `index/` → published to `omgskills.com/data/` | Flat JSON, hashed immutable assets + mutable manifests | Live, Stage B |
| Editorial layer | `index/curations/collections.json` → manifest asset | Flat JSON referencing skill IDs | Planned (`editorial.md`) |
| Skill groups (portal) | Netlify DB / Postgres | Relational: `users`, `skill_groups`, `synced_skills`, `skill_group_items` | MVP on `codex/skillgroups-mvp` |
| Web library | generated into `site/skills\|profiles\|collections/` (gitignored build artifacts) | Static HTML from published catalog | **Pilot live** (~66 URLs — see Phase 1 status) |

### How data flows today

- The crawler produces the **catalog**: `skills.json` (50,488 skills), `trending`, `xTrending`, plus derived signals (`skillSignals`, `authorSignals`, `authorLeaderboards`).
- Everything publishes to `site/data/` as content-hashed immutable files behind mutable manifests (`/data/v2/manifest.json`, `/data/crawl4/manifest.json`).
- The macOS client reads the manifests. Nothing else consumes the catalog yet.
- The portal DB stores user-owned data only. Its `synced_skills` and `skill_group_items` tables carry a `catalog_skill_id` column that **references the catalog by ID instead of copying it**. Full skill copies exist only for local-only skills that aren't in the catalog — which is correct, since those exist nowhere else.

### Audit verdict

The data model is in good shape. The key structural fact:

**The catalog skill ID is already the universal foreign key across every system.**

- Crawler: mints and owns the IDs (`owner/repo` or `owner/repo:skill-name`)
- Editorial: `featuredSkillIds` / `skillIds` reference catalog IDs
- Skill groups: `catalog_skill_id` references catalog IDs
- Web library (planned): one page per catalog ID

No system duplicates the library. Each layer stores only what it owns and points at the catalog for the rest. The web library must follow the same rule: **render from the published catalog, store nothing new.**

### Findings & recommendations

1. **Formalize the ID contract.** The skill ID is now a cross-system API. Crawl 4 must never rename or recycle IDs without a migration story — an ID change silently breaks editorial lists, group items, and web URLs. Add this as an explicit Crawl 4 invariant.
2. **Keep `/data/` serving as-is.** Same-domain, immutable-hashed, CDN-cached, clients depend on it. The web library reads the same published assets — no new data track, no subdomain move.
3. **Legacy root manifest.** `site/data/manifest.json` (pre-v2) still publishes alongside v2 and crawl4. Fold its retirement into the existing v2-retirement decision (Stage D) rather than treating it separately.
4. **Portal snapshot fields are fine.** `synced_skills.name/description` look like duplication but aren't — a user's local skill may differ from the catalog version, and local-only skills have no catalog row. Leave as designed.
5. **One catalog consumer rule.** Any future surface (web pages, portal enrichment, share cards) should read the published crawl4/v2 assets — never re-crawl, never maintain a parallel skill store.
6. **Locally installed skills lack catalog identity.** Skills installed before the tool, or made locally, carry no catalog ID or github_url. The resolution approach (content hashing, git inspection, sha history index) is captured in [`identity.md`](identity.md).

---

## Part 2 — Web library design

### What it is

A statically generated public page for every skill in the catalog, plus profile pages and editorial collection pages. Generated at publish time from the same JSON the clients read. Pure HTML, no runtime backend.

### URL structure

| Page | URL | Count (approx) |
|---|---|---|
| Skill | `/skills/{owner}/{repo}/{skill-slug}` | ~50K |
| Repo-level skill | `/skills/{owner}/{repo}` | included above |
| Profile | `/profiles/{handle}` | ~9K |
| Editorial collection | `/collections/{id}` | grows with editorial |
| Library index | `/skills/` | 1 |

Notes:
- Skill IDs map to URLs by replacing `:` with `/` and slugifying path segments. If multiple catalog IDs collide after slugging, the generator appends a short deterministic hash suffix to the colliding skill URLs.
- `/u/{handle}` stays reserved for portal user profiles (app users ≠ skill authors/publishers). Catalog people, companies, and teams get `/profiles/` to avoid the clash.
- Every page carries a canonical URL and appears in a sitemap index (chunked sitemaps, 10K URLs each).

### Page anatomy (skill page)

Everything below already exists in the published data — zero new content required:

- Name, description, author (linked to profile page) — ✅ built
- Install command with copy affordance — ✅ built
- Stars, last updated — ✅ built; installs and trending badge not yet rendered on skill pages
- README snippet — ⚠️ **generator supports it (`readme_snippet`), but Crawl 4 doesn't publish the field** — catalog skill records carry only `description`. This is the root cause of thin pages (~130 visible words); the fix is a data-pipeline change, not a generator change
- Tags — ⚠️ published in catalog data but not rendered (linked filtered views deferred as planned)
- Related: other skills by this author, other skills in the same repo — ✅ built (3 cards each)
- App install CTA — ✅ built (header "Get the Mac app")

Profile pages: avatar (GitHub), stats from `authorLeaderboards`, skill list, editorial subtitle/description when the handle is in `featuredAuthors`. This is the web manifestation of the editorial layer — one curation file feeds both the app and the web.

Collection pages: rendered directly from `collections.json`. These target the highest-value queries ("best claude code skills", "essential design skills") and are the strongest SEO pages we'll have.

### SEO quality tiering

50K pages is only an asset if they don't read as thin content. Mitigations, all cheap:

- **Index tiering**: skills with empty/near-empty descriptions and no stars get `noindex` until they earn signal. The sitemap leads with trending, gold basket, editorial, and high-star skills. — ⚠️ not yet implemented; the pilot sidesteps it by only emitting curated pages. Must exist before the head filter is dropped.
- **Internal linking**: skill → profile → collection → related skills. No orphan pages. — ✅ built
- **Structured data**: `SoftwareApplication` JSON-LD on skill pages, `Person`/`Organization` on profile pages. — ⚠️ partially built: JSON-LD is present but skeletal (see pre-scale checklist); profiles always emit `Person`, even for orgs like Anthropic
- **Cross-agent variants**: a skill's Claude and Codex ports are near-duplicate content that would compete against each other in search. Once Crawl 4 publishes equivalence clusters (see [`identity.md`](identity.md)), variant pairs render as one page with both install commands. Until then, canonicalize the variant pair to the original/upstream variant's page. — ⚠️ neither implemented; the generator hash-disambiguates URL collisions but does not canonicalize variants

### Generation pipeline — ✅ built

`scripts/build-web-library.mjs` (invoked by `scripts/prepare-netlify-site-deploy.mjs` on every deploy path):

1. Read the current published catalog from `site/data/` (crawl4 manifest first, v2 fallback — same policy as clients) — ✅
2. Read `collections.json` for editorial pages — ✅ (read from the published manifest's collections asset)
3. Emit `site/skills/**`, `site/profiles/**`, `site/collections/**`, `site/sitemap.xml` — ✅; ⚠️ single flat `sitemap.xml`, chunked sitemap index still needed at scale
4. Deterministic output — same input data produces byte-identical pages, so Netlify's per-file dedupe keeps repeat deploys incremental — ✅ (verification step 1 covers this)

Generated pages are **gitignored** (like `site/downloads/`). They are build artifacts of the published data, not source. — ✅ (`site/skills/`, `site/profiles/`, `site/collections/`, `site/sitemap*.xml` in `.gitignore`)

URL collision handling is implemented as designed: colliding slugs get a deterministic `--{8-char sha256}` suffix, and the builder throws on any residual collision.

### Deploy-safety requirement (important) — ✅ built

Netlify deploys replace the whole site. Any deploy path that doesn't generate the pages would silently delete the web library URLs. Every deploy path must run generation and verification:

- `content-reports`, `scrape`, `x-refresh`, `pipeline-health`, and `shadow-crawl-health` workflows — ✅ all five run `prepare-netlify-site-deploy.mjs` (which runs the builder) before deploy and `verify-web-library-pages.mjs --live` after
- `deploy-site-prod.sh` (Mac releases) — ✅ generates through `prepare-netlify-site-deploy.mjs`

Since the generator reads from `site/data/` (present in every checkout after a data pull, restorable from production like downloads are), any environment can regenerate the full page set deterministically.

### Size/scale check

- ~60K pages × ~10 KB of minimal HTML ≈ 600 MB site payload. Netlify handles it; first deploy is slow, subsequent deploys upload only changed files.
- If deploy time becomes a problem, the fallback is edge-function rendering from the published JSON — but don't start there. Static-first matches the existing architecture and has zero runtime cost.

### What the web library does NOT do

- No new data store — pages are a pure function of published catalog + curation data
- No user data — skill groups stay in the portal (`app.omgskills.com` / `/app/`)
- No search backend — the library index page links into tiered browse paths; on-site search can proxy to the app CTA initially
- No changes to `skills.json`, manifests, or client contracts

---

## Part 3 — How the surfaces fit together

```
                    ┌─────────────────────────────┐
                    │   Crawl 4 (catalog owner)    │
                    │   mints skill IDs            │
                    └──────────────┬──────────────┘
                                   │ publishes
                                   ▼
                    omgskills.com/data/ (hashed JSON + manifests)
                       │           │            │
          ┌────────────┘           │            └────────────┐
          ▼                        ▼                         ▼
   macOS client            Web library (static)       Portal (app.omgskills.com)
   reads manifests         /skills/ /profiles/        Postgres refs catalog IDs
          ▲                /collections/                     ▲
          │                        ▲                         │
          └────────┬───────────────┘                         │
                   │                                         │
        collections.json (editorial layer) ─────── future: public groups
        one curation file feeds app + web            could render as web pages
```

Later opportunities (not now):

- **Public skill groups on the web** — a public group at `/u/{handle}/{slug}` is user-generated curation; rendering those as indexable pages is a future SEO layer. Needs edge rendering (DB-backed) and a quality gate.
- **Cross-linking** — skill pages can deep-link into the app (`omgskills://skill/{id}`) once the app registers a URL scheme.

---

## Phasing

### Phase 1 — prove the pipeline
- Build `build-web-library.mjs` with skill + profile pages for a curated head (~2K pages: trending, gold basket, top authors)
- Wire into `prepare-netlify-site-deploy.mjs` and both workflows
- Ship sitemaps, canonical tags, JSON-LD, Search Console registration

**Current MVP status (2026-07-08):** the pilot is live at ~66 URLs — `/skills/` index, 3 profiles, 2 collections, and the skill pages referenced by collections plus the top-25 trending. Page set = collection-referenced skills + trending head; everything else is deferred behind `WEB_LIBRARY_AUTHOR_SKILL_LIMIT` and the curated-collections filter. Shipped SEO/LLMO basics: `/robots.txt`, `/llms.txt`, canonical tags, OG/Twitter metadata, JSON-LD on every page type, trailing-slash URL discipline, deterministic builds, and post-deploy live verification on all six deploy paths. Search Console sitemap submission remains manual. **Do not expand to Phase 2 until the pre-scale checklist below is done — every gap in it multiplies by 50K pages once the head filter drops.**

### Phase 2 — full library
- Expand to all catalog skills with index tiering
- Add editorial collection pages (once `collections.json` ships)
- Measure: indexed page count, organic impressions, download-page referrals

### Phase 3 — compounding
- Tag/topic browse pages
- Public skill group pages (edge-rendered, quality-gated)
- App deep links

Phase 1 before full scale because index tiering, URL mapping, and deploy wiring are easier to validate at 2K pages than 50K — but nothing in phase 1 is throwaway; phase 2 is a config change (drop the head filter).

---

## Pre-scale checklist — finish before dropping the head filter

Audit of the live pilot (2026-07-08) against SEO/LLMO goals. Ordered by impact; items 1–5 are generator/data changes that multiply across every future page, so they must land while the page count is still small.

1. **Content depth (the big one).** Live skill pages render ~130 visible words — thin-content territory for Google and not citable by LLMs. Two fixes:
   - Crawl 4 publishes a `readme_snippet` field (first ~150–300 words of the skill's README/SKILL.md). The generator already consumes it; this is purely a data-pipeline change.
   - Generator adds a templated "How to install in Claude Code / Codex" prose block around the install command. This matches the literal question people ask LLMs ("how do I install X skill in claude code") and costs nothing — it's template + existing data.
2. **Title templates.** Current titles (`brand-guidelines skill - omgskills`) omit the words people actually search. Change to `{name} — Claude skill by {author} | omgskills` (skill), `{author}'s Claude & Codex skills ({count}) | omgskills` (profile). The "claude skill" query family is the whole game.
3. **JSON-LD enrichment.** Present but skeletal. Add to `SoftwareApplication`: `author` (linked to profile URL), `dateModified` (from `last_updated`), `operatingSystem: "macOS"` where relevant. Profile pages: emit `Organization` instead of `Person` for org handles (heuristic or a flag in `featuredAuthors`), and always add `sameAs: ["https://github.com/{handle}"]` — the strongest entity-disambiguation signal available. Add `BreadcrumbList` (library → profile → skill) on skill pages.
4. **`og:image`.** Pages have OG tags but no image, so every share renders naked. Profiles: GitHub avatar. Skills/collections: one branded default image now; generated cards later if shares warrant it.
5. **Freshness signals.** `last_updated` is rendered visibly on skill pages but absent from structured data (`dateModified`, item 3) and from `<lastmod>` in the sitemap. Both Google and LLM retrieval favor demonstrably fresh pages, and the data pipeline updates constantly — emit the signal.
6. **Index tiering** (already specced above, not implemented). Required before Phase 2 by definition; proposal in Open decisions #2 stands.
7. **Chunked sitemap index.** Single `sitemap.xml` is fine at 66 URLs, breaks at 50K (protocol cap). Sitemap index + 10K-URL chunks, with `<lastmod>`.
8. **Search Console + Bing Webmaster verification and sitemap submission.** Manual, ~30 minutes, unblocked today. Bing matters disproportionately — it feeds ChatGPT browsing.
9. **`llms.txt` kept in step.** It's a hand-maintained static file; either regenerate its example links in the builder or add a verify check so its URLs can't 404 after a data change.
10. **Variant canonicalization interim rule** (from SEO tiering above): until equivalence clusters ship, pick the higher-star variant as canonical for known Claude/Codex pairs rather than letting them compete.

Not blocking, worth capturing: skill pages don't render `tags` (in the data already), installs count, or trending badges — all cheap enrichment once the items above land.

---

## Verification

1. `node scripts/build-web-library.mjs` — deterministic output on repeat runs (diff two runs, expect zero)
2. `node scripts/verify-web-library-pages.mjs` — local profiles, collection, skill page, `/skills/`, root metadata files, sitemap, social metadata, and canonicals exist
3. `node scripts/verify-web-library-pages.mjs --live` — production pages return 200, legacy creator redirects return 301, and metadata is correct
4. URL mapping — no collisions across all catalog skill IDs; every catalog ID maps to exactly one URL
5. Deploy each path (content-reports, shadow-crawl-health, release script) — pages present after every deploy
6. Lighthouse SEO pass on sample pages
7. Search Console: sitemap accepted, indexing begins on tier-1 pages
8. Confirm `/data/` assets and client manifests are untouched

---

## Open decisions

1. **Skill page slugs for multi-skill repos** — `owner/repo:skill` → `/skills/owner/repo/skill` is the default; confirm no ID grammar edge cases break it (deep paths, unusual characters).
2. **Index-tier thresholds** — what earns indexing at launch (proposal: description ≥ 80 chars AND (stars ≥ 10 OR trending OR editorial))
3. **Library index page UX** — minimal browse tree vs straight links to tiered lists
4. **When public skill groups join the SEO surface** — after portal MVP proves out, separate decision
