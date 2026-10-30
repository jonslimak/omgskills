# Moved Repositories, Group 3

Data-only publication, prepared on 2026-10-30 from main `e2bcf6bd`. No crawl
ran.

Group 3 is the 1,405 skills whose repository now redirects to a new owner or
name and whose new-repository ID is not otherwise handled. Each was re-read
under its new repository with the refresh tool.

## Applied

- Re-pointed: 1,140 skills (1,121 pinned). `github_url`, install coordinates
  and content follow the new repository. `id`, `author_handle` and
  `first_seen` keep main's values, as the moved-repo decision requires
  (`repointed.json`).
- Suppressed as `moved-duplicate`: 153 skills whose resolved `SKILL.md` path
  is already listed under the new repository (151 with identical content)
  (`suppressed.json`).

## Review, not applied (112)

- Path changed: 90. The original folder is gone and a different path
  resolved.
- Invalid frontmatter: 16. Skill file missing: 4. Repository missing: 1.
- Changed on main since the check: 1.

## Checks

Cutover validation 0 failures, policy validation 0 findings, both published-
data verifiers and both publication-impact checks pass without an override
(50,899 to 50,746 skills, 153 removed). Signals and leaderboards were rebuilt
the way the scheduled crawl does. Tests: 571 shadow-guard, 74 published-data,
103 MCP, 8 data-store. New assets are uploaded to R2.
