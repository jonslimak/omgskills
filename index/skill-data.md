# omgskills Data Reports

Four HTML reports are generated from the omgskills skill index. They are combined into a single tabbed file (`dashboard.html`) for everyday use, but can also be opened individually.

---

## Quick Start

```bash
open index/dashboard.html   # all 4 reports in one tabbed view
```

To rebuild after a new scrape, see [Full Rebuild Sequence](#full-rebuild-sequence).

---

## Credentials

### What needs a key and what doesn't

All four HTML reports **read pre-built JSON files and require no API keys at runtime.** Keys are only needed when regenerating the source data.

### `GITHUB_TOKEN` — required to rebuild source data

Needed by: `npm run content:enrich-basket` (fetches forks, watchers, open issues, push date per repo via GitHub API)

Without it the enrichment step throws immediately:
```
Error: GITHUB_TOKEN missing — create index/.env with GITHUB_TOKEN=<fine-grained PAT>
```

**How to set it:**

1. Go to https://github.com/settings/tokens and create a fine-grained PAT
2. Required permission: **read-only access to public repositories** (no write scopes needed)
3. Create `index/.env` (already gitignored):
   ```
   GITHUB_TOKEN=your_fine_grained_github_token
   ```

A template exists at `index/.env.example`.

### X / Twitter credentials — optional, unrelated to the reports

`X_AUTH_TOKEN` and `X_CT0` are browser session cookies from a logged-in Twitter/X session. Used only by `npm run scrape:x` and `npm run collect:x-skill-tweets`. None of the four reports use these. Set `ENABLE_X_SOCIAL=0` (the default) to skip X enrichment entirely.

### Scripts that need no keys

These only read local JSON files:

- `npm run content:stats` — reads `skills.json`, `trending.json`, `gold-basket.json`
- `npm run content:stats-html` — reads `stats.json`
- `npm run content:leaderboards` — reads `skills.json`, `trending.json`, `gold-basket.json`
- `npm run content:review-html` — reads `gold-basket.json`
- `npm run content:growth-html` — reads `snapshots/`, `skills.json`
- `npm run content:dashboard` — reads the four generated HTML files
- `npm run scrape:trending` — crawls skills.sh (public, no auth)

---

## Data Pipeline Overview

```
GitHub / skills.sh crawl
        ↓
   skills.json          ← 47k+ skills (id, name, stars, tags, author, description)
   trending.json        ← ~342 trending entries (installs, rank) from skills.sh
        ↓
fetch-external-essentials  →  external-essentials.json
        ↓
build-gold-basket          →  gold-basket.json   (420 curated skills, scored & niched)
        ↓
enrich-gold-basket         →  gold-basket.json   (adds gh_forks, gh_watchers, gh_open_issues, gh_days_since_push)
        ↓
  ┌──────────┬──────────────┬────────┬───────────────┐
  │  Stats   │ Leaderboards │ Growth │  Gold Basket  │
  └──────────┴──────────────┴────────┴───────────────┘
        ↓
    dashboard.html  (all 4 tabs combined)
```

### Source files

| File | What it contains |
|------|-----------------|
| `index/skills.json` | Full index of 47k+ skills. Fields: `id`, `name`, `description`, `github_url`, `install_cmd`, `author_handle`, `tags`, `stars`, `last_updated`, `first_seen` |
| `index/trending.json` | ~342 skills ranked by installs from skills.sh. Fields: `id`, `installs`, `trending_rank`, `trending_source` |
| `index/external-essentials.json` | Skills that appear on 2+ external curated lists (awesome-claude-skills, etc.). Used to boost scores |
| `index/gold-basket.json` | 420 curated, scored, GitHub-enriched skills. The richest data source |
| `index/snapshots/trending-YYYY-MM-DD.json` | Dated archives of trending.json. Grows by one file each time `npm run scrape:trending` runs |

---

## Report 1 — Stats

**What it is:** Data-mining findings across the full skill index. Each section follows HOOK → DATA → ANGLE storytelling and includes ready-to-copy tweet hooks.

**Output files:** `index/stats.json`, `index/stats-report.html`

**How to run:**
```bash
cd index
npm run content:stats        # computes findings → writes stats.json
npm run content:stats-html   # renders stats-report.html from stats.json
```

**Scripts:**
- `index/scraper/content/compute-stats.ts`
- `index/scraper/content/build-stats-html.ts`

**8 sections (ordered by tweet-worthiness):**

| Section | Hook example |
|---------|-------------|
| Install Power Law | "X skills drive 80% of all installs" |
| Hidden Gems | "X skills with 500+ stars have zero installs" |
| Official vs Community | "Vendor skills get Nx more installs than community" |
| Stars Power Law | "X% of skills have zero stars" |
| Niche Breakdown | "Which niche dominates installs vs which is last" |
| Tag Intelligence | "Top tag co-occurrence pairs — the ecosystem's real shape" |
| Author Intelligence | "Most prolific vs highest avg-stars author" |
| GitHub Health | "Freshest vs stalest niche by days since push" |

**`stats.json` shape:**
```json
{
  "generated_at": "2026-05-06T...",
  "total_skills": 47113,
  "sections": [
    {
      "id": "install_power_law",
      "hook": "5 skills drive 80% of all installs",
      "angle": "The so-what narrative",
      "data": { ... },
      "tweet_hooks": ["tweet-ready string under 280 chars", "..."]
    }
  ]
}
```

**Inputs required:** `skills.json`, `trending.json`, `gold-basket.json` (must be enriched)

---

## Report 2 — Creator Leaderboards

**What it is:** Rankings of individual skill authors across 6 trophy categories. Includes a GOAT section, a Stars vs Installs contrast callout, and per-card PNG download buttons for sharing on Twitter.

**Output file:** `index/leaderboards.html`

**How to run:**
```bash
cd index
npm run content:leaderboards
```

**Script:** `index/scraper/content/build-leaderboards-html.ts`

**6 trophy categories:**

| Trophy | What it measures |
|--------|-----------------|
| 🏆 Most Influential | Total stars across all skills (min 3 skills) |
| ⚡ Most Used | Total installs across all skills |
| 💎 Peak Achiever | Highest single-skill star count (min 2 skills) |
| 🎯 Most Consistent | Highest avg stars per skill (min 5 skills) |
| 📚 Most Prolific | Most skills published (quality floor: avg ≥ 500 stars) |
| 🚀 Install Efficiency | Avg installs per skill (min 3 skills with installs) |

**Filter buttons:** All / Community only / Official only
- Each category stores 20 entries so filtering to Community always shows 10 results
- "Official" = accounts in the hardcoded `VENDOR_HANDLES` set in `build-leaderboards-html.ts`

**GOAT section:** Authors who rank in the top 5 of 3+ categories get promoted to an "All-Rounders" section at the top.

**PNG download:** Each trophy card has a **↓ PNG** button. Clicking it hides UI chrome, renders the card at 2× resolution via html2canvas, and downloads `omgskills-{id}-leaderboard.png`. The filter state is respected — filter to Community first to get a community-only card.

**Adding a new trusted vendor:** The vendor set is hardcoded in **two places** — keep them in sync:
1. `build-gold-basket.ts` → `TRUSTED_VENDORS` Set
2. `build-leaderboards-html.ts` → `vendorSet` (inline Set + `official_vendor` flag merge)

**Inputs required:** `skills.json`, `trending.json`, `gold-basket.json`

---

## Report 3 — Trending Growth

**What it is:** Week-over-week trending changes — biggest install gainers, new entrants, rank climbers. Automatically switches from single-snapshot mode to full comparison mode once two or more snapshots exist.

**Output file:** `index/growth-report.html`
**Snapshots:** `index/snapshots/trending-YYYY-MM-DD.json`

**How to run:**
```bash
cd index
npm run content:growth-html
```

**Script:** `index/scraper/content/build-growth-html.ts`

**How snapshots are created:**
Every `npm run scrape:trending` automatically saves a dated snapshot — no extra step needed.

**Single snapshot mode:** Shows a "First snapshot captured!" banner and current top 10.

**Comparison mode (2+ snapshots):**

| Section | What it shows |
|---------|--------------|
| Summary bar | Total new installs, new entrants, gainers, dropped off |
| Most Installed | Top 10 with rank movement badges (▲5 / ▼2) and install delta chips |
| Biggest Gainers | Sorted by raw install delta |
| New Entrants | First-timers tagged ✦ NEW |
| Fast Climbers | Skills that jumped 5+ rank positions |

**Inputs required:** At least one file in `index/snapshots/`, plus `skills.json` for skill names

---

## Report 4 — Gold Basket Review

**What it is:** A browsable table of all 420 gold basket skills with their niche, score, install count, stars, GitHub signals (forks, watchers, open issues, days since push), and external validation status. Useful for manually reviewing or spot-checking the basket.

**Output file:** `index/gold-basket-review.html`

**How to run:**
```bash
cd index
npm run content:review-html
```

**Script:** `index/scraper/content/build-review-html.ts`

**Inputs required:** `gold-basket.json` (enriched)

---

## Dashboard

All four reports are combined into a single tabbed file:

**Output file:** `index/dashboard.html`

**How to run:**
```bash
cd index
npm run content:dashboard
```

**Script:** `index/scraper/content/build-dashboard.ts`

Each tab is an isolated iframe (`srcdoc`) so all per-report functionality (filters, copy buttons, PNG download) works exactly as it does in the individual files. Tabs are lazy-loaded — only the active tab renders, so the dashboard opens instantly.

**Tabs:** 📊 Stats · 🏆 Leaderboards · 📈 Growth · 🧺 Gold Basket

---

## Full Rebuild Sequence

```bash
cd index

# 1. Refresh trending data + save a snapshot
npm run scrape:trending

# 2. Rebuild external validation list (slow — hits web)
npm run content:fetch-essentials

# 3. Score and niche all skills into gold basket
npm run content:build-basket

# 4. Enrich gold basket with live GitHub signals (slow — hits GitHub API, needs GITHUB_TOKEN)
npm run content:enrich-basket

# 5. Compute data mining stats
npm run content:stats

# 6. Build individual reports
npm run content:stats-html
npm run content:leaderboards
npm run content:growth-html
npm run content:review-html

# 7. Combine into dashboard
npm run content:dashboard
```

---

## Extending the Reports

**Add a stats section:** Open `compute-stats.ts`, push a new object onto `sections[]` with shape `{ id, hook, angle, data, tweet_hooks }`. Re-run steps 5–7.

**Add a leaderboard trophy:** Open `build-leaderboards-html.ts`, add a `makeTrophy(...)` call. Each trophy needs a label, emoji, description, and a pre-sorted `AuthorProfile[]` (store 20 so filtering always shows 10).

**Add a growth section:** Open `build-growth-html.ts`, write a `buildXSection(rows: GrowthRow[])` function and include it in the `bodyContent` string.

**Add a new tab to the dashboard:** In `build-dashboard.ts`, add one `load()` call and one entry to the `tabs` array. Re-run `npm run content:dashboard`.

**Adjust gold basket scoring:** Edit `computeScore()` in `build-gold-basket.ts`. Current weights: installs 50%, stars 30%, trending rank inverse 20%, +20% boost for externally validated skills.
