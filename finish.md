# Remaining Work

Validated 2026-07-21 against `origin/main`, the current production data assets,
and the private 0.0.18 build.

This is the short backlog for unfinished cross-system work. Durable architecture
belongs in `arch.md`; crawler operations in `crawl.md`; production and Mac
release procedure in `deploy.md`; security policy in `trust.md`.

Completed implementation history does not belong here.

## Release Boundaries

- A web deploy never authorizes a public Mac release.
- A data publication never authorizes a public Mac release.
- Keep optional data flags scoped to their approved publisher steps. Never
  enable them globally or in Mac release commands.
- Never enable dormant crawler flags as part of unrelated catalog work.
- Every production web deploy must use the guarded combined
  `dist/netlify-site` artifact.
- A Mac release changes the DMG and appcast only after explicit release approval.

## Release 0.0.18

Release 0.0.18 is the Crawl 4, editorial, identity, and unified installed-skills
release. Skill Groups authentication remains implemented but unavailable to
public users until its later polish and release task.

### 18.1 - Gate Skill Groups authentication

**Complete.** Landed as `d494504` and deployed with the production Mac release
assets unchanged.

- add an off-by-default production release flag for the Mac auth UI
- hide the `Resync` entry and sync sheet when the flag is off
- prevent browser pairing and saved-device restoration from becoming public
  entry points while disabled
- hide the portal sync entry and connect approval UI from public users
- keep backend routes and database state intact for later testing
- allow local or private builds to enable the flow deliberately
- verify disabling the feature does not affect local scanning, catalog browsing,
  installation, deletion, or updates

Do not remove auth code or migrations as part of this gate.

### 18.2 - Publish canonical SHA attribution

**Complete.** Landed as `d28f6a6`. The guarded production rollout and scheduled
publisher run both passed with identical v2 and Crawl 4 assets, non-shrinking
SHA membership, and unchanged Mac appcast and DMG assets. The scheduled data
refresh landed as `fa0c845`.

- privately regenerate and validate `canonicalBySha`
- set `SHA_CANONICAL_PUBLISH=1` only in the intended publisher workflow
- verify v2 and Crawl 4 receive identical valid assets
- verify old clients still accept the additive asset
- verify malformed or stale mappings fail closed to ambiguity
- use flag-off publication to remove canonical annotations without shrinking
  append-only SHA membership if rollback is required; compare against the
  pre-rollback asset rather than fixed catalog counts
- require the scheduled v2 and Crawl 4 verifiers to validate every regenerated
  canonical annotation while the flag remains enabled

Immediate ambiguity reduction is expected to be small under the conservative
same-repository policy. After two clean scheduled publications, review the
trusted-creator single-repository candidates as the next explicit batch. Other
medium-confidence candidates remain deferred rather than being promoted
automatically.

Identity-resolution telemetry is already implemented. The production effect on
`ambiguous` and `resolved_by_sha` becomes measurable after the 0.0.18 Mac client
is publicly released; it is not an immediate rollout success gate.

Subsequent scheduled publications have preserved identical canonical assets
across v2 and Crawl 4. Broader canonical policy batches remain separate,
explicitly reviewed work.

### 18.3 - Publish Claude/Codex equivalence

**Complete.** Landed as `9110bee` and published through the guarded combined
artifact without changing the public Mac appcast or DMG. Production v2 and
Crawl 4 manifests reference the same validated 55-group asset, and subsequent
scheduled data publications have preserved it.

- privately regenerate and review the equivalence report and override decisions
- set `SKILL_EQUIVALENCE_PUBLISH=1` only in the intended publisher workflow
- verify v2 and Crawl 4 manifests reference identical valid assets
- verify full data publishes preserve the manifest entry and rollback files
- verify omission or explicit removal returns clients to separate physical rows
- use explicit `0` or `remove` as the kill switch; unset remains a no-op
- confirm old clients ignore the optional asset

Do not combine this rollout with the public Mac release command.

### 18.4 - Verify a private release candidate

**Complete.** The final 0.0.18 RC was built from the clean integration branch on
the latest `origin/main`, signed, notarized, installed, and manually verified.
The root suite, 378 crawler tests, 190 Swift tests, release build, and release
guards pass. The reproducible Mac build guard verifies exact equality between
the promoted catalog and the hashed v2 fallback asset.

Manual verification covered the unified installed-skills view, logical `All`
count, source-specific views and physical counts, Discover and collection
navigation, creator links, install and file actions, refresh behavior, update
checks, and session restoration. Deliberate Crawl 4 failure fell back to v2.
Light and dark origin badges and the compact six-action layout were also checked.

The packaged app is version `0.0.18` build `18`, Skill Groups authentication is
disabled, and the public appcast remains byte-identical at `0.0.17`. No public
release assets were changed during RC verification.

### 18.5 - Publish 0.0.18

Requires explicit release approval.

The 0.0.18 release notes are prepared in `CHANGELOG.md`.

- use the signed and notarized process in `deploy.md`
- update the DMG, checksum, and appcast only in this release step
- deploy with the guarded combined artifact so existing portal, data, profile,
  skill, collection, sitemap, and update files remain present
- run the production verification checklist from `deploy.md`
- confirm the public build still has Skill Groups authentication disabled

## After 0.0.18

### P1 - Harden crawler and list ownership

**Planning required.** Stabilize how crawler output, manual admission,
suppression, creator watching, editorial inputs, and Editool changes interact.

The plan should define:

- the owner and update path for each maintained list
- which inputs are authoritative and which are generated
- conflict precedence and validation
- review requirements for automated list changes
- recovery from partial or stale runs
- production observability and rollback thresholds

Keep v2 available as fallback during this work.

### P2 - Roll out dormant Crawl 4 flags

Depends on P1. Evaluate each flag independently, in this order unless the P1
review changes the risk assessment:

1. `CRAWL4_MOMENTUM_PRIORITY=1`
2. `CRAWL4_CREATOR_WATCH=1`
3. `CRAWL4_INSTALL_ADMISSION=1`

For each flag:

1. define acceptance and rollback thresholds
2. enable only that flag
3. inspect at least two scheduled reports
4. keep or disable it before testing the next flag

### P3 - Polish and release Skill Groups authentication

**Planning required.** This is a dedicated post-0.0.18 feature release and
requires explicit public-release approval.

- review the Mac and portal UX end to end
- test pairing, durable sync, relaunch/reconnect, disconnect, revoke, and
  reconnect with a temporary device
- confirm the callback scheme works in the signed and notarized build
- smoke-test app-owned uninstall provenance cleanup
- confirm a legacy client still syncs during the migration window
- verify downloads, appcast, update assets, manifests, portal, and generated
  library pages after the combined-artifact deploy
- revoke the temporary device

Rollback must not delete durable device rows or weaken device-token scopes.

### P4 - Remove legacy one-time sync

Depends on measured adoption of P3.

- define the minimum supported app version and adoption cutoff
- preserve legacy upload through the cutoff and rollback window
- remove the legacy portal UI and direct-upload acceptance first
- retire legacy token/schema fields later through a separate additive migration
- verify durable pairing, upload, revocation, and reconnect remain unaffected

### P5 - Retire the v2 fallback

**Planning required.** Do not retire v2 during or immediately after 0.0.18.

- require sustained Crawl 4 production health
- confirm supported public clients operate correctly on Crawl 4
- define adoption, health, and rollback thresholds
- remove fallback use before removing hosted v2 assets
- retain a recovery path through the agreed rollback window

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
