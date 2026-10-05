# Handoff: omgskills Web App (discovery + management in one app)

## Overview
omgskills is moving from a Mac‑app‑centered product to a **web‑app‑centered** one. This design merges the two current web surfaces — `omgskills.com/app/` (management) and `omgskills.com/skills/` (discovery) — into **one app** that feels like a well‑made Mac app in the browser.

- **My skills** (the default, main experience): every skill you have installed, which agents it's on, updates, favorites and **Sets** (shareable groups).
- **Discover**: an App Store–style library — featured collections, top this week, creators and categories — with a **skill detail panel** modelled on the Mac app.
- Anything that isn't skills (agents, devices, GitHub, MCP, appearance, sign out) lives in the **account menu**, not in tabs.
- A **signed‑out** variant lets anyone browse and search the library, with a persistent **Sign in** CTA.

This supersedes the earlier `web-handoff/` package in the repo (Skills / Agents / Sets / Home). Keep that folder's `MAPPING.md` rules about real vs. unavailable data — they still apply (see "Data & honesty rules" below).

## About the Design Files
The files in this bundle are **design references created in HTML** — a working prototype showing intended look and behavior, **not production code to copy**. Recreate it in the existing **React portal** (`portal/`: React + Tailwind + Radix/shadcn + Lucide) using its established patterns. Do not ship the prototype runtime (`support.js`).

- `Web App v2.dc.html` + `support.js` — open the `.dc.html` in a browser to click through. All styles are inline; the logic class at the bottom (`class Component`) holds sample data, state and behavior and is the best spec for edge cases.
- URL params for reviewing states: `?view=all|discover|top|updates`, `?sel=<skill-id>` (open detail), `&pick=1` (open agent picker), `?auth=out` (signed out), `?rail=1` (collapsed sidebar), `?theme=dark`, `?toggle=pill|tabs|text`, `?nav=toggle|stacked`.

## Fidelity
**High‑fidelity.** Colors, type, spacing, radii and interactions are intended as final. Match them closely, mapping onto existing portal tokens where equivalents exist. Sample data, counts, star numbers and README text are placeholders.

---

## Layout shell
Full‑viewport row: `height: 100vh; display:flex; overflow:hidden`.

| Breakpoint | Rule |
|---|---|
| Mobile | `< 760px` — no sidebar; top header + bottom tab bar; detail = bottom sheet |
| Desktop | `≥ 760px` — sidebar (212px) or rail (60px) + content |
| Wide | `≥ 1180px` — detail panel docks inline on the right (380px) instead of floating |

**Content column**: scrolls; inner wrapper `max-width:1120px; margin:0 auto; padding:26px 32px 56px` (mobile `6px 16px 28px`); vertical gap between blocks 30px (mobile 24px).

### Sidebar (expanded, 212px)
`background:#f5f5f7` (`--side`), `border-right:1px solid #e5e5ea`.
1. **Header** — `padding:14px 16px 10px`: 👀 emoji 19px + "omgskills" 14px/700, letter‑spacing −0.02em.
2. **Mode switch** (signed in only) — `padding:2px 10px 8px`. Segmented control: container `background:#e8e8ed` (`--sel`), radius 9px, padding 2px, two equal columns. Each segment 26px tall, radius 7px, 11px/600. Active: `background:#fff` (`--bg`), color `#000`, `box-shadow:0 1px 2px rgba(0,0,0,.12), 0 0 0 .5px rgba(0,0,0,.04)`; inactive: transparent, color `#6e6e73`. Order: **My skills | Discover**. If updates exist and you're on Discover, a 7px green dot (`#34c759`) sits after "My skills".
3. **Search** — `padding:2px 10px 8px`; field 30px tall, radius 8px, white bg, `box-shadow:0 0 0 1px #e5e5ea`, 13px search icon, 12px input. Placeholder "Search my skills" (My skills side) / "Search skills" (Discover side, signed out). Search is **global** (searches both installed and library).
4. **Nav** — scrolls; `padding:4px 8px 12px`, gap 14px between groups. Group label 10px/600 `#aeaeb2`, `padding:0 10px 4px` (hidden when empty). Item: 30px tall, radius 7px, `padding:0 10px`, gap 8px, 12px text (500; 600 when active). Icon 16px Lucide, stroke 2, `#6e6e73` (active `#0071e3`). Set items use an 18px round avatar instead of an icon. Active bg `#e8e8ed`. Right side: count 11px `#aeaeb2` tabular, or green badge (min 18×18, radius 999, 10px/700 white) for Updates.
   - **My skills side**: All skills (count) · Updates (badge) · Favorites (count) — then group **Sets**: each set (avatar of first skill) · "New set" (+ icon, faint).
   - **Discover side**: Discover · Top this week · Creators · Collections — then group **Categories**: Design + Apps · Marketing · Coding · Practical (each with its first category's icon).
5. **Collapse button** — just above the footer line, `padding:4px 8px 6px`, 32×30 icon button (Lucide `panel-left`, 16px, `#6e6e73`), hover `#e8e8ed`.
6. **Account footer** — `border-top:1px solid #e5e5ea; padding:8px`. 42px button: 26px avatar, "you" 12px/600, "5 agents · 2 Macs" 10px `#6e6e73`, chevrons‑up‑down 14px. Opens account menu. Hidden when signed out.

### Collapsed rail (60px)
Same bg/border. Top: 👀. Mode switch as two stacked 36×30 icon buttons in a `#e8e8ed` container (radius 10, padding 2): My skills = Lucide `inbox`, Discover = `compass`; active is white with a subtle shadow. Then a 40×34 search icon (expands the sidebar). Nav items: 40×34 icon buttons, radius 9, tooltip = label; groups separated by a 1px `#e5e5ea` top border (36px wide). Updates badge: 15px green pill at the icon's top‑right. Bottom: expand button above the line, then 28px avatar.

### Mobile chrome
- **Header** — `padding:14px 16px 12px`: 👀 (25px) left, 36px avatar right (44px hit area). Below: search pill 44px tall, radius 999, `#f2f2f7`, 15px input, placeholder "Search skills or creators".
- **Bottom tab bar** — `border-top:1px solid #e5e5ea; padding:6px 8px 20px`. Three tabs, 50px tall, 24px Lucide icon stroke 2 + 10px/600 label; active `#0071e3`, inactive `#aeaeb2`:
  - **My skills** — `user` (badge: update count, 18px green pill)
  - **Discover** — `trending-up`
  - **Sets** — `shapes`
- Signed out: avatar → blue **Sign in** pill (34px, 14px/600); tab bar hidden.

---

## Screens

### 1. My skills → All skills (default landing screen)
- **Title** "my skills" — display font, 30px/700, line‑height 1, letter‑spacing −0.045em. Meta 12px `#6e6e73`: "11 skills across 5 agents".
- **Toolbar** (between title and list):
  - Left: **Agent filter** — 30px pill, `#f2f2f7`, "Agent" (muted, 500) + current value (600) + chevron. Menu (270px, radius 18, shadow): All agents + each connected agent with its skill count, checkmark on the selected one, divider, "Connect an agent…" (blue). **Not a Claude/Codex binary** — the list is open‑ended.
  - Right: **Update all** (green `#34c759`, white, 30px) only when ≥2 updates; then grey **Edit** (`#f2f2f7`, 30px, 12px/600) → toggles to "Done".
- **List** — one flat A–Z list (no "Updates/Installed" split). Row:
  - Row: `gap:12px; padding:0 8px; margin:0 -8px; radius 12`; hover/selected `#f2f2f7` / `#e8e8ed`. Min height 52px (mobile 58px). Divider `1px #e5e5ea` under the text+trailing area (not under the avatar).
  - **Creator avatar** 27px circle — always shown; skills are identified by who made them.
  - Name 13px/600, letter‑spacing −0.01em, ellipsis. Lock icon (11px) for private skills. If an update exists: small inline **Update** pill right after the name (20px tall, 8px side padding, 10px/700, green, white).
  - Second line 10px `#6e6e73`: the skill description, or "Version N available" in green when an update exists.
  - **Agent tiles** — fixed slots, always in the same order (Claude Code, Codex, Cursor, Gemini CLI, OpenCode), so each agent reads as a column. Tile 19×19, radius 6, gap 4, `#f2f2f7`; empty slots are transparent. Claude/Codex use the real logos (12px, CSS mask tinted `#6e6e73`); others show a short letter label (8px/700 muted). Tooltip = agent name.
  - **··· button** (28px circle, muted; hover `#e8e8ed`) → row menu (230px, radius 16, shadow): View details · Update to version N (if any) · Choose agents… · Add to set… · Add to / Remove from favorites · — · Copy command · View on GitHub · Share · — · **Remove from all agents** (red `#ff3b30`). Items 34px, 12px, 15px Lucide icon.
- **Edit mode**: rows get a leading 20px round checkbox (selected: `#0071e3` fill + white check; unselected: 1.5px `#aeaeb2` ring); tapping a row toggles selection; ··· and inline Update hide. A bulk bar appears under the toolbar (`#f2f2f7`, radius 14, min 44px): "Select all / Deselect all" (blue) · "N selected" · **Update N** (green; disabled unless selection has updates) · Add to set · Agents · **Remove** (red text). Disabled actions at 40% opacity.

### 2. Updates / Favorites
Same list. Updates: meta "N updates. Review each one before it lands." Empty: "You're all caught up." / "Everything is up to date".

### 3. Set detail
- Header: title (set name) + meta "5 skills · 4 members". **Top‑right: visibility button** (30px pill, `#f2f2f7`, icon + label + chevron) → menu (260px): **Public** — "Anyone can find and install this set." · **Invite only** — "Only people you invite by email." · **Only me** — "Just you, on all your agents." (checkmark on current). Icons: globe / lock / user.
- Grey bar (`#f2f2f7`, radius 22, `padding:14px 14px 14px 18px`): overlapping member avatars (28px, −8px overlap, 2px ring) on the left; on the right **Keep updated** label + switch, then green **Invite** button (36px).
- Skills list (same row component).
- Product language (from `local.md`): `public→Public`, `restricted→Invite only`, `private→Only me`, `snapshot→Install this version`, `subscribed→Keep updated`.

### 4. Discover
Title "Discover" + "Curated daily from creators you can trust." Discover section titles are capitalized (Discover, Top this week, Creators, Categories); other page titles stay lowercase.
1. **Featured collections** — always **3 columns on desktop** (1 on mobile), gap 10. Card: `#f2f2f7`, radius 20, `padding:16px 18px`, min‑height 150, hover `#e8e8ed`. Top: up to 3 overlapping 36px avatars (−10px). Bottom: kicker 10px/600 uppercase muted ("Collection" / "Editor's pick"), name 18px/700 display, tagline 12px muted.
2. **Top this week** — section title 18px/700 display (−0.025em) + blue "See all" 12px. Grid of 9: **3 columns ≥1180px of content width, otherwise 2, 1 on mobile** (mobile shows 5). Compact row, no dividers: rank (12px/600 muted) · 27px avatar · name 13px/600 · "@creator · ★ 178.4k" 10px muted · Get/Open pill.
3. **Creators** — 9 creators in **3 rows × 3 columns** on desktop (1 column on mobile), row 52px: 34px avatar · name 13px/600 · tagline 10px muted · chevron. "See all".
4. **Categories** — groups with a 11px/600 muted label; each group has exactly **6** items so grids never orphan. Grid **3 columns** (2 on narrow/mobile), column gap 24. Item: 38px row, 16px Lucide icon in `#6e6e73` (stroke 1.75), 12px/500 label, faint chevron — **no dividers**.
   - Design + Apps: Design system (palette), SwiftUI (smartphone), React (atom), App Store (app-window), Landing page (layout-template), Animation (circle-play)
   - Marketing: Brand, Copywriting, SEO (search-check), Blog (newspaper), Social media (users), Market research (target)
   - Coding: Code review (git-pull-request), Testing (flask-conical), Debugging (bug), Refactoring (refresh-cw), API design (braces), Security audit (shield-check)
   - Practical: MCP server (server), Deep research (file-search), PDF (file-text), Deck (presentation), Excel (sheet), Writing (pen-line)
   - *Brand* and *Copywriting* are placeholders added to make 6 — replace with real categories.

### 5. Library list pages (Top this week, Collection, Creator, Category, Search results)
- Blue back link ("‹ Discover / Collections / Creators", 12px) above the title on drill‑ins.
- Collection/Creator pages: hero avatars (60px, mobile 52px; collections overlap −14px) left of the title.
- Library row = same row component with: name + "@creator" (11px faint) inline, description as second line, "★ 92.1k" (11px muted) and a **Get** (grey pill, blue text) or **Open** button at the end. Rank column on Top this week.
- Creators / Collections index pages reuse the row with "N skills" as the trailing note.
- **Search results**: grouped "In my skills" then "Library". Empty: "Nothing matches. Try a creator or a task."

### 6. Skill detail panel
Opens from any row. Wide: docked 380px with `border-left`. Desktop <1180: floating, `top/right/bottom:12px`, radius 22, shadow, light scrim `rgba(0,0,0,.12)`. Mobile: bottom sheet, `max-height:92%`, radius `28px 28px 0 0`, grabber, scrim `rgba(0,0,0,.3)`. Padding `14px 20px 28px`, gap 16.
1. Close (26px grey circle, top‑right).
2. Header: **48px creator avatar** (tap → creator page) + name (display 23px/700, −0.035em) + meta line 11px: **@creator** (blue) · ★ stars · **Top rated** chip (crown icon, 20px pill `#f2f2f7`) · "Updated 3d ago" (faint, nowrap).
3. Actions row (one line): primary pill 32px — **Get** (blue `#0071e3`), **Installed on N ⌄** (grey) or **Update to version N** (green) — then four 32px round icon buttons (grey `#f2f2f7`, tooltips): Favorite (filled pink `#ff375f` when on) · Add to set · GitHub · Share.
4. **Agent picker** (opens inline under the actions on Get / "Installed on"): grey card radius 16; title "Install on" / "Installed on"; one 40px row per connected agent: 18px rounded checkbox (blue when checked) + agent name 12px/500 + install path 10px muted (e.g. `~/.claude/skills`). Footer: Cancel (white) + primary "Install · 3 agents" / "Save · 2 agents" / "Remove from all agents" when none selected.
5. What's new (when update): grey card radius 14 — "What's new in version N", +12 / −3 (green/red), changed files in mono 11px.
6. Description: grey card (`#f2f2f7`, radius 14, `padding:12px 14px`), 13px/1.45 `#3a3a3c`. (Mac app uses the SKILL.md frontmatter description here.)
7. On this account (installed only): rows 44px — "Installed on" + agent names + blue "Edit"; "Keep updated" + "Review each change before it lands" + switch (38×22, knob 18, green when on); set chips + dashed "+ Add to set".
8. **About** — 15px/700 heading + body 12px/1.55 (render the README here, like the Mac app); "Use it" box with `/<skill-name>` in mono.
9. **More from @creator** — up to 3 compact rows (name, description, stars).

### 7. Signed out
`?auth=out` or after **Sign out** in the account menu.
- No mode switch; sidebar = Library items + Categories; no account footer; opens on **Discover**; nothing installed.
- Desktop: fixed top‑right of the content area — "Get the Mac app" link (12px muted) + **Sign in** (blue, 32px pill).
- Any **Get** opens the **Sign in** modal: centered card 360px, radius 24, 👀 34px, "Sign in to install" (21px/700), helper "Install skills into every agent you use, keep them updated and share sets with your team.", **Continue with GitHub** (black pill 40px) · **Continue with email** (grey) · "Not now". Scrim `rgba(0,0,0,.35)`.
- Detail panel: Favorite and Add to set hidden; Get triggers sign‑in.

### 8. Account menu
300px card, radius 22, shadow; anchored above the footer (desktop) or under the avatar (mobile). Header: 40px avatar, "you", email. Rows 44px: **Agents** "5 connected" · **Devices** "2 Macs" · **GitHub** "Connected" · **MCP server** "omgskills.com/mcp" · **Appearance** Light/Dark (toggles theme) · **Sign out**.

---

## Interactions & behavior
- All popovers (account, agent filter, row ···, visibility) close on outside click via a transparent full‑screen layer; opening one closes the others.
- Navigating (`go(scope)`) resets: detail selection, picker, search query, edit mode + selection, open menus.
- Typing in search switches the content to Search results; clearing returns to the previous scope.
- Selected row background `#e8e8ed` while its detail is open.
- Hover: rows `#f2f2f7`; icon buttons `#e8e8ed`; links `opacity:.72`.
- Collapse/expand sidebar is instant (no animation in the prototype; a 150–200ms width transition is fine).
- Theme: light default; dark via account menu → Appearance.

## State (reference, from the prototype)
`scope` ('all' | 'updates' | 'favorites' | 'sets' | 'set:<id>' | 'discover' | 'top' | 'creators' | 'collections' | 'col:<id>' | 'creator:<handle>' | 'cat:<label>|<cat>'), `back`, `query`, `sel` (skill id), `pick` (agent ids being chosen), `agent` (filter), `inst` ({skillId: agentIds[]}), `upd` ({skillId: version}), `fav[]`, `keep{}`, `setKeep{}`, `vis{}`, `edit`, `picked[]`, `rowMenu`, `agentMenu`, `visMenu`, `acct`, `rail`, `out` (signed out), `signin`, `theme`.

**Backend data needed**: skills (id, name, creator handle + avatar, description, stars, quality tier, updated‑at, README, private flag, category), installs per agent, available updates (version + file diff), connected agents (name, install path), sets (name, visibility, members, items, keep‑updated), collections, creators (name, handle, tagline), weekly ranking.

## Data & honesty rules (carry over from `web-handoff/MAPPING.md`)
- Don't fabricate online/sync states or usage timestamps the API doesn't have; use "—" or an unavailable state.
- Visibility is three states (Public / Invite only / Only me), not a binary switch; adding an email grants access, it doesn't send mail.
- Show success only after the API/clipboard confirms. Placeholder controls (Add to set, Copy command, GitHub, Share, Invite, Connect an agent, Continue with GitHub/email) are non‑functional in the prototype.
- The agent list must be open‑ended (more than Claude + Codex).

## Design tokens
| Token | Light | Dark |
|---|---|---|
| `--bg` | `#ffffff` | `#000000` |
| `--ink` (primary text) | `#000000` | `#f5f5f7` |
| `--body` (long text) | `#3a3a3c` | `#d1d1d6` |
| `--muted` | `#6e6e73` | `#98989d` |
| `--faint` | `#aeaeb2` | `#636366` |
| `--chip` (grey fills) | `#f2f2f7` | `#232326` |
| `--side` (sidebar) | `#f5f5f7` | `#161618` |
| `--sel` (selected) | `#e8e8ed` | `#2c2c2e` |
| `--hair` (dividers) | `#e5e5ea` | `#2c2c2e` |
| `--card` | `#ffffff` | `#3a3a3d` |
| `--cta` (blue) | `#0071e3` | `#0a84ff` |
| `--update` (green) | `#34c759` | `#34c759` |
| destructive | `#ff3b30` | `#ff3b30` |
| favorite | `#ff375f` | `#ff375f` |
| `--shadow` | `0 1px 2px rgba(0,0,0,.06), 0 12px 40px rgba(0,0,0,.14)` | `0 1px 2px rgba(0,0,0,.4), 0 12px 40px rgba(0,0,0,.6)` |

**Type**: `--sans` = `-apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter", system-ui`; `--display` = `-apple-system, BlinkMacSystemFont, "SF Pro Display", "Inter Tight", "Inter", system-ui` (titles, lowercase, tight tracking); `--mono` = `ui-monospace, "SF Mono", Menlo`.
Scale used: page title 30 / section 18 / detail title 23 / body 12–13 / meta 10–11 / micro 8–10.

**Radii**: pills & buttons 999 · rows 12 · menus 16–18 · cards 20–22 · sheets 28 · nav items 7 · agent tiles 6.
**Sizes**: skill avatar 27 · creator row avatar 34 · detail avatar 48 · hero 60 · buttons 26 (rows) / 30 (toolbar) / 32 (detail) · rows 52 (mobile 58).

## Assets
- `assets/agent-claude.png`, `assets/agent-codex.png` — from `menubar/Sources/omgskills/Resources/` (render as tinted masks).
- Creator/profile avatars in `assets/` are **sample images** — production uses GitHub avatars (see `GitHubAvatarView.swift`).
- Icons: **Lucide** (stroke 1.75–2, round caps). Logo: 👀 emoji.
- Fonts: system SF on Apple; Inter / Inter Tight fallback (Google Fonts).

## Files
- `Web App v2.dc.html` — the prototype (markup + `class Component` logic, sample data, behavior).
- `support.js` — runtime needed only to open the prototype locally.
- `assets/` — images referenced by the prototype.
