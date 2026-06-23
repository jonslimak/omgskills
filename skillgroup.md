# Skill Groups MVP

## Goal

Let users share curated sets of skills with themselves, selected people, or the public.

The MVP should live mostly in an independent web portal so the macOS app can stay simple.

## Core Terms

### Skill Group

A named list of skills.

Owned by either:

- a user
- later, a team

Visibility:

- `private`: owner only
- `restricted`: owner plus allowed emails
- `public`: anyone with the URL

### My Skills

UX label for personal Skill Groups.

### Team Skills

UX label for shared Skill Groups used by a team.

For MVP, this is group-level sharing by email allowlist. A heavier Team model can come later.

### Favorites

A special personal Skill Group.

It powers the user's public profile favorites.

### Public Profile

A user-published page showing selected public groups and favorite skills.

Default is private. User must choose a handle and publish it.

The profile shows only groups the user explicitly selects.

Handles can be changed, but there are no redirects in MVP. The UI should warn that old links will break.

URL:

```text
omgskills.com/u/{handle}
```

### Public Skill Group Page

A public view of one Skill Group.

URL:

```text
omgskills.com/u/{handle}/{groupSlug}
```

Group slugs are unique per owner in the MVP.

Group names are not unique.

Group slugs can be changed, but there are no redirects in MVP. The UI should warn that old links will break.

## MVP Scope

Build the MVP in two stages.

### Stage 1: Sync And One Shared Group

This stage proves the core loop:

```text
local app skills -> web portal -> shared group -> teammate can view
```

Build:

- Google sign-in
- app sync uploads installed skill metadata to the portal
- portal shows Synced Skills
- user creates one Skill Group from synced skills
- owner adds allowed emails
- allowed user signs in and views the group

Defer from Stage 1:

- public group pages
- duplicate/fork
- analytics
- export JSON
- GitHub URL validation
- custom GitHub skill add
- directories/search
- profile polish

### Stage 2: Public Sharing And Full Group Management

Build after Stage 1 works:

- public Skill Group pages
- public profiles
- Favorites group
- custom public GitHub skill URLs
- export JSON
- duplicate public group to My Skills
- analytics
- moderation flags
- profile selected groups
- richer group management

## Full MVP Scope

Users can:

- sign in with Google OAuth
- sync installed skills from the macOS app
- view Synced Skills in the portal
- create and edit personal Skill Groups
- add catalog skills to a group
- add public GitHub skill URLs to a group
- add allowed emails to a restricted group
- view groups shared with their Google email
- publish a group publicly
- publish a public profile
- manage Favorites as a special Skill Group
- duplicate a public Skill Group into My Skills

Viewers can:

- open public group URLs without login
- sign in to view restricted groups shared with their email
- see group name, description, optional owner display name, and skill list
- see item notes when the group is public
- copy/export group skill URLs
- install/open individual skills

## Not In MVP

- private hosted skill files
- copying local skills from one teammate's device to another
- team-wide roles or org hierarchy
- billing
- SSO
- password login
- one-click install-all
- macOS app login
- bidirectional app/web sync
- portal-to-app install sync
- public group directory
- public profile directory
- profile/group search
- domain-wide sharing like `@company.com`
- full version history
- team/company branding

## App Sync

The simplest sync is app-to-portal installed skill inventory sync.

Flow:

1. User signs in on `app.omgskills.com`.
2. Portal shows "Sync omgskills app".
3. Portal creates a short-lived sync token.
4. User clicks Sync in the macOS app and enters/pastes the token, or opens `omgskills://sync?token=...`.
5. The app uploads installed skill metadata with the token.
6. Server maps the upload to the signed-in portal user.
7. Portal shows Synced Skills.
8. User creates a Skill Group from Synced Skills.

Sync token rules:

- expires after about 10 minutes
- one use only
- scoped only to uploading installed skill inventory
- does not grant account access to the macOS app

Upload metadata only:

- skill name
- description
- catalog skill id if matched
- GitHub URL if known
- local-only flag
- source: Claude, Codex, or Agents

Do not upload `SKILL.md` file contents in MVP.

This should feel like syncing the app with the web portal, not importing a group.

## Skill Group Items

Each group item is either:

```text
syncedSkillId
```

or:

```text
catalogSkillId
```

or:

```text
githubUrl
```

The MVP stores references only. It does not store private skill content.

This keeps the model ready for custom/team skills without building private hosting too early.

Stage 1 primarily uses `syncedSkillId` so users can build groups from installed app skills.

For local-only synced skills, shared viewers see metadata only. They do not get an install action because the portal does not have the skill content.

GitHub skill URLs must be validated before saving:

- URL is GitHub
- repo exists
- `SKILL.md` exists at root or provided path
- frontmatter has `name` and `description`

Each group item can have:

- `note`
- `position`

Notes are public when the group is public.

## Auth

Use Clerk with Google OAuth for MVP.

Email from Google login is the access key for restricted groups.

Use Clerk because it gives cleaner React/Vite auth, straightforward Google OAuth, server-side JWT verification in Netlify Functions, and a better future path for teams/orgs.

## Access Model

Owner:

- can view/edit/delete the group
- can change visibility
- can add/remove allowed emails

Allowed email user:

- can view the restricted group
- cannot edit in MVP
- sees allowed groups in "Shared with me"

Public viewer:

- can view public groups without login

Restricted group links can be shared directly. Unauthorized users see a generic not-found/no-access page that does not reveal group name or owner.

Private profiles return `200` with a generic "This profile is private" page. Unknown handles return `404`. This prevents handle enumeration through status codes.

Allowed emails are exact emails only. No domain-based sharing in MVP.

## Suggested Architecture

Add a separate web portal app:

```text
portal/
```

Portal URL:

```text
app.omgskills.com
```

Deployment boundary:

- use one Netlify project for the MVP
- configure `app.omgskills.com` as a domain alias for the portal
- serve `omgskills.com/u/*` profile and group pages from the same deploy
- use the same database, functions, and Clerk configuration
- only split into separate Netlify projects later if deployment boundaries become painful

Recommended stack:

- React/Vite portal app
- Netlify Functions for API routes
- Netlify Database/Postgres for storage
- Clerk with Google OAuth for login
- Drizzle ORM + Drizzle Kit for schema and migrations
- `@netlify/database` with `drizzle-orm/netlify-db` for database access
- existing hosted `site/data/manifest.json` for catalog skill lookup

The portal owns:

- users
- profiles
- skill groups
- allowed emails
- public URLs
- synced skill inventories

The existing macOS app remains independent for MVP.

Stage 1 still includes a minimal app-to-portal inventory sync. "Independent" means the app does not need full web login, group management, or bidirectional syncing.

Why this stack:

- the current site already deploys to Netlify
- the repo already uses Node scripts and Netlify Edge Functions
- this avoids a Next.js migration
- the public catalog already exists as hosted JSON
- the macOS app only needs one narrow upload flow for MVP

Public pages:

- `/u/{handle}/{groupSlug}` can be served by a Netlify Function returning HTML
- `/u/{handle}` can be served by a Netlify Function returning HTML
- public sharing stays on `omgskills.com`

App pages:

- `app.omgskills.com` is served by the React/Vite portal
- portal API calls go through Netlify Functions
- add SPA fallback routing so direct navigation in the portal works:

```text
/*    /index.html    200
```

Function helpers:

- central `requireAuth(req)` helper validates Clerk bearer tokens server-side
- central CORS helper allows `https://app.omgskills.com`
- every outbound HTTP call uses an explicit timeout

Catalog lookup:

- read `https://omgskills.com/data/manifest.json`
- fetch the current `skills` JSON from that manifest
- do not import catalog skills into the portal DB in MVP
- Stage 1 does not require catalog lookup for the core flow
- catalog matching is best-effort enrichment only
- failed catalog lookup must not block sync or group sharing

Build boundary:

- build `portal/`
- build Netlify Functions/API
- add DB schema and Drizzle Kit migrations under `netlify/database/migrations/`
- add public HTML handlers for `/u/*`
- add minimal macOS app sync button and upload call

Do not change in MVP:

- scraper
- MCP package
- existing catalog generation

## Data Model Draft

### users

- `id`
- `clerkUserId`
- `email`
- `displayName`
- `handle`
- `handleUpdatedAt`
- `profilePublished`
- `createdAt`
- `updatedAt`

Handle rules:

- user handles are unique
- default handles are random, not sequential
- reserved handles are blocked
- minimum reserved list: `u`, `g`, `data`, `health`, `admin`, `api`, `auth`, `sync`, `shared`, `profile`, `groups`, `skills`, `catalog`

### skill_groups

- `id`
- `ownerUserId`
- `name`
- `description`
- `slug`
- `visibility`
- `isFavorites`
- `showOwnerName`
- `disabledAt`
- `createdAt`
- `updatedAt`

Group slug rules:

- `UNIQUE(ownerUserId, slug)`
- reserved slugs are blocked using the same blocklist as handles

### skill_group_items

- `id`
- `groupId`
- `kind`: `synced`, `catalog`, or `github`
- `syncedSkillId`
- `catalogSkillId`
- `githubUrl`
- `note`
- `position`
- `createdAt`

### skill_group_copies

- `id`
- `newGroupId`
- `sourceGroupId`
- `sourceOwnerHandle`
- `sourceGroupSlug`
- `sourceOwnerDisplayName`
- `copiedAt`

### skill_group_allowed_emails

- `id`
- `groupId`
- `email`
- `createdAt`

### synced_skills

- `id`
- `userId`
- `syncRunId`
- `stableKey`
- `name`
- `description`
- `catalogSkillId`
- `githubUrl`
- `isLocalOnly`
- `source`
- `isCurrent`
- `lastSeenAt`
- `createdAt`

### sync_runs

- `id`
- `userId`
- `status`: `started`, `completed`, or `failed`
- `startedAt`
- `completedAt`

Repeat sync behavior:

- each upload creates one `sync_runs` row
- each synced skill stores the latest `syncRunId`
- after a successful sync, skills missing from the new run become `isCurrent = false`
- the portal hides non-current skills by default
- failed syncs do not mark old skills as missing
- `stableKey` dedupes the same installed skill across repeat syncs

### analytics_events

- `id`
- `eventName`
- `groupId`
- `profileUserId`
- `skillItemId`
- `createdAt`

No personal viewer tracking in MVP.

## Routes

Public:

- `/u/{handle}`: public user profile
- `/u/{handle}/{groupSlug}`: public Skill Group page

Authed:

- `app.omgskills.com`: dashboard
- `app.omgskills.com/groups`: My Skills
- `app.omgskills.com/groups/new`: create group
- `app.omgskills.com/groups/{id}`: edit group
- `app.omgskills.com/shared`: groups shared with my email
- `app.omgskills.com/profile`: public profile settings

## Install UX

MVP actions:

- per-skill install/open action
- copy skill URLs
- export group JSON
- duplicate public group to My Skills

No install-all in MVP. It is risky because skills can change agent behavior.

Export format:

```json
{
  "type": "omgskills.skill_group",
  "version": 1,
  "exported_at": "2026-06-22T00:00:00.000Z",
  "group": { "name": "Design Skills", "owner": "jon" },
  "skills": [
    {
      "kind": "catalog",
      "catalogSkillId": "owner/repo:name",
      "position": 1,
      "note": "Use for visual QA.",
      "name": "DHH Rails Style",
      "description": "Rails code review in DHH's voice",
      "stars": 1200,
      "github_url": "https://github.com/owner/repo"
    }
  ]
}
```

Export responses use:

```text
Content-Disposition: attachment; filename="skillgroup-{slug}-{date}.json"
```

Import behavior:

- preserve item order
- strip source visibility
- importing user chooses new visibility

Duplicate behavior:

- copies references and notes
- records original attribution
- does not copy access rules
- does not keep sync with original

## Moderation And Deletion

MVP deletion:

- owner can delete Skill Groups
- owner can unpublish profile
- account deletion is manual/admin

MVP moderation:

- no public admin dashboard
- add `disabledAt` DB fields where needed
- disabled groups/profiles return 404

## Analytics

Track:

- public group/profile page views
- copy/export clicks
- per-skill open/install clicks

Do not track personal viewer identity in MVP.

## Risks

- Public GitHub skill URLs may be invalid or move.
- Restricted access by email is simple but depends on trusted Google email identity.
- Owner-scoped group URLs require joining users and skill groups for public page resolution.
- Private team skills are a major future use case and need versioning/review before hosting.
- Changing group slugs or profile handles breaks old links because MVP has no redirects.
- Share-by-link public pages need moderation eventually.

## Verification Plan

### Stage 1 Verification

- create a user with Google OAuth
- verify Clerk-authenticated API calls
- create a short-lived sync token
- sync installed skills from the macOS app
- confirm synced skills appear in the portal
- repeat sync and confirm stale skills are hidden
- create a restricted group from synced skills
- add allowed email to the group
- confirm restricted group blocks wrong email
- confirm restricted group opens for allowed email
- confirm unauthorized restricted group does not reveal group name or owner
- confirm local-only synced skills show metadata but no install action
- run portal API/UI tests
- run app sync tests

Stage 1 test matrix:

```text
CODE PATH COVERAGE
==================
[+] App sync scanner -> upload payload
    ├── valid installed skill
    ├── symlinked installed skill
    ├── local-only skill
    ├── duplicate skill across Claude/Codex
    └── malformed SKILL.md skipped

[+] Sync token API
    ├── create token for signed-in user
    ├── reject expired token
    ├── reject reused token
    ├── reject wrong/unknown token
    └── successful upload creates sync_run

[+] Shared group access
    ├── owner can view/edit
    ├── allowed email can view
    ├── wrong email gets generic no-access
    └── logged-out user blocked

USER FLOW COVERAGE
==================
[+] Sign in -> sync app -> see Synced Skills
[+] Create group from synced skill -> add email -> teammate views
[+] Repeat sync -> removed local skill hidden
```

### Stage 2 Verification

- create private, restricted, and public groups
- add catalog and GitHub URL items
- confirm public group opens logged out
- publish profile and confirm `/u/{handle}` works
- confirm public group URL works at `/u/{handle}/{groupSlug}`
- confirm private profile returns generic `200`
- confirm Favorites appears on public profile only after publishing
- confirm profile shows only selected public groups
- validate GitHub URL before saving
- duplicate public group and confirm snapshot copy
- export group JSON and confirm version/type fields
- confirm analytics events for public views/copy/export/open actions
- run app tests and route checks

## Open Questions

1. Should drag-and-drop ordering ship in Stage 2 or later?
2. Should handle redirects ship with public profiles or wait until after launch?
