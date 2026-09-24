# Web App Redesign Implementation Plan

Status: Slice A committed and design-approved. B1 is implemented locally; signed-in reads and populated account-snapshot checks pass. Remaining isolation/lifecycle checks are tracked in LOCAL-INTEGRATION.md. B2 and Slices C-D are not started. Updated 2026-09-24.

Local preview: http://127.0.0.1:5173/app/preview/

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
- [x] Connect lazy real detail reads to the redesigned set layout, with loading/error/retry, response validation and stale-read cancellation. Disable mutation/install controls; show unloaded devices/private sources as unavailable, not disconnected. Desktop/mobile and direct reload verified; item identity remains unknown until Slice C adds physical IDs to the response.
- [x] Cancel pending reads on unmount/account switch and ignore late responses. Account cache and focus-refresh belong to B2.
- [x] Require an explicitly verified loopback backend and a development Clerk key before enabling sign-in. Client and local proxy allow only required GET endpoints.
- [x] Automated checks and blocked-entry browser verification pass. Production excludes both local entries even with their opt-in flags set.
- [x] Verify development Clerk and the backend's resolved local database; test sign-in, empty/populated reads, owned detail, search/filtering, reload and mobile navigation using an approved account-scoped snapshot. No production backend: even GET requests reconcile user records.
- [ ] Complete shared detail and two-account lifecycle/isolation checks; account switching/sign-out wiring belongs to B2. Investigate the initial load error if reproducible.

See `LOCAL-INTEGRATION.md` for setup and remaining checks. B1 is not end-to-end verified yet.

### B2: Account Lifecycle And Profile Changes

- [ ] Preserve Clerk sign-in, account management, sign-out, and handle onboarding.
- [ ] Retain account-scoped cache, refresh on focus/visibility, request deduplication, manual refresh, and stale-response protection on account changes.
- [ ] Keep loading, stale-but-usable, empty, permission-denied, and error states distinct. Failed refresh must not erase usable data.
- [ ] Wire Home handle/publication changes with server validation and accurate public-profile wording. Use the API's returned profile URL.
- [ ] Clear selection and account-specific state on sign-out/account change; prune deleted selections after refresh.

**Exit:** real reads and profile changes work without changed identity/grouping behavior, cross-account data leakage, or regressions to existing authentication and refresh behavior. Use an isolated test account/environment for mutation verification.

## 6. Slice C: Set Actions And Membership

### Small Additive API Change

- [ ] Add nullable `syncedSkillId` to owner-authorized item/detail responses and the client type. No schema migration.
- [ ] Keep shared/public responses from exposing owner-only identity mappings or allowed-email lists.
- [ ] Load membership item IDs on demand and cache only within the current account. Invalidate after changes.
- [ ] Do not match item IDs using names, ordering, or guessed URLs.

### Interaction Rules

- [ ] Star toggles public Favorites. Disclose visibility before the first add; retain protected-set rules.
- [ ] A logical skill is a member when any `allSkillIds` match. Removal removes every matching membership, never unrelated set items.
- [ ] Add one representative synced ID per logical row, unless an existing member already satisfies membership. Server responses remain authoritative.
- [ ] Unknown membership is a loading/error state, not an unchecked checkbox. Disable conflicting actions while a row/target mutation is pending.
- [ ] Bulk actions use a small bounded request queue, report per-item outcomes, and retain failed selections for retry. Reconcile duplicate/already-present responses rather than claiming new additions.
- [ ] New-set creation passes selected IDs through the existing supported API parameter and refreshes returned state.
- [ ] Preserve rename, description, reorder, source links, remove, delete confirmation, Hide/Restore, and all set item kinds.
- [ ] Owner-only controls remain absent for shared viewers; server checks remain the security boundary.
- [ ] Keep allowed-email access wording accurate and preserve restricted/private distinctions.
- [ ] For an owned public set with a known handle/slug, use the canonical web URL. Otherwise use the authenticated detail link with access-appropriate wording. Defer adding a server `shareUrl` unless this proves insufficient.
- [ ] Show clipboard success only after an actual successful write. Never derive a web link from a disabled Mac deep link.

**Exit:** toggles persist correctly across refresh; non-representative membership and partial failures are tested; no behavior depends on a name match or fake successful response.

## 7. Slice D: Devices, Private Sources, And Gates

- [ ] Agents uses actual source labels and counts; links return to Skills with the relevant filter.
- [ ] Devices uses actual names/statuses and Last active dates. Do not present token activity as live presence.
- [ ] Move existing connection-code, legacy-token, device listing, and confirmed revocation controls into the new layout without changing protocol behavior.
- [ ] Preserve code clearing, cancellation, and stale-response guards in authentication-related dialogs.
- [ ] Retain private-source installation/repository/root selection, source registration, and release creation, including disconnected, empty, error, and pending states.
- [ ] Keep unsupported agent and GitHub setup actions explicit and non-operative.
- [ ] Verify separate web/Mac gates. Do not expose Mac install actions because web UI is enabled, or assume existing sync APIs all share one gate.
- [ ] Recheck `/app/connect` and existing set links independently of the redesign.

**Exit:** all supported old capabilities remain reachable, placeholders do not claim unimplemented behavior, and no feature flag or protocol was changed unintentionally.

## 8. Verification And Final Local Review

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

## 9. Risks And Stop Conditions

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

Review/commit the B1 read-only checkpoint, then plan B2 and finish the remaining account-lifecycle/isolation checks alongside its wiring. Slices B-D are not a production rollout authorization.
