# omgskills MCP

Read-only MCP server for agent access to the omgskills library.

## What It Does

The server exposes the local skill library as safe agent tools. Agents can search, inspect one skill, list trending skills, list curated gold-basket skills, and filter by author.

It does not crawl, scrape, edit, install, or write files.

## Data Sources

Defaults:

- `../index/skills.json`
- `../index/trending.json`
- `../index/gold-basket.json`

Override with environment variables:

- `OMGSKILLS_SKILLS_PATH`
- `OMGSKILLS_TRENDING_PATH`
- `OMGSKILLS_GOLD_BASKET_PATH`

## Tools

### `search_skills`

Search by keyword with optional filters.

```json
{
  "query": "swift",
  "limit": 10,
  "author": "anthropics",
  "tag": "agent-skills",
  "minStars": 100
}
```

### `get_skill`

Fetch one skill by stable ID.

```json
{
  "id": "anthropics/skills:algorithmic-art"
}
```

### `list_trending`

List trending skills.

```json
{
  "limit": 20
}
```

### `list_gold_basket`

List curated gold-basket skills.

```json
{
  "limit": 20
}
```

### `list_by_author`

List skills by GitHub author handle.

```json
{
  "author": "anthropics",
  "limit": 20
}
```

## Setup

```bash
cd mcp
npm install
npm run typecheck
npm run build
```

Run locally:

```bash
npm run start
```

Smoke test:

```bash
npm run smoke
```

## Agent Client Config

Example MCP client config:

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
- Remote hosted MCP once local behavior is proven.
