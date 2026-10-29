# Unpinned Skill Refresh

Data-only publication of refreshed content and install coordinates for skills
that had no pinned install, prepared on 2026-10-29 from main `d6f15f56`. No
crawl or discovery ran.

## Refresh

`crawl4:refresh-unpinned` re-read every unpinned skill (20,280) in 11 batches
between 2026-10-28 and 2026-10-29, then retried errors once. It fetches each
skill the way the scheduled crawl does and pins the content it finds.

- Refreshed: 12,067 (11,828 pinned, 239 readable but not pinnable).
- Repository missing: 3,364 skills in 992 repos (`repo-missing.json`).
- Skill path unresolved: 3,818 (`skill-path-unresolved.json`). The repository
  exists but no folder for the skill was found.
- Skill file missing: 26 (`skill-file-missing.json`).
- Repository moved: 733 skills in 248 repos (`repo-moved.json`).
- Invalid frontmatter: 239 (`invalid-frontmatter.json`).
- Still failing after the retry: 51 (`errors.json`).

## Publication

Refreshed records were rechecked against main. A record is applied only when
main's copy is unchanged since the refresh began (1 was skipped) and the
refreshed `SKILL.md` is the same skill: its stored path is unchanged, or, for
skills with no stored path, its folder matches the skill ID.

780 refreshes are excluded (`path-changed-excluded.json`). Their original
folder is gone, and the refresh resolved a different skill in the same
repository, for example `a5c-ai/babysitter:…/skills/call` resolving to
`deepvariant-caller`. They need review, not a refresh.

11,298 records change on both tracks. `id`, `github_url`, `author_handle` and
`first_seen` keep main's values; content, metadata and install coordinates
update. A new `readme_snippet` is added only where the record already had one
(7,736 new snippets left out), because adding them all would bring the Crawl 4
skills asset within 0.5 MB of GitHub's 100 MiB file limit. Records installable
through `pinnedInstallFor` rise from 34,090 to 44,524 of 58,290.

`validateCutoverOutputs` passed with zero failures, and the promoted IDs match
`index/skills.json`. The v2 and Crawl 4 publishers, sha-history and
skill-equivalence then generated the assets, with pruned historical assets
restored. Both published-data verifiers and both publication-impact checks
pass without an override: 58,290 skills before and after, none removed.
Tests: 565 shadow-guard, 65 published-data and 81 MCP passed.

## Release review correction

The initial refresh omitted `canonicalBySha` from both new sha-history assets,
dropping all 47 prior duplicate-resolution choices. Release review rebuilt the
mapping with `buildCanonicalBySha`, the same trusted-seed policy used by the
scheduled publisher. Both tracks now publish 290 current, high-confidence
same-repository choices. Historical SHA/ID pairs and older hashed assets remain
intact; stale choices are not copied onto changed content. Skills files, pinned
records, collections and feature settings are unchanged by this correction.

Verification after correction: 565 shadow-guard, 65 published-data, 81 MCP and
35 focused API tests passed, along with index typecheck and the full combined
site build. Three refreshed files matched their exact GitHub commit/blob pins.

The skills assets are 96.4 MB (v2 and `index/skills.json`) and 98.0 MB
(Crawl 4), against a 104.9 MB limit.

## Removal proposal (not applied)

The candidates are the missing repositories (3,364) and, after one more
check, the unresolved paths (3,818) and missing files (26). That is about
7,200 skills, 12% of the catalog. A 15-repo sample of the missing
repositories still returns 404, and 3,363 of the 3,364 were also missing in the
2026-10-28 backfill. A 20-skill sample of the unresolved paths found 19
absent and 1 present under a different folder, so that group needs a
full tree check before removal.

Removal would add `suppressed-skills.json` entries with reason
`source-repo-missing` or `source-skill-missing`. Publication impact blocks
more than 500 removals per publish, so they go out in about 15 batches, or in
one publish with an override.

Moved repositories, invalid frontmatter, errors and the excluded path changes
are review lists, not removal candidates.

Refresh batch logs and the full state file remain in the catalog-refresh
worktree's ignored `index/shadow`. This report is not proof of a deploy.
