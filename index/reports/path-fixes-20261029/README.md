# Skill Path Fixes

Data-only publication of new `SKILL.md` paths for skills whose folder moved
inside the same repository, prepared on 2026-10-29 from main `2bae5146`. No
crawl or discovery ran.

## Candidates

The 2026-10-29 refresh could not resolve a path for 3,818 skills
(`../skill-refresh-20261029/skill-path-unresolved.json`). A full check read each
of their 970 repositories' default-branch trees once. 58 skills were still
present: 27 with an identical `SKILL.md` blob elsewhere in the repository and
31 with a `SKILL.md` in a folder named after the skill.

One path was chosen per skill. For IDs that name a folder path, the new folder
must end in the ID's last two segments, so `remotion-dev/remotion:.claude/skills/pr`
can move to `.agents/skills/pr` but not to an unrelated sample. Paths under
`backup/`, `dist/`, `examples/` or `profiles/` lose to other matches.

## Publication

52 skills are re-read at their new path the way the refresh does, and 51 of
them are pinned (`applied.json`). `LuisSambrano/antigravity-config:playwright`
updates without a pin because its file is named `skill.md`. `id`, `github_url`,
`author_handle` and `first_seen` keep main's values. Records installable
through `pinnedInstallFor` rise from 44,524 to 44,562 of 58,290.

6 are left out (`excluded.json`): four whose repository GitHub now reports
under a new owner or name, one the crawler's path resolver cannot read, and
`jlowin/fastmcp:.claude/skills/code-review`, which only matches an unrelated
example.

`validateCutoverOutputs` passed with zero failures and the promoted IDs match
`index/skills.json`. The v2 and Crawl 4 publishers, sha-history (with
`SHA_CANONICAL_PUBLISH=1`, as the scheduled publisher runs it) and
skill-equivalence generated the assets, with pruned historical assets
restored. Both tracks publish 292 duplicate-resolution choices. Both
published-data verifiers and both publication-impact checks pass without an
override: 58,290 skills before and after, none removed. Tests: 565
shadow-guard, 65 published-data and 81 MCP passed.

This report is not proof of a deploy.
