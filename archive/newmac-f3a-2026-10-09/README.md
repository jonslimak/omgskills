# F3a Local Setup/Retry Acceptance

2026-10-09. Passed locally; not signed first-time setup or release acceptance.
Base: `f7a964b0` on `codex/newmac-f1-core`; six code/test files are bound by the source manifest.

## Results

- User confirmed the same Writing Guidelines detail/setup remained after refresh.
- User reported an initial wrong click, then correct cancellation. Independent
  read-back found the test home empty, no managed store and the intended F1 app running.
- User then approved Install in test folder. Full file/tree hashes and provenance
  match commit `063bee94c3f4df8453406c830b0a7df0f2860278`:
  one `SKILL.md`, 1,233 bytes; package tree `17d954cadfb8dec50bf0c707c9e7634be9ae9fe8`.
- A fresh isolated Codex `skills/list` found `writing-guidelines` enabled at the
  exact installed path, with no errors, credentials copied or model calls.
  Codex created its own bundled `.system` skills only inside the test home.
- User confirmed Already installed on repeat. Independent comparison found all
  bytes, modes, links, provenance/hash/timestamp and activation count unchanged.
  The activation count remains one and staging is empty.
- 249 portal tests (17 new), TypeScript, 34 native tests in seven suites and both
  production builds passed. Eight normal and eleven unified output files were
  checked: no F3 setup, test scheme or fixture cases were included.

## Scope and Evidence

`acceptance.json` contains complete install/repeat snapshots and Codex discovery.
`source-manifest.json` binds the six code/test files. `setup.json`,
`preflight.json` and `server.json` retain their original pre-test status; those
historical pending/not-launched labels are not the final outcome.
The acceptance receipt's pending cleanup and source manifest's uncommitted
status describe the acceptance-time snapshot. Subsequent cleanup and scoped
review are recorded in `cleanup.json` and `review.json`; this checkpoint
includes the source, tests, docs and evidence.
GitHub preflight records the repository tree; acceptance records the smaller
Writing Guidelines package tree. Full expected package data comes from the
preserved F2 `preflight.json`, not a new package selection.

No scripted browser or screenshot acceptance; the user operated the browser and
native app. Exact click/prompt counts were not collected. The local download
control stayed disabled, no download artifact was substituted and no signed
setup claim is made. No native production source changed for F3a. No production
app replacement, update-feed change, public deployment or release.

## Completed Cleanup and Review

Approved cleanup passed on 2026-10-09; see `cleanup.json`. The public app,
another user's app, real skill roots and unrelated preview were preserved.
These historical test paths and processes were removed or stopped:

- Root: `/private/tmp/omgskills-f1-u0pGXL/`.
- Bundle: `menubar/.build/arm64-apple-macosx/debug/f1-apps/omgskills-f1-u0pGXL/OMGSkills F1 Test.app`
  in the implementation worktree.
- Server: PID 66492, loopback port 5198; ownership verified before stopping.
- Scheme: `omgskills-f1` only; exact test bundle unregistered.

Cleanup paused on the sealed package's read-only directories. After read-only
inspection and exact file-hash verification, only those two owned test
directories were made writable and removal completed. The final read-back
confirmed no test listener or handler, no remaining root/bundle, and unchanged
public app hash/handler and preserved processes. Browser tabs were not changed;
the old localhost URL is no longer served.

Scoped review found no blocking issue. All 249 portal tests, TypeScript and both
production builds/exclusion checks passed again; source hashes still match.
Native sources were unchanged, so the earlier 34-test native result was reused.
No automated browser/mobile visual claim; signed first-time setup remains open.

Next: plan the integrated signed candidate and clean-user F3b
download/open/return/retry. Connect owns status. No push or deployment.
