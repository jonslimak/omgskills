# Pinned Install Backfill

Data-only publication of verified install coordinates for the whole catalog,
prepared on 2026-10-28 from main `4ce60b28`. No crawl, discovery or refresh ran.

## Backfill

`crawl4:backfill-package-metadata` ran in 16 batches of up to 1,000 repos
between 2026-10-27 and 2026-10-28, covering every skill that lacked complete
install coordinates (51,670). A skill resolves only when the repository's
current default branch holds a `SKILL.md` blob identical to the indexed content
hash, at a single provable path.

- Resolved: 32,425.
- Repository unavailable: 3,368 skills in 996 repos (`unavailable-repos.json`).
  GitHub returned not found for 3,364, blocked access for 2, an empty
  repository for 1 and a missing tree for 1.
- Content not proven: 15,877 skills (`unproven-skills.json`). The repository
  exists but no `SKILL.md` with the indexed hash was found at one path.

A 50-skill sample of the unproven group, checked against live GitHub, found
about 55% edited since indexing (file still present, content changed), about 35%
moved or deleted, about 8% ambiguous (identical file in several folders) and
about 2% in repositories whose tree listing is truncated. This sample is an
estimate, not a classification of every record.

## Publication

The tool-generated overlay (39,001 entries, including the 6,566 skills already
pinned) was rechecked against main's current catalog. Every entry matched its
skill ID and content hash. 1,042 entries in 228 repositories were excluded
because GitHub now reports a different owner or name than the catalog's
`github_url` (`moved-owner-excluded.json`). They need review before pinning.

The remaining 37,959 entries were applied to both published tracks. 31,393
records gain install coordinates. Only `repo_slug`, `skill_md_path`,
`repo_commit_sha`, `skill_tree_sha` and `install_target_name` change; names,
descriptions, content hashes, tiers and every other field are unchanged. Records
installable through `pinnedInstallFor` rise from 6,548 to 34,089 of 58,289.

`validateCutoverOutputs` passed on the merged Crawl 4 catalog with zero failures,
and the promoted IDs match `index/skills.json` exactly. The normal v2 and
Crawl 4 publishers then generated the assets, including the first
`search-installable` asset for the MCP `installable` filter. Historical assets
pruned by the publishers were restored, so no asset files are deleted.

The Crawl 4 skills asset is now written without indentation. Indented, it would
be 104.9 MB, over GitHub's 100 MiB file limit; unindented it is 95.1 MB with the
same data. The v2 asset and `index/skills.json` are 103.0 MB, under the limit
with little room left, so the next large crawl needs split or externally hosted
skills files.

Both publication-impact checks pass without an override: 58,289 skills, 338
collections and 3,887 memberships before and after. Both published-data
verifiers pass. Tests: 565 shadow-guard, 65 published-data and 81 MCP tests
passed. A local MCP check against the new assets returned pinned PDF skills
for `installable: true` (33,895 installable after duplicate hiding), installable
related skills for discovery-only records, and a pinned install plan for a newly
pinned skill.

## Follow-up

- Refresh the edited group: re-read current `SKILL.md` content and pin it.
- Confirm the unavailable repositories and hide them from search.
- Review the moved-owner repositories before updating their URLs and pinning.

Backfill batch logs and the full operational overlay remain in the local
worktree's ignored `index/shadow`. This report is not proof of a deploy.
