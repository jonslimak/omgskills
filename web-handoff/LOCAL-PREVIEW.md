# Local UI Preview

Updated 2026-09-24. This page remains sample-only.

The separate B1 implementation is tracked in `LOCAL-INTEGRATION.md`; this preview remains sample-only.

- URL: http://127.0.0.1:5173/app/preview/
- Worktree: `/private/tmp/omgskills-web-portal-redesign`
- Branch: `codex/web-portal-redesign`, based on main `827f31ce`.
- Local commit only. No deployment, feature activation, Mac update, or push.

## Review

User approved the five-screen design and shared page widths. Code review found no blocking issues for this isolated preview.

Skills, Agents, Sets, Set detail, and Home are navigable. Search, filters, Favorites, membership, bulk selection, set creation/editing/reordering, access, profile edits, and device revocation operate on sample data in memory. Refresh/reset restores the fixtures.

Use the top selector for populated, empty, loading, error, long-content, and connected-source layouts. The shared Product launch set is read-only. Hidden state can be toggled in an owned set's menu.

Pairing, GitHub setup, private-source registration/releases, Clerk settings, and sign-out show explicit preview/unavailable states. No fake tokens or commands are generated. Copy actions copy local preview links, never claim to publish a real set/profile.

The handoff's GitHub brand icon is represented by Lucide's repository-fork icon because the installed Lucide version does not include brand icons. Other deliberate contract differences are listed in `MAPPING.md`.

## Verification

- Baseline: portal build and 19 existing portal tests passed.
- Current: portal build and all 25 portal tests passed, including six new preview/domain tests.
- Production build with `VITE_PORTAL_PREVIEW=1` excludes fixture code, sample strings, and preview-only fonts.
- Browser checks: five screens at 1440x900, 1024x768, 390x844, and 320x740; no page/main horizontal overflow or API/external-account requests during the sweep.
- Checked search, selection, Favorites confirmation, set creation with selected skills, membership persistence, visibility, email access, mobile drawer, Escape/focus return, back navigation, protected Favorites, shared permissions, and empty/loading/error/connected-source states.
- Final narrow-detail edit and modal focus checks passed without page errors. Screenshots are in `/private/tmp/omgskills-web-preview-verification/`.
- Layout review: all five pages now share a 960px outer limit and aligned headers. Measured equal 20px left/right gutters on desktop and 12px on mobile across the four viewport sizes, with no horizontal overflow.
- Real-account/backend behavior is intentionally unverified. Existing authenticated portal and pairing implementation are unchanged.

## Restart

Use a Node version supported by the installed Vite (20.19+ or 22.12+). This machine's `/opt/homebrew/opt/node/bin/node` was used for build/dev checks; the default Node 20.17 is too old for the installed Vite requirement.

From the worktree root:

```sh
env PATH=/opt/homebrew/opt/node/bin:$PATH npm --workspace portal run dev:design -- --port 5173
```

Use another free port if needed. The preview binds only to loopback, requires development mode and its explicit flag, and bypasses Clerk only under `/app/preview/`.

```sh
npm --workspace portal test
env PATH=/opt/homebrew/opt/node/bin:$PATH npm run build:portal
```

The direct test command avoids the `tsx` CLI's sandbox-restricted IPC socket.
