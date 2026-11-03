# Curation proposal: 123 skills whose source is gone

Draft, 2026-10-29. Not applied. These skills are held out of the 6,939 removal (`index/reports/source-removal-20261029/held-for-curation.json`) because creator pages or collections feature them. Once this lands, they can be suppressed in a second batch under the 500 limit.

## 1. Swaps (automatic)

Creator pages: same creator, same skill name, original source. Collections: the most-starred original skill with the same name from another creator.

- creator openai: `openai/codex:plugin-creator` → `openai/skills:plugin-creator`
- creator steipete: `clawdbot/skills:skills/steipete/obsidian` → `steipete/agent-scripts:skills/obsidian`
- creator yeachan-heo: `yeachan-heo/oh-my-claudecode:ultraqa` → `Yeachan-Heo/oh-my-codex:skills/ultraqa`
- creator yeachan-heo: `yeachan-heo/oh-my-claudecode:ultrawork` → `Yeachan-Heo/oh-my-codex:skills/ultrawork`
- creator microsoft: `microsoft/vscode:anthropic-sdk-upgrader` → `microsoft/vscode-copilot-chat:anthropic-sdk-upgrader`
- collection build-ios-apps: `coreyhaines31/marketingskills:aso-audit` → `eronred/aso-skills:aso-audit`
- collection video-motion-graphics: `heygen-com/hyperframes:animejs` → `freshtechbro/claudedesignskills:animejs`

## 2. Drops (automatic)

No same-creator replacement; removed from the list:

- creator steipete: 17 of 19 (`1password`, `1password`, `github`, `brave-search`, …)
- creator danielmiessler: 11 of 20 (`Loop`, `CMUX`, `Apify`, `Browser`, …)
- creator apify: 10 of 30 (`apify-audience-analysis`, `apify-brand-reputation-monitoring`, `apify-competitor-intelligence`, `apify-content-analytics`, …)
- creator openai: 8 of 20 (`code-review`, `code-review-change-size`, `code-review-context`, `code-review-testing`, …)
- creator antfu: 8 of 17 (`slidev`, `tsdown`, `turborepo`, `vue-best-practices`, …)
- creator mattpocock: 7 of 13 (`caveman`, `diagnose`, `edit-article`, `qa`, …)
- creator elastic: 7 of 39 (`elasticsearch-audit`, `elasticsearch-authn`, `elasticsearch-authz`, `elasticsearch-security-troubleshooting`, …)
- creator heygen-com: 6 of 10 (`animejs`, `css-animations`, `gsap`, `hyperframes-media`, …)
- creator bmad-code-org: 5 of 36 (`bmad-correct-course`, `bmad-create-epics-and-stories`, `bmad-help`, `bmad-spec`, …)
- creator GoogleCloudPlatform: 5 of 37 (`gke-cluster-creator`, `gke-compute-class-creator`, `gke-inference-quickstart`, `gke-workload-scaling`, …)
- creator coreyhaines31: 4 of 20 (`aso-audit`, `ab-test-setup`, `analytics-tracking`, `competitor-alternatives`)
- creator yeachan-heo: 3 of 20 (`learner`, `mcp-setup`, `sciomc`)
- creator expo: 3 of 10 (`expo-api-routes`, `expo-cicd-workflows`, `expo-deployment`)
- creator supermemoryai: 2 of 6 (`super-save`, `super-search`)
- creator JimLiu: 2 of 26 (`baoyu-image-cards`, `baoyu-imagine`)
- creator mvanhorn: 2 of 19 (`search-x`, `printing-press-catalog`)
- creator microsoft: 2 of 10 (`fix-errors`, `add-policy`)
- creator cloudflare: 2 of 9 (`add-autogate`, `add-compat-flag`)
- creator flutter: 2 of 10 (`proofread-markdown`, `add-dart-lint-validation-rule`)
- creator Unity-Technologies: 2 of 40 (`tilemap-palette-create`, `tilemap-ruletile-createempty`)
- creator android: 1 of 11 (`styles`)
- creator juliusbrussee: 1 of 19 (`fuck-slop`)
- creator trailofbits: 1 of 10 (`ask-questions-if-underspecified`)
- creator davidondrej: 1 of 10 (`launch-subagent`)
- creator sunflower-of-parchman: 1 of 1 (`codex-hygiene`)
- creator neondatabase: 1 of 24 (`claimable-postgres`)
- creator figma: 1 of 15 (`figma-create-design-system-rules`)
- collection starter-pack: 1 (`code-review`)
- collection video-motion-graphics: 1 (`Remotion`)
- collection trading-investing: 1 (`ito-market-intelligence`)
- collection social-media: 1 (`social-content`)
- collection writing: 1 (`edit-article`)

## 3. Backfill suggestions (needs your pick)

Pages that lose a third or more. Suggestions come from the creator's own live skills, highest stars first, with at most two per repository or plugin and repo-internal tooling left out. Strike any you don't want.

**openai** (20 featured, 8 dropped):

- `openai/codex:imagegen`: Generate or edit raster images when the task benefits from AI-created 
- `openai/openai-agents-python:prior-auth-packet-builder`: Build a concise prior authorization packet from local case files and p
- `openai/plugins:plugins/codex-security/skills/attack-path-analysis`: Use when Codex is already in the attack-path-analysis phase of a secur
- `openai/plugins:plugins/codex-security/skills/deep-security-scan`: Use when the user asks for a deep, exhaustive, multi-pass, or variance
- `openai/plugins:agent-browser`: Browser automation CLI for AI agents. Use when the user needs to inter
- `openai/plugins:agent-browser-verify`: Automated browser verification for dev servers. Triggers when a dev se
- `openai/plugins:agents-sdk`: Build AI agents on Cloudflare Workers using the Agents SDK. Load when 
- `openai/plugins:alphafold-skill`: Submit compact AlphaFold Protein Structure Database API requests for p

**mattpocock** (13 featured, 7 dropped):

- `mattpocock/skills:skills`: Use when writing a PR body.
- `mattpocock/skills:claude-handoff`: Hand the current conversation off to a fresh background agent that pic

**steipete** (19 featured, 17 dropped):

- `steipete/agent-scripts:skills/agent-transcript`: Requested GitHub PR/issue agent transcripts: redact, trim, preview, an
- `steipete/agent-scripts:skills/browser-use`: Control the user's existing signed-in Chrome: callable Codex Chrome pl
- `steipete/oracle:oracle`: Oracle second-model review: bundle prompts/files, debug, refactor, des
- `steipete/Nameplate:skills/nameplate-attention`: On-screen agent alert: topmost message card + pulsating screen borders
- `steipete/triage:openclaw/clawblocker/skills/bird-twitter-moderation`: Review X accounts with bird before blocking or muting.

**danielmiessler** (20 featured, 11 dropped):

- `danielmiessler/LifeOS:Aphorisms`: Curated aphorism collection with CRUD: content-based matching, themed 
- `danielmiessler/LifeOS:Cortex`: LifeOS memory, prior-session recall, and learning capture. USE WHEN ca
- `danielmiessler/Personal_AI_Infrastructure:CreateSkill`: Create and validate skills. USE WHEN create skill, new skill, skill st
- `danielmiessler/Personal_AI_Infrastructure:Science`: Universal thinking and iteration engine based on the scientific method
- `danielmiessler/PAIPlugin:skills/alex-hormozi-pitch`: Create irresistible offers and pitches using Alex Hormozi's methodolog
- `danielmiessler/PAIPlugin:skills/always-init`: Universal task initializer that automatically loads PAI context for al

**antfu** (17 featured, 8 dropped):

- `antfu/skills:skills/nitro`: Nitro is the framework-agnostic server toolkit (powering Nuxt) for bui
- `antfu/skills:skills/antfu-design`: antfu-style design conventions, broadened. UnoCSS-first, class-based s
- `antfu/design:antfu-design`: Use when building or restyling devtools-style Vue 3 UIs with @antfu/de

**heygen-com** (10 featured, 6 dropped):

- `heygen-com/hyperframes:figma`: Bring Figma into a HyperFrames video - rendered assets, brand tokens, 
- `heygen-com/hyperframes:skills/media-use`: Get or make any media for a HyperFrames video - music, sound effects, 
- `heygen-com/skills:heygen-avatar`: Create a persistent HeyGen avatar — a reusable face + voice identity f
- `heygen-com/skills:heygen-translate`: Translate and dub a video into another language with voice cloning and
- `heygen-com/hyperframes-community-skills:duo`: Composite any two HTML screens into a locked photo plate of hands hold
- `heygen-com/heygen-cli`: Create AI videos, manage avatars, translate videos, and download resul

## Not covered

- `sunflower-of-parchman` loses its only featured skill and has no other live skills; the page would show none.
- The 7 collection members: 2 are swapped above; `starter-pack` loses `openai/codex:code-review` (it still has obra's requesting-code-review), and `trading-investing`, `social-media`, `writing` and `video-motion-graphics` (LifeOS Remotion) each lose one with no clear swap.
