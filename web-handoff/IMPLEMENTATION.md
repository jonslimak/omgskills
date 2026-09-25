# Web App Redesign Implementation Plan

Status: A-E complete locally; E reviewed for this commit. User-reported two-account shared-access check passed. Redesign remains off by default; no push or production activation. Remaining release checks are tracked in LOCAL-INTEGRATION.md. Updated 2026-09-25.

Local preview: http://127.0.0.1:5173/app/preview/

Normal-route local review: http://127.0.0.1:5174/app/ (same isolated backend as `/app/integration/`).

Worktree: `/private/tmp/omgskills-web-portal-redesign`, branch `codex/web-portal-redesign`, based on `827f31ce`. See `LOCAL-PREVIEW.md` for verification and restart instructions. Local commit only; no push or deployment.

## Goal And Boundaries

Rebuild the portal UI around the handoff so we can review and iterate locally, then connect the approved screens to existing functionality.

- Visual reference: `README.md` and `omgskills App (standalone).html` in this folder.
- Behavior/contract reference: `MAPPING.md`, audited against `origin/main` at `827f31ce`.
- First deliverable: all five screens working together with clearly labeled, memory-only sample data. No Clerk setup or real account is needed for design review.
- Later deliverables: the same components connected to real APIs, preserving existing functionality and permissions.
- No production deployment, database migration, crawler/data change, Mac change, feature activation, appcast change, or public release is included.

## 1. Safe Starting Point

- [x] Recheck latest main and the portal changes since the audit before implementation.
- [x] Create an isolated worktree from latest `origin/main`, on `codex/web-portal-redesign`.
- [x] Copy the handoff and these planning documents into that worktree. The current handoff is untracked; do not assume Git will carry it across.
- [x] Leave the current pinned-installer branch, deleted `backfill.md`, and all unrelated local files untouched.
- [x] Run the existing portal build and relevant tests to establish a baseline. Record pre-existing failures separately.

Do not cherry-pick unrelated client work. Review and commit UI slices separately; pushing and deploying remain separate approvals.

## 2. Implementation Shape

Use the existing React, Tailwind, Radix/shadcn, Lucide, and Geist stack. Do not import the prototype's generated runtime or replace the application framework.

Suggested boundaries, adjusted to existing conventions during implementation:

| Area | Responsibility |
| --- | --- |
| `portal/src/app/` | Shell, route parsing/navigation, sidebar, mobile drawer, page header. |
| `portal/src/pages/` | Skills, Agents, Sets, Set detail, Home composition. |
| `portal/src/components/` | Reusable skill rows, source badges, set membership popover, selection bar, state views. |
| Existing `groups/` and `private-sources/` | Keep domain types, API helpers, authorization-aware behavior, and reusable existing controls. |
| `portal/src/preview/` | Local bootstrap, deterministic fixtures, in-memory actions, scenario controls. |
| Scoped redesign stylesheet | Tokens and layouts without globally restyling the existing portal, sign-in, or pairing page. |

Pages receive typed data and action callbacks. Preview and authenticated controllers feed those same components; do not build two separate UIs or a generic data-provider framework.

Keep skill/group/device IDs as identities. Never identify records by display names. Reuse `groupSyncedSkills` unchanged.

### Local Preview Isolation

- Explicit opt-in local environment flag plus Vite development mode and a loopback hostname are all required.
- Load the preview before Clerk initialization or the publishable-key requirement. The preview must not instantiate the real API controller.
- Use a development-only dynamic import, with its branch eliminated from production builds.
- Preview actions mutate memory only. No API mutations, real tokens, account storage, OAuth, pairing callbacks, or external app launches.
- Display a small persistent `Local preview - sample data` marker. Reset restores the initial fixtures; refresh can reset them too.
- Do not implement a mock network server when a small in-memory controller is sufficient.
- Start the preview bound to `127.0.0.1` on an unused port. Provide the actual URL, for example `http://127.0.0.1:5173/app/preview/`.
- Production must neither activate fixtures through a URL/flag nor include the fixture module in its built assets.

### Navigation

Use a small explicit route parser/navigation helper, not a new routing framework for these five destinations. Handle browser back/forward and preserve ordinary links, including opening in a new tab.

| Screen | Authenticated route | Preview route |
| --- | --- | --- |
| Skills | `/app/` | `/app/preview/` |
| Agents | `/app/agents` | `/app/preview/agents` |
| Sets | `/app/sets` | `/app/preview/sets` |
| Set detail | `/app/groups/:id` | `/app/preview/groups/:id` |
| Home/profile | `/app/home` | `/app/preview/home` |

Preserve `/app/groups/:id` bookmarks. Keep `/app/connect` and its fragment-based pairing state outside this navigation flow. Only allow safe internal return destinations after sign-in. Unknown paths receive a useful not-found state rather than silently displaying the wrong page.

Initially only the preview uses the new shell; the existing authenticated UI remains intact until the integration slices are verified. Do not add production rollout flags just for local design iteration.

## 3. UI Contract

Match the handoff's spacing, typography, neutral colors, blue accents, compact controls, and table hierarchy. Start with the supplied light appearance; dark-mode design is a separate follow-up, not an improvised palette.

- Desktop sidebar: 168px; header: 48px; page padding: 20px.
- Below 720px: mobile drawer and 12px page padding. No fixed desktop table width causing page overflow.
- All five screens share one 960px outer width (920px content on desktop), aligned headers, and equal 20px horizontal gutters (12px on mobile). This supersedes the handoff's page-specific widths following local design review.
- Reuse bundled Geist; include Geist Mono locally where the reference calls for it, without CDN font dependencies.
- Scope tokens to the new shell and its portaled dialogs/popovers. Avoid changing global button or dialog styling used by pairing and legacy screens.
- Use accessible primitives for menus, dialogs, selection, focus trapping, Escape, and focus return. Icon-only actions need names and tooltips.
- Preserve readable full skill descriptions through expansion/detail rather than relying on hover-only truncation.
- Row layouts reserve space for actions and long labels. Pending states must not shift controls.

### Deliberate Differences From The Prototype

These are required for truthful behavior, not new feature work:

1. Sets retain Public, Invite only, and Only me; hidden status is separate.
2. Favorites remains public and protected from rename/delete/visibility changes.
3. Last used is unavailable, not inferred from Last synced. Recent activity is disabled with an explanation.
4. Agents are observed skill sources. Device connections are a separate section, without invented hosts or online indicators.
5. Add agent and self-service Connect GitHub are unavailable placeholders until those services exist. No fake terminal command or success toast.
6. Adding an email grants read access to an Invite-only set; it does not send an invitation or grant edit access.
7. Existing editing, ordering, Hide/Restore, source management, and gated install/connect actions remain reachable.

## 4. Slice A: Complete Local Design Preview

This is the first implementation and visual-review checkpoint. No backend changes.

- [x] Build the shared shell, responsive navigation, typography, tokens, and reusable controls.
- [x] Skills: table/mobile rows, search, source filter, edit/selection, bulk bar, star, membership popover, create-set dialog.
- [x] Agents: observed sources, source-filter links, separate devices, revoke confirmation, unavailable Add agent state.
- [x] Sets: owned/shared lists, protected Favorites, visibility labels, create/delete dialogs and empty states.
- [x] Set detail: owner/shared variants, name/description, ordered skills, membership/access controls, visibility, link actions, overflow actions.
- [x] Home: identity/handle, publication controls, account-control placement, private-source disconnected and connected layouts.
- [x] Supply populated, empty, loading, recoverable-error, long-content, and shared-read-only scenarios through dev-only preview controls.
- [x] Make supported demo operations coherent across screens: creating a set updates its list, adding a skill updates membership/counts, deleting removes it. Label these as sample-data interactions.
- [x] Model public/restricted/private/hidden sets and mixed item types in fixtures. Include a grouped row whose membership uses a non-representative physical ID.

Fixtures should reflect the real data model. Future unsupported fields stay unavailable by default; do not make the reference's invented statuses look like implemented product behavior.

**Exit:** all five screens are navigable locally, core dialogs/actions can be inspected, responsive screenshots pass, and preview isolation is verified. Pause here for the user's design review before real-account integration.

## 5. Slice B: Real Reads And Account Behavior

After design review, attach authenticated controllers to the same views.

### B1: Read-Only Checkpoint

- [x] Separate development-only `/app/integration/` entry with Clerk sign-in; sample preview and production entry remain separate.
- [x] Load skills, owned/shared set summaries, and profile through existing APIs. Use returned set counts without fetching every detail or inventing item records.
- [x] Keep grouping/search/filter contracts; shared summaries never receive owner membership IDs or email lists from the adapter.
- [x] Connect lazy real detail reads to the redesigned set layout, with loading/error/retry, response validation and stale-read cancellation. Disable mutation/install controls; show unloaded devices/private sources as unavailable, not disconnected. Desktop/mobile and direct reload verified; C1 subsequently added owner-only physical IDs.
- [x] Cancel pending reads on unmount/account switch and ignore late responses. Account cache and focus-refresh belong to B2.
- [x] Require an explicitly verified loopback backend and a development Clerk key before enabling sign-in. Client and local proxy allow only required GET endpoints.
- [x] Automated checks and blocked-entry browser verification pass. Production excludes both local entries even with their opt-in flags set.
- [x] Verify development Clerk and the backend's resolved local database; test sign-in, empty/populated reads, owned detail, search/filtering, reload and mobile navigation using an approved account-scoped snapshot. No production backend: even GET requests reconcile user records.
- [x] Shared detail and real two-account access checks passed at E (user-reported). B2 covers sign-out; account-switch races/cache isolation have automated coverage. Investigate the initial load error only if reproducible.

See `LOCAL-INTEGRATION.md` for setup and remaining checks. B1 is not end-to-end verified yet.

### B2: Account Lifecycle And Profile Changes

- [x] Preserve Clerk sign-in, account management, session-scoped sign-out, and handle onboarding.
- [x] Retain account-scoped cache, refresh on focus/visibility, request deduplication, manual refresh, and stale-response protection on account changes.
- [x] Keep loading, stale-but-usable, empty, permission-denied, and error states distinct. Failed refresh must not erase usable data; 401/403 clear private state.
- [x] Wire Home handle/publication changes with server validation and accurate public-profile wording. Use the API's returned profile URL; preserve publication during handle edits and serialize saves against refresh.
- [x] Clear selection and account-specific state on sign-out/account change; prune deleted selections after refresh.
- [x] Verify local handle onboarding/normalization, reserved-handle errors, publication on/off, reload persistence, account settings, sign-out/sign-in, and mobile editing. Only profile PATCH is enabled; sets/devices remain blocked.
- [ ] Complete the real second-account/shared-access browser checkpoint before treating Slice B as fully verified. Automated cache-isolation and stale-response checks pass.

**Exit:** real reads and profile changes work without changed identity/grouping behavior, cross-account data leakage, or regressions to existing authentication and refresh behavior. Use an isolated test account/environment for mutation verification.

## 6. Slice C: Set Actions And Membership

### Small Additive API Change

- [x] C1: Add nullable `syncedSkillId` to owner-authorized item/detail responses and the client type. Omit it for shared/public readers; older responses still decode. No schema migration.
- [x] C1: Keep shared/public responses from exposing owner-only identity mappings or allowed-email lists. Both item endpoints use the same response mapper and no-store headers.
- [x] C1: Retain allowed-email record IDs in owner summaries/details/cache. Fix DELETE to require `emailId`, not an email address; POST still validates/normalizes email.
- [x] C3: Read authorized membership item IDs once per operation; keep mappings operation-local rather than persist another cache. Reconcile summaries/detail after changes.
- [x] C3: Do not match item IDs using names, ordering, or guessed URLs.

C1 verification: 52 portal tests and 21 backend access/endpoint tests pass; root typecheck and portal production build pass. Real SQL checked owner/invited/public reads, email-ID deletion and revoked access in the isolated database, with all fixture writes rolled back. Set mutation routes remain blocked in the local proxy/harness. No push or deployment.

### C2: Basic Set Editing

- [x] Create empty Only-me sets; navigate only after confirmed creation.
- [x] Owner name/description and three-state visibility edits, Hide/Restore independent of visibility, and confirmed deletion with return to Sets.
- [x] Keep Favorites name/visibility/deletion protected; description remains editable. No item, ordering, email, device or pairing mutations enabled.
- [x] Separate basic-set capability from read-only membership. Detail permissions come from an authorized detail read, not just cached summaries.
- [x] Await saves, retain failed drafts, block duplicate/conflicting writes, ignore late account/route completions, and refresh summaries/detail after success. Confirmed save plus failed refresh is distinct from an uncertain save; neither automatically retries a mutation.
- [x] Extend only the local route/body allowlist. Creation is private and empty; no implicit Favorites or selected-skill publication.

C2 verification: 61 portal tests, 19 backend access/behavior/endpoint tests, root typecheck and production build pass. Browser checks passed for create, rename/description, all visibility states, Hide/Restore, duplicate-slug draft retention, delete, reload, and 390px layout. Disposable set deleted; original set unchanged. Local integration remains excluded from production bundles. No push or deployment.

### C3: Membership And Bulk Actions

Implemented locally using existing APIs: membership toggles, Favorites, sequential bulk adds, transactional selected-skill set creation, exact item removal and complete-list reorder. Account-wide write serialization also covers C2/profile changes. Unknown outcomes stop remaining writes and require refresh; no automatic mutation retry. Account disposal aborts work; route changes close dialogs and suppress late UI completion. A submitted write may finish and is reconciled, not assumed undone.

Verification: 76 portal tests, 26 backend access/behavior/endpoint/publication tests, root typecheck and production build pass. Browser checks on disposable local skills covered a grouped Claude/Codex pair, selected creation, add/remove/reorder, checked membership, star/unstar with public disclosure, duplicate-safe bulk add, reload persistence and a 390px dialog. Original set/skills fingerprint unchanged after cleanup. Partial failures, unknown outcomes and account races have automated coverage; Favorites first creation/race and resolved-skill publication were tested with controlled API/dependency fixtures, not live GitHub publication. Real two-account/shared-access browser checks remain open. No push or deployment.

### C4: Email Access And Sharing Links

Implemented locally: owners add normalized emails to active Invite-only sets and remove saved emails by record ID with confirmation. Shared viewers never receive email controls or lists. Public/Only-me/hidden states distinguish saved emails from active access; the UI explicitly says read-only access and no invitation email is sent. Reuses the account-wide save lock, cancellation and refresh/error handling; no automatic mutation retry.

Copy link awaits a successful clipboard write. Local links always use the local authenticated detail route. The reusable link helper selects canonical `/u/{handle}/sets/{slug}` only for eligible owned, visible public sets with a published profile; otherwise it uses an authenticated detail link. No Mac deep links.

Verification: 89 portal tests, 34 backend access/behavior/endpoint/public-route tests, root typecheck and production builds pass. Local entries remain excluded with their flags enabled. Browser checks covered normalization, duplicate draft retention, visibility transitions, removal confirmation/cancellation, reload, actual clipboard contents and a 390px layout. Real isolated SQL verified read-only access, denial while Only me and denial after removal. Disposable set removed; original set/skills fingerprint unchanged. A real second-account browser session and deployed public-page navigation remain unverified. No push or deployment.

### Interaction Rules

- [x] Star toggles public Favorites. Disclose visibility before the first add; retain protected-set rules.
- [x] A logical skill is a member when any `allSkillIds` match. Removal removes every matching membership, never unrelated set items.
- [x] Add one representative synced ID per logical row, unless an existing member already satisfies membership. Server responses remain authoritative.
- [x] Unknown membership is explicitly unavailable, not treated as confirmed absence. Disable conflicting actions while a mutation is pending.
- [x] Bulk actions run sequentially, report per-item outcomes, and retain failed selections for retry. Reconcile duplicate/already-present responses rather than claiming new additions.
- [x] New-set creation passes selected IDs through the existing supported API parameter and refreshes returned state.
- [x] C2: Preserve rename, description, delete confirmation, and Hide/Restore.
- [x] C3: Wire reorder/item removal while preserving source links and every set item kind.
- [x] Owner-only controls remain absent for shared viewers; server checks remain the security boundary. Automated/SQL checks pass; real second-account browser verification remains open.
- [x] Keep allowed-email access wording accurate and preserve restricted/private distinctions.
- [x] For an owned visible public set with a published profile and known handle/slug, use the canonical web URL. Otherwise use the authenticated detail link with access-appropriate wording. Local integration always uses localhost. No server `shareUrl` needed.
- [x] Show clipboard success only after an actual successful write. Never derive a web link from a disabled Mac deep link.

**Exit:** toggles persist correctly across refresh; non-representative membership and partial failures are tested; no behavior depends on a name match or fake successful response.

## 7. Slice D: Devices, Private Sources, And Gates

### D1: Connected Devices

- [x] Agents uses actual source labels and counts; links return to Skills with the relevant filter.
- [x] Devices uses actual names, active/revoked/expired/inactive statuses, connection/expiry dates and Last active (Never when absent), not live presence.
- [x] Lazy, memory-only device reads and confirmed revocation use existing APIs. Device read failures preserve the last loaded list without blocking skills; access denial clears account state/cache. Reads/revocation serialize; unmount/account changes abort and ignore late completion. Confirmed revoke survives refresh failure; uncertain outcomes require refresh, never automatic retry.

D1 verification: 98 portal tests, eight backend device-auth tests, root typecheck and normal/flag-enabled production builds pass. Local entries remain excluded. Desktop/390px browser checks cover all four statuses, empty state, cancel/confirm, a second confirmation and reload persistence. Isolated SQL verifies only the intended fixture was revoked and another owner cannot revoke it. All four disposable device records removed; no installed app or production connection touched. Local device GET/DELETE require authentication; pairing and private-source routes remain blocked. Two-account browser coverage remains open.

### D2: Connection Controls

- [x] Connect app opens connection-code/legacy-token tabs using the existing endpoints. Generation is explicit; only empty POST bodies are allowed locally. No scopes, browser callbacks, exchange or upload enabled.
- [x] Credentials remain memory-only, masked and cleared on close/navigation/account change/tab change/expiry. Duplicate generation is blocked; late request/clipboard completions are ignored. Copy success follows the clipboard write. Closing does not revoke an already-issued code; the local-only warning excludes use in the installed app.

D2 verification: 108 portal tests, root typecheck and normal/flag-enabled production builds pass; local modules remain excluded. User reported generation in both tabs and close/reopen clearing green. SQL confirmed one unused code and one unused legacy token, hashed with ten-minute expiry; both identified test rows removed, zero devices created. Local API/proxy reject unsigned generation (401), nonempty generation bodies and exchange/upload/private-source requests (405). Expiry, rate limits, cancellation/account races and clipboard failure are automated tests, not live browser fault injection. D4 subsequently completed fixture-based desktop/mobile visual checks. No Mac pairing, push or deployment.

### D3: Private Sources

- [x] Home loads private sources independently, with account/repository/root selection, source registration and private snapshot creation through existing APIs. Disconnected, empty, unavailable and pending states stay distinct. Forms retain drafts; writes serialize and uncertain results require refresh. Confirmed registration survives a failed follow-up read. Account/page disposal aborts requests and ignores late results; authorization loss clears account data.
- [x] Local GitHub substitute uses real isolated SQL, no Broker credentials/network fallback. Only source GET/POST and bodyless source UUID/release POST are enabled; package downloads stay blocked. Returned snapshot confirmation is memory-only, not release history. Repeated identical content reuses its release.
- [x] Unsupported agent and self-service GitHub setup actions remain non-operative. Real Broker/private-repository testing requires separate approval, not just database isolation.

D3 verification: 119 portal tests, 35 backend private-source/release/Broker tests, root typecheck and normal/flag-enabled production builds pass. Local code remains absent from production bundles. Isolated SQL/handler checks cover ownership, permitted repositories, invalid paths, registration/snapshot deduplication and revoked/rate-limited grants; automated test writes rolled back. Component browser checks cover register/snapshot, empty/disconnected/error states and 1440/390/320px layouts using fixture responses. User then completed the signed-in local flow; read-only SQL confirmed the simulated repository at root `.` and one saved snapshot. Those user-created test records remain. Real GitHub is unverified; no push/deploy/Mac change.

### D4: Safety And Regression Checks

- [x] Verify all four web/Mac gate combinations and production install-button wiring; local routes cannot capture `/app/connect` or enable themselves in a production build. No flag values changed.
- [x] Recheck connect fragment parsing, existing set-route boundaries and link eligibility with automated tests; no app callback or deployed route exercised.
- [x] Repeat five-screen desktop/mobile review, D2 dialogs, navigation/reload, shared/denied detail and cancelled reads using isolated browser fixtures.
- [x] Repeat owner/invited/outsider/anonymous policy checks in isolated SQL, including hidden/private sets and access removal; roll back all fixture writes.

D4 verification: 125 portal tests, 53 targeted backend tests, root typecheck and normal/flag-enabled production builds pass. Fixture browser checks pass at 1440/1024/390/320px, including dialog containment, masking/clearing, keyboard focus/Escape and no external/API traffic. No application behavior changes were needed. Real second-account Clerk switching, deployed public pages, real GitHub and Mac callbacks remain unverified. Reproduction commands are in LOCAL-INTEGRATION.md.

**Exit:** all supported old capabilities remain reachable, placeholders do not claim unimplemented behavior, and no feature flag or protocol was changed unintentionally.

## 8. Slice E: Normal App Integration

- [x] E1: Extract `account/PortalSession.tsx`; local and normal entries share account loading, edits, refresh, cancellation and session-scoped sign-out. Keep local configuration checks in the local entry. Isolate integration, local normal-route and production caches.
- [x] E2: Add `VITE_PORTAL_REDESIGN_ENABLED=1`, default off. Enabled normal `/app/` routes and root-relative app-host routes use the redesign; `/app/connect` and `/connect` retain the existing pairing entry. Web-off remains unavailable. Preserve direct detail links, sign-in/signup return URLs and navigation.
- [x] E3: Context-aware save messages, connection/private-source warnings and sharing links. Error/access-denied recovery remains visible without the local banner. Existing private-source APIs are reused; no simulated Broker is imported into the production application.
- [x] E4: Retain server-provided `appDeepLink` on authorized detail reads and validate the existing group protocol before rendering Install. Require the independent Mac gate; all local modes prohibit Install. No auth protocol, backend permission or production flag changes.

Verification: 131 portal tests, root typecheck and four production build combinations pass. Builds use a non-secret placeholder publishable key so authenticated code is actually compiled; fixture/local entry modules remain excluded. The shared account controller passes all five screens at 1440/1024/390/320px with fixture responses, including normal-route navigation, dialogs, shared/denied views and Mac-gated link rendering (never launched). Actual local signed-out `/app/`, Sets, direct detail and `/app/connect` entry checks pass. On 2026-09-25 the user reported the local two-account test green: Invite-only access granted, recipient can view but not edit, and access denied after removal and refresh. Existing signed-in mutation checks belong to B-D; this does not claim a fresh repeat of every B-D flow.

The current local launcher enables the switch only on port 5174 and uses the existing verified database. Public activation requires an explicit build/deploy decision. Flag off retains the old portal; do not remove it before rollout acceptance.

### Rollout Preparation

- Integrated `origin/main` at `1fda6915` into the portal branch without conflicts (`f11186b`). The separate primary checkout and its unfinished work were not changed.
- Combined builds read `portalRedesignEnabled` from `config/production-features.json`, overriding ambient `VITE_PORTAL_REDESIGN_ENABLED`. Missing means off; invalid types fail the build. Direct portal/local builds still use the Vite switch.
- Keep the tracked setting false until a redesign-enabled combined draft passes and activation is approved. Set it true for rollout; false plus rebuild/redeploy restores the legacy UI. Scheduled builds use the same tracked setting. Mac flags and `release-config.json` are unchanged.
- Verification: full `npm run check` (including deploy safety and root typecheck), 131 portal tests and four production entry builds pass after integration. The build matrix uses the same feature-to-environment helper as combined builds. No Swift build, release packaging or live deploy was run.

### Draft Checkpoint (2026-09-25)

- Rollout configuration committed as `293d137`. Draft: `https://6ab6b1983d884564c607ac12--omgskills.netlify.app/app/`.
- Combined artifact built with the redesign temporarily enabled and the configured draft Clerk public key. Tracked setting restored to false before upload; no production activation or push. No fixture modules in the deployed app.
- Passed: hosted signed-out Skills/Sets/detail/connect routes and Clerk dialog; all three manifests match the artifact; protected health pages, unauthorized sync, downloads, every appcast update asset, and MCP. Full live library verification passed against the draft with production canonical URLs, including profile/skill/collection pages, Markdown mirrors, internal links, sitemap and redirects. Appcast bytes match production and the Mac release gate remains false.
- Authenticated hosted flows and the preview database contents were not tested; the real two-account result above is local-only. Production remains on `6ab6afcfa041425306120b86`.

## 9. Verification And Final Local Review

Verification accompanies every slice, not only the final one.

### Automated

- Portal typecheck/build and existing grouping, group-domain, private-source, feature-flag, and pairing tests.
- Focused tests for routes/back navigation, union-member search, count/filter semantics, permissions, selection reconciliation, and mixed set item types.
- Membership mapping, duplicate additions, partial removals/bulk failures, account changes, and stale responses.
- Preview starts without Clerk credentials; preview interactions issue no real API/auth requests.
- Production build contains no fixture module and cannot activate preview through URL or flag settings.

### Browser

- Compare to the handoff at 1440x900 and 1024x768 desktop, plus 390x844 and 320x740 mobile.
- Capture all five screens, mobile drawer, key menus/dialogs, shared detail, and long-content/empty/error scenarios.
- Check keyboard traversal, visible focus, Escape/focus return, labels, contrast, no clipped controls, and no page-level horizontal overflow.
- Exercise direct navigation, refresh, browser back/forward, source-filter navigation, and safe sign-in returns.
- Verify destructive confirmations, failed clipboard writes, pending states, and honest partial-result feedback.

### Real-Account Checkpoint

Only after fixture review and with an approved isolated backend/account: validate login, refresh, profile edits, create/edit/add/remove/reorder a test set, public/restricted/private access, device revocation, and permitted private-source actions. If that environment is unavailable, report these checks as unverified; fixture success is not integration proof.

## 10. Risks And Stop Conditions

| Risk | Control |
| --- | --- |
| Old checkout omits recent backend/gate fixes | Start from latest main and recheck audit assumptions. |
| Design cleanup silently removes working controls | Use `MAPPING.md` as the functionality checklist before switching authenticated views. |
| Sample data reaches real accounts | Separate dev bootstrap/controllers, no real API imports, production-build inspection. |
| Duplicate or incorrect set membership | Stable physical IDs plus authorized item mappings, never names. |
| CSS or routes break pairing/sign-in | Scoped styles and explicit separate connect routing; regression checks. |
| UI implies private Favorites, sent invites, or live agents | Accurate visibility/access/status copy and explicit unavailable states. |
| A needed capability requires broader backend work | Pause that interaction and revise the plan; do not hide the gap behind optimistic UI. |

Keep the existing authenticated UI during Slice A. Adopt each subsequent slice only after its checks pass. Commit boundaries should allow an individual UI slice to be reverted without changing data or release state.

## Next Action

Complete draft review, then obtain approval to land/push and activate the redesign through the guarded production deploy. Recheck latest main and live release assets first. The local two-account access checkpoint is complete; hosted authenticated flows are not yet verified. Real GitHub and Mac callback tests require separate scope approval; no Mac release is included.
