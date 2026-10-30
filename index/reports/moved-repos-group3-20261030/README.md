# Moved Repositories, Group 3

Data-only publication, prepared on 2026-10-30 from main `e2bcf6bd`. No crawl
ran.

Group 3 is the 1,405 skills whose repository now redirects to a new owner or
name and whose new-repository ID is not otherwise handled. Each was re-read
under its new repository with the refresh tool.

## Applied

- Re-pointed: 1,118 skills (1,099 pinned). `github_url`, install coordinates
  and content follow the new repository. `id`, `author_handle` and
  `first_seen` keep main's values, as the moved-repo decision requires
  (`repointed.json`).
- Suppressed as `moved-duplicate`: 175 skills whose resolved `SKILL.md` path
  is already listed under the new repository (171 with identical content)
  (`suppressed.json`).

## Duplicate correction

PR review identified 22 additional aliases: 17 overlap an already-listed
destination and five are extra copies in all-moved pairs. Root IDs without
a stored path are checked against `SKILL.md`; unknown nested paths are not
guessed. Existing destination IDs are retained. For all-moved pairs, the
destination ID is preferred, then the earliest existing ID. Replacements
always point to retained rows, with no replacement chains.

`duplicate-correction.json` records every correction. The reusable planner
and regression tests are in `index/scripts/moved-repo-duplicates.ts` and
`index/scripts/moved-repo-duplicates.test.ts`. No crawl or GitHub refresh
was needed for this correction.

## Review, not applied (112)

- Path changed: 90. The original folder is gone and a different path
  resolved.
- Invalid frontmatter: 16. Skill file missing: 4. Repository missing: 1.
- Changed on main since the check: 1.

## Checks

Cutover validation 0 failures, policy validation 0 findings, both published-
data verifiers and both publication-impact checks pass without an override
(50,899 to 50,724 skills, 175 removed). Signals and leaderboards were rebuilt
the way the scheduled crawl does. Tests: 577 shadow-guard, 74 published-data,
103 MCP, 8 data-store. New assets are uploaded to R2.
