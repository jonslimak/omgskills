# Local Portal Integration (B1-C2)

Updated 2026-09-24. Local checkpoints on `codex/web-portal-redesign`; not pushed or deployed. Signed-in reads, account controls and profile editing pass against an isolated account snapshot. Production was read only for the approved snapshot; no production writes/migrations, deployment, feature activation, or Mac changes were made.

## Boundaries

- `/app/integration/` uses development Clerk, real API reads and isolated profile/basic-set saves. `/app/preview/` remains sample-only.
- Skills, owned/shared set summaries, profile, and existing set detail are connected. Set counts come from summaries; items are fetched only on detail navigation.
- Home supports account settings, sign-out, handle edits and publication on/off. Sets supports empty private creation, owner details/visibility, Hide/Restore and confirmed deletion. All writes stay in the isolated database. Favorites identity is protected; membership, ordering, allowed emails, device controls and private sources remain disabled.
- Detail uses the redesigned set layout with lazy API reads, validated metadata, cancellation and loading/error/retry states. Only authorized owners receive basic-set controls; item/access controls remain read-only. `/app/connect` and existing production routes are unchanged.
- Account identity/session changes remount the controller; cancelled reads/saves cannot deliver stale results. A 15-minute per-tab cache is scoped to Clerk instance/user/session. Focus/visibility and manual refresh deduplicate requests; transient errors preserve usable data, while 401/403 and sign-out clear it.
- The local proxy/backend allow required GETs, profile PATCH, groups POST, group PATCH/DELETE and moderation PATCH. The harness also validates bodies: create must be empty/private, updates cannot modify membership/access. All unrelated endpoints remain blocked. **GET still reconciles users in the backend**, so this is not safe against production data.

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
- Ignored operator scripts/config are in `.netlify/portal-integration/`. `setup.mjs` refuses to overwrite an existing database. `server.mts` runs the existing handlers at `127.0.0.1:8888`, using `isIntegrationRequest` and `isIntegrationBody` for the narrow C2 allowlist. It validates the exact database name/data directory through the application's `getPgPool()` and rejects unrelated paths/bodies, unexpected hosts/origins, oversized bodies and non-development Clerk keys. This is a local handler harness, not verification of Netlify routing/runtime.
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

- C2: 61 portal tests and 19 backend access/behavior/endpoint tests pass; root typecheck and production build pass. Covers command payloads, double-submit/profile conflicts, stale reads/account disposal, authorization and validation errors, confirmed-write/failed-refresh handling, protected Favorites and shared controls. Production bundles exclude both local entries even with opt-in flags set.
- C2 browser: disposable set created private/empty; rename/description, all three visibility states, Hide/Restore without visibility changes, duplicate-slug error with retained draft, confirmed delete and reload pass. Detail/dialog fit at 390px. Disposable set removed; `my faves` and installed skills were not modified. Simulated network/account races have automated coverage, not browser fault-injection coverage.
- C2 safety probes through API and Vite: unsigned basic-set writes return 401; items, allowed emails, devices and sync-upload remain 405. The local harness uses the committed body guard as well as the route allowlist.

- C1: 52 portal tests and 21 backend access/endpoint tests pass; root typecheck and production build pass. Both item read endpoints expose physical skill IDs only to owners and return no-store responses. Owner email-record IDs survive the adapter/cache; older responses remain supported. The email DELETE handler now accepts its existing ID-only request contract.
- C1 SQL checks passed against the verified isolated database: owner/invited/public reads, deletion by email ID, and denial after access removal. All temporary fixture writes were rolled back; the imported set was unchanged. Authentication was supplied by test dependencies, so these checks do not replace the pending real second-account browser test. Set writes remain blocked in the local proxy/harness.

- B2: 49 portal tests pass; typecheck/production build passes. Tests cover cache expiry/isolation, deduplicated refresh, cancelled/stale reads and saves, validation/access/server errors, publication preservation, authoritative returned URLs, and the exact profile-only write allowlist.
- Browser: account settings opens Clerk Development settings without changing them; manual refresh retains populated data. Session-scoped sign-out removes private UI; Google sign-in restores the same account with 122 skills and one set. Second-account switching remains unverified.
- Browser profile checks: reserved handle rejected inline without losing the draft; handle onboarding/normalization and later rename succeed; publication survives rename, then turns off and stays off after reload. The local test handle is `local-b2-verified`, unpublished. Profile dialog fits at 390px. Returned URLs use the local backend origin; the public-page renderer is not served by this harness or verified here.
- Safety probes through both backend and Vite: unauthenticated profile PATCH returns 401; group writes, profile POST, sync-upload and devices remain 405. Production build still excludes both local entries with their opt-in flags on. No production write or release change.

### Earlier B1 Checks

- 33 portal tests pass, including eight new tests for gates, read allowlists, summary adapters, cancellation, invalid responses, and disabled/unavailable UI states.
- Production build passes with a non-secret test publishable-key placeholder, the web gate on, and both local opt-in flags on. Authenticated production code remains included; local preview/integration entries are excluded. The legacy production detail component is unchanged.
- Browser: blocked integration entry works and the existing sample preview still renders. Direct GET/PATCH probes return 503 before proxying while unverified.
- Local backend: allowed GET without Clerk configuration returned 503; after configuration, unsigned GET returns 401. PATCH and `/api/portal/devices` return 405 through both backend and Vite proxy. Startup verified the exact local database identity and critical auth columns through `getPgPool()`. Portal tests re-run after database setup: 33 passing.
- Chrome: development sign-in succeeded. Empty account initially loaded after Retry; after import, authenticated reads and reload succeed. The initial generic load error has not been reproduced or attributed to a confirmed cause.
- Populated browser checks: 122 grouped skills from 166 current installs; search, no-results/clear, Codex filter (82 logical rows), two-install skill details, owned set summary/detail (two items), Agents and missing-handle Home all render. Mutation controls remain disabled/hidden. Desktop and 390px mobile Skills have no document overflow; mobile navigation opens and closes on selection. Portal tests re-run: 33 passing.
- Redesigned real set detail verified with two items, expandable descriptions, direct reload, one page heading/main landmark, and no document overflow at desktop/390px mobile. All 37 portal tests passed, including detail roles/order, malformed responses, stale-read cancellation and read-only owner controls; production build passed. B1 left physical IDs unknown; C1 subsequently added explicit owner-only mappings, retaining null for older responses. B2 added account controls.

```sh
npm --workspace portal test
```

Root-level alternative: `TSX_TSCONFIG_PATH=portal/tsconfig.json node --import tsx --test portal/tests/*.test.ts` (needed for the UI tests' path aliases).

Remaining checks: real two-account isolation/switch, shared detail with a separate isolated fixture, and slow/cancelled browser reads (unit coverage exists). Membership/Favorites/bulk actions belong to C3; allowed emails/link behavior to C4. Do not call Slice B/C fully end-to-end verified yet.

## Approved Account Snapshot

- One-time, user-approved copy of the signed-in account's skill metadata and owned sets; this is not a live production connection. Further production reads need their own scope approval.
- Ignored operator helper: `.netlify/portal-integration/account-snapshot.mjs`. Verifies the Netlify account/site, uses the managed `netlifydb_readonly` credential and a repeatable-read, read-only transaction, and matches exactly one source user to the local signed-in email. Source credentials/data remain in process memory, with no snapshot export file.
- Imported 166 current installs, two historical installs referenced by the set, one owned set and two items. No shared sets were present. Counts describe this snapshot, not permanent assertions.
- No source user/profile row, invitations, tokens, private-source credentials, sources or release pins copied. Local ownership is remapped to the development account; set items are metadata-only. Home initially had no handle because profile data was excluded; B2 created a local test handle.
- Import verifies the exact local database/data directory, refuses existing skill/set data, and commits all imported rows together. Browser handlers retain their local-only database configuration and never receive source credentials.
