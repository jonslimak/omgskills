# F1 Local Install/Update Acceptance

Completed 2026-10-09. This is evidence for one isolated public-skill flow, not
broad catalog coverage, a signed distribution test or approval to release.

## Evidence

- `receipt.json`: original acceptance snapshot, preserved unchanged before
  cleanup. Its temporary paths and `uncommitted`/cleanup-pending fields describe
  that point in time, not the current state. The implementation accompanies this
  archive on `codex/newmac-f1-core`, based on `eb92e828`.
- `TEST.md`: the instructions used for user-run browser/native checks.
- `web-desktop.png`, `web-mobile.png`: local preview layout evidence, not proof
  of installation by themselves.

Fixture: `anthropics/skills:skills/frontend-design`. The public catalog record
was unpinned; the app resolved package coordinates from the actual Git objects.

| Check | Result |
| --- | --- |
| Open A and Cancel | No installed files or managed store |
| Install A | Exact files/tree/provenance; fresh isolated Codex discovery |
| Repeat A | Same target, timestamps, provenance and activation count |
| Review B and Cancel | A files and install record unchanged |
| Retry B with a local edit | Refused; edit/record preserved; original A restored |
| Apply reviewed B | Exact B files/tree/provenance; fresh isolated Codex discovery |

Codex discovery used a fresh `app-server` with only the isolated `HOME` and
`CODEX_HOME`. No login, copied credentials or agent/model call was needed.

## Review

No blocking findings in the scoped review. Rerun results: 115 Swift tests across
15 suites, 230 portal tests and 2 assembler tests passed. The production web build
passed with the F1 flag deliberately set; the output contained neither the F1 URL
scheme nor the A/B test commits. `git diff --check` passed. The earlier real-source
preflight and six user-run checks are separately recorded in the receipt.

Usability lesson: Anthropic has multiple `frontend-design` records. Use the exact
catalog-detail link, not only a name/author search. Refreshing the preview resets
the revision selector to A; close the detail, select B and use Back once to reopen
the exact skill without refreshing.

## Approved Cleanup

Evidence copies were hash-verified before deletion. Removed only:

- `/private/tmp/omgskills-f1-hVqS0Y/`: isolated home, managed packages, discovery
  schema/cache, temporary edit backup and old test binary.
- The `omgskills-f1-hVqS0Y/` run directory under
  `menubar/.build/arm64-apple-macosx/debug/f1-apps/`, containing only
  `OMGSkills F1 Test.app`.

The exact F1 app was quit and unregistered. No F1 process remains, and the local
preview on port 5197 was stopped and no longer listens. The production URL handler
remains `/Applications/omgskills.app`; its running process was left alone.
Production executable SHA-256 remained:

`34f3aa9b7a96766463f7e827e521e20a4282c3ff2f71bdbe2bec9b1bc44065b1`

No real skill folder, account credential, public release configuration, hosted
artifact or Sparkle feed was changed. No push, deployment or release is included.
The ignored build/test logs remain; no broad build-directory cleanup was done.
