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
| Web library | — | — | This doc |

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

A statically generated public page for every skill in the catalog, plus creator pages and editorial collection pages. Generated at publish time from the same JSON the clients read. Pure HTML, no runtime backend.

### URL structure

| Page | URL | Count (approx) |
|---|---|---|
| Skill | `/skills/{owner}/{repo}/{skill-slug}` | ~50K |
| Repo-level skill | `/skills/{owner}/{repo}` | included above |
| Creator | `/creators/{handle}` | ~9K |
| Editorial collection | `/collections/{id}` | grows with editorial |
| Library index | `/skills/` | 1 |

Notes:
- Skill IDs map to URLs by replacing `:` with `/` and slugifying path segments. The generator must produce a deterministic, collision-checked mapping.
- `/u/{handle}` stays reserved for portal user profiles (app users ≠ skill creators). Creators get `/creators/` to avoid the clash.
- Every page carries a canonical URL and appears in a sitemap index (chunked sitemaps, 10K URLs each).

### Page anatomy (skill page)

Everything below already exists in the published data — zero new content required:

- Name, description, author (linked to creator page)
- Install command with copy affordance
- Stars, installs, last updated, trending badge if applicable
- README snippet
- Tags (linked to library index filtered views, later)
- Related: other skills by this author, other skills in the same repo
- App install CTA — the conversion goal of the whole surface

Creator pages: avatar (GitHub), stats from `authorLeaderboards`, skill list, editorial subtitle/description when the handle is in `featuredAuthors`. This is the web manifestation of the editorial layer — one curation file feeds both the app and the web.

Collection pages: rendered directly from `collections.json`. These target the highest-value queries ("best claude code skills", "essential design skills") and are the strongest SEO pages we'll have.

### SEO quality tiering

50K pages is only an asset if they don't read as thin content. Mitigations, all cheap:

- **Index tiering**: skills with empty/near-empty descriptions and no stars get `noindex` until they earn signal. The sitemap leads with trending, gold basket, editorial, and high-star skills.
- **Internal linking**: skill → creator → collection → related skills. No orphan pages.
- **Structured data**: `SoftwareApplication` JSON-LD on skill pages, `Person`/`Organization` on creator pages.
- **Cross-agent variants**: a skill's Claude and Codex ports are near-duplicate content that would compete against each other in search. Once Crawl 4 publishes equivalence clusters (see [`identity.md`](identity.md)), variant pairs render as one page with both install commands. Until then, canonicalize the variant pair to the original/upstream variant's page.

### Generation pipeline

New script: `scripts/build-web-library.mjs`

1. Read the current published catalog from `site/data/` (crawl4 manifest first, v2 fallback — same policy as clients)
2. Read `collections.json` for editorial pages
3. Emit `site/skills/**`, `site/creators/**`, `site/collections/**`, `site/sitemap.xml` + chunked sitemaps
4. Deterministic output — same input data produces byte-identical pages, so Netlify's per-file dedupe keeps repeat deploys incremental

Generated pages are **gitignored** (like `site/downloads/`). They are build artifacts of the published data, not source.

### Deploy-safety requirement (important)

Netlify deploys replace the whole site. Any deploy path that doesn't generate the pages would silently delete ~50K URLs. Every deploy path must run generation:

- `content-reports` workflow (weekly) — add a generation step before deploy
- `shadow-crawl-health` workflow — same
- `deploy-site-prod.sh` (Mac releases) — hook generation into `prepare-netlify-site-deploy.mjs`, which already exists to solve exactly this problem for download assets

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
   reads manifests         /skills/ /creators/        Postgres refs catalog IDs
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
- Build `build-web-library.mjs` with skill + creator pages for a curated head (~2K pages: trending, gold basket, top authors)
- Wire into `prepare-netlify-site-deploy.mjs` and both workflows
- Ship sitemaps, canonical tags, JSON-LD, Search Console registration

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

## Verification

1. `node scripts/build-web-library.mjs` — deterministic output on repeat runs (diff two runs, expect zero)
2. URL mapping — no collisions across all 50K IDs; every catalog ID maps to exactly one URL
3. Deploy each path (content-reports, shadow-crawl-health, release script) — pages present after every deploy
4. `curl` spot checks: skill page, creator page, collection page, sitemap index all return 200 with correct canonicals
5. Lighthouse SEO pass on sample pages
6. Search Console: sitemap accepted, indexing begins on tier-1 pages
7. Confirm `/data/` assets and client manifests are untouched

---

## Open decisions

1. **Skill page slugs for multi-skill repos** — `owner/repo:skill` → `/skills/owner/repo/skill` is the default; confirm no ID grammar edge cases break it (deep paths, unusual characters).
2. **Index-tier thresholds** — what earns indexing at launch (proposal: description ≥ 80 chars AND (stars ≥ 10 OR trending OR editorial))
3. **Library index page UX** — minimal browse tree vs straight links to tiered lists
4. **When public skill groups join the SEO surface** — after portal MVP proves out, separate decision
