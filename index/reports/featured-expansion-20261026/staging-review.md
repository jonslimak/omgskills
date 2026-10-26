# Featured Creator Expansion: Approved 30 And Next 20

Reviewed: 2026-10-26. Base: d07dacefd28569a146c0743c330a0f5924b81007.

## Current State

The operator approved the 30 priority accounts from the initial 50-account review. Their profile changes are prepared locally, not committed, pushed, published or deployed.

- Featured accounts: 277 -> 307 in the proposed registry.
- 12 existing watched entries featured; 18 new watched/featured entries added.
- All 354 current eligible skill records are explicitly included across the 30 profiles. These are existing records, not new catalog admissions or 354 unique capabilities.
- 19 X links came from the accounts' GitHub profile metadata; no links were guessed.
- Existing trust roles, aliases, selected repositories, exact paths, path exclusions and all suppression/block policy are unchanged. New entries have no trusted roles or automatic coverage grant.
- Watch is enabled because featured requires watch. It remains subject to the existing creator-watch flag and gates; no discovery configuration is changed.
- No catalog, manifest, hashed asset, client, workflow or release file is changed.

This uses the existing reviewed editorial-file path, not creator intake: the approved profiles reference already-published catalog IDs, and this slice does not authorize broader repo discovery or new admissions.

## Approved Profiles Prepared Locally

Each profile has a factual description, a short subtitle, a creator/product-team classification and its complete current eligible record list. GitHub profile links derive from the registry handle. Existing handle casing is preserved; new casing follows GitHub's canonical login. The display grouping does not assert a legal corporate status for open-source teams or foundations.

| Account / Source | Records | Presentation |
|---|---:|---|
| [deanpeters](https://github.com/deanpeters/Product-Manager-Skills) | 47 | Dean Peters; product strategy and discovery |
| [greensock](https://github.com/greensock/gsap-skills) | 8 | GSAP; animation and motion engineering |
| [tavily-ai](https://github.com/tavily-ai/skills) | 8 | Tavily; web search and research |
| [egonex-ai](https://github.com/Egonex-AI/Understand-Anything) | 9 | Egonex AI; codebase understanding and architecture |
| [lllllllama](https://github.com/lllllllama/RigorPilot-Skills) | 11 | Chengkun Rao; reproducible AI research workflows |
| [muend](https://github.com/muend/geoai-skills) | 13 | muend; geospatial analysis and evidence |
| [nidrissi](https://github.com/nidrissi/mathbox) | 10 | Najib Idrissi; mathematical research and verification |
| [zakariaf](https://github.com/zakariaf/Flutter-Skills) | 36 | Zakaria Fatahi; Flutter engineering and testing |
| [surendranb](https://github.com/surendranb/writing-skills) | 9 | surendranb; technical and business writing |
| [angular](https://github.com/angular/skills) | 7 | Angular; application development workflows |
| [JimLiu](https://github.com/JimLiu/baoyu-skills) | 26 | Jim Liu / Baoyu; visual design and publishing |
| [solana-foundation](https://github.com/solana-foundation/solana-dev-skill) | 1 | Solana Foundation; development and testing |
| [sveltejs](https://github.com/sveltejs/ai-tools) | 3 | Svelte; development and performance |
| [ChromeDevTools](https://github.com/ChromeDevTools/chrome-devtools-mcp) | 7 | Chrome DevTools; browser debugging and performance |
| [payloadcms](https://github.com/payloadcms/skills) | 4 | Payload; CMS development and migration |
| [chakra-ui](https://github.com/chakra-ui/chakra-ui) | 3 | Chakra UI; accessible React interfaces |
| [heroui-inc](https://github.com/heroui-inc/heroui) | 3 | HeroUI; React and native interfaces |
| [usestrix](https://github.com/usestrix/strix) | 9 | Strix; authorized application security testing |
| [resend](https://github.com/resend/resend-skills) | 8 | Resend; email development and delivery |
| [apollographql](https://github.com/apollographql/skills) | 16 | Apollo GraphQL; development across platforms |
| [Arize-ai](https://github.com/Arize-ai/arize-skills) | 15 | Arize AI; observability and evaluation |
| [marimo-team](https://github.com/marimo-team/skills) | 12 | marimo; Python notebooks and research |
| [android](https://github.com/android/skills) | 11 | Android; development and security |
| [slavingia](https://github.com/slavingia/skills) | 10 | Sahil Lavingia; entrepreneurship and growth |
| [DietrichGebert](https://github.com/DietrichGebert/ponytail) | 6 | Dietrich Gebert; focused coding and review |
| [zarazhangrui](https://github.com/zarazhangrui/frontend-slides) | 2 | Zara Zhang; presentations and codebase education |
| [autonnel](https://github.com/autonnel/autonnel-skills) | 6 | Autonnel; sales funnels and conversion |
| [oxc-project](https://github.com/oxc-project/oxc) | 2 | Oxc; JavaScript tooling and migration |
| [bmad-code-org](https://github.com/bmad-code-org/BMAD-METHOD) | 36 | BMad; structured software delivery |
| [Fission-AI](https://github.com/Fission-AI/OpenSpec) | 16 | OpenSpec / Fission AI; specification-driven development |

### Resend Rename, Not A Catalog Copy

The initial count was seven original-labelled records. An eighth, `resend/email-skills:email-best-practices`, has repackaged provenance but is published from Resend's own `resend/email-best-practices` repository. A read-only [GitHub API check](https://api.github.com/repos/resend/email-skills) resolved the old repository name to that same Resend-owned repository. Include the eighth existing record without changing its ID, provenance or package metadata. This is not permission to include other unresolved repackaged content.

### Existing Limitations Retained

- JimLiu has two older records without explicit skill_md_path; Apollo has four. Those optional metadata gaps are unchanged and are not new catalog admissions. No install test or path backfill was performed.
- Existing duplicate versions and different package variants remain separate records; no ID rewrite or dedupe policy change was made.
- Featuring all current eligible records does not prove complete upstream coverage. Any future coverage expansion needs its own reviewed plan.
- Source review is not security certification or independent reproduction of author-reported benchmarks.

## Next 20: Review Only

No changes were made to these accounts. Source checks read bounded primary GitHub samples; no downloaded skill instructions or scripts were executed. Recommend-next means the account merits a separate approval, not that every legacy installation path is already verified.

### Recommend Next: 13

| Account | Source Finding | Remaining Care Before Applying |
|---|---|---|
| Jeffallan | Own [engineering](https://github.com/Jeffallan/claude-skills/blob/main/skills/rag-architect/SKILL.md), [writing](https://github.com/Jeffallan/writing-with-agents/blob/main/plugin/skills/architect/SKILL.md), and [fitness](https://github.com/Jeffallan/Fitness-Tools/blob/master/skills/meal-planner/SKILL.md) workflows. | Reconcile duplicate variants and moved writing paths. Preserve stable IDs and existing coverage. |
| conorluddy | Native [Xcode/iOS](https://github.com/conorluddy/xclaude-plugin/blob/main/skills/crash-debugging/SKILL.md) and [Discord](https://github.com/conorluddy/discord-skill/blob/main/SKILL.md) workflows. | Disclose deprecated packaging and Discord permissions; verify legacy path mappings separately. |
| browser-act | [Service-specific automation wrappers](https://github.com/browser-act/skills/blob/main/solutions/lead-generation/industry-key-contact-radar-api-skill/SKILL.md), not an apparent copied-skills directory. | State authentication and authorized-use requirements; legacy path metadata is incomplete. |
| thejefflarson | [Logging checks](https://github.com/thejefflarson/soundcheck/blob/main/.claude/skills/logging-failures/SKILL.md) fit the authored security-review pack. | Keep the existing 51-path crawl authorization. An editorial decision must not silently approve an additional path. |
| supermemoryai | [Addition history](https://github.com/supermemoryai/skills/commit/c14d787b7e08e23b6e028cd8bb43795dc0749a46) supports native source. | [Packaging changed](https://github.com/supermemoryai/claude-supermemory/blob/main/README.md); reconcile obsolete paths and version distinctions. |
| tinyfish-io | The [cookbook skill](https://github.com/tinyfish-io/tinyfish-cookbook/blob/main/skills/use-tinyfish/SKILL.md) is reusable CLI guidance rather than demo scaffolding. | Keep six-path coverage unchanged; do not automatically approve all future cookbook content. |
| mcp-use | [Builder variants](https://github.com/mcp-use/mcp-use/blob/main/skills/mcp-apps-builder/SKILL.md) are first-party overlapping guidance. | Five records do not imply five different capabilities. Preserve variants without overstating breadth. |
| cathrynlavery | Native [spending](https://github.com/cathrynlavery/spend-optimizer/blob/main/SKILL.md) and [voice-memo](https://github.com/cathrynlavery/voice-memo-organizer/blob/main/SKILL.md) workflows support the broader portfolio beyond diagrams. | Describe sensitive-data access and reconcile two missing explicit paths. |
| cocoindex-io | [Documented migration](https://github.com/cocoindex-io/cocoindex-claude/blob/main/README.md) connects legacy and canonical packages. | Preserve version-specific distinctions and stable IDs; complete legacy path mapping separately. |
| abpframework | [Upstream skill directories](https://github.com/abpframework/abp/tree/dev/.claude/skills) correspond to the local package set. | Missing explicit paths are metadata gaps, not proof of copied content. Verify mappings separately. |
| redpanda-data | [Connect component discovery](https://github.com/redpanda-data/connect/blob/main/.claude-plugin/plugins/redpanda-connect/skills/component-search/SKILL.md) and [BYOC operations](https://github.com/redpanda-data/skills/blob/main/skills/cloud-byoc/SKILL.md) are distinct first-party functions. | Reconcile package locations and the missing explicit path before claiming installation verification. |
| coleam00 | The exact Archon record has a [Cole-authored introduction](https://github.com/coleam00/ottomator-agents/commit/2be20d5737fc49aa0f665a012f3ffde283d26d54). | Clears that authored record, not blanket trust for the aggregation repository or its other contributors. No broad coverage grant. |
| snarktank | The [implementation credits Geoffrey Huntley's pattern](https://github.com/snarktank/ralph/blob/main/README.md) rather than claiming invention. | Preserve attribution; a shared PRD SHA alone does not determine copying direction. Verify the legacy path separately. |

### Hold For A Specific Decision: 5

| Account | Finding | What Must Be Resolved |
|---|---|---|
| larksuite | Native [CLI](https://github.com/larksuite/cli/blob/main/skills/lark-shared/SKILL.md) and [plugin](https://github.com/larksuite/openclaw-lark/blob/main/skills/feishu-create-doc/SKILL.md) workflows are useful. However the current author portfolio also contains `aiskillstore/marketplace:skills/larksuite/lark-base`, published from the known catalog `aiskillstore/marketplace`. | Do not include that catalog-sourced copy. A full-author profile must not accidentally surface it through author matching. Resolve policy/profile handling explicitly before adding Lark; no suppression or removal is applied here. |
| nextlevelbuilder | [Bundled brand helper](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill/blob/main/.claude/skills/brand/SKILL.md) contains `author: claudekit` (blob 3eddf309084e6c4493fa19a6b31e755703ba5e86). | Establish the relationship/origin of bundled helpers. This is an authorship question, not an accusation of misuse. Flagship popularity does not resolve it. |
| triggerdotdev | The skills mirror is explicitly [synced from its own monorepo](https://github.com/triggerdotdev/skills/blob/main/README.md), not a third-party catalog. Its portfolio also contains [internal trace-view implementation guidance](https://github.com/triggerdotdev/trigger.dev/blob/main/.claude/skills/span-timeline-events/SKILL.md). | Decide whether the full profile, including contributor-specific material, meets the intended editorial scope. No new catalog block is warranted merely because some skills are internal. |
| mastra-ai | Strong official framework guidance coexists with a [branch-specific smoke-test helper](https://github.com/mastra-ai/mastra/blob/main/.claude/skills/builder-smoke-test/SKILL.md). | Resolve full-portfolio editorial relevance, rather than silently showcasing only the flagship or removing internal content. |
| max-sixty | Useful public Worktrunk tooling coexists with [running-tend](https://github.com/max-sixty/worktrunk/blob/main/.claude/skills/running-tend/SKILL.md), which explicitly says `internal: true` (blob 251efec01d2b952ff273c8b28331e2f0543b053c). | Decide whether that contributor-only material belongs in an all-skills featured profile; it is not automatically a catalog or crawler-policy violation. |

Internal or contributor-oriented skills are not inherently invalid or catalog content. The last three holds are editorial-scope questions, not reasons to invent a new exclusion rule. In-progress skills remain eligible when otherwise useful and policy-compliant.

### Identity Decisions: 2

| Account | Finding | Decision |
|---|---|---|
| get-convex | [Repository redirects to convex](https://github.com/convex/agent-skills). The [third-party notices](https://github.com/convex/agent-skills/blob/main/THIRD_PARTY_NOTICES.md) concern icons rather than copied skills. | Plan a registry identity/alias update separately. Preserve all skill IDs; do not automatically broaden coverage. |
| shadcn-ui | [Product-owned skills](https://github.com/shadcn-ui/ui/blob/main/skills/shadcn/SKILL.md) are legitimate, while the person shadcn is already featured. | Decide on a separate product/company profile. Do not represent it as another individual creator or silently alias the person to the organization. |

## Verification

- Strict policy validation: zero findings before and after edits.
- 48 focused publisher, policy and creator-format/save tests passed.
- Typecheck passed; 18 existing collection images verified.
- Pure in-memory collection build: 295 -> 325 collections; every previous collection is byte-for-byte equivalent as an object. No asset or manifest writes were performed.
- Every new profile explicitly contains all its current eligible author IDs; no five-highlight truncation.
- All 354 selected IDs were found in both live v2 and Crawl 4, each containing 58,289 skills. Live manifests were read, never changed.
- Catalog SHA-256 remains `6f4c31c2c20fc22bd0201805ea69dee5e2a0754b5f07bcc92511e0116c957ca5`.
- Existing registry trust and coverage fields are unchanged; the other 20 candidates are untouched.
- git diff --check passed.

Machine-readable local preparation evidence is in [staging-evidence.json](staging-evidence.json).

## Next Action

Review/commit the approved 30 source changes first. Publishing requires separate approval and the normal guarded collections workflow. Seek separate approval for the 13 next recommendations; do not apply the remaining 20 from this report automatically. The held and identity cases require the specific decisions above.
