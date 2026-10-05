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
