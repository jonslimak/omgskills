# omgskills MCP

Read-only MCP server for agent access to the omgskills library.

## What It Does

The server exposes the skill library as safe agent tools. Agents can search, inspect one skill, list trending skills, list curated gold-basket skills, and filter by author.

It does not crawl, scrape, edit, install, or write files.

Every tool returns JSON text for existing MCP clients and structured content for clients that support output schemas. Tool metadata marks every operation as read-only, non-destructive, and closed to external side effects.

## Data Sources

Default remote sources:

- `https://omgskills.com/data/manifest.json`
- skills JSON from that manifest
- trending JSON from that manifest
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
- Production hosting, caching, rate limiting, and health checks for the HTTP transport.
