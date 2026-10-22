# F2 Scoped Review

2026-10-09, `codex/newmac-f1-core`, based on `33b659e6`.
User approved scoped review and local commit; no push, deployment or release.

## Findings

No blocking findings in the F2 diff, new source/test files or archived evidence.
No native production source, signing, release feed or catalog dataset changed.
The production entry does not supply the test action. Preview-only case policy
binds exact catalog/source/path/revision identities to the existing Debug request;
the same managed installer retains approval, ownership and conflict checks.

## Verification rerun

- 117 Swift tests in 17 suites passed, including the multi-source test and
  affected public/group installer, request, review, model and runtime regressions.
- 232 portal tests and two test-app assembler tests passed.
- TypeScript passed.
- Standard production build passed with `VITE_NEWMAC_F1=1`.
- Unified production build passed with `VITE_PORTAL_UNIFIED_ENABLED=1`,
  `VITE_SKILLGROUPS_WEB_ENABLED=1`, `VITE_PORTAL_PREVIEW=1` and
  `VITE_NEWMAC_F1=1`. All seven generated HTML/JS files were checked:
  no test URL scheme, case parameter, fixture case identifiers or pinned SHAs.
- All nine source/test file hashes still match `source-manifest.json` from
  acceptance. Complete receipt JSON and before/after snapshots were checked;
  no secret patterns were found in the scoped evidence.
- The cleaned test roots remain absent; the public app executable hash remains
  unchanged. The acceptance browser session was not repeated or reinstalled.

The earlier real-source preflight and five user-run checks are retained in
`preflight.json` and `acceptance.json`; they were not rerun during commit review.
The 117-test selection adds a regression to the earlier 116-test selection;
it does not replace the original dated result.

## Remaining boundaries

This is a selected three-source local proof, not broad catalog coverage,
first-time setup, existing-user migration, signed distribution or release
acceptance. Catalog drift requires a new preflight before any future rerun.
Browser approvals were user-run; no additional automated browser/rendering
acceptance is claimed. Production is unchanged.

## Commit scope

Only the nine source/test files in `source-manifest.json`, `connect.md`,
`newmac.md`, and the nine evidence files in this directory. The archive is
Git-ignored, so evidence must be added by exact filename. No generated bundle,
test app, temporary HOME, unrelated archive, push or deployment.
