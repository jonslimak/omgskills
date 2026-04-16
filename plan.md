# omgskills — Skill Directory & Search

## Context

Claude Code skills are exploding across GitHub, but there's no good way to find them. `github.com/search` is noisy, package managers don't cover skills, and "the best skills for X" lives in scattered tweets and blog posts. omgskills is a Mac **menu-bar app** (SwiftUI) backed by a continuously scraped index of every public Claude skill — one icon in your menu bar, one keystroke away, keyed to "what does this skill do" rather than "what repo is it in." Recommendations from trusted people layer on top later as a trust signal, once the raw search surface proves useful.

## Phasing

This is the staged vision. The thin-slice POC (see `poc.md`) covers phase 1 only.

- **Phase 1 — Skill search** (MVP): scrape GitHub for Claude skills, build a SwiftUI menu-bar app over the index. No recommendations.
- **Phase 2 — Recommendations**: layer Twitter/X scraping on top. Each skill gains a "Recommended by" row sourced from tweets.
- **Phase 3 — Public launch**: sign + notarize the app, distribute via Homebrew cask, accept community submissions to the index via PR.

## Who it's for

- **Phase 1 (personal)**: Jon wants to answer "is there a Claude skill for X?" by clicking the menu-bar icon (or hitting a global hotkey) and typing.
- **Phase 2+**: Devs and teams evaluating skills — now with the extra "who uses this" trust signal.

## Core user flows (phase 1)

1. **Open** — click the `eyes` icon in the menu bar, or hit the global hotkey.
2. **Search** — type `ios` → ranked list of matching skills narrows in real time.
3. **Open a skill** — select + ⏎ shows detail (description, tags, author, GitHub link, last updated).
4. **Install** — one keypress copies the install snippet (`git clone …`) to clipboard; paste into Claude Code.
5. **Jump to source** — `⌘⏎` opens the skill's repo on GitHub.

Later, in phase 2:

6. **See recommenders** — detail view gains a "Recommended by" section with tweet/README quotes.
7. **Filter by person** — type `@dhh` to see skills that person authored or recommended.

## Data model (JSON, kept flat)

**`skills.json`** — the core table, phase 1
```
{
  id,                // stable slug, e.g. "owner/repo"
  name,              // from SKILL.md frontmatter
  description,       // from SKILL.md frontmatter
  github_url,
  install_cmd,       // derived: git clone {url} ~/.claude/skills/{name}
  author_handle,     // GitHub handle
  tags[],            // extracted from frontmatter + repo topics
  readme_snippet,    // first ~500 chars of README
  stars,             // GitHub star count (light relevance signal)
  last_updated,      // from GitHub pushed_at
  first_seen         // when scraper first saw it
}
```

**`people.json`** — added in phase 2 (author entries may exist sooner)
```
{ handle, display_name, avatar_url, twitter_url, github_url, bio }
```

**`recommendations.json`** — added in phase 2
```
{ person_handle, skill_id, source_url, quote, date }
```

## Architecture

Two folders (may split into two repos at phase 3):

- **`index/`** — TypeScript scraper + JSON output. GitHub Actions cron runs nightly, commits updated JSON to `main`.
- **`menubar/`** — SwiftUI menu-bar app. Swift Package + build script that wraps the binary in a `.app` bundle with `LSUIElement=true` (no dock icon).

## Scraping strategy

### Phase 1 — GitHub (via Octokit, authenticated with a fine-grained PAT)

Two complementary queries feed the index:

1. **Topic search** — `GET /search/repositories?q=topic:claude-code-skill OR topic:claude-skill OR topic:claude-skills`. High precision but relies on authors tagging.
2. **Code search** — `GET /search/code?q=filename:SKILL.md`, filtered to paths at repo root or under `.claude/skills/` (cuts noise from side-artifact SKILL.md files in unrelated repos).

For each candidate repo:
- `GET /repos/{owner}/{repo}` for stars, description, pushed_at, topics.
- `GET /repos/{owner}/{repo}/contents/SKILL.md` to parse YAML frontmatter (`name`, `description`).
- `GET /repos/{owner}/{repo}/readme` for the snippet.

Rate limits (authenticated PAT): 30 req/min code search, 5000/hr overall. Nightly batch fits comfortably. `@octokit/plugin-retry` handles transient 5xx from GitHub's search shards.

### Phase 2 — Twitter/X

- Preferred: **Nitter / Apify Twitter scraper actor** — avoids API cost.
- Query: `"claude skill" OR "SKILL.md"` + a seed list of ~20 handles Jon follows.
- Extract GitHub URLs from tweets → resolve against `skills.json` → create a `recommendations.json` entry linked to the tweet author.

### Seed file

`index/seed.json` lists handles to crawl directly (for both GH and X) and keywords to include. Hand-edited.

## Menu-bar app — UX

### Phase 1 (ship this first)

- **Menu-bar icon**: SF Symbol `eyes` (SwiftUI `systemImage: "eyes"`) — small, monochrome, template-style so it adapts to light/dark menu bar.
- **Panel**: click icon or global hotkey opens a ~400×500 popover.
  - Search field pinned to the top, autofocused.
  - Scrolling list below. Each row: skill name, one-line description, star count, first tag.
  - Arrow keys move selection; ⏎ copies install; ⌘⏎ opens GitHub; ⌘. copies URL; ESC closes.
- **Global hotkey**: default ⌥⇧S, configurable via `sindresorhus/KeyboardShortcuts`. Phase 2 adds a Preferences window to customize.
- **Detail view** (from within the popover, pushed via NavigationStack): description, readme snippet, metadata (author, stars, last updated, first seen), action buttons.

### Phase 2 additions

- Detail view gains "Recommended by" section with tweet links.
- `@handle` prefix in search filters to that person's skills.
- Background refresh: app fetches `skills.json` from GitHub raw every hour, falls back to bundled copy if offline.
- Preferences window for hotkey + data source URL.

## Out of scope (phase 1)

- Any Twitter scraping.
- Recommendations layer / "Recommended by" UI.
- User submissions, voting, comments, favorites.
- Skill installer (just copy command — Claude handles install).
- Deduping across forks (treat each repo as distinct; add canonicalization later).
- Auth / settings sync across devices.
- Signed + notarized distribution (dev build only; run locally).
- Preferences window (hardcoded hotkey for POC).

## Critical files to create

- `index/scraper/build.ts` — orchestrates topic + code search, enrichment, merge into `skills.json`.
- `index/scraper/sources/topics.ts` — topic search.
- `index/scraper/sources/code.ts` — code search with path filter.
- `index/scraper/enrich.ts` — per-repo enrichment.
- `index/scraper/client.ts` — throttled + retrying Octokit.
- `index/skills.json` — output index (committed).
- `index/.github/workflows/scrape.yml` — nightly cron.
- `menubar/Package.swift` — Swift Package manifest.
- `menubar/build.sh` — `swift build` + `.app` bundle wrap.
- `menubar/Info.plist` — `LSUIElement=true`, min macOS 13.
- `menubar/Sources/omgskills/omgskillsApp.swift` — `@main`, NSStatusItem + NSPopover wiring.
- `menubar/Sources/omgskills/ContentView.swift` — search field + list.
- `menubar/Sources/omgskills/SkillDetailView.swift` — detail view.
- `menubar/Sources/omgskills/SkillsStore.swift` — loads bundled `skills.json`.
- `menubar/Sources/omgskills/Skill.swift` — Codable struct (mirrors index/ types.ts).
- `menubar/Resources/skills.json` — symlinked or copied from `../index/skills.json` at build.

Phase 2 adds: `index/scraper/twitter.ts`, `people.json`, `recommendations.json`, plus "Recommended by" UI in the detail view and a Preferences scene.

## Verification

1. **Scraper** — `cd index && npm run scrape`. Confirm `skills.json` contains ≥50 entries and every entry has non-empty `name`, `description`, `github_url`, `install_cmd`.
2. **App build** — `cd menubar && ./build.sh`. Expect a clean Swift build and `dist/omgskills.app` present.
3. **Launch** — `open menubar/dist/omgskills.app`. `eyes` icon appears in the menu bar. No dock icon.
4. **Search** — click the icon, type `ios`, confirm list narrows within ~50ms for local data.
5. **Install flow** — ⏎ copies an install command. Paste into Claude Code; skill installs successfully.
6. **Hotkey** — with panel closed, hit ⌥⇧S. Panel opens, search field focused.
