# Moved repositories: review and proposal

Draft, 2026-10-29, read-only review of main `c813f3e2`. Nothing applied.

## What was reviewed

1,763 live catalog skills in 440 repositories that GitHub now serves under a
different name. They come from the 2026-10-29 refresh (733), the 2026-10-28
backfill's moved-owner exclusions (1,042, of which 16 overlap) and four
path-fix exclusions. None have been removed or suppressed since.

GitHub resolves all 440 old names (none are gone):

- Renamed by the same owner: 207 repos, 753 skills.
- Transferred to a different owner: 233 repos, 1,010 skills.
- Archived: 35 skills. The new repository is on do-not-crawl for 26 skills
  (`intent-solutions-io/plugins-nixtla` → `jeremylongshore/plugins-nixtla`).

Largest moves: `Aradotso/trending-skills` → `reason-machines/trending-skills`
(137), `affaan-m/everything-claude-code` → `affaan-m/ECC` (126),
`jabrena/cursor-rules-java` → `jabrena/plinth` (72),
`OpenAEC-Foundation/Frappe_Claude_Skill_Package` → `Impertio-Studio/…` (60),
`EvolutionAPI/EVO-METHOD` → `evolution-foundation/EVO-METHOD` (55).

## Why they are stuck

The crawler already handles renames, but only at admission: when it discovers
a repository, it resolves the current name and builds IDs from it
(`repo-canonicalization.ts`, up to 25 repositories per run). Skills admitted
before a rename keep the old name in both ID and `github_url`, and the
refresh and backfill correctly refuse to pin them because the source changed.
Where the new repository was later discovered too, the catalog now lists the
same skill twice.

## Groups and proposed action

1. **Duplicates with identical content: 250.** The new repository's catalog
   entry has the same `SKILL.md` blob. Suppress the old entry with
   `replacementId` pointing at the new one (reason `moved-duplicate`,
   confidence high). This is the existing mechanism and is under the
   500-removal limit.
2. **Duplicates by name or folder only: 240.** Likely the same skill, edited
   since. A leaf-folder match is too loose for some (for example
   `affaan-m/everything-claude-code:docs/zh-TW/skills/frontend-patterns`
   matches `affaan-m/ecc:frontend-patterns`, but one is a translation). Before
   suppressing, require the same path in the new repository; anything else
   moves to group 3. Confidence medium.
3. **No duplicate: 1,273** (1,009 whose new repository is not in the
   catalog, 264 whose new repository is but without these skills). Re-point
   `github_url` and `install_cmd` to the new repository, keep the IDs, then
   run them through the refresh tool, which re-reads and pins each one. Skills
   it cannot find go to the removal lists as before. Keeping IDs avoids
   breaking installs and links; 1,327 catalog skills already have an ID repo
   that differs from their URL, so this is established practice.
4. **New repository on do-not-crawl: 26.** Suppress (reason
   `moved-to-blocked-repo`).
5. **Archived: 35.** Keep; archived repositories still install.

## Sequencing

Groups 1, 2 and 4 change only `seeds/suppressed-skills.json`; group 3
changes `index/skills.json` and published data like the 2026-10-29 refresh.
Every scheduled crawl rewrites `index/skills.json`, so group 3 must be prepared
on the latest main and merged before the next crawl, with nothing else touching
those files. Suggested order: groups 1 and 4 together (276 suppressions, no
override), then group 2 after the path check, then group 3 as its own data
publish.

## Open question

Group 3 alternative: instead of re-pointing, add the new repositories to
discovery and suppress the old entries once the crawl admits them under new
IDs. Cleaner IDs, but installed skills would change ID and it depends on the
crawl's 25-per-run canonicalization cap (about 18 runs for 440 repositories).

Working files (not in git): the scratchpad's `moved-review.json` (per skill)
and `moved-github.json` (per repository).
