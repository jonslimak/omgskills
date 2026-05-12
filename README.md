<p align="center">
  <img src="assets/omgskills-eye.png" alt="omgskills" width="240">
</p>

# omgskills

A macOS menubar app for browsing and installing Claude, Codex, and agent skills from GitHub. Two independent parts: a Node.js scraper that builds the public skill library, and a Swift menubar app that reads bundled or remotely refreshed library data.

---

## MCP server

Agents can search the omgskills library through the published read-only MCP server:

```bash
npm install -g omgskills-mcp
```

Add it to your MCP client:

```json
{
  "mcpServers": {
    "omgskills": {
      "command": "omgskills-mcp"
    }
  }
}
```

The npm package uses hosted library data by default from:

```text
https://omgskills.com/data/manifest.json
```

No local repo checkout is required for MCP users. Full tool docs live in [mcp/README.md](mcp/README.md).

---

## Trust and safety

This repo is public so people can inspect how omgskills works before running it. It is source-available, not open source. You may read and audit the code, but you may not copy, redistribute, or repackage it without permission.

The app:

- reads public skill-library data bundled with the app or served from `omgskills.com`
- scans local Claude, Codex, and agent skill folders to show installed skills
- installs skills from public GitHub repositories only when you choose to install them
- uses Developer ID signing and Apple notarization for public macOS releases

Local crawl logs, browser traces, `.env` files, signing certificates, API tokens, and release credentials are intentionally not part of the public repo.

Security reports should follow [SECURITY.md](SECURITY.md).

---

## Release first

For any public macOS download, use:

```bash
./scripts/release-mac.sh
```

Do not use `menubar/build.sh` for public distribution. It is dev-only and uses ad-hoc signing, which will trigger Gatekeeper warnings.

Required env vars:

- `DEVELOPER_ID_APPLICATION`
- `ASC_PRIVATE_KEY_PATH`
- `ASC_KEY_ID`
- `ASC_ISSUER_ID`

Template:

```bash
cp .env.release.example .env.release
```

The release script:

- builds the app
- Developer ID signs it
- notarizes it
- staples it
- verifies it with `codesign`, `stapler`, and `spctl`
- writes a notarized DMG for public downloads
- writes Sparkle zip artifacts to `site/updates` and regenerates `site/appcast.xml`

Optional version override:

```bash
./scripts/release-mac.sh 0.0.3
```

---

## Project structure

```
omgskills/
├── index/               # Scraper — discovers skills and writes generated JSON
│   ├── skills.json      # Generated skill library
│   ├── trending.json    # Generated skills.sh trending feed
│   ├── x-trending.json  # Generated X/Twitter feed
│   ├── package.json
│   ├── tsconfig.json
│   └── scraper/
│       ├── build.ts     # Entry point — orchestrates all sources, merges, enriches
│       ├── build-trending.ts # Builds the skills.sh trending feed
│       ├── client.ts    # Hardened Octokit with retry + throttle
│       ├── enrich.ts    # Fetches SKILL.md, parses frontmatter, stores lightweight metadata
│       ├── types.ts     # Skill interface
│       └── sources/
│           ├── topics.ts       # GitHub topic + repo-name searches
│           ├── code.ts         # GitHub code search (filename:SKILL.md + fingerprints)
│           ├── aggregators.ts  # Parses "awesome-claude" lists for linked repos
│           └── social.ts       # Hacker News + Reddit link extraction
├── scripts/
│   ├── publish-data.sh  # Publishes hashed skill data into site/data
│   └── release-mac.sh   # Signs, notarizes, packages DMG, and updates Sparkle appcast
│
├── mcp/                 # Read-only MCP server for agent access to hosted skill data
│   ├── package.json
│   ├── README.md        # MCP install, client config, tools, and data-source docs
│   └── src/
│       ├── index.ts     # MCP stdio server and tool definitions
│       └── library.ts   # Hosted/local JSON loading and search logic
│
├── site/
│   ├── data/            # Hosted skill data manifest + hashed JSON files
│   ├── downloads/       # Public download DMG/zip + checksums
│   └── updates/         # Sparkle update zips and deltas
│
└── menubar/             # macOS app
    ├── Package.swift
    ├── build.sh         # Compiles release binary, assembles .app bundle
    ├── Info.plist
    └── Sources/omgskills/
        ├── omgskillsApp.swift       # App entry, NSPanel setup, global hotkey
        ├── ContentView.swift        # Full UI — list, detail panel, search, sort
        ├── Skill.swift              # Codable model
        ├── SkillsStore.swift        # Loads library data, scans installed, builds FTS indexes
        ├── DataRefreshService.swift # Checks hosted data manifest and caches updates
        ├── SkillSearchIndex.swift   # SQLite FTS5 search via GRDB
        ├── InstalledSkillsScanner.swift  # Scans Claude/Codex/Agents skill folders
        ├── SkillInstaller.swift     # Safe GitHub clone + symlink installer
        ├── LocalSkillCrossInstaller.swift # Installs a local skill onto the other platform
        ├── LocalDashboardView.swift # Installed tab dashboard
        ├── GitHubInstallPromptView.swift # Paste-GitHub-URL installer
        ├── ReadmeLoader.swift       # Lazily fetches and caches repo READMEs on detail open
        ├── ReadmeWebView.swift      # WKWebView wrapper for markdown/HTML rendering
        ├── KeyboardShortcutNames.swift   # Global hotkey (Option-S)
        └── Resources/
            ├── skills.json          # Bundled fallback skill library
            ├── trending.json        # Bundled fallback trending feed
            ├── manifest.json        # Bundled data manifest, when available
            └── marked.min.js        # Bundled markdown parser for WebView
```

---

## Running the scraper

```bash
cd index
cp .env.example .env          # add GITHUB_TOKEN=<fine-grained PAT>
npm install
npm run scrape                # writes index/skills.json
npm run scrape:trending       # writes index/trending.json
```

The scraper runs all discovery sources in parallel, merges candidates, enriches each one via the GitHub API, and writes `skills.json` sorted by stars. The trending scraper writes a small `trending.json` feed from skills.sh IDs and install counts.

Typical run time: 1–3 hours on a cold run (~14,000+ candidates, GitHub rate limits). Subsequent runs are significantly faster — existing skills with unchanged `SKILL.md` SHAs are returned from cache in milliseconds.

After the scrape finishes, publish data or rebuild the app:

```bash
./scripts/publish-data.sh
cd menubar && ./build.sh && open dist/omgskills.app
```

**Important**: `skills.json` must be valid UTF-8 with no lone Unicode surrogates. The scraper sanitizes strings automatically, but if you encounter a `Failed to decode JSON` error in the app, the file may be corrupt. Run `npm run scrape` again to regenerate it.

### Refreshing the X feed

```bash
cd index
ENABLE_X_SOCIAL=1 X_AUTH_TOKEN=... X_CT0=... GITHUB_TOKEN=... npx tsx scraper/run-x-enrichment.ts
cd ..
./scripts/publish-data.sh
```

This rebuilds:

- `index/top-x-skill-tweets.json`
- `index/x-trending.json`

The app reads X data from `x-trending.json`, not `skills.json`.

---

## Updating skill data without an app release

The app can receive new skill-library data without shipping a new macOS build.

```bash
cd index
npm run scrape
npm run scrape:trending
cd ..
./scripts/publish-data.sh
```

`publish-data.sh` copies the generated JSON into `site/data/` using content-hashed filenames and writes `site/data/manifest.json`.

Operator health page:

```text
https://omgskills.com/health
```

Backed by:

```text
https://omgskills.com/data/health.json
```

After the website is deployed, installed apps check:

```text
https://omgskills.com/data/manifest.json
```

On launch, the app checks the manifest. If the hashes differ, it downloads and validates the new `skills.json` and `trending.json`, then caches them under:

```text
~/Library/Application Support/omgskills/
```

If the app stays open, it also re-checks about once every 24 hours while running. First-run or missing-cache cases bypass the 24-hour throttle so a fresh install hydrates immediately. If nothing changed, the app keeps the current cache and does not reload the UI. Bundled app data remains the fallback when no cached remote data exists.

### Daily library refresh on GitHub Actions

The main library workflow is:

```text
.github/workflows/scrape.yml
```

It runs nightly and:

- rebuilds `index/skills.json`
- rebuilds `index/trending.json`
- republishes `site/data/manifest.json`
- verifies the published data
- deploys `site/` to Netlify

Required GitHub Actions secrets:

- `SCRAPER_GITHUB_TOKEN`
- `NETLIFY_AUTH_TOKEN`

### Daily X refresh on GitHub Actions

The repo includes a dedicated workflow:

```text
.github/workflows/x-refresh.yml
```

It runs daily and on manual trigger. It:

- collects fresh X posts
- rebuilds `index/x-trending.json`
- republishes `site/data/manifest.json`
- verifies the published data
- deploys `site/` to Netlify

Required GitHub Actions secrets:

- `SCRAPER_GITHUB_TOKEN`
- `ENABLE_X_SOCIAL` = `1`
- `X_AUTH_TOKEN`
- `X_CT0`
- `NETLIFY_AUTH_TOKEN`

If X collection fails, the workflow fails and the last good public `xTrending` file stays live.

### Health monitoring

The repo also includes:

```text
.github/workflows/pipeline-health.yml
```

It:

- checks for stale or stuck `scrape` / `x-refresh` workflows
- verifies the live manifest matches the repo manifest
- writes `site/data/health.json`
- updates `https://omgskills.com/health`
- opens or updates a `Pipeline health` GitHub issue when degraded

---

## Building the app

```bash
cd menubar
./build.sh        # compiles release binary + assembles dist/omgskills.app
open dist/omgskills.app
```

`build.sh` copies `../index/skills.json`, `../index/trending.json`, and `../site/data/manifest.json` into the bundle when those files exist. Run the scraper first, or use existing generated JSON.

`menubar/build.sh` is for local/dev builds only. It uses ad-hoc signing, so it is not suitable for public downloads.

## Releasing the macOS app

Use the canonical release script:

```bash
./scripts/release-mac.sh
```

Optional version override:

```bash
./scripts/release-mac.sh 0.0.3
```

Required setup:

- Install a `Developer ID Application` certificate in your keychain.
- Create an App Store Connect API key for notarization.
- Copy `.env.release.example` and export these env vars in your shell:
  - `DEVELOPER_ID_APPLICATION`
  - `ASC_PRIVATE_KEY_PATH`
  - `ASC_KEY_ID`
  - `ASC_ISSUER_ID`

What the release script does:

- builds `menubar/dist/omgskills.app`
- signs it with Developer ID
- notarizes and staples it
- verifies it with `codesign`, `stapler`, and `spctl`
- writes:
  - `menubar/dist/omgskills-mac.dmg`
  - `menubar/dist/omgskills-mac.dmg.sha256`
  - `site/downloads/omgskills-mac.dmg`
  - `site/downloads/omgskills-mac.dmg.sha256`
  - `menubar/dist/omgskills-mac.zip`
  - `menubar/dist/omgskills-mac.zip.sha256`
  - `site/downloads/omgskills-mac.zip`
  - `site/downloads/omgskills-mac.zip.sha256`
  - `site/updates/omgskills-<version>.zip`
  - `site/appcast.xml`

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
3. **SHA cache check**: if `fileData.sha === existing.skill_md_sha`, return existing skill data with refreshed stars/last_updated. Skip YAML parse entirely.
4. Parse YAML frontmatter — must have `name` and `description`, otherwise skip
5. Sanitize all string fields to remove lone Unicode surrogates (prevents JSON decode failures in Swift)
6. Store `skill_md_sha` for next run's cache check

~50% of candidates are skipped (no valid SKILL.md frontmatter — false positives from broad searches). On warm cache runs, ~70–80% of existing skills hit the SHA cache.

README content is not shipped in `skills.json`. The app fetches README files lazily from GitHub only when a user opens a skill detail view, then caches them locally.

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

`SkillsStore` loads lightweight library data from the remote cache when present, otherwise from the app bundle. It decodes snake_case → camelCase, sorts by stars, builds SQLite FTS5 search indexes asynchronously, and joins `trending.json` entries back to matching skills.

`DataRefreshService` checks the hosted manifest on launch and about once per day while the app is running. It validates byte counts and SHA-256 hashes, writes cached JSON into Application Support, skips rewrites when hashes are unchanged, and records refresh metadata for the “Data Updated” toast.

`InstalledSkillsScanner` scans `~/.claude/skills/`, `~/.codex/skills/`, and `~/.agents/skills/` for local SKILL.md files, parses their frontmatter, dedupes the list view, and keeps install-location counts for the local dashboard.

`ReadmeLoader` fetches repo READMEs on demand when a remote skill detail opens. It tries common names (`README.md`, `README.mdx`, `README.txt`, `README`) on `main` and `master`, renders the markdown in the detail panel, and caches successful loads under `~/Library/Application Support/omgskills/readmes/`. This keeps startup data small and avoids README work during launch/search.

`SkillInstaller` installs remote skills for Claude or Codex by cloning the repo into `~/Library/Application Support/omgskills/repos/` and symlinking the correct skill folder into the selected global skills folder. It does not run raw install shell strings.

### Search

`SkillSearchIndex` (GRDB / SQLite FTS5) with BM25 weighted ranking:
- name: weight 10
- tags: weight 3
- author: weight 2
- description: weight 1

Uses `FTS5Pattern(matchingAllPrefixesIn:)` for prefix matching. Falls back to linear filter if FTS fails. Minimum query length: 2 chars.

### UI

`ContentView` — SwiftUI, single file.
- Left panel: search, sort menu, Installed/Discover tabs, starter search suggestions, and a starter-list link for Trending on skills.sh.
- Installed start state: local dashboard with All/Codex/Claude/Other counts, recently installed skills, and a GitHub URL install prompt.
- Remote detail: metadata, lazy README, GitHub link, and `Claude` / `Codex` install buttons.
- Local detail: Open, SKILL.md, GitHub when known, Install on the other platform when applicable, and Delete.
- Session state: if a skill detail is open when the window hides, the same selected skill/detail state is restored when it opens again during the same app session.

`ReadmeWebView` — `NSViewRepresentable` wrapping `PassthroughWebView` (WKWebView subclass). Uses `marked.min.js` (bundled, inlined at runtime) to render markdown/HTML. Height is reported back to SwiftUI via a `WKScriptMessageHandler` bridge so the ScrollView sizes correctly. Scroll events pass through to the parent ScrollView via `scrollWheel` override.

---

## Known limitations

**Discovery gaps**: Repos with no GitHub topics, no `preamble-tier` or `~/.claude/skills` in SKILL.md content, and no self-identifying name pattern (e.g. `openai/plugins`) can only be found via aggregator lists or social posts. These are impossible to discover programmatically without knowing the repo in advance.

**GitHub code search cap**: Each query returns at most 1,000 results. The `~/.claude/skills` fingerprint queries use size splits to maximise coverage, but some buckets remain over the cap and only return a partial result set. Running the scraper repeatedly accumulates more skills over time as result ordering varies.

**`created:` qualifier doesn't work in code search**: GitHub's date filters are not supported for code search (only for repo/issue search). An earlier version of the scraper used broken date-range queries that returned 0 results — these were replaced with content fingerprint queries.

**Lone Unicode surrogates**: Some GitHub content contains lone surrogate characters that Node.js serialises to invalid JSON. Swift's `JSONDecoder` rejects the entire file if any entry contains one. The scraper strips surrogates from all string fields before writing. If the app shows `Failed to decode JSON`, regenerate `skills.json` with a fresh `npm run scrape`.

---

## Environment

**Scraper**: Node.js 18+, TypeScript, tsx. Requires `GITHUB_TOKEN` in `index/.env`.

**App**: macOS 14+, Swift 6, SwiftUI. Dependencies: KeyboardShortcuts, Yams, GRDB.swift (via SPM).
