# Editool — Local Editorial & Curation Tool

A minimal, local, table-based tool for inspecting the library and editing the
curation data by hand: collections, creator registry, and library removals.

Supersedes the "local visual picker" idea in [`editorial.md`](editorial.md)
(single HTML file, copy-paste JSON). Same spirit, one step more practical:
it writes the files directly.

## Decisions (settled 2026-07-06)

- **Local-only.** `npm run editool` starts a tiny server on localhost. No auth,
  no hosting, no deploy.
- **Tool writes files, operator publishes.** Edits save to the source JSON files
  with validation. Review, git commit, and publish stay manual — git remains the CMS.
- **Save requests are guarded.** The server generates a startup token, injects it
  into the local page, and requires it on save requests. Non-local `Origin`
  headers are rejected.
- **Includes removal actions.** Suppress skill / do-not-crawl entries are staged
  from the same tool (Phase 0 mechanisms from `audit-task.md`).
- **Reads local index files.** What you browse is exactly what a publish would ship.

## Principles

- The tool is a **JSON editor with a library browser attached**. It owns no data.
- Every write goes to an existing source-of-truth file, validated with the same
  rules the publish scripts use. No new stores, no DB.
- Anything the tool can do, an agent or a hand edit can also do. The tool is
  convenience, not a gate.
- Ugly is fine. Tables, search boxes, buttons. No design system, no framework
  beyond what a single page needs.

## Files it reads

| File | Purpose in tool |
|---|---|
| `index/skills.json` (or shadow cutover) | library browser rows |
| `index/author-leaderboards.json` | creator stats columns |
| `index/gold-basket.json` | quality badges on rows |
| `index/curations/collections.json` | collections editor |
| `index/seeds/creators.json` (T1.1) | creator registry editor |
| `index/seeds/do-not-crawl.json` | blocked repos/owners view |
| suppressed-skills seed (T0.1) | suppressed skills view |

## Files it writes

Only these three, atomically, with validation:

1. `index/curations/collections.json`
2. `index/seeds/creators.json`
3. removal seeds: suppressed-skills + `do-not-crawl.json`

Never writes `skills.json`, overlays, or anything under `shadow/`.

## Views (4 tables)

### 1. Library browser

The read-only backbone. One table over `skills.json`:

- columns: name, author, repo, stars, installs (if present), tags,
  gold-basket badge, provenance, last updated
- search + filters: text, `@author`, min stars, provenance type
- row actions:
  - **add to collection…** (picker over existing collections)
  - **feature on author profile** (adds to that author's `featuredSkillIds`)
  - **suppress skill** (stages a suppressed-skills entry)
  - **block repo / block owner** (stages a do-not-crawl entry)
- click author → jumps to creator view filtered to that handle

This solves the core friction named in `editorial.md`: finding exact skill IDs.

### 2. Collections

Table of all collections (author + topic) from `collections.json`:

- columns: id, type, title, subtitle, item counts
- actions: create topic collection (id, title, subtitle), edit fields,
  delete collection
- detail pane per collection: ordered `skillIds` / `featuredSkillIds` lists,
  remove row, reorder (up/down buttons — no drag-and-drop), stale-ID warning
  when an ID no longer exists in the library

### 3. Creators (registry)

Table over `creators.json` joined with leaderboard stats:

- columns: handle, roles, watch, featured, skills, distinct repos, stars,
  gold-basket count, aliases
- actions: add handle, toggle `watch`, toggle `featured` (enforces
  `featured ⊆ watch`), add alias, edit notes, remove
- proposals panel — renders the weekly proposed-creators report (T1.5) with:
  - **Add watched**: stages a `watch: true` creator entry with proposal evidence
    in `notes`
  - **Dismiss**: stages a `watch: false` creator entry with dismissal/evidence
    in `notes`, so the same handle does not reappear next week
  - proposals matching existing handles or aliases are hidden case-insensitively
  - stale report warning appears when `proposed-creators.json` is older than
    about 10 days

### 4. Removals

Two small tables so staged removals are visible and reviewable:

- suppressed skills: id, reason, date staged
- do-not-crawl: repo/owner, level, reason, date staged
- actions: un-stage an entry (before it's committed), add manual entry

## Write model

- save button per view; writes are atomic (temp file + rename)
- validation before write, reusing publish-script rules:
  - every skill ID referenced exists in the loaded library
  - every suppressed skill ID exists in the loaded library
  - every featured handle exists as a catalog author (case-insensitive, alias-aware)
  - `featured ⊆ watch` in the registry
  - creator aliases cannot be owned by multiple registry rows
  - collection ids are kebab-case and unique
  - do-not-crawl repo targets are `owner/repo`, owner targets are bare handles,
    and removal reasons are required
- on validation failure: nothing is written, errors shown inline
- save requests also require the page's `X-Editool-Token`; this is a local
  browser guard, not a hosted auth system
- the tool never commits, never publishes, never calls the network
- proposed creator review is advisory: `proposed-creators.json` is generated by
  `npm run content:proposed-creators`, but `creators.json` remains the source of
  truth for accepted and dismissed decisions
- footer shows `git status` of the three editable files as a reminder of
  unpublished edits

## Implementation sketch

Small enough to be one slice:

- `index/scripts/editool.ts` — Node server (~150 lines): serves the page,
  `GET /data` (reads the files above), `POST /save/{collections|creators|removals}`
  (validate + atomic write). Localhost only.
- `index/scripts/editool.html` — one static page, vanilla JS, ~4 tables.
  Precedent already in repo: `dashboard.html`, `gold-basket-review.html`.
- `npm run editool` — starts server, prints the URL.
- validation shared with `publish-collections.ts` (extract its checks into a
  small module both import).

No build step, no framework, no dependencies beyond what `index/` already has.

## Out of scope

- auth, hosting, multi-user, CMS
- publishing or git operations from the UI
- editing skill records themselves (that's crawler/overlay territory)
- drag-and-drop, images, previews
- portal/skill-groups data (different layer, has its own UI)

## Sequencing

- depends on: `creators.json` (T1.1) and the suppression seed (T0.1) existing —
  or ship the tool first with those two views disabled until the seeds land
- natural slot: alongside the editorial MVP (next.md #2), since that's when
  collections.json starts getting real content
- the agent-assisted workflow from `editorial.md` remains the primary curation
  method; this tool is for visual inspection and quick manual edits

## Open questions

1. Should the library browser read the shadow cutover file instead of
   `skills.json` once Crawl 4 is the only track? (Probably yes — one flag.)
2. Do removal actions need a required "reason" field for the audit trail?
   (Suggest yes — one line, stored in the seed entry.)
3. Worth adding a read-only "duplicates" view (sha clusters) to support the
   Phase 0 cleanup review? Cheap to add, but only useful during cleanup.
