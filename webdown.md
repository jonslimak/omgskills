# webdown — web-first + MCP direction

Drafted 2026-09-29. Proposal, not an approved plan. Complements `local.md` / `local-task.md`;
where this conflicts with their sequencing, it needs an explicit decision recorded there.

## Why

- Paid acquisition doesn't pencil out: ~$105 per first launch, ~11.5% still active after 30 days.
- ~91% of ad clicks came from phones and Windows. Those visitors could not use a Mac-only app.
- The parts that are working are web and agent-facing: the web library's search rankings
  are climbing, agents call the catalog and `/mcp` unprompted, and the redesigned `/app/`
  plus web Sets have been live since 2026-09-25.
- Skill management (Sets, sharing, updates) is the idea that hasn't been tested yet.

## Direction

1. **Web is the product surface.** Discovery, Sets, sharing, and admin live at
   omgskills.com and `/app/`. That covers Windows and Linux users, plus mobile for discovery.
2. **The agent, not the app, does installation.** A website can't write files into
   `~/.claude/skills`, but the user's agent can. MCP tools become the install and update
   path, which works on every OS and in every agent.
3. **The Mac app shrinks to an optional sync agent.** Its future role is keeping each
   machine in line with the user's Sets automatically (see Opportunity 3), not discovery.
4. **No mobile admin.** Nobody manages coding agents from a phone. Mobile is for discovery only.

## Stop / pause

- Pause L5.5 (Mac Skill Groups UI readiness) and further Mac discovery UI work.
- Keep the 0.0.20 app shipped as it is; maintain it, don't expand it.
- No paid acquisition until the web + MCP loop shows people coming back to use it.

## Opportunity 1 — `manage_skill`: making a skill managed in one step

Today: agent creates a skill → the user finds a repo → commits and pushes by hand →
omgskills registers the release → the skill can go in a Set.
Target: agent creates a skill → "add to omgskills" → it's in the Set.

- Tool shape: `manage_skill(path, set)`, which validates the skill, resolves its source,
  shows a preview, then publishes.
- **Where the files go:** keep the current rule that no credential able to write to GitHub
  ever lives on omgskills servers. The agent does the commit and push with the user's own
  GitHub access on their machine, then calls omgskills to register the new version as a
  permanent release. omgskills stays read-only and never stores skill files.
- This replaces the planned L7 Publisher App with an agent-driven version of the same thing.
- It directly removes the creator's by-hand Git step, which the L6 pilot is set up to measure.

## Opportunity 2 — permanent version addresses in MCP

- Don't expose addresses whose contents can change underneath the user, like
  `skill://foo/SKILL.md`.
- Expose addresses tied to one version:
  `skill://<source>/releases/<release-id>/SKILL.md` (and other package files).
- `skills/list` is the one place that says which version is current or approved.
- These map directly onto the existing `skill_releases` IDs. Build this together with
  the MCP install tools rather than as a separate project.
- This removes the "is this list out of date?" confusion found this month.

## Opportunity 3 — describe the goal, not the steps

The lasting thing a user owns is a definition like this, not a string of install commands:

```
Set: Design
People: Jon + team
Destinations: Claude, Codex
Update policy: review upstream changes, preserve local edits
```

omgskills then compares each machine against that definition and fixes whatever differs.

- Set revisions, subscriptions, update previews, and preserving local edits already exist.
  This extends them.
- **The gap:** keeping machines in sync continuously needs something that's always
  running. MCP only runs when an agent calls it, so without a background process this
  means "check at session start or when asked." That always-on process is the Mac app's
  (or a small helper's) future job.
- This is the long-term goal. Don't build the always-on sync until the pilot shows people
  come back to use their Sets a second time.

## Codebase readiness (reviewed 2026-09-29 against `main`)

**Keep and build on:**
- The permanent version records (`skill_sources` / `skill_releases`: repo ID, commit,
  tree, and `SKILL.md` checksums). These are the MCP version addresses.
- The single `requireGroupAccess` check and the single set-manifest builder
  (`group-manifest.ts`) with its adapters. MCP becomes one more adapter.
- The read-only GitHub gatekeeper and the package checks in `skill-package.ts`.
- Device tokens with scoped permissions (`device-auth.ts`), the base for agent credentials.
- `mcp/src/server.ts`, already shared between the npm package and the hosted `/mcp`.

**Re-architect before building on it:**

1. **Move the install logic out of Swift.** Package checks, safe atomic installs, the
   record of what's installed where, and update detection currently live only in the Mac
   app (`ManagedSkillInstaller`, `SkillPackageValidator`, `SkillInstallProvenanceStore`,
   `GroupSubscriptionDetector`). Move them to one TypeScript package, used by the npm
   MCP server and a small CLI.
   - The TypeScript version must match the Swift behavior exactly. Keep the Mac app's
     tests as the reference, and port them before retiring the Swift code.
   - Reuse the rules in `skill-package.ts` so the server and the installer check the
     same limits and checksums.
2. **Make the on-disk install record a documented format.** One versioned file format
   describing what's installed, from which source and version, and in which agent's
   folder. The Mac app, the CLI, and agents read and write the same state, never their
   own copies. This must be settled before anyone else writes installs.
3. **Split what the remote and local MCP servers do.** A remote server can't write files
   on the user's machine.
   - Hosted `/mcp` (remote): search, set manifests, access checks, and serving versions.
   - npm `omgskills-mcp` (runs locally over stdio): install, list, check updates, apply
     updates, `manage_skill`.
4. **Add sign-in to MCP.** Hosted `/mcp` is anonymous today. For private or invite-only
   Sets, add agents as a new kind of device in the existing `device_tokens` table and
   scope system, with OAuth in front of it (what MCP clients expect). Keep public,
   no-login catalog access unchanged.
5. **Retire the old sync coupling.** Set items can still point at the Mac app's uploaded
   inventory (`skill_group_items.synced_skill_id` → `synced_skills` / `sync_runs`), and old
   one-time sync tokens still exist.
   - Move every set item onto sources and versions only.
   - Then retire the uploaded-inventory tables and the old tokens (task LA.4).
   - Installed state should come from the shared install record (item 2), not from uploads.
6. **Later: catalog search at scale.** Hosted `/mcp` loads the full ~70MB catalog
   snapshot into memory on each server instance. That's fine now. Move search to an index
   or the database if MCP traffic grows.

**Freeze, don't delete:** the Mac Skill Groups screens (`GroupInstallFlow*`,
`GroupSnapshotInstall*`) and the web-app code tied to the old sync path. They work. They
just stop being extended.

## MCP tools (first cut)

- `search_skills`, `get_skill` (existing)
- `install_skill(release_id, destination)`: the agent writes the package after checking it
- `list_installed(destination)`
- `check_updates()`: compares what's installed against the current approved versions
- `apply_update(release_id)`: with a preview of what changes first
- `install_set(set_id, destination, mode = pinned | keep-updated)`
- `manage_skill(path, set)` (Opportunity 1)

Access to private or invite-only Sets goes through the same central access check and
read-only gatekeeper already built (L4). The public, no-login `/mcp` catalog stays as it is.

## Sequencing

0. **Foundation:** the shared install package and the documented install-record format
   (re-architecture items 1 and 2), with the Swift tests ported over.
1. Opportunity 2 plus the local MCP install, list, and update tools, on the public
   catalog first.
2. Sign-in for agents (item 4), then `install_set` for private and invite-only Sets
   through the existing access check.
3. Retire the old sync coupling (item 5) before building anything that keeps machines
   in sync.
4. Opportunity 1 (`manage_skill`, with the agent doing the push).
5. Rerun the L6 pilot through the web app + MCP instead of the Mac app.
6. Only if people come back: Opportunity 3's always-on sync. If the Mac app keeps a
   role, it's as that sync agent, and it should use the shared TypeScript install core
   rather than its own Swift copy.

## Open questions

- Does the Mac app eventually use the TypeScript install core (through a bundled helper),
  or keep Swift and stay compatible through the shared install-record format? Default:
  shared format now, decide the rest later.
- OAuth for MCP: host it ourselves, or bridge Clerk?

- Which agents write files reliably through MCP today (Claude Code, Codex, Cursor)? Test first.
- How do we sign in the device for private Sets over MCP: the current pairing flow, or a
  token per agent?
- How do we measure MCP installs, given TelemetryDeck only covers the Mac app today?
