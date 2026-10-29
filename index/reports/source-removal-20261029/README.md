# Source Removal

Suppresses 6,939 skills whose GitHub source is gone, prepared on 2026-10-29
from main `2bae5146`. This commit changes `seeds/suppressed-skills.json`
only. The next shadow-crawl run drops the skills from both tracks, and it
needs the publication-impact override because the 500-removal threshold is
exceeded.

## Candidates

- Repository missing: 3,348 (`source-repo-missing`). GitHub returned 404 for
  the repository in the 2026-10-29 refresh. 3,363 of the refresh's 3,364
  were also missing in the 2026-10-28 backfill, and a 15-repo sample still
  returned 404. The list is `../skill-refresh-20261029/repo-missing.json`.
- Skill missing: 3,591 (`source-skill-missing`). The refresh could not
  resolve a path, and a full check of each repository's default-branch tree
  found no `SKILL.md` with the indexed blob, at the stored path, or in a
  folder named after the skill (`unresolved-path-check.json`, group
  `absent`). One more repository returned 404 during that check and is
  counted above.

## Not suppressed

- 123 skills held for curation (`held-for-curation.json`): 116 featured on
  27 creator pages and 7 in curated collections. Suppressing them fails strict
  policy validation until those lists are re-curated. steipete, danielmiessler,
  apify and openai account for 47.
- 58 still present under another folder; 52 were fixed in
  `../path-fixes-20261029`.
- 62 in 11 repositories whose tree listing GitHub truncated.
- 26 with a missing skill file, 733 in moved repositories, 239 with invalid
  frontmatter and 51 errors from the refresh; these are review lists.

## Checks

Strict policy validation passes with 0 findings. It reported 116 blocking
findings when the held skills were included.

## Publishing

Dispatch `shadow-crawl-health` on main with `report_only: false`,
`publication_impact_override: true` and a reason such as "Remove 6,939
skills whose GitHub source is gone (index/reports/source-removal-20261029)".
Run it before the next scheduled run; without the override, a scheduled
run blocks on the impact threshold and publishes nothing.
