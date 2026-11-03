# L5.5 end-to-end check: installing Sets from the companion panel

Draft, 2026-10-28. Covers the user-run check in the L5.5 exit requirements
(`local-task.md`) for branch `set-install-ownership`. Runs in production
("build in the wild"): low traffic, 4 Mac users, no promos.

## Part A: production setup

1. Merge and deploy `set-install-ownership` (includes `skillGroupsAuthEnabled: true`).
2. Sign, notarize and publish companion 0.0.28 (`OMGSKILLS_ALLOW_SKILLGROUPS_AUTH_RELEASE=1`)
   as a prerelease; point the setup link and download URL at it.
3. Install 0.0.28 and reconnect once to pick up the Set permission.

## Part B: the check (user-run, about 45 minutes)

Prefer a separate macOS user account; installs go to the real `~/.claude/skills` and `~/.codex/skills`.
Record pass/fail and one screenshot per step.

**Test Set "E2E Set"** on omgskills.com, owned by your account (A), using skills you don't already have:
two public catalog skills (S1, S2), one private skill (P1, if the Broker is set
up; otherwise skip its checks), and one view-only item (M1).

### Connect

1. Install and open 0.0.28. Click **Connect account**, sign in as A.
   The consent page lists "Read private skills shared with you".
   Expect: panel shows A's account; website Devices shows one Mac.
2. (If this Mac connected before 0.0.28.) Open the Set's
   **Install on Mac**. Expect: "Reconnect to allow Set downloads." Click
   **Reconnect**. Expect: still one Mac on the website, inventory unchanged.

### Install this version

3. Before installing, install S1 on its own from the website (Claude).
   Note `ls -l ~/.claude/skills/`.
4. Open the Set page in `/app/` and click **Install on Mac**.
   Expect: panel shows "E2E Set", its version, 4 skills, M1 marked "view only".
5. Choose **Claude**, keep **This version**, tick **Skip 1 view-only**, click
   **Install**. Expect: "2 installed, 1 already installed, 1 view only in
   Claude." (Without P1: "1 installed, ...".) S1's folder and link are
   unchanged; S2 (and P1) appear in `~/.claude/skills/`.
6. Within a minute, or after **Resync**, the website's My skills shows S2
   (and P1) on this Mac. P1 shows no repository address.

### Keep updated

7. Open the link again, choose **Codex**, pick **Keep updated**, **Install**.
   Expect: skills appear in `~/.codex/skills/`.
8. On the website, add one public skill (S3) to the Set and remove S2.
   Open the link, choose **Codex**. Expect: "Update available: 1 added,
   1 removed." Click **Not now**: nothing changes. Open again, click
   **Apply update**. Expect: S3 added, S2 removed from `~/.codex/skills/`.
9. Edit `~/.codex/skills/S1/SKILL.md` by hand. Change the Set again (add any
   skill). Open the link, choose **Codex**.
   Expect: "Local edits block this update." Nothing changes.
10. Undo the edit. Open the link, choose **Codex**.
    Expect: "Update available", and applying it works.

### Cancel, access and gates

11. Add a large skill to a second Set. Start **Install**, then click
    **Cancel** while it shows "Installing...".
    Expect: "Cancelled. Your skills are unchanged."; no new folders.
12. Make "E2E Set" private to another account (or remove A's access).
    Open the link. Expect: "This Set isn't available to you."
13. Disconnect the Mac, then open the link.
    Expect: "Connect this Mac to install Sets." with **Connect account**.
14. Skip in production (turning the switch off is the rollback, not a test step).
15. While an install is running, try **Quit** from the options.
    Expect: Quit is unavailable until it finishes.

### Accessibility

16. With the panel open on a Set: Tab reaches every control in order;
    VoiceOver reads the Set name, each skill and "view only", the pickers and
    buttons. A Set and skill with 60+ character names truncate without
    breaking the panel.

## Done when

Steps 1–16 pass (P1 checks skipped only if the Broker isn't set up), with notes and screenshots. Failures get the smallest fix and one
regression test, then a rerun of the affected steps only.
