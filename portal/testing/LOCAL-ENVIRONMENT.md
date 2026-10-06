# Unified App Local Test Environment

This replaces the removed September temporary database/harness. It does not
restore its users, snapshots, or credentials, and does not connect to production.
The implementation worktree remains `/private/tmp/omgskills-unified-app-preview`.

## Scope

- PostgreSQL 16, named `omgskills_unified_test`, private Unix socket only, peer
  authentication, owner-only directories. No TCP listener or managed DB fallback.
- All repository migrations apply transactionally; a checksum ledger prevents
  silently reapplying changed migrations. Setup refuses an existing data directory.
- Existing account handlers are reused behind an exact allowlist. Default
  `backend` mode allows reads of synced skills, owned/shared groups, group detail,
  and profile. Explicit `backend-write` mode additionally allows private set
  creation/rename and single installed-skill membership changes, including public
  Favorites. Profile, sharing/access changes, set deletion, reordering, bulk
  additions, private GitHub, device pairing, and uploads remain blocked.
- GET handlers reconcile the signed-in user in the **local** database; read-only
  means no skill/set/profile edit endpoints, not zero internal database writes.
- Backend starts with a clean environment and verifies its actual database path,
  name, socket and TCP settings before serving. Both development Clerk keys must
  resolve to the same JWKS. Production keys are rejected.
- Frontend receives only the public key, never the secret or database settings.
- No fixture account is silently substituted when authentication is unavailable.

## Commands

Run from the implementation worktree using Node 20.19+ and installed dependencies:

```sh
node portal/testing/local-environment-cli.mjs setup
node portal/testing/local-environment-cli.mjs status
node portal/testing/local-environment-cli.mjs backend
# Or, for the approved local Favorites/private Sets checks (not both at once):
node portal/testing/local-environment-cli.mjs backend-write
# In a second process, after the backend is verified:
node portal/testing/local-environment-cli.mjs frontend
```

`setup` creates `.netlify/portal-integration/clerk.env` with empty fields and 0600
permissions. Supply `VITE_CLERK_PUBLISHABLE_KEY=pk_test_...` and
`CLERK_SECRET_KEY=sk_test_...` from the same Clerk development instance there.
Never put secrets in chat, source control, screenshots, or a `VITE_` secret field.

`start-db` / `stop-db` only affect this cluster. `migrate` safely resumes after an
interrupted setup and applies new migrations to the verified local cluster.
Database files and keys are ignored. Removing this temporary worktree loses them;
the tracked scripts reproduce an empty environment, not an account backup.

Backend: `http://127.0.0.1:8890`. Reserved frontend: `http://127.0.0.1:5191`.
The existing unified sample preview on port 5190 is unchanged. The authenticated
unified UI is at `http://127.0.0.1:5191/app/integration/unified/` and uses the same
development login. The older `/app/integration/` route remains available; its
edit controls may exceed this backend's allowlist and should not be used to test
this slice. Use the unified route; it hides unconnected controls. In read-only
backend mode, attempted set edits are rejected, never redirected to production.

### Favorites / Private Sets Checkpoint

- 179 tests and the production build pass. Unauthenticated mutations are rejected;
  sharing, profile and other out-of-scope writes remain blocked in write mode.
- Owner/outsider/anonymous SQL access checks passed and rolled back.
- 2026-10-06: repaired the two catalog fixture installs to the verified
  `anthropics/skills:skills/frontend-design` identity. `seed` now resolves that
  release before inserting; `repair` updates only the two recorded catalog
  fixture IDs and leaves private skills/sets unchanged. Real catalog/GitHub
  resolution and `addGroupItemWithClient` passed with a pinned release; duplicate
  rejection and private metadata-only behavior passed. Verification writes were
  rolled back. This is backend coverage, not signed-in browser verification.
- User confirmed adding Test design skill succeeds in the signed-in local app
  on 2026-10-06. Remaining browser checks include create/rename/remove, Favorites,
  reload persistence, mobile, error handling and logout/account switching.
  Temporary local skill fixtures are seeded; use
  `node --import tsx portal/testing/unified-account-fixture.mts cleanup`
  after checking and removing only the explicitly created test sets/items.
- Public Favorites confirmation describes production semantics; this test's writes
  are only in the private local PostgreSQL cluster, not the live website.

## Verification

```sh
npm --workspace portal test
node --import tsx portal/testing/local-access-check.mts
```

The SQL check verifies the target first, tests owner/outsider/anonymous group
access, and rolls back all fixture records. It is not a Clerk authentication test.
Real login, logout and browser account switching require supplied development
keys and a signed-in development account. Never mark those passed from mocks.

### Recovery Checkpoint: 2026-10-05

- Verified actual database name/directory/socket, TCP disabled, nine migrations,
  zero users and zero skills before browser sign-in. PostgreSQL, the read-only
  HTTP backend (8890), and the integration frontend (5191) are running locally.
- 174 portal tests passed, including environment/guard and unified account policy tests.
- Actual SQL owner/outsider/anonymous access checks passed; test records rolled back.
- Direct calls to the four existing handlers returned 401 without authentication.
- Backend TypeScript syntax checked. The previous development key pair was
  recovered from the September setup sessions and restored to the ignored 0600
  configuration. Clerk accepted the secret; browser/server JWKS matched. No key
  values were displayed. HTTP startup passed. Unsigned skill reads return 401 and
  group creation, profile edits, and token generation return 405 through both the
  backend and frontend proxy. The browser displays Clerk's development-mode
  sign-in modal. User completed development sign-in; the browser loaded the empty
  Skills view and a manual account refresh completed without error. Verified the
  isolated database now contains one user and zero skills. The new unified UI
  passed authenticated reads/refresh, local search, agent filters, grouped skill
  rows and details at 1440px and 390px. Three temporary installs were added using
  `unified-account-fixture.mts seed` and removed using its `cleanup` command; zero
  skills verified afterward. Actual sign-out cleared private content and returned
  to live Discover. Anonymous private links were sanitized. Browser account
  switching remains untested; no production records were imported.
- The initial sandbox shared-memory denial required elevated local execution.
  macOS PostgreSQL also required `LC_ALL=C`, now set by the clean launcher.
- User confirmed the local unified experience works on 2026-10-05.
- Existing port-5190 preview untouched. No push, deployment, or production
  database/account changes as part of this checkpoint.
