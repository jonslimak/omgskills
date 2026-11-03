# vidspec — video production spec

Rules and templates for producing omgskills videos. Goal: rank in video SERPs and get cited by LLMs for terms we have demand evidence for. Views are not the goal; search and citation are.

## The two formats

| | Listicle | Single-skill |
|---|---|---|
| Targets | Use-case queries ("best skills for SEO", "reduce token usage") | Skill-name queries ("babysit pr skill") |
| Skills per video | 3–5 (quality bar decides — never pad to hit a count) | 1 |
| Length | 3–5 min | 60–120 sec |
| Maps to | A collection page (1:1) | A skill page (1:1) |
| When to make | Query cluster has GSC impressions, or collection exists with demand evidence | Skill name appears in GSC queries. Never for un-searched skills |

## Query selection rules

1. ~75% of videos target terms we already have GSC impressions for. No guessing.
2. ~25% target "how to" reformulations of proven topics (video-shaped intent: "how to install skills in claude code"). These are the only "new" terms allowed.
3. One topic can get both formats if intents differ (e.g. "connect stripe to claude" listicle + "how to connect stripe to claude" walkthrough).
4. After 60 days, pick new targets from GSC video filter + YouTube search-terms report — demand-first, same as collections.

## Script template — listicle (3–5 skills)

```
[0:00–0:20] Hook + query restated verbatim
  "The five best Claude Code skills for <use case>. All free,
   all open source, all installable in one click."
[0:20–0:45] Context (one idea only)
  Why this use case needs skills; one sentence on what skills are,
  pointing to the guide for more.
[per skill — 40–60 sec each, 5x]
  - Say the skill NAME out loud first (auto-chapters + key moments
    key off transcript structure)
  - What it does (1–2 sentences, from catalog description)
  - One concrete moment of it working (screen footage)
  - Spoken source: "free on omgskills" (install links live in the description, not on screen)
[final 15 sec] Wrap
  "All five are in the <name> collection on omgskills.com — link below."
```

## Script template — single-skill (60–120 sec)

```
[0:00–0:10] Name + one-line claim
  "<skill-name> — the skill that <what it does>."
[0:10–0:30] The problem it solves (concrete, not abstract)
[0:30–1:20] It working (screen footage, narrated)
[1:20–1:40] Install: command on screen, spoken; author credit
  ("by <creator>, free on omgskills")
```

## Script rules

- Scripts are generated from catalog data (description, install_cmd, stats, README snippet) then hand-tightened. TTS exposes filler — cut every sentence that doesn't inform.
- Speak skill and creator names exactly as written; they are the entities we want associated.
- The target query phrase must appear verbatim in: title, first 20 seconds of speech, and description.
- No hype adjectives ("amazing", "game-changing"). House voice: factual, dry, occasionally funny.

## Production rules

- The full production pipeline, settled design decisions, and Remotion project live in the
  `omgvid` skill (`~/.claude/skills/omgvid/SKILL.md`) and `video/remotion/`. This doc owns
  strategy (formats, query selection, volume caps, measurement); omgvid owns execution.

- **Audio**: ElevenLabs TTS. Tick YouTube's synthetic-media disclosure box. Fine.
- **Visuals**: product footage only — screen recordings of omgskills pages/app, or DOM/CSS animated mockups (hero-animation technique). Creator/company logos and GitHub avatars are OK (we promote and distribute their content; badge on intro card via `authorLogo` in the video JSON). Stock imagery only as last resort.
- **Skill cards carry no omgskills URL** — the video is about the skills; our credit lives in the intro, wrap, corner watermark, and description. Install links + commands go in the description (required).

## Metadata rules

- **YouTube title** = the target query, naturally phrased. "The 5 Best Claude Code Skills for SEO" not "SEO Skills You NEED".
- **On-screen title** (intro card) can differ from the YouTube title: use natural product phrasing that names skills (e.g. on-screen "Stripe Skills for Claude Code" vs YT title "How to Connect Stripe to Claude Code"). JSON: `displayTitle` vs `title`.
- **Description**: first line = query restated + link to the matching omgskills page. Then the FULL transcript. Then install commands for every skill shown.
- **Chapters**: timestamp per skill, labeled with the skill name.
- **One video = three surfaces**, always shipped together:
  1. YouTube upload (title/description/chapters per above)
  2. Embed on the matching omgskills collection/skill page with VideoObject schema
  3. Transcript on that page (and in the YT description)

## Volume caps (spam-protection)

- First batch: 8 videos max — 5 listicles + 3 singles.
- No more uploads until the 60-day checkpoint.
- Vary structure between videos enough that they don't read as one template (different hooks, different segment orders).
- Never batch-upload; 2–3 per week max.

## First batch (8)

| # | Format | Target term | Evidence | Maps to |
|---|---|---|---|---|
| 1 | Listicle | connect stripe to claude | 105+ impressions, pos ~40 | new Stripe page |
| 2 | Listicle | claude code skills to reduce token usage | autocomplete 2x + collection | /collections/reduce-token-usage/ |
| 3 | Listicle | best claude code skills for seo | GSC "claude seo audit skill" | /collections/seo/ |
| 4 | Listicle | best claude code skills (starter) | head query | /collections/starter-pack/ |
| 5 | Listicle | claude code skills for ios development | collection + GSC | /collections/build-ios-apps/ |
| 6 | Single | babysit pr skill | GSC impressions | skill page |
| 7 | Single | acquire codebase knowledge | 16 impressions, pos 6.6 | skill page |
| 8 | How-to | how to install skills in claude code | procedural reformulation | /guide/ |

## 60-day checkpoint (measure before scaling)

- GSC: search appearance → videos filter; impressions/clicks per target query.
- YouTube Studio: traffic source = search; which terms.
- Any LLM citation sightings (Perplexity/ChatGPT referrals in Humblytics/Netlify).
- Scale the winning FORMAT, not the raw count.
