# omgskills portal

React/Vite portal for Skill Groups.

## Public discovery loading checks

The unified app preloads its public entry during sign-in initialization. Discover
sections render independently; collection entries use MCP `get_skills` (up to 30
IDs) and share the existing bounded public cache. Deploy the updated MCP function
and client together; a proxy to an older live function cannot serve that new tool.
No account data is included in the public preload.

With the existing Vite frontend running, run:

```bash
PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs \
  node portal/testing/public-catalog-performance-browser.mjs
```

Defaults to `http://127.0.0.1:5191`; override `PORTAL_REVIEW_ORIGIN` for another
loopback frontend. Uses installed Chrome and browser-intercepted public responses
to test real hooks/UI, delays, failures, retries, batch reads and cached revisits.
No new backend or test database is started. The DEV-only acceptance fixture's
`catalog=1` option enables real public hooks; `authDelay` simulates account readiness
without Clerk. These controlled checks are not production latency measurements.

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
it never reads the raw skills asset. Collection details use one MCP `get_skills`
batch for up to 30 entries. Search is debounced; public reads are cancellable and
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
local infrastructure. Core production auth, invitation access/revocation and
Favorites/skill/set persistence were confirmed by the user on 2026-10-07.
Remaining account-isolation, edge-case and external-connection checks are listed
at the top of `../appwork.md`; they are not covered by that confirmation.
The loading/panel fixes shipped in `0e51f512`; guarded deployment and signed-out
live desktop/mobile smoke checks passed. The next proposed pass is signed-in
production navigation and account switching, using an agreed account scope.

Discover starts independent reads concurrently and retains up to 20 public view
snapshots in memory for ten minutes, showing cached results while refreshing.
It does not persist private account data or fetch the full skills catalog.

The unified app is live. `config/production-features.json` enables the unified
and web flags; the combined builder uses this tracked configuration instead of
ambient flag overrides. Existing set deep links, pairing/review routes and public
library pages are preserved. Mac authentication/release gates remain separate.

Combined builds require the live Clerk publishable key for `clerk.omgskills.com`.
Keep `VITE_CLERK_PUBLISHABLE_KEY` identical in GitHub Actions and Netlify's
production build scope. `scripts/portal-build-env.mjs` rejects test keys and other
instances before building; an overnight test-key mismatch was corrected in
`cb0d8164`. Never substitute a test key to make a production deploy preview login.

The catalog/Favorites follow-up extends the existing creation API with a single
`catalogSkillId` for Favorites, saving the set and first item together. Owner item
reads include existing catalog IDs; catalog insertion checks duplicates under the
existing set lock. No schema migration is needed. The client retains a missing-ID
guard for older responses, so deploy the matching backend with this client.

No invitation email is sent; the UI provides a copyable link after access is
granted. The user confirmed persisted saves, read-only recipient access and
revocation in production. First-ever catalog Favorites, concurrency, mixed
representations and the other checks in `appwork.md` remain separate acceptance
items. Local tests alone do not establish live connectivity.

### Local isolation and mobile review

The 2026-10-07 pass covers local account-controller cancellation/isolation and
UI navigation. Related skills retain installed identity, or enter Discover with
private context cleared. Detail focus survives related navigation and responsive
panel changes; signed-out mobile lists/search have a Discover return control.
Actual Clerk account switching still requires a production acceptance check.

Reuse the existing Vite frontend for the sample-only page:
`http://127.0.0.1:5191/app/testing/unified-acceptance/`.
It uses the real unified UI and management dialogs with synthetic data, no auth
or backend, and rejects writes. Do not use it to confirm invitation persistence.
It is not included in the production entry build.

```bash
# From the repo root; point PLAYWRIGHT_MODULE at an existing Playwright module if needed.
PORTAL_REVIEW_ORIGIN=http://127.0.0.1:5191 node portal/testing/unified-acceptance-browser.mjs
```

The runner starts only its browser, never a server or database, and blocks API
and external requests. It checks four widths, keyboard/nested-dialog focus,
related skills, Back/Forward, reload, signed-out navigation, Invite layout,
light/dark and content/error states. Screenshots go to
`output/playwright/unified-acceptance/` (ignored).

## Verification

Follow `deploy.md` for release approval and inputs. Check and build the complete
Netlify artifact, preserving current data and release assets:

```bash
node ./scripts/restore-health-snapshot.mjs
node ./scripts/prepare-netlify-site-deploy.mjs
npm ci
npm run check
npm --workspace portal test
npm run build:netlify
```

After explicit production approval, use the guarded helper. It verifies a draft
before publishing the same prebuilt artifact and verifies production afterward:

```bash
npm run deploy:production
```

Milestone 0 smoke endpoints:

```text
/api/portal/auth-smoke
/api/portal/db-smoke
```

Both require a Clerk bearer token.
