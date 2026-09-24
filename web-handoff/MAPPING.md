# Web App UI Mapping Audit

Audited 2026-09-24 against `origin/main` at `827f31ce` and this folder's README and HTML source. This is a source/contract audit, not a browser or live-account test.

## Recommended Scope

Recreate the handoff in the existing React portal so design iteration can continue. Use real APIs for supported actions, explicit unavailable states for missing capabilities, and a separate local fixture preview for fully populated design review. No new agent service, usage telemetry, CLI, schema migration, or Mac release is needed for the first UI pass.

The working checkout is `codex/pinned-install-test-mode`, with two client commits absent from main and unrelated local changes. Start implementation in an isolated worktree from current main; preserve this handoff and the current checkout.

## Screen Mapping

| Proposed surface | Current support | UI implementation decision |
| --- | --- | --- |
| Sidebar and mobile drawer | Current portal is one dashboard plus a separate group detail route. React, Tailwind, Radix/shadcn primitives, Lucide, and Geist are present. | Build a shared shell with Skills, Agents, Sets, and Home. Add Geist Mono. Preserve Clerk sign-in, account management, and sign-out. |
| Skills list | `/api/portal/synced-skills` supplies current synced installs; `groupSyncedSkills` produces logical rows and source badges. | Reuse grouping, render the new table/mobile rows, keep logical counts and a secondary physical-install count. Preserve access to full descriptions. |
| Search and source filters | Names, descriptions, source strings, and grouped physical members exist; the current UI has no search/filter controls. | Implement locally. Search every member, not just the representative. Filter by actual source values, preserving names such as Claude and Codex. |
| Recent activity / Last used | Skills have `lastSeenAt`, which means seen during sync. No per-skill usage timestamp exists. | Default to All skills. Keep Recent activity disabled with an unavailable explanation; show an em dash for Last used. Optionally display Last synced separately with its real meaning. |
| Skill source links | `githubUrl` exists or is null. | Use the actual source URL and derive the repository label only from a valid GitHub URL. Do not infer an origin from a skill name. |
| Star | Current action adds to a lazily created Favorites group. Existing favorites are disabled, not toggleable. Favorites is public and cannot be renamed, deleted, or made private. | Preserve Favorites semantics and disclose public visibility at the first star action. Full unstar needs the small item-ID mapping described below. |
| Add-to-set popover | Add exists; owned groups expose `syncedSkillIds`; removal exists by group item ID. | Support real membership checks across every physical ID in a logical row. Full checkbox toggling needs the item-ID mapping below. Exclude Favorites from ordinary set targets. |
| Bulk edit | No bulk UI or transactional bulk endpoint. Existing single-item APIs are available. | Add selection, Clear, target picker, and Star. Use bounded single-item requests; retain failed selections and report partial results accurately. Never claim all succeeded after a partial failure. |
| New set with selected skills | Group creation already accepts `syncedSkillIds`; the current client helper always sends an empty list. | Extend the client helper to submit selected IDs on creation. Use one representative per logical skill and refresh server state afterward. |
| Agents list | Device tokens have a name, last-use time, expiry, and active/revoked/expired/inactive status. Synced skills have agent/source labels, but no device-to-skill mapping in the API. | Show observed agent sources with logical skill counts and source-filter links. Show real connected devices in a separate subsection on this screen. Do not attach invented hostnames or device identities to agent rows. |
| Online / synced status | Device `lastUsedAt` is token activity, written at most daily. It is not heartbeat presence or a precise sync timestamp. | Use actual device statuses and label the date Last active. Agent online state stays unavailable. No fabricated green online dots. |
| Add agent | The shown `npx omgskills connect` command does not exist. Current Mac connection and legacy token flows do exist. | Keep the new-agent dialog as an explicit unavailable placeholder without a runnable command or endless waiting spinner. Preserve existing Connect app/Legacy flows under device management, subject to current gates. |
| Disconnect | Device revocation exists; independently disconnecting Claude/Codex does not. | Offer confirmed Revoke connection on real device rows. Do not present it as per-agent uninstall or removal of local skills. |
| My sets / Shared with me | Owned and shared APIs, item counts, owner display names, visibility, and protected Favorites exist. | Reuse them in the new lists. Owner controls only for owned sets. Use real initials/counts where exposed; do not invent shared-member identities. |
| Set visibility | Three states: Public, Invite only (`restricted`), Only me (`private`). Hidden/moderated is a separate state. | Replace the prototype's binary switch with a compact three-option menu. Preserve hidden status and Hide/Restore actions. |
| Set members | Owner-only allowed-email list and add/remove APIs exist. Shared viewers are deliberately not returned that email list. | Owner sees access chips and Add email. Shared viewers see owner/access information only. Adding an email grants access for Invite only; it does not send email, represent accepted membership, or grant edit access. |
| Set detail skills | Read, remove, reorder, source links, name/description editing, and delete confirmation exist. Items may be synced, catalog, GitHub, or private-release-backed. | Preserve these actions using an Edit mode and compact overflow menu. Keep server order and all item kinds. Avoid assuming every set item maps to a personal synced skill or can be starred. |
| Copy set link | Public URLs are `/u/<handle>/sets/<slug>`; authenticated details use `/app/groups/<id>`. Detail response has no ordinary share URL. | Copy public links only when actually available. For restricted sets, use the authenticated detail URL and explain recipient sign-in. Only-me and hidden sets must not imply public access. |
| Install set | Existing `appDeepLink` action is controlled by the separate Mac gate. | Preserve the gated entry point in the new header. With the Mac gate off, hide it or show a non-actionable unavailable state. |
| Home/profile | Clerk identity, handle editing, profile publication, and returned `publicUrl` exist. | Match the handoff and retain handle setup/edit validation and account controls. Use the returned URL, normally `/u/<handle>`. |
| Profile publication | Publishing a profile and making individual sets public are distinct policies. Public group access does not depend on the profile switch. | Copy should say whether the profile is listed/public, not promise that switching it off makes all skills or public sets private. |
| Private source | Existing UI lists Broker installations, selects account/repository/root, registers sources, and creates releases. | Move the complete existing capability into Home, styled to match. Keep loading, disconnected, connected, no-granted-repository, error, and release states. |
| Connect GitHub | Handoff is a simulated toast; existing portal has no self-service connection button/URL flow. | Show an unavailable setup action until a verified installation flow is supplied. Preserve existing connected-source controls. Do not claim automatic repository sync. |

## Small API Gap Worth Including

True star/unstar and checkbox membership removal need a reliable mapping from synced skill ID to group item ID. Current group summaries expose `syncedSkillIds`, while detail/items responses expose item IDs without `syncedSkillId`. Matching names or array positions is unsafe.

Recommended additive change: return `syncedSkillId: string | null` on owner-authorized item/detail responses and add it to the client item type. Load/cache membership details only when needed. Check membership against `allSkillIds`; removing a logical row should remove its matching memberships, leaving unrelated items untouched. Mixed item kinds remain supported. No database migration is needed.

If API changes are postponed, keep existing add-only behavior and remove-from-set detail actions. Do not show a reversible checkbox or star toggle that cannot persist removal.

For public Copy link on shared detail pages, consider an authorized `shareUrl` returned by the existing detail endpoint. Otherwise use the authenticated detail route; do not parse or depend on a disabled Mac deep link to construct web URLs.

## Existing Functionality To Retain

- Clerk login, account menu, sign-out, and signed-out return navigation.
- Handle setup/editing and server validation, including reserved/taken errors.
- Favorites protection and its public visibility.
- Set name/description editing, ordering, delete confirmation, and Hide/Restore.
- Owner/invited/public permissions; restricted recipients remain read-only.
- Synced skill refresh, account-scoped cache, refresh on focus, and request deduplication.
- Device listing, revoke confirmation, connection-code and legacy sync paths, and `/app/connect` state handling.
- Private-source registration and release creation, with existing server gates respected.
- Existing `/app/groups/<id>` URLs, canonical public URLs, and separate web/Mac release flags.

The current List/Table switch can retire as an explicit design replacement; the new table must still expose descriptions and all existing row actions.

## Placeholder And Preview Rules

- Production uses real identity/data. Unknown values use an em dash or a concise unavailable state.
- Upcoming controls may open a short explanation, but never report a successful connection, invitation, copy, or sync that did not happen.
- A local-only fixture mode can exercise all five screens, long names, empty/error states, mobile layout, and future agent/activity designs. Clearly mark it as a preview and prevent all API writes; never mix fixture records with a signed-in account.
- Clipboard success appears only after the browser confirms the write. Other mutations show success after the API confirms them.
- Prefer accessible Radix primitives for dialogs, menus, and switches; preserve Escape, focus return, keyboard access, and pending/error states. Do not copy the prototype runtime into the portal.

## Suggested Implementation Slices

1. Shared shell, navigation, tokens, responsive layouts, and local fixture preview. Make the complete visual design reviewable first.
2. Real Skills and Sets lists, search/source filters, Home/profile, and retained account/refresh behavior.
3. Set detail, owner controls, membership mapping, star toggles, add/remove popover, and bulk operations.
4. Agents placeholders plus actual device controls, retained private-source forms, and feature-gate checks.
5. Desktop/mobile design review and focused behavior verification before any approved deployment.

These are suggested boundaries for the implementation plan, not authorization to deploy or enable Mac features.

## Verification For The Implementation Plan

- Screens: desktop, narrow desktop, and mobile; overflow, long skill names/emails, drawer, dialogs, menus, loading, empty, error, and populated states.
- Navigation: direct URLs, refresh, browser back/forward, signed-out returns, and existing connect callbacks.
- Identity: logical rows/counts remain stable; search includes hidden members; set membership recognizes non-representative variants.
- Mutations: star/unstar, set add/remove/create, partial bulk failures, editing, reordering, access changes, and confirmation before destructive actions.
- Permissions: own/shared/public/private/restricted/hidden sets and protected Favorites. No hidden email-list exposure.
- Gates: web on/Mac off, fully disabled, and deliberately enabled private testing; preview mode cannot write real data.
- Run portal build and relevant group, grouping, private-source, and feature-flag tests; add focused tests for newly introduced mapping and mutation behavior.

## Evidence References

Paths below refer to `origin/main` at the audited commit, not the older current checkout.

- `portal/src/main.tsx`: dashboard, profile, sync/device controls, auth and routing.
- `portal/src/synced-skill-grouping.ts`: physical-to-logical grouping contract.
- `portal/src/groups/{api,model,types}.ts`, `SkillActions.tsx`, `GroupsPanel.tsx`, `GroupDetailPage.tsx`: existing set behavior and presentation.
- `portal/src/private-sources/`: connected-source and release-management UI/API.
- `netlify/functions/portal-{synced-skills,devices,profile,groups,group-detail,group-items,group-allowed-emails}.mts`: data shape and mutations.
- `netlify/functions/_shared/{group-access,device-auth,public-group-routes}.ts`: access, device timestamps, and canonical URLs.
- `config/production-features.json`: web enabled, Mac authentication disabled.
