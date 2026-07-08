# Crawl 4 Removal Audit

Generated: 2026-07-08T16:13:22.403Z

## Enforcement

- suppressed-skills.json prevents skill-level duplicates from returning.
- do-not-crawl.json prevents blocked repos and owners from being re-crawled.
- removal-audit is documentation only and does not control crawler behavior.

## Summary

- Suppressed skills: 2800
- Suppression batches: 6
- Missing replacement warnings: 155
- Do-not-crawl repos: 13
- Do-not-crawl owners: 1

## Suppressions by Reason

- catalog-copy: 99
- collection-like-copy: 171
- low-signal-copy: 456
- same-publisher: 1774
- trusted-owner: 300

## Suppressions by Confidence

- high: 2800

## Batches

### 2026-07-06T20:25:56.680Z

- Count: 72
- Reasons: same-publisher=6, trusted-owner=66
- Confidence: high=72
- Sample IDs: AWS-Educate/template-nextjs-sanity-tailwind-amplify:.agents/skills/agent-development, AWS-Educate/template-nextjs-sanity-tailwind-amplify:.agents/skills/command-development, AbdullahMalik17/Digital-FTE:.claude/skills/docx, AbdullahMalik17/Digital-FTE:.gemini/skills/docx, AbdullahMalik17/Hacathan_5:.claude/skills/docx, AbdullahMalik17/My_skills:.claude/skills/docx, Activer007/ordinary-claude-skills:skills_categorized/llm-ai/claude-opus-4-5-migration, Angelo0218/blocktic-backend:.agents/skills/agent-development, Angelo0218/blocktic-backend:.agents/skills/claude-opus-4-5-migration, Angelo0218/blocktic-backend:.agents/skills/command-development

### 2026-07-06T20:26:56.405Z

- Count: 1792
- Reasons: same-publisher=1728, trusted-owner=64
- Confidence: high=1792
- Sample IDs: 0xDarkMatter/claude-mods:skills/code-stats, 23blocks-OS/ai-maestro-plugins:plugins/ai-maestro/skills/ai-maestro-agents-management, 23blocks-OS/ai-maestro-plugins:plugins/ai-maestro/skills/docs-search, 23blocks-OS/ai-maestro-plugins:src/skills/graph-query, 420company/artemis:cco-zoom-plugin-phone, AIDotNet/MoYuCode:skills/tools/bilibili-analyzer, AR6420/Hail_Hydra:files, AWS-Educate/template-nextjs-sanity-tailwind-amplify:.agents/skills/claude-automation-recommender, Aaronontheweb/dotnet-skills:skills/csharp-coding-standards, Aaronontheweb/dotnet-skills:skills/csharp-concurrency-patterns

### 2026-07-06T20:52:25.119Z

- Count: 177
- Reasons: same-publisher=7, trusted-owner=170
- Confidence: high=177
- Sample IDs: 3172973615/skill-explore:gmail-skill, 9aia/pachira:nuxt-seo, ArogyaReddy/alirezarezvani-claude-skills:ciso-advisor, ArogyaReddy/alirezarezvani-claude-skills:helm-chart-builder, ArogyaReddy/alirezarezvani-claude-skills:ra-qm-team, ArogyaReddy/alirezarezvani-claude-skills:research-summarizer, AxelMrak/ai:skills/app-store-optimization, BbgnsurfTech/claude-skills-collection:community/claude-code-skill-factory/generated-skills/agent-factory, BbgnsurfTech/claude-skills-collection:community/claude-code-skill-factory/generated-skills/codex-cli-bridge, BbgnsurfTech/claude-skills-collection:community/claude-code-skill-factory/generated-skills/hook-factory

### 2026-07-06T20:57:44.716Z

- Count: 627
- Reasons: collection-like-copy=171, low-signal-copy=456
- Confidence: high=627
- Sample IDs: 2670044605/agent-skills-hub:audiocut-keyword, 2670044605/agent-skills-hub:image-generator, 2670044605/agent-skills-hub:voice-changer, AIA-11-HN-MIB/MIB-MockInterviewAIBot:.claude/skills/aesthetic, AIA-11-HN-MIB/MIB-MockInterviewAIBot:.claude/skills/backend-development, AIA-11-HN-MIB/MIB-MockInterviewAIBot:.claude/skills/chrome-devtools, AIA-11-HN-MIB/MIB-MockInterviewAIBot:.claude/skills/ffmpeg, AIA-11-HN-MIB/MIB-MockInterviewAIBot:.claude/skills/problem-solving/collision-zone-thinking, AJBcoding/claude-skill-eval:.claude/skills/claude-d3js-skill-main, AJBcoding/claude-skill-eval:.claude/skills/csv-data-summarizer-claude-skill-main

### 2026-07-06T22:42:06.239Z

- Count: 99
- Reasons: catalog-copy=99
- Confidence: high=99
- Sample IDs: Activer007/ordinary-claude-skills:notebooklm-skill, Activer007/ordinary-claude-skills:skills_all/archon, Activer007/ordinary-claude-skills:skills_all/bioservices, Activer007/ordinary-claude-skills:skills_all/data-sourcing, Activer007/ordinary-claude-skills:skills_all/data-transform, Activer007/ordinary-claude-skills:skills_all/deal-desk, Activer007/ordinary-claude-skills:skills_all/deepchem, Activer007/ordinary-claude-skills:skills_all/ena-database, Activer007/ordinary-claude-skills:skills_all/lint, Activer007/ordinary-claude-skills:zapier-workflows

### 2026-07-08T15:42:32.679Z

- Count: 33
- Reasons: same-publisher=33
- Confidence: high=33
- Sample IDs: K-Dense-AI/claude-scientific-skills:scientific-skills/ginkgo-cloud-lab, K-Dense-AI/claude-scientific-skills:scientific-skills/infographics, MetaMask/ocap-kernel:.claude/skills/commit, TermiX-official/cryptoclaw:skills/bird, Tibsfox/gsd-skill-creator:examples/skills/physical-education/inclusive-physical-education, anthropics/skills:skills/slack-gif-creator, anthropics/skills:skills/theme-factory, anthropics/skills:skills/web-artifacts-builder, dojoengine/book:skills/dojo-indexer, guia-matthieu/clawfu-skills:skills/ai-design/image-to-3d-pipeline

## Top Removed Repos

- aj-geddes/useful-ai-prompts: 233
- diegosouzapw/awesome-omni-skill: 143
- ruvnet/claude-flow: 97
- gabrielmoreira/agent-skills-mirror: 74
- erichowens/some_claude_skills: 50
- adaptationio/Skrillz: 49
- wshobson/agents: 46
- K-Dense-AI/claude-scientific-skills: 43
- Jeffallan/claude-skills: 39
- github/awesome-copilot: 38
- giuseppe-trisciuoglio/developer-kit: 37
- RefoundAI/lenny-skills: 36
- posthog/ai-plugin: 34
- trailofbits/skills: 34
- parcadei/Continuous-Claude-v3: 33
- athina-ai/goose-skills: 31
- gooseworks-ai/goose-skills: 29
- microsoft/power-platform-skills: 29
- ilang-ai/autocode: 27
- jezweb/claude-skills: 27

## Top Removed Owners

- aj-geddes: 234
- diegosouzapw: 143
- ruvnet: 97
- gabrielmoreira: 74
- K-Dense-AI: 57
- posthog: 57
- erichowens: 50
- adaptationio: 49
- wshobson: 46
- github: 42
- Jeffallan: 39
- giuseppe-trisciuoglio: 37
- AutumnsGrove: 36
- RefoundAI: 36
- trailofbits: 34
- parcadei: 33
- athina-ai: 31
- microsoft: 30
- gooseworks-ai: 29
- ilang-ai: 27

## Do Not Crawl

- catalog: 9
- low-quality: 1
- marketplace: 1
- spam: 1
- template-clone: 2

## Missing Replacement Warnings

These are warnings, not publish blockers. They usually mean an earlier canonical replacement was later filtered or suppressed by a stronger cleanup rule.

### Categories

- case-only-id-difference: 30
- catalog-like-replacement-filtered: 31
- missing-replacement: 3
- replacement-suppressed: 1
- same-repo-replacement-filtered: 90

### Samples

- Activer007/ordinary-claude-skills:notebooklm-skill -> PleasePrompto/notebooklm-skill
- akiojin/playfab-mcp-server:.claude/skills/writing-rules -> Microck/ordinary-claude-skills:skills_categorized/mobile/rule-identifier
- Aradotso/trending-skills:openclaude-multi-llm -> aradotso/trending-skills:openclaude-multi-llm
- BbgnsurfTech/claude-skills-collection:community/superpowers-skills/skills/meta/gardening-skills-wiki -> BbgnsurfTech/claude-skills-collection:gardening-skills-wiki
- BbgnsurfTech/claude-skills-collection:docker-compose-generator -> BbgnsurfTech/claude-skills-collection:plugins/claude-code-plugins-plus/plugins/devops/docker-compose-generator/skills/docker-compose-generator
- boisenoise/skills-collections:skills/context-eng-bdi-mental-states -> guanyang/antigravity-skills:skills/bdi-mental-states
- boisenoise/skills-collections:skills/context-eng-context-fundamentals -> guanyang/antigravity-skills:skills/context-fundamentals
- boisenoise/skills-collections:skills/context-eng-evaluation -> guanyang/antigravity-skills:skills/evaluation
- boisenoise/skills-collections:skills/context-eng-filesystem-context -> guanyang/antigravity-skills:skills/filesystem-context
- boisenoise/skills-collections:skills/context-eng-memory-systems -> guanyang/antigravity-skills:skills/memory-systems
- boisenoise/skills-collections:skills/linear-claude-skill -> boisenoise/skills-collections:linear-claude-skill
- brycewang-stanford/auto-empirical-research-skills:digital-humanities-guide -> brycewang-stanford/Auto-Empirical-Research-Skills:digital-humanities-guide
- coderwanfeng/python-office:compress_image -> CoderWanFeng/python-office:compress_image
- comeonzhj/auto-redbook-skills -> comeonzhj/Auto-Redbook-Skills
- CoralShades/acm-ai:.claude/commands/agent-browser -> shanraisshan/claude-code-best-practice:.claude/skills/agent-browser
- denissergeevitch/repo-task-proof-loop -> DenisSergeevitch/repo-task-proof-loop
- diegosouzapw/awesome-omni-skill:active-interleave-majiayu000 -> diegosouzapw/awesome-omni-skill:active-interleave
- diegosouzapw/awesome-omni-skill:agency-researcher-majiayu000 -> diegosouzapw/awesome-omni-skill:agency-researcher
- diegosouzapw/awesome-omni-skill:agent-protocol-majiayu000 -> diegosouzapw/awesome-omni-skill:agent-protocol
- diegosouzapw/awesome-omni-skill:agentuity-cli-auth-login-majiayu000 -> diegosouzapw/awesome-omni-skill:agentuity-cli-auth-login
- diegosouzapw/awesome-omni-skill:analyze-patterns-majiayu000 -> diegosouzapw/awesome-omni-skill:analyze-patterns
- diegosouzapw/awesome-omni-skill:analyze-patterns-mattjefferson -> diegosouzapw/awesome-omni-skill:analyze-patterns
- diegosouzapw/awesome-omni-skill:api-admin-ops-majiayu000 -> diegosouzapw/awesome-omni-skill:api-admin-ops
- diegosouzapw/awesome-omni-skill:api-documentor-majiayu000 -> diegosouzapw/awesome-omni-skill:api-documentor
- diegosouzapw/awesome-omni-skill:bio-single-cell-cell-annotation-majiayu000 -> diegosouzapw/awesome-omni-skill:bio-single-cell-cell-annotation
- diegosouzapw/awesome-omni-skill:browser-dev-tools-majiayu000 -> diegosouzapw/awesome-omni-skill:browser-dev-tools
- diegosouzapw/awesome-omni-skill:capacitor-ci-cd-cap-go -> diegosouzapw/awesome-omni-skill:capacitor-ci-cd
- diegosouzapw/awesome-omni-skill:capacitor-ci-cd-majiayu000 -> diegosouzapw/awesome-omni-skill:capacitor-ci-cd
- diegosouzapw/awesome-omni-skill:capacitor-ci-cd-neversight -> diegosouzapw/awesome-omni-skill:capacitor-ci-cd
- diegosouzapw/awesome-omni-skill:capacitor-ci-cd-yeohj0710 -> diegosouzapw/awesome-omni-skill:capacitor-ci-cd
- diegosouzapw/awesome-omni-skill:cc-get-session-id-majiayu000 -> diegosouzapw/awesome-omni-skill:cc-get-session-id
- diegosouzapw/awesome-omni-skill:ccn-create-topic -> diegosouzapw/awesome-omni-skill:ccn-create-topic-majiayu000
- diegosouzapw/awesome-omni-skill:compliance_check-kyteapp -> diegosouzapw/awesome-omni-skill:compliance_check
- diegosouzapw/awesome-omni-skill:content-marketer-neversight -> diegosouzapw/awesome-omni-skill:content-marketer-majiayu000
- diegosouzapw/awesome-omni-skill:core-life-ops-majiayu000 -> diegosouzapw/awesome-omni-skill:core-life-ops
- diegosouzapw/awesome-omni-skill:dapr-integration-maneeshanif -> diegosouzapw/awesome-omni-skill:dapr-integration
- diegosouzapw/awesome-omni-skill:ddd-check-majiayu000 -> diegosouzapw/awesome-omni-skill:ddd-check
- diegosouzapw/awesome-omni-skill:denote-org-majiayu000 -> diegosouzapw/awesome-omni-skill:denote-org
- diegosouzapw/awesome-omni-skill:email-triage-draft-replies-majiayu000 -> diegosouzapw/awesome-omni-skill:email-triage-draft-replies
- diegosouzapw/awesome-omni-skill:extracting-learned-skills-majiayu000 -> diegosouzapw/awesome-omni-skill:extracting-learned-skills
- diegosouzapw/awesome-omni-skill:fdc-expert-majiayu000 -> diegosouzapw/awesome-omni-skill:fdc-expert
- diegosouzapw/awesome-omni-skill:fix-markdown-majiayu000 -> diegosouzapw/awesome-omni-skill:fix-markdown
- diegosouzapw/awesome-omni-skill:fullstack-feature-mgd34msu -> diegosouzapw/awesome-omni-skill:fullstack-feature
- diegosouzapw/awesome-omni-skill:gates-majiayu000 -> diegosouzapw/awesome-omni-skill:gates
- diegosouzapw/awesome-omni-skill:google-docs-manager-majiayu000 -> diegosouzapw/awesome-omni-skill:google-docs-manager
- diegosouzapw/awesome-omni-skill:iac-diagram-generator-johnpsasser -> diegosouzapw/awesome-omni-skill:iac-diagram-generator
- diegosouzapw/awesome-omni-skill:iac-diagram-generator-majiayu000 -> diegosouzapw/awesome-omni-skill:iac-diagram-generator
- diegosouzapw/awesome-omni-skill:import-organization-majiayu000 -> diegosouzapw/awesome-omni-skill:import-organization
- diegosouzapw/awesome-omni-skill:keynote-slides-dbmcco -> diegosouzapw/awesome-omni-skill:keynote-slides
- diegosouzapw/awesome-omni-skill:keynote-slides-majiayu000 -> diegosouzapw/awesome-omni-skill:keynote-slides
