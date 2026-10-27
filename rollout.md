# Web-first rollout

Started 2026-10-27. Inventory of what is still pending to move omgskills from a
Mac-app-first product to a web-first product with a companion Mac app, plus a
sequenced MVP rollout that can be undone at every step.

Sources checked: `main` at `ffb71b9`, all 85 remote branches by name, open PRs
and issues, commits since 2026-10-10, the planning docs at the repo root
(`connect.md`, `appwork.md`, `newmac.md`, `arch.md`, `fix.md`), the built site
sources under `site/`, `portal/`, `scripts/` and `netlify.toml`, and recent
Claude Code sessions. Nothing here was checked against the live site; every
"live" claim below comes from the repo or its docs.

`urls.md` is referenced by recent commits ("urls.md step 2, items 1-4",
"U-01 to U-05") but is not in git on any branch. It probably lives only on
jon's Mac. Its later steps are not reflected here until it is added.

---

## 1. Where things stand

The product direction is already decided (D3 in `connect.md`, 2026-10-08):
the web is the whole experience, and the Mac app becomes a management
companion with no discovery UI. A lot of the web side is built. The public
front door and the story have not moved yet.

| Area | Built and (per docs) live | Still Mac-first or missing |
| --- | --- | --- |
| Web app `/app/` | Discover, search, collections, creators, trending, Favorites, Sets with invite-only sharing, Clerk sign-in, clean `/app/library/...` addresses, public views before sign-in, page titles that follow the view | Signed-in accessibility sweep, account destinations, perf timings (`appwork.md` remaining acceptance) |
| Connected Mac app | Opt-in 0.0.27 (arm64, macOS 14+) offered from production setup inside `/app/`, connected inventory and sync on in production (2026-10-23/24), TelemetryDeck install and sync events | Public download and Sparkle feed still serve the old discovery app 0.0.20 (Sep 28). Updater failure tests (G2), pilot (G3) and existing-user migration not done |
| Homepage `/` | `site/index.html` | Entirely Mac-first: hero is "Download for macOS", FAQ says "focused on the Mac menu bar experience", schema.org is a macOS `SoftwareApplication`, and it has **zero links to `/app/`** |
| New homepage `/home/` | A web-first homepage exists (search box, "find & manage", CTAs into `/app/`) | `noindex, nofollow`, not linked from anywhere, still has a Mac DMG CTA and uses old `?view=discover&skill=` links instead of clean paths |
| SEO pages | Static `/skills/`, `/library/`, creators, collections pages with canonicals, index tiers, chunked sitemaps, `.md` twins, `llms.txt`, `ai-catalog.json` | Takeover pilot (static page swaps to the live app) covers only 2 pages. `/app/` itself is `noindex`. Canonical scheme is split: skills canonical at `/skills/...`, the app writes `/library/...` |
| Web analytics | Humblytics plus X, Reddit and OpenAI pixels on the static pages (`/`, `/home/`, `/data/`, Stripe page); download clicks tracked | **Nothing at all in `/app/`**: no page views, searches, skill opens, sign-ups, install starts or setup downloads. `connect.md` C16 ("web and helper measurement") is open |
| App analytics | TelemetryDeck in both apps; `scripts/check-funnel-health.mjs` joins Humblytics and TelemetryDeck daily | Funnel only knows "download click to app launch". It cannot see the web-to-app handoff |
| Domain | `omgskills.com` primary, `/app/` the app, `app.omgskills.com` rewrites to the same app | `app.omgskills.com` has known gaps (no same-origin `/mcp`, untested signed-in navigation). No decision recorded on whether it stays |
| Story | | README, GitHub repo description ("Search for Claude & Codex skills from your macOS menu-bar"), about, guide, support, privacy and footers all lead with the Mac menu-bar app |
| Privacy | Policy covers Mac telemetry, website analytics, MCP | Dated Aug 14, 2026. Does not mention web accounts (Clerk), synced Mac inventory uploads, Sets sharing by email, or device pairing, all of which are live |

### Housekeeping found along the way

- Open issues #140, #141 and #183 are "Deployment firewall approval" holds. The
  firewall hold was retired on 2026-10-24 (`Retire temporary deployment
  firewall approval hold`), so these can probably be closed.
- Open PRs #49 (`web-library.md` audit, July) and #32 (Skill Groups MVP draft,
  June) look superseded by work on `main`. #193 (animations) is handled in its
  own thread.
- About 75 `codex/*` feature and release branches remain on the remote; most
  look already merged (not checked one by one).
- The repo root holds roughly 400 KB of internal planning docs (`appwork.md`,
  `newmac.md`, `connect.md`, `arch.md`, `crawl.md`, `design-qa.md`, `fix.md`,
  `backfill.md`, `browse-plan.md`, `trust.md`, plus `antskills.md` on another
  branch). Visitors land on these next to the README, which makes the public
  repo read as a work log.
- `CHANGELOG.md` stops at 0.0.20 and has no entries for the connected app
  releases 0.0.25 to 0.0.27 or the web app.

---

## 2. What has to stay working the whole time

These are the contracts existing users and agents depend on. Every phase below
must leave them unchanged, and the existing deploy guards
(`scripts/verify-production-deploy.mjs`, deploy-artifact guard, pipeline
health) should keep checking them.

1. `site/appcast.xml` and `/updates/*`: about 0.0.20 installs update from here.
   Changing this feed is the single riskiest step and is its own phase.
2. `/downloads/omgskills-mac.dmg` and `/download`: linked from old posts, ads
   and the old app.
3. `/data/manifest.json` and the hashed data files: the old app refreshes from
   these daily.
4. The MCP endpoint and `omgskills-mcp` npm package data URL.
5. Existing static SEO URLs (`/skills/...`, `/library/...`, creators,
   collections) and their sitemaps. Any move needs a 301, never a 404.
6. Sign-in, Sets sharing links and device pairing routes (`/app/connect`).

---

## 3. Sequenced MVP rollout

Each phase ships on its own, is reversible with a Netlify deploy rollback or a
feature flag in `config/production-features.json`, and has an exit check
before the next one starts. Phases 1 and 2 have no user-visible risk and can
run in parallel.

### Phase 0: Decisions and baseline (no code)

- [ ] Commit `urls.md` to the repo so its remaining steps are tracked here.
- [ ] Decide the canonical public URL scheme: keep `/skills/owner/repo/skill/`
      or move to `/library/owner/repo/skill/` (what the app writes today).
      Pick one; the other 301s to it.
- [ ] Decide the role of `app.omgskills.com`: keep as an alias that redirects
      to `omgskills.com/app/`, or retire. Recommendation: 301 to the primary
      domain so there is one origin for sign-in, MCP and SEO.
- [ ] Confirm Google Search Console and Bing Webmaster are verified for
      `omgskills.com` (no verification file is in the repo, so it would be DNS).
- [ ] Record a two-week baseline: organic clicks and indexed pages, homepage
      visits, DMG download clicks, TelemetryDeck launches. This is what the
      flip is judged against.

Exit: the three decisions are written down here.

### Phase 1: Measure the web app (invisible to users)

The flip cannot be judged without this, so it comes first.

- [ ] Add Humblytics to the `/app/` shell (`portal/index.html`) with a page
      view on every in-app route change, not only on first load.
- [ ] Add a small set of custom events, no personal data, no skill paths from
      a user's Mac (per C16):
      `search`, `skill_open`, `install_start` (web hands off to the Mac app),
      `setup_download` (connected app zip), `sign_in`, `sign_up`,
      `set_create`, `set_share`, `device_paired`.
- [ ] Decide whether the ad pixels (X, Reddit, OpenAI) belong in the app or
      only on marketing pages. Recommendation: marketing pages only, with
      `setup_download` forwarded as their conversion.
- [ ] Extend `scripts/check-funnel-health.mjs` to report the new funnel:
      visit to search to skill open to install start to app connected
      (TelemetryDeck) to first sync.
- [ ] Update the privacy policy for accounts, synced inventory, Sets email
      sharing, device pairing and in-app analytics, with a new date.

Exit: a day of events shows up in Humblytics and the funnel report.
Rollback: remove the script tag.

### Phase 2: Retell the story (copy only, low risk)

- [ ] Rewrite the README top section (draft in section 4).
- [ ] Update the GitHub repo description, website link and topics
      (repo settings, jon's action). Suggested description:
      "Find, install and manage Claude Code and Codex skills from the web,
      with a companion Mac app."
- [ ] Move internal planning docs into `docs/` (or keep them out of the public
      repo) so the root shows README, LICENSE, SECURITY, CHANGELOG and code.
- [ ] About, guide, support and footer copy: lead with the web library, present
      the Mac app as the companion that installs and keeps skills updated.
      Replace "Free macOS app, open web library" with
      "Open web library, free companion Mac app".
- [ ] schema.org: add a `WebApplication` for `/app/` as the primary entity and
      keep `SoftwareApplication` for the Mac companion.
- [ ] `CHANGELOG.md`: add the web app and the connected 0.0.25 to 0.0.27
      releases.

Exit: copy reviewed by jon. Rollback: revert the commit.

### Phase 3: SEO groundwork for the switch

- [ ] Read out the takeover pilot on its two pages: indexing status, Core Web
      Vitals, any change in clicks, and that the static content still renders
      for crawlers before the swap.
- [ ] Apply the Phase 0 canonical decision: canonicals, sitemaps and 301s in
      one change, verified by `verify-web-library-pages.mjs`.
- [ ] Widen the takeover in batches (one creator family, then all creators,
      then skills), each behind `takeoverPilotEnabled` or a successor flag,
      with a week of Search Console data between batches.
- [ ] Switch `/home/` and static page links from `?view=` to clean paths.
- [ ] Keep `/app/` itself `noindex`; the indexable surface stays the static
      pages that the app takes over.

Exit: no drop in indexed pages or organic clicks across a batch.
Rollback: flag off.

### Phase 4: Flip the front door (the actual switch)

- [ ] Promote the `/home/` design to `/`: search first, "Open the library" as
      primary CTA, "Get the Mac companion" as secondary.
- [ ] Keep the old homepage at a stable URL (for example `/mac/`) so the Mac
      download page, ads and old posts still have a clear target.
- [ ] Title, description and OG image for `/` move to the web-first story; keep
      the canonical at `https://omgskills.com/`.
- [ ] Ship on a weekday, watch the Phase 1 funnel and Search Console for a week.

Exit: homepage-to-search and homepage-to-download rates at or above baseline.
Rollback: Netlify rollback to the previous deploy, or swap the file back.

### Phase 5: Make the companion app the default download (highest risk)

This is the existing `connect.md` path (G1 to G4) and stays gated by it.

- [ ] G2 updater failure checks for the connected app.
- [ ] Controlled pilot (G3) with the opt-in 0.0.27 users.
- [ ] Decide Intel support: the connected app ships as arm64 only. The release
      script does not pin an architecture for the old DMG, so check whether it
      ran on Intel before treating the switch as a regression.
- [ ] Point `/downloads/omgskills-mac.dmg` at the connected app.
- [ ] Separately approved: publish the migration update on `site/appcast.xml`
      so 0.0.20 users move to the companion without losing installed skills.

Exit: pilot and migration evidence per `connect.md`.
Rollback: old DMG and appcast entries stay hosted.

### Phase 6: Retire and clean up (C12)

- [ ] Remove the discovery UI from the Mac app only after Phase 5 is stable.
- [ ] Retire `/api/portal/catalog-search` after checking callers.
- [ ] Close the stale issues and PRs, delete merged release branches.

---

## 4. Proposed README top section

Replaces everything above "MCP server" in `README.md`. The scraper, release
and architecture sections below it can stay, moved under a "For developers"
heading.

```markdown
<p align="center">
  <img src="assets/omgskills-eye.png" alt="omgskills" width="240">
</p>

# omgskills

**Find, install and manage agent skills for Claude Code and Codex.**

omgskills is an open web library of skills from trusted creators, at
[omgskills.com](https://omgskills.com/app/library/). Search the catalog, read
each skill's SKILL.md and README, follow creators and collections, and save
skills into Sets you can share with your team.

The free **omgskills Mac app** is the companion that does the local work:
it installs the exact version you picked on the web, keeps it updated, and
shows the web which skills are installed on which Mac and agent. Public
installs need no account.

- **Web library:** https://omgskills.com
- **Mac companion:** https://omgskills.com/download (macOS 14+, Apple silicon)
- **For agents:** `npm install -g omgskills-mcp` (see below)
```

Also worth changing lower down: "Project structure" should list `portal/` (the
web app) and `netlify/` (functions and database) first, and the "Trust and
safety" list should say what the web account stores.

---

## 5. Questions for jon

1. Can `urls.md` be committed? Its later steps may already cover Phase 3.
2. Canonical scheme: `/skills/...` or `/library/...`?
3. Keep `app.omgskills.com`, or redirect it to `omgskills.com/app/`?
4. Should ad pixels run inside the signed-in app?
5. Does the Mac companion need Intel support before it becomes the default
   download?
6. Is the target to flip the homepage (Phase 4) before the companion becomes
   the default download (Phase 5)? This plan assumes yes, since the web side is
   further along and the flip is easy to undo.
