# Editorial Layer

## Goal

Transform omgskills from a flat skill library into an editorially curated discovery experience — closer to an App Store than a search engine.

The current app surfaces 50,000+ skills sorted by trending, stars, or recency. There is no editorial layer — no context about who made what, no curated starting points, no way to say "these are the skills that matter." The editorial layer adds that without touching the crawler or the skill data model.

### What it enables

**Creator profiles** — when a user taps an author name in any skill row, instead of triggering a plain search, they land on that creator's editorial profile. The profile shows who they are, their top skills hand-picked or auto-ranked, and a "see all" that expands to their full library. This works for both individual developers (steipete, obra, mattpocock) and companies (OpenAI, Anthropic, GitHub, Stripe).

**Topic collections** — curated skill lists grouped by theme or intent: Starter Pack, Essential Design Skills, AI Coding, Recommended by Garry Tan, etc. These are not search results — they are hand-picked, editorially intentional lists. They live on the empty search page as entry points for users who don't know what to search for yet.

**"Best skills by X"** — a creator's own top work, surfaced on their profile. Auto-ranked from the data, optionally overridden editorially to pin specific skills.

**"Skills recommended by X"** — a topic collection where the framing is a trusted person or company endorsing skills across the library, not just their own. E.g. "Skills the Anthropic team uses", "Garry Tan's picks". These are fully manual.

### Design principles

- The skill library is untouched — no schema changes, no crawler changes
- The editorial layer is a side file (`collections.json`) that references existing skill IDs
- Activating a creator profile is a single line — add their handle to `featuredAuthors`
- Everything else (avatar, stats, skill list) is derived automatically from existing data
- Richer profiles (custom subtitle, pinned skills, description) are opt-in overrides
- Topic collections require explicit curation but stay in the same file
- No CMS until the volume or team size justifies it

### One curation file, two surfaces

`collections.json` feeds the macOS client **and** the web library (`web-library.md`): creator pages render at `/creators/{handle}` and collection pages at `/collections/{id}`. Write curation data with both in mind:

- `subtitle` and `description` double as SEO copy — collection pages target the highest-value search queries we have ("best claude code skills", "essential design skills")
- `imageUrl` doubles as the page's `og:image` for link sharing
- collection `id` becomes a public URL slug — kebab-case, descriptive, and stable once published (no redirects planned)

### Handle namespaces

`featuredAuthors` entries are **GitHub handles** (the catalog's `authorHandle` field). They are unrelated to portal user handles at `omgskills.com/u/{handle}` (skill groups / public profiles — see `skillgroup.md`). On the web, creators live at `/creators/{handle}`; `/u/` stays reserved for portal users.

### Cross-agent variants

Some skills exist as both Claude and Codex ports with distinct catalog IDs. When featuring one, reference the original/upstream variant's ID. Display surfaces will group variants together once cross-agent equivalence clusters ship (see `identity.md`); until then, featuring one variant is correct — don't list both IDs.

## What we're building

A `collections.json` side file published alongside skills/trending in the manifest, plus a new collection page view in the macOS client. Collections reference existing skill IDs — no changes to `skills.json`, no crawler changes.

Not to be confused with [`curated.md`](curated.md), which is about manually admitting skills **into** the catalog (a Crawl 4 operator path). This doc is about curating how existing catalog skills are **presented**. Different layers: curated.md changes what's in the library; editorial changes what's featured.

---

## Data layer

### Source file

`index/curations/collections.json` — hand-edited, the canonical source. Deploy by running `npm run publish:collections` and pushing to git.

### Creator activation — how it works

To activate an editorial profile for any creator, add their handle to `featuredAuthors`. That's it.

```json
{
  "featuredAuthors": ["openai", "anthropics", "steipete", "obra", "mattpocock"]
}
```

The app checks if a tapped author handle is in `featuredAuthors`:
- **Yes** → opens editorial profile page
- **No** → plain author search (existing behavior, unchanged)

Everything on the profile is derived automatically:
- **Avatar** — `https://github.com/{handle}.png`
- **Skill list** — existing `@handle` author search
- **Stats** — pulled from `authorLeaderboards` already in the manifest

**To add a creator:** add their handle to the array and push. Done in under a minute.

`featuredAuthors` is source-only authoring convenience. The publish script expands each featured author into an app-ready author collection record, so the macOS client only needs to decode one normalized `collections` array.

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

**`featuredAuthors`** — string array of GitHub handles. Minimum viable activation.

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

Not now. A CMS makes sense when the list exceeds ~50 creators or a non-technical editor needs to manage it. Until then, the JSON file is the CMS.

---

## Curation workflow

### The friction point

The schema already supports `featuredSkillIds` on both author overrides and topic collections. The only friction is finding the right skill IDs — they look like `obra/superpowers:systematic-debugging` and require looking up the live data to get right.

### Primary method — agent-assisted

Ask an agent (Claude Code / Codex) to curate. The agent has direct access to the live skill data and can search, rank, and write to `collections.json` in one step.

Examples:

> "Feature steipete's best 5 skills on his profile"
> → agent searches live data for steipete's skills sorted by installs/stars, picks top 5, writes `featuredSkillIds` into `authorOverrides`, runs `publish:collections`

> "Add a Starter Pack collection with the 8 best entry-level skills"
> → agent searches trending + high-install skills, picks a diverse set, writes a new topic collection entry, publishes

> "Add Garry Tan's recommended skills — use his top 3 own skills plus obra/superpowers and mattpocock/qa"
> → agent mixes author's own skills with cross-library picks, writes the topic collection

This fits the existing workflow and requires no extra tooling.

### Fallback — CLI search helper (add when needed)

When you want to curate without an agent, two small scripts reduce the ID lookup friction:

```bash
# Search skills by author or keyword, get IDs back
npm run editorial:search "steipete"
npm run editorial:search "typescript"

# Add featured skills to an author override or collection
npm run editorial:feature steipete steipete/summarize steipete/peter-explains-typescript
```

These are worth adding once manual curation becomes frequent enough that asking an agent feels slow.

### Future — local visual picker (add when volume justifies)

A single `editorial-tool.html` file — open in browser, search skills, click to build `featuredSkillIds` lists, copy JSON snippet into `collections.json`. No server, no deploy. Worth building when there are multiple people curating or the collection count exceeds ~20.

### Publish script

`index/scripts/publish-collections.ts` — run via `npm run publish:collections`.

Steps:
1. Read `index/curations/collections.json`
2. **Validate against the current catalog** — every ID in `featuredSkillIds` / `skillIds` must exist in the published skills data, and every `featuredAuthors` handle must exist as a catalog `authorHandle`. Unknown references fail the publish. Skill IDs are a cross-system contract (see `web-library.md`), and this is where broken references get caught.
3. SHA256 hash + byte count
4. Write `site/data/crawl4/collections-{hash}.json` **and** `site/data/v2/collections-{hash}.json` — manifest asset paths resolve relative to the manifest's own directory, so each track needs its own copy (same content, same hash; the file is tiny)
5. Patch `site/data/crawl4/manifest.json` — add/update `collections` entry
6. Patch `site/data/v2/manifest.json` — same

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

### New files

**`Collection.swift`** — data model

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

Use `SkillCollection` or `EditorialCollection`, not `Collection`, to avoid shadowing Swift's standard `Collection` protocol.

**`CollectionPageView.swift`** — fits the existing detail pane pattern

Structure:
- Header: avatar/image + title + subtitle
- Optional editorial description paragraph
- 3–5 featured skill rows (reuse existing `SkillRow` component)
- "See all →" button
  - Author: triggers `@{handle}` author search
  - Topic: filtered list of `skillIds`

**`CollectionCard.swift`** — compact empty-state card for Discover.

**`CollectionAvatarView.swift`** — avatar/image loader. Use `AsyncImage` with loading and failure states. For author pages, fall back to `https://github.com/{handle}.png`. Do not add custom image caching in v1.

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
1. **Empty search page** — collection cards above the existing search suggestion chips. Tapping opens `CollectionPageView`.
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

### MVP — launch with these

**Author pages:**

| ID | Handle | Type | Installs | Stars |
|---|---|---|---|---|
| `author-openai` | `openai` | author/vendor | — | 3.2M |
| `author-anthropic` | `anthropics` | author/vendor | 1.3M | 11M |
| `author-cursor` | `cursor-editor` | author/vendor | — | — |

**Topic lists:**

| ID | Concept |
|---|---|
| `starter-pack` | 8–10 must-have skills for new users |
| `design-essentials` | UI/design focused skills |

---

### Post-MVP — company / vendor pages

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

### Post-MVP — independent creator pages

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

### Post-MVP — topic / list collections

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
- Crawler pipeline — publish script is standalone
- v2/crawl4 data contracts — manifest gets one new optional field
- Skill search, sort, trending — untouched

---

## Verification

1. Run `npm run publish:collections` — confirm hash file appears in `site/data/`, both manifests updated
2. Build and run the macOS app in debug (Crawl 4 mode)
3. Confirm empty search page shows collection cards
4. Tap an author collection → `CollectionPageView` opens with correct avatar and featured skills
5. Tap "See all" → author search filters correctly
6. Tap a topic collection → featured skills appear, "see all" shows full list
7. Disable network → app loads gracefully, collections absent without crash
8. Confirm `skills.json` and existing manifest fields are unchanged after publish
9. Confirm manifests decode with and without `collections`
10. Confirm collection cache filenames are track-specific
11. Confirm failed collection refresh does not fail the full refresh
12. Confirm `SkillsStore` keeps previous collections after collection decode failure
13. Confirm featured author taps open the author profile
14. Confirm non-featured author taps keep the existing author-filter behavior
15. Confirm collection cards and author buttons are keyboard and VoiceOver accessible
