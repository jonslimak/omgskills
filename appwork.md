# Unified Web App Plan

Status: UI checkpoint committed as `1140d68b` on `codex/unified-app-preview`. The catalog/Favorites API follow-up is implemented and reviewed as a separately approved local commit checkpoint; see below. Production acceptance remains pending. Invite saving has a user-reported failure and is not confirmed working. The new production entry remains disabled by default; neither change is deployed.
Updated: 2026-10-06. Original source baseline: `origin/main` at `61f9f13f`; recheck current main before release.

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
  account switching, and external-service flows. These are pending acceptance
  checks, not blockers to continuing visual work and not marked as passed.
- **No schema/API/permission redesign.** Reuse existing supported contracts.
  If the mock needs a capability the backend does not provide, record the gap and
  get a scope decision instead of simulating success or silently dropping it.
- **Release remains a separate gate.** Follow `deploy.md`, review the UI first,
  and retain rollback. Having no users reduces rollout impact but does not remove
  permission/data exposure risks. Production access changes and destructive tests
  need an agreed test account/set/recipient scope; do not use personal skills.
- The later user approval covers committing the current implementation and docs
  on this branch. It does not approve push, deploy, new email delivery, changes to
  production access, or additional local connectivity experiments.

### Known Invite Issue And Deferred Checks

- User reports `Could not confirm the save. Refresh before trying again.` when
  adding email access in the local app. Root cause is not established. An isolated
  client-to-handler test passed, but that does not clear the browser failure.
- `Read-only access. No invitation email is sent.` is explanatory copy, not the
  error. Email delivery is not implemented or part of the current UI migration.
- Earlier passing receipts are historical evidence, not acceptance of this
  failing flow. Track email-access grant, revoke, persistence and recipient access
  as **production verification pending**; investigate the failure there if it recurs.
- Local diagnostic set `Invite diagnostic (temporary)` remains empty and private
  (ID `23547cdb-2b16-4878-aa4d-d6a324de0499`). Permission testing stopped. Do not
  resume that experiment or remove existing local data without approval.

### UI/UX Completion Checklist

Every unchecked row needs a source/behavior comparison, a local visual review,
and either a fix or an explicit agreed omission. A local connection failure alone
does not establish a missing UI feature. This checklist is a review to perform,
not a claim that every listed feature is broken.

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
  feedback and a usable path for recipients to open the set. Live access pending.
- [ ] Account destinations: profile, agents/sources, devices, private GitHub and
  MCP; reachable existing controls with no dead buttons or sample-only settings.
- [ ] Responsive/accessibility: desktop/mobile, light/dark, long names/emails,
  focus/keyboard/Escape, touch targets, scroll/overflow and modal recovery.
- [ ] Production entry/routes: connect the completed shell to the real session
  and supported mutations; preserve old app links, pairing/review and public pages.
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
- [ ] Check mobile sheets, keyboard/focus, deep links and loading/error states locally.
  Retain automated tests for auth transitions, stale responses and account isolation.
- [ ] Check pairing/review routes, public pages and permission guards in source/tests.
- [ ] Check bundle size and request strategy locally. Confirm real transfer sizes,
  cold/warm timings and host behavior in production rather than chasing local connectivity.
- [ ] Present local UI for approval, plus explicit missing/omitted capabilities and
  production checks. No placeholder control may masquerade as a working action.

### 5. Approved Release

- [ ] Obtain approval after local review; commit only scoped client changes from the correct main baseline.
- [ ] Follow current deployment documentation and guarded current-main workflow; build the combined `dist/netlify-site` artifact, never deploy only `site` or `portal/dist`.
- [ ] Verify draft before production, preserving public pages, downloads, appcast, manifests, release assets, and feature gates.
- [ ] After separate production approval, verify both app hosts, public library, auth/account workflows, and catalog requests. Retain prior deployment for rollback.
- [ ] On an agreed production test set/account, verify visibility, email grant and
  revoke, reload persistence and recipient access. Diagnose the reported save error
  if it persists; do not declare invites complete from unit tests or visuals alone.
- [ ] Verify production Favorites/set edits, bulk actions, account destinations,
  external connections and legacy app routes within their approved test scope.

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

Before approved release, run the full `npm run check` and combined build under the deployment guide's environment requirements. Local preview verification is recorded below; full release checks are not yet run.

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
2. **Catalog/Favorites changes need production acceptance.** Owner-only catalog identity, locked duplicate prevention and atomic first-time catalog Favorites are implemented locally. Older responses still trigger the safe missing-ID guard until the matching backend is deployed.
3. **Public transport on the app subdomain is unproven live.** The client/proxy exists; confirm host routing in the production acceptance pass without blocking UI work on new local infrastructure.
4. **Bounded APIs are not a complete catalog export.** Use existing curated discovery and honest search limits, not fake pagination or counts.
5. **Public versus private visibility can be confused in the new layout.** Preserve permissions and clear visibility indicators, especially public Favorites.

Next step: user review of the UI and the approved catalog/Favorites follow-up.
Production deployment and real connectivity checks require separate approval.
No push or deployment is approved by this doc update.

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
