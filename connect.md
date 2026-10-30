# Connect

Started 2026-10-08. **Single active work tracker** for the web-first experience
and one Mac management app. The user approved consolidating unfinished
`webwork.md` work here on 2026-10-08. This is the full transition checklist;
the first milestone is a bare-bones local install/update proof, not a release.

Initial source audit: `origin/main` `a8ab048e`; later evidence is dated below.
`webwork.md` and its linked specs retain historical decisions and test evidence,
not a second active queue. The local-only `newmac.md` holds the initial C17
design and migration plan, not a separate tracker. It is intentionally excluded
from this public repository; references below are not repository links.
`appwork.md` retains detailed
unified-web UI work; `webdown.md` retains broader hypotheses.
New Mac's targeted source recheck at `03e44161` and F1 plan audit at `562877c9`
supplement that initial audit; they do not reverify every web status or establish
current production behavior.

Implementation status: `[x]` implemented; `[~]` partial; `[ ]` missing;
`[p]` planned only. These marks do not mean deployed or verified in production.
Deployment and acceptance evidence are tracked separately below. `[-]` means
deferred; superseded tasks are explicitly labelled, never marked completed.
This consolidation changes documentation only, not implementation or release state.

## Current next task

- **Next: plan a bounded G2 updater-failure check; approve execution separately.**
  F3d's successful signed app upgrade passed on 2026-10-12: reviewed source
  `453366b7`, signed/notarized A/B packages, dedicated test hosting, verified
  stopped-VM backup, manual bootstrap to A, then actual Sparkle A-to-B.
  B (`0.1.2` / build `3`) relaunched with a valid signature and one app process.
  Managed packages, activations and both skill links matched the baseline.
  Safari handoff to B and the already-installed no-op also passed, followed
  by another unchanged-state check. See F3d acceptance in local-only `newmac.md`.
  Manual `0.1.0`-to-A replacement is setup, not updater proof. Preserve the VM,
  its unlaunched backup, signed artifacts and good test feed. Do not repeat
  packaging, notarization or the passed happy path without a reason.
  Failure/recovery tests, production integration/migration and G1-G4 remain
  open. No production deployment, public Mac release or push occurred in F3d.
- **Preserve the F3c checkpoint `6507a699`.**
  F3c scoped review found no blocking issues; this checkpoint records its source
  and eight evidence files. Verification passed 20 package/page tests, 51 related
  portal tests, strict test-page TypeScript and saved source/artifact checks.
  New builds, update hosting and guest execution need a separate approved plan;
  this is not approval to deploy or change the public Sparkle feed.
  The bounded signed-candidate skill-update test passed on 2026-10-12 in the
  retained VM: install A, cancel B, apply B and repeat B. All 14 Humanizer files
  matched the exact versions; cancel preserved A and repeat did not replace B.
  Writing Guidelines stayed unchanged. **Codex discovery required a normal
  restart:** refresh alone showed no Humanizer; after restart it appeared under
  Installed and its details rendered correctly, with no reinstall or model run.
  The refresh-only failure remains a follow-up; its cause is not established.
  See [F3c results and boundaries](archive/newmac-f3c-2026-10-12/README.md) and
  [guest verification](archive/newmac-f3c-2026-10-12/guest-verification.json).
  Preparation passed public-source preflight, 20 package/page tests, TypeScript
  and three pages at two viewport sizes. The signed app and DMG are unchanged.
  Only the dedicated test site was deployed by this task. A separate production
  deployment occurred during verification and is recorded in that evidence;
  production was not rolled back or otherwise changed by this task.
  No native rebuild, re-signing or push. The eight small evidence files are
  included explicitly despite the archive ignore rule; binaries stay untracked.
  Retain the VM and artifacts; cleanup needs separate approval. Do not repeat
  this passed matrix or treat this checkpoint as production acceptance.
- **Preserve the F3b checkpoint `fd5a4e4d`.** Scoped review passed with no blocking
  findings; this source checkpoint records the candidate changes and evidence.
  F3b's signed first-time setup passed its bounded
  Safari/arm64/Codex flow on 2026-10-12; see
  [acceptance evidence](archive/newmac-f3b-2026-10-12/README.md).
  The app and DMG were signed, notarized and hosted on a dedicated test site,
  then downloaded, copied, opened normally and retried from the original page
  in a disposable macOS VM without developer tools. Writing Guidelines installed
  at the exact recorded version and appeared in Codex after refresh.
  Cold launch passed; a further measured warm retry preserved the skill and
  provenance hashes, file identities/timestamps and activation link, with one
  running candidate process. Retry still fetches package data; this is a
  no-reinstall result, not zero-network proof.
  The signed artifact was built on base `dd1e7828` with then-uncommitted inputs;
  this source checkpoint does not rebuild or replace that artifact. Review
  verification passed 16 package/page tests, 29 native tests and TypeScript;
  one optional live-network test was skipped. Saved digests and source inputs
  matched; both evidence files are included explicitly despite the archive rule.
  Preserve the VM and candidate artifacts as F3b/F3c evidence; cleanup needs
  separate approval.
  The F3b checkpoint did not change the production website, public app, host
  skills or Sparkle release.
- [~] **F3: First-time setup and retry (C10/C5/C17).** F3a automated and user-run
  checks passed locally on 2026-10-09. F3b candidate setup, F3c skill update and
  F3d successful app upgrade passed on 2026-10-12, with the F3c Codex restart
  caveat. Production setup/migration and G1-G4 remain open.
  Keep the native result authoritative, timeout state unknown, and public
  installs account-free.
- [x] **F2: Three-source local install/update proof.** Local acceptance passed
  2026-10-09 for Humanizer, Writing Guidelines and SEO Audit: three installs,
  repeat no-op, independent Humanizer update and fresh Codex discovery before
  and after the update. Different-source/same-name refusal is covered by
  automated tests. Evidence is saved and approved cleanup is complete; see
  [results](archive/newmac-f2-2026-10-09/README.md) and the
  F2 implementation plan in local-only `newmac.md`. Source, tests and
  evidence are committed locally as `f7a964b0` on `codex/newmac-f1-core`.
  No full-catalog, distribution or production-activation claim.
- **F1 checkpoint complete locally.**
  The F1 implementation plan in local-only `newmac.md` and short local
  acceptance passed on 2026-10-09: Cancel A/B, install A, repeat no-op, local-edit
  refusal/restoration, reviewed B update and isolated Codex discovery of A and B.
  Implementation is committed as `33b659e6` on `codex/newmac-f1-core`, based on
  `eb92e828`. The scoped review passed and approved cleanup is complete; see the preserved
  [F1 evidence](archive/newmac-f1-2026-10-09/README.md). Neither checkpoint
  completes C17/C13/C10 or release readiness. Integration, push, deployment and release
  remain separate decisions; this checkpoint does not authorize them.
- The prepared standalone `webwork-h14-d3-test.md` is **superseded as the next
  execution step**, not passed. Carry its valid acceptance checks to G1/G2 on
  the merged product. No separate test account or standalone install is needed now.
- Retain the hosted standalone artifacts and deployment retention guards until
  a separately approved retirement. No feed, key, app or artifact deletion here.

## Milestones

| Milestone | What it proves | Boundary |
| --- | --- | --- |
| F1: Local functional proof | One public skill installed and updated from the web through the existing-app codebase | Isolated development build; no release or broad safety/coverage claim |
| F2: Small multi-source proof (passed locally) | Three independent public installs, repeat no-op, one reviewed update, Codex discovery and automated collision refusal | Same isolated local flow; no full-catalog, fresh-setup or release claim |
| F3: Setup/retry (F3a, bounded F3b/F3c/F3d passed) | Local retry, signed setup/cold launch, skill A/B cancel/apply/repeat, Codex discovery and Sparkle app A/B upgrade with preserved skills and handoff | One arm64 VM, Safari and Codex; Humanizer discovery required restart; not updater-failure, broad-coverage, production-migration, zero-network or G1/G2 completion |
| Controlled public-skill pilot | Setup/retry, signed build, wider source coverage and release safeguards work for approved testers | C5/C13/C16 and applicable G1-G3; separate test/distribution approval |
| Existing-user rollout | The replacement can update existing users without losing data or required capabilities | Full relevant G1-G3, migration evidence, agreed C1-C3 web parity and separate release approval; G4 before private activation |

### F1: Bare-bones install and update

**Planning and local implementation approved, 2026-10-08.** One Mac, one browser, Codex and one
accessible public skill without a precomputed catalog pin. Use two real source
revisions to prove install A, then update to B. This is a product-flow proof,
not another standalone-helper experiment or a security test campaign.

1. Add one action to the existing `/app/` skill-detail view in a local preview.
2. Open a preinstalled development build based on the existing Mac app, with
   only the small management UI. Resolve and freeze A, review it, then install.
3. Return to the same web entry point for B; the app reads its own install record,
   shows changes and applies the approved update. No per-skill Terminal or agent
   orchestration, manual package staging or catalog pin backfill in the flow.

**Only prerequisites:** a single write/store path for new test installs, one
Codex destination policy, a bounded request shape, the A/B source selection and
an isolated test home/build. Full matching of pre-existing skills is not needed:
use the requested skill identity and records created by this flow. Resolving the
requested package's exact version is still needed; these are different problems.

**Pass evidence:** reviewed A and B match installed package bytes and records;
Codex discovers the skill in the isolated environment; repeat A is a no-op;
Cancel and one local-edit check preserve files. The app gives a clear result;
the web does not claim installation without confirmation. Existing installs,
credentials, production URL handling and update feeds remain unchanged.

**Not in F1:** account pairing/sync, full inventory matching, Sets, queued remote
requests, login startup, search parity, polished onboarding, telemetry expansion,
signed distribution/upgrades, broad catalog sampling, adversarial tests or a
full interruption/rollback matrix. Keep existing package checks, local approval,
isolation and no-overwrite protections; do not disable them to make the demo pass.
G1-G4 retain the later hardening work. One successful flow completes only F1,
not C17/C13/C10 or release readiness. Stop on unexpected writes or wrong-app launch.

**Progress, updated 2026-10-09:**

- [x] Step 1 core implemented locally: on-demand HEAD/exact-commit resolution,
  bounded request/review, managed install/update, repeat-version no-op, cancellation,
  stale-review and local-edit refusal. Uses the existing managed store and isolated
  `.codex/skills`; existing catalog/Set entry points remain compatible.
- [x] Step 2 minimal isolated Mac shell implemented locally. Debug-only identity,
  isolated paths, one review/result window and F1 menu; no account/catalog startup,
  analytics or updater. User-run browser delivery passed in the prepared test build.
- [x] Step 3 local web detail handoff implemented locally. Signed-out public detail,
  F1-only button and A/B control; no production entry point or fabricated success.
- [x] Step 4 real public A/B fixture, browser/native acceptance and Codex discovery.
  User-run A install, repeat, Cancel A/B, local-edit refusal and B update passed;
  exact A/B bytes/provenance and fresh isolated Codex discovery were verified.
  This completes the narrow local proof only; production coverage remains unproven.

Step 1 evidence: baseline 17 tests passed; final selected regression run **93 tests
in 11 suites passed**, including the new core tests and existing fetcher, validator,
catalog, managed installer, group snapshot, package loader/model and subscription
tests. Swift 6.2.3; `git diff --check` passed. Source/worktree:
`/Users/jonslimak/.codex/worktrees/newmac-f1-core/omgskills`, base
`eb92e8286137ecd3c77d4b4fbdc53a21f6351f6c`. Test log:
`menubar/.build/f1-step1-tests.log` in that checkout. Test fixtures use temporary
repositories/homes and clean themselves up. No app launch/install, account action,
commit, push, deployment, URL-handler change or Sparkle release.

Steps 2-3/setup evidence, 2026-10-08: **109 Swift tests in 14 suites**, **230 portal
tests**, **2 assembler tests**, and **1 opt-in real-public-source preflight** passed.
The production portal build passed with F1's environment flag deliberately set;
its output contained no F1 scheme or A commit. Desktop/mobile detail screenshots
were checked. `git diff --check` passed. Logs: `menubar/.build/f1-setup-tests.log`
and `menubar/.build/f1-public-preflight.log` in the implementation checkout.

The chosen unpinned public catalog record is
`anthropics/skills:skills/frontend-design`, path `skills/frontend-design/SKILL.md`.
The earlier brand-guidelines candidate lacked a suitable A/B history at its current
path. Real versions: A `2235be7c60b551f5de82ade908fd3816455afcda`, B
`41bbe19d1a1a7eaab5e7bb9050a417e5c6cffc8f`; only `SKILL.md` changes. The fetcher
derives commit/tree/blob pins itself; no catalog pin backfill or staged package.

Historical run: `/private/tmp/omgskills-f1-hVqS0Y/`; now removed after acceptance.
The receipt, instructions and screenshots are preserved in
[F1 evidence](archive/newmac-f1-2026-10-09/README.md).
Test page (server now stopped): `http://127.0.0.1:5197/app/preview/unified/?view=discover&skill=catalog%3Aanthropics%2Fskills%3Askills%2Ffrontend-design`.
The ad-hoc signed `OMGSkills F1 Test.app` was prepared in the implementation checkout's
ignored `menubar/.build/arm64-apple-macosx/debug/f1-apps/omgskills-f1-hVqS0Y/` folder.
macOS registered but would not select it while the bundle was in `/private/tmp`;
moving only the bundle and registering its F1-only scheme resolved that setup issue.
All test skill/state paths were in the disposable root, empty before acceptance.
The normal `omgskills` handler remained `/Applications/omgskills.app`; `omgskills-f1`
resolved to the test bundle during acceptance and was unregistered during cleanup.
Its idle window and one F1 process at the registered build path were verified.
No existing app replacement,
real skill writes, credentials, commit, push, deployment or Sparkle release.

F1 path correction, 2026-10-09: manual testing exposed a false destination
conflict in the assembled app. Foundation normalized existing `/private/tmp`
paths to `/tmp`, but left missing child paths unchanged. A new regression test
reproduced `destinationConflict`; returning the already-validated canonical F1
root fixes it without weakening directory/redirection checks. **116 tests in 16
suites passed**, including real public A-to-B install/update using the same runtime
path setup. Only the F1 executable was replaced and ad-hoc signature verified;
the public executable hash and handler are unchanged. See the run receipt for
new/old hashes and the historical rollback-binary path (removed during cleanup).

Manual acceptance, 2026-10-09: post-fix review/Cancel left the test home empty and
no managed store. The user then installed A; its two files, Git tree/blob hashes
and provenance match the frozen A fixture. A fresh Codex app-server using only
the isolated home discovered `frontend-design` as an enabled user skill at the
exact installed file, with no discovery errors, login or model call. The receipt
records the activation/provenance baseline. Repeat A passed: the user confirmed
the unchanged result; target link/timestamp, provenance hash/timestamp, activation
count and exact A files/tree remain unchanged. The user then reported the B
review/Cancel steps worked; the same A files and activation/provenance baseline
remain unchanged. Local-edit refusal passed: the user confirmed the refusal and
the edited file hash plus original activation/provenance were preserved. The
temporary comment was then removed; exact A bytes, original permissions and A
tree/blob hashes were verified against the backup. The user then applied B;
`SKILL.md` matches B's 9,390 bytes and blob, the complete two-file tree and provenance
match B, and `LICENSE.txt` is unchanged. Fresh isolated Codex discovery returned
the enabled skill at the exact B file with no errors, login or model call. The
public app executable still matches its pre-test hash. All six short manual
checks passed.

Review and approved cleanup, 2026-10-09: no blocking scoped findings; 115 Swift
tests, 230 portal tests and 2 assembler tests passed on rerun. The production web
build excluded the test scheme and A/B commits even with the F1 flag set. Evidence
was copied and hash-verified before removing only the named F1 app/run folders,
unregistering its test scheme and stopping port 5197. The regular app kept running,
its URL handler and executable hash unchanged. This checkpoint includes no push,
deployment or Sparkle release; see the archived evidence for exact paths/results.

### F2 implementation and local acceptance, 2026-10-09

This local checkpoint builds on `33b659e6`. The fixture-specific web link
became validated source-to-request construction plus a development-only fixture
policy. Exact case links survive refresh/back and show a disabled reason for
missing, pinned or changed source metadata. No native installer or release
configuration change was needed. Existing validation/consent checks remain.

All three real packages and Humanizer's historical A passed the existing Swift
fetcher/review limits. Humanizer's update changes README/changelog, not SKILL.md.
116 Swift regression tests, 232 portal tests and 2 assembler tests passed;
the opt-in real-source preflight passed separately. Production output excludes
test links/revisions. Preserve [preflight, setup and acceptance evidence](archive/newmac-f2-2026-10-09/README.md).

The user completed all five browser/native checks. Humanizer A's 14 files,
Writing Guidelines' one file and SEO Audit's nine files matched full Git
manifests, modes and provenance. The repeat request changed no files, links,
records, timestamps or activation counts. Humanizer B changed only
`CHANGELOG.md` and `README.md`; its activation count advanced from one to two,
while both other installs remained identical. Fresh isolated Codex discovery
before and after B found all three enabled user skills at the exact installed
paths, without errors, login or model calls. Humanizer's own plugin metadata
namespaces it as `humanizer:humanizer`; this was a verifier expectation correction,
not an installer change.

Acceptance snapshots were preserved and hash-verified in both checkouts before
approved cleanup. Only `/private/tmp/omgskills-f1-hl5alh/` and its matching
Debug test-bundle folder were removed; the exact test app was stopped and
unregistered, and port 5197 stopped listening. The public app's process, URL
handler and executable hash stayed unchanged; the other preview on port 5191
was left running. See `cleanup.json` in the evidence folder.
C13's broader coverage, setup and release gates remain open. Scoped review
found no blocking issues; 117 Swift tests in 17 suites, 232 portal tests and
two assembler tests passed on rerun. TypeScript and both standard and unified
production builds passed, with test links/revisions absent even when preview
flags were deliberately set. See the [review note](archive/newmac-f2-2026-10-09/REVIEW.md).
This is a local checkpoint only; no push, deployment or release.

## Working rules

- Plan and approve each slice: baseline, exact scope, contracts, risks, recovery,
  automated tests and user-run acceptance. Stop and re-plan on new risks.
- Keep implementation, review/commit, push, deployment, signed release and
  activation separate. No document checkbox authorizes an external action.
- Test internal steps, then the whole slice. Reuse passed evidence only where
  the code/identity/behavior still match; historical tests do not verify a merge.
  Scale verification to the milestone: F1 uses its short functional checks;
  broader security, compatibility and release matrices belong to later gates.
- Record exact build/commit, checks, results, evidence and remaining limits.
  Preserve unrelated dirty work. Manual UI tests are user-run by default, with
  short steps and exact filenames; no completion claim without read-back proof.

## Direction (D3, decided 2026-10-08)

- **The web is the whole experience:** discovery, search, Sets, and starting
  installs and updates.
- **On Mac, one management app.** It supports user-controlled login startup,
  has a small menu-bar icon and no discovery UI. It installs, updates and rolls back skills; scans and
  reports what is installed; pairs with the account; installs Sets and keeps
  them updated.
- **Built by merging:** start from the existing Mac app (scanner, identity
  resolver, sync upload, pairing, Set installs/subscriptions, Sparkle, installed
  users) and add the standalone helper's extras (web-link launch, exact diff
  review, rollback store). Remove the discovery UI.
- In this doc, "helper" now means this Mac management app.
- No discovery UI does not mean no local UI: approvals, exact change review,
  errors and update consent remain. Always running does not authorize unattended
  skill changes. One app replaces two products; no agent or per-skill Terminal step.

Here `D3` names the product-direction decision, not the old `H1.4D3` setup test.

## Goal

1. **Library search on the web.** Everything the Mac app does for discovery
   (search, ranking, README, avatars, collections, trending, sort and filters)
   works in `/app/`, fast, without downloading the 79 MB catalog.
2. **Installed state on the web.** The web can show what a user has installed,
   on which machine and agent, using the merged management app as the reporter,
   without requiring a separate discovery app.
3. **Management on the web.** Install, update, and Sets work from the web, with
   the helper doing the local file writes. Track uninstall, installation into
   another agent, and Set subscription updates explicitly, even when deferred.

Public install/update remains account-free. Account linking is required for
uploaded inventory and private access, not for installing a public pinned skill.
Reported inventory is not proof that a device is online or remotely controllable.

## Where things stand (summary)

| Area | Mac app today | Web today | Gap |
| --- | --- | --- | --- |
| Catalog data | Downloads 79 MB `skills.json` + small assets; hash-gated refresh | Existing `/mcp` API loads the full catalog on cold start; warm instances cache it | Slim search data and efficient loading behind the existing API |
| Search | In-memory token index, tuned ranking, 150 results, sort options | Server-side `search_skills` via `/mcp`, simpler ranking, 30 results, no paging or sort | Ranking parity, paging, sort, filters, speed |
| Skill detail | README (repo root, live from GitHub, cached), install buttons, metadata | `get_skill` exists; UI drops install metadata and has no README | Extend detail fields, content delivery and UI |
| Avatars | Live `github.com/<handle>.png` | Same, hotlinked | Proxy/cache (optional) |
| Collections, trending, creators | Collections, trending, X/Twitter, creator/company views | Built subset; collections capped at 30 items | Paging and remaining browse views |
| Installed skills | Local scan of `~/.claude`, `~/.codex`, `~/.agents` | Reads Mac-uploaded `synced_skills` | Reuse the scanner/reporter with a per-device model |
| Install / update | Pinned managed path plus legacy clone/link path | None in `/app/`; hosted standalone prototype accepts two Frontend Design IDs | Reuse broad installation capability; generalize safe targets and exact-version handoff; reporting is separate |
| Sets / Favorites | Gated snapshot and subscribed Set flows | Catalog-first management implemented | Helper Set install and subscription updates |
| Existing installations | Scan, uninstall and copy to another agent | Uploaded metadata only | Separate observed from helper-managed; define adoption and action support |

### Deployment and verification

| Surface | Deployment status recorded in related docs | Verification boundary |
| --- | --- | --- |
| Unified `/app/` and public catalog | Recorded live in `appwork.md` | Source reviewed here; no fresh live check or production timing result |
| Standalone helper | Signed/notarized and hosted (unlinked) per `webwork.md`; now an input to C17 | Existing safety and scoped Codex evidence retained; clean-account setup, signed upgrade and remaining acceptance gates still open |
| Management-app-backed web install/update | F1/F2 local flow, F3b signed setup, F3c skill update and F3d successful signed app upgrade passed; candidate test site only | F3c Codex discovery required restart; updater failures, broader coverage, production migration/integration and pilot acceptance remain open |
| Device-aware helper inventory and web management | Not implemented | Requires migration, isolation and end-to-end evidence |

Helper-key backup/recovery is already complete per `webwork.md`. Hosting,
installation, helper upgrades and wider activation remain separate gates;
signing alone does not close them.

Recorded completed foundations: H1.1 public package verification, H1.2 isolated
install/update/rollback and H1.3 scoped Codex discovery; H1.4C signed/notarized
artifacts; H1.4D1/D2 retention, key recovery and hosting. Hosting commit `afa66fa4`
passed preview/live verification; three helper files matched, 12 existing Mac
release files were unchanged and seven workflows were restored. These are
historical results in `webwork.md` / `webwork-h14-spec.md`, not merged-app acceptance.

## Part 1: Library search on the web

### 1.1 Catalog data and pipeline

- [x] Crawl and publish: `shadow-crawl-health.yml` (twice daily) and
  `scrape.yml` (daily) commit content-hashed assets to `site/data/{crawl4,v2}/`,
  served as static files by Netlify.
- [x] Assets: skills 78.8 MB (51,133 entries), trending 45 KB, x-trending
  ~82 KB, collections 93 KB, sha-history 7.3 MB, skill-equivalence 38 KB; v2 adds
  signals and leaderboards.
- [x] Precomputed fields: stars, dates, tags, installs, trending rank,
  attribution, pinned-install fields, and `readme_snippet` (first SKILL.md
  section, 1,000 chars, on ~17.6k of 51k skills).
- [ ] **Web-sized search data.** Build a slim search/list projection in the
  existing pipeline and improve loading behind the existing catalog service.
  Measure cold/warm latency and payload size before adding a database or hosted
  search provider; neither is a prerequisite for this transition.
- [~] **Per-skill detail data.** `get_skill` already serves exact-ID metadata.
  Extend its fields and content delivery, plus the portal parser, rather than
  treating a new detail API as mandatory.

### 1.2 Search API and ranking

- [x] Hosted `/mcp` `search_skills`: linear scan of all 51k skills, field
  weights (name 12, id 10, author 8, tags 6, description 4), trending/gold boost
  and log(stars). Supports `author`, `tag`, `minStars`; limit up to 100; no offset.
- [x] `get_skill`, `get_skills` (30 IDs), `list_trending`, `list_by_author`.
- [~] Legacy `/api/portal/catalog-search`: signed-in only, substring match,
  12 results. Candidate for removal only after checking remaining callers.
- [ ] **Ranking parity with the Mac app.** The Mac's `SkillSearchIndex.swift` has
  tuned rules the web lacks: stopwords (`skill`, `claude`, `agent`, `code`),
  `app store` normalization, an all-terms-matched boost, a low-star penalty, and
  penalties for aggregator/repackaged entries and mostly-CJK descriptions.
  Use representative queries and expected results to decide which rules to
  share; parity is a user outcome, not a requirement to duplicate every heuristic.
- [ ] **Paging, sort and filters.** Mac sorts by trending, stars, recently
  updated, recently added and name, and supports `@handle`. Web has none of
  these controls, and stops at 30 results. Reuse the existing API filters where
  supported; add paging and sort contracts rather than a second search service.
- [ ] **Search speed and cold start.** Each cold `/mcp` instance fetches and
  parses 79 MB before answering. `appwork.md` lists production timing as open.
- [ ] **Search on the static site.** None; pages point to MCP or JSON. Covered
  by C1 (same API); a search box on `/skills/` pages is optional C3 scope.

### 1.3 Skill detail content

- [x] `/app/` detail: avatar, name, author, stars, description, tags, source
  links, public page link, add to Set, Favorite.
- [x] Static `/skills/` pages: README snippet, install command, "Copy for
  agent" (pinned), installs, trending badge, more from repo. Only a curated
  subset of skills has a page.
- [ ] **README in `/app/`.** The snippet exists in the data, but MCP drops it
  and the portal parser ignores it. The Mac app shows the full repo README
  (fetched live from `raw.githubusercontent.com`, cached forever, images
  stripped). Extend the existing detail delivery with bounded, cached content
  and safe rendering. Decide repo README versus pinned SKILL.md before building;
  repo-level documentation must not be presented as the exact package to install.
- [ ] **Install info in `/app/`.** Install command, pinned install, installs
  and trending rank are dropped by the portal parser.
- [~] "More from @author" only uses already-loaded rows; wire it to the existing
  `list_by_author` query.

### 1.4 Avatars and images

- [x] Both clients hotlink `github.com/<handle>.png`. Works today.
- [ ] Optional: proxy and cache avatars (speed, privacy, GitHub availability).

### 1.5 Browse views

- [x] Discover: collections, trending, creators, 24 starter categories (copied
  from the Mac app).
- [~] Collections show only the first 30 members; needs paging.
- [ ] Mac-only views: X/Twitter trending, "Companies" vs "Creators" split,
  featured-creator crown, duplicate grouping via skill-equivalence. Decide which
  are release requirements (open question 1); in-scope views belong to C3, the
  rest are recorded as out of scope rather than silently dropped.

## Part 2: Installed state through the management app

### 2.1 What exists

- [x] Upload API `POST /api/portal/sync-upload`: accepts a device token with
  `sync:write` or a legacy one-time token. Stores `sync_runs` and
  `synced_skills`. Not Mac-specific in itself.
- [x] Pairing: `/api/portal/sync-pairing-code` plus `sync-exchange` issue
  `device_tokens`. The browser callback is `omgskills://pair`, which only the
  Mac app handles.
- [x] Web reads `GET /api/portal/synced-skills`; `/app/` shows them as
  `synced:<id>`. "Sources" in `/app/` are agents (Claude, Codex), not devices.
- [~] Mac app uploader: built, but switched off in the shipped app
  (`skillGroupsAuthEnabled: false`). Shipped builds cannot upload; the source
  of the current My skills rows is unverified.
- [~] Helper install records: `~/Library/Application Support/OMGSkills
  Helper/` (`record.json` per version: catalog ID, repo, path, commit, tree,
  file hashes). Local only; never reported.

### 2.2 What is missing

- [ ] **Shared reporting contract, before the uploader.** Identify device,
  agent, installation, catalog ID when known, verified installed commit/tree,
  ownership and last-seen state. Adapt helper records and uploaded rows to this
  contract; they need not use identical internal storage formats. A catalog match
  or SKILL.md hash alone does not prove the complete installed package version.
- [ ] **Per-device inventory, before enabling another reporter.** `synced_skills`
  has no `device_id`; uploads currently replace the user's inventory, not one
  device's. A second device can mark the first device's skills missing. Scope
  updates and reconciliation to the reporting device, with a migration policy
  for existing rows and legacy clients. This is mandatory for the inventory
  release, not a prerequisite for account-free public installs.
- [ ] **Management-app pairing.** Reuse the existing account/device-token flow
  and `omgskills://pair` callback; retain state/code-verifier checks, secure
  credential storage and revocation. A second standalone pairing flow is not needed.
- [ ] **Merged scanner/reporter.** Reuse the existing scanner, identity resolver
  and uploader, adapting managed records to C9 and device-scoped uploads to C8.
  Decide first-release observation coverage separately from permission to modify
  those files. The standalone prototype's missing uploader is not a reason to
  rebuild the existing one.
- [ ] **Identity-data delivery (C7/C9, design in `newmac.md`).** The resolver
  currently needs the full catalog and SHA history. Compare server matching
  with a match-only local index, measuring size, privacy, offline behavior and
  matching fidelity. This is needed before broad inventory reporting, not F1;
  do not confuse local-skill matching with on-demand package version resolution.
- [ ] **Observed versus managed.** Show existing manual/Mac-app installations
  without implying the helper owns them. Unknown versions stay unknown. Define
  an explicit adoption/migration flow or leave these entries read-only; never
  silently replace them because their name or catalog ID matches.
- [ ] **When to sync.** Mac uploads only on connect or manual Resync. Decide
  helper triggers (after mutations, on launch, on demand), retries and stale
  inventory display. Reporting failure must not turn a successful local install
  into an apparent installation failure or trigger a blind reinstall.
- [p] Retire legacy one-time tokens (LA.4) and move Set items off
  `synced_skill_id` (deferred).

## Part 3: Management on the web

- [x] Sets and Favorites on the web, catalog-first, with invites. Set items can
  point at catalog skills and immutable releases, not only synced skills.
- [~] Standalone prototype: signed, notarized and hosted unlinked (H1.4D2);
  installs, updates and rolls back two public IDs for Frontend Design. Its
  reusable behavior must be integrated and reverified in the management app.
- [ ] **Install/update from the web (H2).** No install action in `/app/` yet.
  F1 starts in a local preview of its skill-detail view; static-page expansion
  is a later decision, not another first-slice entry point.
  Public content needs no account pairing or uploaded inventory.
- [~] **First-time setup and retry (C5/C10/C17, F3).** Follow the
  stage-separated F3 plan in local-only `newmac.md`: local
  intent/retry UX first, then the actual signed download/open/return/retry path.
  Keep the intended skill/agent but revalidate the request. A timeout is unknown
  state, not proof the app is absent. F3a automated and user-run acceptance
  passed locally. F3b subsequently passed the bounded signed first-time path in
  a clean arm64 VM; see [evidence](archive/newmac-f3b-2026-10-12/README.md).
  F3c then passed skill install/update/cancel/repeat with the same signed app;
  Humanizer discovery required a Codex restart, not just refresh. See
  [results](archive/newmac-f3c-2026-10-12/README.md).
  F3d then passed real signed app A-to-B replacement/relaunch, unchanged skills
  and post-upgrade handoff/no-op; acceptance is recorded in local-only `newmac.md`.
  F1/F2/F3a used a preinstalled dev build; do not conflate those earlier results
  with signed setup or count the candidate as production migration proof.
- [~] **Generalize helper targets, not just the allowlist.** F1/F2's existing-app
  path derives per-source destinations and ownership; three coexisting sources,
  independent update and automated same-name refusal passed locally. The older
  standalone policy remains restricted. Broader target/restore coverage and
  production policy are still open; preserve ownership and local-edit protections.
  The later reporting contract extends this local contract for the web.
- [~] **Codex destination policy (C17/C13).** F1 step 1 retains the app's
  `.codex/skills` default under the injected test home and refuses same-name
  entries in `.agents/skills`. F1/F2 verified actual Codex discovery in isolated
  homes. Broader migration/adoption and existing-user compatibility remain
  unproven; preserve recorded existing locations without moving files.
- [~] **Installation coverage and on-demand pinning (C13).** The October 8
  deployment catalog has 515/51,133 entries with commit/tree/blob metadata;
  the standalone prototype has the further two-ID restriction. The existing
  Mac installer also has a legacy path without those precomputed pins.
  Triggering that same engine from the web does not inherently reduce coverage,
  but legacy installs do not automatically gain exact-diff/rollback guarantees.
  F1/F2 resolve an exact version at request time and freeze it before approval;
  three previously unpinned root/nested/companion packages passed the F2 sample,
  with automated collision refusal. Never substitute a later branch head.
  Wider packages, rate limits, renamed/deleted/rewritten repositories and
  catalog-scale request/latency behavior remain unproven. Full-catalog backfill
  is not a prerequisite of this design.
- [~] **Exact-version handoff and honest results.** F1/F2 bind validated source
  requests to a frozen native review and show the actual local result; the
  browser only requests opening. Any version advertised on the page must match
  or require a new review. Retain local diff/approval checks. Cover missing-helper
  setup and retry, unavailable pins, conflicts, cancellation and failures.
  A browser click or timeout proves neither helper presence nor installation.
  Show web success only with verified completion evidence; otherwise keep the
  result explicitly unknown and let the helper show the local outcome.
- [ ] **Install a Set from the web.** Today only the Mac app (gated off) can
  install Set snapshots or private releases (`content:read` scope).
  Reuse the existing manifest's installable/metadata-only distinction.
- [ ] **Set subscription updates.** Separately track snapshot versus "Keep
  updated", reviewing additions/changes/removals, local-edit protection and
  stopping a subscription. Reuse the existing Mac contracts; a Set install button
  alone does not transfer this functionality. Defer private access explicitly
  until the helper has the authenticated content path.
- [ ] **Update detection on the web.** Needs Part 2's reported installs plus
  current catalog pins. Use verified package identity and ownership, distinguish
  stale/unknown inventory, and recheck local state in the helper before applying.
- [ ] **Uninstall and another-agent installation.** Track both as management
  work, separate from removing an item from a Set. Define helper-owned uninstall,
  destination collisions, local-edit handling and subsequent inventory refresh;
  do not silently adopt or delete externally managed files.
- [ ] **Remove Mac app CTAs** once replaced: "Get the Mac app" in `/app/`, and
  the "Connect app" dialog's code and legacy token tabs. UI replacement is not
  permission to remove legacy APIs or `synced_skill_id` references; verify
  supported-client migration and preserved memberships first.

## Components to build (first pass)

| # | Component | Depends on | Notes |
| --- | --- | --- | --- |
| C1 | Efficient search data + existing API extension | pipeline | Slim projection; ranking acceptance cases; paging, sort, filters; measure before new infrastructure |
| C2 | Existing skill detail extension | pipeline | Extend `get_skill` and content delivery; bounded README; reuse `list_by_author` |
| C3 | `/app/` search and detail upgrade | C1, C2 | Paging, sort UI, README, install info |
| C4 | Avatar proxy/cache | none | Optional |
| C5 | Mac management app release and setup verification | Integrated C17/C13/C10 candidate; not needed to build F1 | F3b setup and F3d successful signed upgrade passed on the isolated candidate; intended production identity/channel, migration and G1/G2 still need verification |
| C6 | Pairing + device token | C17, C9 | Reuse the existing app's `omgskills://pair` flow and device auth; account replacement/revocation safety |
| C7 | Inventory scan + upload | C6, C8, C9; identity-data decision | Reuse scanner/resolver/uploader without assuming full-catalog loading disappears; device-scoped uploads; activation separately approved; outside F1 |
| C8 | Per-device inventory model and migration | C9 | Device-scoped replacement/reconciliation; existing rows and legacy-client compatibility |
| C9 | Shared reporting contract | C13 identity contract | Define before C8/C7; extend local identity with device, ownership and freshness |
| C10 | Public web install/update (H2) | C17/C13 contracts for F1; C5 before distribution | F1/F2 local flow, F3a retry, F3b signed setup and F3c signed-candidate skill update passed. F3c Codex discovery needed restart; production integration and verified web result remain open. Signed-out links need no C6-C9; signed-in queued delivery uses C18 |
| C11 | Helper Set install and subscription updates | C10; C6 for private access | Public first; mixed items, reviewed removals and local protection; C14 for web inventory status |
| C12 | Retire Mac dependencies safely | replacement flows and migration evidence | C7/C14 reporting, C10/C11/C15 management; preserve supported clients and memberships |
| C13 | General catalog/target identity | C17 write/store and destination contract | F2 passed three unpinned sources, independent update and automated collision refusal locally. Broader source/restore coverage remains open; not the same as matching existing local inventory |
| C14 | Web inventory and update status | C7 | Machine/agent views; observed versus managed; verified versions and stale/unknown states |
| C15 | Uninstall and another-agent management | C10, C14 | Explicit local approval, ownership checks and inventory reconciliation |
| C16 | Web and helper measurement | none; needed before G3, not F1 | Reuse app TelemetryDeck; preserve install events currently in discovery UI. Web measurement stays separate; no private paths/content; F1 uses a short test receipt |
| C17 | Merge into one Mac management app | Product decision D3, not H1.4D3 test | Existing app as base; reconcile installer/store ownership; add web-link launch, exact review and rollback; remove discovery UI; approved login/menu-bar lifecycle |
| C18 | Web-to-app request channel | C6, C17 | Device-scoped, expiring queued requests; deduplication/replay and wrong-device checks; local approval, authenticated result reporting. Keep web links for signed-out installs |

C12 also covers removing the legacy `/api/portal/catalog-search` endpoint after
checking remaining callers.

Component IDs are stable references, not the execution order. Detailed slice
plans still require approval; existing helper acceptance evidence is reused.
F1 takes narrow parts of C17/C13/C10 together; it does not wait for each entire
component to finish. C5 is a distribution gate, not a cyclic build prerequisite.

## Suggested delivery order

1. **F1 local proof is complete.** Preserve its evidence and reuse its existing
   Mac writer, store, destination and review contract.
2. **Preserve the F2 checkpoint.** Local acceptance, scoped review and cleanup passed;
   results cover three real installs, no-op, independent update and Codex
   discovery, plus automated collision refusal. Local commit `f7a964b0` is
   complete; integration, push, deployment and release remain separate.
   Do not repeat the full F1 manual matrix. C13 stays partial.
3. **Preserve the reviewed F3b signed setup checkpoint.** F3a is committed as
   `462ac68a`; native HTTPS as `f8a40cf0`; candidate wiring as `003f94d1`.
   The signed/notarized candidate and dedicated test page passed the bounded VM
   flow on 2026-10-12. The independent file/record and repeat evidence is archived;
   scoped review passed and this checkpoint records the packaging/web changes.
   F3c subsequently passed install/cancel/apply/repeat with independent exact
   file/provenance checks and an unchanged Writing Guidelines control. Codex
   found Humanizer after restart; refresh alone failed. Scoped F3c review passed;
   this checkpoint records the source/evidence with that caveat. Do not repeat
   the passed matrix or confuse a skill update with a Sparkle app upgrade.
   F3d separately proved Sparkle A-to-B with preserved skills and a working
   post-upgrade browser request. Next plan the bounded G2 failure cases, not
   another successful-upgrade run; preserve the good feed and VM backup.
4. **Harden for a controlled pilot.** Use F2/F3 findings to expand C13 coverage,
   complete C17 lifecycle, then remaining C5/G1/G2 signed setup/upgrades and C16
   measurement. Retain security and failure checks here; do not erase them.
5. **Pilot, then separately approve existing-user rollout.** G3 verifies the
   real public flow. Broad rollout also needs migration evidence and agreed
   C1-C3 discovery replacements; local proof is not permission to ship. Broader
   inventory/private work need not block the public install pilot.
6. **Add device-aware reporting and queued delivery.** C9, then C8/C6, then
   C7/C14; C18 follows device auth and C17. Prove account/device isolation,
   revocation, duplicate-request refusal, stale inventory and failure reporting.
7. **Broader management and Sets.** C15/C11 add explicit uninstall, another-agent
   installs, snapshots and subscriptions. Private access and rollout require G4.
8. **Retire old surfaces last (C12).** Preserve supported users and memberships;
   remove obsolete UI separately from APIs, credentials, stores or hosted assets.
   Optional C4 and the deferred backlog are not public-MVP blockers.

## Webwork transfer ledger

Every unfinished Webwork task is carried, adapted or explicitly superseded here.
Original statuses and dated evidence remain in `webwork.md`; do not maintain a
second active queue there. A moved or superseded test has not passed.

| Webwork source | Active home | Disposition |
| --- | --- | --- |
| H0 handoff and retained-artifact cleanup | C10, G1, C12 | Reuse local browser evidence; finish merged-app cold/warm handoff, cancel and scoped cleanup |
| H1 umbrella; H1.1/H1.2/H1.3 | C17, C13, G3 | Reuse verified package/transaction/Codex foundations; carry remaining actual Claude discovery or explicitly exclude support |
| H1.4A normal launch | C17, G1 | Adapt open ready-review/cancel, cold launch and duplicate-copy checks to merged product |
| H1.4B updater; H1.4D3/D4 | C5, G1/G2 | Carry signed upgrade, preserved skills and failure tests; standalone-pair execution superseded as next step |
| H1.4C signing; H1.4D1/D2 recovery/hosting | C5, C12 | Completed evidence retained; not proof of merged signing/setup/update. Preserve hosted bytes until approved retirement |
| H2 web flow | C10, C13, C18 | Carry setup/retry, exact version, conflicts and truthful completion; generalize targets, not just IDs |
| H3 scoped public pilot | G3, C16 | Run on the merged app; reuse applicable prior evidence rather than repeat every fixture |
| W1 agent-install feasibility | Historical evidence; C13/G3 for remaining product proof | No-helper/token experiments superseded as an active queue; no new agent-installer dependency |
| M1 / L5.5 native readiness | C17, C11, G1/G3 | Adapt to management UI, accessibility, reconnect, hidden flags and regression/build tests; discovery redesign superseded |
| M2 dormant release; M3 / L1.6 activation | C5, G4 | Preserve eligible-build, disabled-state, separate activation/monitoring gates; no second parallel Mac release plan |
| W2 private readiness; W3 private rollout | C6, C11, G4 | Merge into the same authenticated management path; keep deferred until separately approved |
| P1 / L6.1 repeated-use pilot | G4 | Retain owner/recipient later-session evidence and written continue/revise/stop decision |
| L7-L9, LA.1-LA.4 and other ideas | Deferred backlog below | Retain conditions; no silent commitment or deletion |

## Acceptance gates carried forward

These are post-F1 pilot/release requirements, not the checklist for the first
local flow. Deferring their execution does not mark them passed or waive them.

- [ ] **G1: Merged setup and signed upgrade (C5).** Test fresh setup and an
  existing-user upgrade separately on the actual intended build/channel. Preserve
  normal quarantine/Gatekeeper checks; no security bypass or mandatory admin
  repair. Verify first launch (offline separately), Safari/Chrome cold/warm
  handoff, duplicate-copy refusal, review/cancel, busy state, login behavior and
  accessibility. Prove real signed replacement/relaunch preserves skill bytes,
  links, records, ownership and supported pairing state through independent
  before/after checks. The old standalone pair cannot prove this. Prior v20
  updates also do not prove the merged app or its gated Set capabilities.
  F3b/F3d provide bounded signed setup/upgrade evidence on the test identity;
  they do not close this intended-product/channel and migration gate.
- [ ] **G2: Isolated updater failures (C5).** Carry invalid signature/feed,
  unavailable or interrupted download, replacement failure/recovery and skill
  transaction/update/quit coordination. Reject stale approvals after restart;
  no blind retry or automatic skill change. Negative fixtures never replace the
  good public feeds or downloads. Follow the existing guarded release/recovery
  process; do not assume executable downgrade is safe.
- [ ] **G3: Public end-to-end pilot (C10/C13/C16).** Web-triggered first install,
  no-op, later reviewed skill update, cancellation, local-edit refusal, real
  interruption/recovery and rollback. Include multiple skills, previously
  unpinned sources and a destination collision. Verify complete package bytes,
  provenance, backup and agent discovery; preserve unrelated skills. Record
  clicks, permission prompts, time, failures and later-session reuse. If actual
  Claude Code discovery is not checked, explicitly leave it unsupported/unverified.
- [ ] **G4: Private Sets and controlled activation (C6/C11/C5).** After public
  proof and separate scope approval, reuse `requireGroupAccess`, immutable
  releases, read-only Broker delivery, device credentials and revocation. Keep
  anonymous public MCP intact; no second private MCP implementation or server-side
  GitHub write credential. Verify eligible signed build, reversible hidden/off
  behavior and current flag state before separately approved activation. Run
  access/install/update/revocation smoke tests, recovery and monitoring for a
  limited cohort. Owner and recipient must return in a later session to publish,
  share, install and review a subsequent release. Check snapshot pins, bad-package
  refusal and rollback; separate creator manual-Git friction from recipient
  friction. Record continue/revise/stop here and feed findings into `local.md`.

All gates need focused automated tests, a release build where applicable and
user-run acceptance with independent read-back. Signed binaries, hosted files,
browser clicks, source commits and screenshots alone do not close them.
Cleanup is C12: inventory exact owned artifacts from the H0/H1/H1.3/H1.4 specs,
stop/unregister only the intended test instance, and request deletion approval.
Keep evidence, signed originals and protected backups; do not bypass a prior
deletion guard or remove existing users' apps/skills. No cleanup performed here.

## Deferred backlog transferred from Webwork

| Item | Status and condition |
| --- | --- |
| L7.1 Publisher App / `manage_skill` | [-] G4 repeated use shows manual Git is the blocker; choose one device-side write path |
| L8.1 Owner release diff/access audit | [-] Owners publish later releases and demonstrate review/audit need |
| L9.1/L9.2A/L9.2B private runtime MCP / expiring links | [-] G4 selects one measured expansion; reconcile existing auth work, do not add duplicate private paths |
| LA.1 legacy-install managed upgrade | [-] Explicit C12 migration decision; observed installs remain read-only until approved adoption |
| LA.2 catalog-wide trusted update badges | [p] Fold into C13/C14 verified identity/freshness; legacy or unknown versions must not receive trusted status |
| LA.3 Copy to my skills | [-] Approved private publishing path and attribution/license rules |
| LA.4 one-time sync-token retirement | [-] C6/C12 migration evidence and supported-client compatibility window |
| Always-on sync | [p] C7 trigger/retry design; running at login alone does not implement reporting or permit automatic skill updates |
| Mobile administration, new search backend, Windows/Linux | [-] Separate need, architecture and support decisions; not public-MVP release blockers |

## Consolidation record

2026-10-08: User approved a docs-only move from Webwork to Connect. Mapped the
unfinished public, private and deferred work above; preserved completed evidence
and changed no completion result. Standalone acceptance is superseded as the
next action, not waived; G1/G2 verify the merged product instead. Corrected stale
unhosted/second-reporter wording and the delivery sequence. No code, test run,
account, app, key, artifact, deployment, release or production flag changed.

2026-10-08: User approved a bare-bones first slice. Aligned the milestones,
dependencies and New Mac design; recorded F1 for planning without implementing
or running it. Security/release matrices remain in the later gates. No code,
app, production setting, hosted artifact, commit or deployment changed.

2026-10-08: Drafted the F1 implementation plan in `newmac.md` after targeted
source inspection at `562877c9`. Proposed the existing app's managed store,
isolated Codex root, on-demand package resolution and local-only web handoff.
Code/test execution awaits approval; A/B source availability and exact commit
selection remain preflight checks. No implementation or test result is claimed.

2026-10-09: F1 committed locally as `33b659e6`; no push, deployment or release.
Drafted F2 in `newmac.md` after reading that implementation. The Mac request and
store already support source-specific identity; the preview link and revision
picker are fixture-specific. Plan only: fixture selection and live availability
remain preflight work. Keep current review/package limits and record exclusions;
three passing sources cannot establish broad catalog coverage or rate capacity.

2026-10-09: Recorded the F2 local commit `f7a964b0` and drafted F3 in `newmac.md`
from that source baseline. Separate local setup/retry UX from signed clean-user
setup: the current assembler pre-registers an ad-hoc Debug app and pre-creates
its temporary root, so it cannot prove download/first launch. F3 implementation,
signing, hosting and test execution still need approval. Docs only; no runtime,
app, credential, public download, feed, deployment or release changed.

2026-10-09: User approved F3a implementation. Added the preview-only intent/retry
flow and disabled download, with the old public-download CTA suppressed only
inside this test. Automated web/native checks and production exclusion passed;
one isolated app/server is prepared on port 5198. No browser/manual acceptance,
skill install, signing submission, commit, public deployment or release claimed.
F3b remains separately scoped. See New Mac for the exact test link and receipts.

2026-10-09: F3a user-run acceptance subsequently passed: refresh persistence,
cancel with no writes, exact Writing Guidelines install, fresh isolated Codex
discovery and repeat no-op independently verified. See
[F3a results](archive/newmac-f3a-2026-10-09/README.md). Evidence is saved; cleanup
and scoped review/commit are pending separate approval. F3b has not run; no
signed setup, production deployment or release claim.

2026-10-09: Approved F3a cleanup and scoped review completed. Removed only the
named test root/bundle, stopped its app/server and unregistered its test handler.
The public app binary/handler, other app processes and unrelated preview were
unchanged. Portal tests (249), TypeScript and both production exclusion builds
passed again; six source hashes match acceptance. No blocking findings. See
[cleanup and review evidence](archive/newmac-f3a-2026-10-09/README.md).
This local checkpoint does not authorize integration, push, deployment or release.

2026-10-09: F3a committed locally as `462ac68a`. User approved documenting
F3b and preparing local candidate changes, with a stop if extra developer tools
are required. Source audit confirmed the current public installer calls
`/usr/bin/git`; Apple's documentation establishes the fresh-macOS developer-tool
prompt. Recorded the candidate contract, implementation order and later manual
acceptance in New Mac. Stopped before candidate code/builds to choose the
dependency solution; no fresh-Mac test, signing, upload, hosting, app install,
push, deployment or release took place. Earlier F1/F2/F3a evidence remains valid
within its developer-equipped test environment.

2026-10-09: the native HTTPS downloader slice was approved, implemented and
reviewed locally. Focused regressions and a separate live GitHub parity check
passed, as did the release compile. No blocking source findings; corrected stale
dependency-choice notes during review. The slice retains the existing app's Git
defaults. Candidate wiring is the next separate change; no push or release.

2026-10-09: downloader review committed as `f8a40cf0`. Approved follow-on
candidate wiring is implemented and reviewed in this local checkpoint: explicit setup-test build
flag, separate identity/handler/state, HTTPS review service and loopback-only
browser mapping with independent saved requests. Passed 96 native regressions,
7 candidate-release tests, 251 portal tests and both portal production builds;
production web output excludes test handlers even with preview flags set.
Ordinary Mac Release compilation passed; test installer UI symbols are absent
there and present in the candidate Release build.
Scoped review found no blocking issues; the 96 native, 7 candidate-release and
251 portal checks passed again before committing. No source fixes were needed.
No new manual browser/native acceptance, signed package, registration, install,
hosting, push or release. See New Mac's wiring checkpoint for scope and next step.

2026-10-12: approved F3b local packaging is implemented, inspected and reviewed,
recorded with this checkpoint.
The candidate assembler builds only the separate arm64 setup-test configuration,
checks fixed metadata, portable loader/resource paths, internal symlinks and
copied hashes, and saves source/artifact manifests. Ten packaging tests and seven
candidate-release tests passed. The local pre-signing bundle is assembled and
inspected only; no launch, registration, signing operation, DMG, installation,
hosting or production change. The installed public binary's hash is unchanged.
Scoped review found no blocking issues or required source fixes. The 10 packaging
and 7 candidate-release checks passed again; saved source inputs, package bytes
and manifests were reverified without launching or rebuilding the bundle.
See F3b package evidence in local-only `newmac.md`. At that earlier
checkpoint signing/hosting/setup still needed approval and Download was disabled;
the subsequently approved signed run below supersedes that status.

2026-10-12, signed follow-up: app/DMG notarization and dedicated test hosting
passed. The initial resource-root links were rejected during signing; the
assembler was corrected to standard Contents/Resources layout and 16 focused
package/page tests passed. The clean VM then completed normal first launch,
retained browser retry, exact Writing Guidelines install, cold launch and Codex
discovery. Independent read-only checks verified the installed file against
the pinned public source, matching provenance and one candidate process; a
measured warm retry preserved hashes, inodes, timestamps and the activation
link. [Archived results](archive/newmac-f3b-2026-10-12/README.md) distinguish
observed UI, independent file checks and limitations. Read-only Terminal checks
were post-install diagnostics, not a setup requirement or bypass. Retry is not
network-free. No production change, commit, push or cleanup in this follow-up;
C5/C10/C17 and G1-G4 remain open beyond this bounded candidate result.

2026-10-12, scoped review: no blocking findings or further code changes required.
The 16 package/page tests, 29 native tests and test-page TypeScript check passed;
one optional live-network test was skipped. Saved candidate source inputs and
artifact digests matched. This source/evidence checkpoint does not rebuild,
re-sign, redeploy or replace the tested artifact. No push, release or cleanup.

2026-10-12, F3c acceptance: the unchanged signed candidate passed Humanizer A
install, reviewed B cancellation, B apply and repeat no-op in the retained VM.
All 14 source hashes/sizes/modes and exact commit/tree provenance matched;
Writing Guidelines remained unchanged. Codex refresh did not discover Humanizer,
but an approved normal Codex restart did, without reinstall or model execution.
The cause of the refresh-only failure is unknown. See
[results](archive/newmac-f3c-2026-10-12/README.md) and
[verification](archive/newmac-f3c-2026-10-12/guest-verification.json).
This tracker update changes documentation only. F3c source/evidence review,
commit and any cleanup remain separately approved steps; no push or release.
C5/C10/C13/C17 and G1-G4 remain open beyond this bounded candidate result.

2026-10-12, F3c scoped review: no blocking findings. Reran 20 package/page tests,
51 install-intent/public-install/public-catalog tests and strict test-page
TypeScript; all passed. Four source hashes, six retained hosted artifacts and
both 14-file manifests matched the saved receipts and guest verification.
This checkpoint explicitly includes eight small evidence files, not binaries.
No repeat VM run, build, signing, push, deployment, release or cleanup.
Next is planning isolated signed-app upgrade verification, not executing it.

2026-10-12, F3d acceptance: separately approved signed packaging, notarization,
dedicated test hosting and VM execution passed on source `453366b7`. A manual
bootstrap from updater-free 0.1.0 to A was verified separately from the actual
Sparkle `0.1.1` / `2` to `0.1.2` / `3` replacement/relaunch. B's signature and
Gatekeeper assessment passed, one app process remained, and all inventoried
managed packages, activations and both skill links were unchanged. Safari
handoff and repeat Humanizer B returned `Already installed. No changes made.`;
the independent baseline comparison passed again. The stopped VM backup and
local receipts are retained; details and limits are in local-only `newmac.md`.
Only the dedicated test site and guest test app changed during execution.
This follow-up is documentation-only: no commit, push, cleanup, production
deployment or public release. G1-G4 and C5/C10/C13/C17 remain open beyond this
bounded success; next plan the remaining G2 updater-failure slice.

## Open questions

1. What payload/latency targets should the existing catalog service meet, and
   which Mac search/browse behaviors are release requirements? Reconsider a new
   search backend only if measured results justify it.
2. README source: repo-root README (Mac today) or the skill's SKILL.md? Fetch at
   crawl time or on demand?
3. Does the first inventory release report helper-owned installs only or also
   observe other installations? Is adoption deferred with read-only treatment?
4. Which uninstall, another-agent and Set subscription capabilities ship in the
   first broader management release?
5. After F1's `/app/` detail entry point, should static skill pages also support
   the same handoff?
6. Windows/Linux: the helper is Mac-only. Is a CLI reporter in scope?
7. F1 step 1 uses the approved narrow writer/store, Codex destination and request
   contract in `newmac.md`; wider migration/compatibility remains open. Before
   inventory: select server matching or a local index.
