# omgskills

A macOS menubar app that discovers, indexes, and lets you browse Claude Code skills from GitHub. Two independent parts: a Node.js scraper that builds the index, and a Swift menubar app that reads it.

---

## Project structure

```
omgskills/
├── index/               # Scraper — discovers skills and writes skills.json
│   ├── skills.json      # Generated output (source of truth for the app)
│   ├── package.json
│   ├── tsconfig.json
│   └── scraper/
│       ├── build.ts     # Entry point — orchestrates all sources, merges, enriches
│       ├── client.ts    # Hardened Octokit with retry + throttle
│       ├── enrich.ts    # Fetches SKILL.md, parses frontmatter, fetches README
│       ├── types.ts     # Skill interface
│       └── sources/
│           ├── topics.ts       # GitHub topic + repo-name searches
│           ├── code.ts         # GitHub code search (filename:SKILL.md + fingerprints)
│           ├── aggregators.ts  # Parses "awesome-claude" lists for linked repos
│           └── social.ts       # Hacker News + Reddit link extraction
│
└── menubar/             # macOS app
    ├── Package.swift
    ├── build.sh         # Compiles release binary, assembles .app bundle
    ├── Info.plist
    └── Sources/omgskills/
        ├── omgskillsApp.swift       # App entry, NSPanel setup, global hotkey
        ├── ContentView.swift        # Full UI — list, detail panel, search, sort
        ├── Skill.swift              # Codable model
        ├── SkillsStore.swift        # Loads skills.json, scans installed, builds FTS index
        ├── SkillSearchIndex.swift   # SQLite FTS5 search via GRDB
        ├── InstalledSkillsScanner.swift  # Scans ~/.claude/skills etc.
        ├── ReadmeWebView.swift      # WKWebView wrapper for markdown/HTML rendering
        ├── KeyboardShortcutNames.swift   # Global hotkey (Option-S)
        └── Resources/
            ├── skills.json          # Copied from index/ at build time
            └── marked.min.js        # Bundled markdown parser for WebView
```

---

## Running the scraper

```bash
cd index
cp .env.example .env          # add GITHUB_TOKEN=<fine-grained PAT>
npm install
npm run scrape                # writes index/skills.json
```

The scraper runs all discovery sources in parallel, merges candidates, enriches each one via the GitHub API, and writes `skills.json` sorted by stars.

Typical run time: 1–3 hours on a cold run (~14,000+ candidates, GitHub rate limits). Subsequent runs are significantly faster — existing skills with unchanged `SKILL.md` SHAs are returned from cache in milliseconds.

After the scrape finishes, rebuild the app:

```bash
cd menubar && ./build.sh && open dist/omgskills.app
```

**Important**: `skills.json` must be valid UTF-8 with no lone Unicode surrogates. The scraper sanitizes strings automatically, but if you encounter a `Failed to decode JSON` error in the app, the file may be corrupt. Run `npm run scrape` again to regenerate it.

---

## Building the app

```bash
cd menubar
./build.sh        # compiles release binary + assembles dist/omgskills.app
open dist/omgskills.app
```

`build.sh` copies `../index/skills.json` into the bundle automatically. Run the scraper first, or use an existing `index/skills.json`.

---

## How the scraper works

### Discovery (4 parallel sources)

All sources run simultaneously. Each returns a list of `(repo, skill_md_path)` candidates.

**1. Topics (`sources/topics.ts`)**
Searches GitHub repos by topic. Covers well-tagged repos in the Claude Code and Agent Skills ecosystems.
- Regular topics (14): `claude-code-skill`, `claude-skill`, `claude-skills`, `claude-code-plugin`, `claude-agent`, `agentic-skill`, `ai-agent-skills`, `claude-mcp`, `claude-commands`, `claude-code-tools`, `anthropic-claude`, `claude-skill-pack`, `claude-code-agent`, `agent-skill`
- Large topics (>1000 repos): `agent-skills` split across 5 star ranges (`>1000`, `100..1000`, `10..99`, `1..9`, `0`) to stay under the GitHub 1000-result cap per query
- Repo name patterns: `"Agent-Skill" in:name` — catches repos like `twostraws/SwiftUI-Agent-Skill` and `AvdLee/Swift-Concurrency-Agent-Skill` that don't use topics

**2. Code search (`sources/code.ts`)**
Searches for `SKILL.md` files directly. Catches repos that never tagged themselves.
- Broad: `filename:SKILL.md` — up to 1,000 results, any path accepted
- Fingerprint A: `preamble-tier filename:SKILL.md` — ~784 results, all genuine Claude Code skills (preamble-tier is Claude Code-specific)
- Fingerprint B: `~/.claude/skills filename:SKILL.md` split across 8 size buckets — catches SKILL.md files that reference the install path

Any file path ending in `/SKILL.md` is accepted (no depth restriction). This handles root-level skills (`SKILL.md`), subdirectory skills (`.claude/skills/name/SKILL.md`, `skills/name/SKILL.md`, `skillname/SKILL.md`), and deeply nested monorepo skills (`plugins/name/skills/name/SKILL.md`).

The skill ID for subdirectory skills is `owner/repo:parent-dir-name` (e.g. `AgriciDaniel/claude-ads:ads-google`).

**3. Aggregators (`sources/aggregators.ts`)**
Finds repos matching `awesome-claude in:name stars:>5` (top 50), fetches their READMEs, and extracts all GitHub URLs. Those repos become candidates. High false-positive rate (~80% skip), but enrichment filters them cheaply.

**4. Social (`sources/social.ts`)**
Extracts GitHub URLs from posts on Hacker News (Algolia API, free) and Reddit (`r/ClaudeAI`, `r/anthropic`, public JSON API, free). Both run in parallel. No authentication required. Contributes ~400–500 candidate repos per run.

### Merging

All candidates are merged into a single `Map<id, Candidate>`. Code hits take priority (they carry the actual `skill_md_path`); topic/aggregator/social hits default to `SKILL.md`. Typical merged count: 14,000–20,000 candidates per run.

### Enrichment (`enrich.ts`)

For each candidate:
1. Fetch repo metadata (stars, last updated, topics) — skipped if already seeded from topic search
2. Fetch `SKILL.md` via `repos.getContent` — also returns the file's git object SHA
3. **SHA cache check**: if `fileData.sha === existing.skill_md_sha`, return existing skill data with refreshed stars/last_updated. Skip README re-fetch and YAML parse entirely.
4. Parse YAML frontmatter — must have `name` and `description`, otherwise skip
5. Fetch README (up to 5,000 chars)
6. Sanitize all string fields to remove lone Unicode surrogates (prevents JSON decode failures in Swift)
7. Store `skill_md_sha` for next run's cache check

~50% of candidates are skipped (no valid SKILL.md frontmatter — false positives from broad searches). On warm cache runs, ~70–80% of existing skills hit the SHA cache.

### Output

`index/skills.json` — array of `Skill` objects sorted by stars descending. Fields:

| Field | Description |
|---|---|
| `id` | `owner/repo` or `owner/repo:skill-name` for subdirectory skills |
| `name` | From SKILL.md frontmatter |
| `description` | From SKILL.md frontmatter |
| `github_url` | Repo URL |
| `install_cmd` | `git clone` command derived from path |
| `author_handle` | Repo owner |
| `tags` | Merged from SKILL.md frontmatter + GitHub repo topics |
| `readme_snippet` | First 5,000 chars of repo README |
| `stars` | GitHub star count |
| `last_updated` | Repo last push date |
| `first_seen` | Date first discovered (preserved across runs) |
| `skill_md_sha` | Git object SHA of SKILL.md (used for cache invalidation) |

---

## How the app works

### Window

`FloatingPanel` (NSPanel subclass) — borderless, floating level, non-activating. Positioned below the menubar status item. `constrainFrameRect` overridden to bypass macOS height capping. Toggled by clicking the status bar icon or pressing Option-S.

Height: 855pt. Width: 400pt (list only) or 750pt (with detail panel open).

### Data loading

`SkillsStore` loads `skills.json` from the app bundle on startup, decodes it with snake_case → camelCase conversion, sorts by stars, and builds a SQLite FTS5 search index asynchronously in a detached Task.

`InstalledSkillsScanner` scans `~/.claude/skills/`, `~/.codex/skills/`, and `~/.agents/skills/` for local SKILL.md files and parses their frontmatter.

### Search

`SkillSearchIndex` (GRDB / SQLite FTS5) with BM25 weighted ranking:
- name: weight 10
- tags: weight 3
- author: weight 2
- description: weight 1

Uses `FTS5Pattern(matchingAllPrefixesIn:)` for prefix matching. Falls back to linear filter if FTS fails. Minimum query length: 2 chars.

### UI

`ContentView` — SwiftUI, single file.
- Left panel: scrollable list of skills with search bar, sort menu (stars/date/name), filter tabs (All/Installed)
- Right panel (detail): opens when a skill is selected, shows full metadata, README rendered in WKWebView, install command copy button

`ReadmeWebView` — `NSViewRepresentable` wrapping `PassthroughWebView` (WKWebView subclass). Uses `marked.min.js` (bundled, inlined at runtime) to render markdown/HTML. Height is reported back to SwiftUI via a `WKScriptMessageHandler` bridge so the ScrollView sizes correctly. Scroll events pass through to the parent ScrollView via `scrollWheel` override.

---

## Known limitations

**Discovery gaps**: Repos with no GitHub topics, no `preamble-tier` or `~/.claude/skills` in SKILL.md content, and no self-identifying name pattern (e.g. `openai/plugins`) can only be found via aggregator lists or social posts. These are impossible to discover programmatically without knowing the repo in advance.

**GitHub code search cap**: Each query returns at most 1,000 results. The `~/.claude/skills` fingerprint queries use size splits to maximise coverage, but some buckets remain over the cap and only return a partial result set. Running the scraper repeatedly accumulates more skills over time as result ordering varies.

**`created:` qualifier doesn't work in code search**: GitHub's date filters are not supported for code search (only for repo/issue search). An earlier version of the scraper used broken date-range queries that returned 0 results — these were replaced with content fingerprint queries.

**Lone Unicode surrogates**: Some GitHub README content contains lone surrogate characters that Node.js serialises to invalid JSON. Swift's `JSONDecoder` rejects the entire file if any entry contains one. The scraper strips surrogates from all string fields before writing. If the app shows `Failed to decode JSON`, regenerate `skills.json` with a fresh `npm run scrape`.

---

## Environment

**Scraper**: Node.js 18+, TypeScript, tsx. Requires `GITHUB_TOKEN` in `index/.env`.

**App**: macOS 14+, Swift 6, SwiftUI. Dependencies: KeyboardShortcuts, Yams, GRDB.swift (via SPM).
