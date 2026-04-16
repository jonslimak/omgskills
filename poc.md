# omgskills — Thin-Slice POC

## Goal

Validate one question before investing in cron, recommendations, or a public launch:

> **Can a menu-bar app over every public Claude skill replace my current "google + scroll Twitter" habit for finding skills?**

The bet: a fast fuzzy search over `name + description + tags` across the whole GH-visible skill universe is more useful than browsing by repo. Recommendations from trusted people are a *trust signal* we layer on later — valuable, but secondary to just *finding the thing*.

## What we're NOT building (yet)

- Twitter/X scraping
- Recommendations (`recommendations.json`, "Recommended by" UI, `@handle` filter)
- Browse People view
- GitHub Actions cron (run scraper locally)
- Separate index repo (everything in one folder)
- Skill installer (just copy command)
- Signed + notarized distribution
- Preferences window / custom hotkey
- Dedup, canonicalization across forks

## What we ARE building

### 1. A minimal GitHub scraper (~2 hours) ✓ done

Single Node/TypeScript project: `index/scraper/`. Run with `npm run scrape`. Writes `index/skills.json`.

**Queries** (authenticated with a fine-grained PAT, `@octokit/rest`):

1. `GET /search/repositories?q=topic:claude-code-skill` — also `claude-skill`, `claude-skills` variants.
2. `GET /search/code?q=filename:SKILL.md` — filtered to root `SKILL.md` or `.claude/skills/*/SKILL.md` paths.

**For each candidate repo** (with `@octokit/plugin-throttling` + `@octokit/plugin-retry`):

- Fetch repo metadata (`stars`, `description`, `pushed_at`, `topics`).
- Fetch `SKILL.md` contents, parse YAML frontmatter (`name`, `description`, optional `tags`).
- Fetch first ~500 chars of README for `readme_snippet`.

**Output** `skills.json`:
```json
{
  "id": "owner/repo",
  "name": "...",
  "description": "...",
  "github_url": "https://github.com/owner/repo",
  "install_cmd": "git clone https://github.com/owner/repo ~/.claude/skills/name",
  "author_handle": "owner",
  "tags": ["..."],
  "readme_snippet": "...",
  "stars": 0,
  "last_updated": "2026-04-10T...",
  "first_seen": "2026-04-16"
}
```

**Done criteria**: script produces ≥50 skills in one run, every entry has non-empty `name`, `description`, `github_url`, `install_cmd`.

### 2. SwiftUI menu-bar app (~3 hours)

A Swift Package with a build script that wraps the binary in a `.app` bundle. Runs as `LSUIElement=true` (no dock icon, just the menu-bar `eyes` icon).

**Menu-bar icon + popover**
- `NSStatusItem` with SF Symbol `eyes` (template image).
- Click → `NSPopover` opens a ~400×500 SwiftUI panel.
- Global hotkey (default ⌥⇧S) toggles the popover, via `sindresorhus/KeyboardShortcuts`.

**Search + list**
- Search field at top, autofocused on open.
- List of rows: skill name, description, `★ stars`, first tag.
- Filter on `name + description + tags + author_handle` (case-insensitive contains; fuzzy is a phase-2 polish).
- Keyboard-first: arrow keys select; ⏎ copies install; ⌘⏎ opens GitHub; ⌘. copies URL; ESC closes.

**Detail view (⇥ or click → details)**
- Name, description, tags, readme snippet.
- Meta: author, stars, last updated.
- Same action shortcuts.

**Data loading**
- Bundled `skills.json` inside the `.app` Resources folder (copied from `../index/skills.json` at build). Rebuild to refresh. Phase 2 fetches from GitHub raw.

### 3. Dogfood for 7 days

Use it as your default path for "is there a skill for X?" Keep a running note of:
- Queries you typed
- Whether the right skill surfaced
- Queries where nothing matched (candidates for scraper improvement)
- Skills you installed from the app

Rerun `npm run scrape && cd menubar && ./build.sh` once mid-week to test the refresh flow.

## Done criteria

The POC is "done" when all of these are true:

- [x] `npm run scrape` produces `skills.json` with ≥50 entries.
- [ ] `./build.sh` produces `menubar/dist/omgskills.app` cleanly.
- [ ] Launching the app shows the `eyes` icon in the menu bar.
- [ ] Clicking the icon opens the popover with the skills list.
- [ ] Typing narrows the list in real time.
- [ ] ⏎ on a skill row copies an install command that works when pasted into Claude Code.
- [ ] Global hotkey (⌥⇧S) toggles the popover.
- [ ] Rerunning `./build.sh` after a fresh scrape produces an updated list.

## Validation checkpoints (end of week)

Answer these in writing:

1. **Coverage**: Out of ~15 queries you ran this week, how many surfaced the right skill? (Target: ≥70%.)
2. **Speed**: Did you reach for the menu-bar icon instead of opening a browser tab? How many times?
3. **Missing**: What *kind* of skill was most often missing or miscategorized? (Tells us what to fix in scraping — topic tags, frontmatter parsing, search queries, ranking.)
4. **Next layer**: Did you ever want to know "who uses this skill" when looking at a result? (Tells us how urgent phase 2 recommendations are.)

**If coverage is low** → scraper needs more sources (topic variants, code search tuning, seeded handle list).
**If speed wins but coverage is fine** → ship phase 1 as-is, start phase 2 (recommendations).
**If nobody uses it** → rethink the form factor.

## File layout

```
/Users/jonslimak/Projects/omgskills/
  plan.md              # full staged vision
  poc.md               # this file
  poc-task.md          # execution checklist
  index/               # scraper — DONE
    package.json
    skills.json        # scraper output, committed
    scraper/
      build.ts
      client.ts
      enrich.ts
      sources/
        topics.ts
        code.ts
      types.ts
  menubar/             # SwiftUI menu-bar app
    Package.swift
    build.sh
    Info.plist
    Sources/omgskills/
      omgskillsApp.swift
      ContentView.swift
      SkillDetailView.swift
      SkillsStore.swift
      Skill.swift
      KeyboardShortcutNames.swift
    Resources/
      skills.json      # copied from ../index/skills.json at build
      AppIcon.png
```

## GitHub Search API — key facts

- **Auth**: fine-grained PAT (no scopes needed for public read); stored in `.env` as `GITHUB_TOKEN`.
- **Rate limits**: 30 req/min code search, 5000/hr overall for authed requests. Code search requires auth — unauth code search returns 422.
- **Pagination**: max 100 results per page, 1000 results total per query.
- **Library**: `@octokit/rest` + `@octokit/plugin-throttling` + `@octokit/plugin-retry` for rate-limit and 5xx handling.

## Estimated time

- Scraper: 2 hrs ✓ done
- SwiftUI menu-bar app scaffolding (Package.swift, Info.plist, build.sh, NSStatusItem wiring): 45 min
- UI (ContentView, SkillDetailView, search, actions): 90 min
- Global hotkey via `KeyboardShortcuts`: 30 min
- Polish + dogfood setup: 30 min

**Total: ~5 hours** to something usable (~3 hours remaining).
