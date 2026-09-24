# Local Read-Only Integration (B1)

Updated 2026-09-24. Read-only checkpoint on `codex/web-portal-redesign`; not pushed or deployed. Signed-in reads and populated UI checks pass against an isolated account snapshot. Production was read only for the approved snapshot; no production writes/migrations, deployment, feature activation, or Mac changes were made.

## Boundaries

- `/app/integration/` uses Clerk and real API reads. `/app/preview/` remains sample-only.
- Skills, owned/shared set summaries, profile, and existing set detail are connected. Set counts come from summaries; items are fetched only on detail navigation.
- Editing, Favorites/membership changes, device controls, profile changes, and private sources are not enabled. Unknown device/source state is not presented as disconnected.
- Detail uses the redesigned set layout with lazy API reads, validated metadata, cancellation, loading/error/retry states and disabled mutations. `/app/connect` and existing production routes are unchanged.
- Account identity/session changes remount the controller; cancelled requests cannot deliver stale results. Cache, focus refresh, manual refresh, and profile editing are B2.
- The local client and Vite proxy allow only GET for synced-skills, groups, shared, profile, and individual group detail. Non-GET and unrelated endpoints are blocked. **GET still reconciles users in the backend**, so this is not safe against production data.

## Environment Gate

The guarded page is available at http://127.0.0.1:5174/app/integration/. Development Clerk sign-in and authenticated reads are verified in Chrome against the isolated local database.

Before enabling access, verify the local function server's actual resolved database is disposable/non-production, its schema is current, and its Clerk secret belongs to the same development instance as the browser key. Do not inherit a linked production site's environment or permit the backend to fall back to Netlify's production database. Use synthetic data by default; account-scoped snapshots require explicit approval and the safeguards below.

Configuration (local ignored environment only, never commit secrets):

| Setting | Requirement |
| --- | --- |
| `VITE_PORTAL_INTEGRATION` | `1`, supplied by `dev:integration` |
| `VITE_CLERK_PUBLISHABLE_KEY` | Verified development `pk_test_` key |
| `VITE_SKILLGROUPS_WEB_ENABLED` | `1` locally; no production flag change |
| `PORTAL_TEST_API_ORIGIN` | Explicit local function server origin, e.g. `http://127.0.0.1:8888`; not the frontend port |
| `PORTAL_TEST_ENVIRONMENT_VERIFIED` | `1` only after inspecting the backend credentials/database routing |

The last setting is an operator acknowledgement, **not an automated proof of database isolation**. Missing/unverified configuration blocks both sign-in and proxy access; there is no production fallback. The local function server also needs its existing backend web gate and verified development credentials.

## Local Backend Setup

- Worktree: `/private/tmp/omgskills-web-portal-redesign`.
- Disposable PostgreSQL 16 database: `omgskills_portal_b1`, data directory `/private/tmp/omgskills-portal-b1.MhPXC3/data`. All nine repository migrations applied; one development account plus the approved metadata snapshot described below.
- Database accepts a Unix socket only, in an owner-only directory; TCP is disabled. Existing PostgreSQL services are unchanged.
- Ignored operator scripts/config are in `.netlify/portal-integration/`. `setup.mjs` refuses to overwrite an existing database. `server.mts` runs the five existing portal GET handlers at `127.0.0.1:8888`, validates the exact database name/data directory through the application's `getPgPool()`, and rejects writes, unrelated paths, unexpected hosts, and non-development Clerk keys. This is a local handler harness, not verification of Netlify routing/runtime.
- Backend starts with a clean environment and the explicit local database override. No linked Netlify site or managed-database environment is loaded.
- Development keys are stored in ignored, owner-only `.netlify/portal-integration/clerk.env`. Clerk accepted the secret; backend and frontend JWKS matched, confirming the same development instance. No Clerk settings or credentials were created/changed. Do not substitute production credentials.
- Backend runs with the verified development credentials. The ignored `frontend.mjs` launcher passes only the public key and local flags to Vite, with verified origin `http://127.0.0.1:8888`; no backend secret is inherited by Vite.

Backend restart, from the worktree (stop the existing local server first):

```sh
env -i HOME="$HOME" USER="$USER" PATH=/opt/homebrew/opt/node/bin:/usr/bin:/bin \
  node --env-file=.netlify/portal-integration/database.env \
  --env-file=.netlify/portal-integration/clerk.env --import tsx \
  .netlify/portal-integration/server.mts
```

The secret must never be written into a `VITE_` variable or the frontend environment. The local database can be stopped without deleting it with `pg_ctl -D /private/tmp/omgskills-portal-b1.MhPXC3/data stop -m fast` using `/opt/homebrew/opt/postgresql@16/bin/pg_ctl`.

Frontend restart from the worktree root (stop the existing port-5174 server first):

```sh
env -i HOME="$HOME" PATH=/opt/homebrew/opt/node/bin:/usr/bin:/bin \
  node .netlify/portal-integration/frontend.mjs
```

The launcher sets `PORTAL_TEST_ENVIRONMENT_VERIFIED=1` for this verified local environment only. Recheck isolation before reusing it for another environment. Use Node supported by Vite (20.19+ or 22.12+).

## Verification

- B2 account/refresh checkpoint: Home account settings opens Clerk Development settings; manual refresh retains the populated UI. Refresh uses a 15-minute per-tab cache scoped to Clerk instance/user/session, deduplicates overlapping requests, and coalesces focus events for five seconds. Temporary errors preserve data; 401/403 clear it. Sign-out/account changes cancel reads and remove old cache entries. Automated suite: 44 passing; production build passes. Browser sign-out and second-account switch checks remain pending while profile work continues.

- 33 portal tests pass, including eight new tests for gates, read allowlists, summary adapters, cancellation, invalid responses, and disabled/unavailable UI states.
- Production build passes with a non-secret test publishable-key placeholder, the web gate on, and both local opt-in flags on. Authenticated production code remains included; local preview/integration entries are excluded. The legacy production detail component is unchanged.
- Browser: blocked integration entry works and the existing sample preview still renders. Direct GET/PATCH probes return 503 before proxying while unverified.
- Local backend: allowed GET without Clerk configuration returned 503; after configuration, unsigned GET returns 401. PATCH and `/api/portal/devices` return 405 through both backend and Vite proxy. Startup verified the exact local database identity and critical auth columns through `getPgPool()`. Portal tests re-run after database setup: 33 passing.
- Chrome: development sign-in succeeded. Empty account initially loaded after Retry; after import, authenticated reads and reload succeed. The initial generic load error has not been reproduced or attributed to a confirmed cause.
- Populated browser checks: 122 grouped skills from 166 current installs; search, no-results/clear, Codex filter (82 logical rows), two-install skill details, owned set summary/detail (two items), Agents and missing-handle Home all render. Mutation controls remain disabled/hidden. Desktop and 390px mobile Skills have no document overflow; mobile navigation opens and closes on selection. Portal tests re-run: 33 passing.
- Redesigned real set detail verified with two items, expandable descriptions, direct reload, one page heading/main landmark, and no document overflow at desktop/390px mobile. All 37 portal tests pass, including detail roles/order, malformed responses, stale-read cancellation and read-only owner controls; production build passes. The current API omits physical item IDs, so the adapter leaves them null rather than matching by name. Account switching/sign-out are not wired in the new Home yet (B2).

```sh
npm --workspace portal test
```

Root-level alternative: `TSX_TSCONFIG_PATH=portal/tsconfig.json node --import tsx --test portal/tests/*.test.ts` (needed for the UI tests' path aliases).

Remaining checks: two-account isolation/switch/sign-out after B2 wiring, shared detail with a separate isolated fixture, and slow/cancelled browser reads (unit coverage exists). Keep profile edits and set mutations for B2/C; do not call B1 fully verified yet.

## Approved Account Snapshot

- One-time, user-approved copy of the signed-in account's skill metadata and owned sets; this is not a live production connection. Further production reads need their own scope approval.
- Ignored operator helper: `.netlify/portal-integration/account-snapshot.mjs`. Verifies the Netlify account/site, uses the managed `netlifydb_readonly` credential and a repeatable-read, read-only transaction, and matches exactly one source user to the local signed-in email. Source credentials/data remain in process memory, with no snapshot export file.
- Imported 166 current installs, two historical installs referenced by the set, one owned set and two items. No shared sets were present. Counts describe this snapshot, not permanent assertions.
- No source user/profile row, invitations, tokens, private-source credentials, sources or release pins copied. Local ownership is remapped to the development account; set items are metadata-only. Home's missing handle is expected because profile data was excluded.
- Import verifies the exact local database/data directory, refuses existing skill/set data, and commits all imported rows together. Browser handlers retain their local-only database configuration and never receive source credentials.
