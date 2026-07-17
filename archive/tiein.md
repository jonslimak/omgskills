# Cross-Workstream Tie-In

This document is the integration backlog across Crawl 4, the editorial layer,
the web library, the macOS client, identity resolution, and Skill Groups.
Feature-specific architecture remains in the owning documents; this file tracks
only gaps where one implemented system does not safely connect to another.

Last validated: 2026-07-16 against `main` through `cdc2841` and a private
bundled 55-group macOS build. No production deploy or public Mac release was
performed.

Status legend: `todo` / `in progress` / `done` / `deferred` / `combined` /
`obsolete`.

## Canonical boundaries

These choices are implemented and should not be reopened by the work below:

- Catalog skill IDs are the cross-system foreign key. Existing IDs are not
  renamed, recycled, or merged.
- `/library/{handle}/` is the editorial/catalog profile namespace.
- `/u/{handle}` is the portal user-profile namespace.
- `/u/{handle}/sets/{slug}` is the public Skill Group namespace.
- `/collections/{id}/` is the editorial topic-collection namespace.
- `/skills/{owner}/{repo}/{skill-path}/` is the static skill-page namespace.
- `/profiles/*` remains redirect-only. `/creators/*` stays removed; do not add a
  compatibility redirect unless new evidence shows meaningful external use.
- Editorial collections, SHA history, and equivalence grouping data remain optional
  manifest assets. They must not redefine the core `skills.json` schema.
- Manifest omission means an optional asset was removed for that track. The
  client clears its cached copy without affecting skills bootstrap or fallback.
- Catalog `quality_tier` and web `indexTier` remain separate. Useful-content
  requirements continue to control indexing; quality alone cannot index a thin
  page.
- Claude and Codex variants retain separate catalog IDs and install locations,
  even when the optional equivalence asset groups them for display.
- AUTH1-AUTH7 and the production auth backend are complete. A public Mac release
  remains the explicit, separately approved AUTH8 task below.

## Confirmed working end to end

No implementation work is required for these paths:

- Creator registry -> alias-aware `publish:collections` -> matching v2/Crawl 4
  asset -> macOS collection decoding and rendering.
- Skills and Crawl 4 publishers preserve foreign manifest assets such as
  `collections` and `shaHistory`.
- Collection download failures are non-fatal and do not trigger track fallback.
- Install provenance, Git inspection, raw-byte Git blob SHA computation, unique
  SHA resolution, and ambiguous multi-ID SHA states exist in the client.
- Portal sync consumes the store's resolved installation snapshot instead of
  performing a second raw filesystem scan in the network layer.
- Append-only `shaHistory.shaToSkillIds` publishes one merged mapping to both
  data tracks and is bundled into development/release app builds.
- The five automated Netlify workflows build and deploy the combined
  `dist/netlify-site` artifact and run live web verification.
- `/library/` and `/u/` no longer compete for the same handle namespace.
- The current web pilot has canonical metadata, structured data, index tiering,
  sitemap support, README rendering, and local/live fixture verification.
- Crawl 4 quality tiers are enabled on the Crawl 4 track; v2 compatibility is
  preserved.
- Creator registry validation, aliases, handle reservations for featured
  creators, and Editool save guards are implemented.
- The optional equivalence asset decodes into logical installed `All` rows while
  preserving every physical installation and source-specific filter.

## P0 - Correctness and production safety

### ID0.1 - Upload resolved installations

`done`

Implemented in `2dc6e96`:

- The UI/store passes its already-resolved installation rows into
  `SkillSyncService`.
- Scanning and identity resolution remain outside the network layer.
- `SkillsStore` distinguishes an uninitialized snapshot from a completed empty
  scan, preventing an early empty sync from retiring valid portal rows.
- Opening Resync refreshes local installations, captures the resulting
  `[Skill]` value, and uploads metadata only. `SKILL.md` content is never sent.
- Claude and Codex installation rows remain separate in the snapshot rather
  than using the deduplicated local-library list.

Verification:

- Store tests cover readiness, completed empty scans, and resolution of every
  installation row.
- Payload tests cover resolved catalog identity and retention of both Claude
  and Codex rows.
- `SkillSyncService` no longer references `InstalledSkillsScanner`.

### ID0.2 - Make Git identity ambiguity-safe and path-aware

`done`

Implemented in `8c4c2d6`:

- The scanner records each installed skill's path relative to its enclosing Git
  root, with `.` representing a root skill.
- The resolver retains every normalized repo/path and repo/frontmatter-name
  candidate instead of allowing catalog order to overwrite collisions. The
  current catalog has 720 colliding repo/name keys covering 1,619 skills.
- Exact repo/path matches win. Repo/frontmatter-name resolves only when unique.
- Git misses leave SHA unrestricted, preserving renamed-repo recovery.
- Git ambiguity constrains SHA to the intersection of Git and SHA candidates;
  singleton intersections resolve while disjoint or multi-ID intersections
  remain ambiguous.
- Path matching is case-insensitive while preserving leading-dot paths.

Verification completed:

- Duplicate repo/name fixtures are order-independent.
- Nested, root, leading-dot, moved-path, renamed-repo, and all SHA-intersection
  branches are covered.
- Older encoded `Skill` values without `gitRelativePath` still decode.

### ID0.3 - Keep identity status fields consistent

`done`

Implemented in `8dcd497` and verified through the production sync rollout.

Implemented:

- Swift treats `identityStatus` as authoritative and derives the legacy
  `isLocalOnly` field at the payload boundary.
- Resolved payloads require a catalog ID. Ambiguous and local-only payloads do
  not retain one.
- The shared server parser validates new payloads and normalizes legacy-client
  payloads without breaking older app versions.
- Migration
  `20260711110000_enforce_sync_identity_consistency` preserves existing catalog
  IDs, repairs inconsistent rows, and adds a database check constraint for the
  three valid status/ID/local-only combinations.
- Parser and Swift tests cover resolved, ambiguous, local-only, contradictory,
  and legacy payloads.

Production verification completed: the migration and parser are live, durable
client sync succeeds, and the database constraint rejects inconsistent
status/catalog/local-only combinations.

### ID0.4 - Stop Claude and Codex installations from overwriting each other

`done`

Implemented in `8dcd497` and verified through the production sync rollout.

Implemented:

- New clients use `location:v1:{lowercase-source}:{installation-folder}` and
  send `installationPath` so the server can validate the key.
- The server preserves valid new keys unchanged and rejects mismatched or
  duplicate installation locations.
- A compatibility branch retains the old `githubUrl#name` behavior only for
  clients that do not send `installationPath`; no forced client update is
  required.
- Catalog identity remains separate in `catalogSkillId`.
- The portal grouping logic now lives in a testable pure module. It presents
  matching Claude and Codex rows as one item while retaining both row IDs,
  source values, and underlying records.
- The existing sync-run retirement query receives only the new location keys,
  so the first new-client sync inserts both rows and retires the legacy merged
  key instead of deleting it.

Verification completed locally:

- A payload key survives server parsing unchanged.
- Claude and Codex produce distinct location keys.
- Portal grouping retains both installations and both source labels.
- Legacy payload parsing remains covered.

Production verification completed: the compatible parser and migration are live,
the durable client synced separate Claude and Codex installation rows, and the
portal grouped them without collapsing either source record.

### ID0.5 - Preserve provenance during local cross-install

`done`

Implemented in `811878b`:

- The regular and local cross-install paths share one atomic provenance writer.
- A cross-install writes target-root metadata only for a resolved source with a
  catalog ID. Ambiguous and local-only sources never write provenance.
- The writer creates `.omgskills/` on first use.
- A metadata failure after symlink creation removes that new symlink.
- Scanner-to-resolver coverage proves the target resolves by provenance.

### T5 - Fix the manual production deploy path

`done`

Implemented and verified on 2026-07-13. The manual script now refuses stale
generated Netlify config and dirty deploy inputs, loads the production Clerk
publishable key, prepares release assets, builds and guards
`dist/netlify-site`, deploys that combined artifact with `--no-build`, and runs
focused release plus full web-library verification before tagging. Syntax,
command-order regression tests, the complete combined build, and live checks
against the isolated Netlify site pass. No production deploy was performed for
T5.

The automated workflows deploy the combined artifact, but
`scripts/deploy-site-prod.sh` still deploys `site/` directly. A manual run can
remove `/app/`, downloads, or other files that only exist in the combined
artifact. This contradicts `deploy.md`.

Proposed solution:

- Run the guarded combined build after preparation.
- Deploy `dist/netlify-site --no-build`, never `site/`.
- Keep live web verification after deploy and before any tag operation.
- Ensure the required portal environment is present before building.

Verify: the script produces and guards `dist/netlify-site`; `/app/`, downloads,
appcast, both data manifests, library pages, redirects, and metadata files remain
available after a test deploy.

## Active required work

Only tasks that need implementation or verification now appear in this section.
Deferred, decision-gated, combined, and obsolete items are collected at the
bottom.

### P1 - Public web and portal contracts

#### T6 - Use one catalog-ID-to-web-URL contract

`done` (landed on `main` in `2680990`; canonical publication remains flag-off)

- Generate one `catalogSkillId -> publicPath` lookup from the static builder's
  collision-aware URL map.
- Make public Skill Group rendering consume that lookup instead of reconstructing
  paths.
- Fall back to a valid GitHub URL or plain metadata when no page was generated.
- Cover normal, repo-root, collision, unpublished, and local-only fixtures.

Gate: complete before public Skill Groups or broader skill-page coverage.

#### T7 - Prevent links to missing library profiles

`done` (landed on `main` in `a62b809`)

- The exact profile-page queue now supplies the case- and alias-aware map used
  while rendering skill pages.
- Visible attribution and structured data link canonical profile pages only when
  generated; otherwise they use GitHub and omit the missing author breadcrumb.
- Local verification checks every generated HTML and JSON-LD reference plus
  sitemap and `llms.txt` targets, and rejects redirect-only `/profiles/*` links.
- Published-data verification blocks malformed collections assets while stale
  skill references remain advisory against each track's own skills asset.

Verification completed: focused alias and collections fixtures, the full root
suite, index typecheck, both published data tracks, the generated web library,
and the guarded combined Netlify artifact pass with zero missing internal
targets. No production deploy was performed.

#### T13 - Finish pilot README coverage alignment

`todo` (partially implemented)

The crawler and generator already share topic IDs and expanded author slices.
Remaining work:

- Add the generator's same bounded trending head to the shared pilot selection.
- Classify every generated pilot skill as snippet present, fetch failure, or
  intentionally exempt in the shadow report.
- Keep refresh weekly and missing-snippet-only unless freshness data proves that
  changed files need refetching.

Gate: complete before expanding the web library beyond the pilot.

### P2 - Canonical identity

Identity architecture and policy remain in `identity.md`. ID1.1 measurements and
ID2.1 canonical-policy validation are complete.

#### ID2.2 - Publish additive `canonicalBySha`

`done` (landed on `main` in `c65f95d`; publication remains flag-off)

- The publisher adds optional `{ skillId, confidence, reason }` entries behind
  `SHA_CANONICAL_PUBLISH=1`, which remains unset in production.
- Flag-off runs preserve byte-identical v1 assets; unsetting after rollout removes
  canonical data without shrinking `shaToSkillIds` membership.
- The publisher reuses ID2.1's policy and validator against the post-cutover
  `index/skills.json`, emitting only validated high-confidence same-repo entries.
- Canonical entries are recomputed from current live data while membership remains
  append-only history.
- Crawl 4 and v2 receive identical assets; unrelated manifest fields and the
  current/previous rollback pair are preserved.
- The published-data verifier accepts historical assets without the field and
  rejects malformed, non-live, SHA-mismatched, or non-member canonical entries.

Current measurement: 11 of 2,003 live multi-ID SHA keys qualify under the initial
same-repo-only policy. ID2.2 is an infrastructure milestone; immediate ambiguity
reduction is expected to be small, and actual installed-skill upgrades may be
lower because Git resolution runs first.

Verification completed: flag-off/on/off isolated publication, identical local
track assets, kill-switch membership preservation, policy validation, publisher
and verifier fixtures, index typecheck, 350 Crawl/publisher tests, and the full
root test suite. No production data was generated or deployed.

#### ID2.3 - Consume canonical SHA mappings in the client

`done` (landed on `main` in `2680990`; canonical publication remains flag-off)

- Decode `canonicalBySha` as optional.
- Consume only valid high-confidence mappings whose ID is live and belongs to
  `shaToSkillIds[sha]`.
- Upgrade a multi-ID SHA from ambiguous only when that validation succeeds.
- Preserve ambiguity for missing, stale, malformed, or unsupported entries.
- Add omission tests proving that absent optional assets clear their track cache
  without affecting skills bootstrap, throttling, or track fallback.

Verification completed: the published wire shape decodes, valid mappings upgrade
ambiguity as SHA resolution, invalid or disjoint mappings fail closed, malformed
canonical data leaves core SHA history usable, and omission clears only optional
SHA-history state. All 155 Swift tests and the release build pass. The publication
flag remains off; nothing was deployed or released.

Release gate: ID2.2 and ID2.3 may land and be pushed separately because canonical
emission defaults off. Do not set `SHA_CANONICAL_PUBLISH=1` until ID2.3 passes
compatibility and private client verification. A public client still requires a
separately approved AUTH8 release plan.

#### ID4.1 - Generate and review cross-agent equivalence

`done` (landed on `main` in `920a703`)

- Generate deterministic same-repository Claude/Codex equivalence groups after
  suppression filtering.
- Require exact normalized names, distinct SHAs, compatible agent paths, and
  strong description agreement.
- Preserve every catalog row and install command.
- Store neutral-path approve/reject decisions in a committed override asset so
  reviewed pairs do not re-enter the queue.
- Emit a publish-ready shadow asset plus a review report with pending, excluded,
  rejected, and stale-decision counts.

Current reviewed result: 55 publishable groups, including 12 automatic explicit
Claude/Codex pairs and 43 approved neutral/Codex pairs; zero pending reviews and
zero stale overrides. Nine ambiguous or mismatched candidates remain excluded.

Verification completed: deterministic-ID, policy, override, stale-member, and
agent-path fixtures; index typecheck; and the full Crawl 4 suite pass. No
production asset or client behavior changed.

#### ID4.2 - Publish and decode the optional equivalence asset

`done` (publisher landed on `main` in `691ab77`; Swift transport and decoding
landed in `a08b24c`)

Publisher completed:

- `SKILL_EQUIVALENCE_PUBLISH` is tri-state: unset is a strict no-op, `1`
  publishes, and explicit `0` or `remove` removes only the manifest entry.
- Crawl 4 and v2 receive identical hashed assets after the core data publishers.
- Unchanged content reuses its timestamp and hash; current and prior assets are
  retained.
- Full data publishes preserve the optional manifest entry and asset.
- Published-data verification accepts omission and rejects malformed, stale,
  overlapping, wrong-repository, same-SHA, or invalid-preference groups.

The Swift client now:

- supports optional per-track manifest, cache, bundled-asset, and decode paths
- couples equivalence loading to the catalog track that actually loaded
- filters stale members, dissolves groups below two live members, and applies
  the shared deterministic representative fallback
- treats missing preferred-agent keys as representative fallback and tolerates
  unknown future keys
- fails closed to separate rows without affecting catalog availability

The private decoder/view gate is complete. Keep the publication flag unset until
an explicit equivalence-data rollout is planned. Publishing the additive asset
does not itself authorize a public Mac release.

#### ID4.3 - Merged macOS equivalence view

`done` (landed on `main` in `cdc2841`; private asset-enabled app verified)

Group equivalent Claude and Codex variants for display while preserving their
separate catalog IDs, install locations, source labels, and install actions. The
local-only fallback must reproduce the documented `groupSyncedSkills` matching
spec rather than inventing a second heuristic.

The installed `All` list and its dashboard counter use logical rows. Claude,
Codex, and Other counters plus the source-specific, Linked, and Local-only lists
remain physical installation views. Merged rows expose source badges and
location menus so every physical installation remains selectable.

The implementation composes equivalence and same-catalog grouping transitively,
prefers the asset representative when installed, searches across every member,
and preserves selection when groups merge, split, or lose a member.

Verification completed: all 178 Swift tests and the release build pass. A
separately identified standalone app loaded the bundled 55-group asset with
remote refresh and updater checks disabled; the unified rows and logical `All`
counter were manually verified. No Sparkle metadata, production deploy, or
public Mac release changed.

### P3 - Portal and client correctness

#### T20 - Park dead-end icon controls

`todo`

Remove or clearly disable Editool's `sfSymbol` and `lucideIcon` controls until a
real publisher, Swift, and web consumer is planned. No current collection depends
on them.

#### T21 - Complete reserved-name policy

`done` (landed on `main` in `db757a8`)

- Split profile-handle and group-slug reservation functions.
- Add structural slug `sets` to the group boundary used by `portal-groups.mts`.
- Keep catalog creator reservations on profile claims only.
- Do not reserve unrelated system words as user handles without a documented
  brand or impersonation reason.

Verification completed: profile and group policies normalize independently,
creator handles remain profile-only, normal groups reject `sets` and `favorites`,
and the app-owned Favorites path retains its fixed slug. Focused tests,
TypeScript validation, and the full root suite pass. No database or production
state changed.

Gate: complete before public Skill Group handle/slug claims.

#### T25 - Clean orphaned install provenance

`todo`

- Remove `.omgskills/{name}.json` after an app-owned uninstall succeeds and no
  matching live installation remains.
- Keep cleanup conservative for manually deleted installations.
- Test that cleanup never removes metadata for a live installation.

Gate: include this in the next public Mac release candidate.

### P4 - Documentation and workspace safety

#### T23 - Consolidate current documentation

`todo`

- Finish and commit the accurate `/library/` and `/u/` documentation already in
  progress without overwriting unrelated local edits.
- Keep intentionally ignored `web-library.md` local unless a deliberate decision
  makes a tracked document canonical; do not restore it accidentally.
- Keep this file as the identity execution checklist while `identity.md` owns
  architecture and policy.
- Archive obsolete `next.md` material deliberately.
- Correct `audit-task.md` drift, including the retained skills.sh 50-star floor,
  the `quality-tier.ts` filename, identifying User-Agent/contact, and API-terms
  review outcome.

#### T24 - Remove confirmed-obsolete worktrees

`todo`

- Remove merged temporary worktrees for auth production, DB routing, ID0, ID1,
  ID2, and Skill Groups integration after checking each worktree is clean.
- Leave `codex/skillgroups-mvp` and the Claude worktree in place because their
  branches still contain commits not merged into `main`.
- Do not delete backup or historical branches as part of worktree cleanup.

## Active implementation order

1. T13.
2. T25, then T20 before the next public Mac release candidate.
3. T23 and T24 after current local documentation work is safely committed.

The ID4 private-client gate is complete, but `SKILL_EQUIVALENCE_PUBLISH` remains
unset. Publish the asset only through an explicitly planned data rollout. No
task in this document may implicitly trigger AUTH8 or a public Mac release.

## Verification baseline

Run the checks owned by each changed area; do not rely on stale fixed test counts:

```bash
npm test
cd index && npm run typecheck && npm run test:shadow-guard
cd ../menubar && swift test
cd .. && node scripts/build-web-library.mjs
node scripts/verify-web-library-pages.mjs
node scripts/prepare-netlify-site-deploy.mjs
```

Do not expand the web library beyond the pilot until T6, T7, and T13 are green.
Do not publish canonical identity data until ID2.2 and ID2.3 pass together.

## Deferred and closed work

These items are intentionally outside the active implementation list.

### T8 - Cross-boundary verification umbrella

`combined`

The remaining checks now belong to their owning tasks: URL-map consumer tests in
T6, full-site links and collections verification in T7, and optional SHA asset
tests in ID2.2-ID2.3. Scanner-to-upload and two-location Claude/Codex coverage
already exist.

### T9 - `/creators/*` compatibility

`obsolete`

Leave `/creators/*` removed. `/library/*` remains canonical. Reopen only if new
evidence shows meaningful external links.

### T10 - skills.sh source boundary

`done`

Keep the 50-star intake floor. Its remaining documentation corrections belong to
T23.

### T11 - Dormant crawler flag rollout

`deferred`

When resumed, enable creator watch, install admission, and momentum priority one
at a time. Define rollback thresholds first and inspect two scheduled reports
before each next flag.

### T12 - Catalog quality versus SEO

`done` (policy)

Keep `quality_tier` and `indexTier` separate as recorded in canonical boundaries.
Any future coupling is a measured SEO experiment, not required integration work.

### T18 - Optional-asset removal semantics

`combined`

The policy is resolved in canonical boundaries: manifest omission removes the
optional feature and clears its track cache. ID2.3 owns the missing behavior tests.

### ID3.1 + ID3.2 - Resolution performance hardening

`deferred`

Combine caching and off-main-actor resolution into one task only if measurements
show launch or refresh cost is material. A stale resolved ID must re-resolve when
it disappears from the live catalog; unresolved entries retry when identity
assets change.

### ID3.3 - Repository aliases

`deferred`

SHA fallback already covers most repository renames. Publish aliases only if
identity measurements show renamed repositories remain a material miss source.

### ID5.1 - Confirm-once fuzzy resolution

`deferred`

Build only if production measurements after a public client release show a
material unresolved population. Local confirmations must never become global
canonical data.

### T22 - Leaderboard display semantics

`deferred` (decision required)

Influential creators are ordered by `editorialScore` while the headline displays
stars. Choose the public meaning before changing ranking or display.

### Auth release controls

The completed implementation history and full verification matrix are archived
in `archive/new-auth.md`. The remaining active responsibilities are:

#### AUTH8 - Public device-auth Mac release

`deferred` (requires explicit release approval)

- Plan the public Mac version and release scope separately; do not bundle it into
  an unrelated web deploy or data publication.
- Use the canonical signed/notarized release flow in `deploy.md`.
- Confirm the released bundle contains the `omgskills` callback scheme.
- Re-run the auth-specific production acceptance path with a temporary device:
  pair, durable sync, relaunch/reconnect, disconnect, revoke, and reconnect.
- Confirm a legacy client still syncs during the declared migration window.
- Revoke the temporary device and verify the combined artifact, downloads,
  appcast, manifests, and generated library pages remain healthy.
- Keep rollback additive: restoring the legacy UI must not delete device rows or
  weaken device-token scopes.

Complete only after the auth-enabled Mac build is publicly released and the
post-release checks pass.

#### AUTH9 - Remove legacy one-time sync

`deferred` (depends on AUTH8 adoption)

- Define a minimum supported app version and a measured adoption cutoff.
- Preserve the legacy upload path until that cutoff and rollback window pass.
- Remove the legacy portal UI and direct-upload acceptance first.
- Retire legacy token/schema fields later through a separate additive migration.
- Verify durable pairing, upload, revocation, and reconnect remain unaffected.

Neither AUTH8 nor AUTH9 is required for the active tie-in tasks.

Run live verification only after an approved combined-artifact deploy. Never use
a partial production deploy as a verification shortcut.
