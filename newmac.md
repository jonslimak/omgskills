# New Mac

Design and F1 implementation plan, 2026-10-08; local acceptance passed 2026-10-09.
Code and acceptance evidence are recorded in [Connect](connect.md), the single
progress tracker. No release approval.
This document expands C17 and its Mac-side dependencies, without duplicating
status checklists. [Webwork](webwork.md) retains earlier test evidence.

**First implementation target: Connect F1, the bare-bones local flow.** One
public skill, one Mac/browser and Codex: web request, local review, install A,
then reviewed update B. Build only the required C17/C13/C10 parts. The rest of
this document describes the intended product, not prerequisites for that proof.
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

## Proposed sequence

Progress and approvals stay in Connect. These are design steps, not a second task list.

| Step | Connect owner | Exit evidence |
| --- | --- | --- |
| Settle F1's narrow contract | C17, C13, C10 | Current baseline, one write/store path and Codex destination, request shape, public A/B source and isolated test setup; code scope approved |
| Prove the bare-bones flow | F1, parts of C17/C13/C10 | Existing-app dev build; web install A and update B for one unpinned skill; apply Connect's short F1 checks; no full migration or inventory project |
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

Next: separately decide integration/pilot scope after the F1 checkpoint. The
scoped review and approved cleanup are complete; evidence is preserved in
[the F1 archive](archive/newmac-f1-2026-10-09/README.md).
Browser delivery, manual A/B acceptance, cancellation,
repeat no-op, local-edit refusal and fresh isolated Codex discovery passed on
2026-10-09. This proves one local public-skill flow, not broad coverage or release
readiness. The separate test bundle does not replace the installed app. No real
skill folder, credential, production flag, update feed or deployment was changed.
Connect and the run receipt hold progress/evidence.
