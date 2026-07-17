# Skill Groups Implementation Plan

## Overview

Goal: prove the core loop:

```text
local app skills -> web portal -> shared group -> teammate can view
```

Primary product spec: `skillgroup.md`.

MVP stack:

- React/Vite portal in `portal/`
- Netlify Functions for API routes
- Netlify Database/Postgres
- Drizzle ORM + Drizzle Kit migrations
- Clerk with Google OAuth
- existing hosted catalog data from `site/data/crawl4/manifest.json`, with `/data/v2/manifest.json` fallback

Build order:

- Stage 1 proves sync and one restricted shared group.
- Stage 2 adds public sharing and profile pages.
- Stage 3 adds full group management.

Branch rule:

- Implement this work on `codex/skillgroups-mvp`, not directly on `main`.
- Keep `skillgroup.md` and this implementation plan with the branch so the implementation and plan move together.

Routing decision:

- `https://app.omgskills.com/*` serves the portal SPA.
- `https://omgskills.com/u/{handle}` serves database-backed public user profiles.
- `https://omgskills.com/u/{handle}/sets/{groupSlug}` serves database-backed public Skill Group pages.
- `https://omgskills.com/library/{handle}/` serves generated curated-creator pages.
- `https://omgskills.com/profiles/*` remains compatibility routing into the creator or user namespace.
- Existing `https://omgskills.com/data/*`, downloads, updates, health, and appcast routes must keep their current behavior.

System alignment rule:

- New user-profile links should use `/u/{handle}` and `/u/{handle}/sets/{groupSlug}`.
- Keep `/profiles/*` and `/u/{handle}/{groupSlug}` only as compatibility routes until that policy is intentionally removed.
- Catalog lookup must read `/data/crawl4/manifest.json` first, then `/data/v2/manifest.json`, and fetch assets from the same base as the selected manifest.
- Sync identity must preserve `stableKey` as install-location identity and store `skillMdSha` as content identity.
- Synced skills should store `identityStatus`: `resolved`, `ambiguous`, or `localOnly`.
- Group items should store display snapshots (`name`, `description`) at add-time so public pages survive stale catalog/synced references.

## Milestone 0: Foundation

Goal: create the web/runtime foundation without changing scraper, MCP, or existing catalog generation.

Tasks:

- Scaffold `portal/` as a React/Vite app.
- Configure the portal for `app.omgskills.com`.
- Update Netlify config so the current static site, portal app, functions, and public `/u/*` routes can coexist in one Netlify project.
- Add explicit route precedence so the portal SPA fallback does not shadow existing public assets, health, or functions.
- Keep these paths ahead of any SPA fallback:
  - `/data/*`
  - `/downloads/*`
  - `/updates/*`
  - `/health/*`
  - `/.netlify/functions/*`
  - `/library/*`
  - `/profiles/*`
  - `/u/*`
- Add SPA fallback routing only for the portal/app surface:

```text
app.omgskills.com/*    /index.html    200
```

- Do not use `/app/*` on `omgskills.com` as the primary MVP portal route unless DNS/domain setup blocks `app.omgskills.com`.
- Add Clerk client setup in the portal.
- Add Clerk server setup in Netlify Functions.
- Add Clerk allowed redirect/origin configuration for:
  - local dev portal URL
  - Netlify deploy preview URLs
  - `https://app.omgskills.com`
- Treat redirect/origin setup as a Milestone 0 verification task, not a blocker before the portal exists.
- Add required environment variables:
  - `VITE_CLERK_PUBLISHABLE_KEY`
  - `CLERK_SECRET_KEY`
  - Netlify Database connection variables provisioned by Netlify
- Add Drizzle schema source and Drizzle Kit config.
- Use the data model draft in `skillgroup.md` as the starting schema, including the latest alignment addenda.
- Generate SQL migrations into `netlify/database/migrations/`.
- Add database access through `@netlify/database` and `drizzle-orm/netlify-db`.
- Add shared Netlify Function helpers:
  - `requireAuth(req)` for Clerk bearer token validation
  - CORS wrapper limited to `https://app.omgskills.com`
  - JSON success/error helpers
  - outbound fetch timeout helper
- Add reserved handle/slug list shared by portal and functions.
- Confirm Netlify Database is available on the production Netlify plan before implementation starts.
- Update deploy scripts/workflows so portal build output, static site assets, functions, and migrations are all included in deploy previews and production deploys.

Acceptance checks:

- Portal runs locally.
- Clerk sign-in works locally and in deployed preview.
- An authenticated function can identify the Clerk user.
- A function can read/write the database.
- Portal routes survive direct browser refresh.
- Existing `omgskills.com/data/*`, downloads, updates, and health routes still behave as before.
- Public `/library/*`, `/u/*`, and compatibility `/profiles/*` route precedence is verified.
- Deploy preview runs Drizzle migrations and exposes functions.
- Production deploy still preserves release assets required by current Mac app downloads/updates.
- Local setup is documented enough for the next agent to run the portal, functions, and migrations.

Tests:

- Auth helper accepts valid Clerk bearer token and rejects missing/invalid token.
- CORS helper handles `OPTIONS` and sets allowed origin.
- DB helper can run a simple query in test/dev.
- SPA fallback does not shadow `/data/*`, `/downloads/*`, `/updates/*`, `/health/*`, `/.netlify/functions/*`, `/library/*`, `/profiles/*`, or `/u/*`.
- Deploy script dry-run/check confirms portal output and required release assets are present.

Verification gate:

- Done when portal, Clerk auth, Netlify Functions, DB access, routing, and deploy preview basics work together.
- Verify with local start/build commands, an authenticated smoke function that returns the current Clerk user, and a DB smoke check that can insert/read/delete a test row.
- Verify these routes in preview before production: `app.omgskills.com/*`, `/library/*`, `/u/*`, compatibility `/profiles/*`, `/data/crawl4/manifest.json`, `/data/v2/manifest.json`, `/download`, `/downloads/omgskills-mac.dmg`, `/appcast.xml`, `/updates/*`, `/health/`, and `/.netlify/functions/*`.
- Capture evidence: command output summary, deploy preview URL, checked route/status list, and DB/auth smoke result.
- Manual fallback: temporary smoke endpoints are acceptable for auth/DB proof, but remove them before merge unless they become permanent health checks.
- Not required yet: macOS sync, synced skills UI, restricted groups, public profiles, catalog add, export, copy, or analytics.

## Milestone 1: Sync And One Shared Group

Goal: prove app-to-web sync and email-based group sharing.

Tasks:

- Add sync token API:
  - create token for signed-in user
  - expire token after about 10 minutes
  - allow one use only
  - scope token only to installed skill inventory upload
- Add macOS sync entry point:
  - simple Sync button or menu item
  - token paste/input flow
  - optional `omgskills://sync?token=...` deep link if cheap
- If deep link is included, add the `omgskills://` URL scheme to the macOS app `Info.plist` and route incoming sync URLs to the sync flow.
- Reuse `InstalledSkillsScanner` to build upload payload.
- Add a dedicated `SkillSyncService` for app sync networking and payload mapping. Do not put upload logic directly in SwiftUI views.
- Upload metadata only:
  - name
  - description
  - catalog skill id if matched
  - GitHub URL if known
  - local-only flag
  - identity status: `resolved`, `ambiguous`, or `localOnly`
  - skill md sha if known
  - source: Claude, Codex, or Agents
- Do not upload `SKILL.md` contents.
- Add `sync_runs` handling:
  - create run per upload
  - mark completed or failed
  - failed runs do not hide old synced skills
- Add `synced_skills` handling:
  - stable key dedupes repeat syncs
  - current sync updates `lastSeenAt`
  - missing skills become `isCurrent = false` after successful sync
- Stable key rule:
  - use `githubUrl + skillName` when a GitHub URL is known
  - otherwise use `origin + resolvedPath`
  - treat `stableKey` as install-location identity, not content identity
  - treat `skillMdSha` as content identity, not repeat-sync identity
  - never send raw `SKILL.md` contents
- Add Synced Skills portal UI.
- Add restricted Skill Group creation from synced skills.
- Add allowed email management for a group.
- Add Shared With Me view.
- Ensure unauthorized restricted group access returns generic no-access/not-found behavior without leaking group name or owner.
- For local-only synced skills, show metadata only and no install action.
- Create or identify three test identities for verification:
  - owner user
  - allowed-email user
  - wrong-email user

Acceptance checks:

- Owner signs in, creates sync token, syncs installed app skills, and sees Synced Skills in portal.
- Repeat sync hides removed local skills without duplicating current skills.
- Owner creates a restricted group from synced skills.
- Owner adds an allowed email.
- Allowed email signs in and views the shared group.
- Wrong email and logged-out users cannot see restricted group details.
- Local-only synced skills show metadata but no install action.

Tests:

- Sync token creation requires auth.
- Expired, reused, unknown, and wrong tokens are rejected.
- Successful upload creates `sync_run` and synced skill rows.
- Failed sync does not mark prior current skills stale.
- Repeat sync marks missing skills non-current.
- Scanner payload covers valid, symlinked, local-only, duplicate, and malformed skills.
- `SkillSyncService` maps scanner output to sync payload without view dependencies.
- Deep-link sync opens the app and extracts token when URL scheme is enabled.
- Group access covers owner, allowed email, wrong email, and logged-out user.

Verification gate:

- Done when one owner can sync local app skills and share one restricted group with one allowed email.
- Verify with the app sync flow if available, or a test sync client/API payload if the app UI is not finished yet.
- Confirm a sync token is created, used once, expired/reused tokens fail, one `sync_runs` row is created, and `synced_skills` rows are created without `SKILL.md` contents.
- Confirm `synced_skills` stores `identityStatus` and `skillMdSha` when the client sends them, while old clients without those fields still sync.
- Confirm repeat sync does not duplicate skills and marks missing skills non-current only after a successful sync.
- Confirm the owner can create a restricted group from synced skills, add one allowed email, and see it in the portal.
- Confirm the allowed email can view the group, while a wrong email and logged-out user cannot see group details.
- Capture evidence: sync run ID, synced skill count, group ID, allowed-email test result, denied-access test result, and one screenshot or short screen note from Synced Skills.
- Manual fallback: backend/API proof is enough to pass this gate if the macOS UI is still being wired, as long as `SkillSyncService` payload tests pass.
- Not required yet: public profiles, Favorites publishing, catalog search/add, GitHub URL add, export, duplicate, analytics, or advanced team management.

## Milestone 2: Public Sharing

Goal: make public user profiles and owner-scoped public set URLs work without colliding with generated creator pages.

Tasks:

- Add user handle setup.
- Generate random default handles, not sequential handles.
- Block reserved handles and slugs.
- Reserve every canonical handle and alias in `index/seeds/creators.json` for profile claims. Registry membership protects identity; the `watch` flag only controls crawling.
- Generate `netlify/functions/_shared/catalog-reserved-handles.ts` with `npm run generate:creator-handle-reservations`, and fail checks/builds when it is stale or contains a collision.
- Apply creator reservations only to new profile claims or handle changes. An existing holder may save an unchanged handle, and creator handles do not reserve matching group slugs.
- Keep static creator profiles registry-backed. Add trending or catalog authors to the curated registry before publishing a `/library/{handle}/` page.
- Before public handle claims launch, require a database collision check whenever a creator is added or removed. Reserved creator handles may later be assigned through an operator verification grant; reservation means verification required, not permanently unavailable.
- Use public profile page:

```text
/u/{handle}
```

- Add public Skill Group page:

```text
/u/{handle}/sets/{groupSlug}
```

- Keep legacy compatibility routes:

```text
/u/{handle}/{groupSlug}
/profiles/{handle}
/profiles/{handle}/sets/{groupSlug}
```

- Resolve public groups with owner-scoped slug lookup: `UNIQUE(ownerUserId, slug)`.
- Use `/u/*` links in portal UI.
- Use `/library/*` for generated creator pages. `/profiles/*` may redirect or render compatibility behavior but is not canonical for either namespace.
- Public group items with resolved canonical catalog IDs should link to existing web-library skill pages.
- Public group items with stale/missing references should render stored snapshots with no install action.
- Add Favorites as a special personal Skill Group.
- Add profile settings for selected public groups.
- Private profile behavior:
  - public profile returns `200` with profile content
  - private profile returns `200` with generic private page
  - unknown handle returns `404`
- Keep handle/group slug changes warning-only for now. No redirects in MVP.

Acceptance checks:

- Published profile loads at `/u/{handle}`.
- Public group loads at `/u/{handle}/sets/{groupSlug}`.
- `/profiles/{handle}` compatibility routing and legacy `/u/{handle}/{groupSlug}` still work.
- Public group items link to catalog skill pages when canonical catalog IDs are available.
- Stale references render item snapshots instead of breaking the page.
- Two users can reuse the same group slug.
- Private profile does not reveal more than a generic private page.
- Unknown handle returns normal 404.
- Reserved handles/slugs are rejected.
- Favorites can appear on public profile only after publishing.

Tests:

- Public/private/unknown profile responses return correct status and body class.
- Owner-scoped group URL resolution works.
- Duplicate slug is allowed across owners but rejected for same owner.
- Reserved handle/slug validation works.
- Selected profile groups only show when public and selected.

Verification gate:

- Done when published profile and public group URLs work without leaking private profile state.
- Verify `/u/{handle}` returns `200` for a public profile and renders selected public groups.
- Verify `/u/{handle}/sets/{groupSlug}` returns `200` for a public group and resolves the group by owner plus slug.
- Verify `/profiles/{handle}` compatibility routing and legacy `/u/{handle}/{groupSlug}` still work.
- Verify a private profile returns `200` with a generic private page and an unknown handle returns `404`.
- Verify reserved handles/slugs are rejected, duplicate group slugs are allowed across owners, and duplicate slugs are rejected for the same owner.
- Capture evidence: tested handles/slugs, status-code list, public profile screenshot, public group screenshot, and private/unknown behavior notes.
- Manual fallback: browser checks or `curl` checks are acceptable for route/status proof.
- Not required yet: handle-change redirects, catalog add, GitHub URL add, export, duplicate, analytics dashboards, or full moderation tooling.

## Milestone 3: Full Group Management

Goal: complete richer group workflows without changing scraper, MCP, or catalog generation.

Tasks:

- Add catalog skill search/add using hosted manifest:
  - read `https://omgskills.com/data/crawl4/manifest.json`
  - fall back to `https://omgskills.com/data/v2/manifest.json`
  - fetch current skills JSON from the same base as the selected manifest
  - keep lookup non-blocking
  - do not import catalog into portal DB in MVP
- Add public GitHub skill URL add/validation:
  - accept only supported GitHub URLs
  - validate repo and `SKILL.md`
  - verify frontmatter has `name` and `description`
  - keep GitHub App/KV cache as follow-up unless rate limits appear immediately
- Add export JSON:
  - include type/version/exported date
  - include group metadata
  - include item order, notes, and useful skill metadata
  - serve as attachment with `skillgroup-{slug}-{date}.json`
- Add duplicate public group to My Skills:
  - snapshot copy only
  - copy references and notes
  - record original attribution
  - do not copy access rules
  - do not sync with original
- Add analytics events:
  - public profile/group views
  - copy/export clicks
  - per-skill open/install clicks
  - no personal viewer tracking
- Add moderation flags:
  - `disabledAt` for groups/profiles where needed
  - disabled public resources return 404

Acceptance checks:

- Users can add catalog skills without blocking on catalog fetch failures.
- Users can add valid GitHub skill URLs and see clear errors for invalid ones.
- Exported JSON preserves order and enough metadata to be useful standalone.
- Duplicated group is independent and keeps attribution.
- Analytics records expected events without storing personal viewer identity.
- Disabled public resources are hidden.

Tests:

- Catalog lookup failure does not block group creation/editing.
- GitHub URL validation covers invalid URL, missing repo, missing `SKILL.md`, bad frontmatter, timeout, and success.
- Export JSON shape matches versioned contract.
- Duplicate creates snapshot and excludes access rules.
- Analytics events are written for expected public actions.
- Moderation flag hides public resources.

Verification gate:

- Done when richer group management works without changing scraper, MCP, or catalog generation.
- Verify catalog search/add works from the hosted manifest and catalog fetch failure does not block group editing.
- Verify GitHub URL validation accepts a valid public skill URL and rejects invalid URL, missing repo, missing `SKILL.md`, bad frontmatter, and timeout cases with clear errors.
- Verify export downloads valid JSON with type/version/exported date, group metadata, item order, notes, and useful skill metadata.
- Verify duplicating a public group creates an independent snapshot with attribution and without access rules.
- Verify analytics records expected public actions without storing personal viewer identity.
- Verify disabled public group/profile returns hidden behavior.
- Capture evidence: sample export JSON, duplicate group ID, validation pass/fail examples, analytics event sample, and disabled-resource result.
- Manual fallback: GitHub validation failures can be checked with known fake URLs; analytics can be checked by direct DB/event inspection.
- Not required yet: GitHub App, caching layer, live sync between duplicated groups, drag/drop ordering, or advanced moderation queues.

## Cross-Cutting Implementation Rules

- No private skill contents are uploaded.
- Stage 1 uses one-use short-lived sync tokens, not long-lived app API keys.
- Stage 1 does not require catalog lookup.
- Group item ordering starts with simple integer `position`.
- Drag/drop and fractional indexing are later unless explicitly pulled forward.
- Handle redirects are later. MVP warns that changed URLs break.
- Keep scraper, MCP package, and existing catalog generation unchanged.
- Keep route namespaces separate: curated creators under `/library/*`, portal users and sets under `/u/*`, and skills under `/skills/*`.
- Prefer small, testable endpoints over broad generic APIs.
- Every Netlify Function should use shared auth/CORS/error helpers.
- Keep sync networking in a dedicated macOS service layer.
- Treat Netlify routing as order-sensitive. Public data/download/update/health/function routes must stay ahead of SPA fallback rules.
- Treat `/profiles/*` as compatibility routing, not a canonical namespace for new work.

## Verification Rules

- Prefer automated tests when they are cheap and stable.
- Manual checks are acceptable for MVP UI flows if the evidence is recorded clearly.
- Each milestone can be considered complete when its verification gate passes, even if later-stage features are missing.
- Do not block a milestone on polish, analytics, drag/drop, redirects, public sharing, or team management unless that milestone explicitly requires it.
- Every milestone that changes deploy/routing must re-check existing public assets before production deploy.
- If a verification step cannot be run, record why, what was checked instead, and the smallest follow-up needed.

Evidence log template:

```md
## Milestone N Evidence

Date:
Branch/commit:
Preview URL:
Commands run:
Manual flows checked:
DB/API evidence:
Existing site regressions checked:
Known gaps:
Decision: Pass / Needs follow-up
```

## Milestone 0 Evidence

Date: 2026-06-23
Branch/commit: `codex/skillgroups-mvp`, uncommitted
Preview URL: `https://6a3ad794af99f17ae6e318ff--omgskills.netlify.app`
Commands run:

- `npm install`
- `npm run check`
- `npm run build:portal`
- `npm run build:netlify`
- `SITE_DIR=dist/netlify-site node ./scripts/prepare-netlify-site-deploy.mjs`
- `npx netlify-cli build`
- `npx netlify-cli deploy --dir=dist/netlify-site --site dfdb618d-b748-4c4f-a535-646dc5db449f`
- `npx netlify-cli api updateSite --data '{"site_id":"dfdb618d-b748-4c4f-a535-646dc5db449f","body":{"domain_aliases":["www.omgskills.com","app.omgskills.com"]}}'`

Manual flows checked:

- Draft deploy created without `--prod`.
- Portal static entry loads at `/app/index.html`.
- Portal direct navigation fallback works at `/app/test-route`.
- Portal built assets load at `/app/assets/*`.
- `app.omgskills.com` is added as a Netlify domain alias.
- `app.omgskills.com` has a public CNAME to `omgskills.netlify.app`.
- TLS certificate already covers `*.omgskills.com`.

DB/API evidence:

- Netlify build bundled Functions:
  - `portal-auth-smoke.mts`
  - `portal-db-smoke.mts`
  - `public-skillgroup-page.mts`
- Unauthenticated `/api/portal/auth-smoke` returns `401`.
- Unauthenticated `/api/portal/db-smoke` returns `401`.
- Authenticated Clerk and DB smoke checks still need a real signed-in browser session.

Existing site regressions checked on draft deploy:

- `/data/manifest.json` returns `200`.
- `/data/v2/manifest.json` returns `200`.
- `/download` returns `302` to `/downloads/omgskills-mac.dmg`.
- `/downloads/omgskills-mac.dmg` returns `200`.
- `/appcast.xml` returns `200`.
- `/health/` returns `401`, confirming Basic Auth protection in deploy previews.
- `/u/test-handle` returns `404`.

Known gaps:

- `npx netlify-cli dev` and `npx netlify-cli serve` fail locally on Node `v25.6.1` with `Cannot read properties of undefined (reading 'prototype')`. Project is pinned to Node 20 with `.nvmrc` and `package.json` engines.
- Production `app.omgskills.com` currently serves the existing production deploy until the branch is intentionally shipped. The portal is verified on draft under `/app/*`.
- Clerk redirect/origin URLs still need to be verified after the portal domain is active.
- Authenticated Clerk and DB smoke checks require a browser session or test token.

Decision: Pass for code/deploy foundation. Follow-up required before production launch: Clerk redirect/origin verification and authenticated smoke check with a real signed-in user.

## Milestone 1 Evidence

Date: 2026-06-23
Branch/commit: `codex/skillgroups-mvp`, commit `97e552a`
Preview URL: `https://codex-skillgroups-mvp--omgskills.netlify.app`
Commands run:

- `npm run check`
- `npm run build:netlify`
- `SITE_DIR=dist/netlify-site node ./scripts/prepare-netlify-site-deploy.mjs`
- `swift test` from `menubar/`
- `npx netlify-cli deploy --dir=dist/netlify-site --site dfdb618d-b748-4c4f-a535-646dc5db449f`
- `npx -p node@20 node ./node_modules/netlify-cli/bin/run.js database status`
- `npx -p node@20 node ./node_modules/netlify-cli/bin/run.js db init --assume-no`
- `npx -p node@20 node ./node_modules/netlify-cli/bin/run.js database init --yes`
- `npx -p node@20 node ./node_modules/netlify-cli/bin/run.js deploy --build --branch codex/skillgroups-mvp --site dfdb618d-b748-4c4f-a535-646dc5db449f`
- `npx -p node@20 node ./node_modules/netlify-cli/bin/run.js env:set NETLIFY_DB_URL ... --context branch:codex-skillgroups-mvp --secret`
- `npx -p node@20 node ./node_modules/netlify-cli/bin/run.js env:set CLERK_SECRET_KEY ... --context branch:codex-skillgroups-mvp --secret`
- `npx -p node@20 node ./node_modules/netlify-cli/bin/run.js deploy --build --branch codex-skillgroups-mvp --context branch:codex-skillgroups-mvp --site dfdb618d-b748-4c4f-a535-646dc5db449f`
- Temporary Clerk dev-user E2E script against `https://codex-skillgroups-mvp--omgskills.netlify.app`

Manual flows checked:

- Portal draft loads at `/app/test-route`.
- Portal assets load at `/app/assets/*`.
- The portal UI now includes sync token creation, Synced Skills, restricted group creation, allowed email entry, My Skill Groups, and Shared With Me surfaces.
- macOS Local Dashboard now includes a sync token field and Sync button.
- Temporary Clerk dev users were created for owner, allowed email, and wrong email, then deleted after the E2E check.

DB/API evidence:

- Netlify build bundled Milestone 1 Functions:
  - `portal-me.mts`
  - `portal-sync-token.mts`
  - `portal-sync-upload.mts`
  - `portal-synced-skills.mts`
  - `portal-groups.mts`
  - `portal-group-allowed-emails.mts`
  - `portal-shared.mts`
- Unauthenticated `POST /api/portal/sync-token` returns `401`.
- Unauthenticated `GET /api/portal/synced-skills` returns `401`.
- Unauthenticated `GET /api/portal/groups` returns `401`.
- Unauthenticated `GET /api/portal/shared` returns `401`.
- `POST /api/portal/sync-upload` with a bad token returns `401`.
- Preview DB branch `codex/skillgroups-mvp` is enabled and reachable.
- Stage 1 migration was applied safely to the preview DB branch; tables `skill_groups` and `synced_skills` were verified.
- E2E result:
  - sync run ID: `216a531f-9544-4d60-9fe7-702471f446b1`
  - synced skill count: `1`
  - group ID: `824cd464-63d1-4b7b-865a-01ba41242694`
  - allowed email could see the restricted group
  - wrong email could not see the restricted group
  - reused sync token was rejected

Existing site regressions checked on draft deploy:

- Production `/data/manifest.json` returns `200`.
- Production `/data/v2/manifest.json` returns `200`.
- Production `/download` returns `302` to `/downloads/omgskills-mac.dmg`.
- Production `/downloads/omgskills-mac.dmg` returns `200`.
- Production `/appcast.xml` returns `200`.
- Production `/health/` returns `401`.
- `/u/test-handle` returns `404`.

Known gaps:

- Netlify's Git mirror did not have `codex/skillgroups-mvp`, so API-triggered Git builds failed with `git ref refs/heads/codex/skillgroups-mvp does not exist`.
- CLI branch deploys do not automatically attach `database_branch_id`, so the preview uses branch-only Netlify env vars for `NETLIFY_DB_URL`, `NETLIFY_DB_DRIVER`, and `CLERK_SECRET_KEY`.
- The E2E used temporary Clerk dev users and API calls, not a visual browser walkthrough.

Decision: Pass for Stage 1 thin-slice API/app-sync foundation. Follow-up before production launch: replace branch-only DB env workaround with a Git-backed Netlify branch/deploy-preview if Netlify Git mirroring is fixed.

## Milestone 2 Evidence

Date: 2026-06-23
Branch/commit: `codex/skillgroups-mvp`, uncommitted
Preview URL: `https://codex-skillgroups-mvp--omgskills.netlify.app`
Commands run:

- `npm run check`
- `npm run build:netlify`
- `npx -p node@20 node ./node_modules/netlify-cli/bin/run.js deploy --build --branch codex-skillgroups-mvp --context branch:codex-skillgroups-mvp --site dfdb618d-b748-4c4f-a535-646dc5db449f`
- Temporary Clerk dev-user E2E script against `https://codex-skillgroups-mvp--omgskills.netlify.app`

Manual flows checked:

- Portal now has Public Profile controls for handle and published state.
- Portal My Skill Groups rows can publish/unpublish a group and show a public URL when published.
- Temporary Clerk dev users were created for public owner, private profile owner, and second public owner, then deleted after verification.

DB/API evidence:

- `PATCH /api/portal/profile` publishes a handle and rejects reserved handles.
- `PATCH /api/portal/groups/:groupId` publishes a group.
- Public profile result:
  - handle: `public-1782244167043-7hore9`
  - public group slug: `shared-1782244167043-7hore9`
  - group ID: `7603f914-b844-41ff-8534-6bbee0beb893`
- Public group page rendered the synced skill.
- Favorites group result:
  - group ID: `c9c99d33-6c9f-4c39-9f30-6782e48d7a19`
  - slug: `favorites`
  - visibility: public
  - public profile included `Favorite Skills`
- Private profile handle `private-1782244167043-7hore9` returned `200` with the generic private profile page.
- Unknown handle `unknown-1782244167043-7hore9` returned `404`.
- Duplicate group slug was rejected for the same owner.
- Duplicate group slug was allowed across owners:
  - second owner group ID: `e3dce2e0-3757-4b89-b6b7-0e3fd2ec643e`

Existing site regressions checked:

- Production `/data/manifest.json` returns `200`.
- Production `/data/v2/manifest.json` returns `200`.
- Production `/download` returns `302` to `/downloads/omgskills-mac.dmg`.
- Production `/downloads/omgskills-mac.dmg` returns `200`.
- Production `/appcast.xml` returns `200`.
- Production `/updates/omgskills-0.0.13.zip` returns `200`.
- Production `/health/` returns `401`.

Known gaps:

- Favorites uses the existing `is_favorites` schema path, but there is not yet a dedicated Favorites editor in the portal UI.
- The E2E used API checks and HTML response assertions, not browser screenshots.
- Handle-change redirects are intentionally not implemented.

Decision: Pass for public profile and public group URL MVP behavior. Follow-up for richer Favorites UX can happen in Milestone 3 or later.

## Milestone 3 Evidence

Date: 2026-06-23
Branch/commit: `codex/skillgroups-mvp`, uncommitted
Preview URL: `https://codex-skillgroups-mvp--omgskills.netlify.app`
Commands run:

- `npm run check`
- `npm run build:netlify`
- `npx -p node@20 node ./node_modules/netlify-cli/bin/run.js deploy --build --branch codex-skillgroups-mvp --context branch:codex-skillgroups-mvp --site dfdb618d-b748-4c4f-a535-646dc5db449f`
- Temporary Clerk dev-user E2E script against `https://codex-skillgroups-mvp--omgskills.netlify.app`

Manual flows checked:

- Portal My Skill Groups rows now include catalog search/add controls.
- Portal My Skill Groups rows now include GitHub skill URL add controls.
- Portal My Skill Groups rows now include export links.
- Portal My Skill Groups rows now include owner moderation disable controls.
- Temporary Clerk dev users were created for owner and copier, then deleted after verification.

DB/API evidence:

- Catalog search used hosted manifest data and returned `12` results for `summarize`.
- Catalog item add succeeded.
- GitHub skill URL validation accepted `https://github.com/anthropics/skills/blob/main/skills/pdf/SKILL.md`.
- GitHub validation rejected a non-GitHub URL.
- GitHub validation rejected a GitHub URL without valid `SKILL.md` frontmatter.
- Export JSON result:
  - type: `omgskills.skill_group`
  - version: `1`
  - item count: `3`
  - attachment filename header included `skillgroup-`
- Duplicate public group result:
  - source group ID: `b4087fd5-f048-4d1e-8c11-2eaeb573fc8c`
  - copied group ID: `8350c372-3cbe-4852-85a9-364513f4436f`
  - copied group visibility: private
  - copied group allowed email count: `0`
- Public group view rendered the synced skill and per-skill open redirect.
- Analytics events verified in DB:
  - `group_duplicate`
  - `group_export`
  - `public_group_view`
  - `skill_open`
- Disabled public group returned `404`.

Existing site regressions checked:

- Production `/data/manifest.json` returns `200`.
- Production `/data/v2/manifest.json` returns `200`.
- Production `/download` returns `302` to `/downloads/omgskills-mac.dmg`.
- Production `/downloads/omgskills-mac.dmg` returns `200`.
- Production `/appcast.xml` returns `200`.
- Production `/updates/omgskills-0.0.13.zip` returns `200`.
- Production `/health/` returns `401`.

Known gaps:

- Catalog search fetches the large hosted skills JSON directly and limits results in memory. This is acceptable for MVP but should be cached or indexed later if usage grows.
- Duplicate snapshots preserve current item references; richer immutable metadata snapshots can be added later if source synced skill deletion becomes a concern.
- Moderation is owner-facing disable/restore plumbing, not an admin review queue.
- Browser screenshot verification was not run; API and HTML assertions covered the gate.

Decision: Pass for full group management MVP behavior.

## DevOps And Access Requirements

Goal: make sure an independent agent can build and deploy the portal without breaking the existing website, hosted app data, Mac downloads, or Sparkle updates.

Current prepared state as of 2026-06-23:

- Netlify access is confirmed through the Netlify plugin.
- Netlify team:
  - name: `norm4l`
  - slug: `ops-gkpmtq8`
  - team ID: `69b433b3698e376022b312c3`
  - current role: Owner
- Netlify site:
  - name: `omgskills`
  - site ID: `dfdb618d-b748-4c4f-a535-646dc5db449f`
  - production URL: `https://omgskills.com`
  - domain alias: `https://app.omgskills.com`
  - current production deploy state: ready
- Netlify Database has been initialized for the site.
- `@netlify/database` is installed and DB helpers use its `getConnectionString()` API.
- Clerk setup status:
  - Google OAuth is enabled.
  - Organizations are disabled and should stay disabled for MVP.
  - Email sign-up/sign-in is enabled.
  - Email address is required.
  - Email verification at sign-up is enabled.
  - Custom Google OAuth credentials are disabled, which is acceptable for MVP.
  - Clerk development domain is currently used; production/custom domain setup can wait until production launch work.
  - Allowed redirect/origin URLs have not been added yet. Add/verify them during Milestone 0 after the portal runs.
- Preview health protection:
  - `HEALTH_BASIC_AUTH_PASSWORD`, context `deploy-preview`, scopes `builds`, `functions`, `runtime`
- Netlify Database status:
  - project `netlify-cli` must stay on `26.1.0` or newer; older `22.x` uses the retired Neon extension flow
  - `netlify database init --yes` recognizes the built-in Netlify Database flow
  - `netlify database status --branch codex/skillgroups-mvp` reports enabled with the preview DB branch
  - CLI deploys can create a branch URL, but they do not attach a `database_branch_id`; use Git-backed Netlify branch/deploy-preview builds for full deployed DB verification
  - current branch preview works by setting branch-only `NETLIFY_DB_URL`, `NETLIFY_DB_DRIVER`, and `CLERK_SECRET_KEY` in Netlify
  - slash branch names are sanitized in Netlify branch URLs (`codex/skillgroups-mvp` becomes `codex-skillgroups-mvp`)
- Netlify environment variables configured:
  - `VITE_CLERK_PUBLISHABLE_KEY`, context `all`, scopes `builds`, `functions`, `runtime`
  - `CLERK_SECRET_KEY`, context `production`, scopes `builds`, `functions`, `runtime`
  - `CLERK_SECRET_KEY`, context `deploy-preview`, scopes `builds`, `functions`, `runtime`
  - `HEALTH_BASIC_AUTH_PASSWORD`, context `production`, scopes `builds`, `functions`, `runtime`
- GitHub repo secrets confirmed:
  - `NETLIFY_AUTH_TOKEN`
  - `SCRAPER_GITHUB_TOKEN`
  - `ENABLE_X_SOCIAL`
  - `X_AUTH_TOKEN`
  - `X_CT0`
  - `HUMBLYTICS_API_KEY`
  - `TELEMETRYDECK_TOKEN`
- GitHub repo variables configured:
  - `NETLIFY_SITE_ID=dfdb618d-b748-4c4f-a535-646dc5db449f`
  - `VITE_CLERK_PUBLISHABLE_KEY`
- Do not add `CLERK_SECRET_KEY` to GitHub unless CI tests or GitHub-side backend work require it. Netlify runtime already has the secret.
- The current Clerk keys are development/test keys. Rotate them before a real production launch if they were shared during planning.

Required access:

- GitHub repo write access for code, workflows, and docs.
- Netlify site access for the existing `omgskills.com` production site.
- Netlify deploy token access via GitHub secret `NETLIFY_AUTH_TOKEN`.
- Netlify site ID access via GitHub variable `NETLIFY_SITE_ID`.
- Netlify Database enabled for the production site before DB work starts. This is already initialized.
- Clerk app access for Google OAuth setup and allowed redirect URL setup.
- Clerk environment values. These are already configured in Netlify:
  - `VITE_CLERK_PUBLISHABLE_KEY`
  - `CLERK_SECRET_KEY`
- Clerk CLI is available for implementation support:
  - run with `npx clerk`
  - use `clerk doctor` to check integration health once portal code exists
  - do not enable Clerk Organizations through the CLI for MVP
- Existing health secret preserved:
  - `HEALTH_BASIC_AUTH_PASSWORD`
- Mac release credentials are only needed when shipping a public app release:
  - `DEVELOPER_ID_APPLICATION`
  - `ASC_PRIVATE_KEY_PATH`
  - `ASC_KEY_ID`
  - `ASC_ISSUER_ID`

Deploy files that must be updated:

- `netlify.toml`
- `site/_redirects`
- `scripts/prepare-netlify-site-deploy.mjs`
- `scripts/deploy-site-prod.sh`
- `.github/workflows/scrape.yml`
- `.github/workflows/x-refresh.yml`
- `.github/workflows/content-reports.yml`
- `.github/workflows/pipeline-health.yml`

Current deploy risk:

- existing workflows deploy only `site/` with `npx netlify-cli deploy --prod --dir=site`
- existing workflows still hardcode the Netlify site ID instead of reading the new `NETLIFY_SITE_ID` repo variable
- portal build output, functions, and migrations will not deploy until the deploy directory/build pipeline is updated

Required deploy fix:

- introduce one combined deploy output directory, for example `dist/netlify-site/`
- copy existing `site/` contents into that directory
- build portal into an app subdirectory, for example `dist/netlify-site/app/`
- include Netlify Functions and `netlify/database/migrations/` in the Netlify deploy
- update every Netlify deploy command to deploy the combined output, not raw `site/`
- update workflows to read `${{ vars.NETLIFY_SITE_ID }}` instead of the hardcoded site ID
- keep `prepare-netlify-site-deploy.mjs` before every production deploy so ignored release assets are restored/verified

Production safety rules:

- never deploy production from a dirty worktree
- deploy previews first for portal/function/database changes
- verify `/data/crawl4/manifest.json`, `/data/v2/manifest.json`, `/data/manifest.json`, `/downloads/omgskills-mac.dmg`, `/appcast.xml`, and `/updates/*` after deploy
- do not delete or rewrite `site/downloads/` or `site/updates/`
- do not change Mac release flow unless intentionally shipping a signed app update
- do not commit secrets, `.env`, signing files, or local Netlify state

`deploy-site-prod.sh` must be updated to:

- dirty-check `portal/`, `netlify/functions/`, and `netlify/database/`
- build the combined deploy output
- run `prepare-netlify-site-deploy.mjs`
- deploy the combined output directory
- keep existing version tagging behavior for Mac releases

Workflow updates:

- every workflow that currently deploys `site/` must build or prepare the combined deploy output first
- every workflow must deploy the same output directory
- workflows must keep existing data publish and live manifest verification steps
- portal deploy changes must not remove the current `verify-live-manifest.mjs` checks

Preview verification checklist:

- `/data/manifest.json` returns the expected manifest
- `/data/crawl4/manifest.json` returns the crawl4 manifest
- `/data/v2/manifest.json` still works
- `/download` redirects to `/downloads/omgskills-mac.dmg`
- `/downloads/omgskills-mac.dmg` returns `200`
- `/appcast.xml` returns `200`
- `/health/` is still Basic Auth protected
- `app.omgskills.com` loads the portal
- direct portal navigation refresh works
- `/u/{handle}` public user profile behavior works
- `/u/{handle}/sets/{groupSlug}` public set behavior works
- `/library/{handle}/` generated creator behavior works
- `/profiles/{handle}` compatibility routing reaches the intended namespace
- Netlify Functions respond
- Drizzle migrations are present and applied in preview

Local setup checklist to document during implementation:

- How to install portal dependencies.
- How to run the portal locally.
- How to confirm Clerk sign-in locally.
- How to add or verify Clerk redirect/origin URLs when needed:
  - `http://localhost:5173`
  - `https://app.omgskills.com`
  - Netlify deploy preview URL once a preview exists
- How to run Netlify Functions locally.
- How local env vars are loaded without committing secrets.
- How to run Drizzle migrations locally.
- How to run portal tests.
- How to run macOS sync tests.
- How to produce a deploy preview before production.

Do not touch in the portal implementation unless the task explicitly requires it:

- scraper behavior under `index/`
- MCP package behavior under `mcp/`
- Mac signing/notarization scripts
- Sparkle appcast generation
- release asset naming
- public catalog JSON format

## Suggested Work Order

1. Reconfirm access state from this doc: Netlify site, Netlify DB, Clerk env vars, GitHub secrets, and GitHub variables.
2. Foundation deploy/routing, combined deploy output, DB/auth/function helpers.
3. Stage 1 sync token API.
4. macOS `SkillSyncService`, sync payload, and upload.
5. Synced Skills portal UI.
6. Restricted group creation from synced skills.
7. Email allowlist and Shared With Me.
8. Stage 1 test pass.
9. Preview deploy verification.
10. Public profile/group pages.
11. Favorites and selected profile groups.
12. Full group management features.

## Parallelization Notes

Milestone 0 should be mostly sequential because auth, DB, and function helpers become shared dependencies.

After Milestone 0:

- Lane A: macOS sync payload and upload.
- Lane B: portal Synced Skills UI.
- Lane C: sync token and sync run APIs.
- Lane D: deploy/routing checks, only after Milestone 0 config lands.

Merge those before group creation work.

After Stage 1:

- Lane A: public profile/group pages.
- Lane B: catalog/GitHub add flows.
- Lane C: export/duplicate/analytics.

Avoid parallel edits to shared schema/migrations unless one person owns migration ordering.
