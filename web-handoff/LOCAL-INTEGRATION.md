# Local Portal Integration (B1-E)

Updated 2026-09-25. This document preserves local integration checkpoints against the isolated account snapshot. The redesign has since landed on main and shipped at `/app/`, with a separately approved disposable production set test and no Mac release changes. See IMPLEMENTATION.md, Public Rollout, for live verification and deployment receipts. Earlier no-deploy/no-production-write notes describe their individual checkpoints.

## Boundaries

- `/app/integration/` uses development Clerk, real API reads and isolated profile/set/membership/email-access saves. `/app/preview/` remains sample-only.
- Skills, owned/shared set summaries, profile, and existing set detail are connected. Set counts come from summaries; items are fetched only on detail navigation.
- Home supports account settings, sign-out, handle edits and publication on/off, plus private-source registration/snapshots through the local GitHub substitute. Sets supports private creation (empty or selected skills), owner details/visibility, Hide/Restore and confirmed deletion. Skills supports membership, public Favorites and sequential bulk adds; owner detail supports add/remove/reorder and email-access management. Agents loads real connected devices, confirmed revocation and local connection-code/legacy-token generation. All writes stay in the isolated database. Favorites identity is protected; real private GitHub access remains disabled.
- Detail uses the redesigned set layout with lazy API reads, validated metadata, cancellation and loading/error/retry states. Only authorized owners receive set/item/email controls. Emails grant read-only access to active Invite-only sets; none are sent. Copy link always stays on localhost here. `/app/connect` and existing production routes are unchanged.
- Account identity/session changes remount the controller; cancelled reads/saves cannot deliver stale results. A 15-minute per-tab cache is scoped to Clerk instance/user/session. Focus/visibility and manual refresh deduplicate requests; transient errors preserve usable data, while 401/403 and sign-out clear it.
- The local proxy/backend allow required GETs, profile PATCH, groups POST, group PATCH/DELETE, moderation PATCH, items POST/PATCH/DELETE and allowed-emails POST/DELETE. Body guards permit private selected-skill creation, explicit public Favorites creation, synced-item add/removal/reorder, and email/emailId-only access changes. Direct catalog/GitHub item creation and unrelated endpoints remain blocked. **GET still reconciles users in the backend**, so this is not safe against production data.
- Resolved synced skills retain existing catalog/GitHub publication validation. Those public reads may create release records only in the isolated database; errors are surfaced, never bypassed. Unresolved/local skills remain metadata-only.
- D1 additionally allows device-list GET and bodyless DELETE for a specific device UUID. Devices load independently on Agents, stay memory-only and clear on account/page changes.
- D2 allows only empty POST bodies to `/api/portal/sync-pairing-code` and `/api/portal/sync-token`. Device exchange, sync upload and callback/scopes input remain blocked. Never paste local codes into the installed app. Codes are not cached/logged; closing clears the UI, not the server record or clipboard.
- D3 allows private-source GET/POST (only installationId, repositoryId, root) and bodyless POST to a source UUID's releases endpoint. Package downloads, source deletion and real GitHub setup are not enabled. Private snapshots are not app/GitHub releases.

## Environment Gate

The guarded page is available at http://127.0.0.1:5174/app/integration/. E also enables normal-route review at http://127.0.0.1:5174/app/ on the same server/backend. Development Clerk sign-in and authenticated reads were verified in Chrome through the integration route; fresh signed-in normal-route verification remains for the final pass.

Before enabling access, verify the local function server's actual resolved database is disposable/non-production, its schema is current, and its Clerk secret belongs to the same development instance as the browser key. Do not inherit a linked production site's environment or permit the backend to fall back to Netlify's production database. Use synthetic data by default; account-scoped snapshots require explicit approval and the safeguards below.

Configuration (local ignored environment only, never commit secrets):

| Setting | Requirement |
| --- | --- |
| `VITE_PORTAL_INTEGRATION` | `1`, supplied by `dev:integration` |
| `VITE_CLERK_PUBLISHABLE_KEY` | Verified development `pk_test_` key |
| `VITE_SKILLGROUPS_WEB_ENABLED` | `1` locally; no production flag change |
| `VITE_PORTAL_REDESIGN_ENABLED` | `1` in the ignored local launcher; combined builds derive it from tracked `portalRedesignEnabled` (currently false), overriding ambient values |
| `PORTAL_TEST_API_ORIGIN` | Explicit local function server origin, e.g. `http://127.0.0.1:8888`; not the frontend port |
| `PORTAL_TEST_ENVIRONMENT_VERIFIED` | `1` only after inspecting the backend credentials/database routing |

The last setting is an operator acknowledgement, **not an automated proof of database isolation**. Missing/unverified configuration blocks both sign-in and proxy access; there is no production fallback. The local function server also needs its existing backend web gate and verified development credentials.

## Local Backend Setup

- Worktree: `/private/tmp/omgskills-web-portal-redesign`.
- Disposable PostgreSQL 16 database: `omgskills_portal_b1`, data directory `/private/tmp/omgskills-portal-b1.MhPXC3/data`. All nine repository migrations applied; one development account plus the approved metadata snapshot described below.
- Database accepts a Unix socket only, in an owner-only directory; TCP is disabled. Existing PostgreSQL services are unchanged.
- Ignored operator scripts/config are in `.netlify/portal-integration/`. `setup.mjs` refuses to overwrite an existing database. `server.mts` runs the existing handlers at `127.0.0.1:8888`, using `isIntegrationRequest` and `isIntegrationBody` for the narrow D3 allowlist, including devices, code generation and simulated private-source handlers. It validates the exact database name/data directory through the application's `getPgPool()` and rejects unrelated paths/bodies, unexpected hosts/origins, oversized bodies and non-development Clerk keys. Item/email DELETE must parse its `itemId`/`emailId` body; device DELETE and private snapshot POST have no body. This is a local handler harness, not verification of Netlify routing/runtime.
- D3 injects `portal/testing/private-source-broker.ts` into the existing private-source/release handlers with real development Clerk auth and isolated SQL. No default Broker dependencies are used; any `OMGSKILLS_GITHUB_BROKER_*` environment variable stops startup. The substitute has no usable key or network fallback. On recreation, retain these explicit dependencies and reject package/device methods; enabling routes alone is unsafe. Synthetic binding: `local-github-simulation`, installation `930000001`, repository `930000003`. Allowed roots: `.`, `skills/design-review`, `.claude/skills/Design`. Only that binding was seeded; registration is an explicit user action.
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

- E manual, 2026-09-25: user reported the two-account test at `/app/` passed: Invite-only access granted, recipient can view but not edit, and access denied after removal and refresh. This closes the real shared-access checkpoint left open in B-D; it does not verify deployed pages, real GitHub or Mac callbacks, or same-browser account switching.
- E: 131 portal tests, root typecheck and four production build combinations pass. The redesign is opt-in, separate from web/Mac gates. Shared controller checks use fixture responses at 1440/1024/390/320px; actual signed-out normal routes and the existing connect sign-in page pass on port 5174. No real callback was launched. Test builds use a placeholder Clerk public key and are not deploy artifacts.
- E shares the authenticated controller without sharing test transport: local guards/proxy/simulated Broker remain local. Integration, local normal-route and production caches are separate. Local warnings remain in local mode; normal mode retains error/recovery messages and uses canonical sharing where eligible. Install requires a validated server link plus the Mac gate and is always suppressed locally. Production builds may now contain reusable controllers formerly exclusive to `integration/`; fixture data, the local bootstraps and simulated services remain excluded.

- D4: 125 portal tests and 53 targeted backend tests pass; root typecheck and normal/flag-enabled production builds pass. Both local entries and test fixtures stay absent from production bundles. Checks cover independent web/Mac gates, production install-button wiring, connect fragment/route boundaries and blocked local exchange/upload/package paths. No feature flags or application behavior changed.
- D4 browser: five screens at 1440/1024/390/320px, mobile navigation, back/forward/reload, shared/denied detail, late reads and empty/loading/error/long-content states pass using fixture data. D2 dialogs pass containment/clipping, masked values, mode/close clearing, focus trapping, Escape and focus return. The runner uses the integration entry's stylesheet order and blocks external/API requests. This completes D2 visual verification, not real Mac pairing.
- D4 isolated SQL: owner/invited/outsider/anonymous access, public/private/restricted/hidden states and access removal pass through the real policy helper. Fixture users/set are created inside a transaction, rolled back and verified absent. No existing user-created records changed. These supplied actors do not replace two real Clerk browser accounts.

- D3: 119 portal tests and 35 backend private-source/release/Broker tests pass; root typecheck and normal/flag-enabled production builds pass. Production bundles exclude the integration and simulated Broker. Covers strict response parsing, root/path preservation, allowed IDs, concurrent writes, confirmed-write/read failure, uncertain outcomes, abort/account changes and 401/403 clearing. Component browser checks pass at 1440/390/320px with no overflow or runtime errors, including register/snapshot and empty/disconnected/error states. These browser checks use fixture responses, not signed-in end-to-end auth.
- D3 SQL/handler checks passed against the verified isolated database: duplicate registration and identical snapshots reuse IDs; foreign owners, ungranted repositories and invalid roots fail; revoked/rate-limited grants return 502/503. Automated test writes rolled back; only the synthetic installation binding was seeded. User then completed registration and snapshot creation in the signed-in local UI. Read-only SQL confirmed `local-github-simulation/skills`, root `.`, and one saved release; these user-created test records remain. Unsigned source reads and bodyless snapshot POST return 401 through Vite; private package GET remains 405. Real GitHub remains unverified and needs separate approval.

- D2: 108 portal tests, root typecheck and normal/flag-enabled production builds pass. Tests cover explicit/duplicate generation, mode changes, disposal, late responses, malformed credentials, server-derived expiry, delayed timers, clipboard failure/completion races, 429 and 401/403. Local connection code remains excluded from production bundles.
- D2 manual: user reported both code modes and close/reopen clearing green. SQL verified exactly one unused pairing code and one unused legacy token with ten-minute expiry and hashed storage; both explicitly identified test rows removed, zero devices created. API/proxy probes confirm unsigned generation is 401 and scopes/exchange/upload/private-source requests are 405. D4 completed automated desktop/mobile screenshots with fixture responses. Expiry/race/clipboard-failure checks are automated, not live fault-injected. No end-to-end Mac pairing tested.

- D1: 98 portal tests and eight backend device-auth tests pass; root typecheck and normal/flag-enabled production builds pass. Covers status/response validation, duplicate-request prevention, stale-list recovery, confirmed revocation with failed refresh, unknown outcomes, account disposal and 401/403 clearing. Production excludes the local device panel.
- D1 browser: four disposable device records covered active/inactive/expired/revoked statuses, Never last-active, cancel/confirm, opening another confirmation, reload persistence, empty state and 390px layout. SQL confirmed only the selected fixture was revoked; an unrelated owner could not revoke it. All four fixture records were removed by exact IDs/owner/name; user-created sets were left alone. No real Mac pairing or production device operations. Both local API/proxy return 401 for unsigned device reads/revocation and 405 for pairing/token/private-source requests. Real second-account browser switching remains unverified.
- C4 user manual testing passed after the implementation checkpoint below.

- C4: 89 portal tests and 34 backend access/behavior/endpoint/public-route tests pass; root typecheck and production builds pass, including exclusion of local entries with flags enabled. Covers normalized/duplicate emails, ID-only removal, owner/shared/Favorites boundaries, missing records, malformed responses, save serialization, account disposal, unknown outcomes and confirmed-write/failed-refresh behavior. Link eligibility and clipboard rejection have automated coverage.
- C4 browser: a disposable set passed normalized add, duplicate error with retained draft, Public/Only-me/Invite-only transitions, remove cancellation/confirmation, reload persistence, actual localhost clipboard URL and 390px layout without overflow. Isolated SQL confirmed the test email could read but not manage, lost access under Only me, and lost access after removal. These policy probes use a supplied test actor, not a second Clerk browser session. Disposable set deleted; original set/skills fingerprint unchanged. No invitation email sent; public-page rendering remains outside this harness.

- C3: 76 portal tests and 26 backend access/behavior/endpoint/publication tests pass; root typecheck and production build pass. Covers physical-ID grouping, one representative per add, all-matching membership removal versus exact item removal, sequential partial batches, conflicts, unknown outcomes, complete mixed-item reorder, transactional creation, Favorites creation/races, account disposal/access denial and confirmed-write/failed-refresh behavior. No mutation is automatically replayed.
- C3 browser: disposable Claude/Codex pair and local skills passed selected creation, adding/removing, ordering, membership checks/toggles, Favorites disclosure/star/unstar, duplicate-safe bulk add, reload and 390px dialog/overflow checks. Temporary set/Favorites/skills removed; original set and skills fingerprint exactly unchanged. First Favorites creation and resolved GitHub publication have controlled automated coverage, not live browser coverage. Partial failures and account races were not browser fault-injected.

- C2: 61 portal tests and 19 backend access/behavior/endpoint tests pass; root typecheck and production build pass. Covers command payloads, double-submit/profile conflicts, stale reads/account disposal, authorization and validation errors, confirmed-write/failed-refresh handling, protected Favorites and shared controls. Production bundles exclude both local entries even with opt-in flags set.
- C2 browser: disposable set created private/empty; rename/description, all three visibility states, Hide/Restore without visibility changes, duplicate-slug error with retained draft, confirmed delete and reload pass. Detail/dialog fit at 390px. Disposable set removed; `my faves` and installed skills were not modified. Simulated network/account races have automated coverage, not browser fault-injection coverage.
- C2 safety probes through API and Vite: unsigned basic-set writes return 401; items, allowed emails, devices and sync-upload remain 405. The local harness uses the committed body guard as well as the route allowlist.

- C1: 52 portal tests and 21 backend access/endpoint tests pass; root typecheck and production build pass. Both item read endpoints expose physical skill IDs only to owners and return no-store responses. Owner email-record IDs survive the adapter/cache; older responses remain supported. The email DELETE handler now accepts its existing ID-only request contract.
- C1 SQL checks passed against the verified isolated database: owner/invited/public reads, deletion by email ID, and denial after access removal. All temporary fixture writes were rolled back; the imported set was unchanged. Authentication was supplied by test dependencies, so these checks do not replace the pending real second-account browser test. Set writes remain blocked in the local proxy/harness.

- B2: 49 portal tests pass; typecheck/production build passes. Tests cover cache expiry/isolation, deduplicated refresh, cancelled/stale reads and saves, validation/access/server errors, publication preservation, authoritative returned URLs, and the exact profile-only write allowlist.
- Browser: account settings opens Clerk Development settings without changing them; manual refresh retains populated data. Session-scoped sign-out removes private UI; Google sign-in restores the same account with 122 skills and one set. Second-account switching remains unverified.
- Browser profile checks: reserved handle rejected inline without losing the draft; handle onboarding/normalization and later rename succeed; publication survives rename, then turns off and stays off after reload. At B2 verification the test handle was `local-b2-verified`, unpublished; the user subsequently changed it to `jonslimak`, published. Profile dialog fits at 390px. Returned URLs use the local backend origin; the public-page renderer is not served by this harness or verified here.
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

Remaining checks: same-browser account switching (automated isolation/race coverage exists); deployed public-page navigation; first Favorites creation and resolved-skill publication against live public sources (controlled automated coverage exists). Real two-account shared access passed at E (user-reported). Shared/denied fixture rendering and slow/cancelled browser reads passed D4. Real GitHub and Mac callbacks are outside the local checkpoint. Earlier counts, allowlists and open-check notes describe their checkpoint, not current permissions or verification status.

### Repeat D4 Checks

From the worktree, with a supported Node and local Playwright installation:

```sh
node portal/testing/d4-browser.mjs
```

Set `PLAYWRIGHT_MODULE` to an absolute Playwright entry point if it is not locally resolvable. The runner uses installed Chrome, starts/closes its own loopback server and writes ignored screenshots to `output/playwright/d4/`. No Clerk credentials are needed.

E reuses this runner with `PORTAL_BROWSER_REVIEW=app`, testing the shared account controller on normal routes with injected fixture responses; screenshots go to `output/playwright/e/`. Run `node portal/testing/verify-entry-builds.mjs` for the redesign/web/Mac build combinations and fixture exclusion. It finishes with the redesign off and a placeholder public key; rebuild through the guarded deployment process before any deployment.

SQL checks require the verified disposable database above. The script refuses other database names, TCP, non-development context or a different actual data directory:

```sh
env -i HOME="$HOME" USER="$USER" PATH=/opt/homebrew/opt/node/bin:/usr/bin:/bin \
  PORTAL_TEST_DATABASE_DIRECTORY=/private/tmp/omgskills-portal-b1.MhPXC3/data \
  node --env-file=.netlify/portal-integration/database.env --import tsx \
  portal/testing/d4-access.mts
```

## Approved Account Snapshot

- One-time, user-approved copy of the signed-in account's skill metadata and owned sets; this is not a live production connection. Further production reads need their own scope approval.
- Ignored operator helper: `.netlify/portal-integration/account-snapshot.mjs`. Verifies the Netlify account/site, uses the managed `netlifydb_readonly` credential and a repeatable-read, read-only transaction, and matches exactly one source user to the local signed-in email. Source credentials/data remain in process memory, with no snapshot export file.
- Imported 166 current installs, two historical installs referenced by the set, one owned set and two items. No shared sets were present. Counts describe this snapshot, not permanent assertions.
- No source user/profile row, invitations, tokens, private-source credentials, sources or release pins copied. Local ownership is remapped to the development account; set items are metadata-only. Home initially had no handle because profile data was excluded; B2 created a local test handle.
- Import verifies the exact local database/data directory, refuses existing skill/set data, and commits all imported rows together. Browser handlers retain their local-only database configuration and never receive source credentials.
