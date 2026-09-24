# Handoff: omgskills Web App Redesign

## Overview
A streamlined, app-like redesign of the omgskills web app (`omgskills.com/app/`). Users manage their skills, the agents those skills are installed on, and shareable **Sets** of skills. The style is minimal and practical, shadcn/ui-inspired: neutral zinc palette, 1px borders, dense tables, pill buttons, one blue accent.

Screens: **Skills**, **Agents**, **Sets**, **Set detail**, **Home (profile)**, plus the mobile variants of each.

## About the Design Files
The files in this bundle are **design references built in HTML**. They are prototypes that show the intended look and behavior, not production code to copy directly. The task is to **recreate these designs in the omgskills codebase**, using its existing framework and patterns. If starting fresh, React + Tailwind + shadcn/ui is the natural fit, because the design maps almost 1:1 onto shadcn primitives (Button, DropdownMenu, Popover, Dialog, Switch, Checkbox, Input, Table, Sheet, Badge, Avatar, Sonner toast).

- `omgskills App (standalone).html` is a single offline file. Open it in any browser to click through the prototype.
- `omgskills App.dc.html` + `support.js` are the editable source. All styles are inline; the logic class near the bottom holds the state, data and behavior.

## Fidelity
**High-fidelity.** Colors, type, spacing, radii and interactions are final. Recreate them as closely as you can, mapping values onto the codebase's tokens where they exist.

---

## Design Tokens

### Colors
| Token | Hex | Use |
|---|---|---|
| foreground | `#09090b` | Primary text |
| muted-foreground | `#71717a` | Secondary text, table headers, meta |
| subtle | `#a1a1aa` | Skill descriptions, counts, "Local", placeholder icons |
| icon | `#3f3f46` | Icon buttons, avatar initials |
| border | `#e4e4e7` | Card/table borders, outline buttons, dividers |
| border-subtle | `#f4f4f5` | Row dividers inside tables/lists |
| border-strong | `#d4d4d8` | Unchecked checkbox, dashed empty state, breadcrumb slash |
| muted | `#f4f4f5` | Hover bg, avatar bg, icon button active |
| surface-alt | `#fafafa` | Table header bg, row hover, selection bar |
| nav-active | `#f0f0f1` | Active sidebar item bg / sidebar hover |
| **primary (blue)** | `#2f7df6` | Primary CTAs, switch "on" track |
| primary-hover | `#1f6ae0` | Primary CTA hover |
| checkbox-on | `#18181b` | Checked checkbox fill/border |
| star | `#f59e0b` | Starred (filled) star |
| success | `#16a34a` | Online dot, toast check |
| destructive | `#dc2626` | Delete/Disconnect/Remove text |
| destructive-bg | `#fef2f2` | Destructive hover bg |
| overlay | `rgba(9,9,11,.45)` dialogs · `rgba(9,9,11,.35)` mobile drawer |

### Typography
- **Sans:** Geist (400/500/600), fallback `system-ui, sans-serif`
- **Mono:** Geist Mono (400/500), used for skill names, the `/jonslimak` handle and CLI commands
- Base: 12px / 18px line-height, `-webkit-font-smoothing: antialiased`

| Role | Size | Weight | Notes |
|---|---|---|---|
| Page title (h1 in header) | 13px | 600 | |
| Section title (h2) | 12px | 600 | "Skills" in Set detail, "Private source" |
| Group label | 11px | 500 | muted; "My sets", "Shared with me" |
| Body / row primary | 12px | 500 | agent name, set name |
| Skill name | 11px **Geist Mono** | 500 | |
| Skill description | 10px / 15px | 400 | `#a1a1aa`, single line, ellipsis |
| Secondary/meta | 11px | 400 | `#71717a` |
| Table header | 10px | 500 | `#71717a` |
| Buttons | 11px | 500 | |
| Sidebar nav | 11px | 400 (500 active) | count on right is 10px `#a1a1aa` |
| Dialog title | 14px | 600 | |
| Profile handle | 18px Geist Mono | 600 | letter-spacing −0.01em |

### Radius
- Buttons (all actions, incl. icon buttons): **pill** `999px`
- Cards / tables / popovers / menus: `8px`
- Dialogs: `10px`
- Inputs: `6px`
- Sidebar nav items: `6px`
- Menu items inside dropdowns/popovers: `4px`
- Checkboxes: `4px`
- Agent letter tile: `6px` (28×28) · agent badges in table: `5px` (22×22)

### Shadows
- Popover / dropdown: `0 8px 24px -6px rgba(0,0,0,.14), 0 2px 6px rgba(0,0,0,.04)`
- Dialog: `0 20px 50px -12px rgba(0,0,0,.25)`
- Toast: `0 8px 24px -6px rgba(0,0,0,.14)`
- Mobile drawer: `0 10px 40px rgba(0,0,0,.18)`
- Switch knob: `0 1px 2px rgba(0,0,0,.2)`
- Focus ring (inputs): border `#a1a1aa` + `0 0 0 3px rgba(161,161,170,.25)`

### Spacing & sizes
- Page header: 48px tall, horizontal padding 20px (12px on mobile), **no bottom border**
- Page content padding: `14px 20px 32px` (mobile `14px 12px 32px`)
- List pages (Agents, Sets) max-width 920px; Profile max-width 720px
- Button heights: 32px (header), 30px (secondary/inline), 28px (compact/invite); horizontal padding 10–12px
- Icon buttons: 28×28, icon 16px
- Table header row: 32px; table body row min-height 48px (desktop); cell padding `5px 8px`
- List rows (Agents/Sets): padding `8px 14px`, gap 14px
- Switch: track 36×20, knob 16×16, 2px inset; knob left 2px (off) → 18px (on); 150ms transition

---

## Layout Shell
- Full-viewport flex row (`height: 100vh`, min-height 620px).
- **Sidebar** (desktop): 168px wide, white, padding 12px, **no right border**.
  - Top: 👀 emoji logo (18px), no wordmark. Row 36px tall, 12px margin below.
  - Nav: Skills / Agents / Sets. Each is a 28px-tall row: 14px lucide icon, label, and a count on the right. Active item gets `#f0f0f1` bg, `#09090b` text and weight 500; inactive items are `#3f3f46`. Set detail highlights "Sets".
  - Bottom: a "Home" user button with a 24px avatar ("JS"), "Home" (11px/500) and `/jonslimak` (10px mono, muted) underneath. It opens Profile.
- **Main:** flex column with `overflow: auto`. The Skills header is `position: sticky; top: 0`.

Icons are lucide (stroke 1.75, round caps/joins): layout-grid (Skills), bot (Agents), layers (Sets), search, chevron-down/right/left, check, x, plus, star, list-plus (add to set), github, copy, trash-2, menu.

---

## Screens

### 1. Skills
**Purpose:** Browse every skill across agents, filter it, and star skills or add them to sets.

- **Header:** "Skills" title, then an outline **Edit** button on the right (it toggles to "Done").
- **Toolbar** (gap 8px, wraps):
  - **Filter dropdown trigger:** an outline pill, 30px tall, reading "Showing" (muted) + current label (500) + chevron. It never wraps (`white-space: nowrap`).
    - Menu (264px wide): group "View" with **All skills** and **Recent activity**, a divider, then group "By agent" listing each agent as `Name · host (muted)` with its skill count on the right. The selected item gets a check in a 16px leading slot. Choosing an item closes the menu.
  - **Search input:** 30px tall, leading search icon, flex 1, min 180 / max 320px. It filters by name or description, case-insensitive.
  - The result count ("N skills") sits right-aligned, muted.
- **Bulk bar** (Edit mode, when ≥1 is selected): a 38px bar with `#fafafa` bg and a border. It shows "N selected" on the left; on the right are ghost **Clear**, outline **Add to <set>** and primary **Star**. It wraps on mobile.
- **Table** (1px border, 8px radius):
  - Columns: `[checkbox 32px (edit only)] | Skill minmax(0,2.4fr) | Source minmax(0,1.3fr) | Agents 100px | Last used 90px | actions 80px`
  - **Skill:** mono name + one-line description.
  - **Source:** a GitHub icon + `owner/repo` link (opens github.com in a new tab), or muted "Local".
  - **Agents:** 22×22 letter tiles (C/G/H), with the full agent name as the tooltip.
  - **Last used:** relative time ("12m ago", "3h ago", "2d ago"), tabular numerals.
  - **Actions:** a Star toggle (outline → filled amber `#f59e0b`) and an **Add to set** button that opens a popover.
  - **Add-to-set popover** (232px, right-aligned under the button): "Add to set" label, a checkbox row for each of *my* sets (clicking toggles membership immediately), a divider, then "+ New set…", which opens the New set dialog. That dialog pre-adds this skill.
  - **Empty state:** "No skills found" + "Try a different filter or search term."
- **Filter logic:**
  - *Recent activity:* skills used in the last 7 days, sorted most-recent first.
  - *All skills:* alphabetical.
  - *Agent:* skills installed on that agent.

### 2. Agents
**Purpose:** See the connected agents and connect new ones.

- **Header:** "Agents", outline **Edit**, primary **+ Add agent**.
- **Intro:** "Agents pull skills from omgskills. Each connection syncs automatically." (11px, muted).
- **List** (bordered card). Each row has:
  - a 28px letter tile
  - the agent name (500) with the host (muted) under it
  - status: a 7px dot (green online / `#d4d4d8` offline) + sync text ("Synced 2m ago", "Offline · 3d"), 150px wide
  - a ghost "**N skills**" button, which opens the Skills screen filtered to that agent
  - in Edit mode, an outline destructive **Disconnect** button
- **Add agent dialog** (max 480px):
  - title "Add agent"
  - helper text: "Run this on the machine where your agent lives. It will appear here once connected."
  - a code box (`#fafafa` bg, mono) holding `npx omgskills connect --token osk_…` with a **Copy** button (**placeholder command, replace with the real one**)
  - a "Waiting for connection…" indicator
  - a **Done** button

### 3. Sets
**Purpose:** List the sets you own and the sets shared with you.

- **Header:** "Sets", outline **Edit**, primary **+ New set**.
- **Groups:** "My sets" and "Shared with me", each a bordered list card with an 18px gap between groups.
- **Each row** (clickable, opens Set detail):
  - the name (500)
  - meta: "N skills", plus "· by owner" for shared sets
  - a Public/Private pill badge (22px, bordered)
  - up to 4 overlapping 24px avatars (−6px overlap, 2px white ring)
  - a chevron
  - in Edit mode (own sets only), a destructive trash icon button
- **New set dialog** (max 420px):
  - title "New set"
  - helper text: "Group skills to share with people or install on agents together."
  - a **Name** input (placeholder "e.g. Marketing skills"); Enter submits
  - **Cancel** and primary **Create set** buttons

### 4. Set detail
**Purpose:** Manage a set's members, visibility and skills.

- **Header:**
  - Left: "Sets" ghost link, "/", then the set name (h1, ellipsis).
  - Right: a **Public/Private** label + switch (owner only), then an outline **Copy link** button with a copy icon.
- **Members strip** (top, full width, bordered, padding `8px 10px`, wraps):
  - "Members" (11px/600) + count
  - member **chips**: 28px pills with a 20px avatar and the email, "Owner" tag on the owner, and a × remove button (owner can remove members)
  - an **invite** input ("Invite by email", Enter submits; needs an "@") + primary **Invite** button, flex `1 1 240px`, max 320px
- **Skills section** (below):
  - "Skills" + count; an outline **Edit** button (owner only)
  - Table columns: `Skill 2.2fr | Source 1.2fr | actions 88px`
  - In Edit mode each row shows a destructive **Remove** button in place of the star
- Shared sets are read-only: no switch, invite, Edit or remove controls.

### 5. Home (profile)
- **Header:** "Home".
- **Identity:** a 56px avatar, `/jonslimak` (18px mono 600) and the email (muted).
- **Public profile card:**
  - the title "Public profile", with a hint that changes with state ("Only you and set members can see your skills." / "Anyone with the link can see your public sets.") and a switch
  - when on, a second row shows `omgskills.com/jonslimak` (mono) + a **Copy** button
- **Private source:**
  - a 12px/600 heading
  - a dashed empty-state box with a GitHub tile, the title "No installation connected", the helper "Connect the omgskills GitHub App to sync skills from private repositories." and a primary **Connect GitHub** button

---

## Interactions & Behavior
- **Toasts:** bottom-right, white card with a green check. They auto-dismiss after 1.8s. Messages: "Link copied", "Created “X”", "Invited x", "Deleted “X”", "Disconnected X", "Added N to …", "Starred", "Command copied", "Opening GitHub…".
- **Popovers and dropdowns** close on outside click (transparent full-screen layer) and when an item is chosen; opening one closes the other.
- **Changing screens** resets Edit mode, the selection and any open popovers.
- **Hover:**
  - rows `#fafafa`
  - ghost/icon buttons `#f4f4f5`
  - outline buttons `#f4f4f5`
  - primary `#1f6ae0`
  - destructive `#fef2f2`
- **Switch:** background and knob position animate over 150ms.

### Responsive (< 720px)
- The sidebar becomes an **off-canvas drawer**: 256px wide, fixed, sliding in with `translateX` over 200ms ease. It sits over a `rgba(9,9,11,.35)` backdrop; tapping the backdrop or any nav item closes it. Nav rows grow to 40px tall.
- Each page header gets a leading **burger** button (34px, lucide menu 18px). On Set detail, the burger is replaced by a **back chevron** and the "Sets /" breadcrumb is hidden.
- Horizontal padding drops to 12px.
- **Skills table:** only Skill + actions remain (`minmax(0,1fr) 64px`). A meta line under the name shows "12m ago · 2 agents · GitHub".
- **Set detail:**
  - The Source column is hidden (`minmax(0,1fr) 72px`).
  - **Copy link** becomes icon-only.
  - The member chips wrap, emails are cut off with an ellipsis, and the invite row wraps onto its own line.
- **Agents:** the status column is hidden and the status is appended to the host line.
- **Sets:** the avatars are hidden.

## State (reference)
`view`, `filter` ('all' | 'recent' | agentId), `q`, `menu`, `edit`, `selected[]`, `addFor` (skill with the open popover), `starred[]`, `agents[]`, `sets[]` ({id, name, mine, pub, owner, members[], skills[]}), `activeSet`, `dialog` ('set' | 'agent' | null), `newSetName`, `invite`, `profilePublic`, `drawer`, `toast`.

**Data the backend needs to provide:**
- **Skills:** name, description, repo (nullable), agent ids, last-used timestamp
- **Agents:** name, host, online status, last sync
- **Sets:** owner, members, visibility, skill list
- **Current user:** handle, public flag, GitHub App installation status

## Assets
- No image assets. Icons are lucide and the logo is the 👀 emoji.
- Fonts: Geist and Geist Mono (Google Fonts / `geist` npm package).
- All data is sample data. The skill descriptions, repo names and the connect command are placeholders.

## Files
- `omgskills App (standalone).html`: the clickable prototype, fully offline
- `omgskills App.dc.html`: the source, with the markup plus a `Component` logic class holding the data and behavior
- `support.js`: the runtime needed to open the `.dc.html` source
