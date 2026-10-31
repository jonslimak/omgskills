# Review Lists, Part 2

Prepared on 2026-10-31 from main `ad1da632`. No crawl ran. This changes
`seeds/suppressed-skills.json` and `curations/collections.json` only; the next
shadow crawl applies it to both tracks. 58 removals are under the 500
publication-impact threshold.

It re-checks the 125 skills that `../review-lists-20261030` left open: the 109
unverified and the 16 held. Each stored `SKILL.md` was fetched from its
repository's default branch with the contents API, which does not depend on
tree truncation (`results.json`).

## Still there (57)

The stored `SKILL.md` exists. 56 have the catalog's name or the ID's folder
name. `Catsofsuffering/CCGS:skills` now calls itself `ccsm-skills` at the same
path. These stay live; no change.

## Hidden (58)

`suppressed.json`:

- `source-skill-missing`: 51 unverified skills whose stored `SKILL.md` is gone.
  Some were renamed inside their repository (for example
  `julianobarbosa/claude-code-skills` dropped the `-skill` suffix). Those are
  not in the catalog under the new name yet, and a crawl can add them as new
  skills.
- `moved-duplicate`: 7 held skills whose current version is already listed.
  Their collection and creator-page slots now point to the replacement:
  - `cocoindex-io/cocoindex-claude:cocoindex-v1` → `:cocoindex` (the repository
    now has only this skill);
  - `pydantic/skills:instrumentation` → `:logfire-instrumentation`;
  - five `danielmiessler/LifeOS` skills → their `LifeOS/install/skills/` IDs.

  11 older suppressions that named one of these seven as their replacement now
  name the new ID.

## Still held (10)

- Another live ID differs only by case, and suppression is case-insensitive,
  so hiding one would hide both. This needs a catalog fix, not a suppression:
  - `EveryInc/compound-engineering-plugin:ce-setup`;
  - `NVIDIA/skills:perf-expert-parallel-overlap`;
  - `liuzhengdongfortest/CodeStable:cs-onboard`;
  - `K-Dense-AI/scientific-agent-skills:scikit-learn`;
  - `getsentry/XcodeBuildMCP:xcodebuildmcp-structured-output-review`.
- Featured with no listed replacement. Removing them from their collections
  is an editorial call:
  - `leonxlnx/taste-skill:gpt-taste`;
  - `leonxlnx/taste-skill:image-to-code`;
  - `elastic/agent-skills:elasticsearch-file-ingest`
    (`elasticsearch-ingest` exists in the repository but is not listed);
  - `posthog/posthog:implementing-agent-modes`.
- `mattpocock/skills:pr` is in trending. Its file moved to
  `skills/engineering/pr`, which is listed under the odd ID
  `mattpocock/skills:skills`.

## Checks

Strict policy validation reports 0 findings. No new replacement is suppressed
or missing from the catalog, and none of the 58 is in trending. Tests: 584
shadow-guard and 34 policy.
