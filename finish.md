# Remaining Work

Validated 2026-07-17 against `origin/main`.

This is the short backlog for unfinished cross-system work. Durable architecture
belongs in `arch.md`; crawler operations in `crawl.md`; production and Mac
release procedure in `deploy.md`; security policy in `trust.md`.

Completed implementation history does not belong here.

## Release Boundaries

- A web deploy never authorizes a public Mac release.
- A data publication never authorizes a public Mac release.
- Keep `SHA_CANONICAL_PUBLISH` and `SKILL_EQUIVALENCE_PUBLISH` off until their
  explicit rollout tasks are approved.
- Never enable dormant crawler flags as part of unrelated catalog work.
- Every production web deploy must use the guarded combined
  `dist/netlify-site` artifact.

## Explicit Data Rollouts

These are public data changes and require separate approval even though their
code is already implemented.

### R1 - Publish canonical SHA attribution

- privately regenerate and validate `canonicalBySha`
- set `SHA_CANONICAL_PUBLISH=1` only in the intended publisher workflow
- verify v2 and Crawl 4 receive identical valid assets
- verify old clients still accept the additive asset
- verify malformed or stale mappings fail closed to ambiguity
- use flag-off publication to remove canonical annotations without shrinking
  append-only SHA membership if rollback is required

Immediate ambiguity reduction is expected to be small under the conservative
same-repository policy.

### R2 - Publish Claude/Codex equivalence

- privately regenerate and review the equivalence report and override decisions
- set `SKILL_EQUIVALENCE_PUBLISH=1` only in the intended publisher workflow
- verify v2 and Crawl 4 manifests reference identical valid assets
- verify full data publishes preserve the manifest entry and rollback files
- verify omission or explicit removal returns clients to separate physical rows
- use explicit `0` or `remove` as the kill switch; unset remains a no-op

Do not combine this rollout with a public Mac release unless explicitly planned.

### R3 - Roll out dormant Crawl 4 flags

Evaluate these independently:

- `CRAWL4_CREATOR_WATCH=1`
- `CRAWL4_INSTALL_ADMISSION=1`
- `CRAWL4_MOMENTUM_PRIORITY=1`

For each flag:

1. define acceptance and rollback thresholds
2. enable only that flag
3. inspect at least two scheduled reports
4. keep or disable it before testing the next flag

## Measurement-Gated Work

Do not implement these without the stated evidence.

### D1 - Identity resolution performance

Combine per-result caching and off-main-actor resolution only if measurements
show material launch or refresh cost.

- stale resolved IDs must re-resolve when absent from the live catalog
- unresolved entries should retry when identity assets change

### D2 - Repository aliases

SHA fallback already handles most repository renames. Publish an old-to-new
repository alias asset only if identity measurements show a material remaining
miss population.

### D3 - Confirm-once fuzzy resolution

Build only if production measurements after a public client release show a
material unresolved population. A user-confirmed local mapping must never become
global canonical data.

### D4 - Leaderboard display meaning

Influential creators are ordered by `editorialScore` while the headline displays
stars. Decide whether the public number should explain rank, popularity, or
another metric before changing either ordering or display.

## Public Mac Release

### AUTH8 - Release the device-authenticated client

Requires explicit release approval.

- plan the version and release scope separately from web/data work
- use the signed and notarized process in `deploy.md`
- confirm the bundle contains the `omgskills` callback scheme
- test pairing, durable sync, relaunch/reconnect, disconnect, revoke, and
  reconnect with a temporary device
- smoke-test app-owned uninstall provenance cleanup
- confirm a legacy client still syncs during the migration window
- verify downloads, appcast, update assets, manifests, portal, and generated
  library pages after the combined-artifact deploy
- revoke the temporary device

Rollback must not delete durable device rows or weaken device-token scopes.

### AUTH9 - Remove legacy one-time sync

Depends on AUTH8 adoption.

- define the minimum supported app version and measured adoption cutoff
- preserve legacy upload through the cutoff and rollback window
- remove the legacy portal UI and direct-upload acceptance first
- retire legacy token/schema fields later through a separate additive migration
- verify durable pairing, upload, revocation, and reconnect remain unaffected

## Suggested Order

1. R1, R2, and R3 only through separately approved data rollouts.
2. AUTH8 only through a separately approved public Mac release.
3. AUTH9 after measured adoption.
4. D1-D4 only when their evidence gates are met.

## Verification Baseline

Run only the checks owned by the changed area:

```bash
npm test
cd index && npm run typecheck && npm run test:shadow-guard
cd ../menubar && swift test && swift build -c release
cd .. && node scripts/build-web-library.mjs
node scripts/verify-web-library-pages.mjs
node scripts/prepare-netlify-site-deploy.mjs
```

Run live verification only after an approved combined-artifact deploy. Never use
a partial production deploy as a testing shortcut.

## Future Work

- Extend equivalence grouping to portal, editorial, and web-library views.
- Add repository/folder-level manual curation intake.
- Support personal or peer-to-peer skills through GitHub repositories or gists,
  never portal content storage.
- Expand editorial creators and topics after the pilot format is settled; add a
  CMS only when collaboration or volume requires it.
- Add focused automated and accessibility coverage for collection author
  routing.
