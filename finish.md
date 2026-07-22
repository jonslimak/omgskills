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

**In progress.** Stabilize how crawler output, manual admission, suppression,
creator watching, editorial inputs, and Editool changes interact. Keep v2
available as fallback throughout this work.

Critical path to P2:

`P1.1 -> P1.2 + P1.3 -> P1.4 -> minimum P1.7 -> P1.5 -> P1.10`

P1.6 and P1.9 may run in parallel. P1.9 must finish before the first production
flag rollout. P1.8 is deferred until after P2 and does not block it.

#### P1.1 - Define the policy inventory and ownership contract

**Complete.** The maintained inputs, owners, edit paths, consumers, risk
classes, generated evidence, and derived outputs are documented in `arch.md`.

#### P1.2 - Consolidate creator and trust sources

**Complete.** `index/seeds/creators.json` is the sole authority for creator and
vendor roles, aliases, watch state, and featured state.

- [x] Remove the legacy trusted-vendor and trusted-creator lists.
- [x] Remove the independent content vendor set and load vendor status from the
  creator registry for gold-basket, overlay, and leaderboard generation.
- [x] Remove `collections.json.featuredAuthors`; collections use registry
  `featured` entries exclusively.
- [x] Centralize creator normalization, alias ownership, and
  `featured => watch` validation in the shared registry loader.
- [x] Keep creator-watch flag-gated; this consolidation does not enable it.

The intentional content delta is that `cursor` and `greensock` now receive the
vendor role already declared in the registry, while the misspelled legacy
`supabas` entry is gone. Same-input gold-basket comparison retained 420 rows and
replaced six lower-ranked rows with six Greensock skills.

#### P1.3 - Add one shared policy loader and validator

**Complete.** `index/scraper/policy/` now loads and validates all authoritative
policy sources without loading catalog data itself. Shared identifier helpers
own case-insensitive handle, repository, and skill-ID parsing.

- [x] Reuse the loader from Crawl 4, v2 seed loading, Editool, collections
  publishing, manual admission/removal, handle reservations, CI, and deploy
  preparation.
- [x] Reject malformed entries, normalized duplicates, invalid enums, and
  creator-registry violations. Report include/exclude and editorial conflicts
  without changing P1.4 precedence.
- [x] Apply consumer-specific failure profiles: scheduled crawls and deploys
  block structural errors; collection publishing also blocks stale editorial
  references; Editool and strict local validation block every finding.
- [x] Validate new suppressions against the union of promoted, cutover, and
  overlay catalogs while allowing already-recorded historical suppressions to
  remain after their catalog rows disappear.
- [x] Keep v2 `KNOWN_INVALID_REPOS` modeled as distinct root-path discovery
  policy, not do-not-crawl exclusion policy.

Run `cd index && npm run policy:validate -- --profile strict` for the full local
check. This task adds validation and visibility only; admission precedence and
v2 blocklist migration remain P1.4 and P1.5.

#### P1.4 - Encode and test conflict precedence

**Implementation complete; rollout observation pending.** Scheduled Crawl 4 is
explicitly in `observe` mode, so current output behavior is preserved.

- [x] Encode do-not-crawl, repo exclusion, suppression, catalog, and explicit
  non-original provenance ahead of every value or trust signal.
- [x] Keep suppression skill-scoped: skip a suppressed primary bootstrap
  candidate and deterministically try the next eligible candidate.
- [x] Limit manual inclusion to bypassing value thresholds; it cannot bypass
  mapping, exclusion, suppression, catalog, or provenance policy.
- [x] Prevent unsafe repositories and non-original skills from inheriting
  rising/core or curated classification through stars, trust, or gold signals.
- [x] Keep creator watch flag-gated, `featured => watch` validated, and
  editorial collections outside admission inputs.
- [x] Emit JSON and Markdown observations using shared policy reason codes for
  admission, repo-state, and quality-tier changes.
- [x] Support `observe`, admission-only `admission`, and full `enforce` modes;
  unknown values fail closed.
- [ ] Review artifacts from at least two successful scheduled combined runs.
- [ ] Approve either admission-only or full enforcement based on observed
  counts. Any mode change is a separate reviewed change.

#### P1.5 - Align catalog mutation paths

**Implementation complete; rollout observation pending.** Scheduled v2 remains
in `observe`, so its catalog output still uses the legacy rules.

- [x] Add `root-skill-invalid.json` as distinct root-path discovery policy;
  nested skills from those repositories remain eligible under proposed policy.
- [x] Audit all legacy `BLOCKED_REPOS`, `BLOCKED_OWNERS`, and root-invalid
  entries against shared sources. Enforcement fails closed if coverage drifts.
- [x] Implement shared v2 exclusion evaluation and an `observe`/`enforce` mode;
  unknown mode values fail clearly.
- [x] Make manual add reject shared exclusions, catalog repositories, and
  non-original provenance; exact re-adds are no-ops and ID conflicts fail.
- [x] Keep manual removal idempotent across do-not-crawl and Crawl 4 state.
- [x] Add v2/Crawl 4 exclusion parity and root-path behavior tests.
- [x] Emit scheduled JSON/Markdown v2 diffs with source commit, policy digest,
  migration coverage, counts, reasons, and bounded samples before publishing.
- [ ] Review artifacts from two consecutive successful scheduled v2 runs.
- [ ] In a separate reviewed change, switch to `enforce`, then remove the
  legacy constants and Editool's read-only compatibility parser.

#### P1.6 - Make Editool changes coherent and recoverable

- [ ] Validate the complete proposed policy state before writing related files.
- [ ] Show cross-list conflicts, the winning rule, affected rows, and whether
  each conflict blocks saving or is an acknowledged deny-wins warning.
- [ ] Stage multi-file saves together and recover cleanly if any write fails.
- [ ] Leave a validated, commit-ready working-tree diff for Git review.
- [ ] Keep Editool local and unable to publish or deploy production directly.

#### P1.7 - Add minimum policy impact reports and safety thresholds

- [ ] Produce the Crawl 4 shadow comparison required by P1.4.
- [x] Implement the v2 comparison required by P1.5; scheduled review is still
  pending.
- [ ] Compare generated catalog and editorial outputs with the last known-good
  publication.
- [ ] Block unexpected shrink, large removals, missing referenced assets, or
  stale-source publication unless an explicit reviewed override is present.
- [ ] Record the source commit and effective-policy digest in every relevant
  run output. v2 is complete; Crawl 4 remains.

#### P1.8 - Deferred: reviewed change-request automation

Reassess after P2 when multiple operators or remote curation justify it. Until
then, Editool produces validated local changes and Git remains the review path.

#### P1.9 - Close remaining deployment and rollback gaps

- [ ] Prevent health-only or stale workflows from racing the serialized data
  publication and production deploy path.
- [ ] Preserve a last-known-good manifest/deploy artifact through live
  verification and document the immediate rollback command.

#### P1.10 - Verify readiness for flag rollout

- [ ] Add fixtures covering precedence, aliases, stale data, partial writes,
  reruns, conflicts, and both data tracks.
- [ ] Expose production counts and changes by admission/removal source, plus
  validation and publication failures.
- [ ] Define acceptance and rollback thresholds for the dormant Crawl 4 flags.
- [ ] Update architecture, crawler, deploy, and Editool operating docs.

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
