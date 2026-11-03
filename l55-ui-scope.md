# L5.5 UI scope: installing Sets in the companion panel

Draft, 2026-10-28. For approval before any code changes. This fills in the
first L5.5 exit requirement in `local-task.md` ("intended user-facing flows and
promises are written and approved before code changes begin").

## What exists today (source checked at main `3bc5e1b9`)

- **Built and tested (L5.1–L5.4):** loading a Set's manifest with the Mac's
  device credential (`GroupInstallFlowModel`, `DeviceGroupManifestAPI`), Claude
  or Codex target, "Install this version" / "Keep updated", metadata-only items
  with an acknowledgement, private packages through the read-only Broker,
  install/cancel/retry, subscription diff detection and confirmed apply
  (`GroupSnapshotInstallModel`, `GroupSubscription*`).
- **Not wired into the companion.** The production companion routes every
  incoming link to `CatalogInstallWindowController` (`omgskillsApp.swift`) and
  returns before the `omgskills://group` handling. The Set sheets
  (`GroupInstallFlowSheet`, `GroupSnapshotInstallSheet`) are 360–480 pt wide
  windows from the old app, not the 210 pt companion panel.
- **Gated off twice.** The build flag `OMGSkillsSkillGroupsAuthEnabled` is
  `false` in production Info.plist (checked by `prepare-connected-production`
  tests), and the remote `skillGroupsAuthEnabled` setting is off.
- **The website never shows the Set install link.** `publicGroupAppDeepLink` in
  `netlify/functions/_shared/public-group-routes.ts` is marked "do not render
  until the app can preview and install groups."
- **Pairing already asks for `content:read`.** The companion requests all
  device scopes; the server grants `content:read` only with browser approval.
  Whether existing companion connections actually hold it needs checking.

So L5.5 is: wire the tested Set logic into the companion, give it a panel-sized
UI, and add the website button. No new install, package or access logic.

## User promise

> On a Set's page, click Install on Mac. The companion shows the Set, you pick
> Claude or Codex and "Install this version" or "Keep updated", and it installs
> the skills you can access. Nothing changes until you confirm.

The website and the app must not promise automatic updates. "Keep updated"
means: when you open the Set again, the app shows what changed and asks first.

## Flows in scope

1. **Install a Set.** Set page → "Install on Mac" → companion panel opens on the
   Set → choose agent and mode → confirm → progress → result.
2. **Open a Set you already installed.** The same link shows the installed
   version. If the Set changed and you chose "Keep updated", the panel lists
   added, changed and removed skills and offers "Apply update". Removed skills
   are never deleted silently (existing L5.3/L5.4 rule).
3. **Not connected / missing access.** The panel says what's needed and offers
   Connect. It does not install anything.
4. **Cancel.** Before confirming, nothing changes. During install, Cancel uses
   the existing cancellation path.

## Panel states

All shown inside the existing anchored panel. If 210 pt proves too narrow for
the skill list, the panel may widen for the Set view only (decide during
implementation, with a screenshot for review). No new window.

| State | What the panel shows | Actions |
| --- | --- | --- |
| Loading | Set name if known, spinner | Cancel |
| Not connected | "Connect this Mac to install Sets." | Connect, Close |
| Needs content access | "Reconnect to allow Set downloads." | Reconnect, Close |
| Unavailable / revoked | "This Set isn't available to you." | Close |
| Temporarily unavailable | Short reason | Try again, Close |
| Ready | Name, version, owner, skill list (installable vs "view only" items), agent picker, mode picker, acknowledgement when some items are view-only | Install, Cancel |
| Empty | "This Set has no skills you can install." | Close |
| Installing / cancelling | Progress, count | Cancel (while allowed) |
| Success | "Installed N skills in Claude." plus skipped/view-only count | Done, Open website |
| Partial or failed | Which skills failed and that the others were kept | Try again, Done |
| Already installed, no changes | "Up to date (version N)." | Done |
| Update available | Added / changed / removed lists | Apply update, Not now |

Copy uses "Set" (not "Skill Group"), matching the website.

## Gating

- Keep both gates. With either off: no Set UI, an open Set view closes safely,
  and incoming `omgskills://group` links are dropped (L5.5 exit requirement).
- The website button renders only when the Set install feature is enabled, so
  older apps (0.0.20, earlier companions) never receive links they ignore.

## Out of scope

- Background update checks, notifications or automatic applies.
- Uninstalling a Set or leaving a subscription from the app.
- Creating or editing Sets in the app; publishing private skills (L7).
- Changing package validation, Broker access, manifest contracts or the
  per-skill catalog install path.
- Signing, publishing, appcast changes, enabling the gates or production
  activation (separate approvals: dormant release, then L1.6).

## To verify before building

1. Do existing companion connections hold `content:read`? If not, the
   "Needs content access" state is the common path, and reconnect copy matters.
2. Set installs use the managed group installer; per-skill installs use the
   catalog adapter. Check that a skill already installed one way is reported as
   already installed or a conflict by the other, never overwritten.
3. The companion scanner and website inventory show Set-installed skills
   correctly (grouping, no duplicates).

## Acceptance

Maps to the L5.5 exit requirements:

- This scope approved before code.
- Every state above reachable and tested at the model level; focused UI/model
  tests, full Swift suite and a clean release build pass.
- Gate-off behavior tested (hidden UI, safe close, dropped links).
- Keyboard, VoiceOver labels, focus order and long names checked in the panel.
- One user-run end-to-end check in an isolated app, account, install root and
  disposable Set: install, reopen with no change, change the Set, apply update,
  cancel, revoked access. Personal skills and the public app untouched.

## Size

About 3–5 days: wiring and gating (1), panel UI and states (1–2), website
button (0.5), tests and the end-to-end check (1–1.5). Stop and report if it
passes 10 days.
