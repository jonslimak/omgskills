# Directory review: 245 vendor candidates

Reviewed: 2026-10-23T17:44:39.770Z

223 recommended for a future reviewed exact-path batch. 18 exact-SHA duplicates already present. 1 invalid-format source. 3 listed names not found.
No additions, creator/watch/featured changes, policy edits, combined crawl, promotion, publication or deployment.

## Per repository

| Repository | Listed | Recommend | Duplicate | Invalid | Not found |
|---|---:|---:|---:|---:|---:|
| scandit/skills | 86 | 86 | 0 | 0 | 0 |
| twilio/ai | 57 | 56 | 0 | 1 | 0 |
| unity-technologies/unity-agent-plugin | 31 | 10 | 18 | 0 | 3 |
| elastic/claude-plugin | 26 | 26 | 0 | 0 | 0 |
| revenuecat/ai-toolkit | 24 | 24 | 0 | 0 | 0 |
| render-oss/render-plugin-claude-code | 21 | 21 | 0 | 0 | 0 |

## Quality and prerequisites

- scandit/skills: Original SDK guidance split by product and platform; references are bundled in the individual skill folders. Scandit SDK/account/license prerequisites apply. Similar structure is not evidence of copied third-party catalog content.
- twilio/ai: Substantial API, messaging, voice, identity, compliance and architecture guidance. Credentials and account/product prerequisites apply; one SKILL.md lacks frontmatter and is held.
- unity-technologies/unity-agent-plugin: Ten genuinely new Unity workflows; eighteen exact-content matches already exist and are not additions. Requires Unity Editor/CLI and project-specific packages. The GitHub license identifier is NOASSERTION; no redistribution-rights conclusion is made here.
- elastic/claude-plugin: First-party Elasticsearch/Kibana/cloud operations with explicit CLI and deployment-type prerequisites. The source distinguishes read-only diagnosis from mutations; CLI/account access remains required.
- revenuecat/ai-toolkit: SDK, paywall, purchase, billing and analytics workflows with bundled platform references and MCP/CLI options. The short revenuecat entry is a valid umbrella/router, not a substantial standalone workflow.
- render-oss/render-plugin-claude-code: Deployment and infrastructure workflows with bundled references and templates; supports MCP, CLI and Blueprint paths. Cloud/account changes and paid resources require appropriate user approval.

## Specific exclusions

- twilio/ai: twilio-agent-connect: twilio-agent-connect has no YAML name/description frontmatter.
- unity-technologies/unity-agent-plugin: tilemap-palette-create: Listed name has no matching folder/frontmatter name at the pinned current source commit.
- unity-technologies/unity-agent-plugin: tilemap-ruletile-createempty: Listed name has no matching folder/frontmatter name at the pinned current source commit.
- unity-technologies/unity-agent-plugin: tilemap-ruletile-createfromsegment: Listed name has no matching folder/frontmatter name at the pinned current source commit.

## Flag review

- Four security-pattern flags were manually reviewed: Twilio local webhook signature verification and three vendor CLI bootstrap examples. They were not confirmed malicious behavior. No commands were executed.
- 4 candidate reference flags resolve to existing directories or an illustrative wildcard with concrete files present.
- A Unity setup-multiplayer-services warning referred to a file the text explicitly says not to load; that skill is already excluded as an existing exact-SHA duplicate.
- Twilio REST-originated webhook echoes are opt-in, so the sample does not establish a default infinite-loop defect. See [Twilio webhook documentation](https://www.twilio.com/docs/conversations-classic/conversations-webhooks).

## Verification

- 291 read-only GitHub API requests; 266 distinct source blobs read, including alternate-name lookup files.
- 626 protected input files unchanged.
- All 223 recommended IDs and source SHAs are unique within this batch and absent by exact path/SHA from the examined library union.
- Package trees for the 223 candidates have no symbolic links/submodules and fit the client's file-count and byte-size limits.
- Commit SHA, path, blob SHA and URL for every candidate are in review.json.

## Boundaries

Automated checks on every matching SKILL.md and package tree; manual review of flagged cases and representative workflows across each repo. Not an exhaustive technical accuracy or dependency-code audit.

- No skill, script, installer, connector or SDK was run.
- No account was authenticated and no install/integration test was performed.
- Only SKILL.md content was pattern-scanned; bundled executable/reference contents were not comprehensively reviewed.
- Directory partner labels are inspection hints, not watch, featured, trust or publication grants.
- Source commits are pinned here; policy, source and catalog state must be rechecked before any separately approved apply.

## Next

Prepare a reviewed source/coverage proposal for these 223 exact paths. Add or watch nothing without approval; use existing bounded apply passes only after approval. No combined crawl is part of this report.
