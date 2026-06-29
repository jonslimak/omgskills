# Manual Crawl 4 Curation

This doc captures the intended manual curation path for Crawl 4.

## Goal

Manual curation should let an operator paste GitHub repo or `SKILL.md` links into Codex and have an agent add useful skills quickly.

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

The agent should accept:

- GitHub repo URLs
- GitHub `blob/.../SKILL.md` URLs
- GitHub folder URLs containing multiple skills

Manual curation can bypass:

- star threshold
- high-star shard rules
- normal discovery admission source rules

Manual curation cannot bypass:

- valid `SKILL.md` parsing
- clean repo/path fetch
- unresolved catalog/repackaged exclusion
- cutover validation

## Future Mechanism

Add fast operator commands:

```bash
npm run crawl4:add-skill -- <github-skill-md-url>
npm run crawl4:add-repo -- <github-repo-url>
```

Expected behavior:

- fetch only the linked skill or repo
- extract repo metadata and raw `SKILL.md`
- create or update Crawl 4 manual overlay records
- update Crawl 4 data without full discovery, cheap checks, or daily refresh
- report added, skipped, and failed items clearly

## Codex Skill

After the commands exist, create a Codex skill named `crawl4-curator`.

The skill should instruct agents to:

- normalize pasted GitHub links
- choose `add-skill` vs `add-repo`
- run the operator command
- inspect output
- publish Crawl 4 data if needed
- report exact added skill names
- never edit production data directly

## Test Plan

For this doc-only step:

- confirm this doc states intent, constraints, and future commands
- confirm this doc does not imply full Crawl 4 is required for manual adds
- confirm unresolved catalog/repackaged skills stay blocked

For the later mechanism:

- add one exact `SKILL.md` link
- add one repo with multiple skills
- reject one unresolved catalog-like skill
- confirm Crawl 4 output can see added skills
- confirm v2 fallback output is not hand-edited

## Assumptions

- Manual curated skills target Crawl 4 output, not v2 fallback output.
- First implementation step after this doc is the fast operator mechanism.
- The Codex skill should be created after the operator commands exist.
