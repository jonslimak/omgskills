# Editorial Layer

## Goal

Maintain an editorially curated discovery experience on top of the full skill library — closer to an App Store than a search engine.

The editorial MVP is implemented in the macOS client and the pilot web library. It adds creator profiles and topic collections without changing the core skill schema.

### What it enables

**Creator profiles** — when a user taps an author name in any skill row, instead of triggering a plain search, they land on that creator's editorial profile. The profile shows who they are, their top skills hand-picked or auto-ranked, and a "see all" that expands to their full library. This works for both individual developers (steipete, obra, mattpocock) and companies (OpenAI, Anthropic, GitHub, Stripe).

**Topic collections** — curated skill lists grouped by theme or intent: Starter Pack, Essential Design Skills, AI Coding, Recommended by Garry Tan, etc. These are not search results — they are hand-picked, editorially intentional lists. They live on the empty search page as entry points for users who don't know what to search for yet.

**"Best skills by X"** — a creator's own top work, surfaced on their profile. Auto-ranked from the data, optionally overridden editorially to pin specific skills.

**"Skills recommended by X"** — a topic collection where the framing is a trusted person or company endorsing skills across the library, not just their own. E.g. "Skills the Anthropic team uses", "Garry Tan's picks". These are fully manual.

### Design principles

- The core skill schema is untouched; editorial collections remain a side asset
- The creator registry is shared with the separately flag-gated creator-watch crawl lane
- The editorial layer is a side file (`collections.json`) that references existing skill IDs
- Activating a creator profile is a registry change — set `watch: true` and `featured: true` in `index/seeds/creators.json`
- Everything else (avatar, stats, skill list) is derived automatically from existing data
- Richer profiles (custom subtitle, pinned skills, description) are opt-in overrides
- Topic collections require explicit curation but stay in the same file
- No CMS until the volume or team size justifies it

### One published asset, two surfaces

The published `collections` asset feeds the macOS client **and** the web library (`web-library.md`). Library profiles render at `/library/{handle}/` and topic collections at `/collections/{id}/`. Write curation data with both in mind:

- `subtitle` and `description` double as SEO copy — collection pages target the highest-value search queries we have ("best claude code skills", "essential design skills")
- Author `imageUrl` overrides the GitHub avatar and becomes the library profile's `og:image`; topic collection social images are not generated yet
- collection `id` becomes a public URL slug — kebab-case, descriptive, and stable once published (no redirects planned)

### Handle namespaces

Editorial creator entries are **GitHub handles** matched case-insensitively against the catalog's `author_handle` field and registry aliases. They are separate from portal user handles:

- `/library/{handle}/` — static editorial/library profile
- `/u/{handle}` — portal user profile
- `/u/{handle}/sets/{slug}` — public user skill group

Legacy `/profiles/{handle}` URLs redirect deterministically to a known library profile or fall back to the corresponding `/u/` profile.

### Cross-agent variants

Some skills exist as both Claude and Codex ports with distinct catalog IDs. When featuring one, reference the original/upstream variant's ID. Display surfaces will group variants together once cross-agent equivalence clusters ship (see `identity.md`); until then, featuring one variant is correct — don't list both IDs.

## What we're building

A `collections.json` side file published alongside skills/trending in the manifest, plus collection/profile views in the macOS client and static pages in the web library. Collections reference existing skill IDs; no `skills.json` schema change is required.

Not to be confused with [`curated.md`](curated.md), which is about manually admitting skills **into** the catalog (a Crawl 4 operator path). This doc is about curating how existing catalog skills are **presented**. Different layers: curated.md changes what's in the library; editorial changes what's featured.

---

## Data layer

### Source files

- `index/seeds/creators.json` — canonical creator registry. `watch` controls the opt-in creator-watch crawl lane; `featured` controls editorial profile publication. Featured creators must also be watched. Aliases map alternate catalog handles to one registry owner.
- `index/curations/collections.json` — canonical editorial copy, author overrides, pinned skills, and topic collections.

Use Editool for normal changes, review the resulting diff, then run `npm run publish:collections`. Publishing remains an explicit operator action.

### Creator activation — how it works

To activate an editorial profile, add or update the creator in `index/seeds/creators.json`:

```json
{
  "handle": "openai",
  "watch": true,
  "featured": true,
  "aliases": []
}
```

The publish script expands each featured registry creator into an app-ready author collection. The app checks whether a tapped author has a published author collection:
- **Yes** → opens editorial profile page
- **No** → plain author search (existing behavior, unchanged)

Default profile data is derived automatically:
- **Avatar** — `https://github.com/{handle}.png`
- **Skill list** — existing `@handle` author search
- **Featured skills** — highest-star skills unless explicitly pinned
- **Web stats** — pulled from `authorLeaderboards` when available

`collections.json.featuredAuthors` remains as legacy compatibility data, but it is not the activation source. New creator activation must happen in `creators.json`.

### Optional overrides

When you want a richer profile — custom subtitle, custom image, or hand-picked featured skills — add an entry to `authorOverrides`. Overrides are always optional; a creator without one still gets a full profile.

```json
{
  "featuredAuthors": ["openai", "anthropics", "steipete", "obra"],
  "authorOverrides": {
    "steipete": {
      "subtitle": "iOS & macOS legend",
      "featuredSkillIds": ["steipete/summarize", "steipete/..."]
    },
    "openai": {
      "subtitle": "Skills by the OpenAI team",
      "imageUrl": null,
      "featuredSkillIds": ["openai/codex-universal"]
    }
  }
}
```

### Topic collections

Topic lists (Starter Pack, recommended-by-X, etc.) are separate from author pages and always require explicit curation.

```json
{
  "featuredAuthors": ["openai", "anthropics"],
  "authorOverrides": { ... },
  "collections": [
    {
      "id": "starter-pack",
      "type": "topic",
      "title": "Starter Pack",
      "subtitle": "Essential skills to get started",
      "imageUrl": null,
      "featuredSkillIds": ["anthropics/skills:pdf", "obra/superpowers:systematic-debugging"],
      "skillIds": ["anthropics/skills:pdf", "obra/superpowers:systematic-debugging"],
      "description": null
    }
  ]
}
```

### Fields

**`featuredAuthors`** — legacy compatibility array. Keep it valid while present, but use `creators.json` for activation.

**`authorOverrides`** — object keyed by handle. All fields optional.

| Field | Notes |
|---|---|
| `subtitle` | Short tagline shown on profile |
| `imageUrl` | Custom hero image; falls back to GitHub avatar |
| `featuredSkillIds` | 3–5 skill IDs pinned at top of profile |
| `description` | Editorial paragraph |

**Topic collection fields:**

| Field | Required | Notes |
|---|---|---|
| `id` | yes | kebab-case unique key |
| `type` | yes | `"topic"` |
| `title` | yes | Display name |
| `subtitle` | yes | Short tagline |
| `imageUrl` | optional | Custom hero image |
| `featuredSkillIds` | yes | 3–5 IDs shown in preview |
| `skillIds` | yes | Full list for "see all" |
| `description` | optional | Editorial paragraph |

### Copy style guide

Headlines (`subtitle`) and descriptions (`description`) should be short, factual, and useful. No hype, no filler.

**Subtitle** — one short phrase, no period. Describes who or what this is.
- Good: `"iOS & macOS legend"`, `"TypeScript expert"`, `"The OpenAI team"`
- Avoid: `"A prolific creator of amazing skills"`, `"Building the future of AI"`

**Description** — 1–3 sentences max. Stick to facts: what they build, why their skills are worth installing, what a user will get. Write for someone who doesn't know the creator yet.
- Lead with what they make, not who they are
- Mention the skill type or domain if it helps (debugging tools, TypeScript utilities, Google Workspace automation)
- End on utility — what does the user get out of installing their skills

**Examples:**

> `steipete` — "Peter Steinberger has been shipping Apple platform software for over a decade. His skills focus on debugging, performance, and developer workflow. High quality, well maintained."

> `obra` — "Jesse's superpowers pack covers the fundamentals of working with AI agents — planning, debugging, code review, and parallel execution. One of the most installed skill sets in the library."

> `starter-pack` — "The skills most developers install first. Covers code review, document handling, and AI agent fundamentals. A good baseline for any Claude or Codex setup."

**When writing for topic collections**, lead with what the list does, not what it is. "Covers X, Y, Z" beats "A collection of skills about X."

### When to add a CMS

Not now. A hosted CMS makes sense when the list exceeds ~50 creators or remote collaboration requires it. Until then, Editool and the tracked JSON files are the CMS.

---

## Curation workflow

### Primary method — Editool

Run `cd index && npm run editool`, then open `http://127.0.0.1:4980/`. Editool searches the loaded library and edits collections, creator registry entries, and removal controls. It is localhost-only, token-protected, file-based, and does not publish or commit automatically. See `editool.md` for its exact validation and save behavior.

After editing:

1. Review the changes with `git diff`.
2. Run `cd index && npm run typecheck`.
3. Run `cd index && npm run publish:collections`.
4. Review the generated manifest changes before committing.

### Agent-assisted alternative

An agent can also search the live skill data, update `creators.json` or `collections.json`, validate the result, and publish it.

Examples:

> "Feature steipete's best 5 skills on his profile"
> → agent searches live data for steipete's skills sorted by installs/stars, picks top 5, writes `featuredSkillIds` into `authorOverrides`, runs `publish:collections`

> "Add a Starter Pack collection with the 8 best entry-level skills"
> → agent searches trending + high-install skills, picks a diverse set, writes a new topic collection entry, publishes

> "Add Garry Tan's recommended skills — use his top 3 own skills plus obra/superpowers and mattpocock/qa"
> → agent mixes author's own skills with cross-library picks, writes the topic collection

The previously proposed `editorial:search` and `editorial:feature` CLI helpers were not built because Editool now covers that workflow.

### Publish script

`index/scripts/publish-collections.ts` — run via `npm run publish:collections`.

Steps:
1. Read `index/curations/collections.json`, `index/seeds/creators.json`, and the current catalog.
2. **Validate references** — every featured creator must also be watched and match a catalog author directly or through an alias; every ID in `featuredSkillIds` / `skillIds` must exist. Unknown references fail the publish.
3. Expand featured registry creators into normalized author collection records, applying optional overrides and otherwise selecting their highest-star skills.
4. SHA256 hash + byte count.
5. Write byte-identical `collections-{hash}.json` assets to `site/data/crawl4/` and `site/data/v2/`.
6. Patch both manifests with the same asset metadata.

The crawler publish scripts must preserve an existing `collections` field in the manifest (patch, not overwrite).

Client-side rule: a `featuredSkillIds` entry that no longer matches a loaded skill is skipped silently. Skills can be removed from the catalog between curation and load; a stale reference must never break a page.

### Manifest shape after publish

```json
{
  "version": 1,
  "generatedAt": "...",
  "skills": { "path": "...", "sha256": "...", "bytes": 0 },
  "trending": { "path": "...", "sha256": "...", "bytes": 0 },
  "xTrending": { "path": "...", "sha256": "...", "bytes": 0 },
  "collections": { "path": "collections-{hash}.json", "sha256": "...", "bytes": 0 }
}
```

`collections` is optional. Older manifests and failed collection downloads must be treated as graceful no-ops by the client. Missing collections should not block skills, trending, X trending, refresh success, or Crawl 4 → v2 fallback behavior.

---

## macOS client

### Implemented files

**`menubar/Sources/omgskills/SkillCollection.swift`** — data model

```swift
struct SkillCollection: Codable, Identifiable {
    let id: String
    let type: CollectionType
    let title: String
    let subtitle: String
    let authorHandle: String?
    let imageUrl: String?
    let featuredSkillIds: [String]
    let skillIds: [String]?
    let description: String?
}

enum CollectionType: String, Codable {
    case author, topic
}

struct CollectionsAsset: Codable {
    let version: Int
    let collections: [SkillCollection]
}
```

The implementation uses `SkillCollection`, avoiding a collision with Swift's standard `Collection` protocol.

**`menubar/Sources/omgskills/CollectionViews.swift`** — contains the small collection views used by Discover:

- `CollectionPageView`
- `CollectionCard`
- `CollectionAvatarView`

The collection page replaces the main feed area while it is open. Selecting one of its featured skills keeps the collection page visible and opens the skill detail in the right pane.

Structure:
- Header: avatar/image + title + subtitle
- Optional editorial description paragraph
- 3–5 featured skill rows (reuse existing `SkillRow` component)
- "See all" button
  - Author: triggers `@{handle}` author search
  - Topic: filtered list of `skillIds`

Avatars use `AsyncImage` with loading and failure fallbacks. Author pages fall back to `https://github.com/{handle}.png`; there is no custom image cache.

### Modified files

**`DataRefreshService.swift`**
- After fetching skills/trending/xTrending, optionally fetch `collections` asset from manifest
- Cache to `~/Library/Application Support/omgskills/collections.json` (+ crawl4 variant)
- Graceful: missing `collections` key in manifest = skip silently, no error
- Cache filenames:
  - production v2: `collections.json`
  - Crawl 4: `crawl4-collections.json`
- Track `activeCollectionsHash` in metadata
- Collection download, validation, decode, or cache failures must not:
  - fail the overall refresh
  - trigger Crawl 4 → v2 fallback
  - affect bootstrap completeness
  - affect refresh throttling
- Keep collection loading inside the existing refresh/store flow. Do not add loose view-level `Task {}` loading for collections.

**`SkillsStore.swift`**
- Add `@Published private(set) var collections: [SkillCollection] = []`
- Decode collections asset after skills load (reuse existing decode pattern)
- Add `featuredSkills(for:)` helper: maps `featuredSkillIds` → `[Skill]` by ID lookup
- Preserve previous visible collections when a later collection decode fails
- Add helpers:
  - `collection(id:)`
  - `authorCollection(for:)`
  - `featuredSkills(for:)`
  - `allSkills(for:)`

**`ContentView.swift`** — two entry points:
1. **Empty Discover page** — collection cards render in a two-column grid at the bottom, below the “Send to a friend” action. Tapping opens `CollectionPageView` in the feed area.
2. **Author attribution link** — if a skill's `authorHandle` matches a known author collection, clicking the author name opens that collection page instead of a plain author search.

Implementation notes:
- Use separate detail selection state for skill vs collection, instead of pretending a collection is a `Skill`.
- Skill row author taps:
  - featured author → open collection profile
  - non-featured author → keep existing `@author` filter behavior
- Detail-pane author attribution should be a `Button` too, not plain `Text`.
- Use `Button`, not `onTapGesture`, for collection cards and author links.
- Keep collection UI in small subviews rather than growing `ContentView`.
- Use stable IDs in all `ForEach` loops.
- Treat collections as optional enhancement data, not core library data.

---

## Collections

The tables below the current published set are candidate inventory, not committed launch scope. Their metrics are historical snapshots; use current library data when deciding what to feature.

### Current published set

**Author pages:**

| ID | Handle | Title |
|---|---|---|
| `author-anthropics` | `anthropics` | Anthropic |
| `author-openai` | `openai` | OpenAI |
| `author-cursor` | `cursor` | Cursor |
| `author-mattpocock` | `mattpocock` | Matt Pocock |
| `author-leonxlnx` | `leonxlnx` | Leon Lin |

**Topic lists:**

| ID | Current scope |
|---|---|
| `starter-pack` | 8 baseline document, debugging, testing, and review skills |
| `design-essentials` | 8 UI, frontend, critique, and product-polish skills |

Both track manifests currently point to the same hashed collections asset.

---

### Candidate expansion — company / vendor pages

Sorted by installs. All have `type: author` — "see all" triggers author search.

| Handle | Installs | Stars | Note |
|---|---|---|---|
| `anthropics` | 1.3M | 11M | GOAT — in MVP |
| `heygen-com` | 1.2M | 212K | Video AI |
| `firecrawl` | 910K | 14K | Web scraping |
| `googleworkspace` | 592K | 2.8M | GOAT, Google Workspace |
| `larksuite` | 571K | 275K | Lark workplace |
| `microsoft` | 378K | 10.8M | GOAT |
| `get-convex` | 377K | — | Convex DB |
| `expo` | 360K | 190K | React Native |
| `firebase` | 300K | 17K | Firebase |
| `google-labs-code` | 243K | 98K | Google Labs |
| `greensock` | 215K | 49K | GSAP animation |
| `supabase` | 143K | 1.2M | |
| `vercel-labs` | 140K | 1.3M | |
| `stripe` | 131K | 7.3K | |
| `github` | 105K | 12.9M | |
| `cloudflare` | 76K | 246K | Edge / Workers |
| `neondatabase` | 44K | 2.2K | Serverless Postgres |
| `openai` | — | 3.2M | GOAT — in MVP |
| `n8n-io` | — | 3.3M | GOAT, automation |
| `facebook` | — | 2.7M | GOAT, Meta |
| `composiohq` | — | 1.7M | AI integrations |
| `pytorch` | — | 1.8M | GOAT, ML |
| `google-gemini` | — | 1.4M | Gemini |
| `getsentry` | — | 1M | Observability, 188 skills |
| `huggingface` | — | 373K | ML / models |
| `trailofbits` | — | 548K | Security, 109 skills |
| `figma` | — | 20K | Design |

---

### Candidate expansion — independent creator pages

Sorted by installs. All have `type: author`.

| Handle | Installs | Stars | Note |
|---|---|---|---|
| `coreyhaines31` | 1.7M | 1.1M | Marketing / SEO |
| `obra` | 1.6M | 2.4M | GOAT, superpowers pack |
| `samber` | 1.1M | 59K | 38 trending skills |
| `lllllllama` | 1.1M | 5.6K | AI paper reproduction pack |
| `juliusbrussee` | 1M | 520K | Caveman pack |
| `mattpocock` | 806K | 1.4M | GOAT, TypeScript expert |
| `leonxlnx` | 577K | 260K | GOAT, 5 skills — exceptional ratio |
| `jimliu` | 437K | 535K | |
| `wshobson` | 283K | 7M | GOAT, 203 skills |
| `xixu-me` | 203K | 469 | 12 skills |
| `kepano` | 207K | 154K | Stephan Ango, Obsidian creator |
| `pbakaus` | 175K | 42K | Paul Bakaus, 1 skill |
| `halt-catch-fire` | 153K | 14K | 26 skills |
| `emilkowalski` | 109K | 7.3K | Emil Kowalski, 2 skills |
| `antfu` | 80K | 82K | Anthony Fu, prolific OSS |
| `addyosmani` | 61K | 998K | Addy Osmani, web performance |
| `twostraws` | 21K | 5.4K | Paul Hudson, Swift / iOS education |
| `garrytan` | — | 4.8M | GOAT, YC president |
| `steipete` | — | 18.7M | GOAT, iOS / macOS legend, 74 skills |
| `shubhamsaboo` | — | 2.3M | GOAT |
| `danielmiessler` | — | 1.2M | 98 skills, security + AI |
| `ruvnet` | — | 11.4M | 257 skills, AI agents |
| `affaan-m` | — | 89M | GOAT — ⚠️ collection-like flag in client, review before featuring |

---

### Candidate expansion — topic / list collections

All have `type: topic` with explicit `skillIds`.

| ID | Concept |
|---|---|
| `recommended-by-anthropic` | Skills the Anthropic team uses and endorses |
| `recommended-by-github` | GitHub's recommended stack |
| `recommended-by-garrytan` | Garry Tan's picks |
| `best-of-trending` | Top skills from skills.sh right now |
| `ai-coding` | LLM-assisted development workflow |
| `frontend` | React, Next.js, Vercel, web focused |
| `mobile` | Expo, React Native, mobile |
| `devops-cloud` | Azure, Firebase, infra, cloud |
| `automation` | n8n, Firecrawl, workflow automation |
| `security` | Trail of Bits, security-focused skills |
| `design-tools` | Figma, GSAP, UI/design |

Skill IDs for `featuredSkillIds` and `skillIds` come from the live library (`id` field in `index/skills.json`).

---

## What this does not change

- `skills.json` schema — untouched
- Core crawler output — the collections publisher is standalone; the shared creator registry only affects creator-watch crawling when its explicit flag is enabled
- v2/crawl4 data contracts — manifest gets one new optional field
- Skill search, sort, trending — untouched

---

## Implementation status

The editorial MVP is live and includes:

- One normalized collections asset published identically to v2 and Crawl 4
- Optional, non-blocking macOS download and track-specific caches
- Five author profiles and two topic collections
- Two-column Discover cards, collection pages in the feed area, and skill details in the right pane
- Featured-author routing with the author query shown in search; non-featured authors retain normal filtering
- Static `/library/{handle}/`, `/collections/{id}/`, and skill pages generated from the same data
- Editool for local curation and creator-registry maintenance

Remaining editorial work is non-blocking:

- Add focused regression tests for foreign-manifest asset preservation and optional collection refresh failure behavior
- Add automated coverage for featured/non-featured author routing; keyboard and VoiceOver checks are currently manual
- Connect cross-agent equivalence clusters to editorial display so Claude/Codex variants can be grouped
- Expand creator and topic coverage only after the pilot UI and web page format are settled

## Verification

1. Run `cd index && npm run typecheck`.
2. Run `cd index && npm run publish:collections` — confirm matching hash files appear in `site/data/v2/` and `site/data/crawl4/`, and both manifests are updated.
3. Run `cd menubar && swift test`.
4. Build and run the macOS app in debug (Crawl 4 mode).
5. Confirm empty Discover shows the two-column collection grid below “Send to a friend”.
6. Tap an author collection — confirm its page replaces the feed and selecting a skill opens the right detail pane.
7. Tap "See all" — confirm author or topic filtering is correct.
8. Tap a featured author name — confirm the profile opens and `@handle` appears in search.
9. Tap a non-featured author — confirm the existing author-filter behavior remains.
10. Disable network — confirm skills still load and collection failure does not trigger fallback or crash.
11. Confirm `skills.json` and unrelated manifest fields are unchanged after publishing.
12. Run `node scripts/build-web-library.mjs` and `node scripts/verify-web-library-pages.mjs` for the static web surface.
13. Confirm collection cards and author buttons are keyboard reachable and have useful VoiceOver labels.
