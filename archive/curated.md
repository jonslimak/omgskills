# Manual Crawl 4 Curation

This doc captures the intended manual curation path for Crawl 4.

## Goal

Manual curation lets an operator paste GitHub repo or `SKILL.md` links into Codex and have an agent add useful skills quickly.

This path should:

- avoid full Crawl 4 runs for every manual add
- allow trusted manual additions to bend normal discovery/value rules
- keep unresolved catalog/repackaged content blocked
- keep v2 fallback separate from Crawl 4 curation

## Direction

Manual curation is a separate operator path, not normal discovery.

Agents should not hand-edit production `skills.json`.

Manual curation should write Crawl 4 shadow/manual overlay data, then publish Crawl 4 data for review.

Once Crawl 4 is the primary client track, curated skills can appear in the primary track after publish.

The `/curate` Codex skill should accept:

- GitHub repo URLs
- GitHub `blob/.../SKILL.md` URLs
- GitHub folder URLs containing multiple skills

Exact `SKILL.md` links are implemented now. Repo and folder links are handled by resolving them to exact `SKILL.md` blob URLs first.

Manual curation can bypass:

- star threshold
- high-star shard rules
- normal discovery admission source rules

Manual curation cannot bypass:

- valid `SKILL.md` parsing
- clean repo/path fetch
- unresolved catalog/repackaged exclusion
- cutover validation

## Current Mechanism

Implemented:

```bash
npm run crawl4:add-skill -- <github-skill-md-url>
npm run crawl4:remove-repo -- <owner/repo>
```

Behavior:

- fetch only the linked skill
- extract repo metadata and raw `SKILL.md`
- create or update Crawl 4 manual overlay records
- update Crawl 4 data without full discovery, cheap checks, or daily refresh
- report added, skipped, and failed items clearly

Still future:

```bash
npm run crawl4:add-repo -- <github-repo-url>
```

For now, agents should resolve repo or folder URLs into exact `SKILL.md` blob URLs and call `crawl4:add-skill` for each one.

## Remove / Do Not Crawl

Manual curation also supports removing a repo from the Crawl 4 maintained library.

Use this when a repo is catalog-like, low quality, unsafe, duplicated, or otherwise should not re-enter Crawl 4.

```bash
cd /Users/jonslimak/Projects/omgskills/index
npm run crawl4:remove-repo -- <owner/repo>
```

Behavior:

- removes matching repo skills from Crawl 4 shadow/cutover output
- removes the repo from Crawl 4 repo overlay/index state
- adds the repo to `index/seeds/do-not-crawl.json`
- prevents future Crawl 4 discovery/admission from re-adding it
- does not edit production `skills.json`

After removal, publish Crawl 4 data if the user wants the hosted/client-visible library updated.

## Codex Skill

The Codex skill exists as `/curate`.

The skill should instruct agents to:

- normalize pasted GitHub links
- choose exact `add-skill` inputs
- run the operator command
- inspect output
- publish Crawl 4 data if needed
- remove repos with `crawl4:remove-repo` when asked
- report exact added skill names
- report removed repo and removed skill count
- never edit production data directly

## Test Plan

For the implemented mechanism:

- add one exact `SKILL.md` link
- resolve one repo with multiple skills into exact `SKILL.md` links
- reject one unresolved catalog-like skill
- remove one catalog-like repo and confirm it stays blocked
- confirm Crawl 4 output can see added skills
- confirm removed repo has no Crawl 4 output entries
- confirm v2 fallback output is not hand-edited

## Assumptions

- Manual curated skills target Crawl 4 output, not v2 fallback output.
- Exact `SKILL.md` manual add is implemented.
- Repo-level manual add is still future; agents resolve repo links manually for now.
