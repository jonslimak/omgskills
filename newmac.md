# New Mac

Design and F1 implementation plan, 2026-10-08; local acceptance passed 2026-10-09.
F3a local setup/retry automated and user-run acceptance passed 2026-10-09.
F3b's native HTTPS downloader is reviewed and committed as `f8a40cf0`.
Candidate-only wiring is committed as `003f94d1`. Separately approved F3b signing,
notarization, dedicated test hosting and bounded clean-VM setup passed on
2026-10-12; [evidence](archive/newmac-f3b-2026-10-12/README.md).
F2 local acceptance, scoped review and approved cleanup passed 2026-10-09.
Code and acceptance evidence are recorded in [Connect](connect.md), the single
progress tracker. No release approval.
This document expands C17 and its Mac-side dependencies, without duplicating
status checklists. The historical local `webwork.md` document retains earlier
test evidence but is not included in this checkout.

**Current target: plan a signed-candidate skill update in the retained VM.**
Scoped F3b review passed; this checkpoint records source and evidence, not a
new build or release. F1
proved one public install/update locally. F2 passed three repositories, an
independent update, repeat no-op, Codex discovery and automated name-collision
refusal. F2 is committed locally as `f7a964b0`; the
[F3 plan](#f3-first-time-setup-and-retry-plan) separates local UX proof from
real signed first-time setup. [F3a results](archive/newmac-f3a-2026-10-09/README.md)
record local acceptance, approved cleanup and scoped review, committed as
`462ac68a`. F3b proved candidate first-time setup, not a public release or
existing-user upgrade. The rest describes the
intended product, not completed C17/C13/C10 work.
Full security, compatibility and signed-release testing follows at G1-G4.

## Product decision

**Update the existing OMGSkills Mac app into a small management companion to
the website. Do not ship a second product that users must also install.**

- The website owns discovery, search, skill details, Sets and management actions.
- The Mac app receives requests, reviews and safely applies local changes,
  and reports results when connected.
- Keep the existing app identity, signing/update path and installed users' data.
  Existing users should receive a normal app update; new users install one app.
- No native skill browser, search results, discovery panels or duplicate web UI.
- Keep a menu-bar icon, a compact status menu and necessary approval/error windows.
- Public installs do not require an account, an agent or per-skill Terminal work.

"New Mac" is this document's name, not a new app name or bundle identity.

## Minimal interface

For F1, keep only a small status/version menu with Open website and Quit, plus
the install/update review and result. Pairing, login controls and updater UX
integration come later; preserve the existing code and release identity.

| Surface | Proposed contents and behavior |
| --- | --- |
| Menu-bar menu | App version; ready, busy, offline or needs-attention status; account connection state separately |
| Open website | Opens the normal web app; available even when not paired |
| Connect / reconnect | Contextual action only when needed; use existing browser pairing, not a new native sign-in screen |
| Check for updates | Existing signed app updater; distinguish app updates from skill updates |
| Open at login | Respect the user's setting and macOS approval; do not silently override a disabled setting |
| Quit | Stops the companion; does not uninstall skills or delete the connection. Coordinate with active file changes |
| Request window | Skill/Set, source, agent destination, exact version, changes and explicit Apply/Cancel; progress and truthful result |
| Recovery/error window | Specific failure, preserved state and safe next action; no blind reinstall button |

Closing a menu or review is not quitting the app. Cancel before Apply changes no
installed files. While applying, close/cancel/quit must follow the transaction's
safe boundary rather than abandon a partially written installation.
Keyboard, focus, VoiceOver and long names must work in these small surfaces.
No automatic website opening on every login, duplicate windows or persistent Dock UI.

## What to reuse

These are source pointers, not proof that the merged product works.

| Existing area | Initial approach |
| --- | --- |
| `menubar/Sources/omgskills/omgskillsApp.swift` | Keep the app lifecycle, update integration and URL entry point; replace discovery presentation with the small management interface |
| `CatalogSkillInstaller.swift`, `SkillInstaller.swift`, `ManagedSkillInstaller.swift` | Reconcile existing legacy and managed installs before selecting the shared write path; preserve working installation capability |
| `InstalledSkillsScanner.swift`, `SkillIdentityResolver.swift` | Reuse observation and identity resolution; a matching name is not ownership or verified version proof |
| `DeviceConnectionModel.swift`, `DeviceCredentialStore.swift`, `SkillSyncService.swift` | Preserve pairing, Keychain identity and supported connection state; adapt reporting only after the per-device contract |
| Group installation and subscription models | Retain snapshot/review/removal and authorization rules; connect web actions later rather than rebuild Sets |
| `UpdateInstallCoordinator.swift`, `UpdateInstallHandler.swift`, existing release scripts | Preserve the existing Sparkle channel and safe app replacement behavior |
| `Analytics.swift` / TelemetryDeck | Reuse for C16 app-side setup, install, update and failure counts; preserve existing install events when discovery UI is removed |
| `experiments/browser-handoff/Sources/HandoffCore/` and `HandoffUI/` | Reuse verified package validation, review, local-edit checks, recovery and rollback behavior where compatible |
| `experiments/browser-handoff/Sources/HelperUpdates/` | Reuse relevant busy/termination tests and safeguards; do not add a second updater, feed or signing identity |

Keep the existing AppKit/SwiftUI structure unless a targeted change genuinely
simplifies it. This is not a framework rewrite or a reason to raise the minimum
macOS version. Remove discovery-only timers after checking service dependencies.
Replacing full-catalog loading needs the explicit identity-data decision below;
removing the discovery UI alone does not remove that dependency.

### Identity matching without the full catalog

`SkillsStore` currently supplies the full catalog and SHA history to
`SkillIdentityResolver`; Connect records approximately 79 MB and 7.3 MB respectively.
The resolver uses recorded catalog identity, repository/path/name matches and
SKILL.md fingerprints, including ambiguity handling. A fingerprint-only replacement
must not silently discard those rules or label ambiguous matches as verified.

Compare server-side matching with a compact, match-only local index before
choosing. Measure payload, refresh cost, coverage and offline behavior; do not
assume the index will be small enough. Server matching also needs an explicit
privacy/consent contract: hashes can reveal installed-skill identity and are not
permission to upload private inventory. Public installs remain account-free.
Retain known managed-install records without requiring a full catalog download;
define fallback behavior for unknown or unavailable matches. Catalog matching
is separate from proving the full installed package version or ownership.
F1 uses the requested source identity and its own new install records; it does
not scan or match the user's existing inventory. This data-delivery decision
therefore does not block F1, but must be resolved before broader reporting.

### Source baseline

Source rechecked on 2026-10-08 at `03e44161` (the local `origin/main` reference
at review time). Named Swift files/helper folders, Connect G1-G4, bundle ID
`com.jonslimak.omgskills`, the `omgskills` URL scheme, existing appcast and macOS
14 minimum were confirmed. Resolver inputs, differing Codex destinations and
TelemetryDeck wiring were also inspected. Login-at-startup implementation was
not found in the inspected app/helper source; it remains work to implement.

This supersedes the draft's source checks at `58759d82` / `afa66fa4`, not their
historical evidence. It is a source review, not a live deployment or runtime
check. The working checkout remains older; refresh source/release state before
implementation rather than copying its version number or assuming it is main.

The F1 implementation plan below additionally inspects local `origin/main`
`562877c955ceebbfd2620bbdc23da52ea9be0a38` on 2026-10-08. It checks the current
app lifecycle/runtime paths, package fetcher, managed activation/provenance,
helper review code and unified web detail/data entry points. This is a scoped
source audit, not a fresh production, signing or whole-catalog verification.

## Installation and ownership contract

**One authority for each destination, not two installers competing over it.**

F1's proposed choice is the existing app's `ManagedSkillInstaller` and provenance
format, with the missing single-skill review checks added there. Do not import
the standalone helper's writer or store. C17 still needs to reconcile transaction,
journal, rollback and provenance behavior before the wider merge; F1 introduces
no migration and does not establish compatibility with every existing install.

| Installation state | Required treatment |
| --- | --- |
| Existing app-managed install | Preserve files, links, ownership, records and subscriptions. Verify compatibility before updating it |
| Legacy clone/link or unknown local install | Observe without claiming ownership. Do not move, overwrite or silently convert it |
| Standalone helper test install | Detect as a separate format. Leave intact until an explicit, tested import/retirement decision |
| New managed install | Record source identity, immutable package version, agent/root, file verification and recovery information |

Before Apply, recheck destination ownership, local edits and the exact reviewed
version. Use safe per-skill names and explicit collision handling, not the
prototype's fixed `frontend-design` destination. Keep project scope representable
in the contract; project-scoped installation is not part of this first build.
No automatic adoption or cleanup on app upgrade.

### Codex destination policy

The existing app's `SkillFilesystemPaths` installs to `~/.codex/skills`; the
standalone helper's `InstallLocation` uses `~/.agents/skills`. F1 proposes keeping
the existing app's `.codex/skills` default, under its isolated test home only.
The broader merge preserves existing installs at their recorded locations.
Do not move files or create a duplicate to normalize these roots.
Inspect both roots for same-name/source conflicts before writing;
define refusal/review behavior and test both directions. The helper already
refuses a same-name entry in the legacy Codex root, but this is not a complete
shared destination/migration policy. Verify real Codex discovery of the chosen
default before release.

### Broad catalog support is a release gate

Connect recorded 515 of 51,133 catalog entries with precomputed pins on October 8;
the standalone prototype is further limited to two skill IDs. The existing app
can also install through its legacy path, but that alone does not prove exact
review, safe managed updates or rollback for the broader catalog.

C13 must prove on-demand resolution: identify and freeze the exact commit and
package tree before approval, verify the full package, then apply those same
bytes. Never substitute a later branch head or silently fall back to weaker
safety when resolution fails. A page advertising a version must match the review.

Use a representative sample of previously unpinned skills, multi-file packages,
duplicate names and unavailable/renamed/rewritten repos. Measure request volume,
latency and GitHub throttling behavior. Do not promise all listed skills work;
missing or inaccessible sources must fail clearly without changing local files.
Full-catalog pre-pinning is not assumed necessary for this proposed approach.

## Browser request flow

F1 uses the existing `/app/` detail view in a local preview and a preinstalled
development build. The following first-time setup is a later pilot requirement,
not a download/distribution task for the first proof.

**First-time setup, before delivery:** If the app is absent or the browser cannot
confirm opening it, offer the signed app download and clear setup/retry choices.
The user downloads, installs and opens the app, accepts normal macOS/browser
prompts, then returns to the original page and retries. Preserve the intended
skill and agent, but revalidate any expired request/version before review.
Setup never applies the skill automatically and needs no account for public
content. A timeout is unknown state, not proof that the app is missing; avoid
sending an existing user through another install unnecessarily. C5/G1 and C10
must test this complete download-to-retry path.

1. The user chooses Install or Update on the website, including the intended agent.
2. The app receives and validates a bounded request. A link requests review;
   it is not permission to install, run commands or write an arbitrary path.
3. Resolve the exact package and inspect local state. Show the resulting review.
4. The user approves locally. Revalidate the review and destination, then apply
   through the single transaction path. Duplicate delivery must not apply twice.
5. Report verified completion or failure. A browser click, launch or timeout is
   never evidence of installation. Without a verified return channel, the web
   result stays unknown and the app shows the authoritative local result.

Start with account-free public URL handoff (C10). Preserve existing pairing and
Set URLs; choose/version the new request shape before implementation. Do not
register competing production handlers just to reuse the prototype's scheme.
Cold launch, repeated links, stale requests and competing app copies need tests.

Signed-in queued delivery (C18) comes after device identity and auth: explicit
device targeting, expiring requests, authorization, replay protection and
authenticated results. All paths reach the same review/transaction logic.
Treat URLs and package content as untrusted data; no embedded shell commands,
arbitrary download hosts, destination paths or credentials in handoff links.

## Background behavior and privacy

- Run in the user session, without a privileged daemon or routine admin repair.
  Login behavior is user-controlled; Quit must remain meaningful.
- Keep UI state on the main actor; keep downloads, hashing and file work off it.
  Retain task ownership/cancellation and revalidate state after asynchronous work.
- Coordinate skill writes, recovery, app replacement and termination. An actor
  alone does not protect against another process or an external file edit.
- Startup must not silently enable inventory uploads. Pairing, reporting consent,
  revocation and the existing feature gates remain separate from app availability.
- C9/C8 define per-device inventory before C7 enables uploads. Another device or
  account must not erase or inherit this device's inventory and pending work.
- A reporting failure must not undo a successful local install or trigger another
  install. Retry reporting separately; show stale/unknown status honestly.
- Background checks may discover updates. Applying skill changes still needs
  approval. Existing app-updater preferences are a separate policy to preserve
  unless explicitly changed; the prototype's manual-only updater is not inherited.
- C16 reuses TelemetryDeck for app-side outcomes. Existing install events are
  emitted in `ContentView.swift`; retain them in the shared operation flow when
  removing that UI, without double counting retries. Keep web measurement
  separate and exclude private paths, skill content and identifying inventory.

## F1 implementation plan

**Steps 1-4 implemented and locally verified; scoped review and cleanup complete.** Automated
and manual results and the implementation base are recorded in Connect. Goal: prove one
web-triggered public install A and reviewed update B using the existing Mac app
codebase. No account, agent orchestration or second helper app is required.
Connect owns progress; these steps are the implementation order, not a second
completion checklist.

### Narrow decisions

| Decision | F1 choice |
| --- | --- |
| Writer/store | `ManagedSkillInstaller`, immutable packages, activation links and `provenance.json`; no second format or legacy fallback |
| Destination | `<run>/home/.codex/skills/<safe-name>`; check `<run>/home/.agents/skills` for conflicts too. No real-home scanning or adoption |
| Source | Public GitHub repository and explicit `SKILL.md` path from catalog detail; resolve exact package coordinates locally before approval |
| Interface | One web action, a small menu and one native review/result window; no discovery, pairing or inventory services in F1 mode |
| Result | Native app is authoritative. Web says only that opening was requested; no invented success or installed badge |
| Delivery | Preinstalled local Debug build with a unique identity/scheme; no download page, signing submission or public release |

Two gaps were confirmed in source: `GitPublicSkillPackageFetcher` requires pins,
and single-skill `install` switches a recognized managed activation without a
reviewed-base/content comparison. Repeating an install also creates another
activation. Add those narrow capabilities; group-update tests do not prove them
for this entry point.

### Request and package contract

One request asks for review; the app decides whether it is an install or update:

```text
omgskills-f1://review?v=1&id=<catalog-id>&repo=<owner/repo>&path=<path/to/SKILL.md>&agent=codex[&commit=<40-hex-sha>]
```

- Use URL APIs. Maximum 4 KiB, named fields only, each once, version 1/Codex.
  Validate repository and relative path. No commands, arbitrary hosts, destination
  paths, credentials or automatic approval.
- Without `commit`, resolve the repository's default HEAD. The optional exact
  commit enables local A/B replay; the unpinned test detail does not advertise
  a preverified package. Do not weaken existing pinned flows: F1's web action is
  limited to the chosen unpinned fixture, not a new path for pinned catalog entries.
- Construct the HTTPS GitHub source locally. Derive the safe destination leaf
  from the package directory (repository name for a root skill); show both source
  and destination. Display names/catalog IDs alone confer no ownership.
- Extend the existing fetcher to resolve and read the same fetched Git objects:
  commit, package tree, SKILL.md blob and validated full package. Keep its pinned
  API compatible. Never re-fetch branch HEAD after review or fall back to the
  legacy clone installer. Retain existing package limits and validation.
- New F1 provenance uses normalized repository plus package root as source ID,
  resolved commit as release ID and catalog ID as attribution. Update only the
  matching source/target activation, never a same-name install from another source.
- A prepared review holds immutable bytes/coordinates, destination and expected
  current activation/provenance. Adapt the helper's bounded byte-based diff to
  the app's package type; do not import its writer, store or updater.
- Add reviewed apply inside `ManagedSkillInstaller`: check existing contents
  against recorded tree/blob, source and expected base when preparing and again
  immediately before switching. Refuse local edits, replaced links, unmanaged
  targets and group-owned activations. Verified identical A is a no-op, including
  activation, record and timestamp. Use existing immutable storage and atomic
  link switching; rollback UI is not part of F1.
- One active review/apply operation. Duplicate delivery focuses the same review;
  a different request does not replace it. Cancel before Apply changes no
  activation. Block competing requests/quit during Apply until a safe result.
  UI state stays on the main actor, I/O off it; stale async results are discarded.

### Four implementation steps

**1. Resolve and review without UI.** Extend
`menubar/Sources/omgskills/PublicGitHubSkillPackageFetcher.swift` and
`ManagedSkillInstaller.swift`. Add small `PublicSkillInstallRequest.swift` and
`PublicSkillInstallReview.swift` files beside them. Adapt only the needed pure
review logic from `experiments/browser-handoff/Sources/HandoffCore/InstallReview.swift`.
Keep existing catalog/group/subscription entry points compatible.

Verify with focused Swift tests using injected Git responses/local test repos:
HEAD resolution, package validation, install A, repeat-A no-op, A-to-B review/apply,
Cancel, edited A and stale-review refusal. Re-run existing fetcher, validator,
catalog, managed-installer and group/subscription tests because the writer is
shared. Passing these checks is required before moving to step 2.

**2. Add the isolated minimal Mac shell.** In `AppRuntimeConfiguration.swift`
and `omgskillsApp.swift`, add an explicit Debug-only F1 mode before normal startup.
Reuse `SkillFilesystemPaths.isolated` and injected managed-root paths. Do not
require a full catalog to satisfy the old catalog-test mode. Add
`PublicSkillInstallModel.swift` and `PublicSkillInstallView.swift` for review,
progress, no-op and results. Menu: version/status, Open website, Quit.

Add `scripts/prepare-newmac-f1.mjs` to assemble an already-built Debug executable
with its required resources/frameworks as `OMGSkills F1 Test.app`, identity
`com.jonslimak.omgskills.f1`, registering **only** `omgskills-f1`. Generate test
bundle metadata for the isolated root and local website URL: cold launch from a
browser must not depend on shell environment variables. Invalid/missing config
stops, never falls back to production paths. Leave `menubar/Info.plist`,
`menubar/build.sh`, release scripts and public appcast unchanged.
Keep the app bundle in the Debug build's ignored `f1-apps/<run-id>/` directory;
LaunchServices would not select the temporary-directory bundle for browser links.
Keep skill files, managed storage and the receipt in the isolated temporary root.

Verify runtime/parser/model tests and unchanged production defaults. F1 must not
create `ContentView` or start catalog refresh, account restoration, inventory
services, analytics or the updater. One F1 process/registration; preserve the
existing production app and URL handler. Build using the supported Mac build tools.

**3. Wire the existing web detail.** Retain `skill_md_path` in
`portal/src/app/unified/public-catalog.ts` and `model.ts`; `get_skill` already
returns it, so no backend/database change is planned. Add
`portal/src/app/unified/public-install.ts` for link construction and one optional
action in `UnifiedApp.tsx`. Supply it from `portal/src/preview/unified/main.tsx`
only when development mode, loopback hosting and a dedicated F1 flag all match.
Use the existing public-catalog proxy and signed-out preview of the same detail
component. No Clerk credentials, account writes or production session required.

Label the action `Open in OMGSkills F1 Test`; the app determines Install, Update
or Already installed. A/B selection belongs only to local test controls. Missing
source/path disables the action. Do not change production `unified-main.tsx` or
account management integration.

Verify parser/link tests, the action's F1-only visibility and no manufactured
installed state. Run portal tests/build and inspect the local detail at desktop
and narrow width. A production build must not enable the action.

**4. Run the short acceptance check.** After automated checks pass, prepare the
one build/preview and give the user the actions below. Agent verifies bytes and
records; user performs browser/native clicks. Save one test receipt, then clean
only named test files/build/server with approval. No new test framework or
telemetry project is needed.

### Test setup and acceptance

Before coding, refresh main and select an isolated implementation worktree;
do not modify this older checkout or the other agent's active preview tree.
Read-only preflight records source commit, available Git/Codex tools, loopback
port, production URL handler and the exact planned test paths. Git/Command Line
Tools availability is a prerequisite of the reused fetcher for this test, not
proof of zero-dependency setup on a fresh user's Mac.

Selected in preflight: `anthropics/skills:skills/frontend-design`,
`skills/frontend-design/SKILL.md`. Its public detail has no commit/tree pins.
The earlier brand-guidelines candidate had only one history entry at its current
path. A is `2235be7c60b551f5de82ade908fd3816455afcda`; B is
`41bbe19d1a1a7eaab5e7bb9050a417e5c6cffc8f`. Only `SKILL.md` changes; `LICENSE.txt`
is unchanged. Real-source resolution and an automated isolated install/update with
exact B-byte verification passed. No invented bytes, fixture repository or catalog
pin backfill. Manual acceptance is separate.

Freeze that unpinned detail as the local test record. The A/B control supplies
only real source commits, never tree/blob metadata or staged packages; the app
must fetch and derive these itself. Default-HEAD resolution also has automated
coverage. This proves one source's on-demand package pinning, not broad coverage,
catalog freshness or GitHub rate-limit capacity.

Use `/private/tmp/omgskills-f1-<run-id>/` for `home/`, `managed/`, test evidence
and `receipt.json`; store the app bundle under the ignored Debug build as above.
The bundle records the isolated data root. Point only the discovery-test process's `HOME`
and `CODEX_HOME` at that isolated home and its `.codex` directory. Do not link real
skill/config folders or copy user credentials. Check actual Codex discovery/path,
not an agent explicitly instructed to read the known file. Ask for human help
only if that isolated session requires sign-in.

| User action | Agent checks |
| --- | --- |
| Open A from local detail; cancel | No activation/install record; correct app/handler and no production writes |
| Reopen A; approve Install | Exact A bytes/tree/provenance, isolated Codex destination and fresh Codex discovery |
| Open A again | Already installed; activation, bytes and timestamp unchanged |
| Select B in local controls; review and cancel | Correct A-to-B diff; A remains active |
| Agent introduces one recorded edit to test A only; open B | Update refuses and preserves edit/record. Restore only that test edit from verified A bytes |
| Open B again; approve Update | Exact B bytes/tree/provenance, truthful result and fresh Codex discovery |

If creating the edit requires changing immutable-file flags, do that only in the
throwaway fixture and restore its flags afterward; never relax installer checks.
Each opening must use the same F1 app; include one cold launch. The receipt records
source/build hashes, A/B, resolved pins, test paths and outcomes. A screenshot alone
is not completion. Stop on wrong-app launches, unexpected writes, unverifiable
sources, ownership ambiguity or shared-test failures and re-plan. Full attack,
interruption, rollback, migration and release matrices remain in later gates.

Only the short checks complete F1. They do not complete C17/C13/C10, authorize a
commit/deploy/release or qualify the new interface for existing users.

## F2 implementation plan

**Implemented after approval; local acceptance and approved cleanup passed.**
Connect owns status and links the [results](archive/newmac-f2-2026-10-09/README.md).
The following retains the approved scope; only this bounded sample passed,
not broad catalog coverage or release acceptance. Source, tests and evidence
are included in the local F2 checkpoint; see the archived review note.
Baseline: F1 commit `33b659e6` on `codex/newmac-f1-core`. Recheck the
branch and working tree before starting; integration into main is separate.

### Goal and boundary

Prove three previously unpinned public catalog skills from three repositories
can coexist in one isolated Codex home, and updating one cannot change the
others. A different source requesting an occupied name must be refused.

Keep the existing `ManagedSkillInstaller`, provenance format, `.codex/skills`
destination, cross-root conflict checks and explicit local approval. No new
writer, automatic renaming/adoption, legacy fallback or migration. The browser
only requests opening; the native result remains authoritative.

Reuse one fresh `OMGSkills F1 Test.app` with its existing Debug-only identity,
`omgskills-f1` scheme and `VITE_NEWMAC_F1` loopback gate. F2 names the milestone,
not another app. No production scheme registration, real-home writes, login,
sync, Claude support, signed distribution, telemetry project or public release.

### Baseline at the F1 commit

- `PublicSkillInstallRequest.swift` accepts validated repository/path inputs;
  source identity is repository plus package root, not catalog ID or name.
  Nested targets use their directory name; root targets use the repository name.
- `GitPublicSkillPackageFetcher.swift` resolves exact Git objects before review.
  The fetch is a shallow repository fetch, not a GitHub REST pinning pipeline.
- `ManagedSkillInstaller.swift` keeps packages per source/revision and activations
  per target. Reviewed apply rechecks ownership, installed bytes and expected base.
- At F1, `portal/src/app/unified/public-install.ts` permitted only Frontend
  Design, and preview `main.tsx` applied its A/B commits globally. F2 replaced
  that coupling with validated requests and preview-only per-source cases,
  without replacing or changing the native engine.

### 1. Select and preflight a bounded sample

Use current public catalog detail records, without changing catalog/database
data or manufacturing missing paths. Select three distinct target names and
repositories; prefer new examples rather than replaying the F1 fixture.

| Slot | Required shape | Purpose |
| --- | --- | --- |
| S1 | Repository-root `SKILL.md` | Root package and repository-derived target |
| S2 | Nested `SKILL.md` | Package extraction excludes sibling skills |
| S3 | Nested package with companion text files/subdirectories | Complete package, not only `SKILL.md` |

Selected after live preflight: `blader/humanizer` (`SKILL.md`),
`vercel-labs/agent-skills:skills/writing-guidelines`
(`skills/writing-guidelines/SKILL.md`), and
`coreyhaines31/marketingskills:skills/seo-audit` (`skills/seo-audit/SKILL.md`).
`portal/src/preview/unified/f2-sources.json` binds their exact identities and
revisions; [the evidence](archive/newmac-f2-2026-10-09/README.md) records catalog
pin absence, observation times, targets, sizes and full Git manifests.
Humanizer supplies two reachable immutable
revisions A/B with a real package change; prefer a companion-file change. Never
wait for a publisher to update or rewrite a source to make the test work.

Install two sources with no commit in the browser request. For the update
source, install historical A explicitly, then request current B without a
commit. Thus each of S1-S3 exercises on-demand resolution at least once, while
the A/B transition stays reproducible. Record pinned replays separately from
no-commit requests. Freeze B at review, never refetch HEAD during apply.

Keep preflight bounded to these three slots and one update pair. Record every
rejected candidate and its reason before substitution. Root skills include the
whole repository tree under the current package rule. Current review limits
reject non-text/control-character content, changed files over 64 KiB or 2,000
lines, and aggregate before/after changed bytes over 128 KiB. Existing package
limits also apply. Do not drop companion files, trim packages, weaken limits or
silently select only successes. If a slot cannot be filled within these rules,
stop with the concrete gap and seek a revised scope. No broad crawl here.

### 2. Generalize only the development handoff

- Refactor the link builder into validated source-to-request construction plus
  a separate preview fixture policy. Do not embed three special cases in the
  native installer. Derive repository/path from catalog detail, not display text
  or a guessed split of the catalog ID; source aliases can differ from the ID.
- Keep a small preview-only registry for S1-S3: exact catalog ID, repository,
  path and optional A/B replay revisions. Require the detail to match it and
  still be unpinned. Missing/changed metadata disables the action with a reason.
  All other sources and pinned records retain their existing behavior.
- Keep the same request format, no destinations/commands/approval in links,
  and the existing development + flag + loopback checks. Validate the source
  and completed URL against the native contract, including its 4 KiB limit.
- Replace the global F1 A/B selection with per-fixture cases: Latest for each
  source and A/B only where defined. Use a validated preview case key in the URL
  so exact links survive refresh; arbitrary query text must not supply a commit
  or source. Remove the previous close/select/Back testing workaround.
- Reuse the existing detail action and native review/result. No search redesign,
  account UI or fake installed status. Keep all fixture controls out of production.

Expected code scope: `public-install.ts`, preview `main.tsx`, their tests, and a
small preview-only fixture module if needed. Extend the existing Swift request,
fetcher and reviewed-installer tests. Change native production logic only for a
reproduced in-scope failure; re-plan first if storage or ownership rules must change.

### 3. Focused automated verification

- Web: exact source/path binding, root/nested sources, per-fixture revisions,
  refresh/back behavior, invalid/oversized inputs, pinned/unlisted refusal and
  absence of the action outside the existing gates.
- Fetcher/parser: root, nested and companion-file packages through on-demand
  resolution, retaining exact coordinates and existing pinned-API behavior.
- Installer: install three sources into one temporary home; update one and
  compare the other two's bytes, links, provenance and activation counts. Reopen
  the store to verify persisted ownership and histories remain separate.
- Collision: different repositories with the same target leaf must refuse;
  also retain the unmanaged and alternate-root tests. Use deterministic local
  fixtures for this case, not another public download or a forged catalog ID.
- Reuse F1's no-op, cancel, local-edit and stale-review regressions. Run the
  affected shared installer/group suites, portal tests and production build;
  inspect generated output for the test scheme, cases and fixture revisions.

### 4. One short user-run session

Prepare a fresh isolated root and exactly one test bundle using the existing
assembler. Check the public app hash/URL handler, test identity/root, Git
availability and loopback server before asking the user to click anything.
Do not reuse the deleted F1 run or assume port 5197 is available.

Provide numbered steps with full localhost links and exact button/app names.
The user performs native approvals; the assistant checks resulting files. In
one session: install S1-S3, repeat one request pinned to its recorded installed
commit, then review/apply B for the chosen source. Compare all three states
after every operation. If HEAD
moved since preflight, stop to capture/review the new version, never substitute
it silently. Do not repeat the full F1 manual safety matrix on all three skills.

Use a fresh isolated Codex discovery process after the installs and after B;
require each expected skill at its exact path with no discovery errors. Do not
execute skill instructions, copy user credentials or start paid agent runs.
The collision check remains automated with before/after evidence; it does not
need another manual browser session.

Acceptance result, 2026-10-09: the user completed all three installs, the
recorded Writing Guidelines repeat and the Humanizer A-to-B update. Complete
bytes/modes/trees, links and provenance matched; only Humanizer's `README.md`
and `CHANGELOG.md` changed, and the other two skills stayed identical. Fresh
Codex discovery before and after B found all three enabled user skills with no
errors. Match the exact resolved file and declared plugin namespace:
Humanizer appears as `humanizer:humanizer`, not the bare folder name.
No skill instructions or model runs were used for verification.

### Exit evidence and stop rules

One receipt records the tested commit/build, catalog observations, source and
package coordinates, complete file hashes, target/provenance snapshots,
per-operation result, time and available fetch counts. Git fetch measurements
do not establish GitHub API rate capacity or catalog-scale coverage. Record
excluded packages and any limits; do not report a success percentage from this
selected sample. Three installs, one no-op, one independent update, collision
refusal and exact Codex discovery are the bounded pass criteria.

Stop on wrong-app launch, writes outside the isolated root, unexpected changes
to another skill, ambiguous ownership or a required validation bypass. Record
the failure and re-plan; do not expand into release work or repeat long runs.
After acceptance and cleanup approval, preserve evidence, remove only the named
test app/root and stop its server. Update Connect without marking C13 complete.
Review/commit, main integration, push, deployment and release are separate approvals.

Evidence was preserved and hash-verified before removing the named temporary
root and test bundle, stopping port 5197 and unregistering only the test app.
The public app's process, URL handler and executable hash were unchanged.
Full manifests, per-operation snapshots and cleanup checks are in the
[F2 archive](archive/newmac-f2-2026-10-09/README.md).

Next after this local checkpoint: F3 setup/retry below, followed by
signed pilot setup. Broader source coverage, rename/delete/rewrite behavior,
rate limits, interruption/rollback, migration and G1-G4 remain open.

## F3 first-time setup and retry plan

**F3a implemented and accepted locally, 2026-10-09.** Connect owns
progress; automated and user-run checks passed. Results are archived below.
F3b signing/distribution and manual setup require a separate plan/approval.
Source baseline: clean `codex/newmac-f1-core` at `f7a964b0`. Preserve F1/F2's
writer, request validation, destination, consent and native result contracts.

F3a verification: 249 portal tests (17 new intent/component tests), TypeScript,
34 native regression tests in seven suites, and normal/unified production
builds passed. Built output excludes F3 setup and F1/F2 fixtures even with the
preview flags set. The component was rendered in a Node test; that render does
not establish browser or native behavior. The user performed the manual checks
below; no browser automation or screenshot acceptance was used.

Historical run (now cleaned up): `/private/tmp/omgskills-f1-u0pGXL/`; server PID 66492 was at
`http://127.0.0.1:5198`. The existing assembler made exactly one
`OMGSkills F1 Test.app`, registered for `omgskills-f1` only, not launched by setup.
Its bundle is in `menubar/.build/arm64-apple-macosx/debug/f1-apps/omgskills-f1-u0pGXL/`
in the F1/F2 implementation worktree. Public app hash and `omgskills` handler are
unchanged; the test home was empty at preflight. `receipt.json`, `f3-server.json`
and `f3-preflight.json` were archived before removing that run folder; they
record preparation, not acceptance.
Historical test link (server stopped): [Writing Guidelines, recorded version](http://127.0.0.1:5198/app/preview/unified/?view=discover&skill=catalog%3Avercel-labs%2Fagent-skills%3Askills%2Fwriting-guidelines&f2case=writing-guidelines-recorded):
catalog identity/path remain unchanged and unpinned; GitHub confirmed commit
`063bee94c3f4df8453406c830b0a7df0f2860278` is reachable. Preflight itself installed
no skill; the later acceptance run below did.
The download stayed disabled; this was the preinstalled local F3a flow, not F3b.

**Manual acceptance passed, 2026-10-09.** The user confirmed retained skill/setup
after refresh, cancelled the native request, then retried and approved the
install. After cancellation, independent read-back found an empty test home
and no managed store. After installation, files/tree/provenance matched the
exact commit above (one file, 1,233 bytes), and a fresh isolated Codex
`skills/list` discovered the enabled skill without errors or model calls.
The user confirmed Already installed on repeat; independent comparison found
unchanged files, modes, links, provenance/hash/timestamp, one activation and
empty staging. Exact prompt/click counts were not collected. The public app
binary remained unchanged.

[F3a evidence](archive/newmac-f3a-2026-10-09/README.md) preserves final acceptance,
source hashes, original preflight receipts and the subsequent cleanup/review.
Approved cleanup removed only this test app/bundle, server, temporary root and
test handler. The public app and unrelated processes were preserved. Scoped
review found no blocking issue; 249 portal tests, TypeScript and both production
exclusion builds passed again. This is the local F3a checkpoint, not a release.

### Goal and narrow scope

Prove a signed-out user can start from one skill page, obtain and open the
companion when needed, return to that same skill and retry successfully.
Existing users can open their app without downloading another copy. No agent,
account pairing, per-skill Terminal commands or automatic skill installation.

Use one previously verified F2 source and Codex only. Prefer Writing Guidelines
at its recorded revision, after checking that the catalog identity and source
are still available. This measures setup, not another catalog sample or A/B run.
No inventory, remote requests, server callback, presence-detection service,
updater change, migration or public rollout in this slice.

### Why there are two stages

At the F2 baseline, `UnifiedApp.tsx` had a direct Open button and a validated
`developmentInstallLink`, but no setup state. F3a adds that state without changing
the test assembler: `prepare-newmac-f1.mjs` creates a
temporary root, embeds it in an ad-hoc signed Debug bundle and registers the
bundle before the test starts. `AppRuntimeConfiguration.f1Mode` requires that
root to exist and allows only the F1 identity/scheme and loopback website.
The generic web download link points to the current public app, not this build.

Therefore the current assembler cannot demonstrate a clean user's download and
first launch. Do not label a preinstalled Debug test as setup acceptance, link
the old standalone helper as a substitute, or send testers to the public app.

| Stage | Deliverable | What it does not prove |
| --- | --- | --- |
| F3a: local setup/retry UX | Real detail-page retry flow, retained intent, deterministic fallback tests and one user-run retry with the isolated app | Download, quarantine/Gatekeeper, clean-machine launch or signed distribution |
| F3b: signed first-time setup | Approved merged-code candidate; real download/open/return/retry in a clean macOS user/environment | Existing-user upgrade, full G1/G2, broad coverage or rollout |

### F3a flow and retained intent

1. The eligible detail page offers **Open in OMGSkills** (use the exact test-app
   name in preview) and a separate **Set up OMGSkills** action. Setup is always
   available; do not wait for a guessed app-detection timeout.
2. Opening stores the pending intent before requesting the existing URL scheme.
   Keep the page and show **Opening requested**, **Try opening again** and setup
   help. Browser focus, visibility, elapsed time and user confirmation prove
   neither presence nor installation. Never auto-retry a scheme or download.
3. Setup stays within the detail flow: **Download for Mac**, open the downloaded
   app using normal macOS steps, then return to this page and **Try opening
   again**. Preserve the selected skill and Codex throughout. For F3a, the
   download control is explicitly unavailable until an approved candidate
   exists; test its navigation through a test adapter, not a misleading ZIP.
4. Retry reloads current detail and revalidates the source and intent, then
   requires a fresh explicit Open click if async work has finished outside the
   original browser gesture. It must never silently switch skill/repository/path.
   Invalid or unavailable metadata disables opening with a reason. A changed
   identity requires a fresh selection. An advertised commit stays exact;
   Latest may resolve again but the app freezes and reviews its result before Apply.
5. The same native review requests consent. Cancel leaves skills untouched;
   Apply uses the existing writer. After returning to the web, the result remains
   **Check the app for the result** without a verified completion channel.
   A repeated opening must not apply twice or create a second app instance.

Use the existing detail URL for shareable skill selection. Store only one
versioned pending intent per browser tab in `sessionStorage`: catalog ID,
validated repository/path, agent, optional advertised commit, return route and
creation time. Do not persist a trusted executable link, destination, credential,
approval or installed status. Keep this logic in one small module and rebuild
requests through the existing validator after detail refresh. Restrict return
routes to the current same-origin app; artifact URLs come from trusted build
configuration, never query parameters or skill metadata.

Expire pending intent after 24 hours; keep the detail page but require a new
explicit selection/action. Clear on web-side Cancel/reset or deliberate skill
change; native cancellation is not observable by this web flow.
Refresh/back retains matching unexpired intent. Other tabs remain independent.
If storage is blocked, retain in-memory intent and the detail URL; do not block
manual retry or pretend reload restoration worked. No cross-tab/browser resume
or native "return to browser" protocol is needed in F3a.

### F3a implementation and checks

Keep production unchanged: inject the new setup/retry action through the existing
development + flag + loopback boundary. Extend `UnifiedApp.tsx` narrowly; keep
state/validation in a small adjacent module, preview wiring in
`portal/src/preview/unified/main.tsx`, and focused tests in `portal/tests/`.
Reuse `public-install.ts` and F2's fixture identity, not another native parser,
allowlist or writer. No new native service or packaging change in this stage.
In this gated preview, prevent the existing Get the Mac app CTA from sending
testers to the old public binary; leave the production CTA unchanged.

Automated checks cover fresh/opening/setup/retry/expired states, denied or absent
handler with unknown outcome, restored/invalid intent, metadata mismatch,
fixed-commit preservation, Latest review, storage failure, tab independence and
no automatic launch/write/download. Verify setup URLs cannot be injected and
production builds contain no test scheme, fixtures or enabled setup action.
Run portal tests, typecheck/build and relevant native request/no-op regressions.

One short user-run session uses one fresh isolated test root/bundle and browser.
Check the server and exact handler before giving one clickable skill-detail URL.
Open setup help; refresh and return to the same detail; explicitly retry; cancel
the native review once, then reopen and approve. Read back exact bytes, records,
links and Codex discovery; reopening afterward must be a no-op. Record clicks,
browser prompts and any extra user work. Simulated missing-app states are labelled
as such; F3a does not require deleting or disabling the user's normal app.

### F3b prerequisites, then real acceptance

After F3a, inspect current main/release state and propose the narrow signed-candidate
plan before changing packaging or hosting. A distributable build must create its
own user-owned storage, launch without an assembler-created root, and preserve
the existing app's production identity/update path for the eventual release.
Do not weaken F1's Debug guard or register a competing production handler on the
working Mac. Choose an isolated signed-test identity for limited evidence or the
intended identity in a clean user/environment; state which was actually tested.

Reuse signing/notarization and controlled hosting infrastructure, but sign/verify
the integrated candidate, not the earlier standalone binary. Require an exact
artifact filename, version, digest, minimum OS/architecture and verified download
URL before enabling Download. Make setup instructions match the chosen ZIP/DMG
and final app location. Respect quarantine and normal browser/macOS approval;
no Terminal bypass, local-skill reset or public Sparkle/feed replacement.
Audit runtime prerequisites, including the current Git-based fetcher: a developer
Mac having Git does not prove a clean Mac works without developer-tool installation.
If setup needs additional tools, signing access or storage changes beyond this
approved candidate scope, stop and re-plan rather than hide the extra friction.

In that clean environment, prove absence first, then download, open, return to
the unchanged page, retry, review and install; repeat with the app quit to check
cold opening without another download. One Safari run is enough for the initial
proof; Chrome and the full failure/upgrade matrix remain at G1/G2. Record all
prompts, app copies/processes, exact installed content and discovery. The app
must not write a skill merely because it launched. Never reuse F3a's simulated
fallback as evidence of first-time setup.

### F3b local candidate plan and prerequisite hold

**2026-10-09: native HTTPS dependency slice committed; candidate wiring tested
locally.** Approval covers the recorded local preparation plan, downloader/tests
and candidate-only wiring, not an ordinary app runtime/default switch.
It does not authorize signing, Apple submission, uploading,
hosting, an installed-app replacement, a public feed change or release.
Source baseline is the clean F3a checkpoint `462ac68a` on
`codex/newmac-f1-core`; refresh main/release state before external preparation.

#### Confirmed prerequisite

The audited F3a path was not dependency-free:

- F3a's `PublicSkillReviewService` directly used `GitPublicSkillPackageFetcher`.
- `GitCommandRunner` defaults to `/usr/bin/git`. Package resolution uses Git
  to fetch a commit, inspect its tree and read every package blob.
- The runner's executable-file check does not establish that developer tools
  are installed. [Apple's command-line tools documentation](https://developer.apple.com/documentation/xcode/installing-the-command-line-tools/)
  says invoking Git on a fresh macOS installation prompts for Command Line Tools.
- Existing fetcher tests also build their repositories with system Git; their
  success is not a no-developer-tools proof. A fresh user on this developer Mac
  still shares the machine's tools.

This is source inspection plus vendor documentation, not a fresh-Mac run.
The approved dependency slice implements native HTTPS without bundling Git.
The candidate-only service now selects it; ordinary app/F1 defaults stay Git.
No candidate app bundle/package is prepared yet.
Do not remove developer tools from the working Mac or silently add them as a
user requirement.

The approved choice is an isolated native HTTPS implementation with no
pre-pinned-catalog requirement. See the checkpoint below before integration.

#### F3b HTTPS downloader checkpoint

Implemented and reviewed on `codex/newmac-f1-core`, committed as `f8a40cf0`
above `462ac68a`:

- New `HTTPPublicSkillPackageFetcher.swift` and `PublicGitHubHTTPClient.swift`
  in `menubar/Sources/omgskills/`; two matching test files. No existing runtime,
  installer, validator, release script, URL handler or dependency was changed.
- Resolve a public repository's default-branch head once (or an explicit commit),
  walk verified ancestor trees and fetch the complete selected tree. Download
  raw files at that immutable commit, not one REST blob call per file. No
  catalog pin, MCP response, account, helper subprocess or Git process is needed
  by the HTTPS implementation.
- Reuse the existing blob/full-tree validator and standard package limits.
  Preserve binary bytes, executable modes and literal Unicode/reserved URL path
  characters. Metadata is limited to 2 MiB/response; selected paths to 1,024 UTF-8
  bytes and 32 components. Truncated metadata, redirects, links, submodules,
  missing/corrupt data and exceeded bounds fail closed. Downloads are bounded,
  credential-free and cancellable; no automatic retries or Git fallback.
- The HTTPS response binds commit to root tree; ancestor/package hashes are
  checked locally. This is not independent commit-signature verification.
- Focused native regression run: **76 tests reported passed across 11 suites**;
  the opt-in live test was disabled in that run. Install, repeat no-op, reviewed
  update, cancel, local-edit protections and failure preservation use temporary
  roots. Binary fetch coverage does not broaden native review: its existing
  binary/large-diff refusal remains. Release configuration also compiled.
- Separately enabled live comparison: Writing Guidelines resolved to commit
  `063bee94c3f4df8453406c830b0a7df0f2860278`, package tree
  `17d954cadfb8dec50bf0c707c9e7634be9ae9fe8`. HTTPS and the existing Git fetcher
  returned identical coordinates, modes and bytes: **1 file, 1,233 bytes,
  4 REST requests and 1 raw download**. Passed in 1.946 seconds on this Mac.
  Git was used only as the comparison oracle, never by the new downloader.

The ordinary new fixtures need neither Git nor network, except the explicitly
named Git parity test. Live reproduction from `menubar/` is opt-in:
`OMGSKILLS_HTTP_PACKAGE_LIVE_TEST=1 swift test --filter HTTPPublicSkillPackageFetcherTests/livePublicSourceMatchesGitAtResolvedCommit`.
The two new test suites are `HTTPPublicSkillPackageFetcherTests` and
`PublicGitHubHTTPClientTests`; related existing installer/model/validator tests
also ran. At that commit all app construction sites still chose Git; the
follow-on candidate-only wiring below changes only the setup-test service.

Limits: one public-source live comparison is not full-catalog or rate-capacity
proof. An install uses root depth + 2 REST requests plus one raw download per
file. GitHub's unauthenticated REST limit is
[60 requests/hour per IP](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api);
raw delivery can also fail or throttle. Renamed repositories that redirect are
currently refused, not silently followed. API version `2022-11-28` remains
[supported](https://docs.github.com/en/rest/about-the-rest-api/api-versions).
Fresh-Mac setup, production integration, broad source coverage and signed
distribution remain open. No production default switch.

#### F3b candidate wiring checkpoint

Implemented and reviewed locally above `f8a40cf0`, recorded with this checkpoint:

- `OMGSKILLS_SETUP_TEST` is a separate compile flag, including Release builds.
  Startup requires exact bundle ID `com.jonslimak.omgskills.setuptest`, sole
  scheme `omgskills-setup-test` and an approved website origin. Missing/mixed
  configuration fails closed; ordinary builds cannot enable it through a plist.
  F1 retains its Debug-only temporary-root guard and Git implementation.
- `SetupTestRuntime.swift` derives storage from the current user's home.
  Launch creates only candidate state; the reviewed writer owns skill creation.
  Files/redirected directory chains are refused. Native review/model/writer
  are reused through `PublicSkillPackageResolving`; setup-test selects HTTPS.
  The startup/URL branches precede production services, with no candidate
  activation of discovery, account, analytics, login startup or updater.
- Local browser preview selects `VITE_NEWMAC_SETUP_TEST=1`, mutually exclusive
  with `VITE_NEWMAC_F1=1`; DEV and loopback gates remain mandatory. Test links,
  labels and saved intent use the selected fixed client. Source/commit checks,
  explicit retry/open and native consent remain; Download is still disabled.
- Verification: 96 native regressions passed (15 suites); 7 focused tests also
  passed in the setup-test Release configuration. All native writes used
  temporary homes. 251 portal tests passed, including rendered setup states
  for both clients. Standard and unified production portal builds passed with
  the candidate preview flag present; neither output contained test handlers.
  The ordinary Mac Release build passed; symbol inspection confirms the test
  installer UI is absent there and present only in the candidate Release build.
  A temporary-home fixture normalization issue was corrected without weakening
  the runtime destination guard.
- No app bundle/DMG, Developer ID signing, notarization, registration, app launch,
  real-skill writes, hosting, push or release. The installed public app binary
  retains SHA-256 `34f3aa9b7a96766463f7e827e521e20a4282c3ff2f71bdbe2bec9b1bc44065b1`.
  New browser handoff/cold launch and fresh-Mac acceptance have not run.

Scoped review found no blocking issues or required source fixes. The 96 native,
7 candidate-release and 251 portal checks passed again before committing.

That wiring checkpoint is committed as `003f94d1`. The local assembler checkpoint
below follows it; compiled tests are not distribution proof.

#### F3b local packaging checkpoint

Historical pre-signing checkpoint; superseded by the
[signed candidate result](#f3b-signed-candidate-acceptance-2026-10-12).
The root resource links described here were later rejected by signing and
removed; the accepted candidate uses standard Contents/Resources layout.

2026-10-12: approved local packaging is implemented, inspected and reviewed,
recorded with this checkpoint.
`scripts/prepare-newmac-setup-test.mjs` builds the arm64 Release executable with
`OMGSKILLS_SETUP_TEST` and locked dependency resolution, then creates a fresh
output directory. It never replaces earlier candidates, signs, registers,
launches, installs or publishes an app. Its companion `.test.mjs` has 10 passing
checks; the 7 setup-test Release tests passed again using temporary homes.

- Fixed `OMGSkills Setup Test.app`, `com.jonslimak.omgskills.setuptest`,
  `omgskills-setup-test`, version/build `0.1.0` / `1`, macOS 14+, arm64.
  Read-only handler lookup found no existing registration for this identity.
  Metadata validation rejects alternate identities/schemes, update feeds and
  machine-specific home/destination settings.
- The copied executable uses bundled Sparkle and system libraries. Only the copy
  has its developer-toolchain search path removed and bundled-framework path
  added. All bundled executables contain arm64 and support macOS 14.
  Sparkle remains a linked dependency, but candidate startup does not activate
  its updater; no feed/key is configured. No runtime activation test was run.
- All three SwiftPM resource bundles are copied byte-for-byte. Internal relative
  links preserve the generated accessors' app-root lookup, avoiding dependence
  on their developer-machine fallback. No catalog, test bundle or Git tool is
  copied. Framework symlinks stay internal; copied bytes/modes are checked.
  Compiler debug/fallback strings can still name the build machine; they are not
  configured runtime destinations or loader dependencies. Fresh-Mac behavior is
  still unproven.
- `source-manifest.json`, `artifact-manifest.json` and `receipt.json` record the
  native sources, dependency lock, assembler/test hashes, build flags, metadata,
  per-file hashes/modes/links and pre/post-packaging executable hashes. The source
  manifest explicitly records base `003f94d1` plus uncommitted assembler files;
  this is not a reproducible committed release claim.

Historical local output, relative to this worktree:
`menubar/.build/setup-test-packages/candidate-bA7JPv/OMGSkills Setup Test.app`.
Manifests and receipt are in the same `candidate-bA7JPv` directory.
Packaged executable SHA-256:
`67fdb1b61c832935f699ea753514160bbe3c391caf7657a5a05e71dcfe3a3f99`.
Source manifest SHA-256:
`5b4a6385d83fb4815e7efaadad5a2b399bfe7a84fb0cab4c99aff00d550ccae2`.
Artifact manifest SHA-256:
`6fbaaa968f5bb39c2289821550bc127b384c2e36d5045e4b63c50946d5a858d7`.
The earlier inspection output `candidate-mIh4Ck` is retained, not registered or
launched; it is superseded by `candidate-bA7JPv`. No prior output was deleted.

The configured website is the local preview
`http://127.0.0.1:5198/app/preview/unified/`; no server was started. The app has
not been opened. Compiler ad-hoc and upstream framework signatures may remain;
the assembler does not perform signing and the bundle is not Developer ID
signed, notarized or ready for distribution. No DMG or Download link exists.
No public app, real skill folder, hosting, production configuration or release
was changed. The public app binary still has the SHA-256 recorded above.

Scoped review found no blocking issues or required source fixes. The 10 packaging
tests and 7 candidate-release tests passed again; saved source inputs, package
bytes and manifests were reverified without launching or rebuilding the bundle.
The artifact retains its original pre-commit provenance; this source checkpoint
does not turn it into a signed or freshly rebuilt release.

Next at that checkpoint: plan signed acceptance separately. Agree
the browser test URL and approve Developer ID signing/notarization, controlled
hosting and fresh-Mac acceptance. Do not distribute this local inspection bundle
or count inspection as install/setup proof.

#### Candidate contract after the dependency decision

One Mac architecture (arm64), macOS 14 or later, Codex, Safari and the recorded
Writing Guidelines source from F3a. No new source sample or A/B test here.

- Local candidate app: `OMGSkills Setup Test.app`; bundle ID
  `com.jonslimak.omgskills.setuptest`; URL scheme `omgskills-setup-test`.
  No existing handler was found during local packaging. Recheck the clean test
  environment before installation. Never claim `omgskills`.
- Local version/build: `0.1.0` / `1`; proposed distribution filename
  `OMGSkills-Setup-Test-0.1.0-arm64.dmg`. Only the pre-signing inspection bundle
  exists; the DMG and download link remain planned.
- Reuse the existing-app review/model/writer, not the old standalone helper.
  Add an explicit candidate build configuration instead of relaxing F1's
  Debug-only temporary-root guard. Ordinary production builds remain unchanged.
- On first launch create the candidate's own per-user state under
  `~/Library/Application Support/OMGSkills Setup Test/`. No assembler-created
  root, machine-specific path in the bundle, environment-variable setup or
  browser-provided filesystem destination.
- In the separately approved disposable macOS environment, use that user's
  `~/.codex/skills` destination and candidate-owned managed store. Display the
  destination for consent. Do not touch the working user's real skills or adopt
  existing installs; stop on a destination collision. Automated tests inject
  temporary paths.
- The candidate has only status/version, Open website and Quit, plus native
  review/results. No discovery, account pairing, login startup, telemetry or
  updater activation in this test. Opening the app alone installs nothing.
- The browser retains F3a intent/revalidation behavior. Add a separate test-only
  identity/URL mapping; do not globally replace the F1 scheme. Download remains
  disabled until the exact signed artifact, digest and approved HTTPS URL exist.

#### Implementation order and verification

1. **Review the dependency slice (done locally).** Native HTTPS is approved,
   reviewed and committed as `f8a40cf0`. Do not mistake
   parity on this developer Mac for signed setup without developer tools.
2. **Prepare local runtime and handoff (implemented and reviewed locally).** Scope changes to runtime configuration,
   app launch/URL dispatch, reusable review composition, preview identity mapping
   and their tests. Test first launch without pre-created storage, invalid or
   redirected storage refusal, correct handler/identity,
   cancel/no writes and unchanged ordinary production behavior.
   Automated checks passed above; actual browser/cold URL delivery remains
   part of later candidate acceptance, not a claim from source inspection.
3. **Prepare packaging only (implemented and inspected locally).** The narrow candidate assembler has source and
   output manifests, fixed identity, dependencies, minimum OS and architecture.
   Reuse existing signing/verification primitives later; do not invoke the public
   release script as-is or repoint the standalone helper's updater/hosting.
   Packaging tests must reject production identity, feeds and machine paths.
   Local preparation neither launches/registers the candidate on the working
   account nor enables a download.
4. **Review before external work.** Run relevant native and portal tests,
   production builds/exclusion checks and package inspection. Record exact
   source/artifact hashes. Stop for additional runtime tools, unsafe writes,
   a second unintended app identity or unexpected signing requirements.
   Review/commit, signing/Apple submission, and controlled hosting remain
   distinct approval steps.

#### Later signed acceptance, separately approved

The following plan was subsequently approved and exercised on 2026-10-12;
results and limits are recorded in the next section.

Use a clean macOS environment without developer tools; a new user alone is not
enough to establish that prerequisite. Confirm the test app/handler and target
skill are absent. Use a supported Codex installation for the discovery check,
without copying the working user's credentials or invoking a model.

Give the user one skill-page link and exact artifact/app names. In Safari:
download the verified DMG, copy the app once to `~/Applications`, eject the DMG,
open that final copy through normal macOS approval, return to the original
page, retry, review and approve. Never run the app from the mounted image or
pre-register it with a setup script. Record actual prompts, clicks, app paths
and process count rather than assuming how macOS behaves.

Verify exact commit/tree/files, one installation and Codex discovery. Quit the
app, retry from the same page, and verify cold launch reports Already installed
without repeating app setup or replacing the installed skill. Retry currently
re-fetches package metadata/content before determining the no-op; zero network
activity is not proven or promised. No Terminal-based installation or Gatekeeper
bypass is allowed. Post-install read-only diagnostics are separate evidence,
not user setup requirements.
Archive the result; cleanup requires an exact inventory and separate approval.
This proves candidate first-time setup only, not production identity migration,
Sparkle upgrades, all architectures, other browsers or G1-G4 completion.

#### F3b signed candidate acceptance, 2026-10-12

**Bounded candidate setup passed.** Full observations and machine-readable
verification are preserved in [the archive](archive/newmac-f3b-2026-10-12/README.md).

- Candidate `38Efxz`: `OMGSkills Setup Test.app`, version/build `0.1.0` / `1`,
  arm64, separate `com.jonslimak.omgskills.setuptest` identity and scheme.
  Apple accepted both app and DMG; signatures, stapling, Gatekeeper and signed
  payload equivalence were checked. The prior root-link packaging failure was
  fixed, with regression tests; no bypass was used.
- Dedicated unlinked/noindex test site:
  `https://omgskills-setup-test-f3b.netlify.app/app/preview/unified/`.
  The candidate is not the public app and this site is not production `/app/`.
  Hosting, package hashes and Apple submission IDs are recorded in the archive.
- In `OMGSkills-F3b-Test-01`, without developer tools: absent-handler retry,
  Safari download/resume, copy to `/Users/omgtest/Applications`, eject and normal
  macOS Open approval worked. The app initially showed Ready without installing.
  Original Writing Guidelines request survived setup and required revalidation,
  explicit Open, Safari Allow and native Install in Codex approval.
- Installed commit `063bee94c3f4df8453406c830b0a7df0f2860278`; one 1,233-byte
  `SKILL.md` matches the pinned public source. Commit/tree/blob provenance,
  Codex destination and the managed link were independently read back.
  Codex listed Writing Guidelines after refresh; no model was invoked.
- Quit/reopen through Safari reported Already installed. A subsequent measured
  warm retry preserved skill/provenance hashes, inodes, modification/change
  times and the activation link. One candidate process ran from the final copy.
  This proves no skill replacement in the sampled retry, not absence of all
  temporary writes or network requests. The downloader revalidates package data.
- Post-install diagnostics used only built-in read-only commands. A request for
  Terminal access to Downloads was declined; guest DMG hashing was not completed.
  Host/hosted DMG hash and normal guest Gatekeeper evidence remain available.

The candidate, VM and hosted artifacts are retained, not cleaned up. The signed
build used then-uncommitted packaging/web inputs on base `dd1e7828`; signed
manifests retain those actual inputs. The reviewed source checkpoint does not
retroactively turn it into a clean reproducible release build. No host skill,
production website, public app identity or Sparkle feed/release was changed.

Scoped review found no blocking issues. The 16 package/page tests, 29 native
tests and test-page TypeScript check passed; one optional live-network test was
skipped. Retained artifact digests, native source inputs and local links matched.
The native test build was rerun; no new app package, signing or deployment.

Next proposed slice: a browser-triggered skill A/B
update using the signed candidate, with Cancel preservation and independent
Apply verification. It is not yet prepared or run. Existing-user migration,
Sparkle app upgrades/failures, other browsers/architectures and G1-G4 remain open.

### Evidence, cleanup and stop rules

Archive stage-labelled build/source hashes, exact URLs/artifact names, intent
transitions, before/after file checks and user outcomes. Connect records F3a and
F3b separately; neither automatically closes C5/C10/C17 or G1-G3. Preserve the
public app/handler and real skill roots. After approval, remove only inventoried
test artifacts and stop that test server; the old F2 server/root are already gone.
Stop for wrong-app launches, changed source identity, unexpected writes, lost
intent, false success, extra app copies or required security bypasses. Fix and
retest only the failed step. Commit, integration, hosting and release stay separate.

## Proposed sequence

Progress and approvals stay in Connect. These are design steps, not a second task list.

| Step | Connect owner | Exit evidence |
| --- | --- | --- |
| Settle F1's narrow contract | C17, C13, C10 | Current baseline, one write/store path and Codex destination, request shape, public A/B source and isolated test setup; code scope approved |
| Prove the bare-bones flow | F1, parts of C17/C13/C10 | Existing-app dev build; web install A and update B for one unpinned skill; apply Connect's short F1 checks; no full migration or inventory project |
| Prove a small multi-source sample | F2, parts of C13/C10 | Three isolated installs, one independent update, name-collision refusal and fresh Codex discovery; no broad coverage claim |
| Prove setup and retry incrementally | F3, C10 then C5/C17 | F3a local retry/intent proof, then separately approved F3b signed download/open/return/retry; no preinstalled-build shortcut |
| Harden and verify setup for a controlled pilot | C17, C13, C10, C5, C16, G1-G3 | Wider source coverage, lifecycle, setup/retry, signing, upgrades, security/failure checks and measured user flow |
| Roll out to existing users separately | C5, C1-C3, relevant G1-G3 | Preserved existing-user data and behavior, agreed web discovery replacements and explicit release approval |
| Add connected management | C9, C8, C6-C7, C14, C18, C11, C15 | Device/account isolation, truthful inventory, queued requests, Sets and explicit management; private rollout separately meets G4 |
| Retire old surfaces and artifacts | C12 | Replacement behavior and migration proven; separately approved scoped cleanup |

Do not publicly replace existing users' discovery interface until the agreed web
search/discovery replacements (C1-C3) are usable and linked. An isolated public
install pilot can precede complete discovery parity; it is not approval for a
broad existing-user rollout. Preserve legacy data and hosted release artifacts
until their retirement is separately justified and approved.

## Verification and stop conditions

F1 uses only Connect's short functional checks and existing safety protections;
it is not a security review or release qualification. Do not disable validation,
local consent, isolation or no-overwrite behavior for the proof. Log a short
receipt rather than build new telemetry or repeat every prior fixture.

For later pilot/release work, use Connect G1-G4 plus focused tests per slice.
Cover Safari/Chrome cold/warm opening, duplicate copies, review/cancel,
local edits, restart/interruption, offline/revoked sessions and update/quit
coordination. Prove package bytes, records, links and unrelated skills are
preserved; a screenshot or successful build is insufficient.

Start with temporary roots and a separate development identity/scheme/store.
Never let the test build steal production link handling or operate on real skill
folders without a separately approved manual test. The final signed upgrade
test must exercise the actual intended app identity through the guarded release
procedure. Give the user short manual steps with exact app and file names.

Stop and re-plan for ambiguous ownership, incompatible stores, unverifiable
packages, wrong-app launches, unexpected writes or loss of supported behavior.
App recovery/rollback and skill rollback are different; neither permits a blind
binary downgrade or replacement of the good public feed with a negative fixture.

## Decisions by milestone

F1 step 1 implements the approved narrow answers to 1, 3 and the request part of
4. Later steps still need approval. Decisions 2 and 5 belong to inventory work;
6 belongs to pilot/rollout. Do not make them all F1 blockers.

1. Which managed transaction/store implementation is authoritative, and what
   narrow adapters are needed? No automatic legacy adoption in the initial slice.
2. Identity matching: server-side lookup or a match-only local index? Compare
   coverage, privacy/consent, offline fallback and measured transfer cost while
   preserving existing resolution and ambiguity rules.
3. Which Codex root is the default for new installs? Preserve recorded locations
   and specify cross-root collision handling without automatic migration.
4. Exact request contract and target selection. F1 starts in `/app/` detail with
   an app-local result; verified web status and static-page expansion come later.
5. First-release inventory observation and management scope; what remains
   read-only or gated? Decide cadence/retries before enabling background reporting.
6. Login onboarding/defaults and existing-user transition messaging; preserve
   explicit opt-outs and distinguish Quit from disabling future login startup.

Next: follow [Connect's active queue](connect.md#current-next-task): plan the
signed-candidate skill-update check after this reviewed F3b checkpoint.
Current production app defaults still use Git; candidate HTTPS setup evidence
does not change them. F3a local acceptance, approved
cleanup and scoped review passed; [results](archive/newmac-f3a-2026-10-09/README.md)
are committed with the source in `462ac68a`.
F2 is committed
as `f7a964b0`. Its automated and user-run acceptance passed locally; evidence is
saved, scoped review passed and approved cleanup is complete. F1 is committed
as `33b659e6`; its earlier scoped review and cleanup are complete.
[F1 evidence](archive/newmac-f1-2026-10-09/README.md) retains cancellation,
local-edit and A/B checks; [F2 evidence](archive/newmac-f2-2026-10-09/README.md)
adds three-source coexistence and an independent companion-file update.
Neither proves broad coverage, existing-user migration or release readiness.
The candidate did not replace the host's public app. Only the guest test skill
and dedicated test deployment were created; production flags, update feeds and
host skill folders were not changed.
Connect and the archived receipts hold progress/evidence.
