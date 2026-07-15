# Cross-Workstream Tie-In

This document is the integration backlog across Crawl 4, the editorial layer,
the web library, the macOS client, identity resolution, and Skill Groups.
Feature-specific architecture remains in the owning documents; this file tracks
only gaps where one implemented system does not safely connect to another.

Last validated: 2026-07-15 against the current working tree and live web-library
fixtures.

Status legend: `todo` / `decision` / `in progress` / `done` / `deferred`.

## Canonical boundaries

These choices are implemented and should not be reopened by the work below:

- Catalog skill IDs are the cross-system foreign key. Existing IDs are not
  renamed, recycled, or merged.
- `/library/{handle}/` is the editorial/catalog profile namespace.
- `/u/{handle}` is the portal user-profile namespace.
- `/u/{handle}/sets/{slug}` is the public Skill Group namespace.
- `/collections/{id}/` is the editorial topic-collection namespace.
- `/skills/{owner}/{repo}/{skill-path}/` is the static skill-page namespace.
- `/profiles/*` remains redirect-only. `/creators/*` is not canonical and needs
  no restoration unless we deliberately retain the few briefly public URLs.
- Editorial collections, SHA history, and future grouping data remain optional
  manifest assets. They must not redefine the core `skills.json` schema.
- Claude and Codex variants retain separate catalog IDs and install locations,
  even if a future equivalence asset groups them for display.

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

## P1 - Public web and portal contracts

### T6 - Use one catalog-ID-to-web-URL contract

`todo`

The static generator slugifies every catalog ID and adds deterministic hash
suffixes for collisions. `public-skillgroup-page.mts` independently reconstructs
URLs, does not know collision suffixes, and returns no URL for repo-level IDs.
It also links catalog IDs for which the pilot has not generated a page. The
current pilot has 58 skill pages for 44,438 catalog skills.

Proposed solution:

- Generate one `catalogSkillId -> publicPath` lookup from the builder's URL map.
- Make public Skill Group rendering consume that lookup.
- Until page coverage expands, fall back to a valid GitHub URL or plain metadata
  when the catalog ID has no generated page.
- Do not duplicate slug logic in the Netlify function.

Verify fixtures for a normal ID, repo-level ID, slug collision, unpublished
catalog ID, and local-only skill. Every link must resolve or deliberately fall
back; none may point to a 404 or the wrong skill.

### T7 - Do not link authors to profiles that do not exist

`todo`

Generated skill pages always link the author and breadcrumb to
`/library/{handle}/`, but profile pages are generated only for featured author
collections. Current generated output contains 27 broken `/library/*` links.

Proposed solution:

- Build a set of generated library-profile handles.
- Link to `/library/{handle}/` only when that page exists.
- Otherwise render plain attribution or a GitHub profile link.
- Apply the same rule to visible HTML, breadcrumbs, and JSON-LD.

Verify: a full generated-site internal-link pass reports zero missing local
targets, including non-featured authors such as `obra` and `pbakaus`.

### T8 - Expand verification across integration boundaries

`todo`

Current fixture tests pass while broken cross-system links remain. The standard
published-data verifier also checks `shaHistory` but not `collections`.

Add:

- A full-site internal-link verifier, not only fixture-page checks.
- A `collections` manifest/asset/hash/decode assertion in
  `verify-published-data.mjs`.
- Portal tests that consume the generator's URL lookup.
- Sync integration tests from resolved scanner output through upload payload.
- A two-location Claude/Codex sync fixture.
- Manifest-preservation tests for foreign optional assets.

Verify: intentionally remove a generated profile, collection asset, URL-map
entry, and one installation row in isolated fixtures; each relevant verifier
must fail clearly.

### T9 - Decide whether to preserve the brief `/creators/*` history

`decision`

`/library/` is the desired canonical route. `/creators/*` was briefly public and
currently returns 404. Restoring it as a primary namespace is out of scope.

Decision options:

- Add a simple permanent `/creators/* -> /library/:splat` compatibility redirect.
- Accept the small amount of link loss and leave it removed.

If retained, add one redirect fixture. Do not change canonicals or generated
links away from `/library/`.

## P2 - Crawler rollout and web-content alignment

### T10 - Keep the skills.sh 50-star source filter

`done` (intentional policy)

`build-shadow.ts` passes `minRepoStars: 50` to the skills.sh source. Testing
without this floor introduced too much noise, so the filter is deliberate and
should remain.

Consequences:

- Skills.sh is a quality-bounded intake source, not a complete install-ranked
  feed.
- The install-admission arm only evaluates skills.sh candidates that already
  passed the 50-star source filter.
- Low-star/high-install repositories need a stronger independent source such as
  creator watch, manual curation, trusted registry intake, or validated social
  discovery; install count alone does not bypass the source-quality filter.
- `audit-task.md` must be corrected so T2.1 no longer claims the floor was
  removed.

Remaining documentation work: add the identifying User-Agent/contact and record
the API-terms review outcome if either is still missing.

Verify: the periodic source rejects sub-50-star rows, ≥50-star rows continue to
reach candidate evaluation, and an explicit test protects the floor from being
removed accidentally.

### T11 - Roll out dormant crawler flags deliberately

`decision`

Only `CRAWL4_QUALITY_TIERS=1` is enabled in the production shadow workflow.
Creator watch, install admission, and momentum prioritization are implemented
and tested but remain disabled.

Recommended order:

1. Enable `CRAWL4_CREATOR_WATCH=1`.
2. Enable `CRAWL4_INSTALL_ADMISSION=1` with the documented 50-star intake
   boundary intact.
3. After observing resulting hotset churn, enable
   `CRAWL4_MOMENTUM_PRIORITY=1`.

Enable one flag at a time and inspect two scheduled reports before the next
change. Define rollback thresholds before each flip.

### T12 - Keep catalog quality and SEO indexability distinct

`decision`

The crawler's `quality_tier` expresses catalog/editorial confidence. The web
generator's `indexTier` expresses whether a page has enough content and signal
to enter search. They overlap but are not interchangeable.

Recommended policy:

- Keep useful-content requirements for search indexing.
- Treat `quality_tier` as a strong quality signal alongside editorial/trending
  signals.
- Do not automatically index an empty/thin page only because it is curated.
- Document thresholds and add before/after tier-count fixtures.

Verify: no useful curated page loses indexing; thin pages remain `noindex`; the
decision is deterministic and inspectable.

### T13 - Align README refresh coverage with generated pilot pages

`todo`

The weekly snippet refresh exists, so `readme_snippet` is not inert. However,
the crawler derives pilot IDs from unexpanded source topic collections, while
the generator uses expanded author collections plus the top trending head.
Only 8 of the current 58 generated skill pages contain a README section.

Proposed solution:

- Share one pilot-ID selection helper or generated pilot-ID artifact between
  crawler and web generator.
- Include topic IDs, featured-author slices, and the same trending head.
- Keep refresh weekly, bounded, and missing-snippet-only unless freshness data
  shows a need to refetch changed files.

Verify: every generated pilot skill is classified as snippet present, explicit
fetch failure, or intentionally exempt; report counts in the shadow report.

## P3 - Identity continuation

Identity architecture and policy remain in `identity.md`. This section is the
only execution checklist for the remaining identity work. Phases 1 and 2 may
proceed independently; the measurement gate blocks fuzzy matching, not
canonical SHA attribution.

### ID1.1 - Surface privacy-safe identity measurements

`done`

Implemented:

- The client emits one `identity.resolution_snapshot` per app session after a
  valid catalog load and completed installed-skill scan.
- The signal includes total installed, provenance, Git, SHA, ambiguous, and
  local-only counts, plus app version, build number, and active data track.
- A fixed parameter whitelist prevents names, paths, hashes, URLs, catalog IDs,
  or user identifiers from entering the custom payload.
- Empty installations emit a valid zero-count snapshot. Re-resolution in the
  same session does not emit duplicate snapshots.
- The optional debug-only dashboard row remains deferred.

Verification completed: a controlled emitter fixture covers the signal name,
all five buckets, total equality, track/version metadata, and exact privacy
whitelist. Store tests cover readiness gating, zero installs, and duplicate
suppression.

Gate: do not build fuzzy matching until production measurements show that the
unresolved population is material.

### ID2.1 - Validate the shadow canonical policy

`done`

The shadow policy now separates publishable identity from advisory attribution:

- identical SHAs inside one concrete repository are high-confidence and
  publishable
- a unique watched/trusted owner in one concrete repository is medium-confidence
  and advisory; watched status alone is not authorship proof
- trusted-owner candidates spanning multiple repositories remain ambiguous
- clear star leaders remain medium-confidence and advisory
- complete commit-history evidence with a unique lead of at least seven days can
  support a future reviewed promotion; it does not promote automatically
- unresolved, tied, weak-lead, and incomplete candidates remain ambiguous
- Keep canonical data additive; never remove `shaToSkillIds` membership.

Current shadow measurement: 1,898 clusters; 9 publishable same-repo mappings,
141 advisory trusted-owner candidates, 195 advisory star-leader candidates, and
1,553 ambiguous clusters. `crawl4:validate-canonical-policy` reports every
excluded candidate and verifies that canonical IDs are live, belong to their SHA
membership list, and match that SHA.

Verification completed: the read-only validator reported zero failures. A
bounded live commit audit found 2 confirmed, 1 overturned, 2 tied, and 1
incomplete trusted-owner candidates. The overturned result demonstrated why
trusted ownership remains advisory. Typecheck and all 338 shadow-guard tests
pass. No manifest, client, or production output changed.

Release gate: completed identity tasks may be landed and pushed independently,
but do not deploy canonical identity changes or release a client update until
ID2.2 and ID2.3 are both complete and verified together.

### ID2.2 - Publish additive `canonicalBySha`

`todo`

- Extend SHA history with optional entries shaped as
  `{ skillId, confidence, reason }`.
- Preserve the deployed v1 `shaToSkillIds` contract and append-only history.
- Patch both Crawl 4 and v2 manifests through the existing publisher.
- Retain current and previous assets for rollback.
- Initially publish only ID2.1's validated high-confidence same-repo mappings.
- Do not duplicate canonical fields onto every skill row unless a concrete
  consumer requires it.

Verify: old clients decode the extended asset, unchanged mappings reuse their
timestamp/hash, and live manifests reference matching assets on both tracks.

### ID2.3 - Consume canonical SHA mappings in the client

`todo`

- Decode `canonicalBySha` as optional.
- Resolve a multi-ID SHA only when a published canonical mapping is present and
  valid.
- Verify the canonical ID is live and included in `shaToSkillIds[sha]`.
- Otherwise preserve the ambiguous state.

Verify: a valid canonical mapping upgrades ambiguity to resolved; missing,
stale, or malformed entries remain ambiguous.

### ID3.1 - Persist resolution results by local SHA

`todo`

- Cache exact resolved results keyed by local `skill_md_sha`.
- Invalidate only when local content changes or the catalog ID disappears.
- Retry unresolved or ambiguous entries when catalog identity assets change.
- Do not persist fabricated or weak mappings.

Verify: unchanged installations use cached results; changed files and removed
catalog IDs re-enter resolution safely.

### ID3.2 - Keep resolution off the main actor

`todo`

- Build resolver lookups during or immediately after catalog decoding.
- Perform the bulk installed-skill pass in a detached task.
- Avoid rebuilding lookups for both deduplicated skills and installation rows.
- Use generation guards so stale background work cannot replace newer data.

Verify: launch and refresh remain responsive with the full catalog and a
50-skill fixture.

### ID3.3 - Publish and consume repository aliases

`todo`

- Publish the crawler's old-repo to canonical-repo mapping as a small additive
  asset.
- Normalize Git remotes through aliases before catalog lookup.
- Keep SHA fallback for unknown aliases.

Verify: an install cloned under a renamed repository resolves to the current
catalog ID without network access.

### T18 - Define optional-asset removal semantics

`decision`

When a manifest omits `collections` or `shaHistory`, the client currently clears
that track's valid cache. This is non-fatal, but the docs do not explicitly say
whether omission means "asset intentionally removed" or "optional enhancement
temporarily unavailable."

Choose and test one policy:

- Omission removes the feature and clears its cache, or
- Omission preserves the last valid optional cache until an explicit tombstone.

Do not let omission affect skills bootstrap, throttle, or track fallback.

### ID4.1 - Generate `skillEquivalence` in shadow

`todo`

This phase groups logical Claude/Codex variants for display. It does not replace
their catalog IDs or install commands.

- Cluster variants using strong catalog signals: same repo, upstream links,
  canonical creator identity, normalized name, and description only as a
  tiebreaker.
- Never apply the portal's loose local fuzzy rule across the full catalog.
- Emit deterministic group IDs, sorted live member IDs, confidence, and
  evidence.
- Validate after suppression filtering and before publication.

Verify: no skill appears in conflicting groups, weak matches remain ungrouped,
and manual samples contain true variants rather than same-name collisions.

### ID4.2 - Publish and consume equivalence groups

`todo`

- Publish `skillEquivalence` as an optional manifest asset, shadow-first.
- Preserve every underlying catalog row.
- Let portal and client group catalog-resolved variants from the published
  asset.
- Fall back to separate rows when the asset is missing or invalid.

Verify: both consumers produce the same group membership and degrade cleanly
without the asset.

### ID4.3 - Add the merged macOS view

`deferred`

- Show one logical skill row when catalog equivalence or the documented local
  rule links variants.
- Retain separate Install for Claude and Install for Codex actions.
- Preserve every underlying ID and installation location.
- Expose variant details when needed.

Verify: linked variants appear once while installs still target the correct
agent-specific files.

### ID5.1 - Build confirm-once fuzzy resolution only if measurements justify it

`deferred`

- Name-gate candidates before description comparison.
- Show one candidate with confidence and require explicit confirmation.
- Persist confirmed mappings locally and provide an unlink/correct action.
- Never promote a local fuzzy confirmation into global canonical data.

This task is unnecessary if exact resolution plus canonical SHA attribution
leaves an acceptably small unresolved population.

### Identity non-goals

- Do not force every local skill to map to the catalog.
- Do not upload `SKILL.md` content to the portal.
- Do not merge or delete Claude/Codex catalog records.
- Do not treat medium or weak canonical candidates as authoritative without
  validation.

## P4 - Cleanup and documentation

### T20 - Resolve dead-end icon fields

`decision`

Editool can author `sfSymbol` and `lucideIcon`, but the publisher, Swift model,
and web generator do not consume them. No current collection depends on them.

Either finish the complete data-to-client/web path with real icon values or
remove/park the controls explicitly. Do not leave fields that appear to save but
have no visible effect.

### T21 - Complete reserved-name policy

`todo`

Split the shared policy in `netlify/functions/_shared/reserved.ts` into explicit
profile-handle and group-slug boundaries. Add `sets` to the group-slug blocklist
used by `portal-groups.mts`, because it is structural in
`/u/{handle}/sets/{slug}`; do not rely on adding it to a generic handle list.

Separately decide whether system words such as `library`, `collections`,
`profiles`, and legacy `creators` should be blocked as user handles for
brand/impersonation protection. They do not create a direct route collision
under `/u/`, so document the reason if reserved.

### T22 - Clarify leaderboard display semantics

`decision`

Influential creators are ordered by `editorialScore` while the headline value
shows total stars. Either display/label the score, describe stars as supporting
evidence, or explicitly document that ranking and display metrics differ.

### T23 - Consolidate current documentation

`todo`

- Commit the accurate `/library/` and `/u/` documentation.
- Restore or replace `web-library.md` on `main`; its status branch is stale and
  still describes older routes and already-shipped SEO work as missing.
- Keep this document as the only identity execution checklist; `identity.md`
  owns architecture and policy. Archive obsolete `next.md` material
  deliberately.
- Correct `audit-task.md` status/file-name drift, including T2.1 and
  `quality-tier.ts`.
- Keep this document as the cross-workstream backlog; do not duplicate detailed
  architecture from the owning docs.

### T24 - Remove stale worktrees after confirming they are obsolete

`todo`

The old Skill Groups worktree/branch and other historical worktrees can mislead
agents into auditing stale code. Review each for unique unmerged commits, then
remove only confirmed-obsolete worktrees and archive/delete their branches.

### T25 - Clean orphaned install provenance

`todo`

Removing an installed skill can leave `.omgskills/{name}.json` behind. A future
unresolved skill with the same installation name could inherit stale identity.
Define uninstall/manual-cleanup behavior that removes sidecars only when their
matching installation no longer exists, with tests that never delete metadata
for a live installation.

## Recommended implementation order

1. Finish `new-auth.md` AUTH8 with an explicitly planned public Mac release; the
   guarded production backend, portal, and browser-pairing rollout is complete.
2. ID0.1-ID0.5 are complete. Continue with the public URL boundary work.
3. T6-T8: establish one web URL contract and complete boundary verification.
4. T11 one flag at a time, preserving the T10 source-quality boundary.
5. T13 content completeness before expanding page count.
6. ID1.1-ID3.3 plus T18: identity measurement, canonical attribution,
   hardening, and optional-asset policy.
7. T12 and T20-T25 policy/documentation cleanups.
8. ID4.1-ID5.1: equivalence grouping and any fuzzy UX only after
   exact-resolution data is trustworthy.

Do not expand the web library to the full catalog until T6-T8, T12, and T13 are
green. Do not use identity measurements to justify fuzzy matching until
ID0.2-ID0.5 are green.

## Verification baseline

The following passed during the integration audit but do not cover every gap
above:

- Root TypeScript and creator-reservation checks
- 332 Crawl 4 tests
- 146 Swift tests with complete concurrency checking
- Sync payload/parser and portal location-grouping regression tests
- Local web-library fixture verification
- Live web-library fixture verification

For completion, add the cross-boundary tests in T8 and run:

```bash
npm test
cd index && npm run typecheck && npm run test:shadow-guard
cd ../menubar && swift test
cd .. && node scripts/build-web-library.mjs
node scripts/verify-web-library-pages.mjs
node scripts/prepare-netlify-site-deploy.mjs
```

Run live verification only after an approved combined-artifact deploy. Never use
a partial production deploy as a verification shortcut.
