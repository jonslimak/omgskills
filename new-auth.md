# App <-> Portal Sync Auth - Device Credential Plan

Replaces per-sync token pasting with one-time pairing that yields a durable,
sync-scoped device credential. Updated 2026-07-12 against `main`.

Status legend: `todo` / `in progress` / `done` / `deferred`.

## Goal

- Clerk remains the portal account system.
- The Mac app receives no Clerk session and has no general account authority.
- The app stores one revocable credential scoped only to sync endpoints.
- Search, browse, and installation remain usable without an account.
- Pairing never uploads `SKILL.md` content.

## Execution Checklist

The identity prerequisites in `tiein.md` ID0.1, ID0.3, and ID0.4 are complete.
ID0.2 and ID0.5 may proceed independently and do not block this plan.

Implement and commit in these boundaries:

1. **AUTH1 - Device schema and token model** (`done`)
2. **AUTH2 - Exchange and device-auth backend** (`done`, depends on AUTH1)
3. **AUTH3 - Device upload and revocation** (`todo`, depends on AUTH2)
4. **AUTH4 - Mac credential and connection core** (`todo`, depends on AUTH2)
5. **AUTH5 - Manual one-time pairing** (`todo`, depends on AUTH3-AUTH4)
6. **AUTH6 - Portal connected-device management** (`todo`, depends on AUTH3)
7. **AUTH7 - Browser pairing** (`todo`, depends on stable AUTH5)
8. **AUTH8 - Migration, release, and production verification** (`todo`, depends
   on AUTH1-AUTH7 and `tiein.md` T5)
9. **AUTH9 - Remove legacy tokens** (`deferred`, requires an adoption cutoff)

AUTH3 and AUTH4 may proceed in parallel after AUTH2. Keep AUTH7 separate from
manual pairing so URL-scheme or browser-session issues cannot delay the durable
credential launch. Do not deploy any auth task until `tiein.md` T5 makes the
manual production deploy path safe.

## Current State

- A Clerk-authenticated portal user mints a random 10-minute token through
  `portal-sync-token.mts`.
- Only its SHA-256 hash is stored in `sync_tokens`.
- The user pastes the token into the Mac app.
- `portal-sync-upload.mts` locks the unused token, uploads skill metadata, marks
  it used, and commits those actions in one transaction.
- Every later sync requires another portal visit and token paste.
- No URL scheme, browser pairing flow, device credential, or Keychain storage
  exists yet.

The resolved-installation handoff and sync identity consistency work are already
committed. Auth changes must preserve those payload, stable-key, and dedupe
contracts.

## Security Model

The browser flow follows the external-user-agent, state, and PKCE principles in
[RFC 8252](https://www.rfc-editor.org/rfc/rfc8252) without turning omgskills into a
general OAuth provider.

There are three separate credential types:

1. **Legacy upload token** - existing unprefixed token, one use, 10 minutes,
   accepted only by the legacy upload path during migration.
2. **Pairing code** - `pair_` prefix, one use, 10 minutes, accepted only by
   `sync-exchange`. Browser-issued codes are bound to a PKCE-style challenge.
3. **Device credential** - `device_` prefix, reusable until revoked or expired,
   accepted only by explicitly device-authorized sync endpoints.

Never allow a challenge-bound pairing code to call `sync-upload` directly. That
would bypass the interception protection provided by the exchange verifier.

Opaque tokens remain 32 random bytes encoded as base64url. The server returns
plaintext only when issuing a credential and never persists it; the client retains
it only in Keychain and sends it in authenticated requests. Databases store only
SHA-256 hashes. A salted password hash is unnecessary for high-entropy random tokens.

## Completed Prerequisites

`done`

The required `tiein.md` identity work is committed and verified:

- sync accepts a resolved installation snapshot rather than rescanning internally
- Git- and SHA-resolved `catalogSkillId` values reach `synced_skills`
- a repeated `stableKey` upgrades the existing row instead of creating a duplicate
- auth changes do not alter payload identity or dedupe semantics

## Phase 1 - Manual One-time Pairing

The user still pastes a code, but only during initial connection.

### AUTH1 - Device schema and token model

`done`

Primary files:

- `netlify/database/schema.ts`
- a new additive migration under `netlify/database/migrations/`
- focused migration/schema tests using the repository's existing database path

Add `device_tokens`:

- `id`
- `userId` with `ON DELETE CASCADE`
- `tokenHash`, unique
- `deviceName`, validated and length-limited
- `lastUsedAt`
- `expiresAt`
- `revokedAt`
- `createdAt`

Add indexes for `userId`, `tokenHash`, and active-device lookup. Never return
`tokenHash` from an API.

Extend `sync_tokens` additively:

- `purpose`: `legacy_upload` or `device_exchange`
- optional `codeChallenge`
- optional `codeChallengeMethod`, initially only `S256`

Existing rows default to `legacy_upload`. Allow at most 10 active devices per
user. AUTH2 rejects an eleventh device with `409`; it never silently revokes an
existing device.

Complete when the migration applies to an existing database, preserves legacy
rows, enforces hashes and ownership constraints, and rolls back without deleting
pre-existing sync data.

### AUTH2 - Pairing code, exchange, and auth helper

`done`

Primary files:

- `netlify/functions/portal-sync-token.mts` or a new pairing-code endpoint
- new `netlify/functions/portal-sync-exchange.mts`
- new shared device-auth/token helpers under `netlify/functions/_shared/`
- focused endpoint/helper tests beside the Netlify functions

Add a Clerk-authenticated endpoint that mints exchange-only `pair_` codes. Keep
the existing legacy token endpoint temporarily for old clients.

The portal should label these paths clearly during migration:

- **Connect latest app** - exchange-only pairing code
- **Legacy one-time sync** - old upload token, temporary fallback

Remove the legacy path after the minimum supported app version can exchange device
credentials. Do not infer token purpose by querying both tables; use purpose and
versioned prefixes.

`POST /api/portal/sync-exchange` accepts:

- pairing code
- device name
- code verifier when the pairing code has a challenge

In one database transaction:

1. Hash and lock the pairing row with `FOR UPDATE`.
2. Require `purpose = device_exchange`, unused, and unexpired.
3. If a challenge exists, verify `BASE64URL(SHA256(verifier))` using constant-time
   comparison semantics.
4. Insert one device row with a new random credential hash.
5. Mark the pairing code used.
6. Commit, then return plaintext credential, device ID, and expiry once.

Concurrent exchanges for the same code must result in exactly one device. If the
response is lost after commit, the user pairs again; the orphaned device remains
visible and revocable in portal settings.

Complete when expiry, replay, PKCE verification, token-purpose separation, and
concurrent exchange are covered by isolated-database tests.

### AUTH3 - Device upload and revocation

`todo`

Primary files:

- `netlify/functions/portal-sync-upload.mts`
- new `netlify/functions/portal-device-revoke.mts`
- new owner-only device list/delete functions
- shared device-auth helper and endpoint tests

The Mac sends:

```text
Authorization: Bearer device_<secret>
```

Do not place durable credentials in JSON bodies, query strings, logs, analytics,
or error messages.

Create a shared `requireDeviceToken(req, allowedScope)` helper that:

- accepts only the `device_` credential type
- requires `revokedAt IS NULL`
- requires the fixed expiry and inactivity window to remain valid
- returns only the owning user and device IDs
- authorizes only an explicit endpoint allowlist
- updates `lastUsedAt` without requiring a write on every request

Initially the only scope is `sync:write`. A device credential cannot manage
groups, profiles, users, connected devices, or Clerk-authenticated settings.

Keep legacy one-time upload acceptance behind a temporary compatibility path and
removal date. Do not mix pairing-code authentication into the device helper.

### Credential Lifetime

Revocation remains the primary control, but credentials are not immortal:

- use a fixed expiry, initially one year
- reject credentials inactive for six months
- show expiry in connected-device settings
- require pairing again after expiry

Do not rotate credentials on every sync initially. Safe rotation requires retry,
crash, and grace-window semantics and is separate hardening work.

Complete when device upload preserves the existing identity/stable-key contract,
revocation is ownership-safe, invalid credentials return one uniform response,
and a failed request cannot retire the previous successful inventory.

### AUTH4 - Mac credential and connection core

`todo`

Primary files:

- new focused types under `menubar/Sources/omgskills/` for the connection model,
  credential store, and device API
- `menubar/Sources/omgskills/SkillSyncService.swift`
- focused tests under `menubar/Tests/omgskillsTests/`

- store the device credential as a non-synchronizable generic-password Keychain item
- use a stable service name and the device ID as the account key
- keep only non-secret display metadata outside Keychain
- update and delete Keychain items atomically
- if Keychain storage fails after exchange, best-effort revoke the new device and
  show a reconnect action
- never silently replace a credential tied to another portal account; require an
  explicit Disconnect/Replace confirmation

After pairing, upload the already-resolved installation snapshot with the device
credential. Later automatic sync may reuse this path, but scheduling is not part
of this plan.

### Mac Architecture and Concurrency

Connection state must outlive the sync sheet and menu panel. Do not keep browser
pairing, Keychain, or credential lifecycle state inside `SkillSyncView`.

Add one app-owned, main-actor observable model:

```swift
@MainActor
@Observable
final class DeviceConnectionModel {
    enum State {
        case disconnected
        case connecting
        case exchanging
        case storingCredential
        case syncing
        case connected
        case failed
    }

    private(set) var state: State = .disconnected
    private var pairingTask: Task<Void, Never>?
    private var authenticationSession: ASWebAuthenticationSession?
}
```

- own the model with `@State` above the sheet and inject it into child views
- views render state and invoke model commands; they do not read credentials
- retain at most one user-initiated pairing task and cancel it before starting another
- keep `ASWebAuthenticationSession` and its presentation provider on `MainActor`;
  do not mark framework objects `@unchecked Sendable`
- use a separate `DeviceCredentialStore` actor to serialize Keychain operations
- use a stateless `Sendable` network service for exchange, upload, and revoke calls
- keep synchronous Security framework calls away from SwiftUI view bodies and the
  main actor
- retain a pairing-attempt UUID/generation and re-check it after every `await`
  before storing a credential or publishing connected state
- clear verifier, state, retained session, and task handles on every terminal path

Disconnect is an ordered operation:

1. Invalidate the current attempt generation.
2. Cancel the browser session and pairing/sync task.
3. Attempt self-revocation for the currently stored credential.
4. Clear Keychain even when offline or revocation fails.
5. Publish disconnected state only for the still-current attempt.

This prevents an exchange that resumes after Disconnect from writing a new token
back into Keychain.

Complete when strict-concurrency builds pass and tests cover persistence,
cancellation, stale attempts, Keychain failure, and offline disconnect without
placing secrets in observable view state or local files.

### AUTH5 - Manual one-time pairing UI

`todo`

Primary files:

- `menubar/Sources/omgskills/ContentView.swift` and/or the existing local dashboard
- the AUTH4 connection model and Mac tests
- `portal/src/main.tsx` and `portal/src/styles.css`

Expose exchange-only code generation in the portal and accept it through the
existing profile-side sync panel. Keep legacy one-use upload available and
clearly labeled during migration. This task does not register a URL scheme or
open a browser authentication session.

Complete when a fresh install can pair once, store a device credential, perform
the first resolved sync, relaunch still connected, and disconnect cleanly.

## Phase 2 - Browser Pairing Without Paste

### AUTH7 - Browser pairing

`todo`

Primary files:

- the AUTH4 Mac connection model and browser-session adapter
- `menubar/Info.plist`
- `menubar/Sources/omgskills/omgskillsApp.swift` where callback integration is needed
- `portal/src/main.tsx`, portal routing, and pairing endpoints
- Mac and portal tests for callbacks, state, PKCE, and cancellation

Use `ASWebAuthenticationSession` with the system browser authentication surface.
Do not embed a webview or place a Clerk session in the app.

Because a private URL scheme can be claimed by another app, the callback carries
only a short-lived authorization code protected by state and a PKCE-style verifier.

### Browser Flow

1. The app generates a random `state` and PKCE verifier, retaining both only for
   the active connection attempt.
2. The app computes the `S256` challenge and opens:

   ```text
   https://app.omgskills.com/connect?state=<state>&code_challenge=<challenge>
   ```

3. The Clerk-authenticated page explains that the Mac will receive `sync:write`
   access and requires an explicit **Approve** action.
4. The portal mints an exchange-only pairing code bound to the challenge.
5. The server uses a fixed callback target and redirects to:

   ```text
   omgskills://pair?code=<pairing-code>&state=<state>
   ```

6. The app requires an exact state match, then exchanges the code with its verifier
   and device name.
7. The app stores the returned device credential in Keychain and performs the
   first resolved sync.

The app must strongly retain `ASWebAuthenticationSession` until completion and
provide a `@MainActor` `ASWebAuthenticationPresentationContextProviding` owner.
Use the current menu-bar `NSPanel` as the presentation anchor and activate/reopen
the panel when the callback returns so progress and errors remain visible.

Register `omgskills` in `menubar/Info.plist` using `CFBundleURLTypes`, and add a
release check that confirms the assembled app bundle contains the scheme. Do not
rely only on SwiftUI `.onOpenURL`; this app is driven by an `NSApplicationDelegate`
and has no normal `WindowGroup`. The authentication-session completion remains the
primary callback path, with app-delegate URL handling only where packaging/runtime
behavior requires it.

Reject missing state, mismatched state, malformed challenges, unsupported challenge
methods, arbitrary callback URLs, and concurrent pairing sessions. The connect
response and redirect must use `Cache-Control: no-store` and
`Referrer-Policy: no-referrer`; pairing codes and query strings must not be logged.

Cancellation is a normal terminal result. If the user cancels the browser, starts
another attempt, disconnects, or chooses Cancel, call
`authenticationSession.cancel()`, cancel the retained task, and do not show a
failure alert for `CancellationError` or the authentication-session cancellation
error. Closing the sheet or panel alone does not cancel the app-owned attempt; the
callback reopens the panel and shows the resulting state.

If a checked continuation wraps the callback API, it must resume exactly once on
success, failure, or cancellation. Guard the completion with the active attempt ID
because cancellation and framework completion may race.

An existing browser session may reduce sign-in friction, but this is a behavior to
verify on supported macOS versions rather than a guaranteed requirement.

Manual Phase 1 pairing remains the fallback. A device-code polling flow is a later
alternative only if URL-scheme behavior proves unreliable.

## Connected Devices and Revocation

### AUTH6 - Portal connected-device management

`todo`

Primary files:

- `portal/src/main.tsx` and `portal/src/styles.css`
- AUTH3 device list/delete functions
- portal and endpoint tests

Add two revocation paths:

1. Clerk-authenticated portal owner:
   `DELETE /api/portal/devices/:deviceId`, with strict ownership validation.
2. Connected Mac:
   `POST /api/portal/device-revoke`, which revokes only the presented credential.

Portal settings show device name, created date, last sync, expiry, and revoked
state. Apply output escaping and never expose hashes or credential fragments.

Disconnect behavior:

- attempt self-revocation
- clear the local Keychain item even when offline or revocation fails
- explain that remote revocation can still be completed from portal settings
- a revoked or expired credential receives `401` and prompts reconnect

## Mac SwiftUI UX

- keep Connect on the skill-groups/local-dashboard surface and show connection
  status there when the sheet is closed
- render the connection state with one enum rather than independent loading/error
  booleans that can form invalid combinations
- show a labeled `ProgressView` for connect, exchange, Keychain storage, and first sync
- provide a visible Cancel action during browser pairing and exchange
- do not use `interactiveDismissDisabled` as concurrency control; sheet dismissal
  leaves the app-owned attempt safely running, while an explicit Cancel stops it
- keep the manual `SecureField` fallback and add a native `PasteButton` so paste is
  user initiated
- confirm Disconnect with a destructive action and explain that portal revocation
  may still be required after an offline failure
- provide actionable retry/reconnect controls for exchange, Keychain, sync, expiry,
  and revocation failures
- use accessible labels for icon-only buttons and an accessible progress/status
  description for every connection state
- if the UI displays “Connected as ...”, return a non-secret `accountLabel` from
  exchange and store it as display metadata; never infer it from the device token

## Abuse and Privacy Controls

- rate-limit pairing-code minting, exchange, upload, and revoke endpoints from day one
- enforce pairing-code replay protection and a per-user active-device limit
- periodically delete expired/used pairing rows while retaining only minimal audit data
- validate device names and all payload limits server-side
- never store skill content, local paths, tokens, hashes, or skill IDs in auth telemetry
- record aggregate success/failure reasons without credential material
- return the same authentication error for unknown, expired, and revoked credentials

## Deployment and Migration

### AUTH8 - Migration, release, and verification

`todo`

1. Confirm `tiein.md` T5 is complete and the guarded combined artifact is used.
2. Apply the schema migration and deploy the shared device-auth helper.
3. Deploy exchange, device upload, connected-device, and revoke endpoints with
   legacy behavior still available.
4. Ship the Mac Keychain/exchange client.
5. Switch the portal's primary connect UI to exchange-only pairing codes.
6. Add browser pairing independently after manual exchange is stable.
7. Verify production with a temporary device and revoke it afterward.

Complete when the verification matrix below passes, legacy clients still work,
the combined deploy artifact passes its guards, and production smoke checks show
no regression to `/app/`, downloads, manifests, or generated library pages.

### AUTH9 - Remove legacy tokens

`deferred`

Start only after a documented minimum supported app version and measured adoption
cutoff. Remove the legacy portal UI and direct-upload acceptance, then retire the
legacy schema fields in a later additive migration. This is not part of the first
device-credential release.

Do not test authentication with pre-database diagnostic echoes. They prove routing,
not security or transaction behavior. Use local integration tests with an isolated
database or a draft/branch environment explicitly connected to a non-production DB.
Never point draft authentication tests at production credentials or production data.

## Verification Matrix

Backend:

- pairing codes expire, replay fails, and concurrent exchange issues one device
- challenged exchange fails without the correct verifier
- legacy upload tokens cannot exchange; pairing codes cannot upload directly
- valid device upload succeeds; unknown, expired, inactive, and revoked devices fail
- device credentials cannot call Clerk/group/profile endpoints
- portal revoke rejects another user's device ID
- self-revoke affects only the presented device
- no API response contains token hashes

Sync behavior:

- provenance, Git, SHA, ambiguous, and local-only identity fields survive upload
- re-sync upgrades the same `stableKey` row without duplication
- failed auth leaves the previous successful inventory unchanged
- `lastUsedAt` reflects successful device use without excessive writes

Mac app:

- credential persists across relaunch in Keychain and never appears in defaults/files
- Disconnect clears Keychain and handles offline remote-revoke failure clearly
- state mismatch and callback without an active session are rejected
- Keychain write failure triggers best-effort device cleanup
- expired/revoked credentials present a reconnect flow
- the app-owned connection model survives sheet and panel dismissal
- Disconnect during exchange cannot write a credential after local cleanup
- a stale callback from an earlier attempt cannot replace newer connection state
- concurrent Connect actions produce only one active authentication session
- browser cancellation returns to a neutral state without an error alert
- the built app bundle contains the registered `omgskills` callback scheme

Swift concurrency and UI tests:

- mark connection-model tests `@MainActor`
- inject browser-session, credential-store, API, clock, and random/state generators
- use async Swift Testing methods that directly await model commands; do not use
  fixed sleeps, semaphores, or fire-and-forget test tasks
- test cancellation while exchange is suspended and completion arriving after cancel
- test stale callbacks after a second attempt starts
- test sheet dismissal and panel closure during pairing
- test Keychain failure followed by awaited best-effort revocation
- use unique Keychain service/account names per test so parallel tests do not share state
- run strict-concurrency builds with the repository's Swift 6.2 toolchain and keep
  all new APIs compatible with the macOS 14 deployment target

Deployment:

- local or isolated-DB integration tests cover exchange and upload transactions
- production smoke checks use a temporary test device that is revoked afterward
- legacy clients work during the declared transition window
- rollback can restore legacy UI without deleting device rows or weakening scopes

## Non-goals

- Clerk SDK, passwords, or a general account session inside the Mac app
- group management or profile mutation through device credentials
- bidirectional sync or portal-to-app installs
- automatic background-sync scheduling
- per-request device-token rotation
- multi-account switching without explicit disconnect/replace
