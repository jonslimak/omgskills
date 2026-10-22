# F3c signed-candidate skill update, 2026-10-12

**Bounded acceptance passed with a Codex restart caveat.** Install/update checks
passed; Humanizer became visible in Codex only after an approved normal restart.
Preparation covered fixed A/B links, source preflight, tests, isolated draft and
dedicated test-site publication. Subsequently approved guest acceptance installed
A, cancelled B, applied B and repeated B in the retained VM. Preparation and
acceptance did not rebuild, sign, commit or push. Subsequent scoped review and
checkpoint details are recorded below. See the acceptance results and
[guest verification](guest-verification.json).
Base: `fd5a4e4d52e4e12666667023a1fb7ef9eb842c0c` on `codex/newmac-f1-core`.

## Reused candidate

Retain `OMGSkills-F3b-Test-01` and its `OMGSkills Setup Test.app`, version/build
`0.1.0` / `1`, bundle `com.jonslimak.omgskills.setuptest`.
The [F3b acceptance](../newmac-f3b-2026-10-12/README.md) remains the signed setup
evidence; this preparation is not another install or app-upgrade test.

`OMGSkills-Setup-Test-0.1.0-arm64.dmg` is unchanged: 6,080,713 bytes, SHA256
`3cf340de60ae43f44d675a60bc485de8476e812c9c3e25fd366b83b5dd58effc`.
Existing package preparation rechecked signatures, notarization/stapling and
Gatekeeper without rebuilding or signing. No production app identity/feed used.

## Fixed links and source preflight

Open these only in Safari **inside the retained VM** when acceptance begins:

- [Humanizer A](https://omgskills-setup-test-f3b.netlify.app/app/preview/unified/?view=discover&skill=catalog%3Ablader%2Fhumanizer&f2case=humanizer-a)
- [Humanizer B](https://omgskills-setup-test-f3b.netlify.app/app/preview/unified/?view=discover&skill=catalog%3Ablader%2Fhumanizer&f2case=humanizer-recorded)
- [Writing Guidelines sentinel](https://omgskills-setup-test-f3b.netlify.app/app/preview/unified/?view=discover&skill=catalog%3Avercel-labs%2Fagent-skills%3Askills%2Fwriting-guidelines&f2case=writing-guidelines-recorded)

Humanizer repository: `blader/humanizer`, root package, entry `SKILL.md`.

| Version | Commit | Tree | Files | Bytes |
| --- | --- | --- | --- | --- |
| A | `29deb74c89fc12d01c6eab433252c869ce08ad7b` | `6c894c1c7396aabbe86ca2d5bcdff5a58d7b2813` | 14 | 66,106 |
| B | `225a6f39ac85f76ee48dbad772ea4abe4ed6c9d8` | `8ed37b6d1d98a0bbdb599d0399a4a2185eb8fa03` | 14 | 65,888 |

[preflight.json](preflight.json) records every mode, size, Git blob and SHA256.
Exact commits/trees matched prior F2 evidence; 16 unique blobs were downloaded
and verified across both versions, using 20 GitHub requests. Only `README.md`
and `CHANGELOG.md` change. `SKILL.md` remains blob
`19fc634208e8cc6ae55d4ff287152583216fd244`.
Current Humanizer and Writing Guidelines catalog identity/path checks matched
the fixed public, unpinned cases. Package instructions/scripts were data only;
nothing from either package was executed.

## Page checks and hosting

- Exactly three canonical cases accepted. Extra, duplicate, mismatched and
  latest-version queries fail closed. Changed/missing/newly pinned sources block.
- Independent Humanizer A/B saved requests prevent cross-version reuse;
  original Writing Guidelines saved setup remains compatible.
- 20 package/page tests passed; strict test-page TypeScript passed.
- Draft asset read-back passed. Native actions on the draft hostname refused,
  as intended; only the approved test origin is accepted.
- Published asset bytes and noindex headers matched; unchanged DMG verified.
- Three live cases at 1200px and 390px: correct title/commit, visible action,
  rendered avatar, no page errors or horizontal overflow. Native Open not clicked.
  Screenshots retained under `output/playwright/newmac-f3c-1200.png` and
  `output/playwright/newmac-f3c-390.png` in the isolated checkout.

Site: `16f435c1-e5d0-4b40-b174-382d839e877b`, `omgskills-setup-test-f3b`.
It is unlinked/noindex but publicly reachable, not access-controlled.
No custom domain, Git connection, server functions or edge functions were added.
Staging ran outside repository deployment configuration at
`/private/tmp/omgskills-f3c-deploy-ImH4gP`.

| Stage | Deployment |
| --- | --- |
| Previous test | `6accf8455624febf36c2f33c` |
| Draft | `6acd05c49e5d7e63af9833e5` |
| Published test | `6acd060224b165112107071d` |

Evidence: [preparation](preparation.json), [draft receipt](draft-deploy.json),
[draft verification](draft-verification.json),
[published receipt](test-site-deploy.json),
[hosting verification and source hashes](hosting-verification.json).

### Concurrent production change

The unchanged-production assertion failed. Read-only investigation found a
separate production deployment, not one made by this task:
`6accd76150900fe8387f15d0` became `6acd058c16b0604a1db7a0bd` on site
`dfdb618d-b748-4c4f-a535-646dc5db449f`.
It published at `2026-10-12T16:06:51.575Z`, before this task's test draft upload;
the final test deploy was created at `2026-10-12T16:08:34.589Z`.
This task deployed only the explicit test-site ID. No claim is made about who
ran the production deployment. No rollback or production intervention occurred.

## Approved guest acceptance sequence

1. Fresh read-only baseline: correct candidate copy/identity, Humanizer absent,
   Writing Guidelines package/provenance/link unchanged. Stop if not true.
2. Install A through the A page and native review. Compare all installed files
   and provenance to the exact A manifest, not just the visible success message.
3. Open B, verify the two-file change review, then cancel. Prove A unchanged.
4. Reopen B and approve. Verify exact B bytes/provenance and activation link.
5. Repeat B. Verify Already installed and no replacement of package/record/link.
6. Refresh Codex and confirm Humanizer discovery without a model run. Verify
   Writing Guidelines remains unchanged throughout.

Stop for unexpected existing Humanizer, local edits, wrong app/destination,
source/rate-limit failure, ambiguous result, unexpected write or required bypass.
Do not force a pass by deleting/replacing a pre-existing skill. No host skills,
credentials or agent model runs are part of this preparation. VM and test assets
are retained; cleanup needs an exact inventory and separate approval. This
archive is ignored by default and is not committed by this preparation.

## Guest acceptance results, 2026-10-12

Observed through the VirtualBuddy guest UI and read-only guest Terminal checks.
The server error was a malformed address entered through VM keyboard automation;
the correct HTTPS page loaded, and the test site returned HTTP 200. No server or
application code change was needed. Subsequent navigation used the page's fixed
A/B links, avoiding VM keyboard handling of URL punctuation.

| Check | Result | Evidence |
| --- | --- | --- |
| Baseline | PASS | Existing signed candidate identity/executable matched; one process; Humanizer absent in all three agent roots; Writing Guidelines baseline retained |
| Install A | PASS | Native Installed in Codex; all 14 source hashes, sizes and modes matched A; exact commit/tree in provenance |
| Review B and cancel | PASS | Correct A/B pins and README.md/CHANGELOG.md changes shown; cancel preserved all A hashes, file identities, provenance and active link |
| Apply B | PASS | Native Updated in Codex; all 14 source hashes, sizes and modes matched B; exact B commit/tree in provenance and new activation |
| Repeat B | PASS | Native Already installed; no replacement of B files, provenance or active link; all hashes and file identities unchanged |
| Unrelated skill | PASS | Writing Guidelines content/provenance hashes, file identities, modification times and activation link unchanged |
| Codex discovery | PASS AFTER RESTART | Refresh alone showed No skills found; after normal guest Codex quit/reopen, Humanizer appeared under Installed and its detail view rendered the expected skill content; Writing Guidelines remained visible; no model run |

Humanizer A's install record time is `2026-10-12T16:47:56Z`; B's is
`2026-10-12T16:52:11Z`. The complete source manifests remain in preflight.json.
Package scripts/instructions were treated as data; none were executed.
Humanizer remained absent from the guest's `.agents/skills` and `.claude/skills`.
The same Setup Test process (`3197`) handled all requests. No host skill changes,
app replacement, credential access, permission bypass or production deployment
was performed during guest acceptance.

The acceptance run initially stopped at the discovery check. Read-only inspection found
the expected SKILL.md frontmatter and no Humanizer-related match in guest Codex
logs; neither established the cause. The user then approved restarting only guest
Codex. Normal Quit was verified by the app window and running Dock indicator
disappearing, followed by reopening it from the guest Dock. At approximately
13:47-13:49 guest local time, Humanizer appeared under Installed and its details
rendered the expected content; searching writing still showed Writing Guidelines.
No skill reinstall, file edit, permission change or model run was performed.

This closes discovery for this bounded test with a restart caveat, not proof that
refresh reliably discovers new skills or that the broader release is ready.
The result is consistent with stale app discovery state; the underlying cause
has not been diagnosed. Retain the refresh-only failure as follow-up evidence.
At that discovery follow-up, only this ignored archive and guest-verification.json
were updated; active trackers, hosting and native builds were not changed.
Retain the VM and artifacts; cleanup is not approved.

## Scoped review checkpoint, 2026-10-12

No blocking findings in the four test-page/test files, two trackers or eight
evidence files. Fixed source/version selection, request storage isolation,
fail-closed behavior and unchanged production/native boundaries were reviewed.

- `node --test scripts/prepare-newmac-setup-test.test.mjs scripts/setup-test-page.test.mjs`: 20 passed.
- `node --import tsx --test portal/tests/install-intent.test.ts portal/tests/public-install.test.ts portal/tests/public-catalog.test.ts`: 51 passed.
- Strict, no-output TypeScript check of `experiments/setup-test-web/main.ts` passed.
- All four source hashes and six retained hosted asset hashes/sizes matched
  `hosting-verification.json`; draft and published receipts agree.
- Both 14-file manifests agree with the recorded guest versions and byte totals;
  only `README.md` and `CHANGELOG.md` differ between A and B.
- All seven JSON files parse; evidence was checked for secret-like content.

This checkpoint explicitly includes all eight small files in this archive despite
the ignore rule. Historical preparation receipts and guest observations retain
their original stage/status; this section records the later review.
No live re-verification, VM rerun, model execution, binary rebuild, signing,
push, deployment, release or cleanup. The discovery restart caveat remains open.
