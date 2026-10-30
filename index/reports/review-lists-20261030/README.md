# Review Lists

Data-only publication, prepared on 2026-10-30 from main `e9e6d2cc`. No crawl
ran.

The review lists are the 1,241 live skills that earlier passes left for
review: the 2026-10-29 refresh's path changes (777), invalid frontmatter
(239), errors (51) and missing files (19), the 62 skills in repositories whose
tree GitHub truncated, group 3's review list (111 skills,
`../moved-repos-group3-20261030`), and six path-fix exclusions. Some skills are on more than
one list. Each was re-read the way the refresh does, from its
new repository for group 3, and each repository's default-branch tree was
listed once. For truncated trees, the stored path was fetched directly.

## Applied

- New path: 228 skills whose folder moved inside the repository, re-read and
  pinned at the new `SKILL.md` (226 pinned). The new folder must keep the ID's
  last two segments, as in `../path-fixes-20261029`, and no other skill may
  already be listed at it. Refreshed in place: 4 (`applied.json`).
- Suppressed: 581 (`suppressed.json`).
  - `source-skill-missing`: 450. Neither the stored path, the ID's folder nor
    the indexed blob is in the default branch.
  - `moved-duplicate`: 126. The folder is gone and the same skill is already
    listed at its new path; `replacementId` names that listing.
  - `source-repo-missing`: 5. GitHub returns 404, or 451 for two.

`id`, `author_handle` and `first_seen` keep main's values. A new
`readme_snippet` is added only where the record already had one.

## Held (16)

Suppression was proposed but not applied (`held.json`): 12 are featured on
creator pages or in collections, and strict policy validation blocks them; 3
have another live ID that differs only by case, which the same suppression
would also hide; `mattpocock/skills:pr` is in trending.

## Left as is (412)

`remaining.json`:

- Invalid frontmatter: 237. The file is still there but has no valid
  frontmatter, so it cannot be pinned. Removing it is a product decision.
- Still present: 66. The stored path still exists, for example a root
  `SKILL.md` whose name changed.
- Unverified: 109. A truncated tree with no stored path, a new folder that
  does not match the ID, a folder named after the skill that holds no exact
  match, or a re-read that did not match.

## Checks

`validateCutoverOutputs` passed with zero failures, the promoted IDs match
`index/skills.json`, and strict policy validation reports 0 findings. Both
tracks were published as the scheduled publisher does, including
`SKILL_EQUIVALENCE_PUBLISH=1`, which drops six equivalence groups with a
member that is no longer live (29 to 23). Both published-data verifiers pass.
Skills go from 50,724 to 50,143 on both tracks. The publication-impact checks
pass with an override, because 581 removals exceed the 500 threshold (reason:
"Review lists: hide 581 skills whose GitHub source is gone"). Tests: 577
shadow-guard, 74 published-data, 103 MCP and 6 MCP production.
