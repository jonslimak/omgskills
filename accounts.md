# Accounts and Macs

How an OMGSkills account relates to the Macs it syncs, and what happens when a different email signs in on the same Mac.

## Problem

Every account paired from one Mac shows the same skills (107 in testing), because each pairing uploads that Mac's skill folders. Nothing leaks between accounts. Each account gets its own copy. But:

- After switching, the old account keeps a stale copy of the Mac's skills.
- The Mac app gives no hint that it is moving from one account to another.
- Revoking a Mac sets `device_tokens.revoked_at` but leaves its `synced_skills` rows, so the old account still lists them.

## Model

- **A Mac is linked to one account at a time.**
- **The Mac owns its inventory.** Whatever is in `~/.claude/skills` and `~/.codex/skills` is "installed on this Mac", not owned by an email.
- **The account owns everything else:** likes, sets, shared groups, creator profile, and remote installs.
- **People sharing a computer stay separate** when they use separate macOS user accounts, since each has its own home folder. No extra work is needed.

## New user (unchanged)

1. Sign in on the web and create the account.
2. Download the Mac app and link this Mac.
3. The Mac uploads its skills to that account.

## Different email on an already-linked Mac

1. The Mac app sees it already holds a link to account A while pairing for account B.
2. It asks before continuing: "This Mac is linked to a@… Switch it to b@…? a@… will no longer see this Mac's skills."
   - **Cancel** keeps the link to A and stops pairing.
   - **Switch** goes on to steps 3–5.
3. On Switch, the Mac revokes its A token (best effort if offline, as `disconnect()` does today).
4. It pairs with B and uploads a fresh scan.
5. The server removes this Mac's inventory from A.

## Server changes (built on `mac-account-switch`)

- **Move to another account → delete.** The Mac's reconnect key is per Mac, not per account. When it shows up in a pairing for a different account, the exchange revokes the old account's connection, clears its key, and deletes that Mac's `synced_skills` rows (`releaseMovedDevice`). Set items keep their name and note; only the link to the deleted row is cleared. `sync_runs` history stays.
- **Plain disconnect/revoke → hide, not delete.** FIN-02/FIN-06 require a same-account reconnect to keep the same row IDs and Set links. So a revoked Mac's rows stay stored but are left out of the v2/v3 inventory read. Reconnecting revives the same device row and the skills reappear.
- Account-owned data is never touched by a switch.
- Macs without a reconnect key (older builds) can't be detected as moving; their old copy is only hidden once revoked.

## Web changes

- My skills shows only skills from active Macs.
- A revoked Mac already shows as revoked in Devices; it now has no skills under it. A "Linked to another account" label is later polish.
- When an account has no active Mac, show the existing "Link your Mac" empty state.

## Mac changes

- None needed for this step. The app already asks "Replace current connection?" before pairing over an existing one, and always sends its reconnect key.
- Later polish: name the linked email in that prompt.

## Open questions

- **Old account's rows: delete or keep?** Decided: delete. This matches "the Mac owns its inventory". If the Mac links back later, a fresh scan restores the skills.
- **Should A get an email when its Mac moves?** Probably not for now.
- **Old revoked devices:** clean up their leftover rows with a one-time backfill.

## Done when

- Pairing a second email on the same Mac shows the switch prompt.
- After switching, A lists none of the Mac's skills, and B lists them all.
- Revoking a Mac from the portal removes its skills from My skills.
- Tests cover switch, revoke, and the read filter.
