# omgskills System Architecture

Validated 2026-07-17 against `origin/main`. Public Mac release state remains
separately gated by `finish.md` and `deploy.md`.

This document describes the durable system built across catalog admission,
identity resolution, editorial discovery, Editool, the macOS client, the web
library, and portal Skill Groups. It is the starting point for extending those
systems.

It is not a task tracker or deployment runbook:

- active cross-system work belongs in `finish.md`
- crawler internals and operator detail belong in `crawl.md`
- production and Mac release safety belongs in `deploy.md`
- security and trust policy belongs in `trust.md`

## System Model

omgskills has four distinct product layers and one cross-cutting identity layer:

1. **Catalog admission** decides which skills exist in the maintained library.
2. **Identity** maps installed files to catalog records and logical variants.
3. **Editorial** decides which catalog skills and creators are featured.
4. **Skill Groups** let users organize and share their own references to skills.
5. **Surfaces** present the same data through the Mac app, web library, and
   portal.

These layers must remain separate:

- manual curation can admit or remove catalog records
- editorial curation never changes whether a skill exists
- Skill Groups never become a second catalog
- identity adds relationships between records without merging or deleting them

```text
GitHub and discovery inputs
        |
        v
Crawl 4 admission and validation
        |
        v
catalog + hashed optional assets
        |
        +----------------+----------------+
        |                |                |
        v                v                v
    Mac app         web library       portal lookup
        |
        v
local identity resolution
        |
        v
device-authenticated metadata sync
        |
        v
portal inventory -> Skill Groups -> public /u pages

creators.json + collections.json
        |
        v
Editool or reviewed file edit
        |
        v
collections publisher -> Mac app + web library
```

## Core Invariants

These rules are compatibility boundaries:

- A catalog skill ID is the shared foreign key across every surface.
- Existing catalog IDs are not renamed, recycled, or collapsed.
- omgskills stores metadata and references, not hosted `SKILL.md` content.
- Unresolved and ambiguous identity are valid states. Never invent a mapping.
- Exact duplicate and logical-equivalence metadata is additive.
- Claude and Codex variants remain separate installable records.
- Optional manifest assets must not become required for core catalog loading.
- File-based editorial tools never commit, publish, or deploy automatically.
- Public editorial creators and portal users occupy different namespaces.
- User-facing groups preserve dead-reference snapshots instead of breaking.
- Catalog `quality_tier` and web `indexTier` are separate. Useful content, not
  catalog quality alone, determines whether a generated page is indexable.
- Production web deploys use the guarded combined `dist/netlify-site` artifact,
  never a partial `site/` artifact.

## Sources Of Truth

| Concern | Source of truth | Derived output |
|---|---|---|
| Current catalog | Crawl 4 validated output and promoted `index/skills.json` | Hashed `skills` assets |
| Manual catalog admission | Crawl 4 manual overlay managed by operator commands | Included catalog rows |
| Catalog exclusions | Suppression seed and `index/seeds/do-not-crawl.json` | Filtered Crawl 4 output |
| Creator registry | `index/seeds/creators.json` | Watch lane, reservations, author collections |
| Editorial copy and topic lists | `index/curations/collections.json` | Hashed `collections` asset |
| Exact identity history | Published SHA-history asset | Client SHA lookups |
| Logical variants | Reviewed skill-equivalence policy and overrides | Optional `skillEquivalence` asset |
| Public catalog skill URLs | Web-library page generation | `catalog-skill-urls.json` |
| Portal users and groups | Postgres migrations and portal APIs | `/u/*` pages and portal UI |
| Production release procedure | `deploy.md` and release scripts | Combined Netlify artifact and Mac assets |

Generated assets are not authoring surfaces. Do not hand-edit `skills.json`,
hashed data assets, manifests, static library pages, or portal database rows to
perform normal curation.

## Public Namespaces

The canonical routes are:

| Route | Owner |
|---|---|
| `/app/` | Authenticated portal |
| `/library/{handle}/` | Static editorial creator profile |
| `/skills/{owner}/{repo}/{skill-path}/` | Static catalog skill page |
| `/collections/{id}/` | Static editorial topic collection |
| `/u/{handle}` | Database-backed portal user profile |
| `/u/{handle}/sets/{slug}` | Database-backed public Skill Group |

Compatibility routes may continue to resolve, but they are redirect-only and
new UI must emit canonical URLs:

- `/profiles/{handle}` resolves a known editorial creator to `/library/` and
  otherwise resolves the portal user namespace
- `/u/{handle}/{slug}` and `/profiles/{handle}/sets/{slug}` are legacy group
  routes
- `/creators/*` is removed and has no compatibility redirect

Profile-handle reservations and group-slug reservations are independent:

- profile handles protect product identities and watched creator handles/aliases
- group slugs reserve structural names such as `sets` and the app-owned
  `favorites`
- a top-level site route is not automatically a reserved portal handle

## Catalog Admission And Manual Curation

Normal discovery and manual admission both feed Crawl 4. They share the same
parsing, provenance, suppression, and cutover validation.

Manual curation is an operator path for intentionally adding or removing
specific material without running full discovery.

### Add a skill

```bash
cd index
npm run crawl4:add-skill -- <github-skill-md-url>
```

The command:

- fetches the exact linked `SKILL.md`
- extracts repository and skill metadata
- updates the Crawl 4 manual overlay
- reports added, skipped, and failed records
- does not hand-edit production `skills.json`

Repository and folder URLs must first be resolved into exact `SKILL.md` blob
URLs. Manual admission may bypass discovery and popularity thresholds, but it
cannot bypass:

- valid `SKILL.md` parsing
- a clean repository/path fetch
- catalog/repackaged provenance exclusion
- suppression and do-not-crawl policy
- cutover validation

### Remove a repository

```bash
cd index
npm run crawl4:remove-repo -- owner/repo
```

Removal:

- removes matching records from maintained Crawl 4 output
- removes matching overlay/index state
- records the repository in `do-not-crawl.json`
- prevents rediscovery from immediately re-adding it
- leaves production publication as a separate operator action

Use `crawl.md` for the complete crawl lifecycle and validation commands.

## Identity Contracts

Identity has four independent concepts:

| Concept | Meaning |
|---|---|
| File identity | Exact `SKILL.md` bytes, represented by Git blob SHA-1 |
| Catalog identity | One specific catalog row and source path |
| Location identity | One installation location across repeated syncs |
| Logical identity | One skill concept spanning Claude/Codex variants |

Do not substitute one identity for another.

### Hash contract

`skill_md_sha` is the lowercase 40-character Git blob SHA-1 of the exact file
bytes:

```text
SHA1("blob " + byteLength + NUL + rawBytes)
```

There is no newline, Unicode, frontmatter, whitespace, or Markdown
normalization. The hash identifies one file version; it does not prove
authorship or logical equivalence.

### Client resolution ladder

The Mac client resolves installed skills locally, strongest signal first:

1. **Install provenance** - omgskills-installed skills retain their catalog ID.
2. **Git inspection** - resolve repository plus path relative to the Git root.
3. **Content SHA** - resolve against published current and historical SHA data.
4. **Unresolved** - a valid local-only terminal state.

Git rules:

- `.` represents a skill installed at the repository root
- exact repository/path matching wins
- repository/frontmatter-name matching resolves only when unique
- path comparison is case-insensitive while preserving leading-dot paths
- ambiguous Git candidates may constrain SHA resolution, but never force a guess
- a Git miss leaves SHA free to recover renamed repositories

Identity status is one of:

- `resolved`: requires a live `catalogSkillId`
- `ambiguous`: has no catalog ID but may become resolvable later
- `localOnly`: has no catalog ID and is genuinely local

The server validates these combinations and derives the legacy
`isLocalOnly` value from the status boundary.

Resolution emits aggregate counts for total installed skills, provenance, Git,
SHA, ambiguous, and local-only outcomes. These measurements guide later identity
work; they never change resolution behavior.

### SHA history and canonical attribution

The SHA-history asset keeps full membership:

```text
shaToSkillIds: sha -> [catalog skill IDs]
```

Membership is append-only. One ID resolves exactly; multiple IDs remain
ambiguous.

Canonical attribution is an optional additive annotation:

```text
canonicalBySha?: sha -> {
  skillId,
  confidence,
  reason
}
```

The client accepts a canonical entry only when it is live, belongs to the SHA
membership, matches the local candidate constraints, and uses a supported
confidence policy. Invalid annotations fail closed to ambiguity.

`SHA_CANONICAL_PUBLISH=1` enables canonical emission. Unset preserves the
membership-only asset and acts as the rollback switch.

### Location identity and sync stability

Modern synced installations use:

```text
location:v1:{normalized source}:{installation folder}
```

`stableKey` identifies the same installation across repeated syncs. It must not
be derived from content SHA because content changes when a skill updates.

Every successful upload creates a sync run. Current rows are upserted by
`user + stableKey`; rows missing from a completed run become non-current. A
failed run never retires the prior inventory.

Portal sync consumes the Mac store's completed, already-resolved installation
snapshot. The network layer does not rescan the filesystem or resolve identity.
An uninitialized scan is distinct from a completed empty scan so startup cannot
retire valid portal rows accidentally.

### Install provenance

omgskills-owned installs and local cross-installs share one provenance store.
Each installation root owns its own metadata:

```text
{installation root}/.omgskills/{installation name}.json
```

The store is the shared path, read, write, and removal contract:

- write provenance atomically only for a resolved source with a catalog ID
- ambiguous and local-only sources never receive catalog provenance
- create the metadata directory when needed
- local cross-installs remove their new symlink if provenance writing fails
- scanners read provenance but never sweep orphaned metadata

App-initiated uninstall owns the removal lifecycle:

- validate that the installation path is under an allowed Claude, Codex, or
  Agents root
- remove symlinks directly and move physical directories to Trash
- only after deletion succeeds and `SKILL.md` is absent, remove the matching
  root-local provenance file
- never remove same-named metadata from another installation root
- preserve metadata when the installation is still live or deletion fails
- leave manually orphaned metadata untouched; do not infer ownership from a
  missing folder during background scanning

If the skill is removed but metadata cleanup fails, the uninstall remains
successful and the client reports a cleanup warning.

This preserves exact catalog identity without converting uncertain local
matches into global mappings.

### Logical Claude/Codex equivalence

Logical grouping never merges catalog rows or installation records.

Catalog-backed equivalence is computed once during publishing and distributed as
an optional side asset:

```text
{
  version,
  generatedAt,
  groups: [{
    id,
    memberSkillIds,
    representativeSkillId,
    preferredSkillIds: {
      claude?,
      codex?
    },
    confidence,
    evidence
  }]
}
```

V1 invariants:

- every member exists in suppression-filtered output
- every group has two unique, code-point-sorted IDs
- group ID is SHA-256 of the newline-joined member IDs
- representative and preferred IDs belong to the group
- members come from one concrete repository, share an exact normalized name,
  satisfy the reviewed agent-path/description policy, and have different SHAs
- groups do not overlap
- stale client members are filtered; groups below two live members dissolve
- same-SHA duplicates remain owned by SHA/canonical identity

Neutral-path approve/reject decisions live in the committed equivalence
overrides file. Regeneration consumes those decisions so reviewed pairs do not
re-enter the manual queue.

Publication is tri-state:

- unset: no manifest write
- `1`: publish
- `0` or `remove`: remove the manifest entry while retaining rollback files

The Mac installed **All** list and its counter use logical groups. Claude, Codex,
Other, and source-specific views remain physical. Merged rows retain each
installation and action. Equivalence and same-catalog grouping compose into one
logical row; search considers every member; and selection remains stable when a
group merges, splits, or loses a member. The asset representative wins when it
is installed, otherwise clients use the shared deterministic fallback.

### Local-only equivalence

Catalog-wide grouping must not use fuzzy name/description matching. For the
small set of one user's unresolved installations, the portal and Mac client use
the same local rule:

1. Lowercase names/descriptions, collapse whitespace, and trim.
2. Require exact normalized name equality.
3. Merge when non-empty GitHub URLs match, or descriptions match.
4. Description matching checks:
   - exact normalized equality
   - containment when the shorter text is at least 35 characters
   - deduplicated word overlap after dropping words of two characters or fewer
5. Require overlap `0.80` for 3-4 words, reject below 3 words, and require `0.72`
   for 5 or more words.
6. Prefer the installed asset representative when available, otherwise Codex,
   then a GitHub-backed member, then stable source order.
7. Use the longest description and preserve every physical member.

This heuristic is safe only within one user's installation set.

## Published Data And Optional Assets

The Mac client follows the selected catalog track and keeps track-specific
caches. Crawl 4 is preferred with v2 fallback where configured.

Core manifests reference hashed assets by path, SHA-256, and byte count.
Important optional assets include:

- `collections`
- `shaHistory`
- `skillEquivalence`
- X/trending and signal assets where supported by that track

Rules for optional assets:

- absence must not break core skills bootstrap
- fetch/decode failure must fail closed to the feature's empty state
- an optional asset must be paired with the catalog track that loaded
- a successfully validated manifest omission clears that track's stale cache
- a failed manifest request is not evidence of omission
- publishers patch and preserve foreign manifest fields
- current and prior hashed files should be retained where rollback requires it

When adding a new optional asset, implement all of:

1. producer and schema validation
2. hashed immutable file publication
3. manifest patch/preservation behavior
4. per-track client cache and metadata
5. omission and failure semantics
6. bundled fallback only where explicitly intended
7. old-manifest compatibility tests
8. artifact pruning and rollback retention

## Editorial Discovery

Editorial discovery changes presentation, not catalog membership.

It is driven by two tracked files:

- `index/seeds/creators.json`
- `index/curations/collections.json`

### Creator registry

Creator entries are matched case-insensitively and through aliases.

- `watch: true` enables the separately flag-gated creator-watch crawl lane
- `featured: true` publishes an editorial creator profile
- featured creators must also be watched
- aliases map alternate catalog handles to one registry owner

Default profile data is derived from the catalog:

- GitHub avatar
- skills by matched author handle/alias
- top skills by current ranking when no override exists
- leaderboard statistics where available

Optional author overrides provide:

- subtitle
- description
- image URL
- pinned featured skill IDs

### Topic collections

Topic collections are explicitly curated ordered lists. Their IDs become stable
public URL slugs.

Required fields:

- `id`
- `type: "topic"`
- `title`
- `subtitle`
- `featuredSkillIds`
- `skillIds`

Optional fields:

- `description`
- `imageUrl`

Copy should be factual and short:

- subtitles are one phrase without hype
- descriptions are one to three sentences
- lead with what the creator or collection helps the user do
- avoid generic promotional language

### Publishing

```bash
cd index
npm run publish:collections
```

The publisher:

1. reads collections, creators, and the current catalog
2. validates featured/watch relationships, aliases, and skill references
3. expands featured creators into normalized author collections
4. writes one hashed collections asset
5. publishes identical asset metadata to v2 and Crawl 4 manifests

The asset feeds both:

- Mac collection/profile views
- static `/library/` and `/collections/` pages

Clients skip stale skill references rather than failing the page. Publishers and
web generation should still report or reject invalid authoring data before
publication.

When equivalent variants are featured, keep the original/upstream catalog ID.
Display grouping is a consumer concern; editorial data must not duplicate every
variant.

## Editool

Editool is a local file editor with a library browser. It is convenience, not a
new data store or publishing gate.

Run:

```bash
cd index
npm run editool
```

The server is localhost-only and uses a startup token for write requests.
Non-local origins are rejected.

### Read boundary

Editool reads:

- current or shadow catalog rows
- author leaderboards and quality metadata
- collections
- creator registry
- proposed creator reports
- suppressed skills and do-not-crawl seeds

### Write boundary

Editool writes only:

- `index/curations/collections.json`
- `index/seeds/creators.json`
- the suppressed-skills seed
- `index/seeds/do-not-crawl.json`

Writes are atomic and validated. Editool never writes catalog output, shadow
output, manifests, generated pages, or database state.

Validation includes:

- referenced skill IDs exist
- new suppression IDs exist in the loaded library
- historical suppression entries remain valid after removal
- featured creators are watched and resolve by handle or alias
- aliases have one owner
- collection IDs are unique kebab-case
- do-not-crawl targets and required reasons are valid

### Preview and publish boundary

Editool can build an isolated local web preview:

- source files must be saved first
- publishing and static generation run in an OS temporary directory
- generated profile and collection pages are verified
- preview assets do not modify `site/data`
- the preview server is read-only

After an Editool save:

1. review `git diff`
2. run relevant validation/typecheck
3. publish explicitly
4. review generated manifest changes
5. commit intentionally

Editool never commits, pushes, deploys, or publishes automatically.

## Portal And Skill Groups

The portal uses React/Vite under `/app/`, Netlify Functions, Postgres, and Clerk
Google authentication.

The portal owns:

- user profile settings
- synced installation inventories
- Skill Groups and Favorites
- restricted-group email access
- public user/group pages
- device connection management

The Mac app remains independently usable without a portal account.

### Authentication boundaries

- Clerk authenticates portal users.
- The Mac app never receives a Clerk session.
- Browser/manual pairing exchanges a short-lived, one-use code for a durable
  device credential.
- Device credentials are stored in Keychain and are scoped to sync/revoke
  endpoints.
- Device credentials cannot mutate profiles, groups, users, or Clerk settings.
- Legacy one-time upload remains a temporary compatibility path until an
  explicitly measured retirement.

### Core data model

The database contains:

- `users`
- `skill_groups`
- `skill_group_items`
- `skill_group_allowed_emails`
- `skill_group_copies`
- `sync_runs`
- `synced_skills`
- `sync_tokens`
- `device_tokens`
- `analytics_events`

Schema migrations are authoritative. Documentation should describe behavior,
not duplicate every column.

### Group and profile access

Group visibility:

- `private`: owner only
- `restricted`: owner plus exact allowed emails
- `public`: available without login

Favorites is a special owner group with a reserved slug. Other group slugs are
unique per owner.

Public behavior:

- unpublished known profiles return a generic private response
- unknown handles return `404`
- disabled groups/profiles return `404`
- unauthorized restricted access does not reveal group or owner details
- public analytics avoid personal viewer identity

### Group items

A group item is one of:

- `synced`
- `catalog`
- `github`

Items store references, notes, position, and a small name/description snapshot.
They never store private skill content.

Rendering priority:

1. current synced/catalog metadata
2. stored snapshot
3. identifier fallback

The static web builder derives one collision-aware
`catalogSkillId -> publicPath` map from the exact skill pages generated in that
build and publishes it as `catalog-skill-urls.json`. Public Skill Group pages
consume that asset rather than reconstructing paths. A catalog or synced item
links to its generated static page when present, otherwise to a validated GitHub
URL, otherwise it remains metadata-only. Local-only items are always
metadata-only.

When a GitHub item is added, the portal validates and hashes the referenced
`SKILL.md` using the shared Git blob SHA contract. It stores a catalog item when
the published SHA identity data yields one live skill or a valid high-confidence
same-repository canonical skill. Missing, stale, invalid, or ambiguous identity
stays a GitHub item. The validated name and description snapshot is preserved
in either case.

Catalog enrichment is bounded and non-blocking. If published catalog identity
cannot be loaded promptly, a successfully validated GitHub item is still
stored as a GitHub reference.

When a reference is stale, render the snapshot without an install action.
Local-only synced skills are metadata-only for other viewers.

Duplicate/export operations preserve ordering and notes but do not copy access
rules or create a live relationship to the source group.

## Surface Responsibilities

### Mac app

- loads catalog and optional assets
- scans local Claude, Codex, and Agents installations
- resolves identity locally
- presents logical installed rows without losing physical actions
- uploads resolved metadata through the device credential
- renders editorial collections and creator profiles

### Web library

- generates static creator, collection, and skill pages
- uses canonical catalog IDs and editorial data
- publishes the exact generated catalog-skill URL map for portal consumers
- derives profile-link eligibility from the exact case- and alias-aware profile
  page queue generated in that build
- falls back to GitHub attribution when no profile page was generated
- owns sitemap, canonical metadata, and internal-link correctness
- rejects generated links to redirect-only namespaces such as `/profiles/*`
- never reads portal-user data to build editorial creator pages

### Portal

- manages user-owned data and access
- consumes catalog IDs but does not run a competing identity resolver
- presents synced inventory and Skill Groups
- serves database-backed `/u/*` pages

### Publishers

- validate source files
- derive hashed immutable assets
- patch manifests without dropping foreign fields
- keep data-track outputs compatible
- never turn task or preview output into production implicitly

## Extending The System

### Add a new catalog-admission path

- feed Crawl 4 inputs or overlays
- preserve parser, provenance, suppression, and cutover validation
- do not write production catalog output directly
- document whether the path may bypass discovery thresholds

### Add a new editorial concept

- keep catalog rows unchanged
- use stable catalog IDs
- author in tracked source JSON
- validate references before publication
- define behavior for stale references
- support both Mac and web consumers or state the intended surface explicitly

### Add a new identity signal

- place it in the resolution ladder according to confidence
- define ambiguity behavior
- keep resolution client-side where possible
- preserve unresolved as valid
- avoid changing existing IDs or SHA membership
- add sync compatibility only when the server needs the metadata

### Add a new logical grouping

- publish deterministic membership once
- preserve physical records and actions
- define representative and stale-member rules
- reject overlaps and weak matches
- make omission degrade to separate rows

### Extend Skill Groups

- keep user data in the portal database
- store references and snapshots, not skill content
- use catalog IDs for catalog-backed behavior
- maintain generic unauthorized responses
- preserve visibility and ownership checks in server functions
- add migrations rather than mutating production schema manually

### Extend Editool

- edit an existing source-of-truth file
- reuse the publisher's validation contract
- write atomically
- keep localhost/token protection
- keep preview data isolated
- do not add commit, publish, deploy, or production database powers

## Verification Map

Run checks for the boundaries changed.

Catalog and Crawl 4:

```bash
cd index
npm run typecheck
npm run test:shadow-guard
```

Editorial and Editool:

```bash
cd index
npm run test:editool
npm run publish:collections
```

`publish:collections` changes generated data files. Run it only when validating
an intentional editorial source change.

Mac client:

```bash
cd menubar
swift test
swift build -c release
```

Portal and functions:

```bash
npm test
```

Static web library:

```bash
node scripts/build-web-library.mjs
node scripts/verify-web-library-pages.mjs
node scripts/prepare-netlify-site-deploy.mjs
```

Do not deploy merely to validate architecture work. Use `deploy.md` only when a
production or public Mac release has been explicitly approved.

## Historical Sources

This document consolidates the durable contracts currently spread across:

- `archive/skillgroup.md`
- `archive/skillgroup-implementation.md`
- `archive/editorial.md`
- `archive/identity.md`
- `archive/editool.md`
- `archive/curated.md`
- `archive/new-auth.md`
- `archive/next.md`

`archive/tiein.md` preserves the completed integration history. The archived
authentication and implementation plans preserve their respective delivery
history. These documents are reference material, not active sources of truth.
