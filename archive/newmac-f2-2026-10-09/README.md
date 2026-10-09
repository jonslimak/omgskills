# F2 Multi-Source Test

Tested 2026-10-09 on `codex/newmac-f1-core`, after `33b659e6`, before the
local F2 checkpoint commit. **Automated checks, user-run browser/native acceptance
and fresh Codex discovery passed. Approved cleanup is complete.** No push,
deployment or release. This selected sample is not full-catalog acceptance.

`acceptance.json` preserves complete per-operation manifests, link/provenance
snapshots and both Codex checks. `cleanup.json` records the exact removed paths,
stopped processes and preserved production state. `setup.json` and `server.json`
are historical setup snapshots, not current running services.
`source-manifest.json` identifies the nine uncommitted F2 source/test files by
SHA-256; the native test binary's hash is recorded in setup and acceptance.
`REVIEW.md` records the subsequent scoped review, regression rerun and local
commit scope. The JSON acceptance record retains its historical pre-commit state.

## Sources and preflight

`catalog.json` records the three live `discovery_only` records. `preflight.json`
contains complete Git file manifests, commit/tree/blob hashes, sizes, durations
and fetch counts from the actual Swift fetcher and review validator. The rerun
stops if the latest commit no longer matches the selected fixture. No files are
trimmed and no existing validation limit is relaxed.

| Source | Shape | Latest files / bytes | Latest commit |
| --- | --- | --- | --- |
| `blader/humanizer` | Repository root | 14 / 65,888 | `225a6f39ac85f76ee48dbad772ea4abe4ed6c9d8` |
| `vercel-labs/agent-skills:skills/writing-guidelines` | Nested | 1 / 1,233 | `063bee94c3f4df8453406c830b0a7df0f2860278` |
| `coreyhaines31/marketingskills:skills/seo-audit` | Nested with companions | 9 / 79,787 | `1efedbc5148b54b2f0f6c6c9fe0be62e151c7fff` |

Humanizer A is `29deb74c89fc12d01c6eab433252c869ce08ad7b` (14 files, 66,106
bytes). A-to-B changes `CHANGELOG.md` and `README.md`; `SKILL.md` is unchanged.
This tests companion updates rather than relying only on the skill-file hash.

Candidate exclusions and lookup corrections:

- `obra/superpowers:systematic-debugging` and `obra/superpowers:brainstorming`
  are already pinned in the live catalog, despite the older local snapshot.
  `vercel-labs/skills:find-skills` was also pinned in the search response.
  None was passed to the unpinned flow or stripped of its pin.
- Initial lookups for `obra/superpowers:skills/systematic-debugging` and
  `coreyhaines31/marketingskills:seo-audit` were not found. Live catalog lookup
  supplied the actual IDs; no install path was manufactured from those IDs.
- No package was rejected or substituted for exceeding review/package limits.
  This selected sample is not a catalog success rate or rate-limit capacity test.

## Verification

- 116 Swift tests in 16 suites: includes three-source shared-home installs,
  persistence across installer instances, no-op, companion update, unchanged
  other sources and different-source/same-name refusal. These use local fixtures.
- One additional opt-in real-source preflight passed for all three sources and
  Humanizer A/B, using four Git fetches. It did not install skills.
- 232 portal tests and 2 assembler tests passed.
- TypeScript and production build passed with `VITE_NEWMAC_F1=1`. Rerunning Vite
  with Node 25.6.1 avoided the older npm runtime warning. Generated HTML/JS
  contained no test scheme, F2 case parameter or fixture commits.
- Preview route and changed modules returned HTTP 200 without compilation errors.
  Browser rendering/clicks were not automated; those remain user-run checks.

## Manual results

| Check | Result |
| --- | --- |
| Humanizer A | Passed: 14 files / 66,106 bytes; exact Git tree, modes and provenance |
| Writing Guidelines Latest | Passed: one file / 1,233 bytes; Humanizer unchanged |
| SEO Audit Latest | Passed: nine files / 79,787 bytes; both earlier installs unchanged |
| Writing Guidelines recorded repeat | Passed: all three filesets, links, provenance/timestamps and activation counts unchanged |
| Humanizer Latest update | Passed: B has 14 files / 65,888 bytes; only `README.md` and `CHANGELOG.md` changed; both other installs unchanged |
| Fresh Codex discovery before and after B | Passed: all three enabled user skills at exact resolved installed paths, no discovery errors or model calls |

The user performed browser/native approvals. The assistant verified filesystem
results; browser rendering was not automated. Humanizer appears in Codex as
`humanizer:humanizer` because its package declares a plugin namespace. The first
bare-name assertion was corrected after inspecting actual discovery output;
there was no missing skill or installer change. Verification also followed the
existing two-link activation-to-package layout, without changing it. Codex's
bundled `.system` cache was created only inside the isolated home and removed
with that home. Skill instructions were not executed.

## Isolated setup (removed)

`setup.json` and `server.json` are preserved setup snapshots, not acceptance.

- App: `OMGSkills F1 Test.app`, bundle `com.jonslimak.omgskills.f1`, scheme
  `omgskills-f1`. Same test identity as F1; F2 is not a second helper product.
- Run root: `/private/tmp/omgskills-f1-hl5alh/`.
- Target: `/private/tmp/omgskills-f1-hl5alh/home/.codex/skills/` (Foundation may
  display the equivalent `/tmp/omgskills-f1-hl5alh/` prefix).
- Server: loopback port 5197, PID 17906, Node 25.6.1; public catalog reads only.
- Initially the app was registered but not launched, and the test home was empty.
  The user subsequently launched it and completed the acceptance sequence above.
- Production handler remained `/Applications/omgskills.app`; its executable
  SHA-256 remained `34f3aa9b7a96766463f7e827e521e20a4282c3ff2f71bdbe2bec9b1bc44065b1`.

## Manual sequence

Historical instructions below are retained for reproducibility. These localhost
links are no longer running; prepare a new isolated environment before a rerun.

No sign-in or search is needed. Each link opens the exact skill and test case,
including after refresh. On each page click **Open in OMGSkills F1 Test**. Allow
opening only that app. The menu-bar label is **F1**. Stop on another app, a target
outside the named run root, or an unexpected commit. Do not install through the
ordinary public app.

1. [Humanizer A](http://127.0.0.1:5197/app/preview/unified/?view=discover&skill=catalog%3Ablader%2Fhumanizer&f2case=humanizer-a):
   check commit `29deb74...`, click **Install in test folder**, and wait for
   **Installed in test folder**. Tell the assistant before continuing.
2. After file verification, click **Close**, then open
   [Writing Guidelines Latest](http://127.0.0.1:5197/app/preview/unified/?view=discover&skill=catalog%3Avercel-labs%2Fagent-skills%3Askills%2Fwriting-guidelines&f2case=writing-guidelines-latest).
   Expected commit `063bee94...`; install and pause for verification.
3. Click **Close**, then open
   [SEO Audit Latest](http://127.0.0.1:5197/app/preview/unified/?view=discover&skill=catalog%3Acoreyhaines31%2Fmarketingskills%3Askills%2Fseo-audit&f2case=seo-audit-latest).
   Expected commit `1efedbc5...`; install and pause for verification.
4. Click **Close**, then open
   [Writing Guidelines Recorded](http://127.0.0.1:5197/app/preview/unified/?view=discover&skill=catalog%3Avercel-labs%2Fagent-skills%3Askills%2Fwriting-guidelines&f2case=writing-guidelines-recorded).
   Expect **Already installed**, click **Done**, and pause for no-op verification.
5. Click **Close**, then open
   [Humanizer Latest](http://127.0.0.1:5197/app/preview/unified/?view=discover&skill=catalog%3Ablader%2Fhumanizer&f2case=humanizer-latest).
   Expected commit `225a6f39...` and only the two companion changes above. Click
   **Apply update in test folder**, wait for **Updated in test folder**, and stop.

The assistant verified complete bytes/records/links after each operation and
fresh isolated Codex discovery after steps 3 and 5, without login or model calls.
For any future rerun, stop if Latest moved and recheck it rather than switching
silently to a recorded replay. Collision refusal is covered automatically; no
extra user session was required. The subsequent scoped local commit is approved;
integration, push, deployment and release remain separate decisions.

## Approved cleanup

Evidence copies in the implementation worktree and primary checkout were
hash-verified before deletion. Removed only:

- `/private/tmp/omgskills-f1-hl5alh/`: isolated home, packages, activations,
  Codex discovery caches and test server log/setup copies.
- `menubar/.build/arm64-apple-macosx/debug/f1-apps/omgskills-f1-hl5alh/` in the
  implementation worktree, containing only `OMGSkills F1 Test.app`.

Stopped the exact test app (PID 24051) and preview (PID 17906); unregistered only
that bundle. Port 5197 has no listener and `omgskills-f1` has no handler. The
public `omgskills` handler remains `/Applications/omgskills.app`, its executable
hash is unchanged, and both existing normal-app processes and port 5191's
unrelated preview were preserved. No release feed, hosted artifact or real
skill folder was removed. Exact checks are in `cleanup.json`.

The evidence directory is Git-ignored. Include only this F2 evidence explicitly
in the approved scoped checkpoint; do not add unrelated archive files.
