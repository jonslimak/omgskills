# omgskills MCP

Read-only MCP server for agent access to the omgskills library.

Requires Node.js 20.3 or newer.

## What It Does

The server exposes the skill library as safe agent tools. Agents can search, inspect one skill, read its SKILL.md, get a pinned install plan, find related skills, list trending and curated skills, and filter by author.

It does not crawl, scrape, edit, install, or write files. `get_install_plan` returns a script for the agent to run; the server never runs it.

Every tool returns structured content (the full fields) plus a short text rendering, one line per skill. List tools return compact rows by default (`summary: true`, 10 results) and page automatically: each result reports `page.total` and a `page.nextCursor` to pass back as `page: {"cursor": ...}`. Tool metadata marks every operation as read-only and non-destructive; only `get_skill_content` reads outside the catalog (SKILL.md from GitHub).

IDs are case-insensitive and accept the web app's `catalog:` prefix. Author handles accept a leading `@`.

## Data Sources

Default remote sources, the same as the hosted server at `https://omgskills.com/mcp`, tried newest first:

- `https://omgskills.com/data/crawl4/manifest.json`, then the `v2` and root manifests if it is unavailable
- the compact search index and skill details from that manifest, plus its trending data
- `https://raw.githubusercontent.com/jonslimak/omgskills/main/index/gold-basket.json`

Local repo sources:

- `../index/skills.json`
- `../index/trending.json`
- `../index/gold-basket.json`

Override with environment variables:

- `OMGSKILLS_SKILLS_PATH`
- `OMGSKILLS_TRENDING_PATH`
- `OMGSKILLS_GOLD_BASKET_PATH`
- `OMGSKILLS_MANIFEST_URL`
- `OMGSKILLS_GOLD_BASKET_URL`

Each local file override works independently. Unset sources use the selected
manifest and curated URL; setting all three file paths keeps loading offline.

### Automatic Refresh

The local npm server checks for catalog updates every ten minutes while running,
in both stdio and local HTTP mode. Unchanged checks fetch only catalog metadata
and curated data, not the full skills index. A validated update replaces the
catalog between tool calls; a call already running keeps its original snapshot.

If a check or download fails, the previous catalog stays available. Retries back
off from ten minutes to at most one hour. Diagnostics go to stderr, not the MCP
protocol stream. Refresh timers do not keep the process alive and are stopped
when the transport or HTTP listener closes.

The remote catalog selected at startup stays selected during refresh, including
an explicit `OMGSKILLS_MANIFEST_URL`. Local-file overrides disable automatic
refresh, preserving existing offline and mixed-source behavior. Restart to reload
those files. A cursor from a previous catalog returns `catalog_snapshot_changed`;
restart that search from its first page.

This refreshes library data only. It never installs or updates skill files.

## Tools

### `search_skills`

Search by keywords or a short task description, with optional filters. Typos are
corrected (`search.did_you_mean`), task-like queries fall back to skills matching some
of the words (`search.partial_match`), and an empty query lists trending skills.
Every row reports `install_status`; pass `installable: true` to get only skills that
`get_install_plan` can install at a pinned, verified commit.

```json
{
  "query": "swift",
  "limit": 10,
  "author": "anthropics",
  "tag": "agent-skills",
  "minStars": 100,
  "installable": true
}
```

### `get_skill`

Fetch one skill by ID, with `install_status`, `pinned_install` and, for pinned skills,
user-scope `install` scripts for Claude Code and Codex.

Full-record reads also report `discovery_only_reason` and `install_blockers` when
recorded metadata prevents installation. Blockers distinguish missing or invalid
commits, verification hashes, repository URLs, paths and install folder names.
Summary lists do not load detail files to derive these fields. An install plan
returns the same blockers alongside its existing `reason` and pinned alternatives.
These are reproducibility checks, not a security audit or a claim that a skill is safe.

```json
{
  "id": "anthropics/skills:algorithmic-art"
}
```

### `get_skills`

Fetch up to 30 skills by stable ID in one read. Results keep the requested order;
duplicate IDs are removed and IDs that were not found are listed in `missing`.

```json
{
  "ids": ["anthropics/skills:algorithmic-art", "anthropics/skills:pdf"]
}
```

### `list_trending`

List trending skills.

```json
{
  "limit": 10
}
```

### `list_gold_basket`

List curated gold-basket skills, ordered by editorial score. Pages like the other lists.

```json
{
  "limit": 10
}
```

### `list_by_author`

List skills by GitHub author handle.

```json
{
  "author": "anthropics",
  "limit": 10
}
```

### `related_skills`

Other skills for the same job: those sharing the most name words first, then the
most-starred. Pass `installable: true` to find a pinned alternative to a
`discovery_only` skill.

```json
{
  "id": "affaan-m/ecc:react-performance",
  "limit": 5,
  "installable": true
}
```

### `get_install_plan`

Commit-pinned install steps for one agent and scope. The script fetches exactly
`pinned_install.commit_sha`, checks SKILL.md against `skill_md_sha`, refuses to
overwrite an existing destination (including symlinks), and copies the skill into `~/.claude/skills`,
`~/.codex/skills` (user scope) or `.claude/skills`, `.codex/skills` (project scope).
For `discovery_only` skills it explains why and suggests pinned alternatives.
Temporary files and incomplete installs are cleaned up on failure or interruption.

```json
{
  "id": "anthropics/skills:pptx",
  "agent": "codex",
  "scope": "user"
}
```

### `get_skill_content`

The skill's SKILL.md, read from GitHub at the pinned commit (or the default branch,
flagged, for `discovery_only` skills) and checked against the catalog hash.
Downloads stop at 256 KiB, share an eight-second timeout, and follow at most three
redirects, only within GitHub's HTTPS raw-content host. Verification uses the full
download before `max_chars` limits the displayed text.

```json
{
  "id": "anthropics/skills:pptx",
  "max_chars": 12000
}
```

## Setup

Install from npm:

```bash
npm install -g omgskills-mcp
```

MCP client config:

```json
{
  "mcpServers": {
    "omgskills": {
      "command": "omgskills-mcp"
    }
  }
}
```

Local development:

```bash
npm install
npm run typecheck
npm run build
npm test
npm run smoke
```

## Local Streamable HTTP Development

The same tool definitions can run through a stateless Streamable HTTP transport for local testing:

```bash
npm install
npm run dev:http
```

The endpoint is available at `http://127.0.0.1:3000/mcp`. Set `OMGSKILLS_MCP_PORT` to use another local port.

The development server refuses non-localhost bindings and is not a production endpoint. For compiled output, run `npm run build` followed by `npm run start:http`.

## Netlify Production Adapter

The repository includes a stateless Netlify adapter at `netlify/functions/omgskills-mcp.mts` for `/mcp`, with public catalog health at `/mcp/health`. It preserves the stdio server and uses the same tool definitions.

Before a production deploy, verify the draft endpoint from the repository root:

```bash
MCP_ORIGIN=https://<draft-hostname> npm run verify:mcp
```

## Agent Client Config

Example local MCP client config:

```json
{
  "mcpServers": {
    "omgskills": {
      "command": "node",
      "args": ["/absolute/path/to/omgskills/mcp/dist/index.js"]
    }
  }
}
```

For development:

```json
{
  "mcpServers": {
    "omgskills": {
      "command": "npm",
      "args": ["run", "dev"],
      "cwd": "/absolute/path/to/omgskills/mcp"
    }
  }
}
```

## Safety Model

- Read-only tools only.
- No write APIs.
- No scraper imports.
- No shell commands exposed to agents.
- JSON files are the boundary between `index/` and `mcp/`.

## Future Upgrades

The storage layer can change without changing agent tools.

Good next steps:

- SQLite for faster startup and filtering.
- Full-text search index for better ranking.
- Embeddings for semantic search.
- More advanced production search indexes if catalog size makes the current cached JSON loader too slow.

## License

MIT. See [LICENSE](LICENSE). This folder is open source; the rest of the omgskills repository is source-available under its own terms.
