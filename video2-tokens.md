# Video 2 — Claude Code Skills to Reduce Token Usage — 4 Free Skills

Format: listicle (vidspec.md) · Target: "claude code skills to reduce token usage" (autocomplete 2x + collection demand)
Runtime: 1:40 · Maps to: /collections/reduce-token-usage/ (existing page)

## Clean transcript (publish this: YouTube description + page embed)

Claude Code eats tokens fast. Every skill you install, every memory file, every big log dump takes a slice of the context window — and a bloated context means worse answers, shorter sessions, and a bigger bill. These are four free Claude Code skills to reduce token usage. They work on Claude, Codex, Cursor, or any agent you're working with.

First, caveman, by Julius Brussee. It puts your agent in ultra-compressed communication mode: short words, no filler, no politeness padding. The answers stay complete — they just cost a fraction of the tokens to say.

Second, caveman-compress, from the same repo. It compresses memory files like CLAUDE.md or a todo list into caveman format while keeping them readable. Your standing instructions load in every single session, so shrinking them once saves tokens every time.

Third, context-mode, by mksglu. Instead of dumping large command outputs into the conversation, it processes them through dedicated context tools. Logs and big files stop flooding your context window.

Fourth, context-budget. It audits what is actually consuming your context window — agents, skills, MCP servers, and rules — so you can see exactly what to prune before your sessions slow down.

All four are free and open source, and they're collected with more in the reduce token usage collection at omgskills.com. They work on Claude, Codex, Cursor — or any agent you're working with. And that's how you reduce token usage in Claude Code. Links and install commands are below.

## Metadata

- **Title:** Claude Code Skills to Reduce Token Usage — 4 Free Skills
- **Description line 1:** Four free Claude Code skills to reduce token usage and context bloat, with install commands.
- **Description body:** link to https://omgskills.com/collections/reduce-token-usage/ → full clean transcript → install commands → guide FAQ link https://omgskills.com/guide/
- **Chapters** (measured from final reduce.mp4): 0:00 Intro · 0:15 caveman · 0:27 caveman-compress · 0:40 context-mode · 0:51 context-budget · 1:02 Wrap. Upload reduce-trim.mp4 (78.3s); original had 23.5s black/silent tail.
- **AI disclosure:** tick YouTube's synthetic-media box.
- Editorial note: context-budget (@affaan-m) gets no spoken author credit — cover, don't feature. On-screen credit stays factual.

## Skills featured

| # | Skill | Author | Page |
|---|---|---|---|
| 1 | caveman | @JuliusBrussee | https://omgskills.com/skills/juliusbrussee/caveman/plugins/caveman/skills/caveman/ |
| 2 | caveman-compress | @JuliusBrussee | https://omgskills.com/skills/juliusbrussee/caveman/compress/ |
| 3 | context-mode | @mksglu | https://omgskills.com/skills/mksglu/context-mode/context-mode/ |
| 4 | context-budget | @affaan-m | https://omgskills.com/skills/affaan-m/ecc/context-budget/ |

## Production notes

- Audio: tokens2.mp3 → public/audio/video2.mp3 (99.7s, tighter intro). Skill 1 anchored at 0:19 by ear;
  remaining timings word-count estimates — verify: 35 / 52 / 66 / 80.5.
- Pronunciation to verify: "M-K-S-glu" (TTS spelling for mksglu).
- Render: `npx remotion render Video2Tokens` / `Video2TokensPortrait`.
