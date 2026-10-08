# Unified Web App Plan

Status: Unified app is live. Latest app release: `a8ab048e`, production deploy `6ac7a90cedba638c90e33545`. Guarded draft/production checks passed; all 2,210 public non-app files stayed unchanged from the preceding data deployment. Signed-in Favorites details and account-menu navigation focus passed live desktop/mobile checks. Disconnect/reconnect testing remains deferred at the user's request. Planned UI work is complete; remaining account/connection and edge-case verification is listed below. Historical pending statements are not the current checklist.
Updated: 2026-10-08. Implementation worktree: `/private/tmp/omgskills-unified-app-preview`. Recheck main before any new implementation or release.

### Mobile Navigation And Presentation - Release Candidate, 2026-10-08

- User approved the local UI and a scoped commit/deploy of this pass.
- Signed-in mobile navigation uses an accessible side drawer instead of bottom
  tabs. Signed-out mobile retains the eyes logo. Drawer branding is eyes-only;
  My Skills and Collections use the requested User and Playing Cards Fan icons.
- Mobile skill rows show numeric installed-agent counts, 14px names, and a larger
  detail close target. Favorites no longer render empty agent placeholders.
- Initial HTML and account loading show a spinner. Account actions, device
  separators, and destructive controls now respect the dark theme.
- The local acceptance page defaults to the full public catalog (18 collections
  verified); `catalog=0` retains deterministic sample data. Account data remains
  synthetic and writes are rejected. Production catalog/data contracts are unchanged.
- Verification: 225 portal tests, the full root check (including deployment
  safety/workflow locks), production-configured combined build, and whitespace
  checks passed. Local browser checks covered 320/390/1440px, drawer
  navigation/focus/Escape, signed-out branding, counts, loading, dark mode, and all
  18 collections. Updated standalone browser scripts were not executed; the
  affected interactions were checked through the browser instead.
- Main's helper-hosting inventory was already live before this release: all three
  pinned files matched their sizes and SHA-256 hashes. Preserve these and all
  other non-app surfaces; no backend/schema, account writes, or Mac release.
- Commit and production receipt pending; local approval is not live verification.

### Favorites Details And Account Focus - Released, 2026-10-08

- Read-only signed-in production review confirmed catalog-only Favorites showed
  raw IDs without descriptions/source links and were incorrectly labeled local.
  Account-menu navigation also restored focus to its trigger instead of the page.
- User approved these two fixes and their guarded release. Committed and pushed
  as `a8ab048ed2e43c10b8a593827bf5262ed582fbdc`, then deployed to production.
- Favorites/set presentation now resolves explicit public catalog IDs using the
  existing cached, abortable public lookup in batches of 30. Saved item identities,
  order and membership remain unchanged. Private names, links and synced IDs are
  not sent to discovery. Synced items retain known installed source links.
- Missing/deleted catalog entries remain visible with saved details. Failed reads
  offer retry without changing membership; missing links no longer imply local.
- Account-menu navigation focuses the destination main area. Ordinary Escape
  still returns focus to the menu trigger.
- Verification: both model regressions failed before the fix and passed afterward;
  all 224 portal tests and the production build pass. Local browser checks at
  390/1440px confirmed restored details/source links, Profile/Agents focus and
  Escape. Synthetic failure/retry and missing-entry cases also passed. Batch,
  cancellation, cache and private-data boundaries have unit coverage. The expanded
  standalone browser regression was not run; its new focus cases were checked
  through the local browser instead.
- Release receipt: [workflow 37788897276](https://github.com/jonslimak/omgskills/actions/runs/37788897276)
  succeeded. Draft `6ac7a7e180a53b428ebad6f5` and production
  `6ac7a90cedba638c90e33545` both verified on the first attempt. Public appcast
  comparison passed. All 2,210 public non-app files matched the preceding
  scheduled data deployment `6ac7a1626ef19279968847f5`.
- Live read-only checks: all five signed-in Favorites rows showed catalog names
  and descriptions; xlsx showed its author and GitHub source on desktop/mobile.
  Keyboard account-menu navigation focused `main#unified-main` (Profile at
  1440px, Agents at 390px); Escape returned focus to the account-menu button at
  both widths. The viewport was restored and the browser returned to Discover.
- Real account data, connections, backend and data model were untouched. These
  checks do not close the broader recovery, connection or account-isolation
  edge cases below.

## Current Acceptance And Remaining Work - 2026-10-07

This section supersedes acceptance/status statements in the dated checkpoints
below. User-reported production tests are recorded separately from automated or
agent-observed checks. This documentation update makes no new product changes
and does not authorize account mutations, a commit, or a deployment.

### Confirmed In Production

- [x] My Skills loads after the production sign-in configuration fix.
- [x] Create a test set, add skills, select Invite only, and save recipient email
  access; access persists after refresh.
- [x] A second account can open the shared link and read the set without editing it.
- [x] Removing the recipient's access denies access after their page is refreshed.
- [x] Favorites and skill/set changes persist after refresh.
- [x] User confirmed sign-in and the flows they tested work on the latest release.
- [x] User confirmed switching between two accounts removes the previous
  account's skills.
- [x] User confirmed bulk add/remove, ordering, and Hide/Restore work.
- [x] Latest loading/panel release passed guarded draft and production checks.
  Agent-observed signed-out discovery, batched collection loading, and desktop/
  mobile detail placement passed; all 2,210 public non-app files stayed unchanged.
- [x] Mobile header, feed dividers, Edit/agent placement, and set-header/action
  tweaks shipped in `b6941765`. The user reported "I verified the ui changes"
  after deployment. This closes acceptance of the requested visual changes,
  not every account destination, accessibility state, or connection flow.
- [x] Account-dialog fixes shipped in `1aaa9266` and passed guarded deployment
  checks. The user reported "it seems to be working" afterward. This is a limited
  user observation, not confirmation of deliberate save failures or connection
  lifecycle tests.
- [x] Navigation accessibility fixes shipped in `5eeb87ec`. Guarded release
  checks and agent-observed signed-out desktop/mobile focus and Open-label
  checks passed. This does not close the broader signed-in accessibility sweep.
- [x] Favorites catalog details and account-menu navigation focus shipped in
  `a8ab048e`. Guarded release and read-only signed-in desktop/mobile checks
  passed; saved membership and existing connections were not changed.

Evidence for account behavior: the user reported "all tests pass for me" for the proposed invitation
checklist, then confirmed "they do" for Favorites and skill/set persistence.
These are user-reported results on `https://omgskills.com/app/`, not a fresh agent
browser test or proof of every item type, host, device, or concurrency edge case.
The earlier local invite-save failure is no longer an open production blocker;
its local root cause was not established and the local experiment stays stopped.
Evidence for the latest release is in the verified release receipt below.
Subsequently, the user reported "I tested the signin and most of the things and
all work", answered "yes" to the two-account switching/previous-skills check,
and reported "tested all work" for bulk add/remove, ordering, and Hide/Restore.
These are user-verified production results, not new agent-run tests. They do not
establish coverage of deliberate failure/race conditions or every host/device.

### Remaining Acceptance (Not Confirmed Implementation Gaps)

- [ ] Account-isolation edge cases: switching during a deliberately delayed
  in-flight read, and authenticated navigation on `app.omgskills.com`.
  Local controller tests cover populated-account late reads, disposal, pending
  save completion and access invalidation. Ordinary two-account switching is
  user-accepted above; the additional race/host cases were not explicitly tested.
- [ ] Management edge cases: partial failures, mixed item types, and protected
  Favorites behavior. Bulk add/remove, ordering and Hide/Restore are user-accepted.
- [ ] Catalog-specific edge cases: first-ever Favorites creation from Discover,
  repeated/concurrent saves, and installed/catalog duplicate representations.
  Ordinary Favorites persistence is already accepted above.
- [ ] Account destinations: profile editing/publication, devices, private GitHub,
  and MCP connection instructions; test external connections only within an
  explicitly agreed scope. Include legacy set links and pairing/review routes.
- [ ] Deferred at the user's request: real disconnect/reconnect, device revocation
  and pairing checks. Leave existing connections untouched; these are untested,
  not failed, and do not block the next read-only review.
- [ ] Final UI/accessibility sweep: mobile sheets, keyboard/focus, light/dark,
  long content, back/forward and direct links, loading/error recovery. The local
  four-width sample-data pass and real signed-out desktop/mobile panel smoke
  check are complete. The user accepted the deployed visual tweaks; a systematic
  signed-in navigation, keyboard and recovery sweep remains separately unverified.
- [ ] Production performance: cold/warm Discover timings and request sizes.
  One live signed-out timing sample is recorded below; repeated measurements
  and signed-in behavior remain unverified. Local fixture timings do not count.

No new implementation gap was reported by these production tests. The approved
isolation/mobile and discovery-loading passes are live, and the user has accepted
ordinary sign-in, account switching, and the named management actions.

### Next Work

The user's quick UI tweaks are complete, committed, deployed and user-accepted.
The read-only source/test review below is complete. Both account-dialog issues
are fixed, committed and live. The user reports the release seems to work;
full signed-in failure/recovery and connection lifecycle checks remain unverified.

Approved next task: a read-only signed-in UI/navigation sweep
on desktop and mobile, covering keyboard/focus, light/dark layout, Back/Forward,
direct links and account destinations known not to write on load. Report any
confirmed gaps before proposing fixes. Do not save settings, switch accounts,
disconnect/reconnect, pair devices or alter existing connections.

The first live pass reached signed-out public discovery only; account screens
and live dark mode remain unverified until a signed-in session is available.
Mobile layout, skill-sheet keyboard containment/dismissal/focus return, direct
skill reload, Back/Forward, search and empty results passed. Two small accessibility
issues were confirmed and the user approved fixing them, as recorded below.

The earlier proposed sign-in/account-switch and bulk-management checks are
superseded by the user confirmations above. Profile/device/connection screens
and the remaining edge cases stay open. Apart from the two corrected issues
below, they are unverified, not known defects.
Any later production test involving session changes, mutations, or external
connections needs an agreed scope. Further performance changes should follow
repeated measurements, not the single timing sample below.

### Navigation Accessibility Fixes - 2026-10-07

- Deployed on 2026-10-08: page changes move focus to the existing
  main-content target; Open actions include the skill name in their accessible
  label while retaining the visible "Open" text.
- Initial load, search typing and source filtering do not trigger page focus;
  selected skill dialogs retain their existing focus handling.
- New isolated browser regression reproduced both issues before the fix and
  passed afterward at 390/1440px, including search focus, detail dismissal and
  Back/Forward. All 219 portal tests, the portal build and the existing four-width
  browser acceptance suite passed. Browser tests used sample data, blocking API
  and external requests; no account or connection changes were made.
- Regression entry: `portal/testing/navigation-accessibility-browser.mjs`.
- Release: commit `5eeb87ecf5cca419cb64c60f22bc44786e540f94`, workflow
  `37780658720`, draft `6ac793b5459c76fab2d4557b`, production
  `6ac794c2459c7607e4d454dc`. Receipt status `verified` at
  `2026-10-08T13:08:05.146Z`; draft and production checks passed on their first
  attempt. Root `npm run check`, all 219 portal tests and the focused browser
  regression were rerun after fast-forwarding to current main before release.
- Live verification at 390/1440px: Discover/collection navigation focuses main;
  Open actions identify the skill; opening details focuses Close and Escape
  returns focus to the original Open action. Signed-out only; no account or
  connection mutations. Temporary browser viewport override was reset.
- Compared all 2,213 non-app files against production
  `6ac7839c60a9f1034a569603`: none changed, including public pages/data,
  downloads and update assets. Workflow also confirmed appcast unchanged.
  Receipt, file inventories/comparison and live screenshots are retained under
  ignored `dist/accessibility-release/` in the implementation worktree.

### Account Dialog Fixes - 2026-10-07

- Profile dialogs no longer treat an unconfirmed save as an active request.
  Cancel/Close remain usable after failure; resubmission stays blocked until
  account refresh. Existing validation failures remain correctable.
- Device connection and revoke dialogs receive the unified light/dark theme.
  Unthemed legacy dialogs retain their existing styling.
- Verified: 219 portal tests, TypeScript/build, focused browser failure/recovery
  checks at 390/1440px, light/dark connection and revoke dialogs, and the existing
  four-width UI regression suite. Browser checks used sample data with external
  and API requests blocked. No real connection, publication, or account mutation
  was performed. The temporary frontend test server was stopped afterward.
- No backend, authentication, permissions, schema, or public-site changes.
- Self-service GitHub installation setup remains a separate future feature;
  this pass does not add it.
- Release status: live. Commit `1aaa9266abe9d94cc0d6ba10b8804e0d0e018950`
  was pushed to main and published by scheduled workflow `37684161642`.
  Draft `6ac6af7a5610ec4f4605df94` and production
  `6ac6b083bf8140fdd1657f88` passed guarded checks; the release receipt completed
  at `2026-10-07T20:54:15.190Z` with status `verified`.
- Production inventory comparison checked 2,210 non-app files. Only the scheduled
  `/data/health.json` changed; marketing pages, public data assets and downloads
  were otherwise unchanged. All 11 Mac release assets and appcast matched.
- User observation: "it seems to be working". Disconnect/reconnect is explicitly
  deferred; do not count the observation as a full connection or profile-save
  recovery test. Receipt and comparison are retained under ignored
  `dist/scheduled-release-37684161642/` in the implementation worktree.

### Account And Connection Review Plan

Goal: confirm the remaining destinations work with the unified shell, without
redesigning them or changing APIs, authentication, permissions, or the data model.
Use the real production site for connectivity checks; do not create disposable
servers or databases. Use local fixtures/unit tests only for deterministic UI,
validation and failure-state checks.

1. **Read-only source and test review.** Trace account-menu destinations through
   `portal/src/integration/unified/Session.tsx`. Review the existing profile,
   device, private-source, pairing and review tests. Record each behavior as
   verified, a confirmed gap, or requiring a scoped production test. Do not count
   a local fixture or source inspection as proof of a working external connection.
2. **Read-only production navigation.** With an agreed signed-in session, open
   Profile, Devices, GitHub sources and MCP from the menu. Check desktop/mobile
   layout, direct URLs, refresh, Back/Forward, current account context and error
   presentation. Open only destinations known not to write on load. Do not click
   connection or confirmation actions until their side effects are understood.
3. **Report before mutation.** Share confirmed defects with file references and
   the smallest fix proposal. List any checks that need account changes and the
   exact test account/device/repository required. Wait for scope approval before
   saves, publication, pairing, revocation or external installation changes.
4. **Scoped end-to-end checks, only after approval.** Verify persistence and
   downstream effects in production for approved actions, then restore only the
   agreed test state. Reuse existing accounts and connections where read-only;
   never revoke an existing working connection as an exploratory test.

Review checklist and completion evidence:

- [ ] **Profile:** `ProfilePanel.tsx` and the account controller. Check saved
  handle/public URL, edit/cancel, validation, disabled/busy/error states and Clerk
  settings entry. Saving or Publish/Unpublish requires approval and a recorded
  baseline. A full pass includes refresh persistence and the expected public URL
  visibility, without exposing private email or private skills.
- [ ] **Devices:** `DevicesPanel.tsx`, `ConnectionDialog.tsx` and
  `device-session.ts`. Confirm the list reflects the current account and displays
  loading/empty/error states. Inspect token/pairing creation before opening the
  connection dialog. Real pairing or revocation requires a named test device;
  completion means the intended device connects or loses access, with unrelated
  devices and installed skills unchanged. Do not log pairing secrets.
- [ ] **Private GitHub:** `PrivateSourcesPanel.tsx` and
  `private-source-session.ts`. Check available installations/repositories,
  feature-disabled/empty/error states, path validation and ownership boundaries.
  Linking, refreshing private content, unbinding or changing GitHub App access
  requires approval for a selected pilot repository. No new broad repository
  permissions; keep private content and credentials out of screenshots/logs.
- [ ] **MCP:** the unified `mcp` view and `/developers/` instructions. Verify the
  displayed endpoint, instruction link, public read-only tool contract and an
  existing harmless discovery request. Deployment health checks already passed;
  they do not prove agent setup. Installing/configuring MCP in an agent requires
  separate approval and is unnecessary for the initial read-only review.
- [ ] **Older links and helper routes:** `entry-navigation.ts`, `routes.ts`,
  pairing and review routing. Check `/app/groups/:id`, `/app/sets`, `/app/agents`,
  `/app/home`, `/app/review/` and the supported pairing entry on both supported
  hosts. Preserve the destination through sign-in; missing or unauthorized IDs
  must not reveal another account's data. Test review/approval submissions only
  within an agreed pairing scope, not by creating unsolicited install requests.

Risks: production saves can publish a profile, disrupt a working device, expose
private-repository content or alter access. Avoid these during the first review;
use explicit scope and read-back evidence for later writes. A disabled rollout
feature is not automatically a missing implementation and must not be enabled
just to make a check pass.

Deliverable: a short findings list and per-flow evidence/status. No product edits,
commit or deployment are included in preparing this plan. Remaining race,
partial-failure and repeated performance checks stay in the separate backlog.

### Verified UI Tweaks Release - 2026-10-07

- Commit `b69417656d1a69be1f3d83fae2e04252e784b5fb` was pushed to main.
  Draft `6ac69f09c300afeadb822f9a` and production
  `6ac6a028c8329ce482ee2c3e` passed the guarded complete-site deployment.
  Receipt completed at `2026-10-07T19:44:41.576Z` with status `verified`.
- Scope: mobile search/header spacing and contrast; removal of skill/set row
  dividers; aligned Edit/agent controls; set rename/visibility/action placement;
  icon-only Copy link; mobile-only hiding of the set's skill-avatar group.
- Verified 217 portal tests, full `npm run check`, combined production build,
  four-width local UI acceptance, and focused set-control/breakpoint checks.
- Live signed-out desktop/mobile browser checks confirmed discovery loading,
  single-row mobile header, removed row dividers and no page errors/overflow.
  Signed-in set interactions were checked locally, then the user accepted the
  deployed UI. Do not describe this as an agent-run signed-in production test.
- All 2,210 public non-app files were unchanged. All 11 Mac release assets and
  appcast matched production byte-for-byte. No backend/data-model, auth setting,
  permission or Mac release change was included.

### Previous Loading Release - 2026-10-07

- App source commit `0e51f512` was integrated with current main's catalog update
  `bac117d5` and pushed to main. No schema, permissions, authentication settings,
  or Mac release changes were included.
- Regenerated ignored public library pages from current inputs before packaging;
  stale local generated pages initially failed the non-app comparison. No failed
  candidate was published and no comparison guard was relaxed.
- Draft `6ac68f4582e0246021971165` and production
  `6ac6906f6d4c8564369c82ba` passed the guarded complete-site checks, including
  public library pages, exact manifests, downloads, protected routes and MCP
  `get_skills`. Receipt: `dist/netlify-deploy-receipt.json` (ignored).
- The production file inventory confirmed all 2,210 public non-app files were
  unchanged. All 11 Mac download/update assets and appcast were preserved.
- Re-ran 217 portal tests, full `npm run check`, the complete production build,
  four-width UI checks and controlled discovery-loading browser checks.
- A fresh signed-out Chrome session on `https://omgskills.com/app/` confirmed
  live discovery, one collection batch request, no per-skill collection calls,
  desktop detail top at 0px, bottom-aligned mobile detail at 390px, no horizontal
  overflow and no page errors. Screenshots were inspected. One warm-service
  sample measured first discovery rows at 1,088ms and collection rows at 240ms;
  these are spot checks, not a cold-start benchmark or signed-in acceptance.
- Draft browser authentication remained restricted to the production domain
  (`origin_invalid`); no auth protection was changed. Browser smoke checks used
  the real production domain after deployment. Existing signed-in acceptance
  and outstanding account-isolation checks remain distinct from these results.

### Local Discovery Loading Pass - 2026-10-07

- [x] Public entry reads start while Clerk initializes, using the existing bounded
  public cache/in-flight deduplication. Private navigation/search is stripped
  before preloading; account requests, permissions and session isolation are unchanged.
- [x] Discover renders collections/creators and trending independently. Each can
  load, fail, retry or retain its last good result without hiding the other.
  Final layout/copy is unchanged. Other list views use their relevant loading state.
- [x] Added read-only MCP `get_skills` for up to 30 exact IDs. Collection reads use
  one batch instead of up to 30 individual calls, preserve display order, report
  missing entries and reuse results for detail reads. Existing tools and data
  models are unchanged. Deployment verification now checks the additive tool.
- [x] Verified 217 portal tests, full `npm run check`, portal TypeScript/build,
  MCP build/5 transport tests, and desktop/tablet/mobile acceptance at four widths.
  Controlled browser checks confirmed preload before account readiness, one shared
  trending request, independent error/retry paths, six collection skills in one
  batch, cached details/revisits and no private data sent to public endpoints.
- [x] The test fixture remains localhost/DEV-only and is excluded from the build.
  No account writes or new persistent backend/test database were used. The portal
  build used a placeholder test key and is verification-only, not deployable.
- [x] Committed and deployed the updated MCP function and client together in
  `0e51f512`. Production verification and a real signed-out collection request
  confirmed `get_skills`. Signed-in and repeated cold/warm timing checks remain.
- [ ] The server's full-catalog cold-start load remains unchanged in this pass.
  Earlier live inspection found a roughly 79 MB decoded skills asset; that is
  server-side startup work, not a browser download.

This pass was initially local-only; the verified release above subsequently
published it together with the 32px desktop detail offset fix. No schema migration
or account change was made.

### Local Isolation And Navigation Pass - 2026-10-07

- [x] Reviewed the keyed user/session boundary, request cancellation, private
  navigation filtering, and account state disposal. No backend, schema, auth
  configuration or permission changes were needed.
- [x] Added populated-account late-response and access-invalidation regression
  tests. Existing save/disposal tests continue to pass. These are synthetic
  controller tests, not live sign-in or authorization tests.
- [x] Fixed related-skill navigation from My Skills: installed matches retain
  their local detail identity; public-only skills open in Discover without
  carrying private set IDs, searches or source filters.
- [x] Fixed keyboard focus after related-skill navigation, direct-link closes,
  and resizing an open desktop panel into a mobile sheet. Return to the original
  visible trigger, or to main content when that trigger no longer exists.
- [x] Added the existing Discover return control to signed-out secondary lists
  and search results, so mobile users are not stranded without the desktop nav.
- [x] Browser matrix: 1440, 1024, 390 and 320px; detail sheets, nested Add to set
  dialogs, Tab containment, Escape/focus restoration, Back/Forward, related skills,
  Invite layout, long content, dark appearance, signed-out return paths,
  direct-link reloads, empty/loading/error states and error retry.
- [x] Verification: 214 portal tests, full `npm run check`, TypeScript/Vite unified
  build and browser matrix passed. Screenshots reviewed under
  `output/playwright/unified-acceptance/`. No API/external requests were allowed
  in the browser matrix; it reused the existing Vite frontend on port 5191.
- [x] Added a repeatable localhost-only sample review page and browser runner in
  `portal/testing/unified-acceptance*`; neither is a production entry point.

The full authenticated build was checked with the repository's non-secret
placeholder Clerk key, in `/private/tmp/omgskills-unified-acceptance-build` only.
It is a compile check, NOT a deployable artifact or live-auth test. Production
builds still require the guarded combined builder and real approved live key.
No production accounts were changed. This was initially a local-only pass; its
fixes and regression tests shipped in the verified `0e51f512` release above.

### Intentionally Outside This UI Migration

Invitation email delivery, remote install/uninstall, automatic updates/set
subscriptions, and full README content absent from the existing API remain out
of scope. Sharing currently grants read-only email access and provides a link
to share manually. These are separate product decisions, not failed tests.

### Authentication Fix Receipt

- An overnight automated build embedded a Clerk test publishable key while the
  previously verified manual build used the live instance. Account loads failed
  with an access error.
- Corrected the GitHub Actions `VITE_CLERK_PUBLISHABLE_KEY` setting to match
  Netlify's existing production build value. No server secret or account data
  was changed.
- `scripts/portal-build-env.mjs` now rejects missing, test, malformed, and
  unrelated-instance keys before the combined builder invokes Vite or replaces
  deployment artifacts. All seven production workflows use this shared builder.
- Commit `cb0d8164006ba8190c1662e125eb93dcb44cb86c`; guarded draft
  `6ac635659fa6deb90e6ccd45`; production `6ac6367cfd2afecd22a5c69b`.
- Deployment-safety tests, 211 portal tests, combined build, draft/live library
  and manifest checks passed. The live bundle was checked for the correct
  production instance. Non-app file comparison: 2,210 unchanged files.
- No schema, API, permissions, Mac release, or public content changes.

## Current Working Agreement - 2026-10-06

This section supersedes earlier local-integration testing requirements and stale
approval/status statements in historical checkpoints below.

- **Finish the UI/UX first.** Compare every intended screen and interaction with
  `web-handoff/app/` and preserve existing production app capabilities. Do not
  confuse a polished screen with a complete or verified workflow.
- **Use localhost for presentation review**, responsive layout, keyboard behavior,
  and deterministic loading/empty/error/permission states. Reuse the existing
  preview and fixtures when useful. Do not create, rebuild, or expand disposable
  servers/databases/accounts to chase connectivity problems.
- **Keep code checks local.** Run build, unit/contract tests and static checks.
  Identify missing handlers, placeholder actions, unsupported contracts, and
  client bugs before shipping; deferring connectivity tests does not excuse
  known implementation gaps or mean every error is caused by localhost.
- **Confirm real connectivity in production after an approved deploy:** auth,
  both app hosts, catalog requests, account persistence, invitations/email access,
  account switching, and external-service flows. Mark only the specifically
  confirmed checks as passed in the current acceptance section above.
- **No schema/API/permission redesign.** Reuse existing supported contracts.
  If the mock needs a capability the backend does not provide, record the gap and
  get a scope decision instead of simulating success or silently dropping it.
- **Release remains a separate gate.** Follow `deploy.md`, review the UI first,
  and fix forward on failure. Having no users reduces rollout impact but does not remove
  permission/data exposure risks. Production access changes and destructive tests
  need an agreed test account/set/recipient scope; do not use personal skills.
- The latest user approval covers the scoped commit, main integration, and
  production deployment with the two safeguards below. It does not approve new
  email delivery, account access changes, or local connectivity experiments.

### Production Safeguards - 2026-10-06

- `config/production-features.json` now explicitly enables `portalUnifiedEnabled`.
  The shared build reads this setting and overrides ambient build flags, so
  scheduled builds retain the approved app. Mac auth/release gates are unchanged.
- The shared deploy helper uploads the same prebuilt artifact for draft and
  production. Failed verification records an incident and blocks later deploys;
  it never restores an older whole-site snapshot. The existing incident issue
  title remains compatible with previously opened circuit-breaker issues.
- Verified: 23 focused feature/deploy tests and `npm run check` pass, including
  failed-verification/no-restore coverage. No schema/migration changes.
- Release boundary: only `/app/`, its catalog proxy routes, and the approved
  catalog/Favorites handler fixes may change. Compare every non-app public file
  with the live file inventory before release; preserve release binaries exactly.
- Live acceptance still needs an agreed account/set/recipient scope before
  testing writes or granting access. Structural checks do not confirm invitations.

### Production Release Receipt - 2026-10-06

- Source `9d99a7ca754a230d60b178f58dd22736ec2e818c` was fast-forwarded to main.
  GitHub workflow-writer-safety run `37526528854` passed.
- Followed prepare, locked dependency install, combined build, guarded draft,
  then production deployment. The tracked unified flag selected the UI without
  an ambient flag override. All 210 portal tests and full `npm run check` passed.
- Draft: `6ac5599ebb13daa4e043c297`; production:
  `6ac55adfbe78b2bd038287a4`; previous production:
  `6ac51f39b0136aa966b26694`. No restore operation was used.
- Both verification stages passed on their first attempt: app/release gates,
  protected health, unauthenticated API rejection, manifests, AI catalog/MCP,
  download redirect, DMG/checksum, every referenced update asset, public library
  pages/canonicals/redirects, and exact manifest comparisons.
- Before/after Netlify file inventories confirm zero changes across 2,210
  public non-app files. Existing release assets and appcast remained identical.
  Database migrations, public pages/data, root Netlify configuration and health
  edge-function source were unchanged; no Mac release or schema change occurred.
- Browser: `https://omgskills.com/app/` and `https://app.omgskills.com/` loaded
  Discover with live collections/trending/creators. API design category search
  returned 30 results and the selected skill detail opened. No console errors
  were captured. Screenshot: `/private/tmp/omgskills-unified-live.jpg`.
- No signed-in account mutation, access grant/revoke, invitation email, or
  external connection was tested. Those remain explicit production acceptance
  items, not implied by successful deployment. Local receipt:
  `dist/netlify-deploy-receipt.json` (ignored, not a public artifact).

### Earlier Local Invite Issue (Production Flow Accepted 2026-10-07)

- User reports `Could not confirm the save. Refresh before trying again.` when
  adding email access in the local app. Root cause is not established. An isolated
  client-to-handler test passed, but that does not clear the browser failure.
- `Read-only access. No invitation email is sent.` is explanatory copy, not the
  error. Email delivery is not implemented or part of the current UI migration.
- The user has now confirmed production email-access grant, revoke, persistence
  and read-only recipient access. The local report remains historical; reopen
  the issue only if it recurs rather than expanding the stopped local experiment.
- Local diagnostic set `Invite diagnostic (temporary)` remains empty and private
  (ID `23547cdb-2b16-4878-aa4d-d6a324de0499`). Permission testing stopped. Do not
  resume that experiment or remove existing local data without approval.

### Broad UI/UX Review Inventory

These broad rows mix several behaviors and are not a second current task queue.
Keep a row open until all of its behaviors have evidence; completed narrower
checks and the actionable remaining queue are recorded at the top of this file.
A local connection failure alone does not establish a missing UI feature.

- [ ] Shell/navigation: signed-in/out entry, My Skills/Discover, rail, mobile tabs,
  account menu, back/forward, direct links and restoration of selected detail.
- [ ] Discover: featured collections, trending, creators, categories/search,
  selection, result limits, and loading/empty/error/retry states.
- [ ] Skill rows/detail: spacing/type/icons, source indicators, long content,
  panel/sheet sizing, copy/source actions, Favorites and Add to set entry points.
- [ ] My Skills: search, source filters, grouped installs, multi-selection and
  bulk actions, partial failures and preserving selection after failed work.
- [ ] Sets: listing, create/rename, add/remove, ordering, mixed item types,
  Hide/Restore, protected Favorites, empty/deleted/unavailable states.
- [ ] Set detail/inviting: mock fidelity, separate visibility/invite controls,
  owner/reader/public states, member information, pending/error/confirmation
  feedback and a usable path for recipients to open the set. Core live access
  is user-accepted; the broad visual/state review remains separate.
- [ ] Account destinations: profile, agents/sources, devices, private GitHub and
  MCP; reachable existing controls with no dead buttons or sample-only settings.
- [ ] Responsive/accessibility: desktop/mobile, light/dark, long names/emails,
  focus/keyboard/Escape, touch targets, scroll/overflow and modal recovery.
- [x] Production entry: unified shell connected to the real session and supported
  mutations. Legacy/pairing/review routes are preserved in source/tests; remaining
  authenticated route checks are tracked in the current acceptance section.
- [ ] Final gap register: label each item **implemented + UI reviewed**,
  **implementation missing**, **intentionally omitted**, or **production check
  pending**. User approves omissions and reviews the finished UX before release.

### UI Gap Implementation Checkpoint - 2026-10-06

User approved implementing the focused review findings, not deployment or live
permission changes. Existing work in this checkout was preserved. No database,
backend endpoint, deployment configuration or disposable server was changed.

| Gap | Implementation / current acceptance |
| --- | --- |
| Discover actions | Exact catalog-ID install association retained; Add to set and Favorite actions use existing APIs, not synthetic installs. Catalog additions check current ownership/membership and reconcile conflicts only when identity is returned. Missing catalog identity blocks additional saves to prevent duplicates. Live writes pending. |
| Set sharing | Copy link in the set toolbar and Invite dialog, with explicit no-email/access guidance. Local links use the unified route; production keeps canonical public or authenticated set links. Dialog visually reviewed; recipient access pending. |
| Bulk management | Edit/select, add selected skills, create a set from selected installed skills. Partial add failures retain failed items in the dialog; uncertain results require refresh. Bulk dialog reviewed without saving. |
| Ordering / Hide / Restore | Item menus use existing reorder API with current item IDs; set menu confirms Hide/Restore. Hidden sets have a listing filter. Menu boundaries reviewed; real mutations pending. |
| Account destinations | Profile editing/publication confirmation/settings wired to the existing session. Devices and GitHub reuse existing guarded panels; MCP instructions are reachable. Profile dialog reviewed. Local devices showed a load error: do not expand the harness to chase it; confirm in production. |
| Mobile / icons | Favorites gets a direct mobile tab; small text controls have a minimum hit area; source badges normalize casing for display without changing stored data. Checked library and Favorites at 390px: no horizontal overflow, distinct Claude/Codex icons. |
| Production entry | `VITE_PORTAL_UNIFIED_ENABLED=1` selects the unified shell only in production with the web flag enabled. Default remains off. `/app/groups/:id`, sets, agents and home links map to unified views; sign-in preserves the intended set. Pairing/review routing remains separate. |

**Icon correction:** feed source badges now use the exact `agent-claude.png` and
`agent-codex.png` assets from the handoff, replacing generic sparkle/robot icons.
The mock's 12px monochrome masks and 19px tiles are preserved. Verified rendered
in the local feed; screenshot: `/private/tmp/unified-feed-brand-icons.jpg`.

**Commit scope:** includes the earlier uncommitted Discover caching and set-access
UI work, its existing local harness/tests, this UI gap pass, the icon correction,
and documentation. Retaining earlier harness code does not authorize further
local access tests. Generated builds, screenshots, credentials and environment
files are excluded. Reconcile newer main commits before release; do not treat
this branch checkpoint as a main merge or deployment.

**Backend limit at the UI checkpoint (addressed by the follow-up below):** creating Favorites requires at least one synced
skill (`portal-groups.mts`). No workaround or fake synced ID was added. Catalog
skills can be added to an existing Favorites set; without one, the UI explains
the requirement and blocks the unsupported save. Expanding this API needs a
separate scope decision.

**Catalog identity limit at the UI checkpoint (addressed by the follow-up below):** `portalGroupItem()` omits catalog
IDs. The client accepts optional IDs but does not assume they exist. A set with
unidentified catalog items blocks further catalog additions rather than guessing
membership or risking duplicate rows. Completing repeat-safe catalog saves needs
a separately approved read-contract update; no backend code was changed here.

**Still intentionally unavailable:** remote installation, automatic updates,
invented member counts, invitation email delivery, and README content unavailable
from the existing contract. Public pages and the data model remain unchanged.

**Verification:** TypeScript and 195 portal tests passed, including new catalog
membership guards, exact-ID matching, source casing, and legacy route checks.
Default and opt-in production builds were checked; the opt-in build used a dummy
public Clerk key only for compilation, not a live sign-in. No live credentials,
permission changes, email grants, or production writes were tested. Discover's
Add to set dialog was checked without submitting. Desktop invite and mobile
library screenshots are saved under `/private/tmp/unified-gap-fixed-*.jpg`.

Before release: complete user visual review, recheck current main, follow
`deploy.md`, explicitly choose/enable the unified flag, retain rollback, then
verify auth, devices/GitHub, set persistence, profile changes and recipient access
on the approved production test scope. The broad checklist above is not marked
fully accepted merely because the focused fixes compile.

### Catalog/Favorites API Follow-up - 2026-10-06

User explicitly approved the smallest backend changes after read-only inspection.
No database tables, columns, migrations, permissions, production flags, local
harness or servers were changed. The user subsequently approved review and commit
on this branch only. No merge, push, deployment or live mutation is authorized.

- Existing `POST /api/portal/groups` now accepts one `catalogSkillId` when creating
  Favorites without synced skills. It reuses catalog release validation and saves
  the public Favorites set and its first item in one transaction. Empty Favorites,
  mixed catalog/synced creation, invalid IDs and catalog creation for ordinary sets
  are rejected. Existing synced creation remains supported.
- Both item-read endpoints include `catalogSkillId` for catalog items for owners
  only, through the shared response mapper. Invited/public viewers retain existing
  redaction. No private install IDs or new access rights are exposed.
- Catalog insertions check exact set/catalog identity under the existing row lock
  and return 409 for duplicates before writing item/release records. No unique
  index/migration or cleanup of existing records was added.
- The client can create first-time Favorites directly from Discover after the
  existing public-visibility confirmation. A concurrent creation conflict triggers
  a fresh owned-set/membership read; unknown outcomes are not retried. The installed
  skill prerequisite is removed. The missing-ID guard remains for older deployed
  responses during rollout, rather than guessing or allowing duplicates.
- Verification: 198 portal tests, 49 focused backend tests, root/portal TypeScript,
  default/opt-in builds and whitespace checks passed. Coverage includes validation,
  transaction rollback control, simulated concurrent saves, identity redaction,
  existing synced flows, stale client data, aborts and uncertain responses. SQL,
  network and lock behavior are simulated in these tests, not a live DB acceptance
  claim. Real creation/persistence/recipient access remain production checks.

Focused pre-commit review found no blocking issue within this scope. Local test
results do not establish production persistence or real database concurrency.

Next: reconcile current main and finish the remaining UI checklist; follow
`deploy.md` for a separately approved rollout. Verify first catalog Favorite,
repeat/concurrent saves and existing Mac/installed Favorites in production, along
with the already deferred invite/connectivity checks.

### Favorites Heart And Removal Correction - 2026-10-06

- [x] Fixed catalog-only Favorites detection in the unified presentation model.
  Previously the heart required an installed skill, even after a catalog save.
- [x] Unified account reads now hydrate only the owner's Favorites through the
  existing detail endpoint. This adds one read when Favorites exists; normal set
  summaries and legacy account loads remain unchanged. No private browser cache
  was added. Refresh/save reconciliation includes the membership read.
- [x] The heart's removal action reads current item IDs and removes exact catalog
  and matching synced representations using the existing item-delete endpoint.
  It does not uninstall skills, delete files, or change ordinary sets. Ownership,
  hidden-state and incomplete-identity checks run before deletion. Uncertain
  outcomes stop the operation and require refresh; writes are not replayed.
- [x] Added regression coverage for catalog add/remove/reload, installed-only and
  mixed representations, fresh IDs, similar-name isolation, ownership, missing
  mappings, failed/partial writes, failed reads and disposed accounts.
- [x] Ordinary Favorites changes and refresh persistence accepted by the user in
  production on 2026-10-07. First-ever catalog creation, concurrency and mixed
  representations remain explicit checks above. No new local account/set tests
  were performed; this does not complete the broad UI checklist.

This is a client-only correction: no schema, backend API, permissions, deployment
flags or styling changes. Verification: 210 portal tests, root/portal TypeScript,
default and unified opt-in builds passed. The opt-in build used a dummy public
Clerk key for compilation, not real authentication. The user approved this scoped
local commit; all 210 portal tests and portal TypeScript passed again before
committing. No merge, push or deployment is included in this checkpoint.

The preceding read-only release review fetched `origin/main` at `d22e476d`:
two generated-data updates, with no files overlapping this branch's changes.
That comparison was followed by the approved merge recorded below; fetch again
before an approved release.

### Main Merge And Release-Readiness Receipt - 2026-10-06

- [x] Fetched main and merged `d22e476d` into this branch as `7f73f8c6` without
  conflicts. `git diff origin/main -- index site/data` is empty: newer generated
  data is preserved exactly. The primary checkout's unrelated work was untouched.
- [x] Full root `npm run check` passed under Node 20, including root TypeScript,
  API/permission, routing, deployment-safety and published-data checks. The first
  sandbox attempt could not create a tsx IPC pipe; the approved retry passed.
- [x] All 210 portal tests and portal TypeScript passed after the merge.
- [x] Unified opt-in Vite build passed with a dummy public Clerk key, proving
  compilation only. Unified JS chunk: 74.88 kB / 23.09 kB gzip; shared portal API
  chunk: 407.00 kB / 124.63 kB gzip. These are build sizes, not live load timings.
- [x] Existing integration browser: Discover, skill detail, long description,
  source/public links, account navigation and Escape/focus return checked after
  the merge. No account writes or access changes were performed.
- [x] Source/tests preserve pairing and review routing before unified dashboard
  entry; preview/integration imports require development gates. Activation still
  requires an explicit unified build flag and the existing web gate.
- [ ] Complete final visual acceptance. The separate deterministic preview at
  port 5190 is offline. No replacement server was started. Earlier responsive,
  signed-out and error-state receipts remain historical, not a fresh full pass.
- [x] Produce the combined release artifact (completed in the receipt below).
  At the initial readiness check, this worktree lacked ignored
  `site/downloads/`, `site/updates/` and `site/data/health.json`; the current shell
  also lacks `VITE_CLERK_PUBLISHABLE_KEY`, `NETLIFY_SITE_ID` and
  `HEALTH_BASIC_AUTH_PASSWORD`. Restore verified release inputs and use the
  approved deployment environment before preparation/build. Do not use dummy
  credentials, fake CI mode, or deploy portal-only output to bypass these gates.
- [ ] Production auth, invite/access persistence, Favorites writes and both-host
  routing remain pending under the existing production test agreement.

No push, deployment, schema change or production activation was performed.
The subsequent approval covered restoring verified release inputs and preparing
the combined candidate below; production deployment is still separate. The broad
UI checklist is not marked complete from passing tests.

### Combined Candidate Prepared - 2026-10-06

User approved restoring release inputs and preparing the local combined package.
No commit, push, upload, deployment or live setting change was included.

- Restored the validated health snapshot from GitHub Actions pipeline-health run
  `37493572349`, using the existing age/schema checks. The older primary-checkout
  snapshot and Mac binaries were not copied.
- Downloaded the 11 required release assets directly from production. Confirmed
  the tracked appcast equals the live appcast; validated the DMG SHA-256 and every
  update ZIP/delta's appcast length and Sparkle Ed25519 signature. Rechecked live
  appcast/checksum after restoration to detect a release changing mid-download.
- Ran the documented order: prepare, locked `npm ci`, combined build. Preparation
  passed with 38 nonblocking policy findings about existing stale editorial skill
  references. No policy gate or link verification was weakened.
- Read only the production Clerk publishable key from Netlify's builds scope;
  passed it in memory to the build, without logging it or creating an env file.
  No private credential or health password was added to the client output.
- Built with `VITE_PORTAL_UNIFIED_ENABLED=1` for this local candidate only. Existing
  checked-in web/auth feature configuration is unchanged. A future default build
  does not automatically enable unified; release activation still needs approval.
- Output: `/private/tmp/omgskills-unified-app-preview/dist/netlify-site/`.
  Combined required-output guards, library verification and published-data
  verification passed. Appcast and all release binaries were preserved
  byte-for-byte in the combined artifact. Nine existing migration files were
  staged locally by the normal builder; no database migration was executed.
- A broad bundle-string probe matched dormant local-preview labels in shared UI
  components. Source tracing confirmed production passes `local={false}` and a
  real Clerk sign-in callback; those labels are gated. Tested fixture records
  are absent from the bundles. This is not a signed-in production acceptance test.
- No `.netlify/netlify.toml` cache is present. Only `appwork.md` is modified in
  tracked source; restored assets, generated pages, builds and receipts are ignored.
- Local receipts: `dist/release-input-receipt.json` and
  `dist/unified-candidate-receipt.json`. Do not commit these generated files.

Next: approve the remaining UX/omissions and a draft deployment of the combined
candidate, then verify host routing and deployment packaging. Keep production
invite/access/persistence checks under the previously agreed production test
scope. Recheck main and release inputs before any upload; this package is a
point-in-time candidate, not a guarantee of current-main deployment readiness.

### Draft Deployment Receipt - 2026-10-06

- User approved a draft upload only. Fetched main again: still `d22e476d`, fully
  included by the reviewed branch. Deploy inputs had no uncommitted changes;
  `appwork.md` remains the only modified tracked file.
- Draft: https://6ac554e5bde0e9a5bbaf36c8--omgskills.netlify.app/app/
- Netlify deploy ID: `6ac554e5bde0e9a5bbaf36c8`; source: `7f73f8c6`.
  Uploaded `dist/netlify-site` with functions/edge configuration using
  `netlify deploy --no-build --json`, without `--prod` or `--prod-if-unlocked`.
- Production deploy ID before and after upload:
  `6ac51f39b0136aa966b26694`. No production publish, Git push, feature setting,
  authentication setting or access grant was performed.
- Draft structural verifier passed: app shell/release config, About/Support,
  protected health routes (401), invalid-token API rejection (401), all three
  manifests, legacy download redirect, all release asset endpoints, AI catalog,
  MCP health/tool discovery/read-only catalog results. The verifier's generic
  final text says "Production deploy verified"; its target was this draft only.
- Deployed manifests, appcast and DMG checksum match the local candidate exactly.
  Homepage, guide, library, creator and starter collection pages returned HTML
  200. Did not run the production-only web-library live verifier against the draft.
- **Browser blocker:** `/app/` stays at "Loading account...". Console reports
  Clerk production keys are only allowed on `omgskills.com`; this temporary
  `netlify.app` origin is rejected. No security/domain settings were weakened and
  no test-key substitution was made. This is not a successful UI or login test.
- No account writes, invitation tests or new disposable servers were used.
  Authentication, set/Favorites persistence, invitation access and both-host
  runtime acceptance remain assigned to the separately approved production pass.
- Machine receipt: `dist/unified-draft-receipt.json` (ignored). Full acceptance
  remains false; structural verification is recorded separately.

Next requires explicit approval: commit the documentation, integrate/push the
reviewed branch through the current-main release process, preserve the unified
build flag for the intended release, then perform the controlled production
rollout and agreed account tests. Do not promote this draft merely because its
static and endpoint checks passed.

## Goal

Bring discovery from `/skills/` into `/app/`, using `web-handoff/app/` for the UI and interactions. Keep existing data models, APIs, permissions, and publishing pipelines unchanged.

### Confirmed Decisions

- Keep `/skills/`, public skill pages, creator pages, and collection pages available for search engines and existing links.
- Make `/app/` the unified discovery and management experience.
- Use the handoff's **My skills / Discover** switch, not the stacked navigation alternative.
- Rebuild the design in the existing React portal. Do not ship the prototype runtime or its sample data.
- Finish and review UI/UX locally; confirm real connectivity in production after approved deployment. Do not build more disposable test infrastructure. Commit, deploy, and broader capability work need separate approval.

## What Was Reviewed

| Source | Findings |
| --- | --- |
| Live `https://omgskills.com/app/` | Currently presents authentication to signed-out visitors. Authenticated behavior was assessed from current-main source, not a signed-in live session. |
| Live `https://omgskills.com/skills/` | Public discovery already has featured creators, collections, skill listings, and canonical detail links. Preserve this independent public surface. |
| `web-handoff/app/README.md`, `Web App v2.dc.html`, `support.js` | High-fidelity discovery/management prototype with sidebar switch, shared rows, detail panel, account menu, and mobile navigation. Data and many actions are simulated. Reviewed source; interactive prototype rendering was not verified in this audit. |
| Current-main portal and backend | The earlier portal redesign is already integrated. Reuse its session, membership, set, account, pairing, and access controls instead of implementing them again. |
| Public catalog API | A live read-only `search_skills` request to `/mcp` returned structured catalog data successfully. This proves the endpoint responds, not browser/subdomain compatibility or performance under load. |

### Checkout Safety

The working checkout is `codex/pinned-install-test-mode` at `227716f7`, with unrelated local changes. It is not the implementation baseline. `origin/main` was refreshed for this review without switching branches.

Start implementation from a clean worktree based on freshly fetched main. Carry over only this plan and the approved `web-handoff/app/` reference files, which are currently untracked. Leave this checkout and its unrelated changes untouched.

## Target Experience

### Navigation

- Signed in: open My skills by default. Switch to Discover without leaving the app.
- Signed out: open Discover without requiring authentication. Offer real Clerk sign-in for account actions, preserving the selected skill and destination.
- My skills: All skills, Favorites, and Sets. Preserve current search, source filtering, selection, and bulk membership operations.
- Discover: published collections, trending skills, creators, and the Mac app's grouped starter-search categories.
- Search: separate results into My skills and Library. Local private results remain local; never send their descriptions or contents to public search.
- Account menu: preserve access to profile, agents/sources, devices, private GitHub sources, MCP information, and sign-out. Moving these out of primary navigation must not remove existing functions.
- Mobile: My skills / Discover / Sets bottom navigation; signed-out public browsing without private tabs.

### Visual Structure

- Expanded desktop sidebar 212px; collapsed rail 60px.
- Below 760px: mobile header and navigation, no desktop sidebar.
- From 1180px: 380px right detail panel; narrower desktop uses a floating panel; mobile uses a bottom sheet.
- Content wrapper up to 1120px. Follow handoff spacing, neutral colors, blue actions, rows, avatars, and Lucide icons within the existing component system.
- Shared skill rows and detail content across My skills, discovery lists, and set detail. Preserve readable long names and descriptions.
- Keep agent/source indicators in stable columns, but derive the agents from actual data. Do not hardcode the prototype's five-agent population.
- Use existing accessible dialog/menu primitives, visible focus, keyboard navigation, tooltips, and mobile safe-area padding. Keep typography locally bundled or system-based.
- Support the supplied light/dark treatments with scoped tokens; appearance preference is browser UI state, not a new account field.
- Resolve layout rules against available content width when the detail panel is open. Do not force three discovery columns into insufficient space.

## Keep Existing Architecture

Current production flow is `bootstrap.ts` -> `redesign-main.tsx` -> `account/PortalSession.tsx` -> `app/PortalApp.tsx` when the existing redesign flag is enabled.

| Area | Planned work |
| --- | --- |
| `portal/src/app/PortalApp.tsx`, `routes.ts`, `redesign.css` | New navigation/layout and public discovery routes; retain established History API approach. |
| `portal/src/app/SkillsPage.tsx`, `SetsPage.tsx`, `SetDetailPage.tsx`, `AccountPages.tsx`, `ui.tsx` | Adapt existing views to shared rows, detail panel, and relocated account controls. |
| `portal/src/account/PortalSession.tsx` | Separate public browsing from authenticated account loading without weakening private-route checks. Keep existing session lifecycle. |
| `portal/src/integration/` | Reuse real read/write controllers. Add a small public-catalog client and display adapters only where needed. |
| Existing groups, devices, private-source and pairing modules | Reuse their contracts and controls. No schema, permission, or Mac changes. |
| `portal/src/preview/` and tests | Extend existing development-only fixtures to review the new UI and states safely. |

Suggested new components: app navigation, shared skill row, skill detail panel, Discover page, and reusable catalog list. Create them within existing ownership boundaries; avoid a second framework or generic provider system.

New client display types may combine existing fields. They must not redefine stored skills, groups, installs, or sources.

## Data Plan

### Private Management

Keep existing authenticated `/api/portal/` endpoints and controllers for synced skills, groups, membership, profile, devices, and private sources.

- Keep `groupSyncedSkills` and physical source skill IDs. One displayed skill can represent multiple synced records.
- Match a catalog skill to an installed skill through explicit `catalogSkillId`. Never merge by display name or repository URL alone.
- Keep ambiguous/local-only states explicit. Do not send private identifiers to public catalog lookups.
- Preserve aborts, session/account-specific caches, refresh-on-focus, sign-out cleanup, and protection from late responses.
- Preserve real mutation outcomes, partial bulk failures, permission checks, and ownership-specific controls.

### Public Discovery

Use existing published sources, not HTML scraping or a new copied catalog:

| UI | Existing source |
| --- | --- |
| Search | Public `/mcp` `search_skills` |
| Trending | `/mcp` `list_trending`; preserve current ranking meaning, do not invent weekly growth metrics |
| Skill summary/details | `/mcp` `get_skill` |
| Creator skills | `/mcp` `list_by_author` |
| Collections and featured creator metadata | Manifest-discovered collections asset using the existing library's track/fallback rules |
| Canonical public links | Existing `/catalog-skill-urls.json` and library URL conventions; measure mapping payload before deciding when to fetch it |

The current-main raw skills asset is approximately 79MB uncompressed. The collections asset is approximately 93KB. Never load the raw skills asset in the browser or import the server's filesystem-based catalog loader.

Use a small typed client around existing MCP JSON responses, with validation, aborts, timeouts, and honest errors. Prefer `structuredContent`; handle protocol errors and tool errors separately from empty results. Do not add a heavyweight SDK to the browser solely for these few read calls unless it is demonstrably simpler and small enough.

- Debounce remote search; abort outdated requests and deduplicate detail lookups.
- Fetch only the visible discovery section and selected details initially.
- Bound collection detail lookups and concurrency; reuse results across views.
- Lazy-load avatar images and retain dimensions/fallbacks to avoid layout jumps.
- Public caches must be separate from account data and bounded in memory.
- The current tools cap results at 100 and expose no cursor/offset. Do not invent pagination, total counts, or promise a complete creator listing. Offer refinement/public links where needed.
- The authenticated `catalog-search` endpoint returns only up to 12 basic results and requires sign-in. It is not the replacement for public Discover.
- Use published collections and creator labels. Categories are the Mac app's 24 starter-search terms, not collection metadata; selecting a term runs an exact-text public search. Do not invent quality claims.

### Transport Gate

Prove browser requests before building all discovery screens:

1. Verify `/app/` on the primary domain can call `/mcp` and published assets.
2. Verify the local development proxy routes those requests correctly.
3. Verify `app.omgskills.com` separately. The current subdomain rewrite can intercept generic paths; a same-origin `/mcp` assumption is not safe there. Cross-origin CORS support has not been verified.
4. If existing routes cannot support this without server/deploy changes, stop that slice and request a narrowly scoped plan adjustment. Do not silently add new endpoints, CORS policy, or a second data feed.

## Capability Rules

The handoff is the design authority, not proof that a backend capability exists.

| Handoff feature | First-release treatment |
| --- | --- |
| My skills / source filters / detail | Real synced data, existing grouping, explicit unknown fields. |
| Favorites for installed skills | Reuse real membership controller. Favorites remains a public, protected group; do not imply privacy. |
| Sets and bulk add/remove | Retain existing synced/catalog/GitHub/private-release behavior and permissions; do not flatten mixed items into only catalog rows. |
| Favorite/add-to-set from Discover | Enable only where identity and repeat actions can be verified. POST supports catalog items, but current group-item responses omit `catalogSkillId`; do not guess membership from names/URLs or create duplicates. Resolve this contract gap before promising a fully reversible catalog toggle. Keep existing installed-skill controls working. |
| Get / install | Use the existing supported copy-for-agent/source-link flow, checking pinned versus discovery-only metadata. No simulated successful install or new helper rollout. A copied instruction is not an installed skill. |
| Agent picker / remove from all agents | Observed sources may be displayed; remote install/uninstall controls stay omitted until a supported contract exists. |
| Updates / Update all / version diff / Keep updated | Omit unsupported controls and badges. No fabricated version numbers, update counts, or "all up to date" state. Pinned public metadata alone is not update detection. |
| Agent/device status | Display actual observed sources and devices. Last synced does not mean last used, currently online, or remotely controllable. |
| Set visibility/access | Preserve Public / Invite only / Only me. Allowed emails grant access; they do not prove an email was sent. Preserve owner versus reader permissions. |
| README / About | Show existing description/available public metadata and source links. The public API does not provide full README content; do not fetch the entire catalog or fabricate it. |
| Top-rated badge / members / creator totals | Display only values with real supporting fields and correct semantics; otherwise omit. |
| GitHub connection, profile, devices, MCP | Retain current account capabilities and gates; account-menu placement is a UI change only. |
| Signed-out Get | Do not promise sign-in enables unsupported remote installs. Keep public copy/source actions available and require auth for genuine account actions. |

These limits are recommended scope boundaries, not backend tasks approved by this plan. If full prototype functionality is required, revise scope explicitly before implementation.

## Routes And State

Extend existing route helpers; no routing-library migration is needed.

- Preserve `/app/`, `/app/sets`, `/app/groups/:id`, `/app/agents`, and `/app/home`. Old account routes may render within the new shell and remain valid links.
- Add explicit Discover, trending, creator, collection, category, and search destinations under `/app/`.
- Encode selected skill ID and search/filter state safely; support direct refresh, back/forward, and opening links in a new tab.
- Closing detail restores the underlying list and focus. Leaving a view resets incompatible edit selections and menus.
- Preserve `/app/connect`, its fragment-based pairing state, review routes, and the `/` portal base on `app.omgskills.com`.
- Safe internal destinations only after authentication. Signing out clears private data immediately but can retain public browsing state.
- Show real not-found/unavailable states for missing skills and deleted/inaccessible sets.
- Public `/skills/` URLs keep their current content/canonical behavior. No mass redirect into an authenticated or JavaScript-only app.

## Implementation Slices

Slices 0-2 and parts of Slice 3 have been implemented through approved checkpoints.
Use the current UI/UX checklist above to plan the remaining work. Historical
receipts below retain their original scope; live integration acceptance is now
deferred to production, not additional disposable local environments.

### 0. Fresh Baseline And Capability Proof

- [x] Create a clean latest-main worktree; carry only approved reference files.
- [x] Run existing portal tests/build and record baseline failures separately.
- [ ] Production check pending: verify primary/app-subdomain transport, search/detail, manifest assets and canonical links. Local/public-client checks are already recorded; no new local transport harness is required.
- [x] Confirm exact current install handoff and catalog-membership limitations. Escalate only genuinely necessary scope changes.

### 1. Shell And Shared Visual Components

- [x] Build the switch-based shell, rail, mobile navigation, account menu, rows, and responsive detail using existing preview isolation.
- [x] Use deterministic fixtures for signed-out, signed-in, long names, empty states, errors, and mixed skill sources.
- [x] Compare the handoff with the rendered preview and refine list spacing, typography, and detail-panel layout. Completed after live Discover integration; no real account writes in preview.

### 2. Discover With Real Public Data

- [x] Add the bounded public-data adapter and local preview browsing routes. Production entry remains unchanged.
- [x] Connect collections, creators, trending, category/search lists, and skill summaries to existing sources.
- [x] Add canonical public links and retain honest copy/source actions and clipboard feedback, with visible loading/error/missing states.
- [x] Verify no raw skills download, full-catalog fan-out, or private API requests.

### 3. Management In The New Shell

- Local environment recovery (2026-10-05): the former September temporary DB and
  Clerk configuration no longer exist. Added reproducible, GET-only test setup
  under `portal/testing/`; see `portal/testing/LOCAL-ENVIRONMENT.md`. The new
  database is empty, uses the existing nine migrations, and has no production
  connection. The previous development Clerk keys have now been recovered and
  verified against matching browser/server JWKS. Real development browser login
  and manual account refresh now pass against the isolated database (one user,
  zero skills). The first unified read-only account slice is implemented below;
  broader account management and browser account switching remain outstanding.

- [x] First local read-only account slice: reuse Clerk, `usePortalApi`, the account
  session controller, and existing skill grouping at `/app/integration/unified/`.
  Real My Skills, private search, agent filters, details, profile/observed agents,
  refresh, and sign-out are connected. Public Discover remains available signed out.
  This is the isolated test account, not a live production account connection.
- [x] Prevent sample actions/fake account destinations in this slice: hide
  Favorites/Sets, device/source management and mutations until their full flows
  are connected. Block writes in both the client transport and local backend;
  do not infer catalog membership or install status from names.
- [x] Keep private search/IDs out of public catalog requests; no persistent private
  cache in the new entry. Key the account subtree by user/session, dispose pending
  reads on logout/unmount, clear private navigation on logout/anonymous deep links.
- [x] Verification: 174 portal tests and production TypeScript/build pass. Local
  unified entry/fixtures are absent from production JS/CSS even with local flags
  set during the build. Authenticated reads/refresh and desktop (1440px)/mobile
  (390px) grouping, search, filter and detail checks passed with three temporary
  local installs; those records were removed and zero skills verified. Actual
  sign-out, signed-out live Discover, and private-link sanitization passed.
- [x] User confirmed the local unified experience works (2026-10-05). This
  checkpoint covers the read-only test account slice, not production activation
  or the remaining management actions.
- [ ] Production check pending: real second-account switching and populated
  account behavior. Review denied/slow/error UI locally with existing fixtures;
  do not provision another local account/backend for this gate.

#### Local Checkpoint: Favorites And Private Sets (2026-10-06)

- Approved scope: reuse existing handlers and account controller for Favorites,
  private set creation/rename, and single installed-skill membership changes.
  No production entry, data model, profile, sharing, bulk, or device changes.
- Implemented locally: narrow opt-in `backend-write` mode; actual set detail
  reads, ordered mixed-item rows, account-scoped cancellation, save/error states,
  and public-Favorites confirmation. The sample preview remains separate.
- Verification so far: 179 portal tests and TypeScript/production build pass;
  local entry remains absent from production bundles. Actual unauthenticated
  requests return 401, unrelated writes return 405, and out-of-scope publication
  bodies return 400. Isolated SQL owner/outsider/anonymous checks pass with rollback.
- 2026-10-06 fixture repair: replaced the nonexistent `unified-test/design`
  reference on the two recorded test installs with verified frontend-design
  catalog metadata. Future seeds verify the release first. Real catalog/GitHub
  resolution and transactional set-add/release persistence checks pass, including
  duplicate rejection and unchanged private-skill handling. Test writes rolled
  back; 179 portal tests pass again.
- [x] User confirmed the repaired Test design skill adds successfully in the
  signed-in local app on 2026-10-06. This is user-reported browser verification;
  the agent's separate browser session remained signed out.
- [ ] Remaining acceptance: real mutation persistence, Favorites and account
  switching move to the approved production test pass. Mobile and failure-state
  presentation remain local UI review items. Existing local fixtures need no
  further expansion; cleanup is separate from this UI buildout.

- [ ] Complete management parity: existing basic sessions/My Skills/Favorites/Sets
  and filters are connected locally; review missing bulk operations and production wiring.
- [ ] Review and complete remaining set edits, ordering, Hide/Restore and mixed-item
  behavior. Access UI exists; its save error remains open for production verification.
- [ ] Restore all supported profile/device/private-source controls in reachable account destinations.
- [ ] Resolve Discover membership UX using explicit identity and existing contracts;
  document unsupported actions instead of inferring membership or making duplicates.

#### Set Detail And Invite Fidelity (2026-10-06, Local Only)

- [x] Restored the handoff's skill-avatar header, count, anchored three-option
  visibility menu, and grey access bar with a separate green Invite button.
- [x] Moved email entry/removal into a dedicated compact invite dialog. Visibility
  saves reuse the existing controller; making a set public requires confirmation.
- [x] Only-me/public sets require an explicit switch to Invite only before adding
  email access. Saved inactive emails are not shown as active members.
- [x] Real names/email initials replace unavailable member photos. Counts say
  "emails with access", not confirmed members. No invitation email is sent.
- [x] 185 portal tests, TypeScript, production build, diff check, and isolated
  handler/SQL permission checks pass. SQL fixture changes were rolled back.
- [x] Browser checks: desktop 1280px and mobile 390px, anchored menu, cancel public
  confirmation, separate invite dialog, invalid-email validation, and cancel removal.
  No horizontal overflow. Existing set permissions were not changed during this pass.
- Keep updated remains omitted: no working set-subscription control exists in this
  client. Second-account browser sign-in and a fresh UI grant/revoke cycle remain
  untested in this pass (handler/SQL grant/revoke checks passed).
- Local only. No commit, push, deployment, data-model or backend-handler changes.

#### Discover And Set Access Pass (2026-10-06, Local Only)

- [x] Concurrent metadata/feed requests, bounded ten-minute public view snapshots,
  cached navigation while refreshing, and retry without discarding good results.
  Cache remains in memory and resets on full reload. Sample local first-load
  timing improved from 1,478ms to 591ms; immediate cached repeat was 0ms.
- [x] Owner-only visibility and email-access UI using existing handlers/controller.
  Public access has explicit confirmation; email grants are read-only and send no
  invitation email. Favorites stays public. Shared sets remain editable by their
  owner; hidden/non-owned sets, profile, devices, bulk and deletion stay blocked.
- [x] 183 portal tests, TypeScript/production build, production bundle exclusion,
  unsigned HTTP rejection, and real-handler/isolated SQL checks for granted,
  revoked, private/public and non-owner access.
- [x] Signed-in browser: new disposable set, all three visibility modes,
  add/remove synthetic email, reload persistence, desktop/390px dialog, and
  Discover return navigation. Disposable set removed; existing user sets kept.
- [ ] Deferred to production: second-account sign-in and broader account-switch/error journeys.
  Non-owner authorization was checked with real handlers/SQL, not a second login.
  No data model, production entry or backend handler changes. Not committed or deployed.

### 4. UI Review And Code Readiness

- [ ] Complete the screen-by-screen UI/UX checklist and fix agreed implementation gaps.
- [x] Check mobile sheets, keyboard/focus, deep links and loading/error states locally.
  Retain automated tests for auth transitions, stale responses and account isolation.
  Evidence: four-width local acceptance matrix and controller tests recorded above;
  this does not mark signed-in production acceptance complete.
- [ ] Check pairing/review routes, public pages and permission guards in source/tests.
- [ ] Check bundle size and request strategy locally. Confirm real transfer sizes,
  cold/warm timings and host behavior in production rather than chasing local connectivity.
- [ ] Present local UI for approval, plus explicit missing/omitted capabilities and
  production checks. No placeholder control may masquerade as a working action.

### 5. Approved Release

- [x] Obtain approval after local review; commit scoped client/API fixes and approved safeguards from the current main baseline.
- [x] Follow current deployment documentation and guarded current-main workflow; build the combined `dist/netlify-site` artifact, never deploy only `site` or `portal/dist`.
- [x] Verify draft before production, preserving public pages, downloads, appcast, manifests, release assets, and feature gates.
- [x] After production approval, verify both app hosts, public library and signed-out catalog requests. Fix forward on failure; never restore an older whole-site snapshot.
- [x] User confirmed primary-host sign-in/My Skills loading in production.
- [x] User confirmed test-set creation, Invite-only visibility, email grant/revoke,
  reload persistence and read-only recipient access on 2026-10-07.
- [x] User confirmed ordinary Favorites and skill/set changes persist after refresh.
- [ ] Verify remaining bulk/edge-case actions, account isolation/destinations,
  external connections and authenticated legacy/alternate-host routes within
  their approved test scope; see the current acceptance list above.

## Verification

Commands confirmed in current-main package scripts; run from the implementation worktree, not this stale checkout:

```sh
npm --workspace portal test
npm run build:portal
npm run test:portal-grouping
npm run test:public-skill-links
npm run test:mcp-production
npm run test:deploy-safety
```

The full `npm run check`, 210 portal tests and combined build passed for the initial approved release. The authentication fix subsequently passed deployment-safety checks, all 211 portal tests, the combined build and guarded draft/live checks. Core authenticated invitation and persistence workflows are now user-accepted; only the explicitly listed remaining checks are pending.

New focused coverage:

- Route parsing/base paths, selection and back/forward, safe auth returns.
- Catalog response validation, tool errors, rate limits, timeouts, cancellation, and bounded requests.
- Identity matching with duplicate names, multiple skills per repo, ambiguous/local-only records, and multiple agent sources.
- Membership pending/success/failure and partial bulk outcomes; preserve selection for failed work.
- Sign-out/account switch while requests are in flight; no private data in another account or public cache.
- Read-only/public/invited/owner views; protected Favorites behavior and missing catalog identity.
- Production cannot activate preview fixtures or test-only writes.

Browser checks at 390, 759, 760, 1179, 1180, and 1440px, plus narrow 320px overflow testing. Cover sidebar/rail, panel/sheet transition, open menus, long content, and keyboard focus. Confirm primary lists do not reload or jump unexpectedly when detail opens.

Use the existing local preview for UI states and normal code tests for logic.
Do not create or expand disposable local servers/databases to prove connectivity.
Real connection and write acceptance now runs after approved production deployment,
with a named test account/set and agreed recipients/actions. Preview success is not
proof of integration. Never test destructive actions on the user's real skills.

## Main Risks And Decisions Still Needed

1. **Prototype capabilities exceed current APIs.** Keep the UI truthful; adding remote installs/updates is separate work.
2. **Catalog/Favorites edge cases need focused acceptance.** The matching backend is deployed and ordinary Favorites persistence is user-accepted. First-ever catalog Favorites, concurrent saves and mixed installed/catalog representations are not specifically confirmed.
3. **Public app-subdomain transport is verified signed out.** Both hosts loaded live Discover after deployment; authenticated host/account transitions still need acceptance.
4. **Bounded APIs are not a complete catalog export.** Use existing curated discovery and honest search limits, not fake pagination or counts.
5. **Public versus private visibility can be confused in the new layout.** Preserve permissions and clear visibility indicators, especially public Favorites.

Next step: finish the focused remaining acceptance checks listed at the top,
starting with account isolation and mobile/deep-link behavior. No push, deployment,
new backend feature, or account mutation is approved by this doc update.

## Local Preview Receipt - 2026-10-05

- Working directory: `/private/tmp/omgskills-unified-app-preview`
- Branch: `codex/unified-app-preview`, based on `61f9f13f`.
- URL: http://127.0.0.1:5190/app/preview/unified/
- Discover directly: http://127.0.0.1:5190/app/preview/unified/?view=discover
- Persistent sample-data marker; top controls select signed-in/out and populated, empty, loading, error, long-content, or connected-source scenarios.
- Local-only bootstrap uses the existing development + explicit opt-in + loopback + preview-path gate. Existing preview and production entry points are retained.
- New shell supports the mode switch, collapsed rail, discovery lists, search, account destinations, mobile tabs, desktop/floating/mobile detail, light/dark appearance, and browser history.
- Sample favorites, create set, bulk membership and visibility changes are memory-only. Account settings are sample summaries, not newly integrated production editors. Unsupported install/update actions are not simulated.
- The prototype runtime is not imported; only supplied avatar assets are used in preview fixtures.
- This local-preview checkpoint is approved for a scoped commit on `codex/unified-app-preview`. No push, deployment, schema/API changes, account writes, feature activation, or Mac release changes.

### Checks Passed

- Baseline: 135 portal tests and production build.
- After changes: 142 portal tests, TypeScript and production build using Node 20.20.0.
- Production build also tested with the preview environment flag set: new preview sample strings, component markers, and fixture assets are excluded. A dummy publishable test key was used for build coverage, not authentication.
- Browser screenshots and overflow checks at 320, 390, 759, 760, 1179, 1180 and 1440px; additional long-content and dark-mode checks.
- Sample favorites, create set, bulk membership, shared-set read-only visibility, mixed-source set items, search, rail collapse, back navigation, deep-link refresh, Escape and focus return, error recovery and signed-out browsing.
- Browser request log showed no account/catalog API calls from the local fixture preview.
- Screenshots: `output/playwright/` in the worktree. The local server lacks a favicon (404); it does not affect app rendering. A development hot-reload duplicate-root warning was traced to entry-module re-evaluation and corrected by retaining the React root in Vite's hot data.

### Data Access Result And Remaining Gate

- From a signed-out browser at `https://omgskills.com/app/`: bounded public search returned 200 and one result; manifest and manifest-discovered collections returned 200; 92 collections were present.
- Canonical URL mapping returned 200 and measured 89,552 bytes. No raw skills asset was requested.
- `POST https://app.omgskills.com/mcp` returned 404. Cross-origin preflight to the primary-domain MCP endpoint returned 405 without an allow-origin header.
- Therefore the primary-domain path is viable, but the app subdomain needs a separately approved routing/CORS solution. No routing changes were made.
- Local real-data proxy and production integration remain deferred. Slice 0's all-host transport check is intentionally incomplete, not treated as passed.
- Authenticated production behavior and real account mutations have not been re-tested for this preview; those belong to later integration slices.

## Public Routing Checkpoint - 2026-10-05

- User approved the routing fix only. No account, database, MCP contract, or CORS changes.
- Added public exceptions for `/mcp`, `/mcp/health`, `/data/crawl4/*`, and `/catalog-skill-urls.json` before the app-subdomain fallback. They forward to the existing canonical primary-domain endpoints. Existing assets, deep links, and other route behavior stay unchanged.
- Added opt-in local Vite proxy: `PORTAL_PUBLIC_CATALOG_PROXY=1`. Public files/health permit GET/HEAD; MCP permits POST to existing read-only tools. Local forwarding strips cookies and authorization and uses timeouts without following redirects.
- No generic API proxy, private account endpoint, or protected health route was added. The crawl4 route exposes already-public files, but no raw skills download was requested or added to the client.
- Tests: 4 redirect tests and 4 proxy tests pass; all 146 portal tests pass; portal TypeScript/production build and the deployment-safety suite pass. Routing tests are included in `npm run check`.
- Browser verification at `http://127.0.0.1:5190/app/preview/unified/`: manifest, manifest-discovered collections, canonical skill links, one-result public search, and MCP health all returned HTTP 200 JSON. POST to the manifest was rejected with 405.
- Local preview remains sample-driven. Enabling transport does not integrate Discover, authenticate an account, or perform any account writes.
- Netlify's actual deployed proxy behavior remains unverified until a separately approved deploy. The tests validate generated routing order, not a live production fix.

## Live Discover Checkpoint - 2026-10-05

- User approved connecting Discover to existing public data in the local preview. No schema changes, private API integration, real account writes, commit, push, or deploy.
- Preview: http://127.0.0.1:5190/app/preview/unified/?view=discover
- Live catalog is the default; a selector retains deterministic sample catalog scenarios. The banner explicitly distinguishes live Discover from the sample account. Public rows never inherit installation/favorite state from sample skills.
- The client resolves the collections filename through the crawl4 manifest, with the public library's existing v2 fallback. The local proxy and proposed subdomain exceptions now include `/data/v2/*` for that fallback. No raw skills or author-leaderboard asset is used.
- Published topic collections supply collection views; published author entries supply creator metadata. The overview shows the first three published topic collections, nine trending skills, and nine creators, with full collection/creator lists reachable from navigation. Categories were initially derived from collections; the correction below replaces that behavior.
- Trending uses the existing ranking and is labeled "Trending skills", not an invented weekly-growth measure. Search and creator/trending lists are capped at 30, with visible limit notices. Collection lookup preserves published order and fetches at most 30 entries, four at a time; missing entries are reported.
- Search debounces 250ms. Public responses are validated, cancellable, deduplicated, and bounded to 2 MB per response, 60 cached responses, and two-minute cache freshness. Timeouts, rate limits, malformed responses, missing skills, and unavailable collections have visible error states.
- Skill details use exact IDs. Canonical public skill links load on demand from the existing URL mapping. Source/open/copy actions remain separate from installation. No remote install, update, favorite, or account mutation is implied.
- Verification: all 162 portal tests pass, including 16 new catalog tests; 4 redirect tests and 4 proxy tests pass. TypeScript and production build pass with preview enabled; new preview/catalog markers remain absent from production bundles.
- Browser checks passed: real overview, all eight Starter Skills, 30-row creator/search results, category navigation, deep-link refresh, back navigation, Escape/focus return, signed-out browsing, rate-limit retry, empty results, missing skills, and stale-search cancellation.
- Responsive checks at 320, 390, 759, 760, 1179, 1180, and 1440px found no page/detail horizontal overflow. Fresh mobile detail load confirmed one app root, one preview bar, and one dialog. Desktop/mobile screenshots are in `output/playwright/`.
- Initial overview JSON: 1,080-byte manifest + 92,902-byte collections + 23,408-byte trending response = 117,390 bytes, across three reads (decoded body sizes, excluding JS/images; local cached timings are not a production speed benchmark).
- Browser request inspection found no raw catalog fetch or private API calls. The browser-only fetch binding issue found during testing was corrected and regression-tested.
- Remaining gates: user visual review, actual Netlify subdomain routing verification after an approved deploy, and separately approved real-account integration.

## Category Correction - 2026-10-05

- Shared `discovery-categories.ts` uses the Mac Discover terms in four groups of six. Both live and sample catalogs use it; icons follow the handoff's Lucide references. The latest approved layout uses three columns by two rows on desktop, retaining two columns in narrow/mobile layouts.
- Each term opens Search results with that exact query. Sidebar group links show the group's six shortcuts. Collections retain their separate entry-list behavior; no server data model changed.
- Verified: 165 portal tests and production build pass; all 24 browser clicks produce the correct search request and query URL; a live PDF search returns HTTP 200 and 30 rows. Desktop/mobile layouts checked locally. Not committed or deployed.

## UI Refinement And Commit Checkpoint - 2026-10-05

- Restored the handoff's font stacks and compact typography. Lowered the font reset's specificity so button styles apply correctly. Compact discovery rows are 52px; list actions are 26px tall with 11px bold labels. Full lists include inline creator names and correctly aligned dividers.
- Restored grouped collection copy, tighter creator spacing, and the side-by-side avatar/title detail header with consistent 16px section spacing. About links are separated and empty related-skill headings are hidden. No unsupported install/update controls were added.
- Browser checks covered desktop/mobile details, long names, signed-out browsing, live catalog results, and Escape. No horizontal overflow at 320, 390, 759, 760, 1179, 1180, or 1440px. Category grid verified at three columns/two rows on desktop and two columns on mobile.
- This checkpoint includes the previously approved public routing/proxy and bounded catalog client, their regression tests, UI refinements, categories, and documentation. It does not enable the new UI in production, connect real accounts, change server data models, push to GitHub, or deploy.
- Pre-commit verification rerun: 165 portal tests (including proxy and catalog tests), four redirect tests, deployment-safety/workflow-lock tests, TypeScript, and production build passed. No unified-preview markers in the eight production JS/CSS bundles with the preview flag enabled. `git diff --check` passed. Screenshots and local build output remain untracked/ignored artifacts, not release files.
