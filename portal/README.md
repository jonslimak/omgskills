# omgskills portal

React/Vite portal for Skill Groups.

## Local setup

Use Node 20:

```bash
nvm use
npm install
```

Run the portal only:

```bash
npm run dev:portal
```

Run the full Netlify app when using Node 20:

```bash
npm run dev
```

The local portal expects:

```text
VITE_CLERK_PUBLISHABLE_KEY
CLERK_SECRET_KEY
```

Do not commit `.env` files.

### Public catalog preview

Set `PORTAL_PUBLIC_CATALOG_PROXY=1` when starting Vite to enable the public catalog proxy.
It forwards `/mcp` (POST), `/mcp/health`, `/data/crawl4/*`, `/data/v2/*`, and `/catalog-skill-urls.json`
to `https://omgskills.com`. File/health requests allow GET/HEAD only. Cookies and
authorization headers are removed. It does not enable private account APIs, change
the sample-data preview, or download the raw catalog automatically.

The unified local preview defaults to live Discover with a sample account. The
catalog selector retains the deterministic sample catalog. Live mode reads
manifest-discovered collections (crawl4, then v2 fallback) and bounded MCP lists;
it never reads the raw skills asset. Collection details use at most four concurrent
requests and 30 entries. Search is debounced; public reads are cancellable and
cached in memory for two minutes (up to 60 responses). Real catalog rows do not
inherit installation or favorite state from the sample account. Public skill
links load on demand, and no install or account write is enabled.

Categories use the Mac app's 24 starter-search terms from
`src/app/unified/discovery-categories.ts`, separately from published collections.
Each term opens an exact-text search; sidebar groups show their six shortcuts.
Groups use three columns on desktop and two on narrow/mobile layouts. The sample
catalog uses the same definitions. Handoff typography, compact rows, and the
side-by-side detail header are scoped to the unified preview.

The combined Netlify build adds matching public-route exceptions before the app
subdomain fallback. Routing changes require a separately approved deployment.

### Unified app checkpoint

The active local integration preview is `http://127.0.0.1:5191/app/integration/unified/`.
See `../appwork.md` for the current acceptance checklist and backend limits.
Reuse the existing preview for UI checks. Do not provision or expand disposable
local infrastructure; real auth, invite persistence and external connections are
reserved for separately approved production testing.

Discover starts independent reads concurrently and retains up to 20 public view
snapshots in memory for ten minutes, showing cached results while refreshing.
It does not persist private account data or fetch the full skills catalog.

Production routing is implemented but **off by default**. A separately approved
release can select it with `VITE_PORTAL_UNIFIED_ENABLED=1` and
`VITE_SKILLGROUPS_WEB_ENABLED=1`, plus the existing Clerk configuration. Existing
set deep links, pairing/review routes and public library pages are preserved.
No environment flag is enabled by this checkpoint.

The catalog/Favorites follow-up extends the existing creation API with a single
`catalogSkillId` for Favorites, saving the set and first item together. Owner item
reads include existing catalog IDs; catalog insertion checks duplicates under the
existing set lock. No schema migration is needed. The client retains a missing-ID
guard for older responses, so deploy the matching backend with this client.

No invitation email is sent; the UI provides a copyable link after access is
granted. First-time catalog Favorites, persisted saves and recipient access still
need production acceptance. Local tests do not establish live connectivity.

## Verification

Build the portal and combined Netlify output:

```bash
npm run check
npm run build:netlify
SITE_DIR=dist/netlify-site node ./scripts/prepare-netlify-site-deploy.mjs
```

Create a draft deploy:

```bash
npx netlify-cli deploy --dir=dist/netlify-site --site "$NETLIFY_SITE_ID"
```

Milestone 0 smoke endpoints:

```text
/api/portal/auth-smoke
/api/portal/db-smoke
```

Both require a Clerk bearer token.
